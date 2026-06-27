/**
 * 兵棋平台核心型別。
 *
 * 所有型別 JSON-serializable，場景檔 / replay snapshot / 存檔 共用。
 *
 * 設計分層：
 *   - CoreAttributes（5）：使用者在 UnitEditorPanel 可直接調的核心數值
 *   - ExtensionAttributes（15）：schema 預留，v1 不曝露 UI
 *   - UnitCatalogEntry：種類定義（形狀、域、預設 core、UI slider 範圍）
 *   - Unit：runtime instance
 */

// ── identifiers ──────────────────────────────────────────
export type UnitId = string;
/**
 * 陣營 id：
 *   - blue：ROC 國軍（玩家方）
 *   - red：PLA 共軍（敵方）
 *   - neutral：民用 / 中立
 *   - us：美國海軍 / 空軍（藍方盟軍）
 *   - japan：JMSDF / JASDF（保留，未來用）
 */
export type SideId = "blue" | "red" | "neutral" | "us" | "japan";
export type CommandId = string;
export type LngLat = [number, number];

// ── v4 catalog（10 種） ──────────────────────────────────
export type UnitKind =
  | "missile_launcher" // 反艦飛彈車（雄三 / DF-26）
  | "drone"            // 無人機（偵察 / 攻擊）
  | "ship_surface"     // 水面艦
  | "submarine"        // 潛艦
  | "fighter"          // 戰機
  | "radar_station"    // 固定雷達站（樂山、PAVE PAWS）
  | "sam_coastal"      // 中程機動 SAM（天弓 II / 海弓 III / TC-2N）
  | "mobile_radar"     // 機動雷達車（YLC-2 / 蜂眼）
  | "sam_patriot"      // 重型 SAM（Patriot PAC-3 / 天弓 III）
  | "supply_ship"      // 補給艦（RAS 補油料 + 彈藥；無武器）
  | "airbase";         // 空軍基地（戰機 RTB 目標；大範圍 supply）
export type Domain = "land" | "air" | "sea" | "subsurface";

export interface UnitCatalogEntry {
  kind: UnitKind;
  displayName: string;
  domain: Domain;
  defaultAltitudeM: number;
  iconShape: "cone" | "triangle_inverted" | "diamond";
  defaultCore: CoreAttributes;
  uiRanges: Record<keyof CoreAttributes, { min: number; max: number; step: number; unit: string }>;
  /**
   * 規劃 / 移動限制（v1 用於 validatePlan，engine 暫不強制）。
   * 之後想加新限制（如禁飛區域、夜間禁航）只要擴 UnitConstraints 介面。
   */
  constraints: UnitConstraints;
  /** 預設彈藥量；0 = 無武器（雷達站 / 補給艦）；省略 = engine 用 catalog.defaultAmmoMax 補 */
  defaultAmmoMax: number;
  /** 補給單位專用：RAS / 加油的有效範圍（km）。非補給單位省略 */
  supplyRangeKm?: number;
  /** 補給單位專用：每秒可恢復多少 km 油 + 多少發彈藥 */
  supplyFuelKmPerSec?: number;
  supplyAmmoPerSec?: number;
}

export interface UnitConstraints {
  /** 禁止進入的域；e.g. 船艦不能上陸地 → ["land"] */
  forbidDomains?: Domain[];
  /** 預設規劃時間上限（秒）— 用於 UI 警告，未來可作為硬性約束 */
  defaultPlanTimeLimitSec?: number;
  /** 必須以圓弧返回基地的 fuel 安全係數（air units 用）— v1 未實作 */
  requireRoundTrip?: boolean;
}

// ── 5 個 core attribute（UI 可調） ───────────────────────
export interface CoreAttributes {
  rangeKm: number;
  speedKnots: number;
  movementRangeKm: number;
  detectionRangeKm: number;
  hpMax: number;
}

// ── 15 個 extension slot（schema 預留） ──────────────────
export type ExtensionKey =
  | "armor"
  | "stealthRcs"
  | "ecmStrength"
  | "ammoCapacity"
  | "reloadSec"
  | "minAltitudeM"
  | "maxAltitudeM"
  | "crewSize"
  | "commandRadiusKm"
  | "supplyConsumption"
  | "deploymentTimeSec"
  | "costPerRound"
  | "pKillBase"
  | "endurance"
  | "stealth";

export type ExtensionAttributes = Partial<Record<ExtensionKey, number | string>>;

// ── position / dynamic state ─────────────────────────────
export interface Position {
  lng: number;
  lat: number;
  altMeters: number;
  headingDeg: number;
  speedKnots: number;
}

export type DetectionState = "hidden" | "unknown" | "classified" | "tracked";

// ── unit runtime instance ────────────────────────────────
export interface Unit {
  id: UnitId;
  sideId: SideId;
  kind: UnitKind;
  callsign: string;
  displayName: string;
  position: Position;
  waypoints: LngLat[];
  core: CoreAttributes;
  extensions: ExtensionAttributes;
  /** 累計移動距離（公里）— 等同已用燃料；被補給單位 RAS 可降回 */
  distanceTravelledKm: number;
  hpCurrent: number;
  /** 彈藥上限（從 catalog.defaultAmmoMax；場景可覆寫） */
  ammoMax: number;
  /** 當前剩餘彈藥；開火扣 1；補給單位附近會 reload */
  ammoCurrent: number;
  /**
   * Per-unit 補給能力 override（給 CVN / 兩棲艦等多用途載台用）。
   * 沒設 → 用 catalog 預設值。例如：CVN-71 設 { rangeKm: 25, fuelKmPerSec: 30, ammoPerSec: 0.6 }
   * 即可同時當船艦 + 移動 airbase。
   */
  supplyOverride?: {
    rangeKm: number;
    fuelKmPerSec: number;
    ammoPerSec: number;
  };
  detectedBy: Partial<Record<SideId, DetectionState>>;
  lastTickSimSec: number;
  parentId?: UnitId;
  engagingTargetId?: UnitId;
}

