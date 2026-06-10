/**
 * 場景：CSG-12 航母戰鬥群護台 2032
 *
 * 設定：美軍航母戰鬥群（USS Theodore Roosevelt）在台灣東部海域佈防，
 * 配合 ROC 海空軍應對解放軍大規模兵力。紅方除水面艦群外含 J-20、潛艦、
 * DF-26 反艦彈道飛彈（ASBM）— 著名的「航母殺手」威脅。
 */
import type { Scenario, Side, Unit } from "../types";
import { UNIT_CATALOG } from "../catalog/units";
import { SIDE_COLORS } from "../symbology/sideColors";

const SIDES: Side[] = [
  {
    id: "blue", displayName: "中華民國國軍",
    colorPrimary: SIDE_COLORS.blue.primary, colorSecondary: SIDE_COLORS.blue.secondary,
    isPlayer: true, ownership: "human",
    isHostileTo: ["red"],
  },
  {
    id: "us", displayName: "美國海軍 (USN)",
    colorPrimary: SIDE_COLORS.us.primary, colorSecondary: SIDE_COLORS.us.secondary,
    isPlayer: false, ownership: "scripted",
    isHostileTo: ["red"],
  },
  {
    id: "red", displayName: "解放軍",
    colorPrimary: SIDE_COLORS.red.primary, colorSecondary: SIDE_COLORS.red.secondary,
    isPlayer: false, ownership: "scripted",
    isHostileTo: ["blue", "us"],
  },
  {
    id: "neutral", displayName: "民用",
    colorPrimary: SIDE_COLORS.neutral.primary, colorSecondary: SIDE_COLORS.neutral.secondary,
    isPlayer: false, ownership: "scripted",
    isHostileTo: [],
  },
];

function mkUnit(
  id: string,
  sideId: Unit["sideId"],
  kind: Unit["kind"],
  callsign: string,
  displayName: string,
  lng: number, lat: number,
  opts: {
    speedKnots?: number;
    waypoints?: [number, number][];
    stealth?: number;
    coreOverride?: Partial<Unit["core"]>;
    supplyOverride?: Unit["supplyOverride"];   // CVN 多用途載台用
    weaponProfile?: Unit["weaponProfile"];     // B7：DF-26 設 "ballistic"
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
      altMeters: cat.defaultAltitudeM,
      headingDeg: 0, speedKnots: opts.speedKnots ?? 0,
    },
    waypoints: opts.waypoints ?? [],
    core, extensions,
    distanceTravelledKm: 0,
    hpCurrent: core.hpMax,
    ammoMax: cat.defaultAmmoMax,
    ammoCurrent: cat.defaultAmmoMax,
    ...(opts.supplyOverride ? { supplyOverride: opts.supplyOverride } : {}),
    ...(opts.weaponProfile ? { weaponProfile: opts.weaponProfile } : {}),
    detectedBy: {},
    lastTickSimSec: 0,
  };
}

