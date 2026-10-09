/**
 * 資產面板 · 偵察計畫分頁。
 *
 * 關注區（AOI）沿用搜索規劃器的搜索區（同一套地圖繪製）。顯示：
 *   - 現有感測器對關注區的覆蓋率（盲區畫在地圖上，見 map/wargameReconLayer.ts）
 *   - 偵察資產派遣建議（貪心組合到目標 POD）→ 一鍵套用：用搜索規劃器產生航線並下令
 *   - 尚未確認追蹤的高優先接觸 → 建議最近的偵察資產前往盯住
 * 指令一律走 commandBus（多人時 client 送 host）。
 */
import { useMemo, useState, useSyncExternalStore } from "react";
import { Hexagon, Send, Eye, ScanSearch } from "lucide-react";
import type { LngLat, SideId, Unit } from "../../wargame/types";
import { scenarioStore } from "../../wargame/scenarioStore";
import { searchPlannerStore } from "../../wargame/search/searchPlannerStore";
import { submitCommand } from "../../wargame/net/commandBus";
import { UNIT_CATALOG } from "../../wargame/catalog/units";
import {
  aoiFromSearchArea, aoiThreats, computeCoverage, reconOptions, suggestTasking, trackingTasks,
} from "../../wargame/recon/reconPlanner";
import { suggestAois } from "../../wargame/recon/aoiSuggest";

const TEXT = {
  zh: {
    aoi: "關注區", aoiNone: "尚未設定 —— 在地圖上畫出要偵察的海域（與搜索區共用）",
    aoiFrom: "沿用搜索區", draw: "在地圖上繪製關注區", redraw: "重畫",
    coverage: "現有覆蓋", gaps: "盲區", cells: "格（地圖紅色）", sensors: "具感測器",
    coverageNote: "以各單位偵測距離與對海面目標的雷達地平線估算；未計地形遮蔽與水下目標。",
    tasking: "派遣建議", targetPod: "目標 POD", includeBusy: "可改派執行中的資產",
    noAssets: "本方沒有可用的偵察資產（無人機 / 戰機 / 反潛直升機）",
    noIdle: "閒置資產不足 —— 勾選「可改派執行中的資產」查看更多選項",
    transit: "進場", onStation: "在站", pod: "POD", busy: "執行中", infeasible: "航程不足",
    combined: "合計 POD", apply: "套用派遣（產生搜索航線並下令）",
    applied: (n: number) => `已對 ${n} 架下令搜索航線`,
    track: "待確認接觸", trackNone: "沒有需要盯住的高優先接觸",
    trackNote: "尚未「確認追蹤」的高優先接觸 —— 派偵察資產前往，升級後 weapons_tight 的射手才能開火。",
    send: "派遣", sendAll: "全部派遣", noAsset: "無可用資產",
    sent: (n: number) => `已派遣 ${n} 架前往盯住`,
    states: { unknown: "未知", classified: "已分類" } as Record<string, string>,
    readOnly: "多人對戰中只能指揮自己的陣營",
    suggest: "建議關注區（依攻擊優序）", suggestNone: "目前沒有依據：尚未偵測到高優先類別的敵方，且敵方目標區不涉及高優先類別",
    suggestNote: "依已偵測的高優先接觸（含 1 小時推算航跡）、場景公開的敵方目標區與兩者間的航經走廊推估；地圖紫色虛線預覽。",
    use: "設為關注區", current: "使用中",
    threatWarn: (n: number) => `⚠ 關注區在 ${n} 個已知敵方空中威脅（防空 / 戰機 / 艦艇）射程內 —— 派遣的偵察資產可能被擊落`,
    threatened: "受威脅",
    model: "掃掠寬 = 2 × 偵測距離 × 0.5；POD 以隨機搜索公式估算（保守）",
  },
  en: {
    aoi: "Area of interest", aoiNone: "Not set — draw the sea area to reconnoitre (shared with the search area)",
    aoiFrom: "uses the search area", draw: "Draw area of interest", redraw: "Redraw",
    coverage: "Current coverage", gaps: "Blind spots", cells: "cells (red on map)", sensors: "sensors",
    coverageNote: "Estimated from each unit's detection range and radar horizon against surface targets; terrain masking and subsurface targets are not included.",
    tasking: "Tasking", targetPod: "Target POD", includeBusy: "Allow re-tasking busy assets",
    noAssets: "No recon assets available (UAVs / fighters / ASW helicopters)",
    noIdle: "Not enough idle assets — tick “allow re-tasking busy assets” for more options",
    transit: "Transit", onStation: "On station", pod: "POD", busy: "busy", infeasible: "out of range",
    combined: "Combined POD", apply: "Apply tasking (generate search tracks and order)",
    applied: (n: number) => `Ordered search tracks for ${n} aircraft`,
    track: "Contacts to confirm", trackNone: "No high-priority contacts need tracking",
    trackNote: "High-priority contacts not yet tracked — send a recon asset so weapons_tight shooters can engage.",
    send: "Send", sendAll: "Send all", noAsset: "no asset",
    sent: (n: number) => `Sent ${n} aircraft to track`,
    states: { unknown: "unknown", classified: "classified" } as Record<string, string>,
    readOnly: "In multiplayer you can only command your own side",
    suggest: "Suggested areas (from target priorities)", suggestNone: "Nothing to go on: no high-priority enemy detected and no enemy objective involves a high-priority category",
    suggestNote: "Inferred from detected high-priority contacts (with 1 h dead-reckoning), the scenario's public enemy objectives and the transit corridors between them; previewed as purple dashed outlines.",
    use: "Use as area", current: "in use",
    threatWarn: (n: number) => `⚠ The area is inside the range of ${n} known enemy air threats (SAMs / fighters / warships) — tasked recon assets may be shot down`,
    threatened: "threatened",
    model: "Sweep width = 2 × detection range × 0.5; POD from the random-search formula (conservative)",
  },
} as const;

