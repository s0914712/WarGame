/**
 * LLM AI 指揮官（Adversary）—— 戰場摘要、prompt、回應解析、跨回合記憶。
 *
 * 瀏覽器（useAiSideLoop / LLMPanel）與 Node（mcp-server benchmark、評測腳本）共用，
 * 純函式：只讀 scenarioStore 的權威 state（simTimeSec 也取 state，不讀 wargameClock）。
 *
 * 與舊版「整包 buildStateExport 丟給 LLM」的差異：
 *   - 戰爭迷霧：敵方只列 POV 方已偵測的接觸；未分類（unknown）不透露艦型 / 血量
 *   - 精簡：一單位一列、座標 3 位小數，prompt 從 ~45 KB 降到數 KB
 *   - 先算好戰術事實：每個己方單位射程內可打的已分類目標、最近威脅距離方位、可移動範圍
 *   - 任務目標：勝利條件（含座標、半徑、佔領進度）與剩餘時間
 *   - 要求輸出 assessment（局勢 / 威脅 / 機會 / 意圖）+ 每條指令 reason
 *   - 記憶：上回合意圖、被拒原因回灌，讓 LLM 自我修正
 */
import { scenarioStore } from "../scenarioStore";
import { UNIT_CATALOG } from "../catalog/units";
import { loadoutOf } from "../catalog/weapons";
import { describeProfile } from "../sim/targetPriority";
import { haversineKm, bearingDeg } from "../sim/geo";
import { formatTPlus } from "../clock";
import type { LngLat, SideId, Unit } from "../types";
import type { LlmCommandResult } from "./schema";

/** 偵測狀態排序：≥ classified 才能開火 */
const DET_RANK: Record<string, number> = { hidden: 0, unknown: 1, classified: 2, tracked: 3 };

export interface AdversaryAssessment {
  situation: string;
  threats: string[];
  opportunities: string[];
  intent: string;
}

/** 跨回合記憶（由呼叫端保存，下回合傳回） */
export interface AdversaryMemory {
  simSec: number;
  intent?: string;
  /** 上回合被拒的指令與原因（去重） */
  rejections?: string[];
  /** 上回合下達的指令摘要 */
  orders?: string[];
}

export interface AdversaryTurn {
  assessment: AdversaryAssessment | null;
  /** 每條指令的理由（與 commands 同序；沒給為空字串） */
  reasons: string[];
  /** 原始 commands document（交給 applyLlmCommands） */
  doc: unknown;
}

const r3 = (n: number) => Math.round(n * 1000) / 1000;
const pos = (u: Unit): LngLat => [u.position.lng, u.position.lat];

function mobility(u: Unit): string {
  const cat = UNIT_CATALOG[u.kind];
  if (u.core.speedKnots <= 0) return "static";
  if (cat.domain === "air") return "air";
  if (cat.domain === "subsurface") return "sub(sea only)";
  const forbid = cat.constraints.forbidDomains ?? [];
  // terrain 只有台灣本島多邊形算陸地 → 本島外的陸上單位實際上無法機動
  if (forbid.includes("sea")) {
    const onIsland = u.position.lng > 120 && u.position.lng < 122.1 && u.position.lat > 21.8 && u.position.lat < 25.4;
    return onIsland ? "land(within Taiwan island)" : "fixed(cannot relocate; fire from here)";
  }
  if (forbid.includes("land")) return "sea";
  return "any";
}

/** 進攻武器（targetDomains 非空），攔截彈不列 */
function weaponsOf(u: Unit) {
  return loadoutOf(u)
    .filter((w) => w.spec.targetDomains.length > 0)
    .map((w) => ({ w: w.spec.name, km: Math.round(w.rangeKm), ammo: w.mag.ammoCurrent, vs: w.spec.targetDomains.join("/"), ...(w.mag.ammoCurrent <= 0 ? { empty: true } : {}) }));
}

