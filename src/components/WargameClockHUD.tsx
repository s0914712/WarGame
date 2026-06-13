import { useEffect, useSyncExternalStore } from "react";
import { Play, Pause, Eye, EyeOff } from "lucide-react";
import { useWargameClock } from "../hooks/useWargameClock";
import { SIM_RATE_PRESETS } from "../wargame/clock";
import { scenarioStore } from "../wargame/scenarioStore";
import { netStore } from "../wargame/net/netStore";

/**
 * 左上 T+ 顯示 + 播放 / 暫停 / 速率切換。
 *
 * 鍵盤：Space 切換暫停，1/2/3/4 快速切換速率。
 */
function getFowSnapshot(): boolean {
  return scenarioStore.isFogOfWar();
}

export function WargameClockHUD({ isMobile = false }: { isMobile?: boolean } = {}) {
  const { tPlus, rate, isPaused, toggle, setRate } = useWargameClock();
  const fogOfWar = useSyncExternalStore(scenarioStore.subscribe, getFowSnapshot, getFowSnapshot);
  // 多人 guest：時鐘由主機控制，本端只讀；顯示主機的播放/暫停狀態
  const isGuest = useSyncExternalStore(netStore.subscribe, () => netStore.isGuest(), () => netStore.isGuest());
  const hostPaused = useSyncExternalStore(netStore.subscribe, () => netStore.getState().hostPaused, () => netStore.getState().hostPaused);
  const displayPaused = isGuest ? hostPaused : isPaused;
  const doToggle = () => { if (!isGuest) toggle(); };
  const doSetRate = (r: number) => { if (!isGuest) setRate(r); };

  useEffect(() => {
    if (isGuest) return;   // guest 不接受本地鍵盤時鐘控制
    const onKey = (e: KeyboardEvent) => {
      if (e.target && (e.target as HTMLElement).tagName === "INPUT") return;
      if (e.code === "Space") {
        e.preventDefault();
        toggle();
        return;
      }
      const idx = ["Digit1", "Digit2", "Digit3", "Digit4"].indexOf(e.code);
      const preset = idx >= 0 ? SIM_RATE_PRESETS[idx] : undefined;
      if (preset !== undefined) {
        e.preventDefault();
        setRate(preset);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggle, setRate, isGuest]);

  return (
    <div
      style={isMobile ? {
        display: "flex",
        alignItems: "center",
        flexWrap: "wrap",
        gap: 8,
        color: "#e2e8f0",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        userSelect: "none",
      } : {
        position: "absolute",
        top: 16,
        left: 16,
        zIndex: 20,
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "10px 16px",
        background: "rgba(15, 23, 42, 0.85)",
        backdropFilter: "blur(6px)",
        border: "1px solid rgba(148, 163, 184, 0.3)",
        borderRadius: 8,
        color: "#e2e8f0",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        userSelect: "none",
      }}
    >
      <button
        onClick={doToggle}
        disabled={isGuest}
        title={isGuest ? "時鐘由主機控制" : (displayPaused ? "繼續（Space）" : "暫停（Space）")}
        className="wg-btn"
        style={{
          width: isMobile ? 36 : 42,
          height: isMobile ? 36 : 42,
          borderRadius: 6,
          border: "1px solid rgba(148, 163, 184, 0.4)",
          background: displayPaused ? "#3B82F6" : "rgba(30, 41, 59, 0.6)",
          color: "#fff",
          cursor: isGuest ? "not-allowed" : "pointer",
          opacity: isGuest ? 0.5 : 1,
          display: "flex", alignItems: "center", justifyContent: "center",
        }}
      >
        {displayPaused
          ? <Play size={isMobile ? 16 : 18} fill="currentColor" />
          : <Pause size={isMobile ? 16 : 18} fill="currentColor" />
        }
      </button>

      <div style={{ fontSize: isMobile ? 18 : 40, fontWeight: 700, letterSpacing: 1, minWidth: isMobile ? 76 : 170 }}>
        {tPlus}
      </div>

      <div style={{ display: "flex", gap: 4 }}>
        {SIM_RATE_PRESETS.map((r) => (
          <button
            key={r}
            onClick={() => doSetRate(r)}
            disabled={isGuest}
            className="wg-btn"
            style={{
              padding: isMobile ? "3px 7px" : "6px 12px",
              borderRadius: 4,
              border: "1px solid rgba(148, 163, 184, 0.4)",
              background: r === rate ? "#3B82F6" : "rgba(30, 41, 59, 0.4)",
              color: r === rate ? "#fff" : "#cbd5e1",
              fontSize: isMobile ? 13 : 19,
              fontWeight: 600,
              cursor: isGuest ? "not-allowed" : "pointer",
              opacity: isGuest ? 0.5 : 1,
              fontFamily: "inherit",
            }}
          >
            {r}x
          </button>
        ))}
      </div>

      {displayPaused && !isMobile && (
        <span
          className="wg-blink"
          style={{
            fontSize: 15,
            padding: "3px 10px",
            borderRadius: 4,
            background: "rgba(251, 191, 36, 0.2)",
            color: "#fbbf24",
            border: "1px solid rgba(251, 191, 36, 0.4)",
            fontWeight: 700,
            letterSpacing: 1,
          }}
        >
          PAUSED
        </span>
      )}

      {/* 戰爭迷霧切換（多人 guest 隱藏：須維持嚴格 FoW） */}
      {!isGuest && (
      <button
        onClick={() => scenarioStore.setFogOfWar(!fogOfWar)}
        title={fogOfWar ? "FoW 開：敵方未偵測 = 不顯示" : "FoW 關：敵方淡化顯示（除錯）"}
        className="wg-btn"
        style={{
          marginLeft: 4,
          padding: isMobile ? "4px 8px" : "6px 10px",
          borderRadius: 4,
          border: `1px solid ${fogOfWar ? "rgba(34, 197, 94, 0.5)" : "rgba(148, 163, 184, 0.4)"}`,
          background: fogOfWar ? "rgba(34, 197, 94, 0.25)" : "rgba(30, 41, 59, 0.4)",
          color: fogOfWar ? "#86efac" : "#94a3b8",
          fontSize: isMobile ? 13 : 17,
          fontWeight: 600,
          cursor: "pointer",
          fontFamily: "inherit",
          display: "flex", alignItems: "center", gap: 5,
        }}
      >
        {fogOfWar ? <EyeOff size={14} /> : <Eye size={14} />}
        FoW
      </button>
      )}
    </div>
  );
}
