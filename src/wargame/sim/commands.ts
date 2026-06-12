/**
 * 命令套用 — 把 simAtSec 已到的 pendingCommands 應用到 units。
 *
 * 純函式：傳入 state → 回傳 { units, pendingCommands, sonobuoys }。
 * 多數指令改 unit；deploy_sonobuoys 產生 state 級的聲標（反潛屏幕）。
 */
import type { Command, Sonobuoy, SimulationState, Unit, UnitId } from "../types";
import { SUB_MAX_DEPTH_M } from "./sonar";
import { planSonobuoyField, DEFAULT_MDR_KM, DEFAULT_LIFETIME_SEC } from "./sonobuoyField";

interface CommandsResult {
  units: Record<UnitId, Unit>;
  pendingCommands: Command[];
  /** 本次新佈放的聲標（engine 累加到 state.sonobuoys） */
  sonobuoys: Sonobuoy[];
}

export function applyDueCommands(state: SimulationState): CommandsResult {
  if (state.pendingCommands.length === 0) {
    return { units: state.units, pendingCommands: state.pendingCommands, sonobuoys: [] };
  }

  const due: Command[] = [];
  const remaining: Command[] = [];
  for (const c of state.pendingCommands) {
    if (c.simAtSec <= state.simTimeSec) due.push(c);
    else remaining.push(c);
  }

  if (due.length === 0) {
    return { units: state.units, pendingCommands: state.pendingCommands, sonobuoys: [] };
  }

  let units = state.units;
  const newSonobuoys: Sonobuoy[] = [];
  for (const c of due) {
    const u = units[c.unitId];
    if (!u) continue;
    if (c.kind === "deploy_sonobuoys") {
      newSonobuoys.push(...buildSonobuoys(u, c, state.simTimeSec));
      continue;
    }
    units = { ...units, [c.unitId]: applyOne(u, c) };
  }

  return { units, pendingCommands: remaining, sonobuoys: newSonobuoys };
}

/** 由 deploy_sonobuoys 指令產生聲標陣列（格網佈點） */
function buildSonobuoys(
  unit: Unit,
  cmd: Extract<Command, { kind: "deploy_sonobuoys" }>,
  simSec: number,
): Sonobuoy[] {
  const mdrKm = cmd.mdrKm ?? DEFAULT_MDR_KM;
  const lifetimeSec = cmd.lifetimeSec ?? DEFAULT_LIFETIME_SEC;
  const plan = planSonobuoyField({
    cornerA: cmd.cornerA,
    cornerB: cmd.cornerB,
    count: cmd.count,
    mdrKm,
    searchTimeHr: lifetimeSec / 3600,
  });
  return plan.buoys.map((position, i) => ({
    id: `sb-${simSec.toFixed(0)}-${unit.id}-${i}`,
    sideId: unit.sideId,
    position,
    mdrKm,
    deployedAtSimSec: simSec,
    lifetimeSec,
  }));
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
    case "set_roe":
      return { ...unit, roe: cmd.roe };
    case "set_active_sonar":
      return { ...unit, activeSonar: cmd.on };
    case "set_depth":
      return { ...unit, targetDepthM: Math.max(0, Math.min(SUB_MAX_DEPTH_M, cmd.depthM)) };
    case "deploy_sonobuoys":
      return unit;   // 由 buildSonobuoys 在 applyDueCommands 處理（state 級）
  }
}