/** 單位對某目標可用的最大射程（依目標 domain；沒有 loadout 則用 core.rangeKm） */
function rangeAgainst(u: Unit, target: Unit): number {
  const dom = UNIT_CATALOG[target.kind].domain;
  const ws = loadoutOf(u).filter((w) => w.mag.ammoCurrent > 0 && w.spec.targetDomains.includes(dom));
  if (ws.length === 0) return u.weapons ? 0 : u.core.rangeKm;
  return Math.max(...ws.map((w) => w.rangeKm));
}

export function buildAdversaryBrief(sideId: SideId) {
  const state = scenarioStore.getState();
  const sc = state.scenario;
  const me = sc.sides.find((s) => s.id === sideId);
  const hostile = new Set(me?.isHostileTo ?? []);
  const now = state.simTimeSec;
  const all = Object.values(state.units);
  const own = all.filter((u) => u.sideId === sideId && u.hpCurrent > 0);

  const contacts = all.filter((u) => {
    if (u.sideId === sideId || u.hpCurrent <= 0 || !hostile.has(u.sideId)) return false;
    return (DET_RANK[u.detectedBy[sideId] ?? "hidden"] ?? 0) >= 1;
  });
  const det = (u: Unit) => u.detectedBy[sideId] ?? "hidden";
  const firable = contacts.filter((c) => (DET_RANK[det(c)] ?? 0) >= 2);

  const ownRows = own.map((u) => {
    const p = pos(u);
    const inRange = firable
      .map((c) => ({ c, d: haversineKm(p, pos(c)), r: rangeAgainst(u, c) }))
      .filter((x) => x.r > 0 && x.d <= x.r)
      .sort((a, b) => a.d - b.d)
      .slice(0, 4)
      .map((x) => `${x.c.id}@${Math.round(x.d)}km`);
    // 哪些已分類敵人的射程涵蓋我（敵方 loadout 依艦型推估 —— 已分類即知道是什麼載台）
    const threatenedBy = firable
      .map((c) => ({ c, d: haversineKm(p, pos(c)), r: rangeAgainst(c, u) }))
      .filter((x) => x.r > 0 && x.d <= x.r)
      .sort((a, b) => a.d - b.d)
      .slice(0, 4)
      .map((x) => `${x.c.id}(${Math.round(x.r)}km range)@${Math.round(x.d)}km`);
    let nearest: { id: string; km: number; brg: number } | null = null;
    for (const c of contacts) {
      const d = haversineKm(p, pos(c));
      if (!nearest || d < nearest.km) nearest = { id: c.id, km: Math.round(d), brg: Math.round(bearingDeg(p, pos(c))) };
    }
    const cat = UNIT_CATALOG[u.kind];
    return {
      id: u.id,
      kind: u.kind,
      name: cat.displayName,
      pos: [r3(p[0]), r3(p[1])],
      hp: `${Math.round((u.hpCurrent / u.core.hpMax) * 100)}%`,
      move: mobility(u),
      maxKn: u.core.speedKnots,
      fuelKm: Math.max(0, Math.round(u.core.movementRangeKm - u.distanceTravelledKm)),
      detKm: u.core.detectionRangeKm,
      weapons: weaponsOf(u),
      roe: u.roe ?? me?.roe ?? "weapons_free",
      ...(u.waypoints.length > 0 ? { movingTo: u.waypoints[u.waypoints.length - 1]!.map(r3) } : {}),
      ...(u.engagingTargetId ? { engaging: u.engagingTargetId } : {}),
      ...(inRange.length > 0 ? { canFireAt: inRange } : {}),
      ...(threatenedBy.length > 0 ? { threatenedBy } : {}),
      ...(nearest ? { nearestContact: nearest } : {}),
    };
  });

  const contactRows = contacts.map((c) => {
    const d = det(c);
    const p = pos(c);
    let near: { id: string; km: number } | null = null;
    for (const u of own) {
      const km = haversineKm(p, pos(u));
      if (!near || km < near.km) near = { id: u.id, km: Math.round(km) };
    }
    const known = (DET_RANK[d] ?? 0) >= 2;
    const reach = known ? Math.max(0, ...loadoutOf(c).filter((w) => w.spec.targetDomains.length > 0).map((w) => w.rangeKm)) : 0;
    return {
      id: c.id,
      det: d,
      kind: known ? c.kind : "unknown",
      ...(known ? { name: UNIT_CATALOG[c.kind].displayName, hp: `${Math.round((c.hpCurrent / c.core.hpMax) * 100)}%`, ...(reach > 0 ? { rangeKm: Math.round(reach) } : {}) } : {}),
      pos: [r3(p[0]), r3(p[1])],
      kn: Math.round(c.position.speedKnots),
      hdg: Math.round(c.position.headingDeg),
      ...(near ? { nearestOwn: near } : {}),
    };
  });

  const objectives = sc.victoryConditions.map((vc, i) => {
    const mine = "sideId" in vc ? vc.sideId === sideId : undefined;
    switch (vc.kind) {
      case "hold_area": {
        const entry = state.holdProgress[i];
        return {
          type: "hold_area", forSide: vc.sideId, mine, label: vc.label,
          center: [r3(vc.centerLngLat[0]), r3(vc.centerLngLat[1])], radiusKm: vc.radiusKm, holdSec: vc.forSec,
          ...(vc.requireKinds ? { requireKinds: vc.requireKinds } : {}),
          heldSec: entry != null ? Math.round(now - entry) : 0,
        };
      }
      case "destroy_unit": {
        const t = state.units[vc.unitId];
        return { type: "destroy_unit", forSide: vc.sideId, mine, label: vc.label, unitId: vc.unitId, alive: !!t && t.hpCurrent > 0 };
      }
      case "eliminate_side":
        return { type: "eliminate_side", forSide: vc.sideId, mine, label: vc.label, targetSide: vc.targetSideId };
      case "time_limit":
        return { type: "time_limit", label: vc.label ?? "time limit: side with more surviving units wins" };
      default:
        return { type: (vc as { kind: string }).kind };
    }
  });

  // 時限判定預估：time_limit 比存活單位數。敵方用「已知下限」（偵測到的）與「開局數 − 已確認擊毀」兩個數字
  const hasTimeLimit = sc.victoryConditions.some((v) => v.kind === "time_limit");
  const enemyAliveEstimate = [...hostile].reduce((n, h) => n + all.filter((u) => u.sideId === h && u.hpCurrent > 0).length, 0);
  const outlook = hasTimeLimit
    ? (own.length > enemyAliveEstimate
      ? `若現在時間到：你領先（你 ${own.length} vs 敵約 ${enemyAliveEstimate}）→ 可採保守、保存兵力`
      : `若現在時間到：你會輸（你 ${own.length} vs 敵約 ${enemyAliveEstimate}）→ 必須主動擊殺敵人才有勝算，保守等待等於輸`)
    : undefined;

  const briefing = typeof sc.briefing === "string" ? sc.briefing : sc.briefing.zh;
  const count = (side: SideId) => all.filter((u) => u.sideId === side && u.hpCurrent > 0).length;
  const initial = (side: SideId) => sc.units.filter((u) => u.sideId === side).length;

  return {
    scenario: sc.displayName,
    time: formatTPlus(now),
    remainingSec: Math.max(0, Math.round(sc.startSimTimeSec + sc.durationSec - now)),
    you: { side: sideId, name: me?.displayName ?? sideId, hostileTo: [...hostile] },
    briefing: briefing.length > 700 ? `${briefing.slice(0, 700)}…` : briefing,
    objectives,
    ...(outlook ? { outlook } : {}),
    ...(me?.targetPriority ? { targetPriority: describeProfile(me.targetPriority) } : {}),
    forces: {
      own: `${own.length}/${initial(sideId)}`,
      ...Object.fromEntries([...hostile].map((h) => [h, `${count(h)}/${initial(h)} (true count unknown to you; ${contacts.filter((c) => c.sideId === h).length} detected)`])),
    },
    ownUnits: ownRows,
    contacts: contactRows,
  };
}

