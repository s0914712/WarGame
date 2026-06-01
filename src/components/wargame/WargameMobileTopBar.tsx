/**
 * 行動版頂部列 — 固定頂部、單欄兩列。
 *   列 1：☰ 選單鈕 + 精簡戰況（BattleStatsHud embedded）
 *   列 2：精簡時鐘（WargameClockHUD isMobile：play/pause + T+ + 速率 + FoW）
 */
import { Menu } from "lucide-react";
import { WargameClockHUD } from "../WargameClockHUD";
import { BattleStatsHud } from "../BattleStatsHud";

export function WargameMobileTopBar({ onOpenMenu }: { onOpenMenu: () => void }) {
  return (
    <div
      style={{
        position: "fixed",
        top: 0,
        left: 0,
        right: 0,
        zIndex: 24,
        paddingTop: "env(safe-area-inset-top, 0px)",
        background: "rgba(2, 6, 23, 0.82)",
        backdropFilter: "blur(10px)",
        WebkitBackdropFilter: "blur(10px)",
        borderBottom: "1px solid rgba(148, 163, 184, 0.2)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px" }}>
        <button
          onClick={onOpenMenu}
          className="wg-btn"
          aria-label="開啟選單"
          style={{
            width: 44,
            height: 44,
            flexShrink: 0,
            borderRadius: 8,
            background: "rgba(15, 23, 42, 0.85)",
            color: "#cbd5e1",
            border: "1px solid rgba(148, 163, 184, 0.3)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            cursor: "pointer",
          }}
        >
          <Menu size={20} />
        </button>
        <div style={{ flex: 1, minWidth: 0, overflowX: "auto" }}>
          <BattleStatsHud isMobile embedded />
        </div>
      </div>
      <div style={{ padding: "0 10px 8px", display: "flex", justifyContent: "center", overflowX: "auto" }}>
        <WargameClockHUD isMobile />
      </div>
    </div>
  );
}
