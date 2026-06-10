/**
 * UnitEditorPanel — 右側單位屬性編輯 + 航線規劃。
 *
 * Phase 2：5 個 core 屬性 slider
 * Phase 4：加「規劃航線」按鈕、規劃模式 UI、清除航線
 *
 * 規劃流程：
 *   1. 按「規劃航線」→ editorStore.startPlanRoute(unit.id)
 *      → clock 暫停、panel 切到規劃模式 UI
 *   2. 地圖點擊（WargameApp 處理）→ editorStore.appendWaypoint
 *   3. 按「✓ 套用」or Enter → 寫進 scenarioStore 指令佇列
 *      按「✗ 取消」or Esc → 丟掉、恢復播放
 */

import { useEffect, useSyncExternalStore } from "react";
import type { CoreAttributes, RoeMode } from "../wargame/types";
import { scenarioStore } from "../wargame/scenarioStore";
import { viewStore } from "../wargame/viewStore";
import { editorStore } from "../wargame/editor/editorStore";
import { UNIT_CATALOG, CORE_ATTRIBUTE_LABELS } from "../wargame/catalog/units";
import { wargameClock } from "../wargame/clock";
import { validatePlan } from "../wargame/sim/validate";

const ROE_OPTIONS: { value: RoeMode; label: string }[] = [
  { value: "weapons_free", label: "自由接戰 (Free)" },
  { value: "weapons_tight", label: "限制接戰 (Tight)" },
  { value: "defensive_only", label: "僅防禦 (Defensive)" },
  { value: "weapons_hold", label: "停止接戰 (Hold)" },
];

const CONTACT_LABEL: Record<string, string> = {
  hidden: "未偵測",
  unknown: "未識別接觸",
  classified: "已分類（可接戰）",
  tracked: "穩定追蹤",
  own: "己方",
};

const CORE_KEYS: (keyof CoreAttributes)[] = [
  "rangeKm",
  "speedKnots",
  "movementRangeKm",
  "detectionRangeKm",
  "hpMax",
];

interface Snapshot {
  selectedUnitId: string | null;
  signature: string;
  editorMode: string;
  planningUnitId: string | null;
  pendingCount: number;
}

let cached: Snapshot = buildSnapshot();

function buildSnapshot(): Snapshot {
  const id = scenarioStore.getSelectedUnitId();
  const u = scenarioStore.getSelectedUnit();
  return {
    selectedUnitId: id,
    signature: id && u
      ? `${id}|${u.core.rangeKm}|${u.core.speedKnots}|${u.core.movementRangeKm}|${u.core.detectionRangeKm}|${u.core.hpMax}|${u.hpCurrent}|${u.waypoints.length}|${u.roe ?? ""}|${u.activeSonar ? 1 : 0}`
      : "",
    editorMode: editorStore.getMode(),
    planningUnitId: editorStore.getPlanningUnitId(),
    pendingCount: editorStore.getPendingWaypoints().length,
  };
}

function getSnapshot(): Snapshot {
  const next = buildSnapshot();
  if (
    next.signature !== cached.signature ||
    next.selectedUnitId !== cached.selectedUnitId ||
    next.editorMode !== cached.editorMode ||
    next.planningUnitId !== cached.planningUnitId ||
    next.pendingCount !== cached.pendingCount
  ) {
    cached = next;
  }
  return cached;
}

function subscribe(cb: () => void): () => void {
  const u1 = scenarioStore.subscribe(cb);
  const u2 = editorStore.subscribe(cb);
  return () => { u1(); u2(); };
}

