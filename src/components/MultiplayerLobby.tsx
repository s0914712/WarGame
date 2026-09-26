/**
 * 多人對戰大廳（LandingScreen 內的一個 pane）。
 *
 *   未設定 env → 提示
 *   未登入     → AuthPanel
 *   無房間     → 建房（選場景）/ 輸入房間碼 / 回到進行中的房間
 *   在房間內   → 陣營認領 + 準備 + host 開始
 *   status=running → onMatchStart()（LandingScreen 負責關閉選單 + 飛鏡頭）
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ArrowLeft, Copy, Crown, LogOut, Play, UserX, Check, Globe } from "lucide-react";
import type { Scenario, SideId } from "../wargame/types";
import { wgSupabaseConfigured } from "../wargame/net/wgSupabase";
import { authStore } from "../wargame/net/authStore";
import { netStore, type RoomRow } from "../wargame/net/netStore";
import { roomSession, claimableSides, scenarioById } from "../wargame/net/session";
import { SCENARIO_REGISTRY } from "../wargame/scenarios/registry";
import { SIDE_COLORS } from "../wargame/symbology/sideColors";
import { AuthPanel, btnStyle, inputStyle } from "./AuthPanel";

interface Props {
  isMobile: boolean;
  onBack: () => void;
  onMatchStart: (scenario: Scenario, isHost: boolean) => void;
}

const card: React.CSSProperties = {
  padding: 16, borderRadius: 8,
  background: "rgba(30, 41, 59, 0.5)",
  border: "1px solid rgba(148, 163, 184, 0.2)",
};

const heading: React.CSSProperties = {
  fontSize: 15, color: "#60a5fa", letterSpacing: 1, fontWeight: 600, marginBottom: 10,
};

export function MultiplayerLobby({ isMobile, onBack, onMatchStart }: Props) {
  const auth = useSyncExternalStore(authStore.subscribe, authStore.get, authStore.get);
  const net = useSyncExternalStore(netStore.subscribe, netStore.get, netStore.get);

  // 房間進入 running → 通知 LandingScreen（只觸發一次）
  const startedRoomRef = useRef<string | null>(null);
  useEffect(() => {
    if (!net.room || net.room.status === "lobby") return;
    if (startedRoomRef.current === net.room.id) return;
    const scenario = scenarioById(net.room.scenario_id);
    if (!scenario) return;
    startedRoomRef.current = net.room.id;
    onMatchStart(scenario, net.role === "host");
  }, [net.room, net.role, onMatchStart]);

  return (
    <div>
      <button
        onClick={onBack}
        className="wg-btn"
        style={{
          background: "transparent", border: "none", color: "#94a3b8", fontSize: 16,
          cursor: "pointer", display: "flex", alignItems: "center", gap: 4, marginBottom: 14,
        }}
      >
        <ArrowLeft size={14} /> 回主選單
      </button>

      {!wgSupabaseConfigured ? (
        <div style={{ ...card, color: "#fca5a5" }}>
          多人模式尚未設定：請在 <code>.env</code> 加入 <code>VITE_WG_SUPABASE_URL</code> 與
          <code> VITE_WG_SUPABASE_ANON_KEY</code> 後重新啟動。
        </div>
      ) : !auth.ready ? (
        <div style={{ color: "#94a3b8" }}>載入登入狀態…</div>
      ) : !auth.userId ? (
        <AuthPanel />
      ) : (
        <>
          <UserBar name={auth.displayName ?? ""} email={auth.email} />
          {net.error && (
            <div style={{ color: "#fca5a5", fontSize: 14, margin: "10px 0" }}>
              {net.error}
            </div>
          )}
          {net.room ? <RoomView isMobile={isMobile} /> : <NoRoomView />}
        </>
      )}
    </div>
  );
}

// ── 使用者列 ──
function UserBar({ name, email }: { name: string; email: string | null }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(name);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 16, flexWrap: "wrap" }}>
      <span style={{ color: "#94a3b8", fontSize: 14 }}>玩家</span>
      {editing ? (
        <>
          <input value={draft} onChange={(e) => setDraft(e.target.value)} style={{ ...inputStyle, maxWidth: 200, flex: "none" }} />
          <button className="wg-btn" style={btnStyle("#22c55e")} onClick={async () => {
            const err = await authStore.setDisplayName(draft);
            if (!err) setEditing(false);
          }}><Check size={14} /></button>
        </>
      ) : (
        <button className="wg-btn" onClick={() => { setDraft(name); setEditing(true); }}
          style={{ background: "none", border: "none", color: "#e2e8f0", fontSize: 17, fontWeight: 700, cursor: "pointer" }}
          title="點擊改名（進房前修改才會套用）">
          {name}
        </button>
      )}
      <span style={{ color: "#64748b", fontSize: 13 }}>{email}</span>
      <button className="wg-btn" style={{ ...btnStyle("#64748b"), marginLeft: "auto", padding: "6px 10px" }}
        onClick={() => void authStore.signOut()}>
        <LogOut size={14} /> 登出
      </button>
    </div>
  );
}

// ── 建房 / 加入 ──
function NoRoomView() {
  const [scenarioId, setScenarioId] = useState(SCENARIO_REGISTRY[0]?.scenario.id ?? "");
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [activeRooms, setActiveRooms] = useState<RoomRow[]>([]);

  useEffect(() => {
    let alive = true;
    void roomSession.findMyActiveRooms().then((r) => { if (alive) setActiveRooms(r); });
    return () => { alive = false; };
  }, []);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setErr(null); netStore.set({ error: null });
    try { await fn(); } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      {activeRooms.length > 0 && (
        <div style={card}>
          <div style={heading}>進行中的房間</div>
          {activeRooms.map((r) => (
            <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
              <code style={{ fontSize: 16, color: "#fbbf24" }}>{r.code}</code>
              <span style={{ color: "#cbd5e1" }}>{scenarioById(r.scenario_id)?.displayName ?? r.scenario_id}</span>
              <span style={{ color: "#64748b", fontSize: 13 }}>{r.status === "running" ? "對戰中" : "大廳"}</span>
              <button className="wg-btn" disabled={busy} style={{ ...btnStyle("#22c55e", busy), marginLeft: "auto" }}
                onClick={() => run(() => roomSession.rejoin(r))}>回到房間</button>
            </div>
          ))}
        </div>
      )}

      <div style={card}>
        <div style={heading}>建立房間</div>
        <select
          value={scenarioId}
          onChange={(e) => setScenarioId(e.target.value)}
          style={{ ...inputStyle, width: "100%", marginBottom: 10 }}
        >
          {SCENARIO_REGISTRY.map((e) => (
            <option key={e.scenario.id} value={e.scenario.id}>
              {e.scenario.displayName} — {e.shortDescription}
            </option>
          ))}
        </select>
        <button className="wg-btn" disabled={busy || !scenarioId} style={btnStyle("#3b82f6", busy)}
          onClick={() => run(() => roomSession.createRoom(scenarioId))}>
          <Crown size={16} /> 建立並擔任房主
        </button>
      </div>

      <div style={card}>
        <div style={heading}>加入房間</div>
        <div style={{ display: "flex", gap: 8 }}>
          <input
            placeholder="6 碼房間碼"
            value={code}
            maxLength={6}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            onKeyDown={(e) => { if (e.key === "Enter" && code.length === 6) void run(() => roomSession.joinRoom(code)); }}
            style={{ ...inputStyle, fontFamily: "ui-monospace, monospace", letterSpacing: 4, textTransform: "uppercase" }}
          />
          <button className="wg-btn" disabled={busy || code.length !== 6} style={btnStyle("#a78bfa", busy || code.length !== 6)}
            onClick={() => run(() => roomSession.joinRoom(code))}>
            加入
          </button>
        </div>
      </div>

      {err && <div style={{ color: "#fca5a5", fontSize: 14 }}>{err}</div>}
    </div>
  );
}

// ── 房間內 ──
function RoomView({ isMobile }: { isMobile: boolean }) {
  const net = useSyncExternalStore(netStore.subscribe, netStore.get, netStore.get);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const room = net.room!;
  const scenario = scenarioById(room.scenario_id);
  const sides = claimableSides(room.scenario_id);
  const isHost = net.role === "host";
  const me = net.players.find((p) => p.user_id === net.myUserId);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true); setErr(null);
    try { await fn(); } catch (e) { setErr((e as Error).message); }
    setBusy(false);
  };

  const sidePlayers = (sideId: SideId) => net.players.find((p) => p.side_id === sideId);
  const spectators = net.players.filter((p) => !p.side_id);
  const seated = net.players.filter((p) => p.side_id);
  const allReady = seated.length > 0 && seated.every((p) => p.ready || p.user_id === room.host_user_id);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ ...card, display: "flex", alignItems: "center", gap: 14, flexWrap: "wrap" }}>
        <div>
          <div style={{ fontSize: 13, color: "#94a3b8" }}>房間碼</div>
          <div style={{ fontSize: isMobile ? 26 : 34, fontWeight: 800, letterSpacing: 6, color: "#fbbf24", fontFamily: "ui-monospace, monospace" }}>
            {room.code}
          </div>
        </div>
        <button className="wg-btn" style={btnStyle("#64748b")}
          onClick={() => void navigator.clipboard?.writeText(room.code)}>
          <Copy size={14} /> 複製
        </button>
        <div style={{ marginLeft: isMobile ? 0 : "auto" }}>
          <div style={{ fontSize: 13, color: "#94a3b8" }}>場景</div>
          <div style={{ fontSize: 17, fontWeight: 600 }}>{scenario?.displayName ?? room.scenario_id}</div>
        </div>
        <ConnDot status={net.connection} />
      </div>

      <div style={card}>
        <div style={heading}>陣營（點擊認領，一個陣營限一人）</div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {sides.map((s) => {
            const owner = sidePlayers(s.id);
            const mine = owner?.user_id === net.myUserId;
            const c = SIDE_COLORS[s.id].primary;
            return (
              <div key={s.id} style={{
                display: "flex", alignItems: "center", gap: 10, padding: "10px 12px", borderRadius: 6,
                border: `1px solid ${mine ? c : "rgba(148,163,184,0.25)"}`,
                background: mine ? `${c}22` : "rgba(2,6,23,0.35)",
              }}>
                <span style={{ width: 12, height: 12, borderRadius: "50%", background: c }} />
                <span style={{ fontWeight: 700, minWidth: 110 }}>{s.displayName}</span>
                <span style={{ color: owner ? "#e2e8f0" : "#64748b", flex: 1 }}>
                  {owner ? <PlayerName p={owner} hostId={room.host_user_id} online={net.online} /> : (s.ownership === "ai" ? "空位（AI / 腳本）" : "空位（腳本）")}
                </span>
                {owner && owner.user_id !== room.host_user_id && (
                  <span style={{ fontSize: 13, color: owner.ready ? "#86efac" : "#64748b" }}>
                    {owner.ready ? "已準備" : "未準備"}
                  </span>
                )}
                {!owner && (
                  <button className="wg-btn" disabled={busy} style={btnStyle(c, busy)}
                    onClick={() => run(() => roomSession.claimSide(s.id))}>認領</button>
                )}
                {mine && (
                  <button className="wg-btn" disabled={busy} style={btnStyle("#64748b", busy)}
                    onClick={() => run(() => roomSession.claimSide(null))}>離開陣營</button>
                )}
                {isHost && owner && !mine && (
                  <button className="wg-btn" title="踢出房間" style={{ ...btnStyle("#ef4444"), padding: "6px 8px" }}
                    onClick={() => run(() => roomSession.kick(owner.user_id))}><UserX size={14} /></button>
                )}
              </div>
            );
          })}
        </div>
        <div style={{ marginTop: 12, fontSize: 14, color: "#94a3b8", display: "flex", alignItems: "center", gap: 6, flexWrap: "wrap" }}>
          <Globe size={14} /> 觀戰：
          {spectators.length === 0 ? "—" : spectators.map((p, i) => (
            <span key={p.user_id}>{i > 0 && "、"}<PlayerName p={p} hostId={room.host_user_id} online={net.online} /></span>
          ))}
        </div>
      </div>

      <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
        {isHost ? (
          <button className="wg-btn" disabled={busy || !allReady}
            style={{ ...btnStyle("#3b82f6", busy || !allReady), fontSize: 18, padding: "12px 24px" }}
            title={allReady ? "" : "所有已認領陣營的玩家都要按準備"}
            onClick={() => run(() => roomSession.startMatch())}>
            <Play size={16} fill="currentColor" /> 開始對戰
          </button>
        ) : me?.side_id ? (
          <button className="wg-btn" disabled={busy} style={{ ...btnStyle(me.ready ? "#64748b" : "#22c55e", busy), fontSize: 18, padding: "12px 24px" }}
            onClick={() => run(() => roomSession.setReady(!me.ready))}>
            <Check size={16} /> {me.ready ? "取消準備" : "準備"}
          </button>
        ) : (
          <div style={{ color: "#94a3b8", alignSelf: "center" }}>認領陣營即可參戰，或保持觀戰。等待房主開始…</div>
        )}
        <button className="wg-btn" style={{ ...btnStyle("#ef4444"), marginLeft: "auto" }}
          onClick={() => void roomSession.leaveRoom()}>
          <LogOut size={14} /> {isHost ? "解散房間" : "離開房間"}
        </button>
      </div>
      {err && <div style={{ color: "#fca5a5", fontSize: 14 }}>{err}</div>}
    </div>
  );
}

function PlayerName({ p, hostId, online }: { p: { user_id: string; display_name: string }; hostId: string; online: string[] }) {
  const on = online.includes(p.user_id);
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
      <span style={{ width: 7, height: 7, borderRadius: "50%", background: on ? "#22c55e" : "#475569" }} />
      {p.display_name}
      {p.user_id === hostId && <Crown size={13} color="#fbbf24" />}
    </span>
  );
}

function ConnDot({ status }: { status: string }) {
  const color = status === "connected" ? "#22c55e" : status === "error" ? "#ef4444" : "#fbbf24";
  const label = status === "connected" ? "已連線" : status === "error" ? "連線錯誤" : "連線中";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 13, color: "#94a3b8" }}>
      <span style={{ width: 8, height: 8, borderRadius: "50%", background: color }} /> {label}
    </span>
  );
}
