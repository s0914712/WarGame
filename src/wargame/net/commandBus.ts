/**
 * 指令唯一出口（Editor / LLM 面板共用）。
 *
 *   - 單人（off）  → scenarioStore.enqueueCommand（原行為）
 *   - host         → 本機 enqueue（simAtSec 用 host 時間）+ 寫 wg_commands 當 log
 *   - client       → insert wg_commands（RLS 驗證陣營），host 經 postgres_changes 收到後 enqueue
 *
 * AI loop 與場景 scripted 指令只在 host 跑，直接 enqueue，不經此 bus。
 */
import type { Command, SideId } from "../types";
import { scenarioStore } from "../scenarioStore";
import { wargameClock } from "../clock";
import { netStore } from "./netStore";
import { wgSupabase } from "./wgSupabase";
import { commandPings } from "../editor/commandPings";

export interface SubmitResult { ok: boolean; error?: string }

export function submitCommand(cmd: Command): SubmitResult {
  const net = netStore.get();
  if (net.role === "off") {
    scenarioStore.enqueueCommand(cmd);
    commandPings.push(cmd);   // 地圖上「收到命令」提示
    return { ok: true };
  }

  const unit = scenarioStore.getState().units[cmd.unitId];
  if (!unit) return { ok: false, error: "unit not found" };
  if (!netStore.canControlSide(unit.sideId)) {
    return { ok: false, error: `不能指揮 ${unit.sideId} 方單位` };
  }

  if (net.role === "host") {
    scenarioStore.enqueueCommand({ ...cmd, simAtSec: wargameClock.getSimTime() });
  }
  void logCommand(cmd, unit.sideId);
  commandPings.push(cmd);
  return { ok: true };
}

async function logCommand(cmd: Command, sideId: SideId) {
  const net = netStore.get();
  if (!wgSupabase || !net.room || !net.myUserId) return;
  const { error } = await wgSupabase.from("wg_commands").insert({
    room_id: net.room.id,
    user_id: net.myUserId,
    side_id: sideId,
    payload: cmd,
  });
  if (error) {
    console.warn("[wargame/net] command rejected", error.message);
    netStore.set({ error: `指令送出失敗：${error.message}` });
  }
}

/**
 * Host 收到遠端指令時呼叫：再驗一次 unit 陣營，simAtSec 改寫為 host 當下時間。
 * （RLS 已保證 user 持有 side_id，這裡防 payload 內 unitId 指向別方單位）
 */
export function acceptRemoteCommand(row: { user_id: string; side_id: string; payload: unknown }): void {
  const net = netStore.get();
  if (row.user_id === net.myUserId) return;   // 自己的 log，已本機 enqueue
  const cmd = row.payload as Command;
  if (!cmd || typeof cmd !== "object" || typeof cmd.unitId !== "string") return;
  const unit = scenarioStore.getState().units[cmd.unitId];
  if (!unit || unit.sideId !== row.side_id) {
    console.warn("[wargame/net] drop cross-side command", row);
    return;
  }
  scenarioStore.enqueueCommand({ ...cmd, simAtSec: wargameClock.getSimTime() });
}
