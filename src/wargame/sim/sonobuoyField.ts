/**
 * 聲標區域搜索 — 佈設與偵測機率計算（移植自反潛作業工具
 * 「6.定翼機-聲標區域搜索 3.0」，Koopman 隨機搜索理論）。
 *
 * 核心：區域偵測機率（泊松模型）
 *   P_FZ = 1 − exp( −(N/A)·(π·R² + 2·R·V·T)·Pk·Pjc )
 * N=聲標數、A=搜索面積(nm²)、R=MDR 偵測半徑(nm)、V=潛艦速(kn)、T=搜索時數(hr)、
 * Pk=可靠率(0.9)、Pjc=接觸機率(0.5)。π·R²=單枚靜態足跡；2RVT=潛艦在 T 內穿越掃出的面積。
 *
 * 另含：反推所需聲標數、最佳近正方格網佈局、間距、交錯佈點。純函式。
 */
import type { LngLat } from "../types";
import { haversineKm } from "./geo";

// ── 工具固定常數 ─────────────────────────────────────────
export const RELIABILITY_PK = 0.9;
export const CONTACT_PJC = 0.5;
export const YARDS_PER_NM = 2025.3718285;
export const KM_PER_NM = 1.852;

// ── 佈設預設 ─────────────────────────────────────────────
export const DEFAULT_MDR_KM = 4;            // 被動聲標偵測半徑（~2.16 nm）
export const DEFAULT_SUB_SPEED_KN = 8;      // 假想威脅潛艦速度（P_FZ 規劃用）
export const DEFAULT_LIFETIME_SEC = 3600;   // 聲標電池壽命

export const yardsToNm = (yd: number) => yd / YARDS_PER_NM;
export const kmToNm = (km: number) => km / KM_PER_NM;
export const nmToKm = (nm: number) => nm * KM_PER_NM;

/** 區域偵測機率 P_FZ（clamp 0..1） */
export function areaDetectionProbability(args: {
  count: number; searchAreaNm2: number; mdrNm: number;
  subSpeedKn: number; searchTimeHr: number;
}): number {
  const A = args.searchAreaNm2 > 0 ? args.searchAreaNm2 : 50.0;
  const R = args.mdrNm > 0 ? args.mdrNm : 1.5;
  const swept = Math.PI * R * R + 2 * R * args.subSpeedKn * args.searchTimeHr;
  const p = 1 - Math.exp(-(args.count / A) * swept * RELIABILITY_PK * CONTACT_PJC);
  return Math.max(0, Math.min(1, p));
}

/** 達到期望機率所需的聲標數 */
export function requiredSonobuoys(args: {
  searchAreaNm2: number; targetProbability: number; mdrNm: number;
  subSpeedKn: number; searchTimeHr: number;
}): number {
  const Pt = args.targetProbability > 0 && args.targetProbability < 1 ? args.targetProbability : 0.8;
  const R = args.mdrNm;
  const den = (Math.PI * R * R + 2 * R * args.subSpeedKn * args.searchTimeHr) * RELIABILITY_PK * CONTACT_PJC;
  if (den === 0) return 20.0;
  return -args.searchAreaNm2 * Math.log(1 - Pt) / den;
}

/** 最佳格網佈局：使分布盡量均勻、接近區域長寬比 */
export function optimalLayout(totalSonobuoys: number, lengthNm: number, widthNm: number): { rows: number; cols: number } {
  const N = totalSonobuoys > 0 ? totalSonobuoys : 1;
  const L = lengthNm > 0 ? lengthNm : 10;
  const W = widthNm > 0 ? widthNm : 5;
  const aspect = L / W;
  let bestRows = 1, bestCols = N, minScore = Infinity;
  for (let rows = 1; rows <= N; rows++) {
    const cols = Math.ceil(N / rows);
    const waste = rows * cols - N;
    if (rows > 1 && cols > 1) {
      const rowSpacing = W / (rows - 1);
      const colSpacing = L / (cols - 1);
      const spacingRatio = colSpacing / rowSpacing;
      const score = waste + Math.abs(spacingRatio - aspect) * 10;
      if (score < minScore) { minScore = score; bestRows = rows; bestCols = cols; }
    }
  }
  return { rows: bestRows, cols: bestCols };
}

export interface SonobuoyFieldPlan {
  buoys: LngLat[];
  rows: number;
  cols: number;
  count: number;
  pFZ: number;
  lengthNm: number;
  widthNm: number;
  mdrKm: number;
}

/**
 * 由兩角定義的搜索框，產生聲標格網佈點（交錯）+ 區域偵測機率。
 * 框為軸對齊（兩角取 min/max lng/lat）；長=lng 向、寬=lat 向。
 */
export function planSonobuoyField(args: {
  cornerA: LngLat; cornerB: LngLat; count: number;
  mdrKm?: number; subSpeedKn?: number; searchTimeHr?: number;
}): SonobuoyFieldPlan {
  const minLng = Math.min(args.cornerA[0], args.cornerB[0]);
  const maxLng = Math.max(args.cornerA[0], args.cornerB[0]);
  const minLat = Math.min(args.cornerA[1], args.cornerB[1]);
  const maxLat = Math.max(args.cornerA[1], args.cornerB[1]);
  const midLat = (minLat + maxLat) / 2;
  const midLng = (minLng + maxLng) / 2;

  const lengthKm = haversineKm([minLng, midLat], [maxLng, midLat]);
  const widthKm = haversineKm([midLng, minLat], [midLng, maxLat]);
  const lengthNm = kmToNm(lengthKm);
  const widthNm = kmToNm(widthKm);

  const count = Math.max(1, Math.floor(args.count));
  const mdrKm = args.mdrKm ?? DEFAULT_MDR_KM;
  const { rows, cols } = optimalLayout(count, lengthNm, widthNm);

  // 交錯格網佈點（box 內分數座標插值）
  const buoys: LngLat[] = [];
  const colFracStep = cols > 1 ? 1 / (cols - 1) : 0;
  outer:
  for (let i = 0; i < rows; i++) {
    const yFrac = rows > 1 ? i / (rows - 1) : 0.5;
    const stagger = i % 2 === 1 ? colFracStep / 2 : 0;   // 偶數列向右偏移半欄
    for (let j = 0; j < cols; j++) {
      if (buoys.length >= count) break outer;
      let xFrac = cols > 1 ? j / (cols - 1) : 0.5;
      xFrac = Math.min(1, xFrac + stagger);
      const lng = minLng + xFrac * (maxLng - minLng);
      const lat = minLat + yFrac * (maxLat - minLat);
      buoys.push([lng, lat]);
    }
  }

  const pFZ = areaDetectionProbability({
    count: buoys.length,
    searchAreaNm2: Math.max(0.0001, lengthNm * widthNm),
    mdrNm: kmToNm(mdrKm),
    subSpeedKn: args.subSpeedKn ?? DEFAULT_SUB_SPEED_KN,
    searchTimeHr: args.searchTimeHr ?? DEFAULT_LIFETIME_SEC / 3600,
  });

  return { buoys, rows, cols, count: buoys.length, pFZ, lengthNm, widthNm, mdrKm };
}
