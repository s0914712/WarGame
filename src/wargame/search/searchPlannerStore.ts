/**
 * 搜索規劃器 external store。
 *
 * 與 scenarioStore / editorStore 平行；持有：
 *   - 搜索區（地圖兩角框）
 *   - 感測 / 環境 / 機隊參數
 *   - 解算方向（正解 = 給架數求時間；反解 = 給時間求架數）
 *   - 產生的搜索航線 + 指派到哪些單位
 *
 * 解算本身在 planner.ts / tracks.ts（純函式）；此處只管狀態與 side effect。
 */
import type { LngLat, Unit, UnitId } from "../types";
import { scenarioStore } from "../scenarioStore";
import { viewStore } from "../viewStore";
import { wargameClock } from "../clock";
import { UNIT_CATALOG } from "../catalog/units";
import {
  solveForAssets, solveForTime,
  type AssetProfile, type SearchAreaGeometry, type SensorConditions,
  type SolveForAssetsResult, type SolveForTimeResult,
} from "./planner";
import type { SearchTargetClass, SweepWidthCorrections } from "./sweepWidth";
import type { PodModel } from "./pod";
import type { SearchPatternId } from "./patterns";
import { boxFromCorners, generateSearchTracks, measureBox, type DroneTrack } from "./tracks";
import { runMonteCarlo, type MonteCarloResult, type TargetDistribution } from "./monteCarlo";
import { OPERATIONAL_DEGRADATION } from "./sweepWidth";
import {
  DEFAULT_EOIR, rangeLimits, TARGET_GEOMETRY,
  type EoIrSensor, type RangeLimits,
} from "./sensorRange";
import {
  calibrateBaseDensity, densityAt, integrateDensity, rankContacts,
  type ContactRanking, type DensityField, type FalseTargetModel,
} from "./falseTargets";
import { optimalRectangle, searchEffortNm2, type OptimalRectangleResult } from "./optimalRectangle";
import {
  cumulativeSuccess, distributionStats, propagate, rasterize, sampleParticles,
  stopAdvice, updateForUnsuccessfulSearch,
  type DistributionStats, type Particle, type ProbabilityCell, type SearchScenario, type StopAdvice,
} from "./targetDistribution";

type Listener = () => void;

export type SolveDirection = "given_assets" | "given_time";

export interface PlannerInputs {
  direction: SolveDirection;
  // 正解用
  droneCount: number;
  // 反解用
  availableHr: number;
  targetPod: number;
  // 感測
  targetClass: SearchTargetClass;
  visibilityKm: number;
  altitudeFt: number;
  corrections: SweepWidthCorrections;
  // 環境
  windKn: number;
  seaStateM: number;
  // 機隊
  speedKn: number;
  enduranceHr: number;
  transitHrOneWay: number;
  // 航跡間距：null = 由系統依 S = W 與條件上限決定
  trackSpacingOverrideNm: number | null;
  /** 直接指定覆蓋因子 C（S = W/C）；null = 不指定。優先序低於 trackSpacingOverrideNm */
  coverageOverride: number | null;
  // 圖形：null = 用系統建議
  patternOverride: SearchPatternId | null;
  podModel: PodModel;
  // 圖形建議情境
  datumUncertaintyNm: number;
  targetBiasedToOneEnd: boolean;
  hasKnownTrackLine: boolean;
  // 蒙地卡羅
  mcEnabled: boolean;
  mcTrials: number;
  mcDriftKn: number;
  /** null = 每次試驗隨機取向 */
  mcDriftBearingDeg: number | null;
  mcNavErrorSigmaNm: number;
  mcSensorAvailability: number;
  mcDistributionKind: "uniform" | "gaussian";
  mcSigmaNm: number;
  mcSeed: number;
  // ── Stone §3：感測器實戰效能折扣 ──
  sensorTested: boolean;
  // ── Stone §4：航跡放置誤差 σ 與掃掠寬度不確定性 ──
  navErrorSigmaNm: number;
  sweepWidthSpread: number;
  // ── Stone §2/§6：事前分布與貝氏更新 ──
  bayesEnabled: boolean;
  particleCount: number;
  /**
   * 從基準點（事發／最後已知位置）到**抵達搜索區**的時數。
   * 實際推進分布時會再自動加上「掃區時間的一半」，以符合 Stone §5 的
   * 搜索期中點慣例 —— 見 midSearchElapsedHr()。
   */
  elapsedHr: number;
  /** Stone §7 的停止門檻 */
  stopThreshold: number;
  // ── Stone §6：假目標 ──
  falseTargetsEnabled: boolean;
  /** 整個搜索區預期會看到幾個假接觸（規劃者對「個數」比對密度有感覺） */
  expectedFalseTargetsInArea: number;
  /** 查證一個接觸所需時間（小時） */
  investigationHr: number;
  /** 假目標密度是否分帶（航道 / 漂流帶）；false = 整區均勻 */
  densityBandsEnabled: boolean;
  /** EO/IR 酬載規格 —— 決定光學解析度上限 */
  eoir: EoIrSensor;
}

