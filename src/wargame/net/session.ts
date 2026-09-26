/**
 * 多人房間生命週期（module singleton，非 React hook — 跨 Landing / 遊戲畫面存活）。
 *
 *   createRoom / joinRoom → enterRoom：訂閱 players / room 變更 + presence
 *   room.status 變 running → beginMatch：載場景、依 role 啟動 host loops 或 client applier
 *   leaveRoom：全部退訂、回單人模式
 *
 * Realtime topics（對應 migration 的 realtime.messages policy）：
 *   wg:room:<id>:presence — 所有成員 track
 *   wg:room:<id>:state    — 只有 host 能送 snapshot
 */
import type { RealtimeChannel } from "@supabase/supabase-js";
import type { SideId } from "../types";
import { wgSupabase } from "./wgSupabase";
import { authStore } from "./authStore";
import { netStore, type PlayerRow, type RoomRow } from "./netStore";
import { acceptRemoteCommand } from "./commandBus";
import { buildSnapshot, clientApplier, restoreFullState, type StateSnapshot } from "./snapshot";
import { scenarioStore } from "../scenarioStore";
import { wargameClock } from "../clock";
import { viewStore } from "../viewStore";
import { SCENARIO_REGISTRY } from "../scenarios/registry";

const BROADCAST_MS = 500;
const BROADCAST_PAUSED_MS = 2000;
const KEYFRAME_EVERY = 20;          // 每 20 則送一次全量 events
const DB_SNAPSHOT_MS = 30_000;

let dbChannel: RealtimeChannel | null = null;
let presenceChannel: RealtimeChannel | null = null;
let stateChannel: RealtimeChannel | null = null;
let hostTimers: number[] = [];
let matchStarted = false;

// ── helpers ─────────────────────────────────────────────────────

function sb() {
  if (!wgSupabase) throw new Error("多人模式未設定（缺 VITE_WG_SUPABASE_URL / ANON_KEY）");
  return wgSupabase;
}

function requireUser(): string {
  const uid = authStore.get().userId;
  if (!uid) throw new Error("請先登入");
  return uid;
}

async function fetchPlayers(roomId: string): Promise<PlayerRow[]> {
  const { data, error } = await sb()
    .from("wg_room_players")
    .select("room_id, user_id, display_name, side_id, ready")
    .eq("room_id", roomId)
    .order("joined_at");
  if (error) throw error;
  return (data ?? []) as PlayerRow[];
}

async function fetchRoom(roomId: string): Promise<RoomRow | null> {
  const { data, error } = await sb().from("wg_rooms").select("*").eq("id", roomId).maybeSingle();
  if (error) throw error;
  return data as RoomRow | null;
}

export function scenarioById(id: string) {
  return SCENARIO_REGISTRY.find((e) => e.scenario.id === id)?.scenario ?? null;
}

/** 場景中可由玩家認領的陣營（與單人 CampaignPane 同規則） */
export function claimableSides(scenarioId: string) {
  const s = scenarioById(scenarioId);
  return s ? s.sides.filter((x) => x.isHostileTo.length > 0 || x.isPlayer) : [];
}

// ── public API ──────────────────────────────────────────────────