const RULES_ZH = `# 你的角色
你是兵棋推演中的自主 AI 指揮官，指揮本方全部兵力。每次被呼叫時：先研判戰場，再下達指令。

# 座標與移動
- 座標一律 [lng, lat]（經度在前）。台灣本島約 lng 120.1–122.0、lat 21.9–25.3。
- ownUnits[].move 決定能去哪：
  - "sea"：只能在海上。**航點不可落在台灣本島**（本島西岸約 lng 120.1–120.6，東岸約 121.6–121.95）。
    繞過本島請走外海（西側 lng ≤ 119.9 或東側 lng ≥ 122.1）。
  - "fixed(...)"：**不能移動**（不要下 set_waypoints），只能在原地用射程打擊。
  - "land(within Taiwan island)"：只能在台灣本島陸地上移動。
  - "air" / "any"：可飛越陸海。"static"：不能移動。
- 航程：航點累計距離應 ≤ fuelKm。速度 ≤ maxKn。
- set_speed 只改速度；要讓單位去某處必須 set_waypoints（movingTo 是它目前的目的地）。

# 交戰
- 只能 engage 偵測狀態 det ≥ "classified" 的接觸；ownUnits[].canFireAt 已列出「射程內且可開火」的目標（id@距離），優先用它。
- det = "unknown" 只知道有東西，需靠近 / 偵察使其升級成 classified。
- ROE：weapons_free 會自動接戰射程內已分類敵人；weapons_hold 只打你 engage 指定的目標。
- 敵方艦艇 / SAM 會攔截來襲飛彈：單發常被攔下 → 集中多單位對同一高價值目標飽和攻擊。
- 若有 targetPriority：依其優序選目標，doNotEngage 類別不得主動攻擊。
- ownUnits[].threatenedBy：射程已涵蓋該單位的敵人（含其射程）。contacts[].rangeKm：該敵人的最大射程。
- 開火是自動的：單位射程內出現已分類敵人就會打（weapons_free）。**要得分必須把射手帶進射程**；
  停在射程外的單位對戰局沒有貢獻。engage 用來集火指定的高價值目標。
- 依 outlook 決定風險：會輸 → 積極推進、集中兵力打局部優勢（多艘同時進入同一目標射程，飽和攻擊）；
  領先 → 保存兵力、stand-off。能用較遠射程打到人時，停在對方射程外開火最好。
- 低血量（hp < 40%）或武器打光（empty）的單位撤出 threatenedBy 範圍。
- 偵察兵力（無人機）用來建立接觸：保持在敵人防空射程邊緣，不要直接飛進敵艦隊上空。
- 預設保持 weapons_free；除非刻意隱蔽，不要把 ROE 改成 weapons_hold（會讓單位不主動開火）。
- 偵察：若 contacts 很少，派無人機 / 戰機往敵方可能位置（敵方勝利條件區域、敵方基地方向）建立接觸。

# 任務
- objectives 中 mine=true 的是你的勝利條件；hold_area 要讓（requireKinds 指定的）單位進入圓心半徑內並停留 holdSec 秒。
- mine=false 是敵方勝利條件 → 阻止它（攔截、守住該區域）。
- remainingSec 是剩餘時間；time_limit 時存活單位多的一方勝。

# 輸出（只輸出一個 JSON 物件，不要 markdown）
{
  "version": "wargame-commands-v1",
  "assessment": {
    "situation": "2–4 句：雙方態勢、兵力對比、任務進度（繁體中文）",
    "threats": ["最重要的 1–3 個威脅（含單位 id）"],
    "opportunities": ["可利用的 1–3 個機會（含單位 id）"],
    "intent": "本階段作戰意圖（一句話，下回合會回饋給你）"
  },
  "commands": [
    { "kind": "set_waypoints", "unitId": "...", "waypoints": [[lng, lat], ...], "reason": "為什麼（繁中，一句）" },
    { "kind": "set_speed", "unitId": "...", "speedKnots": 20, "reason": "..." },
    { "kind": "engage", "unitId": "...", "targetUnitId": "...", "reason": "..." },
    { "kind": "hold", "unitId": "...", "reason": "..." },
    { "kind": "set_roe", "unitId": "...", "roe": "weapons_free|weapons_tight|defensive_only|weapons_hold", "reason": "..." },
    { "kind": "set_active_sonar", "unitId": "...", "on": true, "reason": "..." },
    { "kind": "set_depth", "unitId": "...", "depthM": 120, "reason": "..." },
    { "kind": "set_towed_array", "unitId": "...", "on": true, "reason": "..." },
    { "kind": "deploy_sonobuoys", "unitId": "...", "cornerA": [lng, lat], "cornerB": [lng, lat], "count": 16, "reason": "..." }
  ]
}
- 每回合 3–10 條指令，只命令 ownUnits 中的單位。已在執行合理任務（movingTo / engaging）的單位不必重複下令。
- 只能使用上列指令種類。`;

