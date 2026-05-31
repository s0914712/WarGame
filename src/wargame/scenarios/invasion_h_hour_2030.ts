/**
 * 場景：H 時 — 共軍登島作戰 2030
 *
 * 高難度全面入侵情境。紅方總兵力 ~38 單位（含 13 兩棲艦 + 護衛艦群 + 戰機 + 彈道飛彈），
 * 藍方 ~40 單位（含 4 機場 / 3 Patriot / 6 雄三 / 全艦隊），美軍 4 單位有限介入。
 *
 * 紅方戰略目標：3 個兩棲艦群分別在台中、台南、桃園外海登陸 → hold_area
 * 藍方戰略目標：殲滅紅方兩棲艦群（075/071/072）阻止登陸 → 任一艦隊全滅 = 勝
 *
 * 戰術設計：
 *   - 紅方 4 個 DF-26 在開戰 ~5 min 內試圖打掉 PAC-3 / 樂山雷達（壓制 BMD）
 *   - 紅方 8 J-20 突防爭取制空，4 J-16 對陸地目標 SEAD
 *   - 紅方 3 SSN 從南北包夾藍方艦隊
 *   - 藍方海軍向中線推進反艦戰 + 雄三飽和射擊
 *   - 美軍 2 DDG（Aegis BMD）+ 1 SSN 從東部進入支援
 *
 * 預期時長：60+ 分鐘。建議速率 30×。
 */
import type { Scenario, Side, Unit } from "../types";
import { UNIT_CATALOG } from "../catalog/units";
import { SIDE_COLORS } from "../symbology/sideColors";

const SIDES: Side[] = [
  { id: "blue",    displayName: "中華民國國軍",
    colorPrimary: SIDE_COLORS.blue.primary, colorSecondary: SIDE_COLORS.blue.secondary,
    isPlayer: true, ownership: "human", isHostileTo: ["red"] },
  { id: "us",      displayName: "美國海軍 (USN)",
    colorPrimary: SIDE_COLORS.us.primary, colorSecondary: SIDE_COLORS.us.secondary,
    isPlayer: false, ownership: "scripted", isHostileTo: ["red"] },
  { id: "red",     displayName: "解放軍",
    colorPrimary: SIDE_COLORS.red.primary, colorSecondary: SIDE_COLORS.red.secondary,
    isPlayer: false, ownership: "scripted", isHostileTo: ["blue", "us"] },
  { id: "neutral", displayName: "民用",
    colorPrimary: SIDE_COLORS.neutral.primary, colorSecondary: SIDE_COLORS.neutral.secondary,
    isPlayer: false, ownership: "scripted", isHostileTo: [] },
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
    supplyOverride?: Unit["supplyOverride"];
  } = {},
): Unit {
  const cat = UNIT_CATALOG[kind];
  const core = { ...cat.defaultCore, ...(opts.coreOverride ?? {}) };
  if (opts.speedKnots !== undefined) core.speedKnots = opts.speedKnots;
  const extensions: Unit["extensions"] = {};
  if (opts.stealth !== undefined) extensions.stealth = opts.stealth;
  return {
    id, sideId, kind, callsign, displayName,
    position: { lng, lat, altMeters: cat.defaultAltitudeM, headingDeg: 0, speedKnots: opts.speedKnots ?? 0 },
    waypoints: opts.waypoints ?? [],
    core, extensions,
    distanceTravelledKm: 0,
    hpCurrent: core.hpMax,
    ammoMax: cat.defaultAmmoMax,
    ammoCurrent: cat.defaultAmmoMax,
    ...(opts.supplyOverride ? { supplyOverride: opts.supplyOverride } : {}),
    detectedBy: {},
    lastTickSimSec: 0,
  };
}