export const roomSession = {
  async createRoom(scenarioId: string): Promise<void> {
    requireUser();
    const { data, error } = await sb().rpc("wg_create_room", { p_scenario_id: scenarioId });
    if (error) throw error;
    await enterRoom(data as RoomRow);
  },

  async joinRoom(code: string): Promise<void> {
    requireUser();
    const { data, error } = await sb().rpc("wg_join_room", { p_code: code });
    if (error) throw new Error(error.message === "room not found" ? "找不到房間" : error.message);
    await enterRoom(data as RoomRow);
  },

  /** 自己仍在、且未結束的房間（重新整理頁面後可一鍵回去） */
  async findMyActiveRooms(): Promise<RoomRow[]> {
    const uid = authStore.get().userId;
    if (!wgSupabase || !uid) return [];
    const { data } = await wgSupabase
      .from("wg_rooms")
      .select("*, wg_room_players!inner(user_id)")
      .eq("wg_room_players.user_id", uid)
      .neq("status", "ended")
      .order("created_at", { ascending: false })
      .limit(5);
    return (data ?? []).map(({ wg_room_players: _p, ...r }) => r as RoomRow);
  },

  async rejoin(room: RoomRow): Promise<void> {
    await enterRoom(room);
  },

  async claimSide(sideId: SideId | null): Promise<void> {
    const net = netStore.get();
    if (!net.room || !net.myUserId) return;
    const { error } = await sb()
      .from("wg_room_players")
      .update({ side_id: sideId, ready: false })
      .eq("room_id", net.room.id).eq("user_id", net.myUserId);
    if (error) {
      throw new Error(error.code === "23505" ? "該陣營已被其他玩家認領" : error.message);
    }
    await refreshPlayers();
  },

  async setReady(ready: boolean): Promise<void> {
    const net = netStore.get();
    if (!net.room || !net.myUserId) return;
    const { error } = await sb()
      .from("wg_room_players")
      .update({ ready })
      .eq("room_id", net.room.id).eq("user_id", net.myUserId);
    if (error) throw error;
    await refreshPlayers();
  },

  async startMatch(): Promise<void> {
    const net = netStore.get();
    if (!net.room || net.role !== "host") return;
    const { error } = await sb()
      .from("wg_rooms").update({ status: "running" }).eq("id", net.room.id);
    if (error) throw error;
    // room UPDATE 事件會觸發 beginMatch；這裡也直接跑一次以免 Realtime 慢
    const room = await fetchRoom(net.room.id);
    if (room) onRoomChanged(room);
  },

  async kick(userId: string): Promise<void> {
    const net = netStore.get();
    if (!net.room || net.role !== "host") return;
    await sb().from("wg_room_players").delete().eq("room_id", net.room.id).eq("user_id", userId);
    await refreshPlayers();
  },

  async leaveRoom(): Promise<void> {
    const net = netStore.get();
    const room = net.room;
    teardown();
    if (room && wgSupabase && net.myUserId && room.status === "lobby") {
      if (net.role === "host") await wgSupabase.from("wg_rooms").delete().eq("id", room.id);
      else await wgSupabase.from("wg_room_players").delete()
        .eq("room_id", room.id).eq("user_id", net.myUserId);
    }
    netStore.reset();
  },
};

// ── lifecycle ───────────────────────────────────────────────────

async function enterRoom(room: RoomRow): Promise<void> {
  teardown();
  const uid = requireUser();
  const client = sb();
  netStore.set({
    role: room.host_user_id === uid ? "host" : "client",
    room, myUserId: uid, players: await fetchPlayers(room.id),
    online: [], connection: "connecting", error: null,
  });

  // 私有 channel 需要帶使用者 JWT
  await client.realtime.setAuth();

  dbChannel = client
    .channel(`wg-db-${room.id}`)
    .on("postgres_changes",
      { event: "*", schema: "public", table: "wg_room_players", filter: `room_id=eq.${room.id}` },
      () => void refreshPlayers())
    // DELETE 事件無法 filter；old 只帶 PK（含 room_id）
    .on("postgres_changes",
      { event: "DELETE", schema: "public", table: "wg_room_players" },
      (p) => { if ((p.old as { room_id?: string }).room_id === room.id) void refreshPlayers(); })
    .on("postgres_changes",
      { event: "UPDATE", schema: "public", table: "wg_rooms", filter: `id=eq.${room.id}` },
      (p) => onRoomChanged(p.new as RoomRow))
    .on("postgres_changes",
      { event: "DELETE", schema: "public", table: "wg_rooms" },
      (p) => {
        if ((p.old as { id?: string }).id !== room.id) return;
        teardown();
        netStore.reset();
        netStore.set({ error: "房主已解散房間" });
      });
  if (room.host_user_id === uid) {
    dbChannel.on("postgres_changes",
      { event: "INSERT", schema: "public", table: "wg_commands", filter: `room_id=eq.${room.id}` },
      (p) => acceptRemoteCommand(p.new as { user_id: string; side_id: string; payload: unknown }));
  }
  dbChannel.subscribe();

  presenceChannel = client.channel(`wg:room:${room.id}:presence`, {
    config: { private: true, presence: { key: uid } },
  });
  presenceChannel
    .on("presence", { event: "sync" }, () => {
      const online = Object.keys(presenceChannel?.presenceState() ?? {});
      netStore.set({ online });
      // client：房主離線 → 凍結本機時鐘顯示
      if (netStore.isClient() && !netStore.get().hostOnline) wargameClock.pause();
    })
    .subscribe(async (status) => {
      if (status === "SUBSCRIBED") {
        netStore.set({ connection: "connected" });
        await presenceChannel?.track({ user_id: uid, at: Date.now() });
      } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
        netStore.set({ connection: "error", error: `Realtime 連線失敗（${status}）` });
      }
    });

  if (room.status === "running") onRoomChanged(room);
}

async function refreshPlayers(): Promise<void> {
  const room = netStore.get().room;
  if (!room) return;
  try {
    const players = await fetchPlayers(room.id);
    const me = netStore.get().myUserId;
    // 被踢
    if (me && !players.some((p) => p.user_id === me)) {
      teardown();
      netStore.reset();
      netStore.set({ error: "你已離開房間" });
      return;
    }
    netStore.set({ players });
  } catch (e) {
    netStore.set({ error: (e as Error).message });
  }
}

