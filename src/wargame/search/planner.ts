/**
 * 搜索規劃解算 — 依《搜索參數的選擇與機率》七(八)「搜索五要素」。
 *
 *   A = T × N × P × S
 *   A 面積(浬²)  T 時間(hr)  N 資產數  P 速度(kn)  S 航跡間距(浬)
 *
 * 兩個解算方向：
 *   正解 solveForTime()   — 給定區域 + 無人機數量 → 掃完全區時間 + POD
 *   反解 solveForAssets() — 給定區域 + 可用時間（+ 目標 POD）→ 建議數量與搜索方式
 *
 * 純函式；所有內部計算以海里 / 小時 / 節為單位。
 */
import {
  correctedSweepWidthNm, uncorrectedSweepWidthNm,
  type SearchTargetClass, type SweepWidthCorrections,
} from "./sweepWidth";
import {
  coverageFactor, coverageForPod, coverageVerdict, cumulativePodRepeated,
  podFromCoverage, MIN_RECOMMENDED_COVERAGE, IDEAL_COVERAGE, type PodModel,
} from "./pod";
export { podForDisplay, POD_DISPLAY_CAP, CHART_COVERAGE_LIMIT } from "./pod";
import {
  KM_PER_NM, recommendPattern, SEARCH_PATTERNS, trackSpacingCeilingNm,
  type SearchPatternId,
} from "./patterns";

export const kmToNm = (km: number) => km / KM_PER_NM;
export const nmToKm = (nm: number) => nm * KM_PER_NM;

/** 搜索區幾何（由地圖兩角框推導） */
export interface SearchAreaGeometry {
  areaNm2: number;
  /** 長邊 / 短邊（浬） */
  longSideNm: number;
  shortSideNm: number;
}

/** 感測與環境條件 —— 決定掃掠寬度 W */
export interface SensorConditions {
  targetClass: SearchTargetClass;
  visibilityKm: number;
  altitudeFt: number;
  corrections: SweepWidthCorrections;
}

/** 無人機性能 */
export interface AssetProfile {
  /** 搜索速度（節） */
  speedKn: number;
  /** 滯空時數（hr）；0 = 不限制 */
  enduranceHr: number;
  /** 由基地到搜索區的單程進場時間（hr）—— 會從滯空時數扣除，往返各一次 */
  transitHrOneWay: number;
}

export interface SweepWidthBreakdown {
  uncorrectedNm: number;
  correctedNm: number;
  corrections: SweepWidthCorrections;
}

function computeSweepWidth(cond: SensorConditions): SweepWidthBreakdown {
  const uncorrectedNm = uncorrectedSweepWidthNm({
    targetClass: cond.targetClass,
    visibilityKm: cond.visibilityKm,
    altitudeFt: cond.altitudeFt,
  });
  return {
    uncorrectedNm,
    correctedNm: correctedSweepWidthNm(uncorrectedNm, cond.corrections),
    corrections: cond.corrections,
  };
}

/** 每架無人機單一架次的有效搜索時數（滯空扣掉往返進場） */
export function onStationHoursPerSortie(asset: AssetProfile): number {
  if (asset.enduranceHr <= 0) return Infinity;
  return Math.max(0, asset.enduranceHr - 2 * asset.transitHrOneWay);
}

// ── 正解：給定區域 + 架數 → 時間 + POD ───────────────────
export interface SolveForTimeInput {
  area: SearchAreaGeometry;
  droneCount: number;
  asset: AssetProfile;
  sensor: SensorConditions;
  /** 航跡間距（浬）；省略 → 依文件六(一)取 S = W（理想值），再受條件上限夾限 */
  trackSpacingNm?: number;
  /** 環境（決定 S 的條件上限） */
  windKn: number;
  podModel?: PodModel;
}

export interface SolveForTimeResult {
  sweepWidth: SweepWidthBreakdown;
  /** 實際採用的航跡間距（浬） */
  trackSpacingNm: number;
  spacingCeiling: ReturnType<typeof trackSpacingCeilingNm>;
  /** 覆蓋因子 C = W / S */
  coverage: number;
  coverageVerdict: ReturnType<typeof coverageVerdict>;
  /** 單次搜索 POD */
  pod: number;
  /** 掃完全區所需時間（hr）—— A = T×N×P×S 解 T */
  timeHr: number;
  /** 全隊總航跡里程（浬） */
  totalTrackNm: number;
  /** 每架的航跡里程（浬） */
  trackPerDroneNm: number;
  /** 單架次可用搜索時數；Infinity = 未設滯空限制 */
  onStationHr: number;
  /** 每架需要幾個架次（含往返）才能飛完；1 = 一趟飛完 */
  sortiesPerDrone: number;
  /** 含輪替後的實際歷時（hr）—— 架次之間需返場整補 */
  elapsedHrWithSorties: number;
  warnings: string[];
}

