/**
 * 地理計算工具 — 球面距離 + 方位 + 大圓中介點。
 *
 * 採近似（地球當球體），對台海尺度（< 500 km）誤差 < 0.5%。
 */
import type { LngLat } from "../types";

const EARTH_R_KM = 6371;
const DEG = Math.PI / 180;

/** Haversine 距離（公里） */
export function haversineKm(a: LngLat, b: LngLat): number {
  const [lng1, lat1] = a;
  const [lng2, lat2] = b;
  const dLat = (lat2 - lat1) * DEG;
  const dLng = (lng2 - lng1) * DEG;
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * DEG) * Math.cos(lat2 * DEG) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_R_KM * Math.asin(Math.sqrt(h));
}

/** 從 a 看 b 的方位角（度，0=北、90=東） */
export function bearingDeg(a: LngLat, b: LngLat): number {
  const [lng1, lat1] = a;
  const [lng2, lat2] = b;
  const phi1 = lat1 * DEG;
  const phi2 = lat2 * DEG;
  const dLng = (lng2 - lng1) * DEG;
  const y = Math.sin(dLng) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(dLng);
  const brng = Math.atan2(y, x) / DEG;
  return (brng + 360) % 360;
}

/**
 * 從 a 沿 a→b 方向前進 km 公里後的新座標。
 * 小尺度用平面近似（< 100km），夠用。
 */
export function advanceTowardKm(a: LngLat, b: LngLat, km: number): LngLat {
  const total = haversineKm(a, b);
  if (total <= 0 || km <= 0) return [a[0], a[1]];
  if (km >= total) return [b[0], b[1]];
  const frac = km / total;
  return [a[0] + (b[0] - a[0]) * frac, a[1] + (b[1] - a[1]) * frac];
}

/** knots → km/sec */
export function knotsToKmPerSec(knots: number): number {
  return (knots * 1.852) / 3600;
}