function onRoomChanged(room: RoomRow): void {
  const net = netStore.get();
  if (!net.room || net.room.id !== room.id) return;
  netStore.set({ room: { ...net.room, ...room } });
  if (room.status !== "lobby" && !matchStarted) beginMatch(room);
}

function beginMatch(room: RoomRow): void {
  const scenario = scenarioById(room.scenario_id);
  if (!scenario) {
    netStore.set({ error: `未知場景 ${room.scenario_id}` });
    return;
  }
  matchStarted = true;
  wargameClock.reset();
  scenarioStore.loadScenario(scenario);
  const net = netStore.get();
  viewStore.setActiveView(net.mySideId ?? "spectator");
  // 陣營玩家強制 FoW（旁觀者可自行切換）
  if (net.mySideId) scenarioStore.setFogOfWar(true);

  if (net.role === "host") {
    void resumeHost(room.id);
  } else {
    startClient(room.id);
  }
}

// ── host ────────────────────────────────────────────────────────

/** Host 重新整理頁面後：從 wg_room_snapshots 還原再開始廣播 */
async function resumeHost(roomId: string): Promise<void> {
  const { data } = await sb()
    .from("wg_room_snapshots").select("snapshot").eq("room_id", roomId).maybeSingle();
  if (data?.snapshot) restoreFullState(data.snapshot as StateSnapshot);
  startHostLoops(roomId);
}

function startHostLoops(roomId: string): void {
  const client = sb();
  stateChannel = client.channel(`wg:room:${roomId}:state`, { config: { private: true } });
  stateChannel.subscribe();

  const epoch = crypto.randomUUID();
  let seq = 0;
  let sentEvents = 0;
  let lastSentAt = 0;
  let resultSaved = false;
  let wasPaused = wargameClock.isPaused();

  const broadcast = () => {
    // 房主按暫停 → 立即存重連快照（不必等 30s 週期）
    const paused = wargameClock.isPaused();
    if (paused && !wasPaused) saveDb();
    wasPaused = paused;

    const now = performance.now();
    const gap = wargameClock.isPaused() ? BROADCAST_PAUSED_MS : BROADCAST_MS;
    if (now - lastSentAt < gap - 20) return;
    lastSentAt = now;
    const state = scenarioStore.getState();
    seq += 1;
    const from = seq % KEYFRAME_EVERY === 0 ? 0 : Math.min(sentEvents, state.eventsAll.length);
    const snap = buildSnapshot(state, epoch, seq, from);
    sentEvents = state.eventsAll.length;
    void stateChannel?.send({ type: "broadcast", event: "snap", payload: snap });

    if (state.outcome && !resultSaved) {
      resultSaved = true;
      void saveResult(roomId, snap);
    }
  };

  const saveDb = () => {
    const state = scenarioStore.getState();
    const snap = buildSnapshot(state, epoch, seq, 0);
    // PostgREST builder 是 lazy thenable：必須 .then() 才會真的送出請求
    client.from("wg_room_snapshots")
      .upsert({ room_id: roomId, snapshot: snap, updated_at: new Date().toISOString() })
      .then(({ error }) => {
        if (error) console.warn("[wargame/net] snapshot save failed", error.message);
      });
  };

  hostTimers.push(window.setInterval(broadcast, 100));
  hostTimers.push(window.setInterval(saveDb, DB_SNAPSHOT_MS));
}

async function saveResult(roomId: string, snap: StateSnapshot): Promise<void> {
  const client = sb();
  const net = netStore.get();
  await client.from("wg_room_snapshots")
    .upsert({ room_id: roomId, snapshot: snap, updated_at: new Date().toISOString() });
  await client.from("wg_rooms").update({ status: "ended" }).eq("id", roomId);
  await client.from("wg_match_results").insert({
    room_id: roomId,
    scenario_id: snap.scenarioId,
    outcome: snap.outcome,
    players: net.players.map((p) => ({ user_id: p.user_id, name: p.display_name, side: p.side_id })),
  });
}

// ── client ──────────────────────────────────────────────────────

function startClient(roomId: string): void {
  const client = sb();
  clientApplier.start();
  stateChannel = client.channel(`wg:room:${roomId}:state`, { config: { private: true } });
  stateChannel
    .on("broadcast", { event: "snap" }, ({ payload }) => clientApplier.receive(payload as StateSnapshot))
    .subscribe();
}

// ── teardown ────────────────────────────────────────────────────

function teardown(): void {
  for (const t of hostTimers) clearInterval(t);
  hostTimers = [];
  clientApplier.stop();
  for (const ch of [dbChannel, presenceChannel, stateChannel]) {
    if (ch) void wgSupabase?.removeChannel(ch);
  }
  dbChannel = presenceChannel = stateChannel = null;
  matchStarted = false;
}
