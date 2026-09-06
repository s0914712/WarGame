/**
 * 偵測函數 b(t) —— Stone (1983) §4「Determine Detection Function」。
 *
 * 掃掠寬度 W 只描述感測器；要把「投入多少搜索努力」換成「發現機率」，
 * 還需要偵測函數：
 *
 *   b(t) = 給定目標在區內、已搜索 t 小時後發現它的機率
 *
 * ── 三條曲線（Stone Figure 6）────────────────────────────
 * 令搜索努力 E = W·v·t（掃掠面積）、區域面積 A、覆蓋因子 C = E/A：
 *
 *   定距上界   b(t) = min(C, 1)              航跡放置完全精確、S = W
 *   指數下界   b(t) = 1 − exp(−C)            Koopman 隨機搜索公式
 *
 * Stone §4 Problem Areas 明說：隨機搜索公式是「試圖把努力均勻鋪在搜索區」
 * 這類搜索的**合理下界**，而實際偵測函數會落在兩條曲線之間。因此本模組
 * 一律回傳「上界 / 標稱 / 下界」三個值，讓 UI 把 POD 呈現為區間而非單點。
 *
 * ── σ/W 決定落在區間何處（Stone Figure 7）───────────────
 * 設第 i 條航跡的橫向座標為常態分布、標準差 σ（風偏 / 自動駕駛誤差）。
 * σ/W → 0 時退化為定距上界；σ/W 變大時，一次完整覆蓋的發現機率降到
 * 1 − e⁻¹ ≈ 63.2%（Reber [1956]），也就是指數函數在 C = 1 的值。
 *
 * 本模組以 σ/W 在兩條界線之間插值，插值權重取
 *   w(σ/W) = 1 − exp(−k·(σ/W)²)
 * 使 σ/W = 0 時完全採定距、σ/W ≳ 0.7 時已幾乎完全採指數（與 Figure 7
 * 的形狀一致：該圖在 σ/W ≈ 0.5–1 之間完成大部分下降）。
 *
 * 純函式、語言中立。
 */

/** 一次搜索的偵測機率三值：上界（定距）/ 標稱 / 下界（指數） */
export interface DetectionBounds {
  /** 定距律 min(C,1) —— 航跡放置完全精確時的上界 */
  upper: number;
  /** 依 σ/W 在上下界之間插值得到的標稱值 */
  nominal: number;
  /** Koopman 隨機搜索律 1 − exp(−C) —— Stone 認定的合理下界 */
  lower: number;
  /** 用於插值的 σ/W */
  sigmaOverW: number;
  /** 標稱值有多接近下界（0 = 定距上界、1 = 指數下界） */
  exponentialWeight: number;
}

/** 定距（cookie-cutter）偵測律 —— 上界 */
export function definiteRangeDetection(coverage: number): number {
  return Math.max(0, Math.min(1, coverage));
}

/** Koopman 隨機搜索律 —— 下界 */
export function exponentialDetection(coverage: number): number {
  if (coverage <= 0) return 0;
  return 1 - Math.exp(-coverage);
}

/**
 * σ/W → 指數律權重。
 * 形狀取 1 − exp(−k(σ/W)²)，k 選 4.0 使 σ/W = 0.5 時權重 ≈ 0.63、
 * σ/W = 1.0 時 ≈ 0.98，與 Stone Figure 7 的下降區間相符。
 */
const SIGMA_SHAPE_K = 4.0;

export function exponentialWeightFromSigma(sigmaOverW: number): number {
  const x = Math.max(0, sigmaOverW);
  return 1 - Math.exp(-SIGMA_SHAPE_K * x * x);
}

/**
 * 一次完整覆蓋（C = 1）在大 σ/W 極限下的發現機率 —— Stone 引 Reber [1956]。
 * 這條線值得在 UI 上畫出來當地板參考。
 */
export const ONE_MINUS_E_INV = 1 - Math.exp(-1);   // ≈ 0.6321

/**
 * 由覆蓋因子與航跡放置誤差算出偵測機率的上下界與標稱值。
 *
 * @param coverage    覆蓋因子 C = W/S（等價於 E/A）
 * @param sigmaOverW  航跡放置誤差標準差 ÷ 掃掠寬度；0 = 導航完美
 */
