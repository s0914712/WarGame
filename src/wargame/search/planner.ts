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
  podFromCoverage, MIN_RECOMMENDED_COVERAGE, IDEAL_COVERAGE,
  type CoverageLevel, type PodModel,
} from "./pod";
export { podForDisplay, POD_DISPLAY_CAP, CHART_COVERAGE_LIMIT } from "./pod";
import {
  KM_PER_NM, recommendPattern, SEARCH_PATTERNS, trackSpacingCeilingNm,
  type PatternReasonCode, type SearchPatternId,
} from "./patterns";
import {
  certainSweepWidth, expectedDetectionBounds, threePointSweepWidth,
  type DetectionBounds,
} from "./detection";
import {
  expectedFalseTargets, poissonInterval95,
  NO_FALSE_TARGETS, type FalseTargetModel,
} from "./falseTargets";

/**
 * 規劃提示 — 結構化代碼 + 參數，文字由 i18n 層（./i18n.ts）產生，
 * 讓引擎保持語言中立。
 */
export type NoticeCode =
  | "zero_sweep_width"        // 掃掠寬度為 0（能見度過低）
  | "spacing_over_ceiling"    // 使用者指定的 S 超過條件上限
  | "spacing_clamped"         // 理論 S 被夾限到條件上限
  | "coverage_poor"           // C < 0.5，文件六(六)不建議
  | "coverage_excess"         // C 超出文件 POD 圖範圍，屬外推
  | "sorties_required"        // 單架次滯空不足，需輪替
  | "transit_exceeds_endurance" // 往返已超過滯空時數
  | "false_contacts";           // 假目標查證吃掉時間預算

export interface PlannerNotice {
  code: NoticeCode;
  severity: "info" | "warning";
  params: Record<string, number | string>;
}

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
  /**
   * 航跡放置誤差 1σ（浬）—— Stone §4 Figure 7：σ/W 決定實際偵測函數
   * 落在「定距上界」與「指數下界」之間何處。省略 = 0（導航完美）。
   */
  navErrorSigmaNm?: number;
  /**
   * 掃掠寬度不確定性（相對比例，0 = 確定）。Stone §4：W 不確定時應對它
   * 給分布並取 b̄ = Σβᵢ B(ωᵢ)。0.4 表示悲觀 60% / 樂觀 140%。
   */
  sweepWidthSpread?: number;
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

/**
 * 假目標對時間預算的影響（Stone §6）。
 *
 * 廣域搜索覆蓋整區需要的載具時數是固定的（= A/(P·S)，與架數無關）；
 * 假目標另外吃掉查證時數。故：
 *
 *   覆蓋率 C = W/S
 *   預期接觸數 = δ·A·(1 − e^(−C))     假目標與真目標偵測函數相同
 *   查證時數 = 預期接觸數 × τ
 *   總需求時數 = 廣域時數 + 查證時數
 *
 * 這裡不必解不動點：廣域時數由面積與航跡間距決定，不隨架數變動。
 * （falseTargets.contactBudget 解的是另一個問題 —— 「總時數固定時廣域佔多少」。）
 */
export interface ContactLoad {
  /** 預期偵測到的假接觸數 */
  expectedContacts: number;
  contacts95: [number, number];
  /** 查證吃掉的載具時數 */
  investigationHours: number;
  /** 若接觸數落在 95% 上緣要多花多少時數 */
  worstCaseInvestigationHours: number;
  /** 查證佔總需求時數的比例 */
  timeShare: number;
}

function contactLoad(
  model: FalseTargetModel, areaNm2: number, coverage: number, broadHours: number,
): ContactLoad {
  const lambdaArea = expectedFalseTargets(model, areaNm2);
  const detected = lambdaArea * (coverage > 0 ? 1 - Math.exp(-coverage) : 0);
  const invest = detected * Math.max(0, model.investigationHr);
  const ci = poissonInterval95(detected);
  const total = broadHours + invest;
  return {
    expectedContacts: detected,
    contacts95: ci,
    investigationHours: invest,
    worstCaseInvestigationHours: ci[1] * Math.max(0, model.investigationHr),
    timeShare: total > 0 ? invest / total : 0,
  };
}

