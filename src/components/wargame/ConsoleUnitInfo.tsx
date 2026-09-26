/**
 * 桌面底部控制台中欄：選中單位資訊（星海式 wireframe 區）。
 *
 * - 未選：操作提示
 * - 己方：狀態條 + 數值 + 航線摘要；潛艦多一列深度控制
 * - 敵方：偵測狀態 + 定位品質
 * - 規劃航線 / 佈聲標模式：換成對應提示與驗證結果
 * - 「屬性」鈕（單人）：在控制台上方彈出 5 個屬性 slider
 */
import { useState, useSyncExternalStore } from "react";
import { SlidersHorizontal, X, MousePointerClick, Trash2 } from "lucide-react";
import type { RoeMode } from "../../wargame/types";
import { scenarioStore } from "../../wargame/scenarioStore";
import { viewStore } from "../../wargame/viewStore";
import { editorStore } from "../../wargame/editor/editorStore";
import { wargameClock } from "../../wargame/clock";
import { UNIT_CATALOG, CORE_ATTRIBUTE_LABELS, CORE_ATTRIBUTE_LABELS_EN, UNIT_KIND_DISPLAY_EN } from "../../wargame/catalog/units";
import { submitCommand } from "../../wargame/net/commandBus";
import { netStore } from "../../wargame/net/netStore";
import { validatePlan } from "../../wargame/sim/validate";
import { planSonobuoyField } from "../../wargame/sim/sonobuoyField";
import { SUB_MAX_DEPTH_M } from "../../wargame/sim/sonar";
import { t, useLang } from "../../wargame/i18n/lang";
import {
  getSnapshot, subscribe, usePlanningHotkeys, StatusBar, formatEta, CORE_KEYS,
  CONTACT_LABEL, CONTACT_QUALITY_LABEL, CONTACT_QUALITY_COLOR,
} from "../UnitEditorPanel";

const ROE_SHORT: Record<RoeMode, { label: string; color: string }> = {
  weapons_free: { label: "自由接戰", color: "#fca5a5" },
  weapons_tight: { label: "限制接戰", color: "#fcd34d" },
  defensive_only: { label: "僅防禦", color: "#86efac" },
  weapons_hold: { label: "停止接戰", color: "#94a3b8" },
};

const muted = "#94a3b8";

