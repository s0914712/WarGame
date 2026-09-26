/**
 * 蒙地卡羅搜索模擬 — 解析式 POD 之外的第二把尺。
 *
 * ── 為什麼需要 ──────────────────────────────────────────
 * 解析公式 POD = f(W/S) 假設：目標在區內均勻分布且靜止、航線飛得完全精確、
 * 感測器全程可用。真實搜索三項都不成立。蒙地卡羅直接抽樣模擬，能回答解析式
 * 答不出的問題：
 *   - 目標會漂（風流合成），搜完的區塊可能又漂進未搜區
 *   - 航線導航誤差造成航跡間距實際不等於規劃值 → 產生覆蓋缺口
 *   - 目標位置若集中在基準點附近（非均勻），POD 會高於均勻假設
 *   - 「多久才找得到」的時間分布 —— 解析式只給最終 POD，不給時間軸
 *
 * ── 感測器模型 ──────────────────────────────────────────
 * 採 Koopman 反立方律。橫向距離函數（單次通過的發現機率）：
 *
 *   p(x) = 1 − exp(−k / x²)，  k = W² / (4π)
 *
 * 其中 k 由「橫向距離函數的積分必須等於掃掠寬度 W」定出（∫p dx = 2√(πk) = W）。
 *
 * 但 p(x) 是「單次通過」的機率，不能每個時間步各擲一次（那會讓靠近航跡的目標
 * 拿到數十次獨立機會，POD 灌水到 100%）。正確做法是還原其瞬時偵測率
 * γ(r) = c / r³（此即「反立方律」之名的由來），並要求沿直線通過的積分等於
 * −ln(1−p(x))：
 *
 *   ∫γ dt = (c/v)·∫ds/(x²+s²)^{3/2} = (c/v)·(2/x²)  ≡  k/x²   →   c = k·v/2
 *
 * 對有限線段（起訖沿航跡座標 s₁、s₂，相對最近點）則有封閉解：
 *
 *   ∫γ dt = (k/2)·(1/x²)·[ s₂/√(x²+s₂²) − s₁/√(x²+s₁²) ]
 *
 * 此式對步長不敏感（分 500 段累加與一次算完到小數第 8 位相同），
 * 且 s₁→−∞、s₂→+∞ 時退化回 k/x²，與橫向距離函數完全一致。
 * 此模型與文件的 POD 圖高度吻合（C = 0.3–2.0 範圍內差距 0.1–2.0 個百分點），
 * 因此「理想條件下的蒙地卡羅」會收斂到解析式結果 —— 兩者不一致時，差距即為
 * 漂流 / 導航誤差 / 感測器可用率所造成的真實衰減，而非模型打架。
 *
 * 純函式 + 可重現亂數（LCG seed），零瀏覽器依賴。
 */
import type { LngLat } from "../types";
import { makeRng } from "../sim/rng";
import { KM_PER_NM } from "./patterns";
import type { DroneTrack, SearchBox } from "./tracks";
import { measureBox } from "./tracks";

const KM_PER_DEG_LAT = 111.32;

/** 目標初始位置分布 */
export type TargetDistribution =
  /** 均勻散布於搜索區（解析式的假設） */
  | { kind: "uniform" }
  /** 以基準點為中心的二維常態分布，sigmaNm 為單軸標準差 */
  | { kind: "gaussian"; datum: LngLat; sigmaNm: number };

export interface MonteCarloInput {
  box: SearchBox;
  tracks: DroneTrack[];
  /** 修正後掃掠寬度（浬）—— 決定橫向距離函數 */
  sweepWidthNm: number;
  /** 搜索載具對地速度（節） */
  speedKn: number;
  /** 目標初始位置分布 */
  distribution: TargetDistribution;
  /** 目標漂移速度（節）；0 = 靜止目標 */
  driftKn: number;
  /** 目標漂移方向（度，0 = 向北）；設 null 則每次試驗隨機取向 */
  driftBearingDeg: number | null;
  /**
   * 航跡導航誤差（浬，1σ）。每架每架次抽一個固定的橫向偏移，
   * 模擬風偏 / 自動駕駛偏差造成的實際航跡間距不等於規劃值。
   */
  navErrorSigmaNm: number;
  /** 感測器可用率（0..1）；每架每次試驗抽一次，模擬酬載故障 / 鏡頭失效 */
  sensorAvailability: number;
  /** 試驗次數 */
  trials: number;
  /** 時間步長（秒）；越小越精確、越慢 */
  stepSec?: number;
  seed?: number;
}

