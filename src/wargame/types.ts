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
  | "airbase"          // 空軍基地（戰機 RTB 目標；大範圍 supply）
  | "asw_helo";        // 反潛直升機（吊放聲納 dipping sonar 點偵測 + 輕型魚雷）
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
  /** 武器飛行剖面預設（B7）；省略 → 依目標域推導（打海上=sea_skim、其餘=cruise） */
  weaponProfile?: MissileProfile;
  /** 聲學特性（E20 反潛）；省略 = 無聲納特徵（不參與聲學偵測） */
  acoustics?: AcousticProfile;
  /**
   * 武器掛載（B6）。省略 → engine 合成單一主武器（射程 = core.rangeKm、彈量 = defaultAmmoMax、
   * 可打全域），以保留舊行為。攔截能力由掛載中具 interceptProfiles 的武器提供。
   */
  defaultLoadout?: { weaponId: string; ammoMax: number; rangeKm?: number | "core" }[];
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

// ── 武器掛載（B6 多武器）─────────────────────────────────
/**
 * 武器規格（靜態）。一種武器可同時具攻擊能力（targetDomains 非空）
 * 與攔截能力（interceptProfiles 非空）—— 如艦載 SAM 既打飛機也攔飛彈。
 */
export interface WeaponSpec {
  id: string;
  name: string;
  /** 射程（km）；"core" = 用 unit.core.rangeKm（讓場景的 rangeKm 調校生效） */
  rangeKm: number | "core";
  pKill: number;
  /** 可攻擊的目標域；[] = 不能主動攻擊單位（純攔截武器，如 CIWS） */
  targetDomains: Domain[];
  /** 攻擊彈飛行剖面；省略 → 依目標域推導 */
  profile?: MissileProfile;
  speedKnots?: number;
  /** 可攔截的來襲飛行剖面；非空 = 此武器可作防空攔截（B8） */
  interceptProfiles?: MissileProfile[];
  /** 射擊冷卻（sim sec） */
  cooldownSec?: number;
  /** 命中傷害（target.hpMax 比例）；省略 = 0.6 */
  damageFrac?: number;
}

/** 武器彈艙（runtime，per unit）。每種武器獨立計彈。 */
export interface WeaponMagazine {
  weaponId: string;
  ammoCurrent: number;
  ammoMax: number;
  /** 此 entry 的射程覆寫（concrete km）；省略 → 用 WeaponSpec.rangeKm 解析 */
  rangeKm?: number;
  lastFireSimSec?: number;
}

// ── position / dynamic state ─────────────────────────────
export interface Position {
  lng: number;
  lat: number;
  altMeters: number;
  headingDeg: number;
  speedKnots: number;
}

export type DetectionState = "hidden" | "unknown" | "classified" | "tracked";

/**
 * 接觸定位品質（E21 被動測向 / TMA）。獨立於 DetectionState（識別等級）：
 *   - "bearing" ：僅得方位、不得距離（單一被動聲納）→ 位置「未定位」，不顯示精確座標、不可開火
 *   - "fixed"   ：位置已知（雷達 / 主動聲納 / 聲標點偵測 / 潛望鏡目視 / 雙感測三角交會 / TMA 機動測距解算）
 * 省略 = 視為 "fixed"（無聲學模型時雷達直接給距離，保留舊行為）。
 */
export type ContactQuality = "bearing" | "fixed";

/**
 * TMA（Target Motion Analysis）機動測距追蹤（per 感測器 × 目標）。
 * 單一被動感測器需「自身機動」（航向變化）累積足夠才能解算距離（Ekelund / 機動測距）。
 */
export interface TmaTrack {
  /** 持續被動接觸累計秒數 */
  holdSec: number;
  /** 上一 tick 感測器航向（算航向變化用） */
  lastHeadingDeg: number;
  /** 接觸期間累計航向變化量（度）— 達門檻 + holdSec 足夠 → 解算成立 */
  maneuverDeg: number;
}

