/**
 * 腳本 AI（純規則，無 LLM）。
 *
 * 規則表：
 *   1. radar_station → 不動
 *   2. hp < 30% + 有 waypoint → hold（停下等待救援）
 *   3. 已有 waypoint → skip（不打斷現有計畫）
 *   4. 找最近「已偵測 + 不在射程內」的敵方 → 推進到 rangeKm * 0.85 處
 *   5. 都在射程內或全沒偵測到 → skip（讓 combat.ts 的 auto-engage 處理）
 *
 * 設計：純函式判斷 + 透過 enqueueCommand 寫入；不直接 mutate units。
 * 一次 tick 為一輪決策，跟 LLM loop 一樣節流（避免每幀重排）。
 */
import type { LngLat, SideId, Unit } from "../types";
import { scenarioStore } from "../scenarioStore";
import { wargameClock } from "../clock";
import { advanceTowardKm, haversineKm } from "../sim/geo";

export interface ScriptedTickResult {
  commandsIssued: number;
  details: string[];
}

export function runScriptedAiTick(sideId: SideId): ScriptedTickResult {
  const state = scenarioStore.getState();
  const playerSide = state.scenario.sides.find((s) => s.id === sideId);
  if (!playerSide) return { commandsIssued: 0, details: [] };
  const hostiles = playerSide.isHostileTo;

  const ownUnits = Object.values(state.units).filter((u) => u.sideId === sideId);
  const enemyUnits = Object.values(state.units).filter((u) => hostiles.includes(u.sideId));
  const detectedEnemies = enemyUnits.filter((e) => {
    const det = e.detectedBy[sideId];
    return det && det !== "hidden";
  });

  const simSec = wargameClock.getSimTime();
  const details: string[] = [];
  let issued = 0;

  for (const u of ownUnits) {
    if (u.kind === "radar_station") continue;
    if (u.hpCurrent <= 0) continue;

    const hpPct = u.hpCurrent / u.core.hpMax;

    // ── rule 2: low hp 自保 ──
    if (hpPct < 0.3 && u.waypoints.length > 0) {
      scenarioStore.enqueueCommand({
        id: makeId(), unitId: u.id, simAtSec: simSec, kind: "hold",
      });
      details.push(`${u.callsign}: HP ${(hpPct * 100).toFixed(0)}% → hold`);
      issued++;
      continue;
    }

    // ── rule 3: 已有計畫不打斷 ──
    if (u.waypoints.length > 0) continue;

    // ── rule 4: 推進到最近敵方射程邊緣 ──
    const target = nearestEnemyOutOfRange(u, detectedEnemies);
    if (!target) continue;

    const stopAtKm = u.core.rangeKm * 0.85;
    const approachKm = target.dist - stopAtKm;
    if (approachKm <= 0) continue;

    const newPos: LngLat = advanceTowardKm(
      [u.position.lng, u.position.lat],
      [target.e.position.lng, target.e.position.lat],
      approachKm,
    );

    scenarioStore.enqueueCommand({
      id: makeId(), unitId: u.id, simAtSec: simSec,
      kind: "set_waypoints", waypoints: [newPos],
    });
    details.push(`${u.callsign} → ${target.e.callsign} (${target.dist.toFixed(0)} km → ${stopAtKm.toFixed(0)} km)`);
    issued++;
  }

  return { commandsIssued: issued, details };
}

function nearestEnemyOutOfRange(u: Unit, enemies: Unit[]): { e: Unit; dist: number } | null {
  let best: { e: Unit; dist: number } | null = null;
  for (const e of enemies) {
    if (e.hpCurrent <= 0) continue;
    const d = haversineKm([u.position.lng, u.position.lat], [e.position.lng, e.position.lat]);
    if (d <= u.core.rangeKm) continue;          // 在射程內 → combat.ts 處理
    if (!best || d < best.dist) best = { e, dist: d };
  }
  return best;
}

function makeId(): string {
  return `scripted-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
