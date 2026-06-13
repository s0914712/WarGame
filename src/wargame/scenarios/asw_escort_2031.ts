/**
 * 場景：反潛護航 2031（ASW Convoy Escort）
 *
 * 設定：台灣東部外海（菲律賓海深水區），一支高價值補給船團須安全通過，
 * 解放軍 2 艘安靜柴電 / 核潛艦潛伏伏擊。藍方反潛兵力（巡防艦主動聲納 +
 * P-8 反潛機聲標 + 1 艘獵殺潛艦）須在敵潛艦進入魚雷射程前偵獲並擊沉。
 *
 * 戰術重點（E20 聲納模型）：
 *   - 補給艦極吵 → 紅潛艦被動聲納可在 ~70km 外聽到並接近
 *   - 紅潛艦安靜 → 藍方水面艦被動幾乎聽不到（~6km）
 *   - 藍方須「拍發主動聲納」才能在 ~13km 偵獲潛艦 —— 但主動 ping 會把自己
 *     的位置遠距曝露給紅方被動聲納（>100km）
 *   - 安靜慢速潛行 vs 高速衝刺（變吵易被偵獲）的取捨
 *   - 溫躍層：水面艦在層上、潛艦在層下，跨層聲傳額外衰減
 *
 * 開闊深水（無地形遮蔽影響），純聲學對抗。
 */
import type { Scenario, Side, Unit } from "../types";
import { UNIT_CATALOG } from "../catalog/units";
import { SIDE_COLORS } from "../symbology/sideColors";

const SIDES: Side[] = [
  {
    id: "blue", displayName: "中華民國國軍",
    colorPrimary: SIDE_COLORS.blue.primary, colorSecondary: SIDE_COLORS.blue.secondary,
    isPlayer: true, ownership: "human", isHostileTo: ["red"],
  },
  {
    id: "red", displayName: "解放軍",
    colorPrimary: SIDE_COLORS.red.primary, colorSecondary: SIDE_COLORS.red.secondary,
    isPlayer: false, ownership: "scripted", isHostileTo: ["blue"],
  },
  {
    id: "neutral", displayName: "民用",
    colorPrimary: SIDE_COLORS.neutral.primary, colorSecondary: SIDE_COLORS.neutral.secondary,
    isPlayer: false, ownership: "scripted", isHostileTo: [],
  },
];

function mkUnit(
  id: string, sideId: Unit["sideId"], kind: Unit["kind"],
  callsign: string, displayName: string,
  lng: number, lat: number,
  opts: {
    speedKnots?: number;
    waypoints?: [number, number][];
    stealth?: number;
    coreOverride?: Partial<Unit["core"]>;
    activeSonar?: boolean;
    hasTowedArray?: boolean;
    /** 潛艦初始 / 目標下潛深度（公尺，正值）。決定在溫躍層上 or 下 → 影響被偵測機率 */
    depthM?: number;
  } = {},
): Unit {
  const cat = UNIT_CATALOG[kind];
  const core = { ...cat.defaultCore, ...(opts.coreOverride ?? {}) };
  if (opts.speedKnots !== undefined) core.speedKnots = opts.speedKnots;
  const extensions: Unit["extensions"] = {};
  if (opts.stealth !== undefined) extensions.stealth = opts.stealth;
  return {
    id, sideId, kind, callsign, displayName,
    position: {
      lng, lat,
      altMeters: opts.depthM != null ? -opts.depthM : cat.defaultAltitudeM,
      headingDeg: 0, speedKnots: opts.speedKnots ?? 0,
    },
    waypoints: opts.waypoints ?? [],
    core, extensions,
    distanceTravelledKm: 0,
    hpCurrent: core.hpMax,
    ammoMax: cat.defaultAmmoMax,
    ammoCurrent: cat.defaultAmmoMax,
    ...(opts.activeSonar ? { activeSonar: true } : {}),
    ...(opts.hasTowedArray ? { hasTowedArray: true } : {}),
    ...(opts.depthM != null ? { targetDepthM: opts.depthM } : {}),
    detectedBy: {},
    lastTickSimSec: 0,
  };
}

// ── 蘇澳港（補給艦目的地）──
const SUAO_PORT: [number, number] = [121.90, 24.60];

