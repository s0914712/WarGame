/**
 * 場景：伊朗 — 美國 荷莫茲海峽危機 2030
 *
 * 對稱結構：伊朗 (red) 用大量低成本不對稱兵力（飛彈快艇 / Shahed 自殺無人機 / 反艦彈道飛彈 / Kilo 潛艦）
 * 試圖封鎖荷莫茲海峽；美軍 (us) 派 CSG + 第五艦隊（Bahrain）+ Diego Garcia 戰略資產回應。
 *
 * 紅方戰略目標：在荷莫茲海峽核心區（~56.4E, 26.4N，海峽最窄處）維持 hold_area 20 分 = 封鎖成功
 * 美方戰略目標：殲滅伊朗 LSM/SSN/missile boat 群 → eliminate_side
 *
 * 戰術設計：
 *   - 紅方 4 個反艦彈道（Khorramshahr / 改型 Khalij Fars）開戰 5 min 內試圖打 USS Lincoln 與 Aegis DDG
 *   - 紅方 12 IRGC 快艇 + 6 Shahed-136 飽和飛彈船團
 *   - 紅方 3 Kilo SSK 從北側包夾
 *   - 美方 CVN-72 + 4 Aegis DDG + 2 SSN + 1 P-8 海上巡邏
 *   - 美方 Diego Garcia 起飛 4 F-35（航程極長，但燃料即將用盡返航）
 *
 * 預期時長：60+ 分鐘。建議速率 30×。
 *
 * 注意：座標 / 兵力配置為純推演用，與實際美伊軍力 / 部署位置不一定一致。
 */
import type { Scenario, Side, Unit } from "../types";
import { UNIT_CATALOG } from "../catalog/units";
import { SIDE_COLORS } from "../symbology/sideColors";

