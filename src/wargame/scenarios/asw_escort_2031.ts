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
    ...(opts.activeSonar ? { activeSonar: true } : {}),
    detectedBy: {},
    lastTickSimSec: 0,
  };
}

// ── 藍方：補給船團 + 反潛護航群（緊湊伏擊區，由西南向東北航渡）──
// 全部單位落在 ~40km 戰術盒內，40 分鐘內必然接觸。
const BLUE_UNITS: Unit[] = [
  // 高價值目標：補給艦（極吵、無聲納、需被保護）
  mkUnit("BLUE-AOE-01", "blue", "supply_ship", "AOE-532", "磐石號油彈補給艦", 122.80, 22.25, {
    speedKnots: 14,
    waypoints: [[123.10, 22.55], [123.35, 22.80]],
  }),

  // 2 巡防艦護航（主動聲納拍發 ON — 偵潛主力，但會曝露自身）
  mkUnit("BLUE-FFG-01", "blue", "ship_surface", "FFG-1101", "成功級 - 前衛", 122.95, 22.40, {
    speedKnots: 16,
    activeSonar: true,
    coreOverride: { rangeKm: 22, detectionRangeKm: 200 },   // ASROC 反潛火箭 ~22km
    waypoints: [[123.20, 22.65], [123.35, 22.82]],
  }),
  mkUnit("BLUE-FFG-02", "blue", "ship_surface", "FFG-1103", "成功級 - 側衛", 122.75, 22.18, {
    speedKnots: 16,
    activeSonar: true,
    coreOverride: { rangeKm: 22, detectionRangeKm: 200 },
    waypoints: [[123.05, 22.48], [123.28, 22.72]],
  }),

  // 1 獵殺潛艦（被動潛聽，伴護於船團側翼；重型魚雷 ~18km）
  mkUnit("BLUE-SS-01", "blue", "submarine", "SS-794", "劍龍級 - 海虎", 122.78, 22.28, {
    speedKnots: 9,
    coreOverride: { rangeKm: 18, hpMax: 220 },
    waypoints: [[123.08, 22.55], [123.28, 22.78]],
  }),

  // 1 P-8 反潛機（聲標被動偵潛 — 大範圍掃蕩）
  mkUnit("BLUE-P8-01", "blue", "drone", "VP-ROC", "P-8A 反潛機", 122.90, 22.30, {
    speedKnots: 300,
    coreOverride: { detectionRangeKm: 300, hpMax: 100 },
    waypoints: [
      [123.25, 22.60], [123.35, 22.85], [123.05, 22.55], [122.90, 22.30],
    ],
  }),
];

// ── 紅方：2 艘潛艦於船團航道上伏擊（安靜潛行，伺機魚雷攻擊補給艦）──
const RED_UNITS: Unit[] = [
  // 093B 核潛艦 — 伏於航道前段
  mkUnit("RED-SSN-01", "red", "submarine", "093B-21", "093B 攻擊潛艦", 123.20, 22.60, {
    speedKnots: 5,                 // 慢速 = 安靜 = 難偵獲
    coreOverride: { rangeKm: 15, hpMax: 200 },   // 重型魚雷 ~15km
    waypoints: [[123.10, 22.52], [123.05, 22.48]],
  }),
  // 039C 柴電潛艦 — 另一軸線伏擊
  mkUnit("RED-SS-02", "red", "submarine", "039C-336", "039C 元級", 122.98, 22.42, {
    speedKnots: 5,
    coreOverride: { rangeKm: 14, hpMax: 180 },
    waypoints: [[123.08, 22.50], [123.12, 22.55]],
  }),
];

const NEUTRAL_UNITS: Unit[] = [
  mkUnit("NEU-SH-01", "neutral", "ship_surface", "MV-LNG", "LNG 運輸船", 123.40, 22.10, {
    speedKnots: 15, waypoints: [[123.15, 22.45], [122.95, 22.75]],
  }),
];

export const ASW_ESCORT_2031: Scenario = {
  id: "asw_escort_2031",
  displayName: "反潛護航 2031",
  briefing: "高價值補給艦團通過台灣東部深水區，2 艘解放軍潛艦潛伏伏擊。藍方反潛群（巡防艦主動聲納 + P-8 反潛機 + 獵殺潛艦）須在敵潛艦進入魚雷射程前偵獲擊沉。主動聲納偵潛遠但會曝露自身；潛艦安靜潛行難覓。",
  startSimTimeSec: 0,
  durationSec: 2400,
  sides: SIDES,
  units: [...BLUE_UNITS, ...RED_UNITS, ...NEUTRAL_UNITS],
  pendingCommands: [],
  acousticModel: true,        // 啟用 E20 聲納方程式偵測
  sonarLayerDepthM: 60,       // 溫躍層深度
  camera: {
    center: [123.10, 22.40],
    zoom: 8.2,
    pitch: 35,
    bearing: 20,
  },
  victoryConditions: [
    // 補給艦存活到時限 = 藍方護航成功
    {
      kind: "preserve_unit",
      unitId: "BLUE-AOE-01",
      sideId: "blue",
      label: "護航成功 — 補給艦安全抵達",
    },
    // 擊沉補給艦 = 紅方勝
    {
      kind: "destroy_unit",
      unitId: "BLUE-AOE-01",
      sideId: "red",
      label: "伏擊成功 — 擊沉補給艦",
    },
    // 殲滅紅方潛艦 = 藍方勝
    {
      kind: "eliminate_side",
      targetSideId: "red",
      sideId: "blue",
      label: "反潛成功 — 擊沉所有敵潛艦",
    },
    { kind: "time_limit", label: "時限結束比殘存戰力" },
  ],
};