// ════════════════════════════════════════════════
// ROC 藍方 — 全面防禦
// ════════════════════════════════════════════════
const BLUE_UNITS: Unit[] = [
  // ── 戰略雷達 ──
  mkUnit("BLUE-RAD-LS", "blue", "radar_station", "PAVE PAWS", "樂山雷達", 121.42, 24.81),
  mkUnit("BLUE-RAD-DHS", "blue", "radar_station", "DHS-01", "大漢山雷達", 120.83, 22.61),
  mkUnit("BLUE-MRD-01", "blue", "mobile_radar", "YLC-T1", "機動雷達 - 苗栗", 120.80, 24.50),
  mkUnit("BLUE-MRD-02", "blue", "mobile_radar", "YLC-T2", "機動雷達 - 嘉義", 120.45, 23.50),

  // ── 4 機場（戰機 RTB）──
  mkUnit("BLUE-AB-SS", "blue", "airbase", "AB-SS", "松山機場", 121.55, 25.07),
  mkUnit("BLUE-AB-CCK", "blue", "airbase", "AB-CCK", "清泉崗基地", 120.62, 24.27),
  mkUnit("BLUE-AB-CYI", "blue", "airbase", "AB-CYI", "嘉義基地", 120.39, 23.46),
  mkUnit("BLUE-AB-HLN", "blue", "airbase", "AB-HLN", "花蓮基地", 121.61, 24.02),

  // ── 3 Patriot PAC-3（戰略防空）──
  mkUnit("BLUE-PAC-01", "blue", "sam_patriot", "PAC3-N1", "PAC-3 - 桃園", 121.20, 25.00),
  mkUnit("BLUE-PAC-02", "blue", "sam_patriot", "PAC3-C1", "PAC-3 - 台中", 120.65, 24.20),
  mkUnit("BLUE-PAC-03", "blue", "sam_patriot", "PAC3-S1", "PAC-3 - 台南", 120.20, 23.00),

  // ── 4 海岸 SAM（沿岸防空）──
  mkUnit("BLUE-SAM-01", "blue", "sam_coastal", "TC2N-N", "天弓 II - 基隆", 121.74, 25.13),
  mkUnit("BLUE-SAM-02", "blue", "sam_coastal", "TC2N-M", "天弓 II - 苗栗外海", 120.72, 24.50),
  mkUnit("BLUE-SAM-03", "blue", "sam_coastal", "TC2N-J", "天弓 II - 嘉義外海", 120.30, 23.50),
  mkUnit("BLUE-SAM-04", "blue", "sam_coastal", "TC2N-K", "天弓 II - 高雄", 120.30, 22.65),

  // ── 6 雄三 ASM 飛彈車（沿岸反艦）──
  mkUnit("BLUE-ML-01", "blue", "missile_launcher", "雄三-N1", "雄三 - 桃園", 121.10, 25.05),
  mkUnit("BLUE-ML-02", "blue", "missile_launcher", "雄三-C1", "雄三 - 苗栗", 120.75, 24.55),
  mkUnit("BLUE-ML-03", "blue", "missile_launcher", "雄三-C2", "雄三 - 台中", 120.55, 24.15),
  mkUnit("BLUE-ML-04", "blue", "missile_launcher", "雄三-W1", "雄三 - 雲林", 120.30, 23.75),
  mkUnit("BLUE-ML-05", "blue", "missile_launcher", "雄三-S1", "雄三 - 嘉義", 120.25, 23.45),
  mkUnit("BLUE-ML-06", "blue", "missile_launcher", "雄三-S2", "雄三 - 台南", 120.10, 23.05),

  // ── 6 水面艦 ──
  mkUnit("BLUE-SH-01", "blue", "ship_surface", "DDG-1801", "紀德級 - 基隆", 121.75, 25.15, {
    speedKnots: 22, waypoints: [[121.40, 25.20], [121.00, 25.10], [120.60, 25.00]],
  }),
  mkUnit("BLUE-SH-02", "blue", "ship_surface", "DDG-1803", "紀德級 - 蘇澳", 121.95, 24.50, {
    speedKnots: 22, waypoints: [[121.50, 24.40], [121.00, 24.30]],
  }),
  mkUnit("BLUE-SH-03", "blue", "ship_surface", "FFG-1108", "成功級 1", 119.60, 23.60, {
    speedKnots: 20, waypoints: [[119.90, 23.70], [120.20, 23.80]],
  }),
  mkUnit("BLUE-SH-04", "blue", "ship_surface", "FFG-1109", "成功級 2", 120.40, 22.80, {
    speedKnots: 20, waypoints: [[120.20, 23.00], [120.10, 23.20]],
  }),
  mkUnit("BLUE-SH-05", "blue", "ship_surface", "PFG-1207", "康定級", 120.10, 22.60, {
    speedKnots: 22, waypoints: [[119.90, 22.80], [119.70, 23.10]],
  }),
  mkUnit("BLUE-SH-06", "blue", "ship_surface", "PG-3804", "光華六號", 120.55, 24.10, {
    speedKnots: 28, waypoints: [[120.30, 24.10], [120.10, 24.20]],
  }),

  // ── 2 潛艦 ──
  mkUnit("BLUE-SUB-01", "blue", "submarine", "SS-793", "海龍劍龍級", 121.95, 24.20, {
    speedKnots: 10, stealth: 0.7,
    waypoints: [[121.50, 24.00], [121.00, 23.80], [120.50, 23.50]],
  }),
  mkUnit("BLUE-SUB-02", "blue", "submarine", "IDS-001", "海鯤 IDS", 120.10, 22.30, {
    speedKnots: 12, stealth: 0.75,
    waypoints: [[119.80, 22.60], [119.50, 23.00], [119.30, 23.40]],
  }),

  // ── 4 戰機（CAP，會自動 RTB） ──
  mkUnit("BLUE-FT-01", "blue", "fighter", "F16V-N1", "F-16V CAP-1", 121.20, 25.05, {
    speedKnots: 500,
    waypoints: [[121.00, 25.20], [120.70, 25.20], [120.70, 25.00], [121.00, 25.00], [121.20, 25.05]],
  }),
  mkUnit("BLUE-FT-02", "blue", "fighter", "F16V-C1", "F-16V CAP-2", 120.60, 24.30, {
    speedKnots: 500,
    waypoints: [[120.40, 24.40], [120.20, 24.40], [120.20, 24.20], [120.40, 24.20], [120.60, 24.30]],
  }),
  mkUnit("BLUE-FT-03", "blue", "fighter", "IDF-C1", "經國號 CAP-3", 120.40, 23.50, {
    speedKnots: 460,
    waypoints: [[120.20, 23.60], [120.00, 23.60], [120.00, 23.40], [120.20, 23.40], [120.40, 23.50]],
  }),
  mkUnit("BLUE-FT-04", "blue", "fighter", "IDF-S1", "經國號 CAP-4", 120.20, 23.00, {
    speedKnots: 460,
    waypoints: [[120.00, 23.10], [119.90, 22.90], [120.10, 22.90], [120.20, 23.00]],
  }),

  // ── 1 補給艦（東部安全水域）──
  mkUnit("BLUE-AO-01", "blue", "supply_ship", "AOE-530", "武夷油彈船", 121.85, 24.40, {
    speedKnots: 12,
    coreOverride: { hpMax: 500 },
    waypoints: [[121.90, 24.30], [121.80, 24.50], [121.85, 24.40]],
  }),
];