// ── commands ─────────────────────────────────────────────
export type Command =
  | {
      id: CommandId; unitId: UnitId; simAtSec: number; kind: "set_waypoints";
      waypoints: LngLat[];
      /** 預期完成時間（sim sec）— 超過則 engine 可選擇丟棄；v1 僅作為 UI 警告 */
      mustCompleteBySimSec?: number;
    }
  | { id: CommandId; unitId: UnitId; simAtSec: number; kind: "set_speed"; speedKnots: number }
  | { id: CommandId; unitId: UnitId; simAtSec: number; kind: "engage"; targetUnitId: UnitId }
  | { id: CommandId; unitId: UnitId; simAtSec: number; kind: "hold" };

// ── events ───────────────────────────────────────────────
export type EngagementEventKind =
  | "detection"
  | "weapon_release"
  | "hit"
  | "miss"
  | "destroyed";

export interface EngagementEvent {
  id: string;
  simAtSec: number;
  kind: EngagementEventKind;
  attackerId?: UnitId;
  targetId?: UnitId;
  /** 被擊毀單位所屬陣營（destroyed event 才有；BattleStatsHud 算 kills 用） */
  targetSideId?: SideId;
  position?: LngLat;
  message: string;
}

// ── side ─────────────────────────────────────────────────
/**
 * 陣營控制權：
 *   - human：人玩，可在 UI 編輯 / 規劃航線
 *   - ai：由 LLM 或 scriptedAi 自動操作（Phase 7b/7c）
 *   - scripted：只跑場景預設指令，不主動下命令
 */
export type SideOwnership = "human" | "ai" | "scripted";

export interface Side {
  id: SideId;
  displayName: string;
  colorPrimary: string;
  colorSecondary: string;
  isPlayer: boolean;            // 預設玩家方（保留向後相容）
  ownership: SideOwnership;
  isHostileTo: SideId[];
}

// ── scenario ─────────────────────────────────────────────
export type VictoryCondition =
  /** sideId 方勝：unitId 必須存活到時限結束（中途被擊毀則 sideId 立刻判輸） */
  | { kind: "preserve_unit"; unitId: UnitId; sideId: SideId; label?: string }
  /** sideId 方勝：unitId 被擊毀 */
  | { kind: "destroy_unit"; unitId: UnitId; sideId: SideId; label?: string }
  /** sideId 方勝：targetSideId 所有單位全滅 */
  | { kind: "eliminate_side"; targetSideId: SideId; sideId: SideId; label?: string }
  /** sideId 方勝：自己至少 1 個單位連續在區域內 forSec 秒 */
  | { kind: "hold_area"; centerLngLat: LngLat; radiusKm: number; sideId: SideId; forSec: number; label?: string }
  /** 時限到時：誰存活單位多、誰勝（中性條件，每場景建議加一條當 fallback） */
  | { kind: "time_limit"; label?: string };

export interface Scenario {
  id: string;
  displayName: string;
  /** 任務簡報。string = 單語（fallback 顯示）；{zh, en} = 雙語。 */
  briefing: string | { zh: string; en: string };
  startSimTimeSec: number;
  durationSec: number;
  sides: Side[];
  units: Unit[];
  pendingCommands: Command[];
  camera: { center: LngLat; zoom: number; pitch: number; bearing: number };
  victoryConditions: VictoryCondition[];
  pauseOnEvents?: EngagementEventKind[];
}

// ── 飛彈（in-flight） ────────────────────────────────────
export interface Missile {
  id: string;
  attackerId: UnitId;
  targetId: UnitId;
  position: { lng: number; lat: number };
  /** 開火時記下的目標位置（飛彈飛這個固定座標，不追蹤後續移動 — 簡化版） */
  targetPositionAtFire: LngLat;
  speedKnots: number;
  damage: number;           // 命中時對 target 造成的 hp 傷害
  spawnedAtSimSec: number;
  distanceTravelledKm: number;
}

// ── 爆炸特效 ─────────────────────────────────────────────
export interface Explosion {
  id: string;
  position: LngLat;
  spawnedAtSimSec: number;
  durationSec: number;
  hit: boolean;             // true = hit, false = miss（影響顏色）
}

// ── 殘骸（destroyed unit marker） ───────────────────────
export interface Wreck {
  id: string;
  position: LngLat;
  sideId: SideId;
  kind: UnitKind;
  callsign: string;
  destroyedAtSimSec: number;
  durationSec: number;      // 多久後完全消失
}

// ── simulation state ─────────────────────────────────────
export interface SimulationState {
  scenario: Scenario;
  simTimeSec: number;
  units: Record<UnitId, Unit>;
  pendingCommands: Command[];
  eventsThisTick: EngagementEvent[];
  eventsAll: EngagementEvent[];
  missiles: Missile[];
  explosions: Explosion[];
  wreckages: Wreck[];
  /**
   * hold_area 條件計時：condition index → 該方第一次進入區域的 simSec；
   * 不在區域內 → null。達到 forSec 即勝。
   */
  holdProgress: Record<number, number | null>;
  outcome: { winner: SideId | null; reason: string; conditionLabel?: string } | null;
}