/**
 * 被動測向接觸（E21）— 供測向射線渲染。每 tick 由 detection 重算。
 * 被動聲納只得方位不得距離 → 從感測器沿 bearingDeg 畫射線（固定長度，不洩漏真實距離）。
 */
export interface PassiveContact {
  observerSideId: SideId;
  sensorId: UnitId;
  sensorPos: LngLat;
  /** 感測器→目標方位（度，0=北 順時針） */
  bearingDeg: number;
  targetId: UnitId;
  /** 此接觸對該觀察方的定位品質（bearing = 未定位、fixed = 已交會/解算） */
  quality: ContactQuality;
}

/**
 * 交戰規則（Rules of Engagement）。沿用 CMO 慣例：
 *   - weapons_free   ：可主動接戰射程內任何「已分類（≥ classified）」的敵方（預設）
 *   - weapons_tight  ：只接戰已完成正面識別（tracked）的敵方
 *   - defensive_only ：只反擊「正對我方發射飛彈」的敵方
 *   - weapons_hold   ：完全不主動接戰；只接受明確 engage 命令
 *
 * 有效 ROE = unit.roe ?? side.roe ?? "weapons_free"（per-unit 覆寫 per-side 預設）。
 */
export type RoeMode =
  | "weapons_free"
  | "weapons_tight"
  | "defensive_only"
  | "weapons_hold";

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
  /**
   * 偵測狀態機計時（per 觀察方 side）：
   *   - inSec ：在有效感測範圍內持續接觸的累計秒數（驅動 unknown→classified→tracked 升級）
   *   - outSec：失去接觸後的累計秒數（驅動降級 / 失聯）
   * optional → 既有場景 / replay JSON 不需含此欄位（detection.ts 會初始化）。
   */
  detectionTimers?: Partial<Record<SideId, { inSec: number; outSec: number }>>;
  /**
   * 接觸定位品質（per 觀察方 side，E21）：bearing = 未定位（僅方位）、fixed = 位置已知。
   * 由 detection 每 tick 重算；省略 = 該方未偵測或視為 fixed。渲染層 / combat 開火閘門讀此值。
   */
  contactQuality?: Partial<Record<SideId, ContactQuality>>;
  lastTickSimSec: number;
  parentId?: UnitId;
  engagingTargetId?: UnitId;
  /** Per-unit ROE 覆寫；省略 → 用 side.roe ?? "weapons_free" */
  roe?: RoeMode;
  /** Per-unit 武器飛行剖面覆寫（B7）；如 DF-26 設 "ballistic"。省略 → catalog.weaponProfile ?? 域推導 */
  weaponProfile?: MissileProfile;
  /** 主動聲納是否開啟（E20）。開 = 拍發 ping，偵測潛艦距離大增，但自身被動曝露給敵方被動聲納 */
  activeSonar?: boolean;
  /** 拖曳陣列是否佈放（streamed）；省略 = 已佈放（裝備者預設使用） */
  towedArrayDeployed?: boolean;
  /** 水面艦是否裝備拖曳陣列（少數有）；潛艦不需此旗標（catalog 有 towedArray 即用） */
  hasTowedArray?: boolean;
  /** 最近一次釋放魚雷反制誘標的 sim sec（冷卻計時） */
  lastDecoySimSec?: number;
  /** 目標下潛深度（公尺，正值；潛艦用）。引擎以固定速率漸變 altMeters 趨近 −targetDepthM */
  targetDepthM?: number;
  /** 武器彈艙（B6，runtime）。loadScenario 時由 catalog.defaultLoadout 或合成初始化 */
  weapons?: WeaponMagazine[];
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
  | { id: CommandId; unitId: UnitId; simAtSec: number; kind: "hold" }
  | { id: CommandId; unitId: UnitId; simAtSec: number; kind: "set_roe"; roe: RoeMode }
  | { id: CommandId; unitId: UnitId; simAtSec: number; kind: "set_active_sonar"; on: boolean }
  | { id: CommandId; unitId: UnitId; simAtSec: number; kind: "set_depth"; depthM: number }
  | { id: CommandId; unitId: UnitId; simAtSec: number; kind: "set_towed_array"; on: boolean }
  | {
      id: CommandId; unitId: UnitId; simAtSec: number; kind: "deploy_sonobuoys";
      cornerA: LngLat; cornerB: LngLat; count: number; mdrKm?: number; lifetimeSec?: number;
    };