// ════════════════════════════════════════════════
// USN — 有限介入（東部水域）
// ════════════════════════════════════════════════
const US_UNITS: Unit[] = [
  mkUnit("US-DDG-89", "us", "ship_surface", "DDG-89", "USS Mustin", 122.80, 24.20, {
    speedKnots: 28,
    coreOverride: { rangeKm: 200, detectionRangeKm: 350, hpMax: 400 },
    waypoints: [[122.40, 24.00], [122.00, 23.80]],
  }),
  mkUnit("US-DDG-110", "us", "ship_surface", "DDG-110", "USS William P. Lawrence", 123.00, 23.60, {
    speedKnots: 28,
    coreOverride: { rangeKm: 200, detectionRangeKm: 350, hpMax: 400 },
    waypoints: [[122.50, 23.40], [122.00, 23.20]],
  }),
  // 美軍核潛獵殺紅潛艦
  mkUnit("US-SSN-21", "us", "submarine", "SSN-21", "USS Seawolf", 122.50, 23.40, {
    speedKnots: 22, stealth: 0.85,
    coreOverride: { rangeKm: 80, hpMax: 320 },
    waypoints: [[122.00, 23.20], [121.50, 23.00]],
  }),
  // P-8 反潛偵察
  mkUnit("US-P8-01", "us", "drone", "VP-9", "P-8A Poseidon", 122.50, 24.00, {
    speedKnots: 350,
    coreOverride: { detectionRangeKm: 400, hpMax: 100 },
    waypoints: [[121.80, 23.80], [121.20, 23.40], [121.80, 23.00]],
  }),
];

