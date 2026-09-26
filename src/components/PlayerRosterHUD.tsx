/**
 * 多人對戰遊戲內名單：房間碼 + 各陣營玩家在線狀態 + 房主斷線警示。
 * 單人模式不渲染。
 */
import { useSyncExternalStore } from "react";
import { Crown, WifiOff, LogOut } from "lucide-react";
import { netStore } from "../wargame/net/netStore";
import { roomSession } from "../wargame/net/session";
import { uiStore } from "../wargame/uiStore";
import { SIDE_COLORS } from "../wargame/symbology/sideColors";

export function PlayerRosterHUD({ isMobile = false, top }: { isMobile?: boolean; top?: number }) {
  const net = useSyncExternalStore(netStore.subscribe, netStore.get, netStore.get);
  if (net.role === "off" || !net.room || net.room.status === "lobby") return null;

  const hostId = net.room.host_user_id;
  const hostDown = net.role === "client" && !net.hostOnline;

  return (
    <div style={{
      position: "absolute",
      top: top ?? (isMobile ? 56 : 76), left: isMobile ? 8 : 16,
      zIndex: 21,
      padding: isMobile ? "6px 8px" : "8px 12px",
      background: "rgba(15, 23, 42, 0.88)",
      backdropFilter: "blur(6px)",
      border: `1px solid ${hostDown ? "#ef4444" : "rgba(148, 163, 184, 0.3)"}`,
      borderRadius: 8,
      color: "#e2e8f0",
      fontFamily: "ui-sans-serif, system-ui, sans-serif",
      fontSize: isMobile ? 12 : 14,
      minWidth: isMobile ? 0 : 200,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 4 }}>
        <span style={{ color: "#94a3b8" }}>房間</span>
        <code style={{ color: "#fbbf24", fontWeight: 700, letterSpacing: 2 }}>{net.room.code}</code>
        <span style={{ color: "#64748b", fontSize: 12 }}>
          {net.role === "host" ? "房主" : net.mySideId ? "玩家" : "觀戰"}
        </span>
        <button
          title="離開房間，回主選單"
          onClick={() => { void roomSession.leaveRoom(); uiStore.setLandingOpen(true); }}
          style={{ marginLeft: "auto", background: "none", border: "none", color: "#94a3b8", cursor: "pointer", padding: 2 }}
        ><LogOut size={14} /></button>
      </div>
      {hostDown && (
        <div style={{ color: "#fca5a5", display: "flex", alignItems: "center", gap: 6, marginBottom: 4 }}>
          <WifiOff size={14} /> 房主離線，等待重新連線…
        </div>
      )}
      {net.players.map((p) => {
        const on = net.online.includes(p.user_id);
        const c = p.side_id ? SIDE_COLORS[p.side_id].primary : "#64748b";
        return (
          <div key={p.user_id} style={{ display: "flex", alignItems: "center", gap: 6, opacity: on ? 1 : 0.5 }}>
            <span style={{ width: 8, height: 8, borderRadius: "50%", background: on ? "#22c55e" : "#475569" }} />
            <span style={{ width: 8, height: 8, borderRadius: 2, background: c }} />
            <span style={{ fontWeight: p.user_id === net.myUserId ? 700 : 400 }}>{p.display_name}</span>
            {p.user_id === hostId && <Crown size={12} color="#fbbf24" />}
            <span style={{ color: "#64748b", marginLeft: "auto", fontSize: 12 }}>{p.side_id ?? "觀戰"}</span>
          </div>
        );
      })}
      {net.error && <div style={{ color: "#fca5a5", fontSize: 12, marginTop: 4, maxWidth: 260 }}>{net.error}</div>}
    </div>
  );
}
