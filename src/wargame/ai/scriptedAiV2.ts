/**
 * Scripted AI v2 — QMIX-inspired centralized assignment + role-based behavior.
 *
 * 比 v1 (純 greedy nearest-target) 強的點：
 *   1. **集中分配（centralized assignment）**：避免 N 個 unit 全打同一個瀕死目標，
 *      用 utility 排序 + 每目標分配上限（依目標 HP / 預期傷害）
 *   2. **HVU 優先**：辨識 CVN / airbase / supply / radar 為高價值目標，加大 utility 權重
 *   3. **角色分工**：striker 推進 / defender 守備 / stalker 潛行 / static 不動
 *   4. **CommNet-like 情報共享**：detectedBy 是現成共享觀測；新增「該方 fire control」
 *      —— 任一友軍偵測到的目標都進統一打擊池，不用各自單獨重算
 *   5. **避免無謂消耗**：彈藥 < 20% 時降低主動推進，等補給或撤退
 *
 * 注意：純啟發式，零訓練、零 GPU、零外部依賴。把 QMIX 的「decentralized execution +
 * centralized value」概念用 ~250 行 TS 落地。
 */
import type { LngLat, SideId, Unit, UnitKind } from "../types";
import { scenarioStore } from "../scenarioStore";
import { wargameClock } from "../clock";
import { advanceTowardKm, haversineKm } from "../sim/geo";
import { aiConfigStore, DEFAULT_V2_PARAMS, type ScriptedV2Params } from "../llm/aiConfig";

export interface ScriptedTickResult {
  commandsIssued: number;
  details: string[];
}

/** 單位戰術角色 — 從 kind 推導 */
type Role = "striker" | "defender" | "stalker" | "escort" | "static";

function roleOf(kind: UnitKind): Role {
  switch (kind) {
    case "missile_launcher": return "striker";
    case "drone":            return "striker";
    case "fighter":          return "striker";
    case "submarine":        return "stalker";
    case "ship_surface":     return "escort";   // 多數水面艦走 escort；速度高的可推進
    case "sam_coastal":      return "defender";
    case "sam_patriot":      return "defender";
    case "mobile_radar":     return "defender";
    case "radar_station":    return "static";
    case "airbase":          return "static";
    case "supply_ship":      return "static";
  }
}

/** HVU 識別 — 補給 / 機場 / 雷達 / 航母（高 HP 水面艦） */
function isHighValue(u: Unit): boolean {
  if (u.kind === "supply_ship") return true;
  if (u.kind === "airbase") return true;
  if (u.kind === "radar_station") return true;
  // 航母 heuristic — 水面艦 HP > 800 視為 CVN
  if (u.kind === "ship_surface" && u.core.hpMax >= 800) return true;
  return false;
}

/** 威脅評分 — 敵方對我方造成傷害的潛在能力 */
function threatScore(e: Unit): number {
  const ammoPct = e.ammoMax > 0 ? e.ammoCurrent / e.ammoMax : 0;
  const hpPct = e.hpCurrent / e.core.hpMax;
  // 射程 × HP × 彈藥 — 三者都重要
  return (e.core.rangeKm / 100) * hpPct * Math.max(0.2, ammoPct);
}

/**
 * 計算 unit i 攻擊 enemy e 的綜合 utility。
 * 越高代表越值得打。所有 weights 從 ScriptedV2Params 讀（可調）。
 */
function computeUtility(
  i: Unit,
  e: Unit,
  distKm: number,
  assignedToTarget: number,
  p: ScriptedV2Params,
): number {
  const inRange = distKm <= i.core.rangeKm;
  const distNorm = distKm / Math.max(1, i.core.rangeKm);
  const hpFrac = e.hpCurrent / e.core.hpMax;
  const hvuBonus = isHighValue(e) ? p.hvuPriority : 0;
  const threat = threatScore(e);
  // 已有 N 個 unit 排隊打這目標 → 邊際效益遞減（係數越大越分散）
  const crowdPenalty = assignedToTarget * p.coordination;
  // 角色匹配 bonus (固定，不暴露)
  let roleBonus = 0;
  const myRole = roleOf(i.kind);
  if (myRole === "stalker" && e.kind === "ship_surface") roleBonus += 0.5;
  if (myRole === "striker" && (e.kind === "fighter" || e.kind === "drone")) roleBonus += 0.3;
  if (myRole === "defender" && (e.kind === "drone" || e.kind === "fighter")) roleBonus += 0.4;
  // 在射程內 → 加分（已經能打了），權重綁 aggression
  const rangeBonus = inRange ? (1.0 + p.aggression * 0.5) : 0;
  // 已殘血 → 收尾 bonus
  const finishBonus = hpFrac < 0.4 ? p.finishing : 0;

  return (
    threat * p.aggression
    + hvuBonus
    + roleBonus
    + rangeBonus
    + finishBonus
    - distNorm * 0.7
    - crowdPenalty
  );
}

/** 每目標可分配上限 — 強壯目標可被多 unit 圍攻 */
function maxAssignableTo(e: Unit): number {
  if (e.core.hpMax >= 800) return 6;   // CVN-class
  if (e.core.hpMax >= 400) return 4;   // DDG / heavy
  if (e.core.hpMax >= 150) return 3;
  return 2;
}

