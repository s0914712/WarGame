/**
 * 多人傳輸層 — 包 Supabase Realtime channel（房間 = 一個 channel）。
 *
 * 事件（broadcast）：
 *   - "state"   ：host → guest，完整 SimulationState + 時鐘
 *   - "clock"   ：host → guest，僅時鐘（暫停 / 速率變化）
 *   - "command" ：guest → host，玩家指令 + 來源陣營
 *   - "hello"   ：guest → host，請求立即補一份完整快照（加入 / 重連）
 *
 * 不引入決定性同步：只有 host 算引擎，guest 純鏡像。
 */
import type { RealtimeChannel } from "@supabase/supabase-js";
import { supabase, supabaseConfigured } from "../../lib/supabase";
import type { Command, SideId, SimulationState } from "../types";
import { netStore } from "./netStore";

export type NetEvent = "state" | "clock" | "command" | "hello";

export interface StatePayload {
  state: SimulationState;
  simTime: number;
  rate: number;
  paused: boolean;
}
export interface ClockPayload { simTime: number; rate: number; paused: boolean }
export interface CommandPayload { cmd: Command; bySide: SideId }

type Handlers = {
  state?: (p: StatePayload) => void;
  clock?: (p: ClockPayload) => void;
  command?: (p: CommandPayload) => void;
  hello?: () => void;
  onPresence?: (peerCount: number) => void;
  onSubscribed?: () => void;
};

let channel: RealtimeChannel | null = null;

export function transportAvailable(): boolean {
  return supabaseConfigured;
}

export function channelName(roomId: string): string {
  return `wargame-room-${roomId}`;
}

/** 加入房間 channel；handlers 註冊各事件回呼。回傳是否成功啟動 */
export function joinRoom(
  roomId: string,
  meta: { side: SideId | "spectator"; role: "host" | "guest" },
  handlers: Handlers,
): boolean {
  if (!supabaseConfigured) {
    netStore.set({ error: "未設定 Supabase（VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY）— 無法連線對戰" });
    return false;
  }
  leaveRoom();
  const playerId = netStore.getPlayerId();
  const ch = supabase.channel(channelName(roomId), {
    config: { broadcast: { self: false, ack: false }, presence: { key: playerId } },
  });

  ch.on("broadcast", { event: "state" }, ({ payload }) => handlers.state?.(payload as StatePayload));
  ch.on("broadcast", { event: "clock" }, ({ payload }) => handlers.clock?.(payload as ClockPayload));
  ch.on("broadcast", { event: "command" }, ({ payload }) => handlers.command?.(payload as CommandPayload));
  ch.on("broadcast", { event: "hello" }, () => handlers.hello?.());
  ch.on("presence", { event: "sync" }, () => {
    const peers = Object.keys(ch.presenceState()).length;
    handlers.onPresence?.(peers);
  });

  ch.subscribe((status) => {
    if (status === "SUBSCRIBED") {
      void ch.track({ side: meta.side, role: meta.role, playerId });
      handlers.onSubscribed?.();
    } else if (status === "CHANNEL_ERROR" || status === "TIMED_OUT") {
      netStore.set({ connected: false, error: `連線異常（${status}）` });
    }
  });

  channel = ch;
  return true;
}

/** 廣播一則事件 */
export function sendEvent(event: NetEvent, payload: unknown): void {
  if (!channel) return;
  void channel.send({ type: "broadcast", event, payload });
}

export function leaveRoom(): void {
  if (channel) {
    void supabase.removeChannel(channel);
    channel = null;
  }
}
