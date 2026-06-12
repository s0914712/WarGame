/**
 * 被動測向定位（E21）— 三角交會 + TMA 機動測距。
 *
 * 被動聲納只得「方位」不得「距離」。要把「未定位」的方位接觸升級成「已定位」(fixed)，
 * 真實反潛有兩條路：
 *   1. 三角交會（cross-fix）：≥2 個空間分離的被動感測器同時持有同一接觸，
 *      方位線交會 → 解出位置。需方位有足夠張角（基線）才準。
 *   2. TMA（Target Motion Analysis）/ Ekelund 機動測距：單一感測器透過「自身機動」
 *      （改變航向構成基線），在持續追蹤一段時間後由方位變化率反推距離。
 *
 * 純函式、無 RNG → 重播決定性。
 */
import type { TmaTrack } from "../types";

/** 浬→公里 */
export const KM_PER_NM = 1.852;

// ── TMA 解算門檻 ─────────────────────────────────────────
/** TMA 解算最低持續接觸秒數 */
export const TMA_MIN_HOLD_SEC = 60;
/** TMA 解算最低累計航向機動量（度）— 沒機動就沒基線，單一定速航段測不出距離 */
export const TMA_MIN_MANEUVER_DEG = 30;

// ── 三角交會門檻 ─────────────────────────────────────────
/** 兩條方位線交會所需最小張角（度）— 太小 = 近平行 = 距離誤差爆炸 */
export const TRIANGULATE_MIN_SPREAD_DEG = 25;

/** 角度差（−180..180 的絕對值） */
export function angleDiffDeg(a: number, b: number): number {
  let d = (a - b) % 360;
  if (d > 180) d -= 360;
  if (d < -180) d += 360;
  return Math.abs(d);
}

/** 一組方位的最大兩兩張角（度）；< 2 條 → 0 */
export function bearingSpreadDeg(bearings: number[]): number {
  let max = 0;
  for (let i = 0; i < bearings.length; i++) {
    for (let j = i + 1; j < bearings.length; j++) {
      const d = angleDiffDeg(bearings[i]!, bearings[j]!);
      if (d > max) max = d;
    }
  }
  return max;
}

/** 由前一筆 track + 本 tick 感測器航向推進 TMA 追蹤 */
export function advanceTmaTrack(
  prev: TmaTrack | undefined, headingDeg: number, dtSec: number,
): TmaTrack {
  const last = prev?.lastHeadingDeg ?? headingDeg;
  const dManeuver = angleDiffDeg(headingDeg, last);
  return {
    holdSec: (prev?.holdSec ?? 0) + dtSec,
    lastHeadingDeg: headingDeg,
    maneuverDeg: (prev?.maneuverDeg ?? 0) + dManeuver,
  };
}

/** TMA 是否已解算出距離（持續追蹤夠久 + 自身機動足夠） */
export function tmaSolved(t: TmaTrack | undefined): boolean {
  if (!t) return false;
  return t.holdSec >= TMA_MIN_HOLD_SEC && t.maneuverDeg >= TMA_MIN_MANEUVER_DEG;
}
