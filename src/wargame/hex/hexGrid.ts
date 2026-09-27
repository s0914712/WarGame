/**
 * 兵棋六角格（flat-top axial 座標）— 純函式，無 browser 依賴。
 *
 * 每格面積 ≈ 100 km²（約 10×10 km）：
 *   area = (3√3 / 2) · s²  →  s（中心到角）≈ 6.20 km、對邊距 ≈ 10.75 km
 *
 * 投影：以固定原點做等距矩形（equirectangular）近似，經度方向乘 cos(原點緯度)。
 * 原點固定 → 同一 (q, r) 永遠對應同一塊地，勢力標記存檔跨場景 / 重載都穩定。
 * 台海周邊（±5° 緯度）面積誤差 < 5%，對兵棋格足夠。
 */
import type { LngLat } from "../types";

export const HEX_AREA_KM2 = 100;
/** 中心到角距離（km） */
export const HEX_SIZE_KM = Math.sqrt((2 * HEX_AREA_KM2) / (3 * Math.sqrt(3)));

const ORIGIN_LNG = 120;
const ORIGIN_LAT = 24;
const KM_PER_DEG_LAT = 110.574;
const KM_PER_DEG_LNG = 111.32 * Math.cos((ORIGIN_LAT * Math.PI) / 180);
const SQRT3 = Math.sqrt(3);

export interface Hex { q: number; r: number }

export function hexKey(h: Hex): string {
  return `${h.q},${h.r}`;
}

export function parseHexKey(key: string): Hex {
  const [q, r] = key.split(",").map(Number);
  return { q: q!, r: r! };
}

function toKm(lng: number, lat: number): [number, number] {
  return [(lng - ORIGIN_LNG) * KM_PER_DEG_LNG, (lat - ORIGIN_LAT) * KM_PER_DEG_LAT];
}

function toLngLat(x: number, y: number): LngLat {
  return [ORIGIN_LNG + x / KM_PER_DEG_LNG, ORIGIN_LAT + y / KM_PER_DEG_LAT];
}

function hexCenterKm(h: Hex): [number, number] {
  return [HEX_SIZE_KM * 1.5 * h.q, HEX_SIZE_KM * SQRT3 * (h.r + h.q / 2)];
}

export function hexCenter(h: Hex): LngLat {
  const [x, y] = hexCenterKm(h);
  return toLngLat(x, y);
}

/** 經緯度 → 所在六角格（cube rounding） */
export function lngLatToHex(lng: number, lat: number): Hex {
  const [x, y] = toKm(lng, lat);
  const qf = ((2 / 3) * x) / HEX_SIZE_KM;
  const rf = ((-1 / 3) * x + (SQRT3 / 3) * y) / HEX_SIZE_KM;
  const sf = -qf - rf;
  let q = Math.round(qf), r = Math.round(rf);
  const s = Math.round(sf);
  const dq = Math.abs(q - qf), dr = Math.abs(r - rf), ds = Math.abs(s - sf);
  if (dq > dr && dq > ds) q = -r - s;
  else if (dr > ds) r = -q - s;
  return { q, r };
}

/** 六角格外框（封閉環，7 點） */
export function hexRing(h: Hex): LngLat[] {
  const [cx, cy] = hexCenterKm(h);
  const ring: LngLat[] = [];
  for (let i = 0; i <= 6; i++) {
    const a = (Math.PI / 3) * (i % 6);
    ring.push(toLngLat(cx + HEX_SIZE_KM * Math.cos(a), cy + HEX_SIZE_KM * Math.sin(a)));
  }
  return ring;
}

/**
 * 範圍內所有六角格（含邊緣外一圈）。超過 maxCount 回 null（呼叫端應隱藏格線）。
 */
export function hexesInBounds(west: number, south: number, east: number, north: number, maxCount: number): Hex[] | null {
  const [x0, y0] = toKm(west, south);
  const [x1, y1] = toKm(east, north);
  const qMin = Math.floor(x0 / (1.5 * HEX_SIZE_KM)) - 1;
  const qMax = Math.ceil(x1 / (1.5 * HEX_SIZE_KM)) + 1;
  const rowH = SQRT3 * HEX_SIZE_KM;
  const est = (qMax - qMin + 1) * ((y1 - y0) / rowH + 3);
  if (est > maxCount) return null;
  const out: Hex[] = [];
  for (let q = qMin; q <= qMax; q++) {
    const rMin = Math.floor(y0 / rowH - q / 2) - 1;
    const rMax = Math.ceil(y1 / rowH - q / 2) + 1;
    for (let r = rMin; r <= rMax; r++) out.push({ q, r });
  }
  return out;
}
