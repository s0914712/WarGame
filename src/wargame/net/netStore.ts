/**
 * 多人連線狀態 store。
 *
 * role：
 *   - off    → 單人模式（所有既有流程不變）
 *   - host   → 本機跑權威 engine、收指令、廣播 snapshot
 *   - client → 不跑 engine，只套 host snapshot（插值平滑）
 *
 * getSnapshot 回傳穩定參考：只在 set() 時換新物件。
 */
import type { SideId } from "../types";

export type NetRole = "off" | "host" | "client";
export type RoomStatus = "lobby" | "running" | "ended";

export interface RoomRow {
  id: string;
  code: string;
  host_user_id: string;
  scenario_id: string;
  status: RoomStatus;
}

export interface PlayerRow {
  room_id: string;
  user_id: string;
  display_name: string;
  side_id: SideId | null;
  ready: boolean;
}

export interface NetSnapshot {
  role: NetRole;
  room: RoomRow | null;
  players: PlayerRow[];
  myUserId: string | null;
  mySideId: SideId | null;
  /** presence 上線中的 user id */
  online: string[];
  hostOnline: boolean;
  /** Realtime 連線狀態文字（UI 顯示用） */
  connection: "idle" | "connecting" | "connected" | "error";
  error: string | null;
}

type Listener = () => void;

const INITIAL: NetSnapshot = {
  role: "off", room: null, players: [], myUserId: null, mySideId: null,
  online: [], hostOnline: false, connection: "idle", error: null,
};

let snap: NetSnapshot = INITIAL;
const listeners = new Set<Listener>();

export const netStore = {
  get(): NetSnapshot { return snap; },

  set(patch: Partial<NetSnapshot>): void {
    const next = { ...snap, ...patch };
    // 衍生欄位
    const me = next.players.find((p) => p.user_id === next.myUserId);
    next.mySideId = me?.side_id ?? null;
    next.hostOnline = next.room ? next.online.includes(next.room.host_user_id) : false;
    snap = next;
    for (const cb of listeners) cb();
  },

  reset(): void {
    snap = INITIAL;
    for (const cb of listeners) cb();
  },

  subscribe(cb: Listener): () => void {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },

  // ── 便利查詢（非 React 程式碼用） ──
  isMultiplayer(): boolean { return snap.role !== "off"; },
  isHost(): boolean { return snap.role === "host"; },
  isClient(): boolean { return snap.role === "client"; },
  /** 多人模式下，本機可以操作該陣營單位嗎？單人模式永遠 true */
  canControlSide(sideId: SideId): boolean {
    if (snap.role === "off") return true;
    return snap.mySideId === sideId;
  },
  /** 多人模式下誰都不該本地暫停；只有 host 可以控時鐘 */
  canControlClock(): boolean {
    return snap.role === "off" || snap.role === "host";
  },
  /** 被人類認領的陣營（AI loop 要跳過） */
  claimedSides(): SideId[] {
    return snap.players.flatMap((p) => (p.side_id ? [p.side_id] : []));
  },
};