/**
 * 會改變「產生出來的航線幾何」的參數 —— 只有這些變動才需要作廢既有航線。
 *
 * 用白名單而非黑名單：先前用黑名單（列出「不影響」的 key）漏掉了 6 個參數，
 * 導致調整導航誤差、掃掠寬不確定性、粒子數、停止門檻，甚至只是「啟用事前分布」
 * 都會把剛產生的航線洗掉 —— 而啟用事前分布正是使用者接著要記錄搜索趟次的
 * 前一步，等於把功能鎖死。新增參數時若忘了加進白名單，最壞情況只是航線該作廢
 * 卻沒作廢（畫面看得出來），比靜默清空溫和。
 */
const GEOMETRY_KEYS = new Set<string>([
  // 解算方向與資產數 → 決定航線條數
  "direction", "droneCount", "availableHr", "targetPod", "speedKn",
  // 影響掃掠寬 W → 影響自動航跡間距 S
  "targetClass", "visibilityKm", "altitudeFt", "corrections", "sensorTested", "windKn", "eoir",
  // 直接決定 S / 圖形
  "trackSpacingOverrideNm", "coverageOverride", "patternOverride", "podModel",
  "datumUncertaintyNm", "targetBiasedToOneEnd", "hasKnownTrackLine",
  // 假目標吃掉時數 → 反解的建議架數改變 → 航線條數改變
  "falseTargetsEnabled", "expectedFalseTargetsInArea", "investigationHr",
]);

/** 變動後需要重建事前分布的參數 */
const DISTRIBUTION_KEYS = new Set<string>([
  "bayesEnabled", "particleCount", "elapsedHr", "mcSeed",
  // 幾何參數會改掃區時間 → 改變 Stone §5 的搜索期中點 → 分布要重推
  ...GEOMETRY_KEYS,
]);

const DEFAULT_INPUTS: PlannerInputs = {
  direction: "given_assets",
  droneCount: 2,
  availableHr: 4,
  targetPod: 0.78,
  targetClass: "ship_over_91m",
  visibilityKm: 10,
  altitudeFt: 500,
  corrections: { weather: 1, speed: 1, fatigued: false },
  windKn: 12,
  seaStateM: 1.0,
  speedKn: 60,
  enduranceHr: 12,
  transitHrOneWay: 0.5,
  trackSpacingOverrideNm: null,
  coverageOverride: null,
  patternOverride: null,
  podModel: "iamsar_chart",
  datumUncertaintyNm: 0,
  targetBiasedToOneEnd: false,
  hasKnownTrackLine: false,
  mcEnabled: false,
  mcTrials: 2000,
  mcDriftKn: 0,
  mcDriftBearingDeg: null,
  mcNavErrorSigmaNm: 0,
  mcSensorAvailability: 1,
  mcDistributionKind: "uniform",
  mcSigmaNm: 5,
  mcSeed: 20260906,
  sensorTested: false,
  navErrorSigmaNm: 0,
  sweepWidthSpread: 0,
  bayesEnabled: false,
  particleCount: 5000,
  elapsedHr: 0,
  stopThreshold: 0.9,
  falseTargetsEnabled: false,
  expectedFalseTargetsInArea: 12,
  investigationHr: 0.25,
  densityBandsEnabled: false,
  eoir: { ...DEFAULT_EOIR },
};

/**
 * 預設假目標密度帶 —— 台海的兩個典型來源。
 * 密度倍率是示意值；實務上應由該海域的航運密度與漂流物觀測估計。
 */