/** 指揮策略（使用者在面板選），附加在 system prompt 最後 */
export const STRATEGY_TEXT: Record<string, { label: string; hint: string; prompt: string }> = {
  balanced: { label: "均衡", hint: "依兵力對比自行判斷攻守", prompt: "依 outlook 與兵力對比自行判斷攻守。" },
  aggressive: { label: "積極進攻", hint: "主動推進、集中火力，可接受損失", prompt: "積極進攻：主動推進、集中火力擊殺敵人，可接受合理損失；不要長時間按兵不動。" },
  defensive: { label: "保守防守", hint: "保存兵力、防區外打擊、守住目標區", prompt: "保守防守：保存兵力優先，盡量 stand-off、守住己方目標區，只打有把握的目標。" },
  recon: { label: "偵察優先", hint: "先建立完整接觸圖，再擇機打擊", prompt: "偵察優先：先用無人機 / 戰機 / 雷達建立完整接觸圖，再對已分類的高價值目標集中打擊。" },
};

export function buildAdversaryPrompts(
  sideId: SideId,
  opts: { intervalSec: number; memory?: AdversaryMemory | null; lastResult?: LlmCommandResult | null; strategy?: string },
): { system: string; user: string; brief: ReturnType<typeof buildAdversaryBrief> } {
  const brief = buildAdversaryBrief(sideId);
  const mem = opts.memory;
  const memLines: string[] = [];
  if (mem) {
    memLines.push(`上回合（${formatTPlus(mem.simSec)}）你的意圖：${mem.intent ?? "（無）"}`);
    if (mem.orders?.length) memLines.push(`上回合已下達：${mem.orders.slice(0, 10).join("；")}`);
    if (mem.rejections?.length) memLines.push(`上回合被拒的指令（請修正，不要重犯）：\n- ${mem.rejections.slice(0, 8).join("\n- ")}`);
  }
  const strat = STRATEGY_TEXT[opts.strategy ?? "balanced"] ?? STRATEGY_TEXT.balanced!;
  const system = `${RULES_ZH}\n\n你指揮 side "${sideId}"（${brief.you.name}）。約每 ${opts.intervalSec} 模擬秒呼叫你一次。\n\n# 指揮官指定策略\n${strat.prompt}`;
  const user = [
    memLines.length ? `# 回合記憶\n${memLines.join("\n")}` : "",
    `# 戰場（你的視角；只含你已偵測到的敵方）\n${JSON.stringify(brief)}`,
    "輸出 JSON。",
  ].filter(Boolean).join("\n\n");
  return { system, user, brief };
}