export function ConsoleUnitInfo() {
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const lang = useLang();
  const [attrOpen, setAttrOpen] = useState(false);

  const mode = editorStore.getMode();
  usePlanningHotkeys(mode);

  const planningId = editorStore.getPlanningUnitId();
  const buoy = editorStore.getSonobuoyDraft();
  const followId = mode === "planRoute" ? planningId : mode === "defineSonobuoyArea" ? buoy.unitId : null;
  const unit = followId ? scenarioStore.getState().units[followId] ?? null : scenarioStore.getSelectedUnit();

  if (!unit) return <EmptyHint />;

  const cat = UNIT_CATALOG[unit.kind];
  const side = scenarioStore.getState().scenario.sides.find((s) => s.id === unit.sideId);
  const sideColor = side?.colorPrimary ?? "#888";
  const pov = viewStore.getActiveSideId();
  const isOwn = (pov == null || unit.sideId === pov) && netStore.canControlSide(unit.sideId);
  const roe: RoeMode = unit.roe ?? side?.roe ?? "weapons_free";
  const isPlanning = mode === "planRoute" && planningId === unit.id;
  const isBuoy = mode === "defineSonobuoyArea" && buoy.unitId === unit.id;
  const route = isPlanning ? editorStore.getPendingWaypoints() : unit.waypoints;
  const v = validatePlan(unit, route, { currentSimSec: wargameClock.getSimTime() });
  const canEditAttrs = !netStore.isMultiplayer() && isOwn;
  const LABELS = lang === "en" ? CORE_ATTRIBUTE_LABELS_EN : CORE_ATTRIBUTE_LABELS;

  return (
    <div style={{ position: "relative", height: "100%", display: "flex", flexDirection: "column", gap: 8, minWidth: 0 }}>
      {/* 標題列 */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, minWidth: 0 }}>
        <span style={{ width: 12, height: 12, borderRadius: "50%", background: sideColor, flexShrink: 0 }} />
        <span style={{ fontSize: 20, fontWeight: 800, whiteSpace: "nowrap" }}>{unit.callsign}</span>
        <span style={{ fontSize: 14, color: muted, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis", minWidth: 0 }}>
          {lang === "en" ? `${unit.displayName} / ${UNIT_KIND_DISPLAY_EN[unit.kind]}` : unit.displayName}
          {" · "}{side?.displayName ?? unit.sideId}
          {" · "}{lang === "en" ? UNIT_KIND_DISPLAY_EN[unit.kind] : cat.displayName}
        </span>
        <span style={{ flex: 1 }} />
        {isOwn && (
          <span style={{ fontSize: 13, padding: "2px 8px", borderRadius: 4, border: `1px solid ${ROE_SHORT[roe].color}66`, color: ROE_SHORT[roe].color, whiteSpace: "nowrap" }}>
            ROE · {ROE_SHORT[roe].label}
          </span>
        )}
        {canEditAttrs && (
          <button className="wg-btn" onClick={() => setAttrOpen((o) => !o)} title="調整單位屬性（沙盒）"
            style={iconBtn(attrOpen)}>
            <SlidersHorizontal size={14} />
          </button>
        )}
        {mode === "placeUnit" && (
          <button className="wg-btn" title={t("Delete Unit")} style={{ ...iconBtn(false), color: "#fca5a5" }}
            onClick={() => {
              const msg = lang === "en" ? `Delete unit "${unit.callsign}"?` : `刪除單位「${unit.callsign}」？`;
              if (confirm(msg)) scenarioStore.removeUnit(unit.id);
            }}>
            <Trash2 size={14} />
          </button>
        )}
        <button className="wg-btn" title={t("Close")} style={iconBtn(false)}
          onClick={() => { if (mode === "planRoute") editorStore.cancel(); scenarioStore.setSelectedUnitId(null); }}>
          <X size={14} />
        </button>
      </div>

      {/* 狀態條 */}
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12, fontFamily: "ui-monospace, monospace" }}>
        <StatusBar label="HP" value={unit.hpCurrent} max={unit.core.hpMax} color="#4ade80" />
        <StatusBar label={t("Fuel")} value={Math.max(0, unit.core.movementRangeKm - unit.distanceTravelledKm)}
          max={unit.core.movementRangeKm} color="#60a5fa" unit=" km" />
        <StatusBar label={t("Ammo")} value={Math.round(unit.ammoCurrent)} max={unit.ammoMax} color="#fbbf24" />
      </div>

      {/* 主體：依模式切換 */}
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", fontSize: 14 }}>
        {isPlanning ? (
          <Banner color="#fb923c" title={t("Plan Route Mode")}>
            <div>{t("Plan Route Mode hint")}</div>
            <div style={mono}>
              {route.length} {t("waypoints")} · {v.totalKm.toFixed(1)} km · ETA {formatEta(v.totalSec)} · {t("remaining fuel")} {v.remainingFuelKm.toFixed(0)} km
            </div>
            {v.issues.map((iss, i) => (
              <div key={i} style={{ color: iss.severity === "error" ? "#fca5a5" : "#fde68a" }}>
                {iss.severity === "error" ? "✗ " : "⚠ "}{iss.message}
              </div>
            ))}
          </Banner>
        ) : isBuoy ? (
          <BuoyBanner />
        ) : isOwn ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
              <Chip k="射程" v={`${unit.core.rangeKm} km`} />
              <Chip k="速度" v={`${Math.round(unit.position.speedKnots)} / ${unit.core.speedKnots} kn`} />
              <Chip k="偵測" v={`${unit.core.detectionRangeKm} km`} />
              <Chip k={t("Current Route")} v={unit.waypoints.length === 0 ? "—"
                : `${unit.waypoints.length} ${t("waypoints")} · ${v.totalKm.toFixed(0)} km · ETA ${formatEta(v.totalSec)}`} />
              {typeof unit.extensions.endurance === "number" && (
                <Chip k={t("Endurance")} v={`${unit.extensions.endurance} hr`} />
              )}
              {typeof unit.extensions.commandRadiusKm === "number" && (
                <Chip k={t("Combat radius")}
                  v={`${unit.extensions.commandRadiusKm.toFixed(0)} km (${(unit.extensions.commandRadiusKm / 1.852).toFixed(0)} nm)`} />
              )}
              {unit.activeSonar && <Chip k="主動聲納" v="ON·曝露" color="#7dd3fc" />}
            </div>
            {cat.domain === "subsurface" && <DepthRow unitId={unit.id} />}
          </div>
        ) : (
          <EnemyContact unitId={unit.id} />
        )}
      </div>

      {/* 屬性 slider 彈出層（控制台上方） */}
      {attrOpen && canEditAttrs && (
        <div style={{
          position: "absolute", bottom: "calc(100% + 18px)", left: 0, width: 360, zIndex: 5,
          padding: "12px 14px", borderRadius: 10,
          background: "rgba(15, 23, 42, 0.97)", border: "1px solid rgba(148, 163, 184, 0.3)",
          boxShadow: "0 -10px 30px rgba(0,0,0,0.45)",
        }}>
          <div style={{ fontSize: 13, color: muted, marginBottom: 8 }}>單位屬性（沙盒調整，即時生效）</div>
          {CORE_KEYS.map((key) => {
            const r = cat.uiRanges[key];
            return (
              <div key={key} style={{ marginBottom: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14 }}>
                  <span>{LABELS[key]}</span><span style={mono}>{unit.core[key]} {r.unit}</span>
                </div>
                <input type="range" min={r.min} max={r.max} step={r.step} value={unit.core[key]}
                  disabled={isPlanning}
                  onChange={(e) => scenarioStore.updateUnitAttribute(unit.id, key, Number(e.target.value))}
                  style={{ width: "100%", accentColor: sideColor }} />
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

function EmptyHint() {
  return (
    <div style={{ height: "100%", display: "flex", alignItems: "center", gap: 16, color: muted, fontSize: 14 }}>
      <MousePointerClick size={34} color="#475569" style={{ flexShrink: 0 }} />
      <div style={{ lineHeight: 1.8 }}>
        <div style={{ color: "#cbd5e1", fontSize: 16, fontWeight: 600 }}>未選擇單位</div>
        <div><b style={{ color: "#e2e8f0" }}>左鍵</b> 點符號選取 · <b style={{ color: "#e2e8f0" }}>右鍵</b> 地圖移動 / 敵方攻擊 · <b style={{ color: "#e2e8f0" }}>Shift＋右鍵</b> 排隊航點</div>
        <div><b style={{ color: "#e2e8f0" }}>Space</b> 暫停 · <b style={{ color: "#e2e8f0" }}>1–4</b> 速率 · 指令卡右側字母即快捷鍵</div>
      </div>
    </div>
  );
}

function EnemyContact({ unitId }: { unitId: string }) {
  const u = scenarioStore.getState().units[unitId];
  const pov = viewStore.getActiveSideId();
  if (!u || !pov) return null;
  const state = u.detectedBy[pov] ?? "hidden";
  const q = u.contactQuality?.[pov];
  return (
    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
      <Chip k="偵測狀態" v={CONTACT_LABEL[state] ?? state}
        color={state === "tracked" || state === "classified" ? "#86efac" : state === "unknown" ? "#facc15" : "#64748b"} />
      {q && state !== "hidden" && (
        <Chip k="定位品質" v={CONTACT_QUALITY_LABEL[q] ?? q} color={CONTACT_QUALITY_COLOR[q] ?? "#fca5a5"} />
      )}
      <div style={{ color: muted, width: "100%" }}>右鍵點此敵方＝選中的己方單位對其接戰</div>
    </div>
  );
}

function DepthRow({ unitId }: { unitId: string }) {
  const u = scenarioStore.getState().units[unitId];
  if (!u) return null;
  const cur = Math.round(Math.max(0, -u.position.altMeters));
  const layer = scenarioStore.getState().scenario.sonarLayerDepthM ?? 60;
  const target = Math.round(u.targetDepthM ?? cur);
  const setDepth = (depthM: number) => submitCommand({
    id: `ui-depth-${Date.now()}`, unitId, simAtSec: wargameClock.getSimTime(), kind: "set_depth", depthM,
  });
  const presets = [18, Math.max(10, layer - 20), layer + 60, 250];
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
      <span style={{ color: muted, whiteSpace: "nowrap" }}>深度</span>
      <span style={{ ...mono, minWidth: 110, color: cur <= 25 ? "#fca5a5" : cur > layer ? "#7dd3fc" : "#cbd5e1" }}>
        {cur}m {cur <= 25 ? "潛望鏡" : cur > layer ? "層下" : "層上"}
      </span>
      <input type="range" min={0} max={SUB_MAX_DEPTH_M} step={5} value={target}
        onChange={(e) => setDepth(Number(e.target.value))} style={{ flex: 1, accentColor: "#38bdf8" }} />
      {presets.map((d) => (
        <button key={d} className="wg-btn" onClick={() => setDepth(d)}
          style={{ ...chipBtn, background: Math.abs(target - d) < 1 ? "rgba(56,189,248,0.25)" : chipBtn.background }}>
          {d}m
        </button>
      ))}
    </div>
  );
}

function BuoyBanner() {
  const d = editorStore.getSonobuoyDraft();
  const plan = d.cornerA && d.cornerB
    ? planSonobuoyField({ cornerA: d.cornerA, cornerB: d.cornerB, count: d.count, mdrKm: d.mdrKm })
    : null;
  return (
    <Banner color="#38bdf8" title="佈放聲標反潛屏幕">
      <div>點地圖兩角定義搜索框 · Enter 佈放 · Esc 取消
        {!d.cornerA ? "（請點第 1 角）" : !d.cornerB ? "（請點第 2 角）" : ""}</div>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span>聲標 {d.count} 枚</span>
        <input type="range" min={2} max={36} step={1} value={d.count}
          onChange={(e) => editorStore.setSonobuoyCount(Number(e.target.value))} style={{ flex: 1, accentColor: "#38bdf8" }} />
      </div>
      {plan && (
        <div style={mono}>P_FZ {(plan.pFZ * 100).toFixed(0)}% · {plan.rows}×{plan.cols} · {plan.lengthNm.toFixed(0)}×{plan.widthNm.toFixed(0)} nm</div>
      )}
    </Banner>
  );
}

function Banner({ color, title, children }: { color: string; title: string; children: React.ReactNode }) {
  return (
    <div style={{
      padding: "6px 10px", borderRadius: 6, borderLeft: `3px solid ${color}`,
      background: `${color}1f`, color: "#e2e8f0", display: "flex", flexDirection: "column", gap: 4,
    }}>
      <div style={{ fontWeight: 700, color }}>{title}</div>
      {children}
    </div>
  );
}

function Chip({ k, v, color = "#e2e8f0" }: { k: string; v: string; color?: string }) {
  return (
    <span style={{
      display: "inline-flex", gap: 6, alignItems: "baseline",
      padding: "3px 8px", borderRadius: 4, background: "rgba(30, 41, 59, 0.7)",
      border: "1px solid rgba(148, 163, 184, 0.18)",
    }}>
      <span style={{ color: muted, fontSize: 12 }}>{k}</span>
      <span style={{ ...mono, color }}>{v}</span>
    </span>
  );
}

const mono: React.CSSProperties = { fontFamily: "ui-monospace, monospace" };

const chipBtn: React.CSSProperties = {
  padding: "2px 6px", fontSize: 12, borderRadius: 4, cursor: "pointer",
  border: "1px solid rgba(148,163,184,0.3)", background: "rgba(148,163,184,0.12)", color: "#cbd5e1",
  fontFamily: "ui-monospace, monospace",
};

function iconBtn(active: boolean): React.CSSProperties {
  return {
    width: 28, height: 28, borderRadius: 6, flexShrink: 0,
    display: "flex", alignItems: "center", justifyContent: "center",
    border: "1px solid rgba(148, 163, 184, 0.3)",
    background: active ? "rgba(59, 130, 246, 0.35)" : "rgba(30, 41, 59, 0.6)",
    color: "#cbd5e1", cursor: "pointer",
  };
}
