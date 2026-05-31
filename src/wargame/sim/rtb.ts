/**
 * 戰機 RTB（Return to Base）— 彈藥用盡或燃料不足時自動返航最近 friendly airbase。
 *
 * 觸發條件（任一）：
 *   - ammoCurrent === 0（沒彈藥可打）
 *   - 剩餘燃料 < 35%（避免飛回去途中油盡）
 *
 * 行為：
 *   - 找最近的 friendly airbase（或任何 friendly 含 supplyRangeKm > 0 的設施）
 *   - 覆寫 waypoints 為 [base 位置]
 *   - 已經朝那個 base 飛 → skip
 *   - 沒可用 base → skip（沒得回，繼續執行原任務）
 *
 * 注意：覆寫 user/AI 的 waypoint。Re-task 戰機只能等它補完離開 base supply 範圍。
 */
import type { SideId, SimulationState, Unit } from "../types";
import { haversineKm } from "./geo";
import { getSupplyConfig } from "./supplyConfig";

const FUEL_RTB_FRAC_THRESHOLD = 0.35;
const ARRIVE_THRESHOLD_KM = 0.5;

export function runRtb(state: SimulationState): SimulationState {
  let units = state.units;
  let changed = false;

  // 預先 group friendly supply 設施 by side（含 airbase / supply_ship / CVN override）
  const supplyBySide = new Map<SideId, Unit[]>();
  for (const u of Object.values(units)) {
    if (u.hpCurrent <= 0) continue;
    const cfg = getSupplyConfig(u);
    if (!cfg) continue;
    let arr = supplyBySide.get(u.sideId);
    if (!arr) { arr = []; supplyBySide.set(u.sideId, arr); }
    arr.push(u);
  }

  for (const u of Object.values(units)) {
    if (u.kind !== "fighter") continue;
    if (u.hpCurrent <= 0) continue;

    if (!shouldRtb(u)) continue;

    const bases = supplyBySide.get(u.sideId);
    if (!bases || bases.length === 0) continue;

    // 找最近 base
    let nearest: Unit | null = null;
    let minDist = Infinity;
    for (const b of bases) {
      const d = haversineKm(
        [u.position.lng, u.position.lat],
        [b.position.lng, b.position.lat],
      );
      if (d < minDist) { minDist = d; nearest = b; }
    }
    if (!nearest) continue;

    // 已經抵達 → 不需要再覆寫（讓補給 step 處理）
    if (minDist <= ARRIVE_THRESHOLD_KM) continue;

    // 已經朝這個 base 飛 → skip
    const target = u.waypoints[0];
    if (target && target[0] === nearest.position.lng && target[1] === nearest.position.lat) continue;

    // 覆寫 waypoints
    units = {
      ...units,
      [u.id]: { ...u, waypoints: [[nearest.position.lng, nearest.position.lat]] },
    };
    changed = true;
  }

  return changed ? { ...state, units } : state;
}

function shouldRtb(u: Unit): boolean {
  if (u.ammoCurrent <= 0) return true;
  if (u.core.movementRangeKm <= 0) return false;
  const fuelRemainFrac = (u.core.movementRangeKm - u.distanceTravelledKm) / u.core.movementRangeKm;
  if (fuelRemainFrac < FUEL_RTB_FRAC_THRESHOLD) return true;
  return false;
}
