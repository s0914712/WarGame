/**
 * 取得單位的有效補給配置（per-unit override > catalog 預設）。
 *
 * 給 RAS / RTB / replenishment 共用，避免邏輯散落。
 */
import type { Unit } from "../types";
import { UNIT_CATALOG } from "../catalog/units";

export interface SupplyConfig {
  rangeKm: number;
  fuelKmPerSec: number;
  ammoPerSec: number;
}

export function getSupplyConfig(u: Unit): SupplyConfig | null {
  if (u.supplyOverride) {
    if (u.supplyOverride.rangeKm <= 0) return null;
    return u.supplyOverride;
  }
  const cat = UNIT_CATALOG[u.kind];
  if (!cat.supplyRangeKm || cat.supplyRangeKm <= 0) return null;
  return {
    rangeKm: cat.supplyRangeKm,
    fuelKmPerSec: cat.supplyFuelKmPerSec ?? 0,
    ammoPerSec: cat.supplyAmmoPerSec ?? 0,
  };
}