export function solveForTime(input: SolveForTimeInput): SolveForTimeResult {
  const warnings: string[] = [];
  const sweepWidth = computeSweepWidth(input.sensor);
  const W = sweepWidth.correctedNm;

  const ceiling = trackSpacingCeilingNm(input.windKn, input.sensor.visibilityKm);
  // 文件六(一)：情況許可時 S = W；同時不得超過條件上限
  let S = input.trackSpacingNm ?? Math.min(W, ceiling.ceilingNm);
  if (!(S > 0)) {
    S = 0.1;
    warnings.push("掃掠寬度為 0（能見度過低）—— 航跡間距以 0.1 浬保底，結果僅供參考");
  }
  if (input.trackSpacingNm !== undefined && input.trackSpacingNm > ceiling.ceilingNm) {
    warnings.push(`航跡間距 ${input.trackSpacingNm.toFixed(2)} 浬超過${ceiling.condition === "good" ? "良好" : "不良"}條件建議上限 ${ceiling.ceilingNm} 浬`);
  }

  const C = coverageFactor(W, S);
  const verdict = coverageVerdict(C);
  if (verdict.level === "poor" || verdict.level === "excess") warnings.push(verdict.note);

  const N = Math.max(1, Math.floor(input.droneCount));
  const P = Math.max(0.1, input.asset.speedKn);

  // A = T × N × P × S  →  T = A / (N × P × S)
  const timeHr = input.area.areaNm2 / (N * P * S);
  const totalTrackNm = timeHr * N * P;
  const trackPerDroneNm = totalTrackNm / N;

  const onStationHr = onStationHoursPerSortie(input.asset);
  let sortiesPerDrone = 1;
  let elapsedHrWithSorties = timeHr;
  if (Number.isFinite(onStationHr)) {
    if (onStationHr <= 0) {
      warnings.push("往返進場時間已超過滯空時數 —— 此機型無法抵達該區域執行搜索");
      sortiesPerDrone = Infinity;
      elapsedHrWithSorties = Infinity;
    } else if (timeHr > onStationHr) {
      sortiesPerDrone = Math.ceil(timeHr / onStationHr);
      // 每個架次都要多飛一趟往返
      elapsedHrWithSorties = timeHr + sortiesPerDrone * 2 * input.asset.transitHrOneWay;
      warnings.push(`單架次滯空 ${onStationHr.toFixed(1)} hr 不足以飛完 ${timeHr.toFixed(1)} hr 的航線，每架需 ${sortiesPerDrone} 個架次輪替`);
    } else {
      elapsedHrWithSorties = timeHr + 2 * input.asset.transitHrOneWay;
    }
  }

  return {
    sweepWidth,
    trackSpacingNm: S,
    spacingCeiling: ceiling,
    coverage: C,
    coverageVerdict: verdict,
    pod: podFromCoverage(C, input.podModel),
    timeHr,
    totalTrackNm,
    trackPerDroneNm,
    onStationHr,
    sortiesPerDrone,
    elapsedHrWithSorties,
    warnings,
  };
}

// ── 反解：給定區域 + 時間 → 建議架數與搜索方式 ────────────
export interface SolveForAssetsInput {
  area: SearchAreaGeometry;
  /** 可用時間（hr） */
  availableHr: number;
  asset: AssetProfile;
  sensor: SensorConditions;
  /** 目標單次 POD（0..1）；決定所需覆蓋因子，進而決定 S */
  targetPod: number;
  windKn: number;
  podModel?: PodModel;
  /** 圖形建議用的情境輸入 */
  context?: {
    datumUncertaintyNm?: number;
    targetBiasedToOneEnd?: boolean;
    hasKnownTrackLine?: boolean;
  };
}

export interface SolveForAssetsResult {
  sweepWidth: SweepWidthBreakdown;
  /** 為達成目標 POD 所需的覆蓋因子 */
  requiredCoverage: number;
  /** 由 C 反解的航跡間距（浬），已受條件上限夾限 */
  trackSpacingNm: number;
  spacingCeiling: ReturnType<typeof trackSpacingCeilingNm>;
  /** 夾限後實際可達的覆蓋因子與 POD */
  achievedCoverage: number;
  achievedPod: number;
  /** 建議無人機數量（已向上取整） */
  recommendedDrones: number;
  /** 未取整的理論值 —— 讓使用者看到離下一架有多遠 */
  exactDrones: number;
  /** 採用建議數量後的實際掃區時間（hr） */
  actualTimeHr: number;
  /** 每架需要的架次數 */
  sortiesPerDrone: number;
  /** 建議搜索圖形 */
  pattern: SearchPatternId;
  patternReason: string;
  patternAlternatives: SearchPatternId[];
  /** 若時間 / 架數受限而無法達標，提供的替代方案 */
  fallback?: {
    /** 以建議架數在可用時間內能達到的最佳單次 POD */
    bestPod: number;
    /** 改採重複搜索達標所需次數（文件七(三)累積 POD） */
    repeatsForTarget: number;
    note: string;
  };
  warnings: string[];
}