function asStrArr(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x) => typeof x === "string").slice(0, 5);
  return typeof v === "string" && v ? [v] : [];
}

/** 解析 LLM 回應：取出 assessment 與各指令 reason；doc 原樣交給 applyLlmCommands（多餘欄位不影響） */
export function parseAdversaryResponse(parsed: unknown): AdversaryTurn {
  const o = (parsed && typeof parsed === "object" ? parsed : {}) as Record<string, unknown>;
  // 常見偏差：漏 version → 補上（其餘結構錯誤仍交給 applyLlmCommands 回報）
  if (Array.isArray(o.commands) && o.version === undefined) o.version = "wargame-commands-v1";
  const a = o.assessment as Record<string, unknown> | undefined;
  const assessment: AdversaryAssessment | null = a && typeof a === "object"
    ? {
      situation: typeof a.situation === "string" ? a.situation : "",
      threats: asStrArr(a.threats),
      opportunities: asStrArr(a.opportunities),
      intent: typeof a.intent === "string" ? a.intent : "",
    }
    : null;
  const reasons = Array.isArray(o.commands)
    ? o.commands.map((c) => (c && typeof c === "object" && typeof (c as { reason?: unknown }).reason === "string" ? (c as { reason: string }).reason : ""))
    : [];
  return { assessment, reasons, doc: o };
}

