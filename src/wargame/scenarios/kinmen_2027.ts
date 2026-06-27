/**
 * 場景：金門島嶼防衛戰 2027
 *
 * 設定：紅方對金門發動兩棲威懾。藍方守備兵力含岸基反艦、巡邏艇、雷達。
 * 範圍小、節奏快、近距離接戰（紅藍兵力 ~50 km 距離開戰）。
 */
import type { Scenario, Side, Unit } from "../types";
import { UNIT_CATALOG } from "../catalog/units";

const SIDES: Side[] = [
  {
    id: "blue",
    displayName: "金門守備部隊",
    colorPrimary: "#3B82F6",
    colorSecondary: "#93C5FD",
    isPlayer: true,
    ownership: "human",
    isHostileTo: ["red"],
  },
  {
    id: "red",
    displayName: "解放軍",
    colorPrimary: "#EF4444",
    colorSecondary: "#FCA5A5",
    isPlayer: false,
    ownership: "scripted",
    isHostileTo: ["blue"],
  },
  {
    id: "neutral",
    displayName: "民用",
    colorPrimary: "#9CA3AF",
    colorSecondary: "#D1D5DB",
    isPlayer: false,
    ownership: "scripted",
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
  // 4 雄三 ASM 部署於金門島
  mkUnit("BLUE-ML-01", "blue", "missile_launcher", "雄三-K1", "雄三車載 1（料羅灣）",      118.43, 24.42),
  mkUnit("BLUE-ML-02", "blue", "missile_launcher", "雄三-K2", "雄三車載 2（金沙）",        118.46, 24.49),
  mkUnit("BLUE-ML-03", "blue", "missile_launcher", "雄三-K3", "雄三車載 3（瓊林）",        118.39, 24.45),
  mkUnit("BLUE-ML-04", "blue", "missile_launcher", "雄三-K4", "雄三車載 4（古崗）",        118.31, 24.40),

  // 2 巡邏艇 守料羅灣海域
  mkUnit("BLUE-SH-01", "blue", "ship_surface", "PG-K01", "錦江級巡邏艇 1", 118.50, 24.40, {
    speedKnots: 22,
    waypoints: [[118.55, 24.45], [118.55, 24.35], [118.50, 24.40]],
  }),
  mkUnit("BLUE-SH-02", "blue", "ship_surface", "PG-K02", "錦江級巡邏艇 2", 118.42, 24.35, {
    speedKnots: 22,
    waypoints: [[118.38, 24.30], [118.42, 24.35]],
  }),

  // 1 雷達站
  mkUnit("BLUE-RAD-01", "blue", "radar_station", "RAD-K01", "太武山雷達", 118.40, 24.43),

  // 1 UAV 偵察
  mkUnit("BLUE-DR-01", "blue", "drone", "騰雲-K1", "騰雲 UAV", 118.45, 24.45, {
    speedKnots: 180,
    waypoints: [[118.35, 24.50], [118.25, 24.45], [118.30, 24.40], [118.40, 24.45]],
  }),
];

const RED_UNITS: Unit[] = [
  // 3 兩棲艦群從廈門方向接近
  mkUnit("RED-SH-01", "red", "ship_surface", "071-101", "船塢登陸艦 1", 118.10, 24.45, {
    speedKnots: 20,
    waypoints: [[118.25, 24.45], [118.35, 24.45]],
  }),
  mkUnit("RED-SH-02", "red", "ship_surface", "054A-201", "054A 護衛艦", 118.05, 24.50, {
    speedKnots: 22,
    waypoints: [[118.20, 24.50], [118.32, 24.48]],
  }),
  mkUnit("RED-SH-03", "red", "ship_surface", "056A-301", "056A 輕護艦", 118.08, 24.38, {
    speedKnots: 22,
    waypoints: [[118.22, 24.38], [118.35, 24.40]],
  }),

  // 2 翼龍 UAV
  mkUnit("RED-DR-01", "red", "drone", "WL-01", "翼龍偵察", 118.00, 24.42, {
    speedKnots: 200,
    waypoints: [[118.30, 24.42], [118.50, 24.42]],
  }),
  mkUnit("RED-DR-02", "red", "drone", "WL-02", "翼龍偵察", 118.00, 24.48, {
    speedKnots: 200,
    waypoints: [[118.30, 24.48], [118.50, 24.48]],
  }),

  // 1 紅方雷達於廈門
  mkUnit("RED-RAD-01", "red", "radar_station", "RAD-FJ01", "廈門前線雷達", 118.10, 24.48),
];

const NEUTRAL_UNITS: Unit[] = [
  mkUnit("NEU-SH-01", "neutral", "ship_surface", "MV-NEU01", "民用漁船", 118.55, 24.38, {
    speedKnots: 8,
    waypoints: [[118.60, 24.35]],
  }),
];

export const KINMEN_2027: Scenario = {
  id: "kinmen_2027",
  displayName: "金門離島防衛 2027",
  briefing: {
    zh: "紅方兩棲艦群自廈門方向接近金門，藍方守備兵力進入備戰狀態。距離極近，戰況短促。",
    en: "Red amphibious group approaches Kinmen from Xiamen. ROC garrison goes to combat readiness. Very close range — fast, sharp engagement.",
  },
  startSimTimeSec: 0,
  durationSec: 1800,
  sides: SIDES,
  units: [...BLUE_UNITS, ...RED_UNITS, ...NEUTRAL_UNITS],
  pendingCommands: [],
  camera: {
    center: [118.32, 24.43],
    zoom: 10.2,
    pitch: 40,
    bearing: 0,
  },
  victoryConditions: [
    // 紅方任一兩棲艦登陸金門海岸 = 紅方勝；藍方阻止 30 分鐘 = 藍方勝
    {
      kind: "hold_area",
      centerLngLat: [118.42, 24.44],   // 料羅灣外海
      radiusKm: 8,
      sideId: "red",
      forSec: 600,     // 10 分鐘 sim
      label: "紅方登陸 — 兩棲艦控制料羅灣外海 10 分鐘",
    },
    { kind: "eliminate_side", targetSideId: "red", sideId: "blue", label: "藍方擊退所有紅方兵力" },
    { kind: "eliminate_side", targetSideId: "blue", sideId: "red", label: "紅方殲滅藍方守備" },
    { kind: "time_limit", label: "時限結束比殘存戰力" },
  ],
};