export function solveForAssets(input: SolveForAssetsInput): SolveForAssetsResult {
  const warnings: string[] = [];
  const sweepWidth = computeSweepWidth(input.sensor);
  const W = sweepWidth.correctedNm;
  const ceiling = trackSpacingCeilingNm(input.windKn, input.sensor.visibilityKm);

  // 目標 POD → 所需覆蓋因子 → 航跡間距 S = W / C
  const requiredCoverage = Math.max(MIN_RECOMMENDED_COVERAGE, coverageForPod(input.targetPod, input.podModel));
  let S = W > 0 ? W / requiredCoverage : 0.1;
  if (S > ceiling.ceilingNm) {
    S = ceiling.ceilingNm;
    warnings.push(`理論航跡間距超過${ceiling.condition === "good" ? "良好" : "不良"}條件上限，已夾限為 ${ceiling.ceilingNm} 浬（${ceiling.note}）`);
  }
  if (!(S > 0)) {
    S = 0.1;
    warnings.push("掃掠寬度為 0（能見度過低）—— 航跡間距以 0.1 浬保底");
  }

  const achievedCoverage = coverageFactor(W, S);
  const achievedPod = podFromCoverage(achievedCoverage, input.podModel);
  const achievedVerdict = coverageVerdict(achievedCoverage);
  if (achievedVerdict.level === "poor" || achievedVerdict.level === "excess") {
    warnings.push(achievedVerdict.note);
  }

  // 可用於實際搜索的時間：扣掉往返進場
  const onStation = onStationHoursPerSortie(input.asset);
  const T = Math.max(0.01, input.availableHr);
  const P = Math.max(0.1, input.asset.speedKn);

  // A = T × N × P × S  →  N = A / (T × P × S)
  const exactDrones = input.area.areaNm2 / (T * P * S);
  const recommendedDrones = Math.max(1, Math.ceil(exactDrones - 1e-9));
  const actualTimeHr = input.area.areaNm2 / (recommendedDrones * P * S);

  let sortiesPerDrone = 1;
  if (Number.isFinite(onStation) && onStation > 0 && actualTimeHr > onStation) {
    sortiesPerDrone = Math.ceil(actualTimeHr / onStation);
    warnings.push(`單架次滯空 ${onStation.toFixed(1)} hr（已扣往返 ${(2 * input.asset.transitHrOneWay).toFixed(1)} hr）不足 ${actualTimeHr.toFixed(1)} hr，每架需 ${sortiesPerDrone} 架次輪替`);
  } else if (Number.isFinite(onStation) && onStation <= 0) {
    warnings.push("往返進場時間已超過滯空時數 —— 此機型無法抵達該區域執行搜索");
  }

  const aspectRatio = input.area.shortSideNm > 0 ? input.area.longSideNm / input.area.shortSideNm : 1;
  const rec = recommendPattern({
    datumUncertaintyNm: input.context?.datumUncertaintyNm ?? 0,
    areaNm2: input.area.areaNm2,
    aspectRatio,
    droneCount: recommendedDrones,
    targetBiasedToOneEnd: input.context?.targetBiasedToOneEnd ?? false,
    hasKnownTrackLine: input.context?.hasKnownTrackLine ?? false,
  });

  // 達標檢查
  let fallback: SolveForAssetsResult["fallback"];
  if (achievedPod < input.targetPod - 1e-6) {
    let repeats = 1;
    while (repeats < 10 && cumulativePodRepeated(achievedCoverage, repeats, input.podModel) < input.targetPod) repeats++;
    fallback = {
      bestPod: achievedPod,
      repeatsForTarget: repeats,
      note: `單次搜索受條件上限限制只能達到 ${(achievedPod * 100).toFixed(1)}% POD；`
        + `依文件七(三)以相同覆蓋重複搜索 ${repeats} 次，累積 POD 可達 `
        + `${(cumulativePodRepeated(achievedCoverage, repeats, input.podModel) * 100).toFixed(1)}%`,
    };
  }

  return {
    sweepWidth,
    requiredCoverage,
    trackSpacingNm: S,
    spacingCeiling: ceiling,
    achievedCoverage,
    achievedPod,
    recommendedDrones,
    exactDrones,
    actualTimeHr,
    sortiesPerDrone,
    pattern: rec.pattern,
    patternReason: rec.reason,
    patternAlternatives: rec.alternatives,
    fallback,
    warnings,
  };
}

/** 給 UI 用：把 SearchPatternId 轉成完整說明 */
export function patternInfo(id: SearchPatternId) {
  return SEARCH_PATTERNS[id];
}

/** 理想覆蓋（S = W）下的參考值，供 UI 顯示「若不受條件限制」 */
export const REFERENCE_IDEAL_COVERAGE = IDEAL_COVERAGE;