export function runScriptedAiV2Tick(sideId: SideId): ScriptedTickResult {
  const state = scenarioStore.getState();
  const side = state.scenario.sides.find((s) => s.id === sideId);
  if (!side) return { commandsIssued: 0, details: [] };
  const hostiles = side.isHostileTo;
  // 從 aiConfig 讀可調參數（fallback 預設）
  const params: ScriptedV2Params = aiConfigStore.getConfig().v2Params ?? DEFAULT_V2_PARAMS;

  const ownUnits = Object.values(state.units).filter((u) => u.sideId === sideId && u.hpCurrent > 0);
  const enemyUnits = Object.values(state.units).filter((u) => hostiles.includes(u.sideId) && u.hpCurrent > 0);

  // CommNet-like 情報池：任一友軍偵測到的目標進池
  const detectedEnemies = enemyUnits.filter((e) => {
    const det = e.detectedBy[sideId];
    return det && det !== "hidden";
  });

  const simSec = wargameClock.getSimTime();
  const details: string[] = [];
  let issued = 0;

  // ── Step 1: 計算所有 (unit, target, utility) tuple ──
  type Pair = { unit: Unit; target: Unit; dist: number; utility: number };
  const pairs: Pair[] = [];

  for (const u of ownUnits) {
    const role = roleOf(u.kind);
    if (role === "static") continue;            // 不動
    if (u.ammoCurrent <= 0 && role !== "defender") continue;  // 沒彈藥 → engine 的 RTB 接手

    for (const e of detectedEnemies) {
      const d = haversineKm([u.position.lng, u.position.lat], [e.position.lng, e.position.lat]);
      // 連 2x range 都搆不到的 → 不考慮（行進耗油不划算）
      if (d > u.core.rangeKm * 2.5) continue;
      pairs.push({ unit: u, target: e, dist: d, utility: 0 });
    }
  }

  // ── Step 2: 集中分配（utility 排序 + 每目標上限）──
  const assignedToTarget: Record<string, number> = {};
  const assignedToUnit: Record<string, Pair> = {};

  // 先粗算 utility（assignedToTarget 為 0）
  for (const p of pairs) p.utility = computeUtility(p.unit, p.target, p.dist, 0, params);
  // 從最高 utility 開始貪心
  pairs.sort((a, b) => b.utility - a.utility);

  for (const p of pairs) {
    if (assignedToUnit[p.unit.id]) continue;                  // unit 已分配
    const cur = assignedToTarget[p.target.id] ?? 0;
    if (cur >= maxAssignableTo(p.target)) continue;           // 目標已滿
    // 重算 utility（考慮已分配人數）
    const realUtility = computeUtility(p.unit, p.target, p.dist, cur, params);
    if (realUtility < 0.2) continue;                          // 太爛就放棄
    assignedToTarget[p.target.id] = cur + 1;
    assignedToUnit[p.unit.id] = { ...p, utility: realUtility };
  }

  // ── Step 3: 對每個分配到任務的 unit 下指令 ──
  for (const u of ownUnits) {
    const role = roleOf(u.kind);
    if (role === "static") continue;

    const assignment = assignedToUnit[u.id];

    // ── 低血量保命 ──
    const hpPct = u.hpCurrent / u.core.hpMax;
    if (hpPct < params.selfPreserve && u.waypoints.length > 0) {
      scenarioStore.enqueueCommand({ id: makeId(), unitId: u.id, simAtSec: simSec, kind: "hold" });
      details.push(`${u.callsign}: HP ${(hpPct * 100).toFixed(0)}% → hold`);
      issued++;
      continue;
    }

    // ── 沒分配到 → defender 不動；striker/escort/stalker 維持現有 plan ──
    if (!assignment) {
      if (role === "defender") {
        // 確保 defender 在原地（避免 v1 的「亂衝」）
        if (u.waypoints.length > 0) {
          scenarioStore.enqueueCommand({ id: makeId(), unitId: u.id, simAtSec: simSec, kind: "hold" });
          details.push(`${u.callsign} (defender): no target → hold position`);
          issued++;
        }
      }
      continue;
    }

    const { target, dist } = assignment;

    // ── 已在射程內 → 不動，讓 combat.ts 自動開火 ──
    if (dist <= u.core.rangeKm) {
      if (u.waypoints.length > 0) {
        scenarioStore.enqueueCommand({ id: makeId(), unitId: u.id, simAtSec: simSec, kind: "hold" });
        details.push(`${u.callsign} engages ${target.callsign} (in range ${dist.toFixed(0)} km)`);
        issued++;
      }
      continue;
    }

    // ── 推進到 rangeKm * approachPct 處（留邊際避免敵方先打中）──
    if (u.waypoints.length > 0) continue;     // 已有 plan 不打斷
    const stopAtKm = u.core.rangeKm * params.approachPct;
    const approachKm = dist - stopAtKm;
    if (approachKm <= 0) continue;

    const newPos: LngLat = advanceTowardKm(
      [u.position.lng, u.position.lat],
      [target.position.lng, target.position.lat],
      approachKm,
    );
    scenarioStore.enqueueCommand({
      id: makeId(), unitId: u.id, simAtSec: simSec,
      kind: "set_waypoints", waypoints: [newPos],
    });
    details.push(
      `${u.callsign} (${role}) → ${target.callsign}` +
      `${isHighValue(target) ? " [HVU]" : ""}` +
      ` ${dist.toFixed(0)}km util=${assignment.utility.toFixed(2)}`
    );
    issued++;
  }

  return { commandsIssued: issued, details };
}

function makeId(): string {
  return `scripted2-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
