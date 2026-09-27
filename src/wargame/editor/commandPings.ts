/**
 * 指令回饋標記（RTS 式「收到命令」提示，純視覺，不影響模擬）。
 *
 * 本機玩家每送出一個指令（commandBus.submitCommand 成功）就推一個短暫 ping：
 *   engage          → 目標上紅色攻擊準星（跟著目標移動）
 *   set_waypoints   → 目的地綠色移動標記（多航點 = 藍色航點標記；清空 = 單位上灰色 ✕）
 *   hold            → 單位上黃色停止標記
 *   set_roe         → 單位上 ROE 顏色標記
 *   聲納 / 拖曳陣列 / 深度 → 單位上青色感測標記
 *   deploy_sonobuoys → 搜索框中心聲標標記
 * 由 src/map/wargameCommandPingLayer.ts 渲染。AI / 遠端玩家指令不經 submitCommand，不會出現。
 */
import type { Command, LngLat, RoeMode, UnitId } from "../types";

export type PingIcon = "attack" | "move" | "route" | "hold" | "clear" | "roe" | "sensor" | "buoy";

export interface CommandPing {
  icon: PingIcon;
  label: string;
  color: string;
  born: number;          // performance.now()
  lifeMs: number;
  ownerUnitId: UnitId;   // 下令的單位
  at?: LngLat;          // 固定位置
  followUnitId?: UnitId; // 或跟隨單位（優先）
}

const MAX_PINGS = 24;
let pings: CommandPing[] = [];

const ROE_PING: Record<RoeMode, { label: string; color: string }> = {
  weapons_free: { label: "自由接戰", color: "#ef4444" },
  weapons_tight: { label: "限制接戰", color: "#f59e0b" },
  defensive_only: { label: "僅防禦", color: "#22c55e" },
  weapons_hold: { label: "停止接戰", color: "#94a3b8" },
};

function pingFor(cmd: Command): Omit<CommandPing, "born" | "ownerUnitId"> | null {
  switch (cmd.kind) {
    case "engage":
      return { icon: "attack", label: "攻擊", color: "#ef4444", lifeMs: 1400, followUnitId: cmd.targetUnitId };
    case "set_waypoints": {
      const n = cmd.waypoints.length;
      if (n === 0) return { icon: "clear", label: "清除航線", color: "#94a3b8", lifeMs: 1000, followUnitId: cmd.unitId };
      const at = cmd.waypoints[n - 1]!;
      return n === 1
        ? { icon: "move", label: "移動", color: "#4ade80", lifeMs: 1100, at }
        : { icon: "route", label: `航點 ${n}`, color: "#60a5fa", lifeMs: 1100, at };
    }
    case "hold":
      return { icon: "hold", label: "停止", color: "#facc15", lifeMs: 1100, followUnitId: cmd.unitId };
    case "set_roe":
      return { icon: "roe", ...ROE_PING[cmd.roe], lifeMs: 1100, followUnitId: cmd.unitId };
    case "set_active_sonar":
      return { icon: "sensor", label: cmd.on ? "主動聲納 開" : "主動聲納 關", color: "#38bdf8", lifeMs: 1100, followUnitId: cmd.unitId };
    case "set_towed_array":
      return { icon: "sensor", label: cmd.on ? "拖曳陣列 放" : "拖曳陣列 收", color: "#34d399", lifeMs: 1100, followUnitId: cmd.unitId };
    case "set_depth":
      return { icon: "sensor", label: `深度 ${cmd.depthM} m`, color: "#38bdf8", lifeMs: 1100, followUnitId: cmd.unitId };
    case "deploy_sonobuoys":
      return {
        icon: "buoy", label: `佈聲標 ×${cmd.count}`, color: "#38bdf8", lifeMs: 1300,
        at: [(cmd.cornerA[0] + cmd.cornerB[0]) / 2, (cmd.cornerA[1] + cmd.cornerB[1]) / 2],
      };
    default:
      return null;   // set_speed 等附帶指令不另外提示
  }
}

export const commandPings = {
  /** 本機送出指令後呼叫 */
  push(cmd: Command): void {
    const p = pingFor(cmd);
    if (!p) return;
    // 同一單位同一種提示只留最新（連點右鍵不會疊一堆）
    pings = pings.filter((x) => !(x.ownerUnitId === cmd.unitId && x.icon === p.icon));
    pings.push({ ...p, ownerUnitId: cmd.unitId, born: performance.now() });
    if (pings.length > MAX_PINGS) pings = pings.slice(-MAX_PINGS);
  },

  /** 取目前仍存活的 ping（順便清掉過期的） */
  getActive(now: number): readonly CommandPing[] {
    if (pings.length > 0) pings = pings.filter((p) => now - p.born < p.lifeMs);
    return pings;
  },

  clear(): void { pings = []; },
};
