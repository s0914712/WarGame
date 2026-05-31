/**
 * 勝負結算彈窗 — outcome 出現時自動跳出。
 *
 * 動作：
 *   - 重新開始（重載當前場景）
 *   - 切其他場景（觸發 ScenarioPicker 開啟 — 暫用簡單 alert / close 自處理）
 *   - 關閉（繼續觀察 — 不重設）
 */
import { useEffect, useSyncExternalStore } from "react";
import { Trophy, Handshake, RotateCcw, X } from "lucide-react";
import { scenarioStore } from "../wargame/scenarioStore";
import { wargameClock } from "../wargame/clock";
import { SIDE_COLORS } from "../wargame/symbology/sideColors";
import type { SideId } from "../wargame/types";

function getOutcome() {
  return scenarioStore.getState().outcome;
}

export function VictoryModal() {
  const outcome = useSyncExternalStore(scenarioStore.subscribe, getOutcome, getOutcome);

  // outcome 出現 → 自動暫停 clock
  useEffect(() => {
    if (outcome && !wargameClock.isPaused()) {
      wargameClock.pause();
    }
  }, [outcome]);

  if (!outcome) return null;

  const state = scenarioStore.getState();
  const winnerSide = outcome.winner
    ? state.scenario.sides.find((s) => s.id === outcome.winner)
    : null;
  const winnerColor = outcome.winner
    ? SIDE_COLORS[outcome.winner].primary
    : "#94a3b8";

  // 計算各方統計
  const sideStats = state.scenario.sides
    .filter((s) => s.isHostileTo.length > 0 || s.isPlayer)
    .map((s) => {
      const alive = Object.values(state.units).filter(
        (u) => u.sideId === s.id && u.hpCurrent > 0,
      ).length;
      const killed = state.eventsAll.filter(
        (e) => e.kind === "destroyed" && e.targetSideId === s.id,
      ).length;
      return { side: s, alive, killed };
    });

  const reload = () => {
    wargameClock.reset();
    scenarioStore.loadScenario(state.scenario);
  };

  const close = () => {
    // 只清 outcome，不重設場景（讓玩家繼續觀察戰後狀態）
    scenarioStore.setState({ ...state, outcome: null });
  };

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 150,
        background: "rgba(2, 6, 23, 0.85)",
        backdropFilter: "blur(6px)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      <div
        className="wg-fade-in"
        style={{
          width: "min(560px, 92vw)",
          background: "linear-gradient(160deg, rgba(30, 41, 59, 0.98), rgba(15, 23, 42, 0.98))",
          border: `2px solid ${winnerColor}`,
          borderRadius: 14,
          padding: 0,
          color: "#e2e8f0",
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
          boxShadow: `0 20px 60px ${winnerColor}40, 0 0 0 1px ${winnerColor}30`,
          overflow: "hidden",
        }}
      >
        {/* 頂部彩色橫條 + 結果 */}
        <div style={{
          padding: "24px 28px 18px",
          background: `linear-gradient(135deg, ${winnerColor}22, transparent)`,
          borderBottom: `1px solid ${winnerColor}40`,
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            {outcome.winner ? (
              <Trophy size={42} color={winnerColor} fill={winnerColor} fillOpacity={0.25} />
            ) : (
              <Handshake size={42} color={winnerColor} />
            )}
            <div>
              <div style={{ fontSize: 16, color: "#94a3b8", marginBottom: 2 }}>戰役結束</div>
              <div style={{ fontSize: 44, fontWeight: 700, color: winnerColor }}>
                {outcome.winner
                  ? `${winnerSide?.displayName ?? outcome.winner} 勝`
                  : "雙方平手"}
              </div>
            </div>
          </div>
          <div style={{
            marginTop: 12, fontSize: 17, color: "#cbd5e1", lineHeight: 1.55,
          }}>
            {outcome.reason}
          </div>
          {outcome.conditionLabel && (
            <div style={{
              marginTop: 6, fontSize: 15, color: "#fbbf24",
              fontFamily: "ui-monospace, monospace",
            }}>
              【觸發條件：{outcome.conditionLabel}】
            </div>
          )}
        </div>

        {/* 兵力結算表 */}
        <div style={{ padding: "18px 28px" }}>
          <div style={{ fontSize: 16, color: "#94a3b8", marginBottom: 10, fontWeight: 600, letterSpacing: 1 }}>
            戰役統計
          </div>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 17 }}>
            <thead>
              <tr style={{ color: "#94a3b8", fontSize: 15 }}>
                <th style={{ textAlign: "left", padding: "6px 0" }}>陣營</th>
                <th style={{ textAlign: "right", padding: "6px 12px" }}>存活</th>
                <th style={{ textAlign: "right", padding: "6px 12px" }}>擊毀</th>
              </tr>
            </thead>
            <tbody>
              {sideStats.map(({ side, alive, killed }) => (
                <tr
                  key={side.id}
                  style={{ borderTop: "1px solid rgba(148, 163, 184, 0.15)" }}
                >
                  <td style={{ padding: "8px 0", display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{
                      width: 10, height: 10, borderRadius: "50%",
                      background: SIDE_COLORS[side.id as SideId].primary,
                    }} />
                    <span style={{ fontWeight: 600 }}>{side.displayName}</span>
                    {side.id === outcome.winner && (
                      <span style={{
                        fontSize: 14, padding: "2px 6px",
                        background: `${winnerColor}33`, color: winnerColor,
                        borderRadius: 3, marginLeft: 4, fontWeight: 700,
                      }}>WINNER</span>
                    )}
                  </td>
                  <td style={{
                    padding: "8px 12px", textAlign: "right",
                    fontFamily: "ui-monospace, monospace", fontWeight: 600,
                    color: SIDE_COLORS[side.id as SideId].primary,
                  }}>
                    {alive}
                  </td>
                  <td style={{
                    padding: "8px 12px", textAlign: "right",
                    fontFamily: "ui-monospace, monospace",
                    color: "#94a3b8",
                  }}>
                    ✗ {killed}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* 按鈕 */}
        <div style={{
          padding: "16px 28px 22px",
          borderTop: "1px solid rgba(148, 163, 184, 0.15)",
          display: "flex", gap: 10, justifyContent: "flex-end",
        }}>
          <button
            onClick={close}
            className="wg-btn"
            style={{
              padding: "10px 16px",
              background: "transparent",
              color: "#94a3b8",
              border: "1px solid rgba(148, 163, 184, 0.3)",
              borderRadius: 6,
              fontSize: 17, cursor: "pointer",
              fontFamily: "inherit",
              display: "flex", alignItems: "center", gap: 6,
            }}
          >
            <X size={14} /> 觀察戰後
          </button>
          <button
            onClick={reload}
            className="wg-btn"
            style={{
              padding: "10px 18px",
              background: winnerColor,
              color: "#fff",
              border: "none",
              borderRadius: 6,
              fontSize: 17, fontWeight: 600, cursor: "pointer",
              fontFamily: "inherit",
              display: "flex", alignItems: "center", gap: 6,
            }}
          >
            <RotateCcw size={14} /> 重新開戰
          </button>
        </div>
      </div>
    </div>
  );
}
