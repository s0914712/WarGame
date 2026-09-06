/**
 * 發現機率（POD）— 依《搜索參數的選擇與機率》第七節。
 *
 * 覆蓋因子   C = W ÷ S
 * 單次 POD   POD = f(C)
 * 累積 POD   POD_cum = 1 − Π(1 − POD_i)
 *
 * ── 曲線來源 ──────────────────────────────────────────────
 * 文件本身只給 POD 圖與表 4-2 的數值，未給公式。表 4-2 的三個錨點
 * （C=0.5 → 47.0%、C=0.8 → 約 68%、C=1.0 → 78.0%）可由 Weibull 型
 * 偵測律精確重建：
 *
 *   POD(C) = 1 − exp( −1.5141 · C^1.2539 )
 *
 * 其中 1.5141 = −ln(1−0.78) 由 C=1.0 定出、1.2539 由 C=0.5 定出，
 * C=0.8 則為未參與擬合的獨立驗證點（算得 68.2%，文件記「約 68%」）。
 * 以此曲線代入累積公式可完整重現表 4-2 全部十格數值。
 *
 * 另提供古典隨機搜索律 POD = 1 − e^(−C) 作為保守對照模型。
 */

export type PodModel = "iamsar_chart" | "random_search";

const IAMSAR_A = 1.5141;
const IAMSAR_B = 1.2539;

/** 覆蓋因子 C = W ÷ S（掃掠寬度與航跡間距皆需同單位） */
export function coverageFactor(sweepWidthNm: number, trackSpacingNm: number): number {
  if (trackSpacingNm <= 0) return 0;
  return sweepWidthNm / trackSpacingNm;
}

/** 單次搜索的發現機率（0..1） */
export function podFromCoverage(C: number, model: PodModel = "iamsar_chart"): number {
  if (C <= 0) return 0;
  const p = model === "random_search"
    ? 1 - Math.exp(-C)
    : 1 - Math.exp(-IAMSAR_A * Math.pow(C, IAMSAR_B));
  return Math.max(0, Math.min(1, p));
}

/**
 * 由目標 POD 反解所需覆蓋因子 C。
 * 用於「使用者給定時間 / 目標 POD → 反算航跡間距」。
 */
export function coverageForPod(targetPod: number, model: PodModel = "iamsar_chart"): number {
  const p = Math.max(0, Math.min(0.999999, targetPod));
  if (p <= 0) return 0;
  if (model === "random_search") return -Math.log(1 - p);
  return Math.pow(-Math.log(1 - p) / IAMSAR_A, 1 / IAMSAR_B);
}

/**
 * 累積 POD — 同一區域重複搜索 n 次（文件七(三)、七(四)3）。
 * 各次 POD 可不同（擴展搜索時覆蓋因子會下降）。
 */
export function cumulativePod(pods: number[]): number {
  let miss = 1;
  for (const p of pods) miss *= 1 - Math.max(0, Math.min(1, p));
  return 1 - miss;
}

/** 同一覆蓋因子重複搜索 n 次的累積 POD */
export function cumulativePodRepeated(C: number, searches: number, model: PodModel = "iamsar_chart"): number {
  const p = podFromCoverage(C, model);
  return 1 - Math.pow(1 - p, Math.max(0, searches));
}

/**
 * 文件六(六)：不建議以低於 0.5 之覆蓋因子搜索。
 * 長時間重複搜索且載具有限時，0.5 是可接受下限。
 */
export const MIN_RECOMMENDED_COVERAGE = 0.5;

/** 文件六(一)：情況許可時，航跡間距 S 應等於掃掠寬度 W（即 C = 1.0） */
export const IDEAL_COVERAGE = 1.0;

/**
 * POD 顯示上限。
 *
 * 文件七(四)5 明訂：「不得將覆蓋因子為 1.0 或 100%，直接解讀為發現機率為 100%。
 * 即使掃掠面積與待搜索面積相同，亦不代表搜索隊已實際檢查搜索區內的每一處位置。」
 * 故本規劃器不顯示 100%，一律封頂於 99.9%。
 */
export const POD_DISPLAY_CAP = 0.999;

/** 供 UI 顯示用的 POD（套上文件七(四)5 的封頂） */
export function podForDisplay(pod: number): number {
  return Math.min(pod, POD_DISPLAY_CAP);
}

/**
 * 文件 POD 圖的橫軸約在 C = 0..2；超過此範圍屬曲線外推，
 * 數值僅供比較、不應視為文件背書的規劃值。
 */
export const CHART_COVERAGE_LIMIT = 2.0;

/** 覆蓋因子的規劃評語（供 UI 直接顯示） */
export function coverageVerdict(C: number): {
  level: "poor" | "minimum" | "good" | "ideal" | "excess"; note: string;
} {
  if (C < MIN_RECOMMENDED_COVERAGE) {
    return { level: "poor", note: `覆蓋因子低於 0.5 —— 文件六(六)不建議；應縮小航跡間距或增加載具` };
  }
  if (C < 0.8) {
    return { level: "minimum", note: `達文件建議下限 0.5，適用於載具有限之長時間重複搜索` };
  }
  if (C < IDEAL_COVERAGE) {
    return { level: "good", note: `覆蓋良好；接近文件六(一)之理想值 S = W` };
  }
  if (C <= CHART_COVERAGE_LIMIT) {
    return { level: "ideal", note: `S ≤ W，符合文件六(一)理想值；注意 C = 1.0 不等於 POD 100%（七(四)5）` };
  }
  return {
    level: "excess",
    note: `C = ${C.toFixed(2)} 已超出文件 POD 圖範圍（約 0–2），POD 屬曲線外推值；`
      + `航跡間距遠小於掃掠寬度代表重複掃掠同一片海面，可考慮放寬 S 以擴大搜索面積`,
  };
}