export const DEFAULT_DENSITY_BANDS: DensityField["bands"] = [
  {
    id: "lane", label: "主航道", labelEn: "Main shipping lane",
    path: [[119.2, 22.6], [119.9, 23.8], [120.6, 25.2]],
    widthNm: 12, multiplier: 6,
  },
  {
    id: "convergence", label: "漂流輻合帶", labelEn: "Drift convergence zone",
    path: [[119.0, 23.9], [120.8, 23.5]],
    widthNm: 8, multiplier: 3,
  },
];

/** 預設情境 —— Stone §2 的範例形狀（回報位置 + 漂流） */
export const DEFAULT_SCENARIOS: SearchScenario[] = [
  {
    id: "adrift", label: "失去動力漂流", labelEn: "Adrift, lost propulsion", weight: 0.7,
    datum: [120.0, 23.6], positionSigmaNm: 8.5,
    driftSpeedKn: 2, driftSpeedSigmaKn: 1,
    driftCourseDeg: 180, driftCourseSigmaDeg: 20,
  },
  {
    id: "off_track", label: "偏離航路後失聯", labelEn: "Lost contact off intended route", weight: 0.3,
    datum: [120.15, 23.75], positionSigmaNm: 14,
    driftSpeedKn: 1.2, driftSpeedSigmaKn: 0.8,
    driftCourseDeg: 200, driftCourseSigmaDeg: 45,
  },
];

let open = false;
/** 是否正在地圖上框選搜索區（面板暫時收合） */
let picking = false;
let cornerA: LngLat | null = null;
let cornerB: LngLat | null = null;
let inputs: PlannerInputs = { ...DEFAULT_INPUTS };
let tracks: DroneTrack[] = [];
let assignedUnitIds: UnitId[] = [];
let mcResult: MonteCarloResult | null = null;
let scenarios: SearchScenario[] = DEFAULT_SCENARIOS.map((x) => ({ ...x }));
/** 目前的目標機率分布（粒子）；bayesEnabled 才建立 */
let particles: Particle[] = [];
/** 各趟搜索的 POS（Stone §7 的累積成功機率用） */
let sortiePos: number[] = [];
/** 已記錄、尚未查證的接觸（Stone §6 式 5 的排序對象） */
let loggedContacts: { id: string; lng: number; lat: number }[] = [];
/** 是否處於「點地圖記錄接觸」模式 */
let loggingContact = false;
let densityBands: DensityField["bands"] = DEFAULT_DENSITY_BANDS.map((b) => ({ ...b }));

const listeners = new Set<Listener>();

/**
 * 變更版本號 —— useSyncExternalStore 的 snapshot。
 *
 * 不能拿 inputs 當 snapshot：框選搜索區、產生航線、蒙地卡羅結果都不會動到
 * inputs 的物件參照，React 會判定「沒變」而跳過 re-render，面板就整個不更新。
 * 改用每次 notify 遞增的數字，任何狀態變動都保證觸發重繪。
 */
let version = 0;
function notify() { version++; for (const cb of listeners) cb(); }

/** 可執行搜索的單位：當前 POV 陣營的空中載台 */
export function eligibleSearchUnits(): Unit[] {
  const side = viewStore.getActiveSideId();
  const units = Object.values(scenarioStore.getState().units);
  return units
    .filter((u) => (side === null || u.sideId === side) && UNIT_CATALOG[u.kind].domain === "air")
    .sort((a, b) => a.callsign.localeCompare(b.callsign));
}

/** 由單位反推機隊參數（滯空時數走我們在 catalog 放的 endurance extension） */
export function assetProfileFromUnit(u: Unit): Partial<PlannerInputs> {
  const endurance = u.extensions.endurance;
  const planLimit = UNIT_CATALOG[u.kind].constraints.defaultPlanTimeLimitSec ?? 0;
  return {
    speedKn: u.core.speedKnots > 0 ? u.core.speedKnots : UNIT_CATALOG[u.kind].defaultCore.speedKnots,
    enduranceHr: typeof endurance === "number" ? endurance : planLimit / 3600,
  };
}

function geometry(): SearchAreaGeometry | null {
  if (!cornerA || !cornerB) return null;
  const m = measureBox(boxFromCorners(cornerA, cornerB));
  if (!(m.areaNm2 > 0)) return null;
  return { areaNm2: m.areaNm2, longSideNm: m.longSideNm, shortSideNm: m.shortSideNm };
}