export function detectionBounds(coverage: number, sigmaOverW: number): DetectionBounds {
  const upper = definiteRangeDetection(coverage);
  const lower = exponentialDetection(coverage);
  const w = exponentialWeightFromSigma(sigmaOverW);
  return {
    upper,
    lower,
    nominal: upper + (lower - upper) * w,
    sigmaOverW: Math.max(0, sigmaOverW),
    exponentialWeight: w,
  };
}

// ── 掃掠寬度不確定性（Stone §4）──────────────────────────
/**
 * 掃掠寬度的離散分布。Stone §4：W 不確定時（目標狀態未知、感測器未實測），
 * 應對 W 給一個分布 {ωᵢ, βᵢ}，並以
 *
 *   b̄(t) = Σ βᵢ · B(t, ωᵢ)
 *
 * 當作實際偵測函數來規劃 —— Stone (Section 2.3) 證明這樣做是對的。
 * Richardson and Belkin [1972] 給了「不考慮 W 不確定性」在平均發現時間上的代價。
 */
export interface SweepWidthDistribution {
  /** 各情形的掃掠寬度（浬）與其機率；機率會自動正規化 */
  outcomes: { sweepWidthNm: number; probability: number }[];
}

/**
 * 由標稱掃掠寬度產生三點分布（悲觀 / 標稱 / 樂觀）。
 *
 * spread = 0.4 表示悲觀為標稱的 60%、樂觀為 140%。權重取 0.3 / 0.4 / 0.3
 * ——刻意讓悲觀端與樂觀端等重，不預設「多半會比較好」。
 */
export function threePointSweepWidth(nominalNm: number, spread = 0.4): SweepWidthDistribution {
  const s = Math.max(0, Math.min(0.9, spread));
  return {
    outcomes: [
      { sweepWidthNm: nominalNm * (1 - s), probability: 0.3 },
      { sweepWidthNm: nominalNm, probability: 0.4 },
      { sweepWidthNm: nominalNm * (1 + s), probability: 0.3 },
    ],
  };
}

/** 確定的（單點）掃掠寬度 */
export function certainSweepWidth(nm: number): SweepWidthDistribution {
  return { outcomes: [{ sweepWidthNm: nm, probability: 1 }] };
}

/**
 * 對掃掠寬度分布取期望的偵測機率 b̄ = Σ βᵢ B(ωᵢ)。
 *
 * 注意：覆蓋因子隨 W 變動（C = W/S），故每個 ωᵢ 要各自算 C 再加權，
 * **不能**先把 W 平均再算一次 —— 那會高估（Jensen 不等式，b 對 C 為凹函數）。
 */
export function expectedDetectionBounds(
  dist: SweepWidthDistribution,
  trackSpacingNm: number,
  navErrorSigmaNm: number,
): DetectionBounds {
  const total = dist.outcomes.reduce((s, o) => s + Math.max(0, o.probability), 0);
  if (total <= 0 || trackSpacingNm <= 0) {
    return { upper: 0, nominal: 0, lower: 0, sigmaOverW: 0, exponentialWeight: 0 };
  }
  let upper = 0, nominal = 0, lower = 0, sigW = 0, wsum = 0;
  for (const o of dist.outcomes) {
    const beta = Math.max(0, o.probability) / total;
    const W = Math.max(0, o.sweepWidthNm);
    const C = W / trackSpacingNm;
    const sw = W > 0 ? navErrorSigmaNm / W : 0;
    const b = detectionBounds(C, sw);
    upper += beta * b.upper;
    nominal += beta * b.nominal;
    lower += beta * b.lower;
    sigW += beta * sw;
    wsum += beta * b.exponentialWeight;
  }
  return { upper, nominal, lower, sigmaOverW: sigW, exponentialWeight: wsum };
}

/**
 * 掃掠寬度分布的期望值（僅供顯示；規劃請用 expectedDetectionBounds，
 * 不要拿這個平均 W 去算單一 POD —— 見上方 Jensen 註記）。
 */
export function meanSweepWidth(dist: SweepWidthDistribution): number {
  const total = dist.outcomes.reduce((s, o) => s + Math.max(0, o.probability), 0);
  if (total <= 0) return 0;
  return dist.outcomes.reduce((s, o) => s + (Math.max(0, o.probability) / total) * o.sweepWidthNm, 0);
}