/** 依 Stone §4 算出的偵測機率上下界（供 UI 以區間呈現，而非單點） */
export interface DetectionBoundsResult extends DetectionBounds {
  /** 掃掠寬度是否被當成不確定量處理 */
  sweepWidthUncertain: boolean;
}

function boundsFor(
  sensor: SensorConditions, correctedW: number, trackSpacingNm: number,
): DetectionBoundsResult {
  const spread = sensor.sweepWidthSpread ?? 0;
  const dist = spread > 0 ? threePointSweepWidth(correctedW, spread) : certainSweepWidth(correctedW);
  const b = expectedDetectionBounds(dist, trackSpacingNm, sensor.navErrorSigmaNm ?? 0);
  return { ...b, sweepWidthUncertain: spread > 0 };
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
  /**
   * 直接指定覆蓋因子 C，由 S = W / C 反推航跡間距。
   * 規劃者常直接以 C 思考（0.75 疏、1.0 理想、1.3 密），比填 S 直觀。
   * 優先序：trackSpacingNm > coverageFactor > 自動。
   */
  coverageFactor?: number;
  /** 環境（決定 S 的條件上限） */
  windKn: number;
  podModel?: PodModel;
  /** 假目標模型（Stone §6）；省略 = 不考慮 */
  falseTargets?: FalseTargetModel;
}

export interface SolveForTimeResult {
  sweepWidth: SweepWidthBreakdown;
  /** 實際採用的航跡間距（浬） */
  trackSpacingNm: number;
  spacingCeiling: ReturnType<typeof trackSpacingCeilingNm>;
  /** 覆蓋因子 C = W / S */
  coverage: number;
  coverageLevel: CoverageLevel;
  /** 單次搜索 POD（IAMSAR 曲線） */
  pod: number;
  /** Stone §4 的偵測機率上下界 —— POD 應以區間呈現 */
  bounds: DetectionBoundsResult;
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
  /** 假目標查證負擔（Stone §6） */
  contacts: ContactLoad;
  /** 含接觸查證後、每架實際需要的時數 */
  timeWithContactsHr: number;
  notices: PlannerNotice[];
}