function sensor(): SensorConditions {
  return {
    targetClass: inputs.targetClass,
    visibilityKm: inputs.visibilityKm,
    altitudeFt: inputs.altitudeFt,
    corrections: {
      ...inputs.corrections,
      // Stone §3 / Koopman [1980]：未實測的感測器規格通常偏樂觀
      operational: inputs.sensorTested
        ? OPERATIONAL_DEGRADATION.tested
        : OPERATIONAL_DEGRADATION.untested,
    },
    navErrorSigmaNm: inputs.navErrorSigmaNm,
    sweepWidthSpread: inputs.sweepWidthSpread,
  };
}

/**
 * Stone §5 的搜索期中點慣例。
 *
 * 「這是個移動目標問題……但為保持討論簡單，我們把它當成靜止目標問題處理：
 *  計算目標在**航空器搜索期中點**的分布，然後照那個分布規劃。這是實務上
 *  處理搜索的常見做法。」（論文範例：遇險呼叫後 10 hr 開始搜、搜 3 hr，
 *  故取 T = 11.5 hr。）
 *
 * 因此實際推進時距 = 抵達現場時距 + 掃區時間 ÷ 2。
 */
export function midSearchElapsedHr(): number {
  const sweepHr = currentSweepHours();
  return inputs.elapsedHr + (Number.isFinite(sweepHr) ? sweepHr / 2 : 0);
}

/** 掃完全區所需時數（不依賴粒子，故可安全地在重建分布時呼叫） */
function currentSweepHours(): number {
  const area = geometry();
  if (!area) return 0;
  const base = {
    area, asset: asset(), sensor: sensor(),
    windKn: inputs.windKn, podModel: inputs.podModel,
    falseTargets: falseTargets(),
  };
  if (inputs.direction === "given_assets") {
    return solveForTime({
      ...base,
      droneCount: inputs.droneCount,
      trackSpacingNm: inputs.trackSpacingOverrideNm ?? undefined,
      coverageFactor: inputs.coverageOverride ?? undefined,
    }).timeHr;
  }
  const inv = solveForAssets({
    ...base,
    availableHr: inputs.availableHr,
    targetPod: inputs.targetPod,
    context: {
      datumUncertaintyNm: inputs.datumUncertaintyNm,
      targetBiasedToOneEnd: inputs.targetBiasedToOneEnd,
      hasKnownTrackLine: inputs.hasKnownTrackLine,
    },
  });
  return inv.actualTimeHr;
}

/**
 * 假目標密度場。使用者輸入的是「整區預期幾個」，這裡反推基礎密度，
 * 使積分後恰好等於該數 —— 開啟分帶時，同樣的總數會重新分配到航道 / 輻合帶。
 */
/**
 * 目前高度 + 目標 + 酬載對應的理論偵測距離上限。
 * 掃掠寬度表是載人 SAR 航空器的經驗值；這裡另外算物理天花板，
 * 讓規劃者看得到「表上的數字在這個高度／這顆鏡頭下做不做得到」。
 */
export function currentRangeLimits(): RangeLimits {
  return rangeLimits({
    altitudeFt: inputs.altitudeFt,
    target: TARGET_GEOMETRY[inputs.targetClass],
    sensor: inputs.eoir,
  });
}

export function densityField(): DensityField {
  const bands = inputs.densityBandsEnabled ? densityBands : [];
  const { a, b } = { a: cornerA, b: cornerB };
  if (!a || !b) return { baseDensityPerNm2: 0, bands };
  const box = boxFromCorners(a, b);
  const field: DensityField = { baseDensityPerNm2: 1, bands };
  return {
    baseDensityPerNm2: calibrateBaseDensity(field, box, inputs.expectedFalseTargetsInArea),
    bands,
  };
}

/** 平均密度（給 planner 的時間預算用；空間結構影響的是接觸排序，不是總量） */
function falseTargets(): FalseTargetModel {
  if (!inputs.falseTargetsEnabled) return { densityPerNm2: 0, investigationHr: 0 };
  const area = geometry();
  const A = area?.areaNm2 ?? 0;
  return {
    densityPerNm2: A > 0 ? inputs.expectedFalseTargetsInArea / A : 0,
    investigationHr: inputs.investigationHr,
  };
}

function asset(): AssetProfile {
  return {
    speedKn: inputs.speedKn,
    enduranceHr: inputs.enduranceHr,
    transitHrOneWay: inputs.transitHrOneWay,
  };
}

