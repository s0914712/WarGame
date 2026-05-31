/**
 * 命令套用 — 把 simAtSec 已到的 pendingCommands 應用到 units。
 *
 * 純函式：傳入 state → 回傳 { units, pendingCommands }（已套用的指令會從佇列移除）
 */
import type { Command, SimulationState, Unit, UnitId } from "../types";

interface CommandsResult {
  units: Record<UnitId, Unit>;
  pendingCommands: Command[];
}

export function applyDueCommands(state: SimulationState): CommandsResult {
  if (state.pendingCommands.length === 0) {
    return { units: state.units, pendingCommands: state.pendingCommands };
  }

  const due: Command[] = [];
  const remaining: Command[] = [];
  for (const c of state.pendingCommands) {
    if (c.simAtSec <= state.simTimeSec) due.push(c);
    else remaining.push(c);
  }

  if (due.length === 0) {
    return { units: state.units, pendingCommands: state.pendingCommands };
  }

  let units = state.units;
  for (const c of due) {
    const u = units[c.unitId];
    if (!u) continue;
    units = { ...units, [c.unitId]: applyOne(u, c) };
  }

  return { units, pendingCommands: remaining };
}

function applyOne(unit: Unit, cmd: Command): Unit {
  switch (cmd.kind) {
    case "set_waypoints":
      return { ...unit, waypoints: [...cmd.waypoints] };
    case "set_speed":
      return { ...unit, position: { ...unit.position, speedKnots: cmd.speedKnots } };
    case "engage":
      return { ...unit, engagingTargetId: cmd.targetUnitId };
    case "hold":
      return { ...unit, waypoints: [], position: { ...unit.position, speedKnots: 0 } };
  }
}
