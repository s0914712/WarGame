/**
 * 多人對戰協調層（host-authoritative）。
 *
 *   hostStart  ：本端當主機（藍）— 正常跑引擎，訂閱 scenarioStore/時鐘 → 節流廣播狀態；
 *                收 guest 指令 → 驗證擁有權 → enqueueCommand。
 *   guestStart ：本端當客戶端（紅）— 關閉本地引擎（useSimLoop 讀 netStore.isGuest 跳過），
 *                收主機狀態 → setState + 鏡像時鐘；本地指令經 interceptor 改送主機。
 *   netStop    ：解除所有訂閱、離開房間、reset。
 *
 * MVP：固定 藍=host、紅=guest。防作弊（每方 FoW 過濾狀態）列為 Phase 2。
 */
import type { Command, SideId, SimulationState } from "../types";
import { scenarioStore } from "../scenarioStore";
import { wargameClock } from "../clock";
import { viewStore } from "../viewStore";
import { findScenario } from "../scenarios/registry";
import { netStore } from "./netStore";
import {
  joinRoom, leaveRoom, sendEvent, transportAvailable,
  type StatePayload, type ClockPayload, type CommandPayload,
} from "./transport";

export const HOST_SIDE: SideId = "blue";
export const GUEST_SIDE: SideId = "red";

const NO_SUPABASE = "未設定 Supabase（VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY）— 無法連線對戰";
const BROADCAST_MIN_MS = 200;   // 節流：最快 5Hz 廣播完整狀態

let unsubState: (() => void) | null = null;
let unsubClock: (() => void) | null = null;
let lastBroadcast = 0;

let guestFirstStateHook: ((state: SimulationState) => void) | null = null;
let guestPendingFirst = false;

/** WargameApp 設定：guest 收到第一份狀態時呼叫（用來 flyTo 場景相機） */
export function setGuestFirstStateHook(fn: ((state: SimulationState) => void) | null): void {
  guestFirstStateHook = fn;
}

const MAX_EVENTS_IN_SNAPSHOT = 80;   // eventsAll 會累積整場 → 廣播只帶最近 N 筆，避免 payload 爆量

function broadcastState(): void {
  const st = scenarioStore.getState();
  // 截斷 eventsAll（戰報只顯示最近數十筆）以控制每則訊息大小
  const state = st.eventsAll.length > MAX_EVENTS_IN_SNAPSHOT
    ? { ...st, eventsAll: st.eventsAll.slice(-MAX_EVENTS_IN_SNAPSHOT) }
    : st;
  sendEvent("state", {
    state,
    simTime: wargameClock.getSimTime(),
    rate: wargameClock.getRate(),
    paused: wargameClock.isPaused(),
  } satisfies StatePayload);
}

function broadcastClock(): void {
  sendEvent("clock", {
    simTime: wargameClock.getSimTime(),
    rate: wargameClock.getRate(),
    paused: wargameClock.isPaused(),
  } satisfies ClockPayload);
  netStore.set({ hostPaused: wargameClock.isPaused() });
}

/** 主機：建立房間並開始廣播。caller 須先 loadScenario？此處代為載入確保兩端一致。 */
export function hostStart(roomId: string, scenarioId: string): boolean {
  if (!transportAvailable()) { netStore.set({ error: NO_SUPABASE }); return false; }
  const scenario = findScenario(scenarioId);
  if (!scenario) { netStore.set({ error: `未知場景：${scenarioId}` }); return false; }

  scenarioStore.setCommandInterceptor(null);   // host 本地正常入列
  scenarioStore.loadScenario(scenario);
  wargameClock.reset();
  viewStore.setActiveView(HOST_SIDE);
  netStore.set({
    active: true, role: "host", roomId, mySide: HOST_SIDE,
    connected: false, opponentPresent: false, hostPaused: true, error: null,
  });

  const ok = joinRoom(roomId, { side: HOST_SIDE, role: "host" }, {
    onSubscribed: () => { netStore.set({ connected: true }); broadcastState(); },
    onPresence: (peers) => netStore.set({ opponentPresent: peers > 1 }),
    hello: () => broadcastState(),                 // guest 加入 / 重連 → 補一份完整快照
    command: (p: CommandPayload) => {
      // 擁有權驗證：指令單位須屬 guest 陣營（不得越權操作主機方）
      const u = scenarioStore.getState().units[p.cmd.unitId];
      if (!u || u.sideId !== p.bySide || p.bySide === HOST_SIDE) return;
      scenarioStore.enqueueCommand(p.cmd as Command);
    },
  });
  if (!ok) { netStop(); return false; }

  unsubState = scenarioStore.subscribe(() => {
    const now = Date.now();
    if (now - lastBroadcast < BROADCAST_MIN_MS) return;
    lastBroadcast = now;
    broadcastState();
  });
  unsubClock = wargameClock.subscribe(broadcastClock);
  return true;
}

/** 客戶端：加入房間、鏡像主機狀態。 */
export function guestStart(roomId: string): boolean {
  if (!transportAvailable()) { netStore.set({ error: NO_SUPABASE }); return false; }

  guestPendingFirst = true;
  viewStore.setActiveView(GUEST_SIDE);
  wargameClock.pause();   // guest 本地時鐘不前進，只 seek 鏡像
  netStore.set({
    active: true, role: "guest", roomId, mySide: GUEST_SIDE,
    connected: false, opponentPresent: false, hostPaused: true, error: null,
  });
  // 本地指令 → 改送主機
  scenarioStore.setCommandInterceptor((cmd: Command) => {
    sendEvent("command", { cmd, bySide: GUEST_SIDE } satisfies CommandPayload);
    return true;
  });

  const ok = joinRoom(roomId, { side: GUEST_SIDE, role: "guest" }, {
    onSubscribed: () => { netStore.set({ connected: true }); sendEvent("hello", {}); },
    onPresence: (peers) => netStore.set({ opponentPresent: peers > 1 }),
    state: (p: StatePayload) => {
      scenarioStore.setState(p.state);
      applyHostClock(p.simTime, p.rate, p.paused);
      if (guestPendingFirst) { guestPendingFirst = false; guestFirstStateHook?.(p.state); }
    },
    clock: (p: ClockPayload) => applyHostClock(p.simTime, p.rate, p.paused),
  });
  if (!ok) { netStop(); return false; }
  return true;
}

function applyHostClock(simTime: number, rate: number, paused: boolean): void {
  wargameClock.seek(simTime);
  wargameClock.setRate(rate);
  netStore.set({ hostPaused: paused });
}

export function netStop(): void {
  unsubState?.(); unsubState = null;
  unsubClock?.(); unsubClock = null;
  lastBroadcast = 0;
  guestPendingFirst = false;
  scenarioStore.setCommandInterceptor(null);
  leaveRoom();
  netStore.reset();
}

/** 產生簡短房間代碼 */
export function makeRoomCode(): string {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let s = "";
  for (let i = 0; i < 5; i++) s += chars[Math.floor(Math.random() * chars.length)];
  return s;
}