export interface PlannerSolution {
  area: SearchAreaGeometry;
  /** Stone §5：由目標分布算出的最佳搜索矩形（bayesEnabled 且有粒子時才有） */
  rectangle?: OptimalRectangleResult;
  /** 目前粒子雲的統計量 */
  stats?: DistributionStats;
  forward?: SolveForTimeResult;
  inverse?: SolveForAssetsResult;
  /** 實際用於產生航線的圖形與參數 */
  pattern: SearchPatternId;
  trackSpacingNm: number;
  droneCount: number;
}

/** 解算當前輸入；區域未框選時回 null */
/**
 * Stone §5：由目標分布 + 可投入努力算最佳搜索矩形，並與使用者實際畫的框比較。
 * 需要 bayesEnabled 且已建立粒子。
 */
function rectanglePlan(area: SearchAreaGeometry, W: number, totalAircraftHours: number) {
  const st = distributionStats(particles);
  if (!st || !(W > 0) || !(totalAircraftHours > 0)) return { rectangle: undefined, stats: st ?? undefined };
  const E = searchEffortNm2(W, inputs.speedKn, totalAircraftHours);
  // 軸對齊矩形 → 用邊際標準差（工具只能畫正矩形；主軸方位另外回報給使用者）
  const rect = optimalRectangle(
    { sigma1Nm: st.sigmaEastNm, sigma2Nm: st.sigmaNorthNm, effortNm2: E },
    area.areaNm2,
  );
  return { rectangle: rect, stats: st };
}

export function solve(): PlannerSolution | null {
  const area = geometry();
  if (!area) return null;

  if (inputs.direction === "given_assets") {
    const forward = solveForTime({
      area,
      droneCount: inputs.droneCount,
      asset: asset(),
      sensor: sensor(),
      trackSpacingNm: inputs.trackSpacingOverrideNm ?? undefined,
      coverageFactor: inputs.coverageOverride ?? undefined,
      windKn: inputs.windKn,
      podModel: inputs.podModel,
      falseTargets: falseTargets(),
    });
    // 正解模式也給圖形建議（供產生航線用）
    const rec = solveForAssets({
      area,
      availableHr: Math.max(0.1, forward.timeHr),
      asset: asset(),
      sensor: sensor(),
      targetPod: inputs.targetPod,
      windKn: inputs.windKn,
      podModel: inputs.podModel,
      falseTargets: falseTargets(),
      context: {
        datumUncertaintyNm: inputs.datumUncertaintyNm,
        targetBiasedToOneEnd: inputs.targetBiasedToOneEnd,
        hasKnownTrackLine: inputs.hasKnownTrackLine,
      },
    });
    const n = Math.max(1, Math.floor(inputs.droneCount));
    const rp = rectanglePlan(area, forward.sweepWidth.correctedNm, forward.timeHr * n);
    return {
      area,
      forward,
      pattern: inputs.patternOverride ?? rec.pattern,
      trackSpacingNm: forward.trackSpacingNm,
      droneCount: n,
      ...rp,
    };
  }

  const inverse = solveForAssets({
    area,
    availableHr: inputs.availableHr,
    asset: asset(),
    sensor: sensor(),
    targetPod: inputs.targetPod,
    windKn: inputs.windKn,
    podModel: inputs.podModel,
    falseTargets: falseTargets(),
    context: {
      datumUncertaintyNm: inputs.datumUncertaintyNm,
      targetBiasedToOneEnd: inputs.targetBiasedToOneEnd,
      hasKnownTrackLine: inputs.hasKnownTrackLine,
    },
  });
  const rp = rectanglePlan(
    area, inverse.sweepWidth.correctedNm, inputs.availableHr * inverse.recommendedDrones,
  );
  return {
    area,
    inverse,
    pattern: inputs.patternOverride ?? inverse.pattern,
    trackSpacingNm: inverse.trackSpacingNm,
    droneCount: inverse.recommendedDrones,
    ...rp,
  };
}

