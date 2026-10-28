/**
 * 場景：H 時 — 共軍登島作戰 2030
 *
 * 高難度全面入侵情境。紅方總兵力 ~66 單位（含 10 兩棲艦 + 護衛艦群 + 戰機 + 轟-6K + 彈道飛彈），
 * 藍方 ~51 單位（含 4 機場 / 3 Patriot / 6 雄三 / HIMARS / 全艦隊），美軍 4 單位有限介入。
 *
 * 紅方戰略目標：3 個兩棲艦群分別在台中、台南、桃園外海登陸 → hold_area（限登陸艦 landing_ship）
 * 藍方戰略目標：殲滅紅方兩棲艦群（075/071/072）阻止登陸 → 任一艦隊全滅 = 勝
 *
 * 戰術設計：
 *   - 紅方 4 個 DF-26 在開戰 ~5 min 內試圖打掉 PAC-3 / 樂山雷達（壓制 BMD）
 *   - 紅方 8 J-20 突防爭取制空，4 J-16 對陸地目標 SEAD
 *   - 紅方 3 SSN 從南北包夾藍方艦隊
 *   - 藍方海軍向中線推進反艦戰 + 雄三飽和射擊
 *   - 藍方 6 SOWA 守灘岸、3 MOWA 自內陸撲擊接近中的登陸艦（一次性，擊發即消耗）
 *   - 美軍 2 DDG（Aegis BMD）+ 1 SSN + 1 P-8A 從東部進入支援
 *   - 紅方 2 轟-6K 以鷹擊-12 自海峽外緣遠距打擊；4 艘 022 快艇飽和攻擊；056A + 運-8Q 獵潛
 *   - 藍方 E-2K 預警 + P-3C 反潛；HIMARS 以 ATACMS 反擊福建沿海機場 / 防空；沱江 / 塔江級 + 光華六號近岸反艦
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
    weaponProfile?: Unit["weaponProfile"];   // B7：DF-26/DF-17 設 "ballistic"
    /** 覆寫 catalog 預設掛載（如沱江級 雄二 + 雄三、022 型 鷹擊-83 ×8） */
    loadout?: { weaponId: string; ammoMax: number; rangeKm?: number }[];
    hasTowedArray?: boolean;
  } = {},
): Unit {
  const cat = UNIT_CATALOG[kind];
  const core = { ...cat.defaultCore, ...(opts.coreOverride ?? {}) };
  if (opts.speedKnots !== undefined) core.speedKnots = opts.speedKnots;
  const extensions: Unit["extensions"] = {};
  if (opts.stealth !== undefined) extensions.stealth = opts.stealth;
  const weapons = opts.loadout?.map((l) => ({
    weaponId: l.weaponId, ammoMax: l.ammoMax, ammoCurrent: l.ammoMax,
    ...(l.rangeKm != null ? { rangeKm: l.rangeKm } : {}),
  }));
  const ammoMax = weapons ? weapons.reduce((n, w) => n + w.ammoMax, 0) : cat.defaultAmmoMax;
  return {
    id, sideId, kind, callsign, displayName,
    position: { lng, lat, altMeters: cat.defaultAltitudeM, headingDeg: 0, speedKnots: opts.speedKnots ?? 0 },
    waypoints: opts.waypoints ?? [],
    core, extensions,
    distanceTravelledKm: 0,
    hpCurrent: core.hpMax,
    ammoMax,
    ammoCurrent: ammoMax,
    ...(weapons ? { weapons } : {}),
    ...(opts.supplyOverride ? { supplyOverride: opts.supplyOverride } : {}),
    ...(opts.weaponProfile ? { weaponProfile: opts.weaponProfile } : {}),
    ...(opts.hasTowedArray ? { hasTowedArray: true } : {}),
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
    speedKnots: 22, waypoints: [[121.70, 25.30], [121.40, 25.35], [121.00, 25.15], [120.60, 25.00]],
  }),
  mkUnit("BLUE-SH-02", "blue", "ship_surface", "DDG-1803", "紀德級 - 蘇澳", 121.95, 24.50, {
    // 經三貂角、富貴角繞北部進入海峽
    speedKnots: 22, waypoints: [[122.10, 24.95], [121.80, 25.35], [121.20, 25.30], [120.90, 25.10]],
  }),
  mkUnit("BLUE-SH-03", "blue", "ship_surface", "FFG-1108", "成功級 1", 119.60, 23.60, {
    speedKnots: 20, waypoints: [[119.90, 23.70], [120.20, 23.80]],
  }),
  mkUnit("BLUE-SH-04", "blue", "ship_surface", "FFG-1109", "成功級 2", 120.15, 22.60, {
    speedKnots: 20, waypoints: [[120.05, 22.90], [119.95, 23.20]],
  }),
  mkUnit("BLUE-SH-05", "blue", "ship_surface", "PFG-1207", "康定級", 120.10, 22.60, {
    speedKnots: 22, waypoints: [[119.90, 22.80], [119.70, 23.10]],
  }),
  mkUnit("BLUE-SH-06", "blue", "missile_boat", "PG-3804", "光華六號 - 台中", 120.40, 24.25, {
    speedKnots: 33, waypoints: [[120.30, 24.10], [120.10, 24.20]],
  }),

  // ── 2 潛艦 ──
  mkUnit("BLUE-SUB-01", "blue", "submarine", "SS-793", "海龍劍龍級", 121.60, 25.40, {
    // 北部海域伏擊北線（桃園）兩棲艦群
    speedKnots: 10, stealth: 0.7,
    waypoints: [[121.20, 25.35], [120.80, 25.20]],
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
    waypoints: [[121.90, 24.30], [121.92, 24.50], [121.85, 24.40]],
  }),

  // ── 一次性攻擊無人機（灘岸反登陸）──
  // SOWA 部署在三處登陸灘岸；MOWA 置於內陸，撲擊接近中的兩棲艦
  mkUnit("BLUE-SOWA-TY1", "blue", "sowa", "SOWA-桃1", "SOWA 桃園灘岸 1", 121.06, 25.04),
  mkUnit("BLUE-SOWA-TY2", "blue", "sowa", "SOWA-桃2", "SOWA 桃園灘岸 2", 121.02, 24.98),
  mkUnit("BLUE-SOWA-TC1", "blue", "sowa", "SOWA-中1", "SOWA 台中灘岸 1", 120.60, 24.25),
  mkUnit("BLUE-SOWA-TC2", "blue", "sowa", "SOWA-中2", "SOWA 台中灘岸 2", 120.55, 24.15),
  mkUnit("BLUE-SOWA-TN1", "blue", "sowa", "SOWA-南1", "SOWA 台南灘岸 1", 120.17, 23.10),
  mkUnit("BLUE-SOWA-TN2", "blue", "sowa", "SOWA-南2", "SOWA 台南灘岸 2", 120.15, 23.00),
  mkUnit("BLUE-MOWA-N", "blue", "mowa", "MOWA-北", "MOWA 北部發射群", 121.20, 24.90),
  mkUnit("BLUE-MOWA-C", "blue", "mowa", "MOWA-中", "MOWA 中部發射群", 120.70, 24.10),
  mkUnit("BLUE-MOWA-S", "blue", "mowa", "MOWA-南", "MOWA 南部發射群", 120.35, 23.00),

  // ════ 以下依公開資料補充（國防部《國防報告書》、DSCA 對台軍售公告、IISS Military Balance）════

  // ── 空中預警 / 反潛巡邏（屏東基地；公開編裝 E-2K ×6、P-3C ×12）──
  mkUnit("BLUE-AEW-01", "blue", "aew", "E2K-01", "E-2K 鷹眼 - 中部空域", 120.47, 22.70, {
    speedKnots: 300,
    waypoints: [[120.95, 23.40], [121.05, 24.30], [120.95, 23.40]],
  }),
  mkUnit("BLUE-MPA-01", "blue", "mpa", "P3C-01", "P-3C 獵戶座 - 西南海域", 120.47, 22.70, {
    speedKnots: 330,
    waypoints: [[119.90, 22.60], [119.50, 23.00], [119.90, 23.30], [119.90, 22.60]],
  }),

  // ── M142 HIMARS（購 29 輛、2024 起交運；ATACMS ~300 km 可達福建沿海機場 / 防空陣地）──
  mkUnit("BLUE-HIM-01", "blue", "mlrs", "HIMARS-N", "HIMARS - 新竹", 121.00, 24.80),
  mkUnit("BLUE-HIM-02", "blue", "mlrs", "HIMARS-S", "HIMARS - 嘉南", 120.40, 23.20),

  // ── 沱江 / 塔江級巡邏艦（雄二 ×8 + 雄三 ×8、海劍二防空飛彈、方陣；最高 ~38 kn）──
  mkUnit("BLUE-PGG-618", "blue", "missile_boat", "PGG-618", "沱江艦", 121.30, 25.30, {
    speedKnots: 36,
    coreOverride: { detectionRangeKm: 120, hpMax: 120 },
    loadout: [
      { weaponId: "asm", ammoMax: 8, rangeKm: 150 },
      { weaponId: "asm_super", ammoMax: 8, rangeKm: 150 },
      { weaponId: "sam_ship", ammoMax: 12, rangeKm: 25 },
      { weaponId: "ciws", ammoMax: 200 },
    ],
    waypoints: [[121.00, 25.30], [120.80, 25.20]],
  }),
  mkUnit("BLUE-PGG-619", "blue", "missile_boat", "PGG-619", "塔江艦", 119.75, 23.35, {
    speedKnots: 36,
    coreOverride: { detectionRangeKm: 120, hpMax: 120 },
    loadout: [
      { weaponId: "asm", ammoMax: 8, rangeKm: 150 },
      { weaponId: "asm_super", ammoMax: 8, rangeKm: 150 },
      { weaponId: "sam_ship", ammoMax: 12, rangeKm: 25 },
      { weaponId: "ciws", ammoMax: 200 },
    ],
    waypoints: [[119.80, 23.15], [119.95, 23.00]],
  }),
  // 光華六號（31 艘，雄二 ×4）— 安平 / 澎湖分散待機
  mkUnit("BLUE-KH6-02", "blue", "missile_boat", "KH6-02", "光華六號 - 安平", 120.05, 23.00, {
    speedKnots: 33, waypoints: [[119.85, 23.05]],
  }),
  mkUnit("BLUE-KH6-03", "blue", "missile_boat", "KH6-03", "光華六號 - 澎湖", 119.70, 23.75, {
    speedKnots: 33, waypoints: [[119.60, 23.95]],
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
  // P-8A 反潛巡邏機（APY-10 雷達、Mk-54 魚雷 + 魚叉；可佈放聲標）
  mkUnit("US-P8-01", "us", "mpa", "VP-9", "P-8A Poseidon", 122.50, 24.00, {
    speedKnots: 350,
    coreOverride: { detectionRangeKm: 350, hpMax: 80 },
    waypoints: [[121.80, 23.80], [121.20, 23.40], [121.80, 23.00]],
  }),
];

// ════════════════════════════════════════════════
// PLA 紅方 — 全面入侵
// 部署依公開資料（美國防部《中國軍力報告》、CMSI、IISS、國防部共機動態）：
//   - 東部戰區前沿機場：福州、龍田（福清）、惠安、漳州
//   - 兩棲集結：平潭外海（北）、泉州圍頭灣（中）、東山 / 古雷外海（南）— 歷年「聯合利劍 / 海峽雷霆」演習區
//   - 火箭軍：DF-17 旅（贛州 616 旅、普寧 627 旅）、DF-26 旅（清遠 626 旅、信陽 666 旅）
//   - 第 73 集團軍（廈門）PHL-16 遠程火箭砲；福建沿海 HQ-9B 防空
//   - 無人機以國防部常報的 無偵-7 / TB-001 為準
// ════════════════════════════════════════════════
/** 022 型：鷹擊-83 ×8（~180 km）+ AK-630 近迫 */
const LOADOUT_022 = [
  { weaponId: "asm", ammoMax: 8, rangeKm: 180 },
  { weaponId: "ciws", ammoMax: 100 },
];

const RED_UNITS: Unit[] = [
  // ── 戰略雷達 + 機場 ──
  mkUnit("RED-RAD-FJ", "red", "radar_station", "FJ-RAD", "福建沿海雷達", 118.40, 25.50),
  mkUnit("RED-AB-FZ", "red", "airbase", "AB-FZ", "福州基地", 119.31, 26.07),
  mkUnit("RED-AB-LT", "red", "airbase", "AB-LT", "龍田基地（福清）", 119.48, 25.64),
  mkUnit("RED-AB-HA", "red", "airbase", "AB-HA", "惠安基地", 118.80, 25.03),
  mkUnit("RED-AB-ZZ", "red", "airbase", "AB-ZZ", "漳州基地", 117.68, 24.56),

  // ══════════ 兩棲艦群 A：北線（平潭外海集結 → 桃園外海登陸）══════════
  mkUnit("RED-LHA-A1", "red", "landing_ship", "075-A1", "075 兩棲攻擊艦 A1", 120.00, 25.50, {
    speedKnots: 18,
    coreOverride: { hpMax: 700 },
    waypoints: [[120.40, 25.25], [120.80, 25.00]],
  }),
  mkUnit("RED-LPD-A2", "red", "landing_ship", "071-A2", "071 船塢登陸艦 A2", 119.98, 25.42, {
    speedKnots: 18,
    coreOverride: { hpMax: 600 },
    waypoints: [[120.40, 25.15], [120.80, 24.95]],
  }),
  mkUnit("RED-LST-A3", "red", "landing_ship", "072-A3", "072A 戰車登陸艦 A3", 120.05, 25.58, {
    speedKnots: 16,
    coreOverride: { hpMax: 450 },
    waypoints: [[120.45, 25.30], [120.80, 25.05]],
  }),

  // ══════════ 兩棲艦群 B：中線（圍頭灣集結 → 台中外海登陸）══════════
  mkUnit("RED-LHA-B1", "red", "landing_ship", "075-B1", "075 兩棲攻擊艦 B1", 118.90, 24.70, {
    speedKnots: 18,
    coreOverride: { hpMax: 700 },
    waypoints: [[119.30, 24.30], [120.10, 24.25], [120.42, 24.20]],
  }),
  mkUnit("RED-LPD-B2", "red", "landing_ship", "071-B2", "071 船塢登陸艦 B2", 118.85, 24.60, {
    speedKnots: 18,
    coreOverride: { hpMax: 600 },
    waypoints: [[119.20, 24.20], [120.00, 24.20], [120.42, 24.15]],
  }),
  mkUnit("RED-LST-B3", "red", "landing_ship", "072-B3", "072A 戰車登陸艦 B3", 118.95, 24.65, {
    speedKnots: 16,
    coreOverride: { hpMax: 450 },
    waypoints: [[119.20, 24.35], [120.00, 24.25], [120.50, 24.25]],
  }),
  mkUnit("RED-LST-B4", "red", "landing_ship", "072-B4", "072A 戰車登陸艦 B4", 118.92, 24.55, {
    speedKnots: 16,
    coreOverride: { hpMax: 450 },
    waypoints: [[119.25, 24.15], [120.05, 24.10], [120.40, 24.10]],
  }),

  // ══════════ 兩棲艦群 C：南線（東山外海集結 → 台南外海登陸）══════════
  mkUnit("RED-LHA-C1", "red", "landing_ship", "075-C1", "075 兩棲攻擊艦 C1", 117.80, 23.60, {
    speedKnots: 18,
    coreOverride: { hpMax: 700 },
    waypoints: [[119.30, 23.15], [120.00, 23.10], [120.10, 23.05]],
  }),
  mkUnit("RED-LPD-C2", "red", "landing_ship", "071-C2", "071 船塢登陸艦 C2", 117.75, 23.52, {
    speedKnots: 18,
    coreOverride: { hpMax: 600 },
    waypoints: [[119.20, 23.10], [119.90, 23.10], [120.08, 23.10]],
  }),
  mkUnit("RED-LST-C3", "red", "landing_ship", "072-C3", "072A 戰車登陸艦 C3", 117.85, 23.65, {
    speedKnots: 16,
    coreOverride: { hpMax: 450 },
    waypoints: [[119.20, 23.20], [120.00, 23.15], [120.08, 23.12]],
  }),

  // ══════════ 護衛艦群（隨同 + 反艦壓制）══════════
  // 055 型（鷹擊-18 反艦飛彈公開射程約 540 km，遊戲內折算 250 km）
  mkUnit("RED-055-01", "red", "ship_surface", "055-101", "055 南昌級 - A 編隊", 120.05, 25.35, {
    speedKnots: 24,
    coreOverride: { rangeKm: 250, detectionRangeKm: 350, hpMax: 600 },
    waypoints: [[120.40, 25.20], [120.70, 25.10]],
  }),
  mkUnit("RED-055-02", "red", "ship_surface", "055-102", "055 南昌級 - B 編隊", 119.00, 24.55, {
    speedKnots: 24,
    coreOverride: { rangeKm: 250, detectionRangeKm: 350, hpMax: 600 },
    waypoints: [[119.40, 24.40], [120.10, 24.30]],
  }),
  mkUnit("RED-055-03", "red", "ship_surface", "055-103", "055 南昌級 - C 編隊", 117.90, 23.50, {
    speedKnots: 24,
    coreOverride: { rangeKm: 250, detectionRangeKm: 350, hpMax: 600 },
    waypoints: [[119.40, 23.20], [120.10, 23.10]],
  }),
  mkUnit("RED-055-04", "red", "ship_surface", "055-104", "055 南昌級 - 機動", 119.00, 24.10, {
    speedKnots: 24,
    coreOverride: { rangeKm: 250, detectionRangeKm: 350, hpMax: 600 },
    waypoints: [[119.50, 23.90], [120.20, 23.80]],
  }),

  // 052D 型
  mkUnit("RED-052D-01", "red", "ship_surface", "052D-201", "052D 昆明級 - A", 119.95, 25.30, {
    speedKnots: 26, waypoints: [[120.40, 25.15], [120.70, 25.00]],
  }),
  mkUnit("RED-052D-02", "red", "ship_surface", "052D-202", "052D 昆明級 - B", 118.98, 24.65, {
    speedKnots: 26, waypoints: [[119.40, 24.50], [120.20, 24.40]],
  }),
  mkUnit("RED-052D-03", "red", "ship_surface", "052D-203", "052D 昆明級 - C", 117.95, 23.60, {
    speedKnots: 26, waypoints: [[119.40, 23.60], [120.00, 23.50]],
  }),
  mkUnit("RED-052D-04", "red", "ship_surface", "052D-204", "052D 昆明級 - C 後衛", 118.00, 23.42, {
    speedKnots: 26, waypoints: [[119.40, 23.05], [120.10, 23.00]],
  }),

  // 901 型綜合補給艦（中線後方）
  mkUnit("RED-AOE-01", "red", "supply_ship", "901-965", "901 型綜合補給艦", 118.95, 24.30, {
    speedKnots: 0,
  }),

  // ══════════ 潛艦群（包夾藍方艦隊）══════════
  mkUnit("RED-SSN-01", "red", "submarine", "093A-501", "093A - 北線", 120.20, 25.80, {
    speedKnots: 18, stealth: 0.75,
    waypoints: [[120.60, 25.50], [120.80, 25.20]],
  }),
  mkUnit("RED-SSN-02", "red", "submarine", "093A-502", "093A - 中線", 119.00, 24.00, {
    speedKnots: 18, stealth: 0.75,
    waypoints: [[120.00, 24.00], [120.25, 24.05]],
  }),
  mkUnit("RED-SSN-03", "red", "submarine", "093B-503", "093B - 南線", 119.00, 22.80, {
    speedKnots: 20, stealth: 0.78,
    waypoints: [[120.00, 22.80], [120.15, 22.50]],
  }),

  // ══════════ 制空兵力（自前沿機場起飛）══════════
  // 殲-20：龍田（北）、惠安（中）、漳州（南）
  mkUnit("RED-J20-01", "red", "fighter", "J20-N1", "殲-20 - 北 1", 119.48, 25.64, {
    speedKnots: 650,
    coreOverride: { detectionRangeKm: 220, hpMax: 70 },
    waypoints: [[119.90, 25.30], [120.30, 25.10]],
  }),
  mkUnit("RED-J20-02", "red", "fighter", "J20-N2", "殲-20 - 北 2", 119.48, 25.64, {
    speedKnots: 650, waypoints: [[119.90, 25.10], [120.30, 24.95]],
  }),
  mkUnit("RED-J20-03", "red", "fighter", "J20-C1", "殲-20 - 中 1", 118.80, 25.03, {
    speedKnots: 650, waypoints: [[119.40, 24.30], [120.20, 24.20]],
  }),
  mkUnit("RED-J20-04", "red", "fighter", "J20-C2", "殲-20 - 中 2", 118.80, 25.03, {
    speedKnots: 650, waypoints: [[119.40, 24.10], [120.20, 24.05]],
  }),
  mkUnit("RED-J20-05", "red", "fighter", "J20-S1", "殲-20 - 南 1", 117.68, 24.56, {
    speedKnots: 650, waypoints: [[119.50, 23.20], [120.20, 23.10]],
  }),
  mkUnit("RED-J20-06", "red", "fighter", "J20-S2", "殲-20 - 南 2", 117.68, 24.56, {
    speedKnots: 650, waypoints: [[119.50, 23.00], [120.20, 22.95]],
  }),
  mkUnit("RED-J20-07", "red", "fighter", "J20-RSV1", "殲-20 預備 1", 118.80, 25.03, {
    speedKnots: 600, waypoints: [[119.20, 24.70], [120.00, 24.60]],
  }),
  mkUnit("RED-J20-08", "red", "fighter", "J20-RSV2", "殲-20 預備 2", 117.68, 24.56, {
    speedKnots: 600, waypoints: [[119.20, 23.70], [120.00, 23.60]],
  }),

  // 殲-16 SEAD / 對地攻擊
  mkUnit("RED-J16-01", "red", "fighter", "J16-N1", "殲-16 SEAD - 北", 119.48, 25.64, {
    speedKnots: 600,
    coreOverride: { rangeKm: 150, hpMax: 75 },
    waypoints: [[119.90, 25.20], [120.50, 25.05]],
  }),
  mkUnit("RED-J16-02", "red", "fighter", "J16-C1", "殲-16 SEAD - 中", 118.80, 25.03, {
    speedKnots: 600,
    coreOverride: { rangeKm: 150, hpMax: 75 },
    waypoints: [[119.40, 24.20], [120.50, 24.20]],
  }),
  mkUnit("RED-J16-03", "red", "fighter", "J16-S1", "殲-16 SEAD - 南", 117.68, 24.56, {
    speedKnots: 600,
    coreOverride: { rangeKm: 150, hpMax: 75 },
    waypoints: [[119.40, 23.10], [120.30, 23.05]],
  }),
  mkUnit("RED-J16-04", "red", "fighter", "J16-RSV", "殲-16 預備", 118.80, 25.03, {
    speedKnots: 600,
    coreOverride: { rangeKm: 150, hpMax: 75 },
    waypoints: [[119.20, 24.50], [120.00, 24.40]],
  }),

  // 空警-500 預警機（Y-9 平台；公開報導偵蒐 ~470 km），福建沿海上空盤旋
  mkUnit("RED-AWACS-01", "red", "aew", "KJ500-A", "空警-500 - 北", 118.80, 25.40, {
    speedKnots: 280,
    coreOverride: { detectionRangeKm: 470 },
    waypoints: [[119.20, 25.20], [119.20, 25.60]],
  }),
  mkUnit("RED-AWACS-02", "red", "aew", "KJ500-B", "空警-500 - 南", 117.90, 24.00, {
    speedKnots: 280,
    coreOverride: { detectionRangeKm: 470 },
    waypoints: [[118.20, 23.80], [118.20, 24.20]],
  }),

  // 無人機 ISR（國防部共機動態常見：無偵-7 / TB-001）
  mkUnit("RED-WL-01", "red", "drone", "WZ7-N1", "無偵-7 - 北", 119.48, 25.64, {
    speedKnots: 200,
    waypoints: [[120.00, 25.20], [120.80, 25.10]],
  }),
  mkUnit("RED-WL-02", "red", "drone", "WZ7-C1", "無偵-7 - 中", 118.80, 25.03, {
    speedKnots: 200,
    waypoints: [[120.00, 24.30], [120.50, 24.25]],
  }),
  mkUnit("RED-WL-03", "red", "drone", "TB001-S1", "TB-001 - 南", 117.68, 24.56, {
    speedKnots: 200,
    waypoints: [[120.00, 23.20], [120.30, 23.10]],
  }),
  mkUnit("RED-WL-04", "red", "drone", "TB001-RSV", "TB-001 預備", 117.68, 24.56, {
    speedKnots: 200,
    waypoints: [[120.00, 22.80], [120.30, 22.80]],
  }),

  // ══════════ 防空 / 遠程火力 ══════════
  // 紅旗-9B（福建沿海，遊戲射程 200 km）
  mkUnit("RED-HQ9-01", "red", "sam_coastal", "HQ9B-N", "紅旗-9B - 福清", 119.40, 25.70, {
    coreOverride: { rangeKm: 200, detectionRangeKm: 250, hpMax: 120 },
  }),
  mkUnit("RED-HQ9-02", "red", "sam_coastal", "HQ9B-S", "紅旗-9B - 廈門", 118.05, 24.60, {
    coreOverride: { rangeKm: 200, detectionRangeKm: 250, hpMax: 120 },
  }),
  // PHL-16 遠程火箭砲（第 73 集團軍，公開射程 300 km 級；370mm 制導火箭雙 5 聯裝發射箱）
  mkUnit("RED-PHL16-01", "red", "mlrs", "PHL16-01", "PHL-16 - 晉江", 118.60, 24.75, {
    loadout: [{ weaponId: "rocket", ammoMax: 10 }],
  }),
  mkUnit("RED-PHL16-02", "red", "mlrs", "PHL16-02", "PHL-16 - 漳浦", 117.65, 24.15, {
    loadout: [{ weaponId: "rocket", ammoMax: 10 }],
  }),

  // ══════════ 彈道飛彈打擊（火箭軍）══════════
  // DF-26 中程（清遠 626 旅、信陽 666 旅）
  mkUnit("RED-DF26-01", "red", "missile_launcher", "DF-26-01", "東風-26 - 清遠 626 旅", 113.05, 23.70, {
    coreOverride: { rangeKm: 4000, hpMax: 60 }, weaponProfile: "ballistic",
  }),
  mkUnit("RED-DF26-02", "red", "missile_launcher", "DF-26-02", "東風-26 - 清遠 626 旅", 113.15, 23.75, {
    coreOverride: { rangeKm: 4000, hpMax: 60 }, weaponProfile: "ballistic",
  }),
  mkUnit("RED-DF26-03", "red", "missile_launcher", "DF-26-03", "東風-26 - 信陽 666 旅", 114.07, 32.13, {
    coreOverride: { rangeKm: 4000, hpMax: 60 }, weaponProfile: "ballistic",
  }),
  mkUnit("RED-DF26-04", "red", "missile_launcher", "DF-26-04", "東風-26 - 信陽 666 旅", 114.15, 32.05, {
    coreOverride: { rangeKm: 4000, hpMax: 60 }, weaponProfile: "ballistic",
  }),

  // DF-17 高超音速（贛州 616 旅、普寧 627 旅；壓制機場 / 雷達）
  mkUnit("RED-DF17-01", "red", "missile_launcher", "DF-17-01", "東風-17 - 贛州 616 旅", 114.93, 25.83, {
    coreOverride: { rangeKm: 1800, hpMax: 50 }, weaponProfile: "ballistic",
  }),
  mkUnit("RED-DF17-02", "red", "missile_launcher", "DF-17-02", "東風-17 - 贛州 616 旅", 115.02, 25.90, {
    coreOverride: { rangeKm: 1800, hpMax: 50 }, weaponProfile: "ballistic",
  }),
  mkUnit("RED-DF17-03", "red", "missile_launcher", "DF-17-03", "東風-17 - 普寧 627 旅", 116.17, 23.30, {
    coreOverride: { rangeKm: 1800, hpMax: 50 }, weaponProfile: "ballistic",
  }),
  mkUnit("RED-DF17-04", "red", "missile_launcher", "DF-17-04", "東風-17 - 普寧 627 旅", 116.25, 23.36, {
    coreOverride: { rangeKm: 1800, hpMax: 50 }, weaponProfile: "ballistic",
  }),

  // ════ 以下依公開資料補充（美國防部《中國軍力報告》、IISS、國防部共機 / 共艦動態）════

  // ── 轟-6K（東部戰區空軍，安慶基地）：翼下 鷹擊-12 ×6（~400 km），自海峽外緣發射 ──
  mkUnit("RED-H6K-01", "red", "bomber", "H6K-N", "轟-6K - 北", 117.05, 30.58, {
    speedKnots: 420, waypoints: [[119.20, 26.20], [119.70, 25.90]],
  }),
  mkUnit("RED-H6K-02", "red", "bomber", "H6K-S", "轟-6K - 南", 117.05, 30.58, {
    speedKnots: 420, waypoints: [[118.20, 24.80], [118.60, 23.80]],
  }),

  // ── 運-8Q 反潛機（共機動態常見於西南空域）：只掛魚雷，獵殺藍方潛艦 ──
  mkUnit("RED-Y8Q-01", "red", "mpa", "Y8Q-01", "運-8Q - 西南空域", 117.68, 24.56, {
    speedKnots: 300,
    coreOverride: { rangeKm: 10 },
    loadout: [{ weaponId: "torpedo", ammoMax: 4, rangeKm: 10 }],
    waypoints: [[119.40, 22.70], [119.90, 22.40], [119.40, 22.70]],
  }),

  // ── 056A 江島級護衛艦（鷹擊-83 ×4、紅旗-10、拖曳陣列聲納）：兩棲艦群反潛幕 ──
  mkUnit("RED-056A-01", "red", "ship_surface", "056A-B", "056A 江島級 - B 反潛幕", 119.05, 24.45, {
    speedKnots: 22, hasTowedArray: true,
    coreOverride: { rangeKm: 180, detectionRangeKm: 150, hpMax: 200 },
    loadout: [
      { weaponId: "asm", ammoMax: 4, rangeKm: 180 },
      { weaponId: "sam_ship", ammoMax: 8, rangeKm: 9 },
      { weaponId: "torpedo", ammoMax: 6, rangeKm: 10 },
    ],
    waypoints: [[119.50, 24.25], [120.10, 24.20]],
  }),
  mkUnit("RED-056A-02", "red", "ship_surface", "056A-C", "056A 江島級 - C 反潛幕", 118.00, 23.50, {
    speedKnots: 22, hasTowedArray: true,
    coreOverride: { rangeKm: 180, detectionRangeKm: 150, hpMax: 200 },
    loadout: [
      { weaponId: "asm", ammoMax: 4, rangeKm: 180 },
      { weaponId: "sam_ship", ammoMax: 8, rangeKm: 9 },
      { weaponId: "torpedo", ammoMax: 6, rangeKm: 10 },
    ],
    waypoints: [[119.40, 23.25], [120.00, 23.15]],
  }),

  // ── 022 型飛彈快艇（鷹擊-83 ×8、AK-630；~36 kn）：平潭 / 圍頭灣出擊，飽和攻擊藍方水面艦 ──
  mkUnit("RED-022-01", "red", "missile_boat", "022-N1", "022 快艇 - 平潭 1", 120.00, 25.40, {
    speedKnots: 36, coreOverride: { rangeKm: 180 }, loadout: LOADOUT_022,
    waypoints: [[120.40, 25.30]],
  }),
  mkUnit("RED-022-02", "red", "missile_boat", "022-N2", "022 快艇 - 平潭 2", 120.05, 25.30, {
    speedKnots: 36, coreOverride: { rangeKm: 180 }, loadout: LOADOUT_022,
    waypoints: [[120.40, 25.20]],
  }),
  mkUnit("RED-022-03", "red", "missile_boat", "022-C1", "022 快艇 - 圍頭 1", 118.75, 24.40, {
    speedKnots: 36, coreOverride: { rangeKm: 180 }, loadout: LOADOUT_022,
    waypoints: [[119.60, 24.30]],
  }),
  mkUnit("RED-022-04", "red", "missile_boat", "022-C2", "022 快艇 - 圍頭 2", 118.80, 24.35, {
    speedKnots: 36, coreOverride: { rangeKm: 180 }, loadout: LOADOUT_022,
    waypoints: [[119.60, 24.15]],
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
  briefing: {
    zh: "解放軍三線兩棲艦群（13 艦）同時逼近台灣西部三處登陸區（桃園、台中、台南），含 8 J-20 + 4 J-16 制空、2 轟-6K 遠距反艦、4 艘 022 快艇、3 SSN 潛伏、8 彈道飛彈壓制。藍方全面動員（含 E-2K / P-3C、HIMARS、沱江級、SOWA / MOWA 自殺無人機灘岸反登陸）+ 美軍 4 單位介入。登陸艦須進入登陸區並守住 20 分鐘才算登陸成功。高難度全要素戰場。",
    en: "PLA three-axis amphibious task force (13 ships) simultaneously approaches Taiwan's western landing zones (Taoyuan, Taichung, Tainan). Includes 8 J-20 + 4 J-16 air superiority, 2 H-6K standoff anti-ship bombers, 4 Type 022 missile boats, 3 SSN lurking, 8 ballistic missiles for suppression. Blue full mobilization (incl. E-2K / P-3C, HIMARS, Tuo Chiang-class corvettes, SOWA / MOWA one-way attack drones for anti-landing defense) + 4 USN assets engaged. Landing ships must enter a landing zone and hold for 20 minutes. Highest difficulty, all-elements battlefield.",
  },
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
      requireKinds: ["landing_ship"], label: "紅方桃園登陸成立（登陸艦 hold 20 分）" },
    { kind: "hold_area", centerLngLat: [120.55, 24.20], radiusKm: 25, sideId: "red", forSec: 1200,
      requireKinds: ["landing_ship"], label: "紅方台中登陸成立（登陸艦 hold 20 分）" },
    { kind: "hold_area", centerLngLat: [120.30, 23.10], radiusKm: 25, sideId: "red", forSec: 1200,
      requireKinds: ["landing_ship"], label: "紅方台南登陸成立（登陸艦 hold 20 分）" },
    // 殲滅紅方所有兩棲艦 = 藍方戰略勝（無兵可登）
    // （非完美 — 用 eliminate_side 簡化，紅方水面艦全沒了就贏）
    { kind: "eliminate_side", targetSideId: "red", sideId: "blue",
      label: "藍方殲滅紅方全部兵力（兩棲登陸失敗）" },
    // 時限結束 fallback
    { kind: "time_limit", label: "90 分時限 — 比殘存戰力" },
  ],
};
