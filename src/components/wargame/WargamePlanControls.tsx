/**
 * 行動版規劃控制列 — 取代桌面鍵盤的 Backspace / Enter / Esc。
 *
 * 僅在 editorStore 處於 planRoute 模式時顯示，浮在底部 sheet 上方。
 * 三顆 ≥44px 觸控鈕，呼叫與桌面鍵盤 handler 完全相同的 store 方法。
 */
import { useSyncExternalStore } from "react";
import { Undo2, Check, X } from "lucide-react";
import { editorStore } from "../../wargame/editor/editorStore";
import { scenarioStore } from "../../wargame/scenarioStore";
import { validatePlan } from "../../wargame/sim/validate";
import { wargameClock } from "../../wargame/clock";

// mode + 航點數變化都要 re-render
function snap(): string {
  return `${editorStore.getMode()}:${editorStore.getPendingWaypoints().length}`;
}

export function WargamePlanControls({ bottomOffset }: { bottomOffset: number }) {
  useSyncExternalStore(editorStore.subscribe, snap, snap);

  if (editorStore.getMode() !== "planRoute") return null;
  const planningUnitId = editorStore.getPlanningUnitId();
  const unit = planningUnitId ? scenarioStore.getState().units[planningUnitId] : null;
  if (!unit) return null;

  const pending = editorStore.getPendingWaypoints();
  const validation = validatePlan(unit, pending, { currentSimSec: wargameClock.getSimTime() });
  const canCommit = pending.length > 0 && validation.ok;

  return (
    <div
      style={{
        position: "fixed",
        left: 12,
        right: 12,
        bottom: bottomOffset,
        zIndex: 31,
        display: "flex",
        gap: 8,
        padding: 8,
        background: "rgba(2, 6, 23, 0.92)",
        backdropFilter: "blur(8px)",
        border: "1px solid rgba(251, 146, 60, 0.5)",
        borderRadius: 10,
        boxShadow: "0 6px 20px rgba(0,0,0,0.45)",
        fontFamily: "ui-sans-serif, system-ui, sans-serif",
      }}
    >
      <button
        onClick={() => editorStore.removeLastWaypoint()}
        disabled={pending.length === 0}
        className="wg-btn"
        style={{
          ...btn,
          opacity: pending.length === 0 ? 0.4 : 1,
          background: "rgba(148, 163, 184, 0.18)",
          color: "#cbd5e1",
          border: "1px solid rgba(148, 163, 184, 0.35)",
        }}
      >
        <Undo2 size={16} /> 移除
      </button>
      <button
        onClick={() => editorStore.commit()}
        disabled={!canCommit}
        className="wg-btn"
        style={{
          ...btn,
          flex: 1,
          opacity: canCommit ? 1 : 0.4,
          background: canCommit ? "#fb923c" : "#64748b",
          color: "#fff",
          border: "none",
        }}
      >
        <Check size={16} /> 套用 ({pending.length})
      </button>
      <button
        onClick={() => editorStore.cancel()}
        className="wg-btn"
        style={{
          ...btn,
          background: "rgba(148, 163, 184, 0.18)",
          color: "#cbd5e1",
          border: "1px solid rgba(148, 163, 184, 0.35)",
        }}
      >
        <X size={16} /> 取消
      </button>
    </div>
  );
}

const btn: React.CSSProperties = {
  minHeight: 44,
  padding: "0 14px",
  borderRadius: 8,
  fontSize: 17,
  fontWeight: 600,
  cursor: "pointer",
  fontFamily: "inherit",
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  gap: 6,
};