export const searchPlannerStore = {
  /** useSyncExternalStore 的 snapshot —— 每次狀態變動都會遞增 */
  getVersion: () => version,
  isOpen: () => open,
  isPicking: () => picking,
  getCorners: () => ({ a: cornerA, b: cornerB }),
  getInputs: () => inputs,
  getTracks: () => tracks,
  getMonteCarlo: () => mcResult,
  getScenarios: () => scenarios,
  getParticles: () => particles,
  getSortiePos: () => sortiePos,
  getLoggedContacts: () => loggedContacts,
  isLoggingContact: () => loggingContact,
  getDensityBands: () => densityBands,
  getAssignedUnitIds: () => assignedUnitIds,

  setOpen(v: boolean): void {
    if (open === v) return;
    open = v;
    if (!v) picking = false;
    notify();
  },

  /** 進入地圖框選模式（面板收合成細列） */
  startPickArea(): void {
    picking = true;
    loggingContact = false;
    cornerA = null;
    cornerB = null;
    tracks = [];
    mcResult = null;
    wargameClock.pause();
    notify();
  },

  /** 地圖點擊：第 1 點存 A、第 2 點存 B 並自動結束框選 */
  setCorner(lng: number, lat: number): void {
    if (!picking) return;
    if (!cornerA || cornerB) {
      cornerA = [lng, lat];
      cornerB = null;
    } else {
      cornerB = [lng, lat];
      picking = false;              // 兩角齊 → 自動回到面板
    }
    tracks = [];
    mcResult = null;
    notify();
  },

  cancelPick(): void {
    picking = false;
    notify();
  },

  clearArea(): void {
    cornerA = null;
    cornerB = null;
    tracks = [];
    mcResult = null;
    notify();
  },

  patch(p: Partial<PlannerInputs>): void {
    inputs = { ...inputs, ...p };
    // 只有真正改變航線幾何的參數才作廢既有航線（見 GEOMETRY_KEYS 的說明）
    if (Object.keys(p).some((k) => GEOMETRY_KEYS.has(k))) tracks = [];
    mcResult = null;
    // 影響事前分布的參數變動 → 重建粒子（並清掉搜索歷程）
    if (Object.keys(p).some((k) => DISTRIBUTION_KEYS.has(k))) {
      if (inputs.bayesEnabled) {
        particles = sampleParticles(scenarios, inputs.particleCount, inputs.mcSeed);
        const t = midSearchElapsedHr();
        if (t > 0) particles = propagate(particles, t);
      } else {
        particles = [];
      }
      sortiePos = [];
    }
    notify();
  },

  reset(): void {
    inputs = { ...DEFAULT_INPUTS };
    scenarios = DEFAULT_SCENARIOS.map((x) => ({ ...x }));
    tracks = [];
    mcResult = null;
    particles = [];
    sortiePos = [];
    loggedContacts = [];
    loggingContact = false;
    densityBands = DEFAULT_DENSITY_BANDS.map((b) => ({ ...b }));
    notify();
  },

  /** 依當前解算結果產生搜索航線 */
  generateTracks(): DroneTrack[] {
    const sol = solve();
    if (!sol || !cornerA || !cornerB) { tracks = []; mcResult = null; notify(); return tracks; }
    const box = boxFromCorners(cornerA, cornerB);
    const m = measureBox(box);
    tracks = generateSearchTracks({
      pattern: sol.pattern,
      box,
      trackSpacingNm: sol.trackSpacingNm,
      droneCount: sol.droneCount,
      radiusNm: Math.min(m.shortSideNm / 2, sol.pattern === "VS" ? 5 : m.shortSideNm / 2),
    });
    mcResult = null;
    notify();
    return tracks;
  },

  /**
   * 對當前航線跑蒙地卡羅模擬。需先 generateTracks()。
   * 同步執行（2000 次試驗約數十毫秒），回傳結果並存進 store。
   */
  runMonteCarlo(): MonteCarloResult | null {
    const sol = solve();
    if (!sol || tracks.length === 0 || !cornerA || !cornerB) return null;
    const W = sol.forward?.sweepWidth.correctedNm ?? sol.inverse?.sweepWidth.correctedNm ?? 0;
    const box = boxFromCorners(cornerA, cornerB);
    const centre = measureBox(box).centre;
    const distribution: TargetDistribution = inputs.mcDistributionKind === "gaussian"
      ? { kind: "gaussian", datum: centre, sigmaNm: inputs.mcSigmaNm }
      : { kind: "uniform" };
    mcResult = runMonteCarlo({
      box, tracks,
      sweepWidthNm: W,
      speedKn: inputs.speedKn,
      distribution,
      driftKn: inputs.mcDriftKn,
      driftBearingDeg: inputs.mcDriftBearingDeg,
      navErrorSigmaNm: inputs.mcNavErrorSigmaNm,
      sensorAvailability: inputs.mcSensorAvailability,
      trials: inputs.mcTrials,
      seed: inputs.mcSeed,
    });
    notify();
    return mcResult;
  },

  // ── Stone §2/§6/§7：事前分布、貝氏更新、停止準則 ─────────
  /** 情境權重 / 參數編輯（任一變動都重建粒子） */
  setScenarios(next: SearchScenario[]): void {
    scenarios = next;
    if (inputs.bayesEnabled) this.rebuildDistribution();
    else notify();
  },

  updateScenario(id: string, patch: Partial<SearchScenario>): void {
    scenarios = scenarios.map((x) => (x.id === id ? { ...x, ...patch } : x));
    if (inputs.bayesEnabled) this.rebuildDistribution();
    else notify();
  },

  /**
   * 依情境重新抽樣事前分布，並推進到規劃時刻。
   * Stone §5：移動目標的常見實務做法是取「搜索期中點」的分布，
   * 當成靜止目標問題來規劃 —— elapsedHr 即該時刻。
   */
  rebuildDistribution(): void {
    particles = sampleParticles(scenarios, inputs.particleCount, inputs.mcSeed);
    const t = midSearchElapsedHr();
    if (t > 0) particles = propagate(particles, t);
    sortiePos = [];
    notify();
  },

  /** 清空搜索歷程（回到事前分布） */
  resetSearchHistory(): void {
    this.rebuildDistribution();
  },

  /**
   * 記錄一趟「沒找到」的搜索：套 Stone §6 式 (2) 更新粒子權重。
   * 機率質量會從已搜區流向未搜區，下一趟的最佳矩形也會跟著移動。
   */
  recordUnsuccessfulSortie(): { pos: number; unsearchedMass: number } | null {
    const sol = solve();
    if (!sol || particles.length === 0 || tracks.length === 0) return null;
    const W = sol.forward?.sweepWidth.correctedNm ?? sol.inverse?.sweepWidth.correctedNm ?? 0;
    if (!(W > 0)) return null;
    const r = updateForUnsuccessfulSearch({ particles, tracks, sweepWidthNm: W });
    particles = r.particles;
    sortiePos = [...sortiePos, r.pos];
    notify();
    return { pos: r.pos, unsearchedMass: r.unsearchedMass };
  },

  /** Stone §7：累積成功機率與停止建議 */
  getSearchEffectiveness(): { cumulativePos: number; advice: StopAdvice; sorties: number } {
    const cp = cumulativeSuccess(sortiePos);
    return { cumulativePos: cp, advice: stopAdvice(cp, inputs.stopThreshold), sorties: sortiePos.length };
  },

  /** 機率圖柵格（供地圖層畫熱區） */
  getProbabilityCells(cellSizeNm = 3): ProbabilityCell[] {
    if (particles.length === 0) return [];
    return rasterize(particles, cellSizeNm);
  },

  /**
   * 把搜索區換成 Stone §5 算出的最佳矩形（以分布均值為中心、軸對齊）。
   * 這是「工具告訴你框該畫多大」的落地動作。
   */
  applyOptimalRectangle(): boolean {
    const sol = solve();
    if (!sol?.rectangle || !sol.stats) return false;
    const [cLng, cLat] = sol.stats.meanLngLat;
    const halfLatNm = sol.rectangle.best.length2Nm / 2;
    const halfLngNm = sol.rectangle.best.length1Nm / 2;
    const dLat = (halfLatNm * 1.852) / 111.32;
    const dLng = (halfLngNm * 1.852) / (111.32 * Math.cos((cLat * Math.PI) / 180));
    cornerA = [cLng - dLng, cLat - dLat];
    cornerB = [cLng + dLng, cLat + dLat];
    tracks = [];
    mcResult = null;
    notify();
    return true;
  },

  // ── Stone §6 式(5)：接觸記錄與優先查證順序 ───────────────
  /** 進入 / 離開「點地圖記錄接觸」模式 */
  setLoggingContact(on: boolean): void {
    if (loggingContact === on) return;
    loggingContact = on;
    if (on) picking = false;          // 兩種點地圖模式互斥
    notify();
  },

  addContactAt(lng: number, lat: number): void {
    loggedContacts = [
      ...loggedContacts,
      { id: `c${Date.now().toString(36)}${loggedContacts.length}`, lng, lat },
    ];
    notify();
  },

  removeContact(id: string): void {
    loggedContacts = loggedContacts.filter((c) => c.id !== id);
    notify();
  },

  clearContacts(): void {
    loggedContacts = [];
    notify();
  },

  setDensityBands(bands: DensityField["bands"]): void {
    densityBands = bands;
    notify();
  },

  /**
   * 依 Stone §6 式 (5) 排出「先查哪個接觸」。
   *
   *   γᵢ = (p(jᵢ)/δ(jᵢ)) / (1 − P + Σₖ p(jₖ)/δ(jₖ))
   *
   * p(j)：接觸所在格的目標機率 —— 由粒子權重在該格內加總
   * δ(j)：該格的假目標期望個數 —— 由密度場乘格面積
   * P   ：本趟的事前發現機率（式 4），取最近一趟的 POS，無則用解析 POD
   *
   * δ 均勻時排序退化成「照機率高低排」；分帶開啟後，航道上的接觸即使機率不低
   * 也會被往後排 —— 那正是式 (5) 的價值。
   */
  rankLoggedContacts(cellSizeNm = 3): (ContactRanking & { lng: number; lat: number; p: number; delta: number })[] {
    if (loggedContacts.length === 0) return [];
    const field = densityField();
    const cellArea = cellSizeNm * cellSizeNm;
    const half = cellSizeNm / 2;
    const kLat = 111.32 / 1.852;                       // 每度緯度多少浬

    const rows = loggedContacts.map((c) => {
      const kLng = (111.32 * Math.cos((c.lat * Math.PI) / 180)) / 1.852;
      // p(j)：落在該格內的粒子權重和
      let p = 0;
      for (const q of particles) {
        if (Math.abs((q.lng - c.lng) * kLng) <= half && Math.abs((q.lat - c.lat) * kLat) <= half) {
          p += q.weight;
        }
      }
      const delta = densityAt(field, c.lng, c.lat) * cellArea;
      return { id: c.id, lng: c.lng, lat: c.lat, p, delta };
    });

    const P = sortiePos.length > 0 ? (sortiePos[sortiePos.length - 1] ?? 0) : 0;
    const ranked = rankContacts(
      rows.map((r) => ({ id: r.id, cellTargetProbability: r.p, cellFalseTargetRate: r.delta })),
      P,
    );
    const byId = new Map(rows.map((r) => [r.id, r]));
    return ranked.map((r) => {
      const src = byId.get(r.id);
      return { ...r, lng: src?.lng ?? 0, lat: src?.lat ?? 0, p: src?.p ?? 0, delta: src?.delta ?? 0 };
    });
  },

  /** 搜索區內假目標期望總數（對密度場積分，分帶時仍等於使用者輸入的個數） */
  integratedFalseTargets(): number {
    if (!cornerA || !cornerB) return 0;
    return integrateDensity(densityField(), boxFromCorners(cornerA, cornerB));
  },

  setAssignedUnitIds(ids: UnitId[]): void {
    assignedUnitIds = ids;
    notify();
  },

  toggleAssignedUnit(id: UnitId): void {
    assignedUnitIds = assignedUnitIds.includes(id)
      ? assignedUnitIds.filter((x) => x !== id)
      : [...assignedUnitIds, id];
    notify();
  },

  /**
   * 把產生的航線套到選定單位 —— 走既有指令佇列（set_waypoints），
   * engine 仍是 units 的唯一 mutator。
   * 回傳實際指派的架數。
   */
  applyTracksToUnits(): number {
    if (tracks.length === 0) return 0;
    const now = wargameClock.getSimTime();
    let n = 0;
    assignedUnitIds.forEach((unitId, i) => {
      const track = tracks[i % tracks.length];
      if (!track || track.waypoints.length === 0) return;
      scenarioStore.enqueueCommand({
        id: `cmd-search-${Date.now()}-${i}-${Math.random().toString(36).slice(2, 6)}`,
        unitId,
        simAtSec: now,
        kind: "set_waypoints",
        waypoints: track.waypoints,
      });
      n++;
    });
    return n;
  },

  subscribe(cb: Listener): () => void {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
};
