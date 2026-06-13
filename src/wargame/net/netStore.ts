/**
 * 多人連線狀態 store（external store，仿 scenarioStore 範式）。
 *
 * 線上 2 人對戰採 host-authoritative：
 *   - host（藍方）：跑權威引擎、廣播狀態
 *   - guest（紅方）：關閉本地引擎、鏡像狀態、回傳指令
 *
 * 本 store 只存「連線/角色/陣營」等 metadata；世界狀態仍在 scenarioStore。
 */
import type { SideId } from "../types";

export type NetRole = "host" | "guest";

export interface NetPeer {
  playerId: string;
  side: SideId | "spectator";
  role: NetRole;
}

interface NetState {
  active: boolean;
  role: NetRole | null;
  roomId: string | null;
  /** 本端控制的陣營（host 預設 blue、guest 預設 red） */
  mySide: SideId | null;
  /** channel 是否已 SUBSCRIBED */
  connected: boolean;
  /** 對手是否已加入（presence） */
  opponentPresent: boolean;
  /** 主機回報的播放狀態（給 guest HUD 顯示用） */
  hostPaused: boolean;
  error: string | null;
}

type Listener = () => void;

const PLAYER_ID_KEY = "wg-player-id";

function loadPlayerId(): string {
  try {
    const ex = localStorage.getItem(PLAYER_ID_KEY);
    if (ex) return ex;
    const id = `p-${Math.random().toString(36).slice(2, 10)}`;
    localStorage.setItem(PLAYER_ID_KEY, id);
    return id;
  } catch {
    return `p-${Math.random().toString(36).slice(2, 10)}`;
  }
}

const playerId = loadPlayerId();

let state: NetState = {
  active: false,
  role: null,
  roomId: null,
  mySide: null,
  connected: false,
  opponentPresent: false,
  hostPaused: true,
  error: null,
};

const listeners = new Set<Listener>();
function notify() { for (const cb of listeners) cb(); }

export const netStore = {
  getPlayerId(): string { return playerId; },
  getState(): NetState { return state; },
  isActive(): boolean { return state.active; },
  isHost(): boolean { return state.active && state.role === "host"; },
  isGuest(): boolean { return state.active && state.role === "guest"; },
  getMySide(): SideId | null { return state.mySide; },

  set(patch: Partial<NetState>): void {
    state = { ...state, ...patch };
    notify();
  },

  reset(): void {
    state = {
      active: false, role: null, roomId: null, mySide: null,
      connected: false, opponentPresent: false, hostPaused: true, error: null,
    };
    notify();
  },

  subscribe(cb: Listener): () => void {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
};

export type NetStore = typeof netStore;
