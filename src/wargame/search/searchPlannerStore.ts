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
  // 圖形：null = 用系統建議
  patternOverride: SearchPatternId | null;
  podModel: PodModel;
  // 圖形建議情境
  datumUncertaintyNm: number;
  targetBiasedToOneEnd: boolean;
  hasKnownTrackLine: boolean;
}

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
  patternOverride: null,
  podModel: "iamsar_chart",
  datumUncertaintyNm: 0,
  targetBiasedToOneEnd: false,
  hasKnownTrackLine: false,
};

let open = false;
/** 是否正在地圖上框選搜索區（面板暫時收合） */
let picking = false;
let cornerA: LngLat | null = null;
let cornerB: LngLat | null = null;
let inputs: PlannerInputs = { ...DEFAULT_INPUTS };
let tracks: DroneTrack[] = [];
let assignedUnitIds: UnitId[] = [];

const listeners = new Set<Listener>();
function notify() { for (const cb of listeners) cb(); }

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
    corrections: inputs.corrections,
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
  forward?: SolveForTimeResult;
  inverse?: SolveForAssetsResult;
  /** 實際用於產生航線的圖形與參數 */
  pattern: SearchPatternId;
  trackSpacingNm: number;
  droneCount: number;
}

/** 解算當前輸入；區域未框選時回 null */
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
      windKn: inputs.windKn,
      podModel: inputs.podModel,
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
      context: {
        datumUncertaintyNm: inputs.datumUncertaintyNm,
        targetBiasedToOneEnd: inputs.targetBiasedToOneEnd,
        hasKnownTrackLine: inputs.hasKnownTrackLine,
      },
    });
    return {
      area,
      forward,
      pattern: inputs.patternOverride ?? rec.pattern,
      trackSpacingNm: forward.trackSpacingNm,
      droneCount: Math.max(1, Math.floor(inputs.droneCount)),
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
    context: {
      datumUncertaintyNm: inputs.datumUncertaintyNm,
      targetBiasedToOneEnd: inputs.targetBiasedToOneEnd,
      hasKnownTrackLine: inputs.hasKnownTrackLine,
    },
  });
  return {
    area,
    inverse,
    pattern: inputs.patternOverride ?? inverse.pattern,
    trackSpacingNm: inverse.trackSpacingNm,
    droneCount: inverse.recommendedDrones,
  };
}

export const searchPlannerStore = {
  isOpen: () => open,
  isPicking: () => picking,
  getCorners: () => ({ a: cornerA, b: cornerB }),
  getInputs: () => inputs,
  getTracks: () => tracks,
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
    cornerA = null;
    cornerB = null;
    tracks = [];
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
    notify();
  },

  patch(p: Partial<PlannerInputs>): void {
    inputs = { ...inputs, ...p };
    tracks = [];                    // 參數變動 → 既有航線失效
    notify();
  },

  reset(): void {
    inputs = { ...DEFAULT_INPUTS };
    tracks = [];
    notify();
  },

  /** 依當前解算結果產生搜索航線 */
  generateTracks(): DroneTrack[] {
    const sol = solve();
    if (!sol || !cornerA || !cornerB) { tracks = []; notify(); return tracks; }
    const box = boxFromCorners(cornerA, cornerB);
    const m = measureBox(box);
    tracks = generateSearchTracks({
      pattern: sol.pattern,
      box,
      trackSpacingNm: sol.trackSpacingNm,
      droneCount: sol.droneCount,
      radiusNm: Math.min(m.shortSideNm / 2, sol.pattern === "VS" ? 5 : m.shortSideNm / 2),
    });
    notify();
    return tracks;
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