export interface MonteCarloResult {
  trials: number;
  /** 經驗發現機率 */
  pod: number;
  /** POD 的 95% 信賴區間（Wilson score interval） */
  podCi95: [number, number];
  /** 發現案例的平均發現時間（hr） */
  meanDetectionHr: number;
  /** 發現時間的中位數 / 90 百分位（hr）；未達該百分位則為 null */
  medianDetectionHr: number | null;
  p90DetectionHr: number | null;
  /** POD 隨時間累積曲線（供繪圖）：[小時, 累積POD] */
  podOverTime: [number, number][];
  /** 全部航線飛完所需時間（hr） */
  searchDurationHr: number;
}

/** Koopman 反立方律橫向距離函數；k 由 ∫p dx = W 定出 */
export function lateralRangeDetection(lateralNm: number, sweepWidthNm: number): number {
  const x = Math.abs(lateralNm);
  if (sweepWidthNm <= 0) return 0;
  if (x < 1e-6) return 1;
  const k = (sweepWidthNm * sweepWidthNm) / (4 * Math.PI);
  return 1 - Math.exp(-k / (x * x));
}

function kmPerDegLng(latDeg: number): number {
  return KM_PER_DEG_LAT * Math.cos((latDeg * Math.PI) / 180);
}

/** 以 refLat 為基準，把經緯度轉成本地平面座標（浬） */
function toLocalNm(p: LngLat, origin: LngLat): [number, number] {
  const dxKm = (p[0] - origin[0]) * kmPerDegLng(origin[1]);
  const dyKm = (p[1] - origin[1]) * KM_PER_DEG_LAT;
  return [dxKm / KM_PER_NM, dyKm / KM_PER_NM];
}

/** Box–Muller：標準常態亂數 */
function gaussian(rng: () => number): number {
  const u1 = Math.max(1e-12, rng());
  const u2 = rng();
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
}

/** 把航線重取樣成等時間間隔的位置序列（本地平面座標，浬） */
function resampleTrack(
  track: DroneTrack, origin: LngLat, speedKn: number, stepSec: number,
): [number, number][] {
  const pts = track.waypoints.map((w) => toLocalNm(w, origin));
  if (pts.length < 2) return pts.length === 1 && pts[0] ? [pts[0]] : [];

  const stepNm = (speedKn * stepSec) / 3600;
  const out: [number, number][] = [];
  let segIdx = 0;
  let along = 0;                        // 於當前航段已走的距離

  const segLen = (i: number): number => {
    const a = pts[i], b = pts[i + 1];
    if (!a || !b) return 0;
    return Math.hypot(b[0] - a[0], b[1] - a[1]);
  };

  while (segIdx < pts.length - 1) {
    const a = pts[segIdx], b = pts[segIdx + 1];
    if (!a || !b) break;
    const len = segLen(segIdx);
    if (len <= 1e-9) { segIdx++; along = 0; continue; }
    if (along > len) { along -= len; segIdx++; continue; }
    const f = along / len;
    out.push([a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]);
    along += stepNm;
    if (out.length > 200000) break;     // 安全閥
  }
  return out;
}

/**
 * 載具沿一段航跡線段通過時，對某目標累積的偵測指數 ∫γ dt。
 *
 * 封閉解（見檔頭推導）：(k/2)·(1/x²)·[ s₂/√(x²+s₂²) − s₁/√(x²+s₁²) ]
 * 其中 x = 目標到該線段所在直線的垂直距離、s₁ s₂ = 線段兩端相對最近點的沿線座標。
 *
 * 回傳指數而非機率，讓多架 / 多段可直接相加後一次取 exp（機率不能相加）。
 */