// ── events ───────────────────────────────────────────────
export type EngagementEventKind =
  | "detection"
  | "weapon_release"
  | "hit"
  | "miss"
  | "destroyed"
  | "intercept";

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
  /** 陣營預設 ROE；省略 → "weapons_free"。可被 unit.roe 覆寫 */
  roe?: RoeMode;
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
  briefing: string;
  startSimTimeSec: number;
  durationSec: number;
  sides: Side[];
  units: Unit[];
  pendingCommands: Command[];
  camera: { center: LngLat; zoom: number; pitch: number; bearing: number };
  victoryConditions: VictoryCondition[];
  pauseOnEvents?: EngagementEventKind[];
  /**
   * 地形遮蔽 + 雷達地平線（A5）。省略 = 啟用。
   * 啟用後：山脈會遮蔽低空雷達視線、海平面 horizon 限制低空目標偵測距離。
   * 潛艦（subsurface，聲納regime）不受影響。設 false 可關閉（保留舊平衡）。
   */
  terrainOcclusion?: boolean;
  /**
   * 反潛聲納模型（E20）。省略 = 關閉（潛艦沿用舊雷達 + stealth 偵測模型，保留既有場景平衡）。
   * 啟用後：潛艦只能被聲納（聲納方程式）偵測，雷達看不到水下；水中目標走被動/主動聲納。
   */
  acousticModel?: boolean;
  /** 聲學溫躍層深度（公尺，E20）。跨層聲傳會額外衰減；省略 = 60m */
  sonarLayerDepthM?: number;
  /**
   * 會聚區間距（km，E20 深水）。> 0 時於 N×間距 ± 5km 形成偵測環（環內 TL 大降）、
   * 環間為陰影區。典型 ~55km。省略 / 0 = 無 CZ（淺水或不模擬）。
   * 注意：實際是否成立由 acousticEnv.waterDepthM 是否為深水決定（若有設環境）。
   */
  convergenceZoneKm?: number;
  /**
   * 聲學環境（使用者場景開始前可設定）。省略 → 沿用上方 sonarLayerDepthM/CZ 固定值與預設環境噪音。
   * 有設時：層深取 acousticEnv.layerDepthM（由 BT 導出）、環境噪音由海況、淺水底反射 + CZ 深水閘門。
   */
  acousticEnv?: AcousticEnvironment;
}

/**
 * 反潛聲學環境（E20+）。由場景開始前的設定畫面填入，套進聲納模型。
 */
export interface AcousticEnvironment {
  /** BT 溫度-深度剖面（溫度°C @ 深度m）— 導出聲速剖面與層深 */
  btProfile: { depthM: number; tempC: number }[];
  /** 鹽度（ppt，預設 34） */
  salinityPpt: number;
  /** 海況 Beaufort 0..6 → 環境噪音 */
  seaState: number;
  /** 底質 → 反射損失（淺水多次觸底） */
  bottomType: "mud" | "sand" | "rock";
  /** 水深（m）→ 淺水底反射 + 深水才成立會聚區 */
  waterDepthM: number;
  /** 由 BT 導出的 Sonic Layer Depth（m，cache；applyAcousticEnv 時算好） */
  layerDepthM: number;
}

// ── 飛彈（in-flight） ────────────────────────────────────
/**
 * 飛行剖面（B7，簡化版）— 決定哪種防空攔截器可接戰：
 *   - sea_skim ：海面掠飛反艦彈，只有點防禦 / 低空 SAM 攔得到
 *   - cruise   ：一般巡弋 / 空對空 / SAM
 *   - ballistic：彈道，只有長程 SAM（愛國者）攔得到
 *   - pop_up   ：末端拉高俯衝
 */