// ════════════════════════════════════════════════
// PLA 紅方 — 全面入侵
// ════════════════════════════════════════════════
const RED_UNITS: Unit[] = [
  // ── 戰略雷達 + 機場 ──
  mkUnit("RED-RAD-FJ", "red", "radar_station", "FJ-RAD", "福建戰區雷達", 118.40, 25.50),
  mkUnit("RED-AB-FZ", "red", "airbase", "AB-FZ", "福州機場", 119.31, 26.07),
  mkUnit("RED-AB-XM", "red", "airbase", "AB-XM", "廈門機場", 118.13, 24.54),
  mkUnit("RED-AB-LT", "red", "airbase", "AB-LT", "龍田基地", 117.10, 23.30),

  // ══════════ 兩棲艦群 A：北線（桃園外海登陸）══════════
  // 4 LHA + LPD + LST 編隊
  mkUnit("RED-LHA-A1", "red", "ship_surface", "075-A1", "075 兩棲攻擊艦 A1", 118.50, 25.10, {
    speedKnots: 18,
    coreOverride: { rangeKm: 100, hpMax: 700 },
    waypoints: [[119.50, 25.05], [120.30, 25.00], [120.80, 25.00]],
  }),
  mkUnit("RED-LPD-A2", "red", "ship_surface", "071-A2", "071 船塢登陸艦 A2", 118.40, 25.00, {
    speedKnots: 18,
    coreOverride: { rangeKm: 60, hpMax: 600 },
    waypoints: [[119.40, 25.00], [120.30, 24.95], [120.80, 24.95]],
  }),
  mkUnit("RED-LST-A3", "red", "ship_surface", "072-A3", "072 戰車登陸艦 A3", 118.35, 25.15, {
    speedKnots: 16,
    coreOverride: { rangeKm: 40, hpMax: 450 },
    waypoints: [[119.30, 25.10], [120.20, 25.05], [120.80, 25.05]],
  }),

  // ══════════ 兩棲艦群 B：中線（台中外海登陸）══════════
  mkUnit("RED-LHA-B1", "red", "ship_surface", "075-B1", "075 兩棲攻擊艦 B1", 118.50, 24.30, {
    speedKnots: 18,
    coreOverride: { rangeKm: 100, hpMax: 700 },
    waypoints: [[119.30, 24.30], [120.10, 24.25], [120.50, 24.20]],
  }),
  mkUnit("RED-LPD-B2", "red", "ship_surface", "071-B2", "071 船塢登陸艦 B2", 118.40, 24.20, {
    speedKnots: 18,
    coreOverride: { rangeKm: 60, hpMax: 600 },
    waypoints: [[119.20, 24.20], [120.00, 24.20], [120.50, 24.15]],
  }),
  mkUnit("RED-LST-B3", "red", "ship_surface", "072-B3", "072 戰車登陸艦 B3", 118.35, 24.40, {
    speedKnots: 16,
    coreOverride: { rangeKm: 40, hpMax: 450 },
    waypoints: [[119.20, 24.35], [120.00, 24.25], [120.50, 24.25]],
  }),
  mkUnit("RED-LST-B4", "red", "ship_surface", "072-B4", "072 戰車登陸艦 B4", 118.40, 24.15, {
    speedKnots: 16,
    coreOverride: { rangeKm: 40, hpMax: 450 },
    waypoints: [[119.25, 24.15], [120.05, 24.10], [120.50, 24.10]],
  }),

  // ══════════ 兩棲艦群 C：南線（台南外海登陸）══════════
  mkUnit("RED-LHA-C1", "red", "ship_surface", "075-C1", "075 兩棲攻擊艦 C1", 118.50, 23.20, {
    speedKnots: 18,
    coreOverride: { rangeKm: 100, hpMax: 700 },
    waypoints: [[119.30, 23.15], [120.00, 23.10], [120.30, 23.05]],
  }),
  mkUnit("RED-LPD-C2", "red", "ship_surface", "071-C2", "071 船塢登陸艦 C2", 118.40, 23.10, {
    speedKnots: 18,
    coreOverride: { rangeKm: 60, hpMax: 600 },
    waypoints: [[119.20, 23.10], [119.90, 23.10], [120.30, 23.10]],
  }),
  mkUnit("RED-LST-C3", "red", "ship_surface", "072-C3", "072 戰車登陸艦 C3", 118.30, 23.25, {
    speedKnots: 16,
    coreOverride: { rangeKm: 40, hpMax: 450 },
    waypoints: [[119.20, 23.20], [120.00, 23.15], [120.30, 23.10]],
  }),

  // ══════════ 護衛艦群（隨同 + 反艦壓制）══════════
  // 4 Type 055 強力驅逐艦
  mkUnit("RED-055-01", "red", "ship_surface", "055-101", "055 - A 編隊護衛", 118.60, 25.20, {
    speedKnots: 24,
    coreOverride: { rangeKm: 250, detectionRangeKm: 350, hpMax: 600 },
    waypoints: [[119.40, 25.20], [120.20, 25.10]],
  }),
  mkUnit("RED-055-02", "red", "ship_surface", "055-102", "055 - B 編隊護衛", 118.60, 24.40, {
    speedKnots: 24,
    coreOverride: { rangeKm: 250, detectionRangeKm: 350, hpMax: 600 },
    waypoints: [[119.40, 24.40], [120.10, 24.30]],
  }),
  mkUnit("RED-055-03", "red", "ship_surface", "055-103", "055 - C 編隊護衛", 118.60, 23.30, {
    speedKnots: 24,
    coreOverride: { rangeKm: 250, detectionRangeKm: 350, hpMax: 600 },
    waypoints: [[119.40, 23.20], [120.10, 23.10]],
  }),
  mkUnit("RED-055-04", "red", "ship_surface", "055-104", "055 機動", 118.50, 24.00, {
    speedKnots: 24,
    coreOverride: { rangeKm: 250, detectionRangeKm: 350, hpMax: 600 },
    waypoints: [[119.50, 23.90], [120.20, 23.80]],
  }),

  // 4 Type 052D
  mkUnit("RED-052D-01", "red", "ship_surface", "052D-201", "052D", 118.50, 25.05, {
    speedKnots: 26, waypoints: [[119.40, 25.05], [120.20, 25.00]],
  }),
  mkUnit("RED-052D-02", "red", "ship_surface", "052D-202", "052D", 118.50, 24.50, {
    speedKnots: 26, waypoints: [[119.40, 24.50], [120.20, 24.40]],
  }),
  mkUnit("RED-052D-03", "red", "ship_surface", "052D-203", "052D", 118.50, 23.60, {
    speedKnots: 26, waypoints: [[119.40, 23.60], [120.20, 23.50]],
  }),
  mkUnit("RED-052D-04", "red", "ship_surface", "052D-204", "052D", 118.50, 23.10, {
    speedKnots: 26, waypoints: [[119.40, 23.05], [120.10, 23.00]],
  }),

  // ══════════ 潛艦群（包夾藍方艦隊）══════════
  mkUnit("RED-SSN-01", "red", "submarine", "093A-501", "093A - 北線", 119.20, 25.40, {
    speedKnots: 18, stealth: 0.75,
    waypoints: [[120.00, 25.30], [120.80, 25.20]],
  }),
  mkUnit("RED-SSN-02", "red", "submarine", "093A-502", "093A - 中線", 119.00, 24.00, {
    speedKnots: 18, stealth: 0.75,
    waypoints: [[120.00, 24.00], [120.80, 24.00]],
  }),
  mkUnit("RED-SSN-03", "red", "submarine", "093B-503", "093B - 南線", 119.00, 22.80, {
    speedKnots: 20, stealth: 0.78,
    waypoints: [[120.00, 22.80], [120.50, 22.90]],
  }),

  // ══════════ 制空兵力 ══════════
  // 8 J-20 隱形戰機
  mkUnit("RED-J20-01", "red", "fighter", "J20-N1", "殲-20 - 北 1", 118.80, 25.30, {
    speedKnots: 650,
    coreOverride: { detectionRangeKm: 220, hpMax: 70 },
    waypoints: [[119.50, 25.20], [120.30, 25.10]],
  }),
  mkUnit("RED-J20-02", "red", "fighter", "J20-N2", "殲-20 - 北 2", 118.80, 25.10, {
    speedKnots: 650, waypoints: [[119.50, 25.00], [120.30, 24.95]],
  }),
  mkUnit("RED-J20-03", "red", "fighter", "J20-C1", "殲-20 - 中 1", 118.80, 24.30, {
    speedKnots: 650, waypoints: [[119.40, 24.30], [120.20, 24.20]],
  }),
  mkUnit("RED-J20-04", "red", "fighter", "J20-C2", "殲-20 - 中 2", 118.80, 24.10, {
    speedKnots: 650, waypoints: [[119.40, 24.10], [120.20, 24.05]],
  }),
  mkUnit("RED-J20-05", "red", "fighter", "J20-S1", "殲-20 - 南 1", 118.80, 23.20, {
    speedKnots: 650, waypoints: [[119.50, 23.20], [120.20, 23.10]],
  }),
  mkUnit("RED-J20-06", "red", "fighter", "J20-S2", "殲-20 - 南 2", 118.80, 23.00, {
    speedKnots: 650, waypoints: [[119.50, 23.00], [120.20, 22.95]],
  }),
  mkUnit("RED-J20-07", "red", "fighter", "J20-RSV1", "殲-20 預備 1", 118.50, 24.70, {
    speedKnots: 600, waypoints: [[119.20, 24.70], [120.00, 24.60]],
  }),
  mkUnit("RED-J20-08", "red", "fighter", "J20-RSV2", "殲-20 預備 2", 118.50, 23.70, {
    speedKnots: 600, waypoints: [[119.20, 23.70], [120.00, 23.60]],
  }),

  // 4 J-16 SEAD / 對地攻擊
  mkUnit("RED-J16-01", "red", "fighter", "J16-N1", "殲-16 SEAD - 北", 118.50, 25.05, {
    speedKnots: 600,
    coreOverride: { rangeKm: 150, hpMax: 75 },
    waypoints: [[119.40, 25.05], [120.50, 25.05]],
  }),
  mkUnit("RED-J16-02", "red", "fighter", "J16-C1", "殲-16 SEAD - 中", 118.50, 24.20, {
    speedKnots: 600,
    coreOverride: { rangeKm: 150, hpMax: 75 },
    waypoints: [[119.40, 24.20], [120.50, 24.20]],
  }),
  mkUnit("RED-J16-03", "red", "fighter", "J16-S1", "殲-16 SEAD - 南", 118.50, 23.10, {
    speedKnots: 600,
    coreOverride: { rangeKm: 150, hpMax: 75 },
    waypoints: [[119.40, 23.10], [120.30, 23.05]],
  }),
  mkUnit("RED-J16-04", "red", "fighter", "J16-RSV", "殲-16 預備", 118.30, 24.50, {
    speedKnots: 600,
    coreOverride: { rangeKm: 150, hpMax: 75 },
    waypoints: [[119.20, 24.50], [120.00, 24.40]],
  }),

  // 2 KJ-500 AWACS（用 drone 模擬）
  mkUnit("RED-AWACS-01", "red", "drone", "KJ500-A", "空警 500 - 北", 118.00, 25.00, {
    speedKnots: 280,
    coreOverride: { detectionRangeKm: 500, hpMax: 100, rangeKm: 0 },
    waypoints: [[118.50, 24.80], [118.50, 25.10]],
  }),
  mkUnit("RED-AWACS-02", "red", "drone", "KJ500-B", "空警 500 - 南", 118.00, 23.50, {
    speedKnots: 280,
    coreOverride: { detectionRangeKm: 500, hpMax: 100, rangeKm: 0 },
    waypoints: [[118.50, 23.20], [118.50, 23.80]],
  }),

  // 4 翼龍 UAV ISR
  mkUnit("RED-WL-01", "red", "drone", "WL-N1", "翼龍偵察 - 北", 119.00, 25.20, {
    speedKnots: 200,
    waypoints: [[120.00, 25.20], [120.80, 25.10]],
  }),
  mkUnit("RED-WL-02", "red", "drone", "WL-C1", "翼龍偵察 - 中", 119.00, 24.30, {
    speedKnots: 200,
    waypoints: [[120.00, 24.30], [120.50, 24.25]],
  }),
  mkUnit("RED-WL-03", "red", "drone", "WL-S1", "翼龍偵察 - 南", 119.00, 23.20, {
    speedKnots: 200,
    waypoints: [[120.00, 23.20], [120.30, 23.10]],
  }),
  mkUnit("RED-WL-04", "red", "drone", "WL-RSV", "翼龍預備", 119.00, 22.80, {
    speedKnots: 200,
    waypoints: [[120.00, 22.80], [120.30, 22.80]],
  }),

  // ══════════ 彈道飛彈打擊 ══════════
  // 4 DF-26 ASBM（針對美軍 + 戰略目標，超大射程）
  mkUnit("RED-DF26-01", "red", "missile_launcher", "DF-26-01", "東風 26 - 福建北", 118.20, 26.30, {
    coreOverride: { rangeKm: 4000, hpMax: 60 },
  }),
  mkUnit("RED-DF26-02", "red", "missile_launcher", "DF-26-02", "東風 26 - 福建中", 117.80, 25.50, {
    coreOverride: { rangeKm: 4000, hpMax: 60 },
  }),
  mkUnit("RED-DF26-03", "red", "missile_launcher", "DF-26-03", "東風 26 - 廣東北", 117.00, 24.50, {
    coreOverride: { rangeKm: 4000, hpMax: 60 },
  }),
  mkUnit("RED-DF26-04", "red", "missile_launcher", "DF-26-04", "東風 26 - 廣東南", 116.50, 23.80, {
    coreOverride: { rangeKm: 4000, hpMax: 60 },
  }),

  // 4 DF-17 高超音速（壓制機場 / 雷達）
  mkUnit("RED-DF17-01", "red", "missile_launcher", "DF-17-01", "東風 17 - A", 117.50, 25.00, {
    coreOverride: { rangeKm: 1800, hpMax: 50 },
  }),
  mkUnit("RED-DF17-02", "red", "missile_launcher", "DF-17-02", "東風 17 - B", 117.50, 24.00, {
    coreOverride: { rangeKm: 1800, hpMax: 50 },
  }),
  mkUnit("RED-DF17-03", "red", "missile_launcher", "DF-17-03", "東風 17 - C", 117.20, 23.50, {
    coreOverride: { rangeKm: 1800, hpMax: 50 },
  }),
  mkUnit("RED-DF17-04", "red", "missile_launcher", "DF-17-04", "東風 17 - D", 117.00, 23.00, {
    coreOverride: { rangeKm: 1800, hpMax: 50 },
  }),
];

