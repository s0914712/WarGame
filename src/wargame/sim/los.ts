/**
 * 視線（Line-of-Sight）— 雷達地平線 + 地形遮蔽（A5）。
 *
 * 兩個獨立效應：
 *   1. 雷達地平線：感測器與目標皆受地球曲率限制，
 *      horizon(km) ≈ 4.12 × (√h_sensor + √h_target)（h 單位公尺）。
 *      低空目標（掠海彈、海面艦）只能在近距被低空感測器發現；
 *      高山雷達 / 空中載台（高 h）則看得遠。
 *   2. 地形遮蔽：中央山脈會擋住低空視線。沿感測器↔目標連線取樣，
 *      若任一取樣點地形海拔高於該處 LOS 直線高度 → 視線被擋。
 *
 * 純函式，無副作用。聲納（subsurface）不適用，由 caller 判斷後略過。
 */
import type { LngLat } from "../types";
import { getTerrainProbe } from "./terrain";

/** 雷達地平線距離（km）。h 以公尺計，負值視為 0 */
export function radarHorizonKm(sensorAltM: number, targetAltM: number): number {
  const s = Math.sqrt(Math.max(0, sensorAltM));
  const t = Math.sqrt(Math.max(0, targetAltM));
  return 4.12 * (s + t);
}

const LOS_SAMPLES = 20;

/**
 * 地形是否遮蔽 a→b 視線（a/b 海拔以公尺計）。
 * 只在中央山脈高於 LOS 直線時擋；開闊海面 / 空域（地形 0）永不遮蔽。
 */
export function isTerrainOccluded(
  a: LngLat, aAltM: number,
  b: LngLat, bAltM: number,
): boolean {
  const probe = getTerrainProbe();
  for (let i = 1; i < LOS_SAMPLES; i++) {
    const frac = i / LOS_SAMPLES;
    const lng = a[0] + (b[0] - a[0]) * frac;
    const lat = a[1] + (b[1] - a[1]) * frac;
    if (!probe.isLand(lng, lat)) continue;
    const terrainM = probe.elevationAt(lng, lat);
    if (terrainM <= 0) continue;
    const losAltM = aAltM + (bAltM - aAltM) * frac;
    if (terrainM > losAltM) return true;   // 山高於視線 → 擋住
  }
  return false;
}
