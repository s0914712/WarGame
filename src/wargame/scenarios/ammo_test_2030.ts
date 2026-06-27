/**
 * 場景：北部防空彈藥消耗測試 2030
 *
 * 目的：示範 Patriot / F-16V / 海岸 SAM 在連續攔截下耗彈、補給艦 RAS 補回的循環。
 *
 * 配置：
 *   - 藍方 2 PAC-3（每架 16 彈）+ 2 F-16V（每架 6 彈）+ 2 海岸 SAM（每架 8 彈）
 *     + 1 雷達 + 1 補給艦（基隆外海，可 RAS 補沿岸 SAM）
 *   - 紅方 3 波攻擊（共 ~12 單位）：UAV → 戰機 → 第二波戰機 + UAV
 *
 * 觀察重點：
 *   - 戰報「開火（剩彈 X/Y）」滾動
 *   - 點任一藍方防空單位 → 看 ammo 條從滿到 0
 *   - 沿岸 SAM 在補給艦 6 km 內 → ammo 緩慢回補
 *   - PAC-3 在陸地內陸 → 無補給（離補給艦 > 6km），打完就停
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
    id: "red", displayName: "解放軍空軍",
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

// ── 藍方防空火網 ──
const BLUE_UNITS: Unit[] = [
  // 雷達 — 主動追蹤所有來襲
  mkUnit("BLUE-RAD-01", "blue", "radar_station", "PAVE PAWS", "樂山雷達", 121.42, 24.81),

  // 2 空軍基地（RTB 目標 — 30 km 內自動補油彈）
  mkUnit("BLUE-AB-01", "blue", "airbase", "AB-SS", "松山機場", 121.55, 25.07),
  mkUnit("BLUE-AB-02", "blue", "airbase", "AB-CCK", "清泉崗基地", 120.62, 24.27),

  // 2 Patriot PAC-3（桃園 / 新北 — 戰略目標保護）
  mkUnit("BLUE-PAC-01", "blue", "sam_patriot", "PAC3-N1", "愛國者 PAC-3 - 桃園", 121.20, 25.00),
  mkUnit("BLUE-PAC-02", "blue", "sam_patriot", "PAC3-N2", "愛國者 PAC-3 - 新北", 121.55, 25.05),

  // 2 海岸 SAM（基隆 / 富貴角 — 沿岸防空，靠近補給艦）
  mkUnit("BLUE-SAM-01", "blue", "sam_coastal", "TC2N-N1", "天弓 II - 基隆", 121.74, 25.13),
  mkUnit("BLUE-SAM-02", "blue", "sam_coastal", "TC2N-N2", "天弓 II - 富貴角", 121.52, 25.30),

  // 2 F-16V CAP（北部空域巡邏）
  mkUnit("BLUE-FT-01", "blue", "fighter", "F16V-CAP1", "F-16V CAP-1", 121.00, 25.20, {
    speedKnots: 450,
    waypoints: [
      [120.70, 25.20], [120.70, 25.50], [121.20, 25.50], [121.20, 25.20], [120.70, 25.20],
    ],
  }),
  mkUnit("BLUE-FT-02", "blue", "fighter", "F16V-CAP2", "F-16V CAP-2", 121.50, 25.30, {
    speedKnots: 450,
    waypoints: [
      [121.20, 25.30], [121.20, 25.60], [121.70, 25.60], [121.70, 25.30], [121.20, 25.30],
    ],
  }),

  // 1 補給艦（基隆外海，6 km 內可 RAS 沿岸 SAM）
  mkUnit("BLUE-AO-01", "blue", "supply_ship", "AOE-530", "武夷油彈船", 121.75, 25.16, {
    speedKnots: 8,
    coreOverride: { hpMax: 500 },
    waypoints: [[121.78, 25.18], [121.72, 25.20], [121.75, 25.16]],   // 在基隆外海定點巡迴
  }),
];

// ── 紅方 3 波攻擊（共 ~12 單位） ──
const RED_UNITS: Unit[] = [
  // 第 1 波：4 UAV 從西北方接近（120°E, 25.5°N → 台灣北部）
  mkUnit("RED-DR-01", "red", "drone", "WL-W1-01", "翼龍第 1 波", 119.50, 25.40, {
    speedKnots: 200,
    waypoints: [[120.50, 25.40], [121.30, 25.30]],
  }),
  mkUnit("RED-DR-02", "red", "drone", "WL-W1-02", "翼龍第 1 波", 119.50, 25.60, {
    speedKnots: 200,
    waypoints: [[120.50, 25.50], [121.30, 25.40]],
  }),
  mkUnit("RED-DR-03", "red", "drone", "WL-W1-03", "翼龍第 1 波", 119.30, 25.20, {
    speedKnots: 200,
    waypoints: [[120.30, 25.20], [121.20, 25.10]],
  }),
  mkUnit("RED-DR-04", "red", "drone", "WL-W1-04", "翼龍第 1 波", 119.30, 25.70, {
    speedKnots: 200,
    waypoints: [[120.30, 25.60], [121.20, 25.45]],
  }),

  // 第 2 波：4 戰機從西方高速突防
  mkUnit("RED-FT-01", "red", "fighter", "J20-W2-01", "殲-20 第 2 波", 118.80, 25.40, {
    speedKnots: 650,
    waypoints: [[120.00, 25.40], [121.20, 25.30]],
  }),
  mkUnit("RED-FT-02", "red", "fighter", "J20-W2-02", "殲-20 第 2 波", 118.80, 25.10, {
    speedKnots: 650,
    waypoints: [[120.00, 25.10], [121.20, 25.05]],
  }),
  mkUnit("RED-FT-03", "red", "fighter", "J16-W2-01", "殲-16 第 2 波", 118.80, 25.60, {
    speedKnots: 600,
    waypoints: [[120.00, 25.55], [121.20, 25.40]],
  }),
  mkUnit("RED-FT-04", "red", "fighter", "J16-W2-02", "殲-16 第 2 波", 118.80, 25.80, {
    speedKnots: 600,
    waypoints: [[120.00, 25.70], [121.20, 25.50]],
  }),

  // 第 3 波：混合（2 戰機 + 2 UAV，從更遠位置稍後抵達）
  mkUnit("RED-FT-05", "red", "fighter", "J20-W3-01", "殲-20 第 3 波", 118.00, 25.30, {
    speedKnots: 700,
    waypoints: [[119.50, 25.30], [121.00, 25.25]],
  }),
  mkUnit("RED-FT-06", "red", "fighter", "J20-W3-02", "殲-20 第 3 波", 118.00, 25.50, {
    speedKnots: 700,
    waypoints: [[119.50, 25.50], [121.00, 25.40]],
  }),
  mkUnit("RED-DR-05", "red", "drone", "WL-W3-01", "翼龍第 3 波", 118.00, 25.00, {
    speedKnots: 200,
    waypoints: [[119.50, 25.05], [121.00, 25.00]],
  }),
  mkUnit("RED-DR-06", "red", "drone", "WL-W3-02", "翼龍第 3 波", 118.00, 25.70, {
    speedKnots: 200,
    waypoints: [[119.50, 25.65], [121.00, 25.55]],
  }),
];

export const AMMO_TEST_2030: Scenario = {
  id: "ammo_test_2030",
  displayName: "防空彈藥消耗測試 2030",
  briefing: {
    zh: "藍方 2 PAC-3 + 2 F-16V + 2 海岸 SAM 對抗 3 波 12 單位紅方來襲。測試彈藥耗用 + 補給艦 RAS 效果。建議 30× 加速觀察。",
    en: "Blue 2 PAC-3 + 2 F-16V + 2 coastal SAMs vs 3 waves of 12 red inbound units. Tests ammo consumption + supply ship RAS replenishment. Recommend 30× sim rate to observe clearly.",
  },
  startSimTimeSec: 0,
  durationSec: 1800,
  sides: SIDES,
  units: [...BLUE_UNITS, ...RED_UNITS],
  pendingCommands: [],
  camera: {
    center: [120.80, 25.20],
    zoom: 8.6,
    pitch: 35,
    bearing: 0,
  },
  victoryConditions: [
    {
      kind: "eliminate_side", targetSideId: "red", sideId: "blue",
      label: "藍方 — 全數攔截 12 波次來襲",
    },
    {
      kind: "destroy_unit", unitId: "BLUE-PAC-01", sideId: "red",
      label: "紅方 — 摧毀桃園 PAC-3",
    },
    {
      kind: "destroy_unit", unitId: "BLUE-PAC-02", sideId: "red",
      label: "紅方 — 摧毀新北 PAC-3",
    },
    { kind: "time_limit", label: "30 分時限結束比殘存戰力" },
  ],
};