// ── 美軍 CSG-12 部署於台灣東部海域 ~123°E, 23°N ──
const US_UNITS: Unit[] = [
  // CVN-71 USS Theodore Roosevelt — 移動 airbase（既是船艦也是 F-18 RTB 目標）
  mkUnit("US-CVN-71", "us", "ship_surface", "CVN-71", "USS Theodore Roosevelt", 123.20, 23.00, {
    speedKnots: 30,
    coreOverride: { hpMax: 800, rangeKm: 100, detectionRangeKm: 400 },
    supplyOverride: {
      rangeKm: 25,            // 飛行甲板 + 進場航線
      fuelKmPerSec: 30,       // 艦上加油快速
      ammoPerSec: 0.6,        // 彈藥庫充足 + 機庫快速掛彈
    },
  }),

  // 4 Arleigh Burke 級 Aegis DDG 護衛圈
  mkUnit("US-DDG-110", "us", "ship_surface", "DDG-110", "USS William P. Lawrence", 123.05, 23.10, {
    speedKnots: 28,
    coreOverride: { rangeKm: 200, detectionRangeKm: 350, hpMax: 400 },
    waypoints: [[123.00, 23.00], [123.00, 22.90], [123.10, 22.90]],
  }),
  mkUnit("US-DDG-89", "us", "ship_surface", "DDG-89", "USS Mustin", 123.35, 23.05, {
    speedKnots: 28,
    coreOverride: { rangeKm: 200, detectionRangeKm: 350, hpMax: 400 },
    waypoints: [[123.40, 23.00], [123.30, 22.90]],
  }),
  mkUnit("US-DDG-104", "us", "ship_surface", "DDG-104", "USS Sterett", 123.20, 22.85, {
    speedKnots: 28,
    coreOverride: { rangeKm: 200, detectionRangeKm: 350, hpMax: 400 },
    waypoints: [[123.10, 22.80]],
  }),
  mkUnit("US-DDG-115", "us", "ship_surface", "DDG-115", "USS Rafael Peralta", 123.20, 23.18, {
    speedKnots: 28,
    coreOverride: { rangeKm: 200, detectionRangeKm: 350, hpMax: 400 },
    waypoints: [[123.30, 23.20]],
  }),

  // 1 Seawolf 級 SSN（高 stealth）
  mkUnit("US-SSN-21", "us", "submarine", "SSN-21", "USS Seawolf", 122.50, 22.40, {
    speedKnots: 25,
    stealth: 0.85,
    coreOverride: { rangeKm: 80, hpMax: 300 },
    waypoints: [[122.80, 22.50], [123.00, 22.70]],
  }),

  // 4 F/A-18 Super Hornet CAP（艦載機分散 patrol）
  mkUnit("US-F18-01", "us", "fighter", "VFA-31-1", "F/A-18E CAP-1", 123.50, 23.20, {
    speedKnots: 550,
    coreOverride: { rangeKm: 120, detectionRangeKm: 200, hpMax: 70 },
    waypoints: [[123.00, 23.50], [122.50, 23.20], [122.80, 22.80], [123.40, 23.00]],
  }),
  mkUnit("US-F18-02", "us", "fighter", "VFA-31-2", "F/A-18E CAP-2", 123.40, 22.80, {
    speedKnots: 550,
    coreOverride: { rangeKm: 120, detectionRangeKm: 200, hpMax: 70 },
    waypoints: [[122.90, 22.60], [122.50, 23.00], [123.10, 23.30]],
  }),
  mkUnit("US-F18-03", "us", "fighter", "VFA-211-1", "F/A-18F STRIKE-1", 123.30, 23.30, {
    speedKnots: 600,
    coreOverride: { rangeKm: 140, detectionRangeKm: 220, hpMax: 75 },
    waypoints: [[122.50, 23.50], [121.80, 23.50]],
  }),
  mkUnit("US-F18-04", "us", "fighter", "VFA-211-2", "F/A-18F STRIKE-2", 123.10, 23.30, {
    speedKnots: 600,
    coreOverride: { rangeKm: 140, detectionRangeKm: 220, hpMax: 75 },
    waypoints: [[122.40, 23.40], [121.70, 23.40]],
  }),

  // 1 E-2D Hawkeye AWACS（用 drone kind + 大 detection 模擬）
  mkUnit("US-E2D-01", "us", "drone", "VAW-117", "E-2D Hawkeye", 123.70, 23.00, {
    speedKnots: 280,
    coreOverride: { detectionRangeKm: 500, hpMax: 100, rangeKm: 0 },
    waypoints: [[123.80, 22.80], [123.80, 23.20]],   // 後方盤旋
  }),

  // ── 2 補給艦（CSG 後方並航；6 km 內 RAS 補油 + 補彈）──
  // T-AO 油彈船（fuel + ammo），跟著艦隊以 16 節同向慢推進
  mkUnit("US-AO-201", "us", "supply_ship", "T-AO-201", "USNS Henry J. Kaiser", 123.55, 23.05, {
    speedKnots: 16,
    coreOverride: { hpMax: 600 },
    waypoints: [[123.50, 23.00], [123.45, 22.95], [123.50, 22.90]],   // 維持在 DDG 圈內側
  }),
  // T-AKE 乾貨彈藥船（重點補彈）
  mkUnit("US-AKE-301", "us", "supply_ship", "T-AKE-301", "USNS Lewis and Clark", 123.55, 22.95, {
    speedKnots: 16,
    coreOverride: { hpMax: 600 },
    waypoints: [[123.50, 22.92], [123.45, 22.88], [123.50, 22.95]],
  }),
];