/** 一行指令摘要（記憶 / UI 用） */
export function describeCommand(c: unknown): string {
  if (!c || typeof c !== "object") return "?";
  const x = c as Record<string, unknown>;
  switch (x.kind) {
    case "set_waypoints": {
      const w = Array.isArray(x.waypoints) ? x.waypoints : [];
      const last = w[w.length - 1] as number[] | undefined;
      return `${x.unitId} 移動→${last ? `[${last.map((n) => Number(n).toFixed(2)).join(",")}]` : "?"}${w.length > 1 ? `（${w.length} 點）` : ""}`;
    }
    case "engage": return `${x.unitId} 攻擊 ${x.targetUnitId}`;
    case "set_speed": return `${x.unitId} 速度 ${x.speedKnots}kn`;
    case "hold": return `${x.unitId} 停止`;
    case "set_roe": return `${x.unitId} ROE ${x.roe}`;
    case "set_active_sonar": return `${x.unitId} 主動聲納 ${x.on ? "開" : "關"}`;
    case "set_towed_array": return `${x.unitId} 拖曳陣列 ${x.on ? "開" : "關"}`;
    case "set_depth": return `${x.unitId} 深度 ${x.depthM}m`;
    case "deploy_sonobuoys": return `${x.unitId} 佈聲標 ×${x.count}`;
    default: return `${x.unitId ?? "?"} ${String(x.kind)}`;
  }
}

/** UI 用：每條指令的摘要 / 理由 / 套用結果 */
export interface AiOrderView {
  text: string;
  reason: string;
  status: "applied" | "rejected";
  note?: string;
}

export function ordersView(turn: AdversaryTurn, result: LlmCommandResult): AiOrderView[] {
  const cmds = (turn.doc as { commands?: unknown[] }).commands ?? [];
  const byIdx = new Map(result.results.map((r) => [r.index, r]));
  const out: AiOrderView[] = cmds.map((c, i) => {
    const r = byIdx.get(i);
    const note = !r ? undefined : r.status === "rejected" ? r.reason : r.warnings?.join("；");
    return { text: describeCommand(c), reason: turn.reasons[i] ?? "", status: r?.status ?? "rejected", ...(note ? { note } : {}) };
  });
  // document 層級錯誤（index -1）
  for (const r of result.results) if (r.index < 0 && r.status === "rejected") out.push({ text: "（整份指令）", reason: "", status: "rejected", note: r.reason });
  return out;
}

/** 依本回合結果產生下回合記憶 */
export function nextMemory(turn: AdversaryTurn, result: LlmCommandResult): AdversaryMemory {
  const cmds = (turn.doc as { commands?: unknown[] }).commands ?? [];
  const rejections = result.results
    .filter((r) => r.status === "rejected")
    .map((r) => `${r.index >= 0 ? describeCommand(cmds[r.index]) : "document"}：${"reason" in r ? r.reason : ""}`);
  const orders = result.results
    .filter((r) => r.status === "applied")
    .map((r) => describeCommand(cmds[r.index]));
  return {
    simSec: scenarioStore.getState().simTimeSec,
    intent: turn.assessment?.intent,
    rejections: [...new Set(rejections)],
    orders,
  };
}
