/**
 * 場景：東沙島空襲 2028
 *
 * 設定：紅方戰機編隊對東沙進行空中威懾 / 空襲。藍方守備兵力少，靠雷達 + SAM + 戰機馳援。
 * 重點：純空戰節奏，距離 ~200 km 開戰，戰機高速逼近、SAM 反擊。
 */
import type { Scenario, Side, Unit } from "../types";
import { UNIT_CATALOG } from "../catalog/units";

const SIDES: Side[] = [
  {
    id: "blue", displayName: "中華民國國軍",
    colorPrimary: "#3B82F6", colorSecondary: "#93C5FD",
    isPlayer: true, ownership: "human", isHostileTo: ["red"],
  },
  {
    id: "red", displayName: "解放軍空軍",
    colorPrimary: "#EF4444", colorSecondary: "#FCA5A5",
    isPlayer: false, ownership: "scripted", isHostileTo: ["blue"],
  },
  {
    id: "neutral", displayName: "民用",
    colorPrimary: "#9CA3AF", colorSecondary: "#D1D5DB",
    isPlayer: false, ownership: "scripted", isHostileTo: [],
  },
];

function mkUnit(
  id: string,
  sideId: Unit["sideId"],
  kind: Unit["kind"],
  callsign: string,
  displayName: string,
  lng: number, lat: number,
  opts: { speedKnots?: number; waypoints?: [number, number][]; stealth?: number } = {},
): Unit {
  const cat = UNIT_CATALOG[kind];
  const core = { ...cat.defaultCore };
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

const BLUE_UNITS: Unit[] = [
  // 東沙島守備（位置 ~116.72°E, 20.71°N）
  mkUnit("BLUE-RAD-01", "blue", "radar_station", "RAD-PR01", "東沙島雷達", 116.72, 20.71),

  // 2 SAM（陸基地對空，視為飛彈車）
  mkUnit("BLUE-ML-01", "blue", "missile_launcher", "天弓-P1", "天弓 III SAM 1", 116.71, 20.70),
  mkUnit("BLUE-ML-02", "blue", "missile_launcher", "天弓-P2", "天弓 III SAM 2", 116.73, 20.72),

  // 2 戰機 CAP 巡邏（從台灣本島調來）
  mkUnit("BLUE-FT-01", "blue", "fighter", "F16V-PR1", "F-16V 增援 1", 117.50, 21.20, {
    speedKnots: 600,
    waypoints: [[117.00, 20.90], [116.80, 20.75], [117.30, 20.95]],
  }),
  mkUnit("BLUE-FT-02", "blue", "fighter", "IDF-PR1", "經國號增援 2", 117.40, 21.30, {
    speedKnots: 550,
    waypoints: [[116.90, 20.85], [117.10, 21.00]],
  }),

  // 1 巡防艦（在東沙南方海域）
  mkUnit("BLUE-SH-01", "blue", "ship_surface", "FFG-PR1", "成功級 - 東沙巡防", 116.70, 20.55, {
    speedKnots: 18,
  }),
];

const RED_UNITS: Unit[] = [
  // 4 戰機編隊從西南方向（海南方向）接近
  mkUnit("RED-FT-01", "red", "fighter", "J20-PR1", "殲-20 領隊", 115.50, 20.30, {
    speedKnots: 700,
    waypoints: [[116.30, 20.55], [116.65, 20.70]],
  }),
  mkUnit("RED-FT-02", "red", "fighter", "J20-PR2", "殲-20 僚機", 115.50, 20.25, {
    speedKnots: 700,
    waypoints: [[116.30, 20.50], [116.65, 20.70]],
  }),
  mkUnit("RED-FT-03", "red", "fighter", "J16-PR1", "殲-16 攻擊機 1", 115.60, 20.40, {
    speedKnots: 650,
    waypoints: [[116.30, 20.60], [116.65, 20.75]],
  }),
  mkUnit("RED-FT-04", "red", "fighter", "J16-PR2", "殲-16 攻擊機 2", 115.60, 20.50, {
    speedKnots: 650,
    waypoints: [[116.30, 20.65], [116.70, 20.72]],
  }),

  // 1 UAV ISR 先導
  mkUnit("RED-DR-01", "red", "drone", "WZ-7", "翔龍 ISR", 115.80, 20.60, {
    speedKnots: 320,
    waypoints: [[116.40, 20.70], [116.65, 20.72]],
  }),

  // 1 預警機（無人機代替）
  mkUnit("RED-DR-02", "red", "drone", "KJ-500-AWACS", "空警 500 AWACS", 115.20, 20.45, {
    speedKnots: 280,
    waypoints: [[115.80, 20.45]],   // 後方盤旋
  }),
];

const NEUTRAL_UNITS: Unit[] = [
  mkUnit("NEU-SH-01", "neutral", "ship_surface", "MV-CNT1", "貨櫃船", 117.20, 20.30, {
    speedKnots: 15,
    waypoints: [[118.00, 20.10]],
  }),
];

export const PRATAS_AIR_RAID: Scenario = {
  id: "pratas_air_raid",
  displayName: "東沙空襲 2028",
  briefing: "紅方戰機編隊從海南方向接近東沙。藍方守備兵力少，正從台灣本島派 F-16V / IDF 增援。",
  startSimTimeSec: 0,
  durationSec: 1800,
  sides: SIDES,
  units: [...BLUE_UNITS, ...RED_UNITS, ...NEUTRAL_UNITS],
  pendingCommands: [],
  camera: {
    center: [116.50, 20.70],
    zoom: 8.5,
    pitch: 35,
    bearing: 0,
  },
  victoryConditions: [
    // 紅方擊毀東沙雷達 = 紅方勝（核心目標）
    {
      kind: "destroy_unit",
      unitId: "BLUE-RAD-01",
      sideId: "red",
      label: "紅方目標 — 摧毀東沙雷達站",
    },
    // 藍方在 30 分鐘內守住雷達 = 藍方勝
    {
      kind: "preserve_unit",
      unitId: "BLUE-RAD-01",
      sideId: "blue",
      label: "藍方 — 保住東沙雷達直到時限結束",
    },
  ],
};