// ── ROC 國軍少量配合 ──
const BLUE_UNITS: Unit[] = [
  mkUnit("BLUE-DDG-1801", "blue", "ship_surface", "DDG-1801", "紀德級 - 基隆", 121.80, 25.10, {
    speedKnots: 18,
    waypoints: [[122.00, 24.50], [122.30, 23.80]],
  }),
  mkUnit("BLUE-DDG-1803", "blue", "ship_surface", "DDG-1803", "紀德級 - 蘇澳", 121.90, 24.50, {
    speedKnots: 18,
    waypoints: [[122.20, 23.80]],
  }),
  mkUnit("BLUE-FT-01", "blue", "fighter", "IDF-CAP", "經國號 CAP", 121.20, 24.00, {
    speedKnots: 500,
    waypoints: [[121.20, 23.50], [121.20, 24.50], [121.20, 24.00]],
  }),
  mkUnit("BLUE-RAD-01", "blue", "radar_station", "RAD-LS", "樂山雷達", 121.42, 24.81),
];

// ── 紅方大規模兵力 ──
const RED_UNITS: Unit[] = [
  // 6 PLA 水面艦群從台灣海峽中段向東突穿
  mkUnit("RED-055-101", "red", "ship_surface", "055-101", "055 型驅逐艦", 120.40, 23.80, {
    speedKnots: 24,
    coreOverride: { rangeKm: 250, detectionRangeKm: 300, hpMax: 500 },
    waypoints: [[121.00, 23.80], [121.60, 23.80]],
  }),
  mkUnit("RED-052D-201", "red", "ship_surface", "052D-201", "052D 驅逐艦", 120.30, 23.60, {
    speedKnots: 24,
    waypoints: [[120.90, 23.60], [121.50, 23.60]],
  }),
  mkUnit("RED-052D-202", "red", "ship_surface", "052D-202", "052D 驅逐艦", 120.30, 24.00, {
    speedKnots: 24,
    waypoints: [[120.90, 24.00], [121.50, 24.00]],
  }),
  mkUnit("RED-054A-301", "red", "ship_surface", "054A-301", "054A 護衛艦", 120.20, 23.40, {
    speedKnots: 26,
    waypoints: [[120.80, 23.40], [121.40, 23.40]],
  }),
  mkUnit("RED-054A-302", "red", "ship_surface", "054A-302", "054A 護衛艦", 120.20, 24.20, {
    speedKnots: 26,
    waypoints: [[120.80, 24.20], [121.40, 24.20]],
  }),

  // 4 J-20 隱形戰機
  mkUnit("RED-J20-01", "red", "fighter", "J20-01", "殲-20 領隊", 119.50, 23.50, {
    speedKnots: 700,
    coreOverride: { detectionRangeKm: 220, hpMax: 70 },
    waypoints: [[120.50, 23.50], [121.50, 23.50]],
  }),
  mkUnit("RED-J20-02", "red", "fighter", "J20-02", "殲-20 僚機", 119.50, 23.70, {
    speedKnots: 700,
    waypoints: [[120.50, 23.70], [121.50, 23.70]],
  }),
  mkUnit("RED-J20-03", "red", "fighter", "J20-03", "殲-20-03", 119.50, 24.00, {
    speedKnots: 700,
    waypoints: [[120.50, 24.00], [121.50, 24.00]],
  }),
  mkUnit("RED-J20-04", "red", "fighter", "J20-04", "殲-20-04", 119.50, 23.30, {
    speedKnots: 700,
    waypoints: [[120.50, 23.30], [121.50, 23.30]],
  }),

  // 2 Type 093 SSN（高 stealth）
  mkUnit("RED-SSN-093A", "red", "submarine", "093A-501", "093A 型攻擊潛艦", 119.80, 23.20, {
    speedKnots: 18,
    stealth: 0.75,
    waypoints: [[120.50, 23.10], [121.20, 23.00], [122.00, 22.90]],
  }),
  mkUnit("RED-SSN-093B", "red", "submarine", "093B-502", "093B 型攻擊潛艦", 119.80, 24.30, {
    speedKnots: 18,
    stealth: 0.75,
    waypoints: [[120.50, 24.20], [121.20, 24.00]],
  }),

  // 2 DF-26 ASBM 反艦彈道飛彈車（部署於東南沿海，模擬大射程）
  mkUnit("RED-DF26-01", "red", "missile_launcher", "DF-26-01", "東風 26 (ASBM)", 117.50, 24.00, {
    coreOverride: { rangeKm: 4000, hpMax: 60 },   // ASBM 大射程
    weaponProfile: "ballistic",                   // B7：彈道剖面，只有愛國者攔得到
  }),
  mkUnit("RED-DF26-02", "red", "missile_launcher", "DF-26-02", "東風 26 (ASBM)", 117.30, 23.50, {
    coreOverride: { rangeKm: 4000, hpMax: 60 },
    weaponProfile: "ballistic",
  }),

  // 1 紅方雷達
  mkUnit("RED-RAD-01", "red", "radar_station", "RAD-FJ-CSG", "東南沿海雷達", 118.00, 24.50),
];