const NEUTRAL_UNITS: Unit[] = [
  mkUnit("NEU-SH-01", "neutral", "ship_surface", "MV-CMA", "CMA CGM 貨櫃船", 121.50, 22.50, {
    speedKnots: 16, waypoints: [[122.50, 22.50]],
  }),
];

export const INVASION_H_HOUR_2030: Scenario = {
  id: "invasion_h_hour_2030",
  displayName: "H 時 — 共軍登島作戰 2030",
  briefing: "解放軍三線兩棲艦群（13 艦）同時逼近台灣西部三處登陸區（桃園、台中、台南），含 8 J-20 + 4 J-16 制空、3 SSN 潛伏、8 彈道飛彈壓制。藍方全面動員 + 美軍 4 單位介入。高難度全要素戰場。",
  startSimTimeSec: 0,
  durationSec: 5400,    // 90 分鐘
  sides: SIDES,
  units: [...BLUE_UNITS, ...US_UNITS, ...RED_UNITS, ...NEUTRAL_UNITS],
  pendingCommands: [],
  camera: {
    center: [120.30, 24.20],
    zoom: 6.8,
    pitch: 40,
    bearing: 0,
  },
  victoryConditions: [
    // 紅方任一登陸區 hold 20 分鐘 = 紅勝（登陸成功）
    { kind: "hold_area", centerLngLat: [120.85, 25.00], radiusKm: 25, sideId: "red", forSec: 1200,
      label: "紅方桃園登陸成立（hold 20 分）" },
    { kind: "hold_area", centerLngLat: [120.55, 24.20], radiusKm: 25, sideId: "red", forSec: 1200,
      label: "紅方台中登陸成立（hold 20 分）" },
    { kind: "hold_area", centerLngLat: [120.30, 23.10], radiusKm: 25, sideId: "red", forSec: 1200,
      label: "紅方台南登陸成立（hold 20 分）" },
    // 殲滅紅方所有兩棲艦 = 藍方戰略勝（無兵可登）
    // （非完美 — 用 eliminate_side 簡化，紅方水面艦全沒了就贏）
    { kind: "eliminate_side", targetSideId: "red", sideId: "blue",
      label: "藍方殲滅紅方全部兵力（兩棲登陸失敗）" },
    // 時限結束 fallback
    { kind: "time_limit", label: "90 分時限 — 比殘存戰力" },
  ],
};