export function solveForTime(input: SolveForTimeInput): SolveForTimeResult {
  const notices: PlannerNotice[] = [];
  const sweepWidth = computeSweepWidth(input.sensor);
  const W = sweepWidth.correctedNm;

  const ceiling = trackSpacingCeilingNm(input.windKn, input.sensor.visibilityKm);
  // 優先序：明寫 S > 指定覆蓋因子 C（S = W/C）> 自動（文件六(一) S = W，受條件上限夾限）
  let S = input.trackSpacingNm
    ?? (input.coverageFactor && input.coverageFactor > 0 ? W / input.coverageFactor : undefined)
    ?? Math.min(W, ceiling.ceilingNm);
  if (!(S > 0)) {
    S = 0.1;
    notices.push({ code: "zero_sweep_width", severity: "warning", params: {} });
  }
  if (S > ceiling.ceilingNm && (input.trackSpacingNm !== undefined || input.coverageFactor !== undefined)) {
    notices.push({
      code: "spacing_over_ceiling", severity: "warning",
      params: { spacing: S, ceiling: ceiling.ceilingNm, condition: ceiling.condition },
    });
  }

  const C = coverageFactor(W, S);
  const verdict = coverageVerdict(C);
  if (verdict === "poor") notices.push({ code: "coverage_poor", severity: "warning", params: { coverage: C } });
  if (verdict === "excess") notices.push({ code: "coverage_excess", severity: "warning", params: { coverage: C } });

  const N = Math.max(1, Math.floor(input.droneCount));
  const P = Math.max(0.1, input.asset.speedKn);

  // A = T × N × P × S  →  T = A / (N × P × S)
  const timeHr = input.area.areaNm2 / (N * P * S);
  const contacts = contactLoad(
    input.falseTargets ?? NO_FALSE_TARGETS, input.area.areaNm2, C, timeHr * N,
  );
  const timeWithContactsHr = timeHr + contacts.investigationHours / N;
  if (contacts.expectedContacts >= 1) {
    notices.push({
      code: "false_contacts", severity: "warning",
      params: {
        contacts: contacts.expectedContacts,
        hours: contacts.investigationHours,
        share: contacts.timeShare * 100,
        lo: contacts.contacts95[0], hi: contacts.contacts95[1],
      },
    });
  }
  const totalTrackNm = timeHr * N * P;
  const trackPerDroneNm = totalTrackNm / N;

  const onStationHr = onStationHoursPerSortie(input.asset);
  let sortiesPerDrone = 1;
  let elapsedHrWithSorties = timeHr;
  if (Number.isFinite(onStationHr)) {
    if (onStationHr <= 0) {
      notices.push({ code: "transit_exceeds_endurance", severity: "warning", params: {} });
      sortiesPerDrone = Infinity;
      elapsedHrWithSorties = Infinity;
    } else if (timeWithContactsHr > onStationHr) {
      sortiesPerDrone = Math.ceil(timeWithContactsHr / onStationHr);
      // 每個架次都要多飛一趟往返
      elapsedHrWithSorties = timeHr + sortiesPerDrone * 2 * input.asset.transitHrOneWay;
      notices.push({
        code: "sorties_required", severity: "warning",
        params: { onStation: onStationHr, needed: timeHr, sorties: sortiesPerDrone },
      });
    } else {
      elapsedHrWithSorties = timeHr + 2 * input.asset.transitHrOneWay;
    }
  }

  return {
    sweepWidth,
    trackSpacingNm: S,
    spacingCeiling: ceiling,
    coverage: C,
    coverageLevel: verdict,
    pod: podFromCoverage(C, input.podModel),
    bounds: boundsFor(input.sensor, W, S),
    timeHr,
    totalTrackNm,
    trackPerDroneNm,
    onStationHr,
    sortiesPerDrone,
    elapsedHrWithSorties,
    contacts,
    timeWithContactsHr,
    notices,
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
  /** 假目標模型（Stone §6）；省略 = 不考慮 */
  falseTargets?: FalseTargetModel;
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
  /** Stone §4 的偵測機率上下界 */
  bounds: DetectionBoundsResult;
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
  patternReasonCode: PatternReasonCode;
  patternMultiAssetNote: boolean;
  patternAlternatives: SearchPatternId[];
  /** 若時間 / 架數受限而無法達標，提供的替代方案 */
  fallback?: {
    /** 以建議架數在可用時間內能達到的最佳單次 POD */
    bestPod: number;
    /** 改採重複搜索達標所需次數（文件七(三)累積 POD） */
    repeatsForTarget: number;
    /** 重複該次數後的累積 POD */
    cumulativePod: number;
  };
  coverageLevel: CoverageLevel;
  /** 假目標查證負擔（Stone §6） */
  contacts: ContactLoad;
  notices: PlannerNotice[];
}

export function solveForAssets(input: SolveForAssetsInput): SolveForAssetsResult {
  const notices: PlannerNotice[] = [];
  const sweepWidth = computeSweepWidth(input.sensor);
  const W = sweepWidth.correctedNm;
  const ceiling = trackSpacingCeilingNm(input.windKn, input.sensor.visibilityKm);

  // 目標 POD → 所需覆蓋因子 → 航跡間距 S = W / C
  const requiredCoverage = Math.max(MIN_RECOMMENDED_COVERAGE, coverageForPod(input.targetPod, input.podModel));
  let S = W > 0 ? W / requiredCoverage : 0.1;
  if (S > ceiling.ceilingNm) {
    S = ceiling.ceilingNm;
    notices.push({
      code: "spacing_clamped", severity: "warning",
      params: { ceiling: ceiling.ceilingNm, condition: ceiling.condition },
    });
  }
  if (!(S > 0)) {
    S = 0.1;
    notices.push({ code: "zero_sweep_width", severity: "warning", params: {} });
  }

  const achievedCoverage = coverageFactor(W, S);
  const achievedPod = podFromCoverage(achievedCoverage, input.podModel);
  const achievedLevel = coverageVerdict(achievedCoverage);
  if (achievedLevel === "poor") notices.push({ code: "coverage_poor", severity: "warning", params: { coverage: achievedCoverage } });
  if (achievedLevel === "excess") notices.push({ code: "coverage_excess", severity: "warning", params: { coverage: achievedCoverage } });

  // 可用於實際搜索的時間：扣掉往返進場
  const onStation = onStationHoursPerSortie(input.asset);
  const T = Math.max(0.01, input.availableHr);
  const P = Math.max(0.1, input.asset.speedKn);

  // 廣域搜索所需的總載具時數（與架數無關）
  const broadHoursTotal = input.area.areaNm2 / (P * S);
  const contacts = contactLoad(
    input.falseTargets ?? NO_FALSE_TARGETS, input.area.areaNm2, achievedCoverage, broadHoursTotal,
  );
  if (contacts.expectedContacts >= 1) {
    notices.push({
      code: "false_contacts", severity: "warning",
      params: {
        contacts: contacts.expectedContacts,
        hours: contacts.investigationHours,
        share: contacts.timeShare * 100,
        lo: contacts.contacts95[0], hi: contacts.contacts95[1],
      },
    });
  }
  // A = T × N × P × S，再加上查證時數 → N = (廣域時數 + 查證時數) / T
  const exactDrones = (broadHoursTotal + contacts.investigationHours) / T;
  const recommendedDrones = Math.max(1, Math.ceil(exactDrones - 1e-9));
  const actualTimeHr = (broadHoursTotal + contacts.investigationHours) / recommendedDrones;

  let sortiesPerDrone = 1;
  if (Number.isFinite(onStation) && onStation > 0 && actualTimeHr > onStation) {
    sortiesPerDrone = Math.ceil(actualTimeHr / onStation);
    notices.push({
      code: "sorties_required", severity: "warning",
      params: { onStation, needed: actualTimeHr, sorties: sortiesPerDrone },
    });
  } else if (Number.isFinite(onStation) && onStation <= 0) {
    notices.push({ code: "transit_exceeds_endurance", severity: "warning", params: {} });
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
      cumulativePod: cumulativePodRepeated(achievedCoverage, repeats, input.podModel),
    };
  }

  return {
    sweepWidth,
    requiredCoverage,
    trackSpacingNm: S,
    spacingCeiling: ceiling,
    achievedCoverage,
    achievedPod,
    bounds: boundsFor(input.sensor, W, S),
    recommendedDrones,
    exactDrones,
    actualTimeHr,
    sortiesPerDrone,
    pattern: rec.pattern,
    patternReasonCode: rec.reasonCode,
    patternMultiAssetNote: rec.multiAssetNote,
    patternAlternatives: rec.alternatives,
    fallback,
    coverageLevel: achievedLevel,
    contacts,
    notices,
  };
}

/** 給 UI 用：把 SearchPatternId 轉成完整說明 */
export function patternInfo(id: SearchPatternId) {
  return SEARCH_PATTERNS[id];
}

/** 理想覆蓋（S = W）下的參考值，供 UI 顯示「若不受條件限制」 */
export const REFERENCE_IDEAL_COVERAGE = IDEAL_COVERAGE;
