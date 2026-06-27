/**
 * 紀錄片「軌跡時間插值」— 借鏡 battle-of-hong-kong-1941 entities.js 的 sampleTrack。
 *
 * HK 版：track 為 [{d(day), lng, lat, s, st}]，sampleTrack(track, day) 依 day 線性內插
 *   位置與兵力，兩端 clamp。本版改成以「模擬秒（simSec）」為時間軸，給紀錄片模式
 *   的 marker 一條作者手刻的電影運動曲線——平滑、可控、與分鏡對齊，獨立於引擎物理。
 *
 * 用途：紀錄片啟用時，buildFeatureCollection 對「有軌跡的單位」用 sampleTrack 覆寫
 *   marker 座標（其餘單位 fallback 回引擎真實位置）。引擎模擬完全不受影響。
 */

export interface TrackPoint {
  /** 此控制點對應的模擬時間（秒）。需單調遞增。 */
  atSimSec: number;
  lng: number;
  lat: number;
}

export interface SampledPose {
  lng: number;
  lat: number;
  /** 行進方位角（度，0 = 正北，順時針）；可供 marker 旋轉 / 尾跡使用。 */
  bearing: number;
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** 兩經緯度點之間的概略方位角（度）。小範圍用平面近似即可。 */
function bearingOf(a: TrackPoint, b: TrackPoint): number {
  const meanLatRad = (((a.lat + b.lat) / 2) * Math.PI) / 180;
  const dx = (b.lng - a.lng) * Math.cos(meanLatRad);
  const dy = b.lat - a.lat;
  if (dx === 0 && dy === 0) return 0;
  const deg = (Math.atan2(dx, dy) * 180) / Math.PI; // atan2(east, north)
  return (deg + 360) % 360;
}

/**
 * 在 simSec 時刻沿 track 取樣位置。
 * - simSec ≤ 起點時間 → clamp 在起點（方位朝第二點）
 * - simSec ≥ 終點時間 → clamp 在終點（方位沿最後一段）
 * - 中間 → 找出所在區段做線性內插
 * track 為空回 null（caller fallback 回引擎位置）。
 */
export function sampleTrack(track: TrackPoint[], simSec: number): SampledPose | null {
  if (track.length === 0) return null;
  const first = track[0]!;
  if (track.length === 1) return { lng: first.lng, lat: first.lat, bearing: 0 };

  const last = track[track.length - 1]!;
  if (simSec <= first.atSimSec) {
    return { lng: first.lng, lat: first.lat, bearing: bearingOf(first, track[1]!) };
  }
  if (simSec >= last.atSimSec) {
    return { lng: last.lng, lat: last.lat, bearing: bearingOf(track[track.length - 2]!, last) };
  }
  for (let i = 0; i < track.length - 1; i++) {
    const a = track[i]!;
    const b = track[i + 1]!;
    if (simSec >= a.atSimSec && simSec <= b.atSimSec) {
      const span = b.atSimSec - a.atSimSec || 1;
      const t = (simSec - a.atSimSec) / span;
      return { lng: lerp(a.lng, b.lng, t), lat: lerp(a.lat, b.lat, t), bearing: bearingOf(a, b) };
    }
  }
  return { lng: last.lng, lat: last.lat, bearing: 0 };
}
