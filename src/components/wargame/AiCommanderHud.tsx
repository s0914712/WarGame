/**
 * 「AI 指揮中」地圖浮動小卡：LLM 接手指揮時，玩家關掉面板看地圖，
 * 這裡即時顯示 AI 的局勢研判、作戰意圖與每條指令的理由；可收合 / 停止 / 回面板。
 */
import { useState, useSyncExternalStore } from "react";
import { aiConfigStore } from "../../wargame/llm/aiConfig";
import { STRATEGY_TEXT } from "../../wargame/llm/adversary";
import { scenarioStore } from "../../wargame/scenarioStore";
import { formatTPlus } from "../../wargame/clock";
import { AssessmentView } from "./AiAssessmentView";

export function AiCommanderHud({ top, onOpenPanel }: { top: number; onOpenPanel: () => void }) {
  useSyncExternalStore(aiConfigStore.subscribe, aiConfigStore.getConfig, aiConfigStore.getConfig);
  useSyncExternalStore(aiConfigStore.subscribe, aiConfigStore.getStatus, aiConfigStore.getStatus);
  const [collapsed, setCollapsed] = useState(false);
  const cfg = aiConfigStore.getConfig();
  const st = aiConfigStore.getStatus();
  if (!cfg.enabled || cfg.mode !== "llm") return null;

  const side = scenarioStore.getState().scenario.sides.find((s) => s.id === cfg.sideId);
  const btn: React.CSSProperties = {
    padding: "3px 8px", fontSize: 12, borderRadius: 4, cursor: "pointer", fontFamily: "inherit",
    background: "rgba(30,41,59,0.8)", color: "#cbd5e1", border: "1px solid rgba(148,163,184,0.3)",
  };

  return (
    <div data-testid="ai-hud" style={{
      position: "absolute", top, right: 16, zIndex: 27,
      width: collapsed ? "auto" : 380, maxWidth: "calc(100vw - 32px)",
      maxHeight: `calc(100vh - ${top + 220}px)`, overflow: "auto",
      padding: "10px 12px", borderRadius: 8,
      background: "rgba(15, 23, 42, 0.94)", backdropFilter: "blur(6px)",
      border: "1px solid rgba(96, 165, 250, 0.5)", boxShadow: "0 8px 24px rgba(0,0,0,0.45)",
      color: "#e2e8f0", fontFamily: "ui-sans-serif, system-ui, sans-serif",
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span style={{
          width: 8, height: 8, borderRadius: "50%", flexShrink: 0,
          background: st.inFlight ? "#fbbf24" : st.lastError ? "#f87171" : "#4ade80",
        }} />
        <span style={{ fontWeight: 700, fontSize: 14, whiteSpace: "nowrap" }}>
          🤖 AI 指揮中 · {side?.displayName ?? cfg.sideId}
        </span>
        <span style={{ flex: 1 }} />
        <button style={btn} onClick={() => setCollapsed((c) => !c)}>{collapsed ? "展開" : "收合"}</button>
        {!collapsed && <button style={btn} onClick={onOpenPanel}>設定</button>}
        <button style={{ ...btn, color: "#fecaca", borderColor: "rgba(239,68,68,0.5)" }} data-testid="ai-hud-stop"
          onClick={() => aiConfigStore.updateConfig({ enabled: false })}>停止</button>
      </div>
      {!collapsed && (
        <>
          <div style={{ fontSize: 12, color: "#64748b", margin: "3px 0 6px" }}>
            {STRATEGY_TEXT[cfg.strategy]?.label ?? cfg.strategy} · {cfg.model} · 每 {cfg.intervalSimSec}s
            {st.lastCallSimSec !== null && ` · 上次 ${formatTPlus(st.lastCallSimSec)}`}
            {st.inFlight && <span style={{ color: "#fbbf24" }}> · 思考中…</span>}
          </div>
          {st.lastError && <div style={{ fontSize: 12, color: "#fca5a5", marginBottom: 6 }}>✗ {st.lastError.slice(0, 200)}</div>}
          {st.lastAssessment || st.lastOrders.length > 0
            ? <AssessmentView compact assessment={st.lastAssessment} orders={st.lastOrders} maxOrders={6} />
            : <div style={{ fontSize: 13, color: "#94a3b8" }}>
              {st.inFlight ? "AI 正在研判戰場…" : "等待下一次決策（時鐘需在播放中）"}
            </div>}
        </>
      )}
    </div>
  );
}
