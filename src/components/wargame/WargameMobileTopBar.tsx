/**
 * 行動版頂部 HUD — 純資訊 / 時鐘控制，功能已移到底部 dock。
 *   精簡時鐘（play/pause + T+ + 速率 + FoW）+ 精簡戰況。
 *   內容套 zoom 整體縮小，與電腦版區隔。
 */
import { WargameClockHUD } from "../WargameClockHUD";
import { BattleStatsHud } from "../BattleStatsHud";

export function WargameMobileTopBar() {
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
      <div
        style={{
          // zoom：整體縮小頂部 HUD，與電腦版區隔
          zoom: 0.82,
          display: "flex",
          flexDirection: "column",
          gap: 6,
          padding: "8px 10px",
        }}
      >
        <div style={{ display: "flex", justifyContent: "center", overflowX: "auto" }}>
          <BattleStatsHud isMobile embedded />
        </div>
        <div style={{ display: "flex", justifyContent: "center", overflowX: "auto" }}>
          <WargameClockHUD isMobile />
        </div>
      </div>
    </div>
  );
}