const SIDES: Side[] = [
  { id: "blue",    displayName: "中華民國國軍（無參與）",
    colorPrimary: SIDE_COLORS.blue.primary, colorSecondary: SIDE_COLORS.blue.secondary,
    isPlayer: false, ownership: "scripted", isHostileTo: [] },
  { id: "us",      displayName: "美國海軍 第五艦隊",
    colorPrimary: SIDE_COLORS.us.primary, colorSecondary: SIDE_COLORS.us.secondary,
    isPlayer: true, ownership: "human", isHostileTo: ["red"] },
  { id: "red",     displayName: "伊朗 IRGC + IRIN",
    colorPrimary: SIDE_COLORS.red.primary, colorSecondary: SIDE_COLORS.red.secondary,
    isPlayer: true, ownership: "human", isHostileTo: ["us"] },
  { id: "neutral", displayName: "民用 商船",
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
// 美方 — CSG + 第五艦隊 + Diego Garcia 戰略資產
// ════════════════════════════════════════════════
const US_UNITS: Unit[] = [
  // ── CVN-72 Abraham Lincoln 戰鬥群（阿拉伯海北部）──
  mkUnit("US-CVN-72", "us", "ship_surface", "CVN-72", "USS Abraham Lincoln", 58.40, 25.20,
    { speedKnots: 28, coreOverride: { hpMax: 1200, detectionRangeKm: 600 },
      supplyOverride: { rangeKm: 25, fuelKmPerSec: 30, ammoPerSec: 0.6 } }),
  mkUnit("US-DDG-1", "us", "ship_surface", "DDG-91 Pinckney", "Aegis BMD #1", 58.20, 25.18,
    { coreOverride: { hpMax: 500, rangeKm: 180, detectionRangeKm: 400 } }),
  mkUnit("US-DDG-2", "us", "ship_surface", "DDG-65 Benfold", "Aegis BMD #2", 58.55, 25.22,
    { coreOverride: { hpMax: 500, rangeKm: 180, detectionRangeKm: 400 } }),
  mkUnit("US-DDG-3", "us", "ship_surface", "DDG-87 Mason", "Aegis BMD #3", 58.40, 25.05,
    { coreOverride: { hpMax: 500, rangeKm: 180, detectionRangeKm: 400 } }),
  mkUnit("US-DDG-4", "us", "ship_surface", "DDG-103 Truxtun", "Aegis BMD #4", 58.40, 25.35,
    { coreOverride: { hpMax: 500, rangeKm: 180, detectionRangeKm: 400 } }),

  // ── 第五艦隊 Bahrain base 出發 ──
  mkUnit("US-DDG-5", "us", "ship_surface", "DDG-58 Laboon", "5th Fleet DDG", 50.55, 26.21,
    { coreOverride: { hpMax: 500, rangeKm: 180 } }),
  mkUnit("US-DDG-6", "us", "ship_surface", "DDG-105 Dewey", "5th Fleet DDG", 50.62, 26.18,
    { coreOverride: { hpMax: 500, rangeKm: 180 },
      waypoints: [[55.00, 26.00], [56.20, 26.40]] }),

  // ── 攻擊潛艦（已潛航於波斯灣外）──
  mkUnit("US-SSN-1", "us", "submarine", "SSN-769 Toledo", "Virginia class", 58.10, 24.80,
    { stealth: 0.85, coreOverride: { hpMax: 400, rangeKm: 250 } }),
  mkUnit("US-SSN-2", "us", "submarine", "SSN-778 New Hampshire", "Virginia class", 57.20, 25.00,
    { stealth: 0.85, coreOverride: { hpMax: 400, rangeKm: 250 } }),

  // ── 戰機（CVW-9 on CVN-72）──
  mkUnit("US-F35-1", "us", "fighter", "VFA-147 #1", "F-35C Lightning II", 58.40, 25.20,
    { speedKnots: 550, stealth: 0.7, coreOverride: { hpMax: 90, rangeKm: 240, movementRangeKm: 2200 } }),
  mkUnit("US-F35-2", "us", "fighter", "VFA-147 #2", "F-35C Lightning II", 58.45, 25.22,
    { speedKnots: 550, stealth: 0.7, coreOverride: { hpMax: 90, rangeKm: 240, movementRangeKm: 2200 } }),
  mkUnit("US-F18-1", "us", "fighter", "VFA-22 #1", "F/A-18E Super Hornet", 58.42, 25.18,
    { speedKnots: 500, coreOverride: { hpMax: 80, rangeKm: 180, movementRangeKm: 1700 } }),
  mkUnit("US-F18-2", "us", "fighter", "VFA-22 #2", "F/A-18E Super Hornet", 58.38, 25.21,
    { speedKnots: 500, coreOverride: { hpMax: 80, rangeKm: 180, movementRangeKm: 1700 } }),

  // ── 反潛 P-8 海上巡邏（Al Udeid base, Qatar）──
  mkUnit("US-P8-1", "us", "fighter", "VP-30 #1", "P-8A Poseidon ASW", 51.30, 25.10,
    { speedKnots: 380, coreOverride: { hpMax: 70, rangeKm: 130, movementRangeKm: 4000, detectionRangeKm: 480 } }),

  // ── 補給艦 ──
  mkUnit("US-AOE-1", "us", "supply_ship", "T-AOE-6 Supply", "Combat Logistics Ship", 56.80, 24.50,
    { coreOverride: { hpMax: 300 } }),

  // ── Diego Garcia → 阿拉伯海 戰略支援（航程接近極限）──
  mkUnit("US-B2-1", "us", "fighter", "B-2 Spirit", "Diego Garcia strategic", 60.50, 22.00,
    { speedKnots: 480, stealth: 0.92, coreOverride: { hpMax: 100, rangeKm: 300, movementRangeKm: 5500 } }),
];

// ════════════════════════════════════════════════
// 伊朗 紅方 — IRGC 不對稱戰力 + IRIN
// ════════════════════════════════════════════════
const RED_UNITS: Unit[] = [
  // ── 反艦彈道飛彈（Bandar Abbas / Jask 海岸）──
  mkUnit("RED-ASBM-1", "red", "missile_launcher", "Khalij Fars #1", "改型反艦彈道", 56.35, 27.20,
    { coreOverride: { rangeKm: 300, hpMax: 80, detectionRangeKm: 0 } }),
  mkUnit("RED-ASBM-2", "red", "missile_launcher", "Khalij Fars #2", "改型反艦彈道", 56.45, 27.18,
    { coreOverride: { rangeKm: 300, hpMax: 80, detectionRangeKm: 0 } }),
  mkUnit("RED-ASBM-3", "red", "missile_launcher", "Khorramshahr-4", "戰略中程", 56.95, 25.61,
    { coreOverride: { rangeKm: 800, hpMax: 100, detectionRangeKm: 0 } }),
  mkUnit("RED-ASBM-4", "red", "missile_launcher", "Khorramshahr-5", "戰略中程", 57.05, 25.55,
    { coreOverride: { rangeKm: 800, hpMax: 100, detectionRangeKm: 0 } }),

  // ── 海岸反艦巡弋（Noor / Qader / Hoot）──
  mkUnit("RED-CSL-1", "red", "sam_coastal", "Noor Bty A", "海岸反艦 Noor", 56.20, 27.10,
    { coreOverride: { rangeKm: 120, detectionRangeKm: 200 } }),
  mkUnit("RED-CSL-2", "red", "sam_coastal", "Noor Bty B", "海岸反艦 Noor", 56.60, 26.95,
    { coreOverride: { rangeKm: 120, detectionRangeKm: 200 } }),
  mkUnit("RED-CSL-3", "red", "sam_coastal", "Qader Bty A", "海岸反艦 Qader", 57.30, 26.50,
    { coreOverride: { rangeKm: 200, detectionRangeKm: 220 } }),

  // ── IRGCN 快艇群（飛彈艇 + 自殺艇）──
  ...Array.from({ length: 12 }, (_, i) => {
    const lng = 56.10 + (i * 0.08);
    const lat = 26.70 - (i % 2) * 0.15;
    return mkUnit(`RED-FAC-${i + 1}`, "red", "ship_surface", `IRGCN-${i + 1}`, "Houdong 快艇",
      lng, lat, {
        speedKnots: 45, coreOverride: { hpMax: 60, rangeKm: 60, movementRangeKm: 400, detectionRangeKm: 50 },
        waypoints: [[56.40, 26.45]],
      });
  }),

  // ── Kilo 級攻擊潛艦（IRIN）──
  mkUnit("RED-SSK-1", "red", "submarine", "Tareq 901", "Kilo class", 57.50, 26.40,
    { stealth: 0.7, coreOverride: { hpMax: 250, rangeKm: 80 } }),
  mkUnit("RED-SSK-2", "red", "submarine", "Noor 902", "Kilo class", 56.20, 26.60,
    { stealth: 0.7, coreOverride: { hpMax: 250, rangeKm: 80 } }),
  mkUnit("RED-SSK-3", "red", "submarine", "Yunes 903", "Kilo class", 56.80, 25.80,
    { stealth: 0.7, coreOverride: { hpMax: 250, rangeKm: 80 } }),

  // ── Shahed-136 自殺無人機群（從 Bandar Abbas 出擊）──
  ...Array.from({ length: 6 }, (_, i) => {
    return mkUnit(`RED-UAV-${i + 1}`, "red", "drone", `Shahed-${i + 1}`, "Shahed-136 自殺",
      56.30 + (i * 0.05), 27.10, {
        speedKnots: 100, stealth: 0.55,
        coreOverride: { hpMax: 25, rangeKm: 40, movementRangeKm: 2500, detectionRangeKm: 10 },
        waypoints: [[58.40, 25.20]],   // 朝 CSG 中心飛
      });
  }),

  // ── 戰機 ──
  mkUnit("RED-F14-1", "red", "fighter", "TFB-8 F-14A #1", "F-14A Tomcat (改裝)", 56.95, 27.45,
    { speedKnots: 480, coreOverride: { hpMax: 65, rangeKm: 150, movementRangeKm: 1300 } }),
  mkUnit("RED-F14-2", "red", "fighter", "TFB-8 F-14A #2", "F-14A Tomcat (改裝)", 57.00, 27.45,
    { speedKnots: 480, coreOverride: { hpMax: 65, rangeKm: 150, movementRangeKm: 1300 } }),
  mkUnit("RED-MIG-1", "red", "fighter", "TFB-8 MiG-29 #1", "MiG-29 Fulcrum", 56.92, 27.43,
    { speedKnots: 540, coreOverride: { hpMax: 60, rangeKm: 100, movementRangeKm: 1500 } }),

  // ── 雷達 ──
  mkUnit("RED-RAD-1", "red", "radar_station", "Ghadir-A", "Bandar Abbas 主雷達", 56.30, 27.20),
  mkUnit("RED-RAD-2", "red", "radar_station", "Ghadir-B", "Jask 雷達", 57.80, 25.65),
  mkUnit("RED-MRD-1", "red", "mobile_radar", "Matla-ul-Fajr 1", "機動雷達 - 海岸", 57.40, 26.85),

  // ── 機場 ──
  mkUnit("RED-AB-1", "red", "airbase", "TFB-8 Bandar Abbas", "Bandar Abbas 空軍基地", 56.38, 27.22),
  mkUnit("RED-AB-2", "red", "airbase", "TFB-9 Bushehr", "Bushehr 空軍基地", 50.83, 28.95),
];

// 中立 — 商船 / 油輪
const NEUTRAL_UNITS: Unit[] = [
  mkUnit("NEU-MV-1", "neutral", "ship_surface", "MV Lima", "商船", 55.50, 25.80,
    { speedKnots: 12, coreOverride: { hpMax: 150 }, waypoints: [[58.00, 25.50]] }),
  mkUnit("NEU-MV-2", "neutral", "ship_surface", "MV Mike", "油輪", 56.50, 26.20,
    { speedKnots: 10, coreOverride: { hpMax: 200 }, waypoints: [[59.00, 25.00]] }),
];

export const IRAN_HORMUZ_2030: Scenario = {
  id: "iran_hormuz_2030",
  displayName: "荷莫茲海峽危機 2030 · Iran vs USN",
  briefing: {
    zh: `H 時：伊朗對美國第五艦隊發動不對稱攻勢，試圖封鎖荷莫茲海峽（全球 ~20% 原油運輸）。

【伊朗】4 反艦彈道（含 2 戰略 Khorramshahr）/ 3 海岸 Noor-Qader 飛彈 / 12 IRGCN 快艇 / 3 Kilo SSK / 6 Shahed-136 自殺無人機 / 戰機 F-14A + MiG-29 + 2 機場 + 2 雷達。戰術：飽和攻擊 CSG。

【美國】CVN-72 USS Lincoln + 6 Aegis DDG（4 護航 + 2 第五艦隊）/ 2 SSN-Virginia / F-35C/F-18E 各 2 / P-8 反潛 / B-2 從 Diego Garcia 戰略支援 / 1 補給艦。任務：保護 CVN、殲滅伊朗水面 / 水下戰力。

勝利條件：
• 伊朗 — 在荷莫茲海峽核心區（56.4°E, 26.4°N，半徑 30 km）維持 hold 20 分 = 封鎖成立 = 紅勝
• 美國 — 殲滅伊朗所有 兵力（快艇 + SSK + ASBM） = 藍勝
• 90 分時限 — 比殘存戰力`,
    en: `H-Hour: Iran launches asymmetric attack on US 5th Fleet to close the Strait of Hormuz (~20% of global oil shipping transits here).

【Iran】4 anti-ship ballistic missiles (incl. 2 strategic Khorramshahr) / 3 coastal Noor-Qader batteries / 12 IRGCN fast attack craft / 3 Kilo SSK / 6 Shahed-136 kamikaze drones / F-14A + MiG-29 fighters + 2 airbases + 2 radars. Doctrine: saturation strike on CSG.

【USA】CVN-72 USS Abraham Lincoln + 6 Aegis DDG (4 escorts + 2 5th Fleet) / 2 Virginia-class SSN / F-35C × 2 + F/A-18E × 2 / P-8A ASW / B-2 strategic support from Diego Garcia / 1 logistics ship. Mission: protect CVN, neutralize Iranian surface/subsurface threat.

Victory conditions:
• Iran wins — hold the strait choke point (56.4°E 26.4°N, radius 30 km) for 20 min
• USA wins — eliminate all Iranian forces (FAC + SSK + ASBM)
• 90-min time limit fallback — compare surviving combat power`,
  },
  startSimTimeSec: 0,
  durationSec: 5400,
  sides: SIDES,
  units: [...US_UNITS, ...RED_UNITS, ...NEUTRAL_UNITS],
  pendingCommands: [],
  camera: {
    center: [57.20, 26.30],
    zoom: 6.2,
    pitch: 35,
    bearing: 0,
  },
  victoryConditions: [
    // 伊朗封鎖海峽 hold 20 分 = 紅勝
    { kind: "hold_area", centerLngLat: [56.40, 26.40], radiusKm: 30, sideId: "red", forSec: 1200,
      label: "伊朗封鎖荷莫茲核心區（hold 20 分）" },
    // 美方殲滅紅方 = 藍勝
    { kind: "eliminate_side", targetSideId: "red", sideId: "us",
      label: "美方殲滅伊朗全部兵力" },
    // 時限結束 fallback
    { kind: "time_limit", label: "90 分時限 — 比殘存戰力" },
  ],
};