export function segmentDetectionExponent(
  px: number, py: number,
  ax: number, ay: number, bx: number, by: number,
  k: number,
): number {
  const dx = bx - ax, dy = by - ay;
  const len = Math.hypot(dx, dy);
  if (len <= 1e-9 || k <= 0) return 0;
  const ux = dx / len, uy = dy / len;
  const wx = px - ax, wy = py - ay;
  const sCpa = wx * ux + wy * uy;                    // 最近點的沿線座標（自 a 起算）
  const perp2 = Math.max(wx * wx + wy * wy - sCpa * sCpa, 1e-8);  // 垂直距離平方（避免奇異點）
  const s1 = -sCpa, s2 = len - sCpa;                 // 線段兩端相對最近點
  const term = s2 / Math.sqrt(perp2 + s2 * s2) - s1 / Math.sqrt(perp2 + s1 * s1);
  return (k / 2) * (1 / perp2) * term;
}

/**
 * 執行蒙地卡羅模擬。
 *
 * 每次試驗：
 *   1. 依分布抽目標初始位置、抽漂移方向
 *   2. 每架抽一個固定橫向導航偏移、抽感測器是否可用
 *   3. 逐時間步推進：目標漂移、各架沿航線前進，
 *      以「該步內走過的線段」對目標算最近點距離 → 套橫向距離函數
 *   4. 任一架偵測成功即記錄發現時間並結束該次試驗
 */
