/**
 * 最佳搜索矩形 —— Stone (1983) §5「Rectangle Plans」。
 *
 * 目標位置為二維常態分布時，理論最佳的搜索努力密度是個拋物面（Koopman），
 * 航空器根本飛不出來。Stone 因此退而求其次，只考慮「以分布均值為中心、
 * 邊平行主軸」的矩形族：
 *
 *   L₁ = 2Kσ₁,  L₂ = 2Kσ₂     （K ≥ 0 為唯一參數，稱 size factor）
 *
 * 把努力 E = W·v·t 均勻鋪在該矩形上，發現機率為
 *
 *   P_D(K) = [Φ(K) − Φ(−K)]² · [1 − exp(−E / (4K²σ₁σ₂))]
 *            └─ 目標落在矩形內 ─┘  └─ 落在內時被發現（指數偵測函數）─┘
 *
 * 對 K 一維最佳化即得「搜索框該畫多大」。Stone 的範例中，最佳矩形達成
 * POD 0.55，而理論最佳計畫是 0.58 —— 簡單矩形拿到 95% 的最優解。
 *
 * 這正是本規劃器原本缺的一塊：使用者可以隨手畫一個兩倍大的框，
 * 白白丟掉一半 POD 而工具毫無反應。
 *
 * 純函式、語言中立。
 */
import { KM_PER_NM } from "./patterns";

/** 標準常態 CDF（用 erf 的 Abramowitz–Stegun 近似，絕對誤差 < 1.5e-7） */
export function normalCdf(x: number): number {
  return 0.5 * (1 + erf(x / Math.SQRT2));
}

function erf(x: number): number {
  const sign = x < 0 ? -1 : 1;
  const ax = Math.abs(x);
  const t = 1 / (1 + 0.3275911 * ax);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t
    - 0.284496736) * t + 0.254829592) * t * Math.exp(-ax * ax);
  return sign * y;
}

/** 目標落在 size factor 為 K 的矩形內的機率 = [Φ(K) − Φ(−K)]² */
export function containmentProbability(K: number): number {
  if (K <= 0) return 0;
  const p = normalCdf(K) - normalCdf(-K);
  return p * p;
}

export interface RectanglePlanInput {
  /** 目標分布沿第一主軸的標準差（浬） */
  sigma1Nm: number;
  /** 沿第二主軸的標準差（浬） */
  sigma2Nm: number;
  /** 可投入的搜索努力 E = W·v·t（掃掠面積，浬²） */
  effortNm2: number;
}

export interface RectanglePlanPoint {
  K: number;
  /** 矩形邊長（浬） */
  length1Nm: number;
  length2Nm: number;
  areaNm2: number;
  /** 目標落在矩形內的機率 */
  containment: number;
  /** 落在矩形內時被發現的條件機率（指數偵測函數） */
  conditionalDetection: number;
  /** 無條件發現機率 P_D(K) */
  pod: number;
}

/** 指定 K 的矩形計畫評估 */
export function evaluateRectangle(input: RectanglePlanInput, K: number): RectanglePlanPoint {
  const { sigma1Nm: s1, sigma2Nm: s2, effortNm2: E } = input;
  const containment = containmentProbability(K);
  const area = 4 * K * K * s1 * s2;
  const conditional = area > 0 && E > 0 ? 1 - Math.exp(-E / area) : 0;
  return {
    K,
    length1Nm: 2 * K * s1,
    length2Nm: 2 * K * s2,
    areaNm2: area,
    containment,
    conditionalDetection: conditional,
    pod: containment * conditional,
  };
}

export interface OptimalRectangleResult {
  /** 最佳 size factor */
  best: RectanglePlanPoint;
  /** P_D 對 K 的曲線（供繪圖與判斷最佳解平不平） */
  curve: RectanglePlanPoint[];
  /**
   * 使用者實際畫的框（若有提供）與最佳解的比較。
   * lossFraction = 1 − P_D(使用者) / P_D(最佳)
   */
  userPlan?: {
    /** 由使用者框的面積反推的等效 K（沿用相同長寬比假設） */
    equivalentK: number;
    pod: number;
    lossFraction: number;
  };
}

/**
 * 對 K 做一維最佳化。P_D(K) 單峰（K→0 時 containment→0、K→∞ 時
 * conditional→0），故用粗掃 + 黃金分割細化即可穩定求解。
 */
export function optimalRectangle(
  input: RectanglePlanInput,
  userAreaNm2?: number,
): OptimalRectangleResult {
  const { sigma1Nm: s1, sigma2Nm: s2 } = input;
  if (!(s1 > 0 && s2 > 0 && input.effortNm2 > 0)) {
    const zero = evaluateRectangle(input, 0);
    return { best: zero, curve: [zero] };
  }

  // 粗掃 K ∈ (0, 4]，取樣 80 點作為曲線輸出
  const curve: RectanglePlanPoint[] = [];
  let bestIdx = 0;
  for (let i = 1; i <= 80; i++) {
    const K = (i / 80) * 4;
    const p = evaluateRectangle(input, K);
    curve.push(p);
    if (p.pod > (curve[bestIdx]?.pod ?? -1)) bestIdx = curve.length - 1;
  }

  // 在最佳點左右一格內做黃金分割細化
  const lo = curve[Math.max(0, bestIdx - 1)]?.K ?? 0.05;
  const hi = curve[Math.min(curve.length - 1, bestIdx + 1)]?.K ?? 4;
  const best = goldenSection((K) => evaluateRectangle(input, K).pod, lo, hi);
  const bestPoint = evaluateRectangle(input, best);

  let userPlan: OptimalRectangleResult["userPlan"];
  if (userAreaNm2 !== undefined && userAreaNm2 > 0) {
    // 使用者的框面積 = 4K²σ₁σ₂  →  等效 K
    const equivalentK = Math.sqrt(userAreaNm2 / (4 * s1 * s2));
    const pod = evaluateRectangle(input, equivalentK).pod;
    userPlan = {
      equivalentK,
      pod,
      lossFraction: bestPoint.pod > 0 ? Math.max(0, 1 - pod / bestPoint.pod) : 0,
    };
  }

  return { best: bestPoint, curve, userPlan };
}

/** 黃金分割搜尋單峰函數的極大值點 */
function goldenSection(f: (x: number) => number, a: number, b: number, iters = 60): number {
  const phi = (Math.sqrt(5) - 1) / 2;
  let lo = a, hi = b;
  let c = hi - phi * (hi - lo);
  let d = lo + phi * (hi - lo);
  for (let i = 0; i < iters; i++) {
    if (f(c) > f(d)) { hi = d; d = c; c = hi - phi * (hi - lo); }
    else { lo = c; c = d; d = lo + phi * (hi - lo); }
  }
  return (lo + hi) / 2;
}

/**
 * 由搜索資產推導可投入的努力 E = W·v·t（浬²）。
 * 多架同時搜索則 t 用「總飛行時數」（N 架 × 每架時數）。
 */
export function searchEffortNm2(sweepWidthNm: number, speedKn: number, totalAircraftHours: number): number {
  return Math.max(0, sweepWidthNm * speedKn * totalAircraftHours);
}

/** 公里 ↔ 浬（與 patterns.ts 共用同一常數） */
export const NM_PER_KM = 1 / KM_PER_NM;