export type MissileProfile = "sea_skim" | "cruise" | "ballistic" | "pop_up";
/** 飛彈角色：attack = 攻擊彈打單位；interceptor = 攔截彈打來襲飛彈 */
export type MissileRole = "attack" | "interceptor";

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
  /** 攻擊彈命中機率（B6 由發射武器決定）；resolveImpact 讀此值 */
  pKill?: number;
  /** 攻擊彈命中傷害比例（target.hpMax）；省略 = 0.6 */
  damageFrac?: number;
  /** 發射武器 id（B6）；用於辨識魚雷（"torpedo"）以套用聲學反制 */
  weaponId?: string;
  /** 角色；省略 = "attack"（向後相容） */
  role?: MissileRole;
  /** 飛行剖面（attack 彈用）；省略 = "cruise" */
  profile?: MissileProfile;
  /** interceptor 專用：正在追擊的來襲飛彈 id（每 tick 重新導引到其當前位置） */
  interceptTargetMissileId?: string;
  /** interceptor 專用：攔截成功機率 */
  interceptPKill?: number;
}

/**
 * 聲學特性（E20 反潛聲納模型）。掛在 UnitCatalogEntry.acoustics。
 * 用於聲納方程式（被動 passive sonar / 主動 active sonar）：
 *   被動 SE = SL − TL − (NL − DI) − DT
 *   主動 SE = SL_ping − 2·TL + TS − (NL − DI) − DT
 * SE（signal excess）≥ 0 → 偵測到。
 */
export interface AcousticProfile {
  /** 自身輻射噪音源平（dB，安靜巡航時）— 作為被別人聽到的「聲源」 */
  sourceLevelDb: number;
  /** 每節航速額外增加的噪音（dB/kn）— 高速 = 吵 = 易被聽到 */
  noisePerKnotDb?: number;
  /** 目標強度（dB）— 主動聲納回波用 */
  targetStrengthDb: number;
  /** 作為被動接收方的能力（沒有 = 不能被動偵測）— 艦艏 / 側舷陣列 */
  passive?: { arrayGainDb: number; dtDb: number; selfNoiseDb: number };
  /**
   * 拖曳陣列（TACTAS）— 高增益被動感測，需 streamed 且低速才有效（speedLimitKn）。
   * 水面艦只有 hasTowedArray 旗標者才用；潛艦皆有。
   */
  towedArray?: { arrayGainDb: number; dtDb: number; selfNoiseDb: number; speedLimitKn: number };
  /** 作為主動聲納發射方的能力（沒有 = 不能主動拍發） */
  active?: { sourceLevelDb: number };
  /** 魚雷聲學反制（軟殺來襲魚雷）：水面艦 Nixie / 潛艦誘標 */
  torpedoDecoy?: { pDefeat: number; cooldownSec: number };
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

// ── 聲標（sonobuoy，反潛區域搜索屏幕）─────────────────────
export interface Sonobuoy {
  id: string;
  sideId: SideId;
  position: LngLat;
  /** 偵測半徑（MDR，km）— 水中目標在此半徑內即被偵測 */
  mdrKm: number;
  deployedAtSimSec: number;
  /** 電池壽命（秒）；deployedAtSimSec + lifetimeSec 後失效消失 */
  lifetimeSec: number;
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
  /** 已佈放的聲標（反潛屏幕）；無聲標時為空陣列 */
  sonobuoys: Sonobuoy[];
  /**
   * 被動測向接觸（E21）— 每 tick 由 detection 重算，供測向射線渲染。省略 = 空。
   */
  passiveContacts?: PassiveContact[];
  /**
   * TMA 機動測距追蹤（E21）：sensorId → (targetId → TmaTrack)。engine 內部狀態，
   * 跨 tick 累積感測器機動量；省略 = 空。replay JSON 可省略（detection 會初始化）。
   */
  tmaTracks?: Record<UnitId, Record<UnitId, TmaTrack>>;
  /**
   * hold_area 條件計時：condition index → 該方第一次進入區域的 simSec；
   * 不在區域內 → null。達到 forSec 即勝。
   */
  holdProgress: Record<number, number | null>;
  outcome: { winner: SideId | null; reason: string; conditionLabel?: string } | null;
}