export function runMonteCarlo(input: MonteCarloInput): MonteCarloResult {
  const stepSec = input.stepSec ?? 30;
  const trials = Math.max(1, Math.floor(input.trials));
  const rng = makeRng(input.seed ?? 20260906);
  const m = measureBox(input.box);
  const origin: LngLat = [input.box.west, input.box.south];

  // 航線只需重取樣一次（各次試驗共用），導航偏移於試驗中疊加
  const sampled = input.tracks.map((t) => resampleTrack(t, origin, input.speedKn, stepSec));
  const maxSteps = sampled.reduce((mx, s) => Math.max(mx, s.length), 0);
  const searchDurationHr = (maxSteps * stepSec) / 3600;
  if (maxSteps === 0) {
    return {
      trials, pod: 0, podCi95: [0, 0], meanDetectionHr: 0,
      medianDetectionHr: null, p90DetectionHr: null,
      podOverTime: [], searchDurationHr: 0,
    };
  }

  // 各架的航向法向量（做橫向導航偏移用）：取每條航線的首段方向
  const trackNormals = sampled.map((s) => {
    const a = s[0], b = s[Math.min(1, s.length - 1)];
    if (!a || !b) return [0, 1] as [number, number];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    return [-dy / len, dx / len] as [number, number];
  });

  const detectionHrs: number[] = [];
  // 每個時間步累計「到此步為止已發現」的試驗數，用來畫 POD-時間曲線
  const detectedByStep = new Int32Array(maxSteps + 1);

  const gaussianTarget = input.distribution.kind === "gaussian" ? input.distribution : null;
  const datumLocal = gaussianTarget ? toLocalNm(gaussianTarget.datum, origin) : null;
  const k = (input.sweepWidthNm * input.sweepWidthNm) / (4 * Math.PI);

  for (let t = 0; t < trials; t++) {
    // ── 目標初始位置 ──
    let tx: number, ty: number;
    if (gaussianTarget && datumLocal) {
      tx = datumLocal[0] + gaussian(rng) * gaussianTarget.sigmaNm;
      ty = datumLocal[1] + gaussian(rng) * gaussianTarget.sigmaNm;
    } else {
      tx = rng() * m.widthNm;
      ty = rng() * m.heightNm;
    }

    // ── 漂移 ──
    const brgDeg = input.driftBearingDeg ?? rng() * 360;
    const brg = (brgDeg * Math.PI) / 180;
    const driftPerStepNm = (input.driftKn * stepSec) / 3600;
    const dvx = Math.sin(brg) * driftPerStepNm;
    const dvy = Math.cos(brg) * driftPerStepNm;

    // ── 每架：導航偏移 + 感測器可用性 ──
    const offsets: [number, number][] = [];
    const active: boolean[] = [];
    for (let d = 0; d < sampled.length; d++) {
      const e = input.navErrorSigmaNm > 0 ? gaussian(rng) * input.navErrorSigmaNm : 0;
      const n = trackNormals[d] ?? [0, 1];
      offsets.push([n[0] * e, n[1] * e]);
      active.push(rng() < input.sensorAvailability);
    }

    // ── 逐步推進 ──
    // 每步把各架的偵測指數加總，再一次轉成該步的偵測機率
    // （指數可加、機率不可加）。
    let detectedStep = -1;
    let prevTx = tx, prevTy = ty;
    for (let step = 1; step < maxSteps && detectedStep < 0; step++) {
      tx += dvx; ty += dvy;
      // 目標於該步的代表位置取步首步尾中點
      const mx = (prevTx + tx) / 2, my = (prevTy + ty) / 2;
      let exponent = 0;
      for (let d = 0; d < sampled.length; d++) {
        if (!active[d]) continue;
        const path = sampled[d];
        if (!path) continue;
        const a = path[step - 1], b = path[step];
        if (!a || !b) continue;
        const off = offsets[d] ?? [0, 0];
        exponent += segmentDetectionExponent(
          mx, my,
          a[0] + off[0], a[1] + off[1],
          b[0] + off[0], b[1] + off[1],
          k,
        );
      }
      if (exponent > 0 && rng() < 1 - Math.exp(-exponent)) detectedStep = step;
      prevTx = tx; prevTy = ty;
    }

    if (detectedStep >= 0) {
      detectionHrs.push((detectedStep * stepSec) / 3600);
      detectedByStep[detectedStep] = (detectedByStep[detectedStep] ?? 0) + 1;
    }
  }

  // ── 統計 ──
  const found = detectionHrs.length;
  const pod = found / trials;
  const meanDetectionHr = found > 0 ? detectionHrs.reduce((a, b) => a + b, 0) / found : 0;

  const sortedHrs = [...detectionHrs].sort((a, b) => a - b);
  const quantileOfAll = (q: number): number | null => {
    // 以「全部試驗」為分母：未找到的算 +∞，故 q 超過 POD 時回 null
    const idx = Math.ceil(q * trials) - 1;
    return idx < sortedHrs.length ? (sortedHrs[idx] ?? null) : null;
  };

  // POD 累積曲線（最多 60 個取樣點，避免資料量過大）
  const buckets = Math.min(60, maxSteps);
  const podOverTime: [number, number][] = [];
  let running = 0;
  let bucketEdge = 0;
  for (let step = 0; step <= maxSteps; step++) {
    running += detectedByStep[step] ?? 0;
    const nextEdge = Math.floor(((podOverTime.length + 1) * maxSteps) / buckets);
    if (step >= nextEdge || step === maxSteps) {
      podOverTime.push([(step * stepSec) / 3600, running / trials]);
      bucketEdge = nextEdge;
    }
  }
  void bucketEdge;

  return {
    trials,
    pod,
    podCi95: wilsonInterval(found, trials),
    meanDetectionHr,
    medianDetectionHr: quantileOfAll(0.5),
    p90DetectionHr: quantileOfAll(0.9),
    podOverTime,
    searchDurationHr,
  };
}

/**
 * Wilson score 區間 — 比常態近似在 p 接近 0 或 1 時可靠得多，
 * 且不會給出超出 [0,1] 的界線。
 */
export function wilsonInterval(successes: number, n: number, z = 1.96): [number, number] {
  if (n <= 0) return [0, 0];
  const p = successes / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = p + z2 / (2 * n);
  const halfWidth = z * Math.sqrt((p * (1 - p) + z2 / (4 * n)) / n);
  return [
    Math.max(0, (centre - halfWidth) / denom),
    Math.min(1, (centre + halfWidth) / denom),
  ];
}
