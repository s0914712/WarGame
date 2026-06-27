/**
 * 場景：巴士海峽封鎖 2030
 *
 * 設定：解放軍試圖封鎖巴士海峽（台灣南端 ~ 菲律賓北端），
 * 切斷台灣對外海運線。美軍 SSN + DDG 自菲律賓海進入支援，
 * ROC 南部沿岸 SAM / 巡邏艇守備。
 *
 * 戰術重點：水下對抗 + 隘口控制。範圍中等，含島嶼地形。
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
    id: "us", displayName: "美國海軍 (USN)",
    colorPrimary: SIDE_COLORS.us.primary, colorSecondary: SIDE_COLORS.us.secondary,
    isPlayer: false, ownership: "scripted", isHostileTo: ["red"],
  },
  {
    id: "red", displayName: "解放軍",
    colorPrimary: SIDE_COLORS.red.primary, colorSecondary: SIDE_COLORS.red.secondary,
    isPlayer: false, ownership: "scripted", isHostileTo: ["blue", "us"],
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
    detectedBy: {},
    lastTickSimSec: 0,
  };
}

// ── ROC 守備（南部沿岸 + 屏東 / 蘭嶼）──
const BLUE_UNITS: Unit[] = [
  // 3 雄三 ASM 部署於屏東沿岸
  mkUnit("BLUE-ML-01", "blue", "missile_launcher", "雄三-S1", "雄三 - 楓港", 120.65, 22.20),
  mkUnit("BLUE-ML-02", "blue", "missile_launcher", "雄三-S2", "雄三 - 鵝鑾鼻", 120.85, 21.92),
  mkUnit("BLUE-ML-03", "blue", "missile_launcher", "雄三-S3", "雄三 - 東港", 120.45, 22.45),

  // 2 巡邏艇巡邏巴士海峽北口
  mkUnit("BLUE-SH-01", "blue", "ship_surface", "PFG-1207", "康定級 - 左營", 120.30, 22.00, {
    speedKnots: 22,
    waypoints: [[120.80, 21.80], [121.20, 21.50], [120.80, 21.30]],
  }),
  mkUnit("BLUE-SH-02", "blue", "ship_surface", "PG-3811", "光華六號 - 高雄", 120.40, 22.20, {
    speedKnots: 25,
    waypoints: [[120.70, 22.00], [120.90, 21.70]],
  }),

  // 1 大漢山雷達
  mkUnit("BLUE-RAD-01", "blue", "radar_station", "RAD-DHS", "大漢山雷達", 120.83, 22.61),

  // 1 P-3C 反潛機（drone 模擬）
  mkUnit("BLUE-DR-01", "blue", "drone", "P-3C-01", "P-3C 反潛機", 120.50, 22.00, {
    speedKnots: 300,
    waypoints: [[120.80, 21.50], [121.20, 21.30], [120.80, 21.50], [120.50, 22.00]],
  }),
];

// ── 美軍從菲律賓海方向進入支援 ──
const US_UNITS: Unit[] = [
  mkUnit("US-DDG-89", "us", "ship_surface", "DDG-89", "USS Mustin", 122.50, 20.50, {
    speedKnots: 28,
    coreOverride: { rangeKm: 200, detectionRangeKm: 350, hpMax: 400 },
    waypoints: [[122.00, 20.80], [121.50, 21.10], [121.00, 21.30]],
  }),
  mkUnit("US-DDG-104", "us", "ship_surface", "DDG-104", "USS Sterett", 122.30, 20.30, {
    speedKnots: 28,
    coreOverride: { rangeKm: 200, detectionRangeKm: 350, hpMax: 400 },
    waypoints: [[121.80, 20.60], [121.30, 20.90]],
  }),

  // 美軍核潛在巴士海峽南口（高 stealth、獵殺紅潛艦）
  mkUnit("US-SSN-22", "us", "submarine", "SSN-22", "USS Connecticut", 121.80, 20.80, {
    speedKnots: 22,
    stealth: 0.88,
    coreOverride: { rangeKm: 80, hpMax: 320 },
    waypoints: [[121.50, 21.00], [121.20, 21.20]],
  }),

  // 1 P-8 Poseidon 海上巡邏機
  mkUnit("US-P8-01", "us", "drone", "VP-9", "P-8A Poseidon", 122.00, 20.50, {
    speedKnots: 350,
    coreOverride: { detectionRangeKm: 400, hpMax: 100 },
    waypoints: [[121.50, 20.80], [121.00, 21.10], [121.30, 20.90]],
  }),
];

// ── 紅方封鎖兵力 ──
const RED_UNITS: Unit[] = [
  // 4 PLA 水面艦群封鎖巴士海峽中心
  mkUnit("RED-055-101", "red", "ship_surface", "055-101", "055 型驅逐艦", 120.50, 21.30, {
    speedKnots: 22,
    coreOverride: { rangeKm: 250, detectionRangeKm: 300, hpMax: 500 },
    waypoints: [[120.80, 21.30], [121.10, 21.30]],
  }),
  mkUnit("RED-052D-201", "red", "ship_surface", "052D-201", "052D 驅逐艦", 120.40, 21.50, {
    speedKnots: 24,
    waypoints: [[120.80, 21.50], [121.00, 21.50]],
  }),
  mkUnit("RED-052D-202", "red", "ship_surface", "052D-202", "052D 驅逐艦", 120.60, 21.10, {
    speedKnots: 24,
    waypoints: [[121.00, 21.10], [121.20, 21.20]],
  }),
  mkUnit("RED-054A-301", "red", "ship_surface", "054A-301", "054A 護衛艦", 120.40, 21.00, {
    speedKnots: 26,
    waypoints: [[120.90, 21.00], [121.10, 21.00]],
  }),

  // 2 Type 093 潛艦
  mkUnit("RED-SSN-501", "red", "submarine", "093A-501", "093A 攻擊潛艦", 120.30, 21.60, {
    speedKnots: 18,
    stealth: 0.75,
    waypoints: [[120.80, 21.40], [121.20, 21.20]],
  }),
  mkUnit("RED-SSN-502", "red", "submarine", "093A-502", "093A 攻擊潛艦", 120.50, 20.90, {
    speedKnots: 18,
    stealth: 0.75,
    waypoints: [[121.00, 20.90], [121.30, 20.90]],
  }),

  // 2 紅方戰機
  mkUnit("RED-J16-01", "red", "fighter", "J16-01", "殲-16 攻擊", 119.50, 21.50, {
    speedKnots: 650,
    waypoints: [[120.50, 21.50], [121.00, 21.50]],
  }),
  mkUnit("RED-J16-02", "red", "fighter", "J16-02", "殲-16 攻擊", 119.50, 21.00, {
    speedKnots: 650,
    waypoints: [[120.50, 21.00], [121.00, 21.00]],
  }),

  // 1 紅方雷達（廣東沿海）
  mkUnit("RED-RAD-01", "red", "radar_station", "RAD-GD-S", "粵南雷達", 119.50, 22.00),
];

const NEUTRAL_UNITS: Unit[] = [
  mkUnit("NEU-SH-01", "neutral", "ship_surface", "MV-CMA", "CMA CGM 貨櫃船", 120.50, 21.80, {
    speedKnots: 16, waypoints: [[121.50, 21.50], [122.00, 21.30]],
  }),
  mkUnit("NEU-SH-02", "neutral", "ship_surface", "MV-EVER", "長榮貨櫃", 122.00, 21.00, {
    speedKnots: 18, waypoints: [[121.50, 21.30], [120.80, 21.70]],
  }),
];

export const BASHI_BLOCKADE_2030: Scenario = {
  id: "bashi_blockade_2030",
  displayName: "巴士海峽封鎖 2030",
  briefing: {
    zh: "解放軍試圖封鎖巴士海峽切斷台灣海運線。美軍 SSN + DDG 自菲律賓海進入支援，ROC 南部沿岸 SAM 守備。重點：水下對抗 + 隘口控制。",
    en: "PLA attempts to blockade the Bashi Channel and cut Taiwan's maritime SLOC. US SSN + DDG enter from the Philippine Sea in support; ROC south-coast SAMs hold defense. Focus: subsurface combat + choke-point control.",
  },
  startSimTimeSec: 0,
  durationSec: 2400,
  sides: SIDES,
  units: [...BLUE_UNITS, ...US_UNITS, ...RED_UNITS, ...NEUTRAL_UNITS],
  pendingCommands: [],
  camera: {
    center: [121.00, 21.50],
    zoom: 8.0,
    pitch: 38,
    bearing: 0,
  },
  victoryConditions: [
    // 紅方持續封鎖海峽中段 15 分鐘 = 紅方勝
    {
      kind: "hold_area",
      centerLngLat: [121.00, 21.20],   // 巴士海峽中段
      radiusKm: 40,
      sideId: "red",
      forSec: 900,    // 15 分鐘 sim
      label: "紅方封鎖 — 控制巴士海峽中段 15 分鐘",
    },
    // 聯軍殲滅紅方水面艦 = 聯軍勝
    {
      kind: "eliminate_side",
      targetSideId: "red",
      sideId: "blue",
      label: "聯軍 — 殲滅紅方所有兵力",
    },
    { kind: "time_limit", label: "時限結束比殘存戰力" },
  ],
};