export function UnitEditorPanel({ embedded = false }: { embedded?: boolean } = {}) {
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const mode = editorStore.getMode();
  const planningUnitId = editorStore.getPlanningUnitId();
  // 規劃模式時 panel 跟著規劃中的 unit；否則跟選中的
  const targetUnit = mode === "planRoute" && planningUnitId
    ? scenarioStore.getState().units[planningUnitId] ?? null
    : scenarioStore.getSelectedUnit();

  // 鍵盤捷徑：Enter 套用 / Esc 取消 / Backspace 移除最後一點
  useEffect(() => {
    if (mode !== "planRoute") return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;
      if (e.key === "Enter") {
        e.preventDefault();
        editorStore.commit();
      } else if (e.key === "Escape") {
        e.preventDefault();
        editorStore.cancel();
      } else if (e.key === "Backspace") {
        e.preventDefault();
        editorStore.removeLastWaypoint();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [mode]);

  if (!targetUnit) return null;

  const catalog = UNIT_CATALOG[targetUnit.kind];
  const side = scenarioStore.getState().scenario.sides.find((s) => s.id === targetUnit.sideId);
  const sideColor = side?.colorPrimary ?? "#888";

  // ROE / 偵測狀態（相對於當前 POV）
  const activeSide = viewStore.getActiveSideId();
  const isOwnUnit = activeSide == null || targetUnit.sideId === activeSide;
  const effectiveRoe: RoeMode = targetUnit.roe ?? side?.roe ?? "weapons_free";
  const contactState = (activeSide && targetUnit.sideId !== activeSide && (side?.isHostileTo?.length ?? 0) >= 0)
    ? (targetUnit.detectedBy[activeSide] ?? "hidden")
    : "own";
  const setRoe = (roe: RoeMode) => {
    scenarioStore.enqueueCommand({
      id: `ui-roe-${Date.now()}`,
      unitId: targetUnit.id,
      simAtSec: wargameClock.getSimTime(),
      kind: "set_roe",
      roe,
    });
  };
  // 主動聲納（E20）：僅具拍發能力的單位（如水面艦）顯示開關
  const canPing = UNIT_CATALOG[targetUnit.kind].acoustics?.active != null;
  const sonarOn = targetUnit.activeSonar === true;
  const toggleSonar = () => {
    scenarioStore.enqueueCommand({
      id: `ui-sonar-${Date.now()}`,
      unitId: targetUnit.id,
      simAtSec: wargameClock.getSimTime(),
      kind: "set_active_sonar",
      on: !sonarOn,
    });
  };

  const pending = editorStore.getPendingWaypoints();
  const isPlanning = mode === "planRoute";
  const isPlanningThis = isPlanning && planningUnitId === targetUnit.id;

  // 統一驗證入口（規劃中用 pending，否則用 current）
  const route = isPlanningThis ? pending : targetUnit.waypoints;
  const validation = validatePlan(targetUnit, route, {
    currentSimSec: wargameClock.getSimTime(),
  });

  return (
    <div
      style={embedded ? {
        width: "100%",
        background: "transparent",
        border: isPlanningThis ? "2px solid #fb923c" : "1px solid transparent",
        borderRadius: 10,
        color: "#e2e8f0",
        fontFamily: "ui-sans-serif, system-ui, sans-serif",
      } : {
        position: "absolute",
        top: 80,
        right: 16,
        zIndex: 30,
        width: 380,
        background: "rgba(15, 23, 42, 0.92)",
        backdropFilter: "blur(8px)",
        border: isPlanningThis
          ? "2px solid #fb923c"
          : "1px solid rgba(148, 163, 184, 0.3)",
        borderRadius: 10,
        color: "#e2e8f0",
        fontFamily: "ui-sans-serif, system-ui, sans-serif",
        boxShadow: "0 10px 30px rgba(0,0,0,0.4)",
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "12px 14px",
          borderBottom: "1px solid rgba(148, 163, 184, 0.2)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 8, minWidth: 0 }}>
          <span style={{ width: 10, height: 10, borderRadius: "50%", background: sideColor, flexShrink: 0 }} />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 20, fontWeight: 700 }}>{targetUnit.callsign}</div>
            <div
              style={{
                fontSize: 17, color: "#94a3b8", whiteSpace: "nowrap",
                overflow: "hidden", textOverflow: "ellipsis",
              }}
            >
              {targetUnit.displayName}
            </div>
          </div>
        </div>
        <button
          onClick={() => {
            if (isPlanning) editorStore.cancel();
            scenarioStore.setSelectedUnitId(null);
          }}
          style={{
            width: 24, height: 24, borderRadius: 4, border: "none",
            background: "transparent", color: "#94a3b8", fontSize: 22, cursor: "pointer",
          }}
          title="關閉"
        >×</button>
      </div>

      {/* Meta */}
      <div
        style={{
          padding: "10px 14px", fontSize: 17, color: "#94a3b8",
          display: "flex", gap: 12,
          borderBottom: "1px solid rgba(148, 163, 184, 0.15)",
        }}
      >
        <span>陣營：{side?.displayName ?? targetUnit.sideId}</span>
        <span>·</span>
        <span>類型：{catalog.displayName}</span>
      </div>
      {/* 狀態列：HP + 燃料 + 彈藥 */}
      <div
        style={{
          padding: "8px 14px",
          fontSize: 16,
          color: "#cbd5e1",
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr",
          gap: 8,
          borderBottom: "1px solid rgba(148, 163, 184, 0.15)",
          fontFamily: "ui-monospace, monospace",
        }}
      >
        <StatusBar
          label="HP"
          value={targetUnit.hpCurrent}
          max={targetUnit.core.hpMax}
          color="#4ade80"
        />
        <StatusBar
          label="油料"
          value={Math.max(0, targetUnit.core.movementRangeKm - targetUnit.distanceTravelledKm)}
          max={targetUnit.core.movementRangeKm}
          color="#60a5fa"
          unit=" km"
        />
        <StatusBar
          label="彈藥"
          value={Math.round(targetUnit.ammoCurrent)}
          max={targetUnit.ammoMax}
          color="#fbbf24"
        />
      </div>

      {/* ROE（己方）/ 偵測狀態（敵方） */}
      <div
        style={{
          padding: "10px 14px",
          borderBottom: "1px solid rgba(148, 163, 184, 0.15)",
        }}
      >
        {isOwnUnit ? (
          <div>
            <div style={{ fontSize: 15, color: "#94a3b8", marginBottom: 6 }}>交戰規則 (ROE)</div>
            <select
              value={effectiveRoe}
              onChange={(e) => setRoe(e.target.value as RoeMode)}
              style={{
                width: "100%",
                padding: "8px 10px",
                fontSize: 17,
                background: "rgba(30, 41, 59, 0.9)",
                color: "#e2e8f0",
                border: "1px solid rgba(148, 163, 184, 0.3)",
                borderRadius: 6,
                cursor: "pointer",
              }}
            >
              {ROE_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
            {canPing && (
              <button
                onClick={toggleSonar}
                style={{
                  marginTop: 8,
                  width: "100%",
                  padding: "8px 10px",
                  fontSize: 16,
                  fontWeight: 600,
                  borderRadius: 6,
                  cursor: "pointer",
                  border: sonarOn ? "1px solid #38bdf8" : "1px solid rgba(148,163,184,0.3)",
                  background: sonarOn ? "rgba(56,189,248,0.22)" : "rgba(148,163,184,0.12)",
                  color: sonarOn ? "#7dd3fc" : "#cbd5e1",
                }}
                title="主動聲納：偵潛距離大增，但會曝露自身位置給敵方被動聲納"
              >
                主動聲納 {sonarOn ? "● ON（拍發中／已曝露）" : "○ OFF（靜默）"}
              </button>
            )}
          </div>
        ) : (
          <div style={{ fontSize: 16, color: "#94a3b8", display: "flex", justifyContent: "space-between" }}>
            <span>偵測狀態</span>
            <span style={{ color: contactState === "tracked" || contactState === "classified" ? "#86efac"
              : contactState === "unknown" ? "#facc15" : "#64748b", fontWeight: 600 }}>
              {CONTACT_LABEL[contactState] ?? contactState}
            </span>
          </div>
        )}
      </div>

      {/* Planning banner */}
      {isPlanningThis && (
        <div
          style={{
            padding: "10px 14px",
            background: "rgba(251, 146, 60, 0.15)",
            borderBottom: "1px solid rgba(251, 146, 60, 0.3)",
            fontSize: 15,
            color: "#fed7aa",
          }}
        >
          <div style={{ fontWeight: 600, marginBottom: 4 }}>規劃航線模式</div>
          <div>點擊地圖加航點 · Backspace 移除上一點 · Enter 套用 · Esc 取消</div>
          <div style={{ marginTop: 6, fontFamily: "ui-monospace, monospace" }}>
            {pending.length} 個航點 · {validation.totalKm.toFixed(1)} km · ETA {formatEta(validation.totalSec)}
            {" · 剩餘油料 "}{validation.remainingFuelKm.toFixed(0)} km
          </div>
          {validation.issues.length > 0 && (
            <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
              {validation.issues.map((iss, i) => (
                <div
                  key={i}
                  style={{
                    fontSize: 15,
                    padding: "4px 8px",
                    borderRadius: 4,
                    background: iss.severity === "error"
                      ? "rgba(239, 68, 68, 0.2)" : "rgba(251, 191, 36, 0.18)",
                    color: iss.severity === "error" ? "#fca5a5" : "#fde68a",
                    border: iss.severity === "error"
                      ? "1px solid rgba(239, 68, 68, 0.45)"
                      : "1px solid rgba(251, 191, 36, 0.35)",
                  }}
                >
                  {iss.severity === "error" ? "✗ " : "⚠ "}{iss.message}
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Sliders（規劃模式時 disabled，避免邊調速率邊規劃造成 ETA 跳） */}
      <div style={{ padding: "10px 14px 4px", opacity: isPlanningThis ? 0.55 : 1 }}>
        {CORE_KEYS.map((key) => {
          const range = catalog.uiRanges[key];
          const value = targetUnit.core[key];
          return (
            <div key={key} style={{ marginBottom: 10 }}>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 19, marginBottom: 6 }}>
                <span style={{ color: "#cbd5e1", fontWeight: 500 }}>{CORE_ATTRIBUTE_LABELS[key]}</span>
                <span style={{ color: "#e2e8f0", fontFamily: "ui-monospace, monospace", fontWeight: 600 }}>
                  {value} {range.unit}
                </span>
              </div>
              <input
                type="range"
                disabled={isPlanningThis}
                min={range.min}
                max={range.max}
                step={range.step}
                value={value}
                onChange={(e) =>
                  scenarioStore.updateUnitAttribute(targetUnit.id, key, Number(e.target.value))
                }
                style={{ width: "100%", accentColor: sideColor, cursor: isPlanningThis ? "not-allowed" : "pointer" }}
              />
            </div>
          );
        })}
      </div>

      {/* Route actions */}
      <div
        style={{
          padding: "10px 14px 14px",
          borderTop: "1px solid rgba(148, 163, 184, 0.15)",
          display: "flex",
          flexDirection: "column",
          gap: 8,
        }}
      >
        {!isPlanningThis && (
          <>
            <div style={{ fontSize: 15, color: "#94a3b8" }}>
              目前航線：{targetUnit.waypoints.length} 個航點
              {targetUnit.waypoints.length > 0 && (
                <> · {validation.totalKm.toFixed(1)} km · ETA {formatEta(validation.totalSec)}</>
              )}
            </div>
            <div style={{ display: "flex", gap: 8 }}>
              <button
                onClick={() => editorStore.startPlanRoute(targetUnit.id)}
                style={btnPrimary(sideColor)}
              >
                規劃航線
              </button>
              {targetUnit.waypoints.length > 0 && (
                <button
                  onClick={() => editorStore.clearUnitWaypoints(targetUnit.id)}
                  style={btnSecondary}
                >
                  清除航線
                </button>
              )}
            </div>
            {mode === "placeUnit" && (
              <button
                onClick={() => {
                  if (confirm(`刪除單位「${targetUnit.callsign}」？`)) {
                    scenarioStore.removeUnit(targetUnit.id);
                  }
                }}
                style={{
                  ...btnPrimary("#ef4444"),
                  marginTop: 4,
                }}
              >
                🗑 刪除單位
              </button>
            )}
          </>
        )}

        {isPlanningThis && (
          <div style={{ display: "flex", gap: 8 }}>
            <button
              onClick={() => editorStore.commit()}
              disabled={pending.length === 0 || !validation.ok}
              style={{
                ...btnPrimary(validation.ok ? "#fb923c" : "#64748b"),
                opacity: (pending.length === 0 || !validation.ok) ? 0.4 : 1,
                cursor: (pending.length === 0 || !validation.ok) ? "not-allowed" : "pointer",
              }}
              title={!validation.ok ? "有違規航點，請先移除" : ""}
            >
              ✓ 套用 ({pending.length})
            </button>
            <button onClick={() => editorStore.cancel()} style={btnSecondary}>
              ✗ 取消
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function StatusBar({ label, value, max, color, unit = "" }: {
  label: string; value: number; max: number; color: string; unit?: string;
}) {
  const frac = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  const displayValue = unit ? Math.round(value) : value;
  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", marginBottom: 3, fontSize: 14 }}>
        <span style={{ color: "#94a3b8" }}>{label}</span>
        <span style={{ color }}>{displayValue}{unit}/{max}{unit}</span>
      </div>
      <div style={{
        height: 4, borderRadius: 2,
        background: "rgba(148, 163, 184, 0.15)",
        overflow: "hidden",
      }}>
        <div style={{
          height: "100%",
          width: `${frac * 100}%`,
          background: color,
          transition: "width 0.3s ease",
        }} />
      </div>
    </div>
  );
}

function formatEta(seconds: number): string {
  if (!isFinite(seconds) || seconds <= 0) return "—";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}min`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

function btnPrimary(color: string): React.CSSProperties {
  return {
    flex: 1,
    padding: "10px 14px",
    background: color,
    color: "#fff",
    border: "none",
    borderRadius: 6,
    fontSize: 19,
    fontWeight: 600,
    cursor: "pointer",
  };
}

const btnSecondary: React.CSSProperties = {
  flex: 1,
  padding: "10px 14px",
  background: "rgba(148, 163, 184, 0.15)",
  color: "#cbd5e1",
  border: "1px solid rgba(148, 163, 184, 0.3)",
  borderRadius: 6,
  fontSize: 19,
  cursor: "pointer",
};