// ── 藍方：補給船團 + 反潛護航群（由東部外海深水區向西北穿越危險海域 → 蘇澳港）──
const BLUE_UNITS: Unit[] = [
  // 高價值目標：補給艦（極吵、無聲納、需被保護）— 須穿越潛伏區抵達蘇澳港
  mkUnit("BLUE-AOE-01", "blue", "supply_ship", "AOE-532", "磐石號油彈補給艦", 122.30, 24.36, {
    speedKnots: 16,
    waypoints: [[122.05, 24.48], [121.93, 24.58], SUAO_PORT],
  }),

  // 2 巡防艦護航（主動聲納拍發 ON — 偵潛主力，但會曝露自身）
  mkUnit("BLUE-FFG-01", "blue", "ship_surface", "FFG-1101", "成功級 - 前衛", 122.34, 24.40, {
    speedKnots: 16,
    activeSonar: true,
    hasTowedArray: true,   // 裝拖曳陣列（低速被動偵潛大增）
    coreOverride: { rangeKm: 22, detectionRangeKm: 200 },   // ASROC 反潛火箭 ~22km
    waypoints: [[122.08, 24.50], [121.95, 24.58]],
  }),
  mkUnit("BLUE-FFG-02", "blue", "ship_surface", "FFG-1103", "成功級 - 側衛", 122.36, 24.30, {
    speedKnots: 16,
    activeSonar: true,
    hasTowedArray: true,   // 裝拖曳陣列（低速被動偵潛大增）
    coreOverride: { rangeKm: 22, detectionRangeKm: 200 },
    waypoints: [[122.12, 24.44], [121.98, 24.55]],
  }),

  // 1 獵殺潛艦（被動潛聽，伴護於船團側翼；重型魚雷 ~18km）— 潛於層下 120m 隱蔽
  mkUnit("BLUE-SS-01", "blue", "submarine", "SS-794", "劍龍級 - 海虎", 122.32, 24.33, {
    speedKnots: 9,
    depthM: 120,                                 // 溫躍層下，安靜潛聽
    coreOverride: { rangeKm: 18, hpMax: 220 },
    waypoints: [[122.05, 24.47], [121.95, 24.56]],
  }),

  // 1 P-8 反潛機（聲標被動偵潛 — 大範圍掃蕩）
  mkUnit("BLUE-P8-01", "blue", "drone", "VP-ROC", "P-8A 反潛機", 122.30, 24.40, {
    speedKnots: 300,
    coreOverride: { detectionRangeKm: 300, hpMax: 100 },
    waypoints: [
      [122.00, 24.52], [121.95, 24.40], [122.20, 24.30], [122.30, 24.40],
    ],
  }),

  // 1 反潛直升機（吊放聲納點偵測）— 由船團前出懸停，換能器入水做主動點偵測（玩家可前推獵殺）
  mkUnit("BLUE-HELO-01", "blue", "asw_helo", "ASW-701", "S-70C 反潛直升機", 122.30, 24.34, {
    speedKnots: 0,                               // 懸停 → 吊放聲納作業中（dipping active）
  }),
];

// ── 紅方：2 艘潛艦於蘇澳港航道上潛伏（與藍方拉開 >15 浬，安靜潛行伺機魚雷攻擊補給艦）──
// 兩艦刻意設不同深度 + 不同水文層位，示範「潛艦深度 × 水文 → 被偵測機率差異」：
//   093B 潛於溫躍層下 200m → 與層上水面艦跨層聲傳，TL 額外衰減 → 難偵獲
//   039C 潛於溫躍層內 40m  → 與水面艦同層，直達聲傳 → 較易被偵獲
const RED_UNITS: Unit[] = [
  // 093B 核潛艦 — 層下深潛 200m（與層上水面艦跨層聲傳，+8dB 衰減 → 難偵獲、近距才現蹤）
  mkUnit("RED-SSN-01", "red", "submarine", "093B-21", "093B 攻擊潛艦（層下 200m）", 121.98, 24.52, {
    speedKnots: 5,                 // 慢速 = 安靜 = 難偵獲
    depthM: 200,                   // 溫躍層下 → 跨層偵測衰減
    coreOverride: { rangeKm: 15, hpMax: 200 },   // 重型魚雷 ~15km
    waypoints: [[122.10, 24.46], [122.20, 24.42]],
  }),
  // 039C 柴電潛艦 — 層內淺潛 40m（與水面艦同層直達聲傳 → 較遠距即被被動聲納測得方位）
  mkUnit("RED-SS-02", "red", "submarine", "039C-336", "039C 元級（層內 40m）", 122.02, 24.46, {
    speedKnots: 5,
    depthM: 40,                    // 溫躍層內 → 與水面艦同層，較易偵獲
    coreOverride: { rangeKm: 14, hpMax: 180 },
    waypoints: [[122.12, 24.42], [122.20, 24.39]],
  }),
];

