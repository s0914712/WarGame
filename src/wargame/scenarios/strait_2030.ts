/**
 * 範例場景 — 台海中線對峙 2030
 *
 * 用 .ts 而非 .json：可以直接 import UNIT_CATALOG 帶入 defaultCore，
 * 不必在 JSON 重複寫一遍。
 */
import type { Scenario, Side, Unit } from "../types";
import { UNIT_CATALOG } from "../catalog/units";

const SIDES: Side[] = [
  {
    id: "blue",
    displayName: "中華民國國軍",
    colorPrimary: "#3B82F6",
    colorSecondary: "#93C5FD",
    isPlayer: true,
    ownership: "human",        // 預設玩家操控
    isHostileTo: ["red"],
  },
  {
    id: "red",
    displayName: "解放軍",
    colorPrimary: "#EF4444",
    colorSecondary: "#FCA5A5",
    isPlayer: false,
    ownership: "scripted",     // Phase 7a 階段預設腳本；7b 可切 ai
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
  lng: number,
  lat: number,
  opts: {
    headingDeg?: number;
    speedKnots?: number;
    waypoints?: [number, number][];
    /** 隱蔽係數 0..0.95；潛艦預設 0.7、戰機預設 0 */
    stealth?: number;
  } = {},
): Unit {
  const cat = UNIT_CATALOG[kind];
  const core = { ...cat.defaultCore };
  if (opts.speedKnots !== undefined) core.speedKnots = opts.speedKnots;

  const extensions: Unit["extensions"] = {};
  if (opts.stealth !== undefined) extensions.stealth = opts.stealth;

  return {
    id,
    sideId,
    kind,
    callsign,
    displayName,
    position: {
      lng,
      lat,
      altMeters: cat.defaultAltitudeM,
      headingDeg: opts.headingDeg ?? 0,
      speedKnots: opts.speedKnots ?? 0,
    },
    waypoints: opts.waypoints ?? [],
    core,
    extensions,
    distanceTravelledKm: 0,
    hpCurrent: core.hpMax,
    ammoMax: cat.defaultAmmoMax,
    ammoCurrent: cat.defaultAmmoMax,
    detectedBy: {},
    lastTickSimSec: 0,
  };
}

// ── 藍方：5 飛彈車 + 5 無人機 + 5 船艦 ──
const BLUE_UNITS: Unit[] = [
  // 5 飛彈發射車（西部沿海）
  mkUnit("BLUE-ML-01", "blue", "missile_launcher", "雄三-01", "雄三反艦飛彈車 1", 120.20, 22.95),
  mkUnit("BLUE-ML-02", "blue", "missile_launcher", "雄三-02", "雄三反艦飛彈車 2", 120.18, 23.30),
  mkUnit("BLUE-ML-03", "blue", "missile_launcher", "雄三-03", "雄三反艦飛彈車 3", 120.50, 24.20),
  mkUnit("BLUE-ML-04", "blue", "missile_launcher", "雄二-01", "雄二岸基發射車", 121.45, 25.13),
  mkUnit("BLUE-ML-05", "blue", "missile_launcher", "雄三-04", "雄三反艦飛彈車 4", 121.74, 24.74),

  // 5 無人機（沿海巡邏 — 都有 waypoint，會自動巡曳）
  mkUnit("BLUE-DR-01", "blue", "drone", "騰雲-01", "騰雲偵察無人機 1", 120.30, 23.50, {
    speedKnots: 180,
    waypoints: [[119.90, 23.50], [120.30, 23.50], [120.30, 24.00], [119.90, 24.00], [119.90, 23.50]],
  }),
  mkUnit("BLUE-DR-02", "blue", "drone", "騰雲-02", "騰雲偵察無人機 2", 120.50, 24.00, {
    speedKnots: 180,
    waypoints: [[120.10, 24.00], [120.50, 24.00], [120.50, 24.50], [120.10, 24.50], [120.10, 24.00]],
  }),
  mkUnit("BLUE-DR-03", "blue", "drone", "騰雲-03", "騰雲偵察無人機 3", 120.70, 24.50, {
    speedKnots: 180,
    waypoints: [[120.30, 24.50], [120.70, 24.50], [120.70, 25.00], [120.30, 25.00], [120.30, 24.50]],
  }),
  mkUnit("BLUE-DR-04", "blue", "drone", "銳鳶-01", "銳鳶 II 偵察機 1", 121.20, 25.10, { speedKnots: 200 }),
  mkUnit("BLUE-DR-05", "blue", "drone", "銳鳶-02", "銳鳶 II 偵察機 2", 121.80, 24.20, { speedKnots: 200 }),

  // 5 船艦（藍方艦隊向中線推進）
  mkUnit("BLUE-SH-01", "blue", "ship_surface", "DDG-1801", "紀德級 - 基隆", 121.75, 25.15, {
    speedKnots: 18,
    waypoints: [[121.40, 25.30], [121.00, 25.20], [120.70, 25.00]],
  }),
  mkUnit("BLUE-SH-02", "blue", "ship_surface", "DDG-1803", "紀德級 - 蘇澳", 121.85, 24.60, {
    speedKnots: 18,
    waypoints: [[121.50, 24.40], [121.10, 24.30]],
  }),
  mkUnit("BLUE-SH-03", "blue", "ship_surface", "FFG-1108", "成功級 - 馬公", 119.60, 23.60, {
    speedKnots: 20,
    waypoints: [[119.80, 23.80], [120.10, 24.00]],
  }),
  mkUnit("BLUE-SH-04", "blue", "ship_surface", "PFG-1207", "康定級 - 左營", 120.25, 22.55, {
    speedKnots: 20,
    waypoints: [[119.90, 22.80], [119.70, 23.20]],
  }),
  mkUnit("BLUE-SH-05", "blue", "ship_surface", "PG-3804", "光華六號", 120.55, 24.10, { speedKnots: 25 }),

  // ── 2 雷達站（ISR 核心：樂山 + 大漢山，覆蓋整個海峽）──
  mkUnit("BLUE-RAD-01", "blue", "radar_station", "PAVE PAWS", "樂山雷達站", 121.42, 24.81),
  mkUnit("BLUE-RAD-02", "blue", "radar_station", "DHS-01",     "大漢山雷達", 120.83, 22.61),

  // ── 2 戰機（IDF / F-16，CAP over Taiwan）──
  mkUnit("BLUE-FT-01", "blue", "fighter", "IDF-01", "經國號 CAP-01", 120.50, 23.60, {
    speedKnots: 450,
    waypoints: [[120.10, 23.60], [120.10, 24.20], [120.50, 24.20], [120.50, 23.60]],
  }),
  mkUnit("BLUE-FT-02", "blue", "fighter", "F16V-01", "F-16V CAP-02", 121.20, 24.80, {
    speedKnots: 500,
    waypoints: [[120.70, 24.80], [120.70, 25.20], [121.20, 25.20], [121.20, 24.80]],
  }),

  // ── 2 潛艦（高 stealth；劍龍級 + 新型潛艦）──
  mkUnit("BLUE-SUB-01", "blue", "submarine", "SS-793", "海龍 (劍龍級)", 121.95, 24.20, {
    speedKnots: 8,
    stealth: 0.7,
    waypoints: [[121.70, 24.20], [121.40, 24.00]],
  }),
  mkUnit("BLUE-SUB-02", "blue", "submarine", "IDS-001", "海鯤 (IDS)", 120.10, 22.30, {
    speedKnots: 10,
    stealth: 0.75,
    waypoints: [[119.80, 22.60], [119.50, 23.00]],
  }),

  // ── 海岸 SAM 車（天弓 II / 海弓 III）— 沿岸機動防空 ──
  mkUnit("BLUE-SAM-01", "blue", "sam_coastal", "TC2N-T1", "天弓 II - 台北", 121.50, 25.05),
  mkUnit("BLUE-SAM-02", "blue", "sam_coastal", "TC2N-T2", "天弓 II - 台中", 120.65, 24.15),
  mkUnit("BLUE-SAM-03", "blue", "sam_coastal", "TC2N-K3", "海弓 III - 高雄", 120.30, 22.65),

  // ── Patriot PAC-3 重型 SAM ──
  mkUnit("BLUE-PAC-01", "blue", "sam_patriot", "PAC3-N1", "愛國者 PAC-3 - 桃園", 121.20, 25.00),
  mkUnit("BLUE-PAC-02", "blue", "sam_patriot", "PAC3-S1", "愛國者 PAC-3 - 台南", 120.20, 23.00),

  // ── 機動雷達車 — 中部填補空隙（樂山以南） ──
  mkUnit("BLUE-MRD-01", "blue", "mobile_radar", "YLC-T1", "機動雷達 - 苗栗", 120.80, 24.50),
  mkUnit("BLUE-MRD-02", "blue", "mobile_radar", "YLC-T2", "機動雷達 - 嘉義", 120.45, 23.50),

  // ── 4 空軍基地（戰機 RTB 目標）──
  mkUnit("BLUE-AB-01", "blue", "airbase", "AB-SS",  "松山機場", 121.55, 25.07),
  mkUnit("BLUE-AB-02", "blue", "airbase", "AB-CCK", "清泉崗基地", 120.62, 24.27),
  mkUnit("BLUE-AB-03", "blue", "airbase", "AB-CYI", "嘉義基地", 120.39, 23.46),
  mkUnit("BLUE-AB-04", "blue", "airbase", "AB-HLN", "花蓮基地", 121.61, 24.02),
];

// ── 紅方：海空遠程向中線逼近 ──
const RED_UNITS: Unit[] = [
  mkUnit("RED-ML-01", "red", "missile_launcher", "DF-17-01", "東風 17-01", 118.10, 24.50),
  mkUnit("RED-ML-02", "red", "missile_launcher", "DF-17-02", "東風 17-02", 117.90, 23.50),

  // 翼龍無人機朝東逼近台灣海岸
  mkUnit("RED-DR-01", "red", "drone", "WL-10-01", "翼龍 10 偵察", 119.40, 24.20, {
    speedKnots: 220,
    waypoints: [[120.20, 24.20], [120.80, 24.20]],
  }),
  mkUnit("RED-DR-02", "red", "drone", "WL-10-02", "翼龍 10 偵察", 119.20, 23.40, {
    speedKnots: 220,
    waypoints: [[120.00, 23.40], [120.60, 23.40]],
  }),
  mkUnit("RED-DR-03", "red", "drone", "WL-10-03", "翼龍 10 偵察", 119.60, 24.80, {
    speedKnots: 220,
    waypoints: [[120.40, 24.80], [121.00, 24.80]],
  }),

  // 紅方艦隊向中線推進
  mkUnit("RED-SH-01", "red", "ship_surface", "052D-101", "055 型驅逐艦", 119.50, 24.00, {
    speedKnots: 22,
    waypoints: [[120.00, 24.00], [120.40, 24.00]],
  }),
  mkUnit("RED-SH-02", "red", "ship_surface", "054A-579", "054A 型護衛艦", 119.30, 23.60, {
    speedKnots: 22,
    waypoints: [[119.80, 23.60], [120.20, 23.60]],
  }),
  mkUnit("RED-SH-03", "red", "ship_surface", "055-103", "055 型驅逐艦", 119.40, 24.50, {
    speedKnots: 22,
    waypoints: [[119.90, 24.50], [120.40, 24.50]],
  }),

  // ── 紅方雷達 + 戰機 + 潛艦 ──
  mkUnit("RED-RAD-01", "red", "radar_station", "FJ-RAD-01", "福建雷達站", 118.40, 24.50),

  mkUnit("RED-FT-01", "red", "fighter", "J20-01", "殲-20", 118.90, 24.00, {
    speedKnots: 600,
    waypoints: [[119.50, 24.10], [120.10, 24.20]],
  }),

  mkUnit("RED-SUB-01", "red", "submarine", "041-101", "元級 041 潛艦", 118.80, 23.20, {
    speedKnots: 12,
    stealth: 0.75,
    waypoints: [[119.50, 23.20], [120.20, 23.20]],
  }),

  // 紅方 2 空軍基地（J-20 RTB）
  mkUnit("RED-AB-01", "red", "airbase", "AB-FZ",  "福州機場", 119.31, 26.07),
  mkUnit("RED-AB-02", "red", "airbase", "AB-XM",  "廈門機場", 118.13, 24.54),
];

// ── 中立：商船 ──
const NEUTRAL_UNITS: Unit[] = [
  mkUnit("NEU-SH-01", "neutral", "ship_surface", "MV-EVER01", "長榮貨櫃 EVER GIVEN", 121.20, 23.50, {
    speedKnots: 16,
    waypoints: [[121.20, 22.50], [121.20, 21.50]],
  }),
  mkUnit("NEU-SH-02", "neutral", "ship_surface", "MV-OOCL", "OOCL 貨櫃", 121.40, 24.80, {
    speedKnots: 14,
    waypoints: [[121.40, 25.50]],
  }),
];

export const STRAIT_2030: Scenario = {
  id: "strait_2030",
  displayName: "台海中線對峙 2030",
  briefing: "解放軍海空兵力越過中線，藍方反艦飛彈車與海軍進入備戰。",
  startSimTimeSec: 0,
  durationSec: 3600,
  sides: SIDES,
  units: [...BLUE_UNITS, ...RED_UNITS, ...NEUTRAL_UNITS],
  pendingCommands: [],
  camera: {
    center: [120.5, 24.0],
    zoom: 6.8,
    pitch: 35,
    bearing: 0,
  },
  victoryConditions: [
    { kind: "eliminate_side", targetSideId: "red", sideId: "blue", label: "藍方殲滅紅方艦隊" },
    { kind: "eliminate_side", targetSideId: "blue", sideId: "red", label: "紅方殲滅藍方艦隊" },
    { kind: "time_limit", label: "時限結束比殘存戰力" },
  ],
};
