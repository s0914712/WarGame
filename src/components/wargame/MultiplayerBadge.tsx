/**
 * 多人對戰狀態徽章 — netStore.active 時顯示房號 / 角色 / 連線 / 對手在線 / 離開鈕。
 * netStore 非 active 時回傳 null。
 */
import { useSyncExternalStore } from "react";
import { Wifi, WifiOff, LogOut, Copy } from "lucide-react";
import { netStore } from "../../wargame/net/netStore";
import { netStop } from "../../wargame/net/sync";
import { SIDE_COLORS } from "../../wargame/symbology/sideColors";
import { uiStore } from "../../wargame/uiStore";

function snap() { return netStore.getState(); }

export function MultiplayerBadge() {
  const s = useSyncExternalStore(netStore.subscribe, snap, snap);
  if (!s.active) return null;

  const sideColor = s.mySide ? SIDE_COLORS[s.mySide].primary : "#94a3b8";
  const roleLabel = s.role === "host" ? "主機（藍）" : "客戶端（紅）";

  const leave = () => {
    netStop();
    uiStore.setLandingOpen(true);
  };
  const copyCode = () => { if (s.roomId) void navigator.clipboard?.writeText(s.roomId); };

  return (
    <div style={{
      position: "absolute", top: 12, left: "50%", transform: "translateX(-50%)", zIndex: 40,
      display: "flex", alignItems: "center", gap: 10,
      padding: "6px 12px", borderRadius: 999,
      background: "rgba(15,23,42,0.92)", border: `1px solid ${sideColor}66`,
      color: "#e2e8f0", fontFamily: "ui-sans-serif, system-ui, sans-serif", fontSize: 14,
      boxShadow: "0 6px 20px rgba(0,0,0,0.4)",
    }}>
      {s.connected
        ? <Wifi size={15} color={s.opponentPresent ? "#34d399" : "#fbbf24"} />
        : <WifiOff size={15} color="#f87171" />}
      <span style={{ fontWeight: 700, color: sideColor }}>{roleLabel}</span>
      <button onClick={copyCode} title="複製房號" style={{
        display: "flex", alignItems: "center", gap: 4, cursor: "pointer",
        background: "rgba(148,163,184,0.15)", border: "1px solid rgba(148,163,184,0.3)",
        borderRadius: 6, color: "#e2e8f0", padding: "2px 8px", fontFamily: "ui-monospace, monospace",
        fontSize: 14, letterSpacing: 2, fontWeight: 700,
      }}>
        {s.roomId} <Copy size={12} />
      </button>
      <span style={{ color: s.opponentPresent ? "#86efac" : "#94a3b8", fontSize: 13 }}>
        {s.connected ? (s.opponentPresent ? "對手在線" : "等待對手…") : "連線中…"}
      </span>
      {s.role === "guest" && (
        <span style={{ color: "#cbd5e1", fontSize: 13 }}>
          {s.hostPaused ? "⏸ 主機暫停" : "▶ 進行中"}
        </span>
      )}
      <button onClick={leave} title="離開連線" style={{
        display: "flex", alignItems: "center", cursor: "pointer",
        background: "transparent", border: "none", color: "#f87171", padding: 2,
      }}>
        <LogOut size={15} />
      </button>
    </div>
  );
}
