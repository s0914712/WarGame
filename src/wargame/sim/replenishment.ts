/**
 * 補給機制 — RAS (Replenishment at Sea) + 加油 / 補彈藥。
 *
 * 每 tick：
 *   - 找所有 supply_ship 單位
 *   - 對每個範圍內的「同陣營且非滿載」單位：
 *       - 扣它的 distanceTravelledKm（補燃料）
 *       - 加它的 ammoCurrent（補彈藥）
 *   - 補給速率來自 catalog（supplyFuelKmPerSec / supplyAmmoPerSec）
 *
 * 不影響補給艦自己的狀態（除非未來加 capacity 限制）。
 */
import type { SimulationState, Unit } from "../types";
import { haversineKm } from "./geo";
import { getSupplyConfig } from "./supplyConfig";

export function runReplenishment(state: SimulationState, dtSec: number): SimulationState {
  // 先找補給單位（含 per-unit override；CVN 多用途載台也算）
  const suppliers: Array<{ unit: Unit; cfg: ReturnType<typeof getSupplyConfig> }> = [];
  for (const u of Object.values(state.units)) {
    if (u.hpCurrent <= 0) continue;
    const cfg = getSupplyConfig(u);
    if (!cfg) continue;
    suppliers.push({ unit: u, cfg });
  }
  if (suppliers.length === 0) return state;

  let units = state.units;
  let changed = false;

  for (const { unit: sup, cfg } of suppliers) {
    if (!cfg) continue;
    const radius = cfg.rangeKm;
    const fuelRate = cfg.fuelKmPerSec;
    const ammoRate = cfg.ammoPerSec;
    if (radius <= 0) continue;

    for (const u of Object.values(units)) {
      if (u.id === sup.id) continue;
      if (u.sideId !== sup.sideId) continue;
      if (u.hpCurrent <= 0) continue;
      const d = haversineKm(
        [sup.position.lng, sup.position.lat],
        [u.position.lng, u.position.lat],
      );
      if (d > radius) continue;

      let nextU = u;
      // 補燃料（降低 distanceTravelledKm，下限 0）
      if (fuelRate > 0 && u.distanceTravelledKm > 0) {
        const xfer = Math.min(u.distanceTravelledKm, fuelRate * dtSec);
        if (xfer > 0.001) {
          nextU = { ...nextU, distanceTravelledKm: Math.max(0, nextU.distanceTravelledKm - xfer) };
        }
      }
      // 補彈藥（B6：分配到各武器彈艙；同步 aggregate ammoCurrent）
      if (ammoRate > 0 && u.weapons && u.ammoCurrent < u.ammoMax) {
        let budget = ammoRate * dtSec;
        if (budget > 0.001) {
          const weapons = nextU.weapons!.map((m) => ({ ...m }));
          for (const m of weapons) {
            if (budget <= 0) break;
            const need = m.ammoMax - m.ammoCurrent;
            if (need <= 0) continue;
            const add = Math.min(need, budget);
            m.ammoCurrent += add;
            budget -= add;
          }
          const ammoCurrent = Math.min(nextU.ammoMax, weapons.reduce((s, m) => s + m.ammoCurrent, 0));
          nextU = { ...nextU, weapons, ammoCurrent };
        }
      }

      if (nextU !== u) {
        units = { ...units, [u.id]: nextU };
        changed = true;
      }
    }
  }

  return changed ? { ...state, units } : state;
}