const NEUTRAL_UNITS: Unit[] = [
  mkUnit("NEU-SH-01", "neutral", "ship_surface", "MV-EVERGREEN", "長榮貨櫃船", 122.50, 22.50, {
    speedKnots: 18,
    waypoints: [[122.00, 22.00]],
  }),
];

export const CSG_DEFENSE_2032: Scenario = {
  id: "csg_defense_2032",
  displayName: "CSG-12 護台 2032",
  briefing: "美軍 USS Theodore Roosevelt 戰鬥群部署於台灣東部海域，配合 ROC 海空軍應對解放軍大規模兵力。注意紅方 2 枚 DF-26 反艦彈道飛彈威脅航母。",
  startSimTimeSec: 0,
  durationSec: 3600,
  sides: SIDES,
  units: [...US_UNITS, ...BLUE_UNITS, ...RED_UNITS, ...NEUTRAL_UNITS],
  pendingCommands: [],
  camera: {
    center: [122.00, 23.50],
    zoom: 7.0,
    pitch: 38,
    bearing: 0,
  },
  victoryConditions: [
    // CVN 被擊毀 = 紅方戰略勝利（DF-26 + J-20 + SSN 任一方式）
    {
      kind: "destroy_unit",
      unitId: "US-CVN-71",
      sideId: "red",
      label: "紅方戰略目標 — 擊沉 USS Theodore Roosevelt",
    },
    // 美軍守住航母 + 殲滅紅方水面艦 = 聯軍勝
    {
      kind: "eliminate_side",
      targetSideId: "red",
      sideId: "us",
      label: "聯軍 — 殲滅紅方所有兵力",
    },
    // 航母存活到時限 = 聯軍防衛成功
    {
      kind: "preserve_unit",
      unitId: "US-CVN-71",
      sideId: "us",
      label: "聯軍防衛 — 航母存活至時限結束",
    },
  ],
};