const fmtHr = (h: number) => (h < 1 ? `${Math.round(h * 60)}m` : `${h.toFixed(1)}h`);

export function ReconTab({ sideId, lang, canCommand }: { sideId: SideId; lang: "zh" | "en"; canCommand: boolean }) {
  useSyncExternalStore(searchPlannerStore.subscribe, searchPlannerStore.getVersion, searchPlannerStore.getVersion);
  const t = TEXT[lang];
  const [targetPod, setTargetPod] = useState(0.9);
  const [includeBusy, setIncludeBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const state = scenarioStore.getState();
  const { a, b } = searchPlannerStore.getCorners();
  const aoi = aoiFromSearchArea(searchPlannerStore.getPolygon(), a, b);
  const side = state.scenario.sides.find((s) => s.id === sideId);

  // 單位位置每 tick 都變；每 30 模擬秒（或關注區 / 陣營 / 選項變動）才重算
  const bucket = Math.floor(state.simTimeSec / 30);
  const aoiKey = JSON.stringify(aoi);
  const result = useMemo(() => {
    if (!aoi || !side) return null;
    const units = Object.values(scenarioStore.getState().units);
    const own = units.filter((u) => u.sideId === sideId);
    const enemies = units.filter((u) => side.isHostileTo.includes(u.sideId));
    const coverage = computeCoverage(aoi, own);
    const options = reconOptions(aoi, own, { sideId, enemies });
    const threats = aoiThreats(sideId, aoi, enemies);
    const plan = suggestTasking(options, targetPod, includeBusy);
    const tasks = trackingTasks(sideId, enemies, own, side.targetPriority, 4, new Set(plan.chosen.map((o) => o.unitId)), includeBusy);
    return { coverage, options, plan, tasks, threats };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [aoiKey, sideId, bucket, targetPod, includeBusy, side?.targetPriority]);

  const send = (unitId: string, waypoints: LngLat[]) => submitCommand({
    id: `cmd-recon-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    unitId, simAtSec: state.simTimeSec, kind: "set_waypoints", waypoints,
  }).ok;

  const applyTasking = () => {
    if (!result || result.plan.chosen.length === 0) return;
    const units = scenarioStore.getState().units;
    const chosen = result.plan.chosen.filter((o) => units[o.unitId]);
    const speed = Math.min(...chosen.map((o) => (units[o.unitId] as Unit).core.speedKnots));
    // 用搜索規劃器的引擎產生航線（平行航跡沿關注區主軸、依架數分段）
    searchPlannerStore.patch({ direction: "given_assets", droneCount: chosen.length, speedKn: speed });
    const tracks = searchPlannerStore.generateTracks();
    let n = 0;
    chosen.forEach((o, i) => {
      const tr = tracks[i % Math.max(1, tracks.length)];
      if (tr && tr.waypoints.length > 0 && send(o.unitId, tr.waypoints)) n++;
    });
    setNotice(t.applied(n));
  };

  const dispatch = (list: { assetId: string | null; contactPos: LngLat }[]) => {
    let n = 0;
    for (const x of list) if (x.assetId && send(x.assetId, [x.contactPos])) n++;
    setNotice(t.sent(n));
  };

  const suggestions = useMemo(() => {
    if (!side) return [];
    return suggestAois(sideId, scenarioStore.getState().scenario, Object.values(scenarioStore.getState().units), side.targetPriority);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sideId, bucket, side?.targetPriority]);
  const useSuggestion = (poly: LngLat[]) => {
    const issue = searchPlannerStore.setPolygon(poly);
    if (!issue) setNotice(null);
  };

  const drawAoi = () => {
    searchPlannerStore.setOpen(true);
    searchPlannerStore.startPickArea();
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {!canCommand && <div style={warn}>{t.readOnly}</div>}

      {/* 建議關注區 */}
      <Section title={t.suggest}>
        <div style={note}>{t.suggestNote}</div>
        {suggestions.length === 0 ? (
          <div style={{ fontSize: 12, color: "#94a3b8" }}>{t.suggestNone}</div>
        ) : suggestions.map((g) => {
          const inUse = aoiKey === JSON.stringify(g.polygon);
          return (
            <div key={g.id} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
              <span style={{
                flexShrink: 0, width: 34, textAlign: "right", fontFamily: "ui-monospace, monospace", color: "#c4b5fd",
              }}>{g.score.toFixed(0)}</span>
              <span style={{ flex: 1, minWidth: 0, color: "#e2e8f0", lineHeight: 1.4 }}>{lang === "en" ? g.labelEn : g.labelZh}</span>
              <button className="wg-btn" style={{ ...chip, padding: "2px 8px", flexShrink: 0, ...(inUse ? { borderColor: "#a78bfa", color: "#ddd6fe" } : {}) }}
                disabled={inUse} onClick={() => useSuggestion(g.polygon)}>{inUse ? t.current : t.use}</button>
            </div>
          );
        })}
      </Section>

      {/* 關注區 */}
      <Section title={t.aoi}>
        {aoi && result ? (
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
            <span style={{ color: "#cbd5e1" }}>
              {t.aoiFrom} · {Math.round(result.coverage.areaKm2).toLocaleString()} km²
            </span>
            <span style={{ flex: 1 }} />
            <button className="wg-btn" style={chip} onClick={drawAoi}><Hexagon size={12} /> {t.redraw}</button>
          </div>
        ) : (
          <>
            <div style={{ fontSize: 13, color: "#94a3b8" }}>{t.aoiNone}</div>
            <button className="wg-btn" style={primary} onClick={drawAoi}><Hexagon size={13} /> {t.draw}</button>
          </>
        )}
      </Section>

      {result && (
        <>
          {/* 覆蓋 */}
          <Section title={t.coverage}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 10 }}>
              <span style={{
                fontSize: 24, fontWeight: 800, fontFamily: "ui-monospace, monospace",
                color: result.coverage.coveredFraction >= 0.9 ? "#4ade80" : result.coverage.coveredFraction >= 0.5 ? "#facc15" : "#f87171",
              }}>
                {Math.round(result.coverage.coveredFraction * 100)}%
              </span>
              <span style={{ fontSize: 12, color: "#94a3b8" }}>
                {result.coverage.sensorsUsed} {t.sensors} · {t.gaps} {result.coverage.gapCells.length} {t.cells}
              </span>
            </div>
            <div style={note}>{t.coverageNote}</div>
          </Section>

          {/* 派遣建議 */}
          <Section title={t.tasking}>
            {result.threats.length > 0 && <div style={warn}>{t.threatWarn(result.threats.length)}</div>}
            <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13 }}>
              <span style={{ color: "#94a3b8", width: 64 }}>{t.targetPod}</span>
              <input type="range" min={0.5} max={0.99} step={0.01} value={targetPod}
                onChange={(e) => setTargetPod(Number(e.target.value))} style={{ flex: 1, accentColor: "#38bdf8" }} />
              <span style={{ fontFamily: "ui-monospace, monospace", width: 36, textAlign: "right" }}>{Math.round(targetPod * 100)}%</span>
            </div>
            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#cbd5e1", cursor: "pointer" }}>
              <input type="checkbox" checked={includeBusy} onChange={(e) => setIncludeBusy(e.target.checked)} />
              {t.includeBusy}
            </label>
            {result.options.length === 0 ? (
              <div style={warn}>{t.noAssets}</div>
            ) : (
              <>
                <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                  {result.options.slice(0, 8).map((o) => {
                    const picked = result.plan.chosen.some((c) => c.unitId === o.unitId);
                    return (
                      <div key={o.unitId} style={{
                        display: "grid", gridTemplateColumns: "1fr 48px 48px 44px", gap: 6, alignItems: "center",
                        padding: "3px 6px", borderRadius: 4, fontSize: 12,
                        background: picked ? "rgba(56,189,248,0.15)" : "transparent",
                        border: `1px solid ${picked ? "rgba(56,189,248,0.5)" : "transparent"}`,
                        opacity: !o.feasible || (o.busy && !includeBusy) ? 0.5 : 1,
                      }}>
                        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                          {picked ? "✓ " : ""}{o.callsign}
                          <span style={{ color: "#64748b" }}> · {UNIT_CATALOG[o.kind].displayName}</span>
                          {o.busy && <span style={{ color: "#fbbf24" }}> · {t.busy}</span>}
                          {!o.feasible && <span style={{ color: "#f87171" }}> · {t.infeasible}</span>}
                          {o.threats > 0 && <span style={{ color: "#f87171" }}> · ⚠ {t.threatened} {o.threats}</span>}
                        </span>
                        <span title={t.transit} style={mono}>{fmtHr(o.transitHr)}</span>
                        <span title={t.onStation} style={mono}>{o.feasible ? fmtHr(o.onStationHr) : "—"}</span>
                        <span title={t.pod} style={{ ...mono, color: "#e2e8f0" }}>{Math.round(o.pod * 100)}%</span>
                      </div>
                    );
                  })}
                </div>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 48px 48px 44px", gap: 6, fontSize: 11, color: "#64748b", padding: "0 6px" }}>
                  <span /><span>{t.transit}</span><span>{t.onStation}</span><span>{t.pod}</span>
                </div>
                {result.plan.chosen.length === 0 ? (
                  <div style={warn}>{t.noIdle}</div>
                ) : (
                  <>
                    <div style={{ fontSize: 13 }}>
                      {t.combined}: <b style={{ color: result.plan.combinedPod >= targetPod ? "#4ade80" : "#facc15" }}>
                        {Math.round(result.plan.combinedPod * 100)}%</b>
                    </div>
                    <button className="wg-btn" style={primary} disabled={!canCommand} onClick={applyTasking}>
                      <Send size={13} /> {t.apply}
                    </button>
                  </>
                )}
                <div style={note}>{t.model}</div>
              </>
            )}
          </Section>
        </>
      )}

      {/* 待確認接觸（不需要關注區） */}
      {(() => {
        const units = Object.values(state.units);
        const tasks = result?.tasks ?? (side ? trackingTasks(
          sideId,
          units.filter((u) => side.isHostileTo.includes(u.sideId)),
          units.filter((u) => u.sideId === sideId),
          side.targetPriority, 4, new Set(), includeBusy,
        ) : []);
        return (
          <Section title={t.track}>
            <div style={note}>{t.trackNote}</div>
            {tasks.length === 0 ? (
              <div style={{ fontSize: 13, color: "#94a3b8" }}>{t.trackNone}</div>
            ) : (
              <>
                {tasks.slice(0, 8).map((x) => (
                  <div key={x.contactId} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12 }}>
                    <Eye size={12} color="#fca5a5" />
                    <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                      {UNIT_CATALOG[x.contactKind].displayName}
                      <span style={{ color: "#64748b" }}> · {t.states[x.state]} · {x.weight}</span>
                    </span>
                    <span style={{ color: "#94a3b8", whiteSpace: "nowrap" }}>
                      {x.assetCallsign ? `${x.assetCallsign} · ${fmtHr(x.etaHr ?? 0)}` : t.noAsset}
                    </span>
                    <button className="wg-btn" style={{ ...chip, padding: "2px 7px" }}
                      disabled={!x.assetId || !canCommand} onClick={() => dispatch([x])}>{t.send}</button>
                  </div>
                ))}
                {tasks.filter((x) => x.assetId).length > 1 && canCommand && (
                  <button className="wg-btn" style={{ ...chip, alignSelf: "flex-start" }} onClick={() => dispatch(tasks)}>
                    <ScanSearch size={12} /> {t.sendAll}
                  </button>
                )}
              </>
            )}
          </Section>
        );
      })()}

      {notice && <div style={{ fontSize: 13, color: "#86efac" }}>{notice}</div>}
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5, paddingTop: 6, borderTop: "1px solid rgba(148,163,184,0.15)" }}>
      <div style={{ fontSize: 13, fontWeight: 700, color: "#cbd5e1" }}>{title}</div>
      {children}
    </div>
  );
}

const mono: React.CSSProperties = { fontFamily: "ui-monospace, monospace", color: "#94a3b8", textAlign: "right" };
const note: React.CSSProperties = { fontSize: 11, color: "#64748b", lineHeight: 1.5 };
const chip: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 4,
  padding: "3px 9px", borderRadius: 12, fontSize: 12, cursor: "pointer", fontFamily: "inherit",
  background: "rgba(30,41,59,0.6)", color: "#e2e8f0", border: "1px solid rgba(148,163,184,0.3)",
};
const primary: React.CSSProperties = {
  display: "flex", alignItems: "center", justifyContent: "center", gap: 6,
  padding: "7px 10px", borderRadius: 6, fontSize: 13, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
  background: "rgba(56,189,248,0.2)", color: "#e0f2fe", border: "1px solid rgba(56,189,248,0.55)",
};
const warn: React.CSSProperties = {
  fontSize: 12, color: "#fed7aa", padding: "5px 8px", borderRadius: 4,
  background: "rgba(251,146,60,0.1)", border: "1px solid rgba(251,146,60,0.3)",
};