const NEUTRAL_UNITS: Unit[] = [
  mkUnit("NEU-SH-01", "neutral", "ship_surface", "MV-LNG", "LNG 運輸船", 122.50, 24.18, {
    speedKnots: 15, waypoints: [[122.20, 24.42], [121.95, 24.62]],
  }),
];

export const ASW_ESCORT_2031: Scenario = {
  id: "asw_escort_2031",
  displayName: "反潛護航 2031",
  briefing: "磐石號補給艦（AOE-532）須由台灣東部深水區穿越危險海域、安全抵達蘇澳港。2 艘解放軍潛艦於蘇澳航道上潛伏（093B 層下 200m 難偵獲、039C 層內 40m 較易偵獲 — 深度 × 水文決定被偵測機率），伺機以魚雷伏擊補給艦。藍方反潛群（巡防艦主動聲納 + P-8 聲標 + S-70C 吊放聲納 + 獵殺潛艦）須護衛補給艦突破封鎖。被動聲納只得方位（虛線測向射線），須兩感測器三角交會（持續 ~90 秒）或自身機動 TMA 解算才「定位」、且僅得匿名標記，完整識別須升潛望鏡深度目視（~7 浬）。下潛潛艦只能發射魚雷；潛射巡弋飛彈須升潛望鏡深度。【勝負】藍方：補給艦抵達蘇澳港；紅方：擊沉補給艦，或擊沉兩艘護衛艦。",
  startSimTimeSec: 0,
  durationSec: 6000,
  sides: SIDES,
  units: [...BLUE_UNITS, ...RED_UNITS, ...NEUTRAL_UNITS],
  pendingCommands: [
    // P-8 開場佈一道聲標反潛屏幕，橫跨紅潛潛伏的蘇澳航道（介於船團與潛伏區之間）
    {
      id: "asw-screen-0", unitId: "BLUE-P8-01", simAtSec: 0, kind: "deploy_sonobuoys",
      cornerA: [122.12, 24.40], cornerB: [122.30, 24.52], count: 12, mdrKm: 4, lifetimeSec: 6000,
    },
  ],
  acousticModel: true,        // 啟用 E20 聲納方程式偵測
  sonarLayerDepthM: 60,       // 溫躍層深度（無 acousticEnv 時的 fallback）
  convergenceZoneKm: 55,      // 深水會聚區間距（首環 ~55km）— 潛艦可遠距聽到吵雜船團
  // 初始水文環境（BT 溫深剖面）：夏季混合層 ~50m（0–50m 等溫 28°C）+ 強溫躍層下探。
  // 由此導出聲速剖面 → 層深 50m；深水（4000m）成立會聚區、無淺水底反射。
  // 潛艦在層上 or 層下 → 跨層聲傳衰減差異 → 被偵測機率差異（見紅方兩艦不同深度）。
  acousticEnv: {
    btProfile: [
      { depthM: 0,    tempC: 28 },
      { depthM: 25,   tempC: 28 },
      { depthM: 50,   tempC: 28 },   // 混合層底 → 聲速近表面極大值 → 層深 ~50m
      { depthM: 75,   tempC: 19 },   // 溫躍層
      { depthM: 120,  tempC: 12 },
      { depthM: 250,  tempC: 7 },
      { depthM: 600,  tempC: 4.5 },
      { depthM: 1200, tempC: 3.8 },
    ],
    salinityPpt: 34.5,
    seaState: 3,
    bottomType: "mud",
    waterDepthM: 4000,          // 深水（菲律賓海）→ 成立會聚區、無淺水混響限制
    layerDepthM: 50,            // 由上方 BT 剖面導出的 Sonic Layer Depth（cache）
  },
  camera: {
    center: [122.15, 24.42],
    zoom: 8.4,
    pitch: 35,
    bearing: 315,
  },
  victoryConditions: [
    // 藍方勝：補給艦穿越危險海域、抵達蘇澳港
    {
      kind: "unit_reaches_area",
      unitId: "BLUE-AOE-01",
      sideId: "blue",
      centerLngLat: SUAO_PORT,
      radiusKm: 9,
      label: "護航成功 — 補給艦安全進蘇澳港",
    },
    // 紅方勝：擊沉補給艦
    {
      kind: "destroy_unit",
      unitId: "BLUE-AOE-01",
      sideId: "red",
      label: "伏擊成功 — 擊沉補給艦",
    },
    // 紅方勝：擊沉兩艘護衛艦（FFG 全滅 → 船團失去屏障）
    {
      kind: "eliminate_kind",
      targetSideId: "blue",
      unitKind: "ship_surface",
      sideId: "red",
      label: "屏障瓦解 — 護衛艦全滅",
    },
    { kind: "time_limit", label: "時限結束比殘存戰力" },
  ],
};
