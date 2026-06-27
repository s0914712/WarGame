/**
 * 場景：823 砲戰 · 運補突圍（1958-08-23 起 · 第二次台灣海峽危機）
 *
 * 史實設定（參 zh.wikipedia「金門炮戰」）：
 *   1958-08-23 17:30，解放軍福州軍區前線指揮所（司令葉飛）以廈門、圍頭、蓮河、大嶝
 *   一線岸砲群（569 門火砲）對金門發動突襲砲擊，兩小時內傾瀉約 5.7 萬發砲彈，
 *   金防部副司令官趙家驤、章傑當場陣亡，吉星文三日後傷重不治，國防部長俞大維、
 *   金防部司令胡璉受傷。共軍意在封鎖金門外援、迫使外島撤守。
 *
 *   戰略關鍵在「補給」——金門軍民每日需補給約 300 噸。國軍以中字號 LST／LSM 組成
 *   運補船團，在沱江、維源等艦掩護下，冒砲火與東海艦隊魚雷快艇攔截強行駛入料羅灣
 *   卸載（即 9/1–2 料羅灣海戰／九二海戰）。9/7 起「閃電計畫」由美軍第七艦隊護航至
 *   金門外 3 浬，9/8 美樂號 LSM 中彈、臺生輪沉沒、中海艦重創。10/25 後共軍改「單打
 *   雙不打」，砲戰象徵性延續至 1979。
 *
 * 玩家（藍 / 國軍，金防部）目標：守住金門，把運補船團安全送進料羅灣完成卸載。
 *
 * 引擎對應（v1 無專屬「火砲」kind，借用 missile_launcher 重新命名為岸砲）：
 *   - 岸砲對轟 → missile_launcher（land；射程依砲種砍到 11–24 km，彈量加大模擬持續砲擊）
 *   - 魚雷快艇 → ship_surface（高速、短射程魚雷、低 HP）
 *   - 運補 LST/LSM → supply_ship（受保護資產，冒火衝料羅灣）
 *   - 護航艦   → ship_surface（1958 艦砲射程 ~12 km）
 *   - 觀測哨   → radar_station（改稱觀測所，短偵測、無武器）
 * 戰鬥模型 rules/v1 的 canEngage 不檢查 domain，故陸對陸砲擊原生可跑。
 */
import type { Scenario, Side, Unit } from "../types";
import { UNIT_CATALOG } from "../catalog/units";

const SIDES: Side[] = [
  {
    id: "blue",
    displayName: "國軍（金門防衛司令部 · 司令胡璉）",
    colorPrimary: "#3B82F6",
    colorSecondary: "#93C5FD",
    isPlayer: true,
    ownership: "human",
    isHostileTo: ["red"],
  },
  {
    id: "red",
    displayName: "解放軍（福州軍區前指 · 司令葉飛）",
    colorPrimary: "#EF4444",
    colorSecondary: "#FCA5A5",
    isPlayer: false,
    ownership: "scripted",
    isHostileTo: ["blue"],
  },
];

interface MkOpts {
  speedKnots?: number;
  waypoints?: [number, number][];
  /** 覆寫 catalog defaultCore 的任意欄位（射程 / 偵測 / HP 等 1958 調校） */
  core?: Partial<Unit["core"]>;
  /** 覆寫彈量（持續砲擊用大彈量；catalog 預設 missile_launcher 只有 4 發） */
  ammoMax?: number;
}

function mkUnit(
  id: string,
  sideId: Unit["sideId"],
  kind: Unit["kind"],
  callsign: string,
  displayName: string,
  lng: number, lat: number,
  opts: MkOpts = {},
): Unit {
  const cat = UNIT_CATALOG[kind];
  const core = { ...cat.defaultCore, ...(opts.core ?? {}) };
  if (opts.speedKnots !== undefined) core.speedKnots = opts.speedKnots;
  const ammoMax = opts.ammoMax ?? cat.defaultAmmoMax;
  return {
    id, sideId, kind, callsign, displayName,
    position: {
      lng, lat,
      altMeters: cat.defaultAltitudeM,
      headingDeg: 0, speedKnots: opts.speedKnots ?? 0,
    },
    waypoints: opts.waypoints ?? [],
    core, extensions: {},
    distanceTravelledKm: 0,
    hpCurrent: core.hpMax,
    ammoMax,
    ammoCurrent: ammoMax,
    detectedBy: {},
    lastTickSimSec: 0,
  };
}

// 岸砲共用調校：固定砲位、坑道硬化高 HP、彈量大（持續砲擊）、跨海峽自我觀測
const ARTY = (rangeKm: number, hpMax = 120): MkOpts => ({
  core: { rangeKm, speedKnots: 0, movementRangeKm: 0, detectionRangeKm: 26, hpMax },
  ammoMax: 60,
});

const BLUE_UNITS: Unit[] = [
  // ── 金門守軍岸砲（坑道砲兵陣地，固定）：初期共 308 門，此處取代表性砲位 ──
  // 155mm 加農砲（M59 Long Tom，射程遠）
  mkUnit("BLUE-ART-01", "blue", "missile_launcher", "太武155加", "太武山 155mm 加農砲陣地", 118.39, 24.44, ARTY(22)),
  // 155mm 榴彈砲
  mkUnit("BLUE-ART-02", "blue", "missile_launcher", "瓊林155榴", "瓊林 155mm 榴彈砲連", 118.39, 24.46, ARTY(15)),
  // 105mm 榴彈砲（對大嶝、蓮河）
  mkUnit("BLUE-ART-03", "blue", "missile_launcher", "古寧105榴", "古寧頭 105mm 榴彈砲連", 118.30, 24.49, ARTY(12)),
  // 9/26 投入的 M55 八吋（203mm）自走砲——一小時內摧毀圍頭砲陣地數十處
  mkUnit("BLUE-ART-04", "blue", "missile_launcher", "M55八吋", "M55 八吋自走砲（203mm，反砲戰主力）", 118.41, 24.43, {
    core: { rangeKm: 24, speedKnots: 0, movementRangeKm: 6, detectionRangeKm: 28, hpMax: 100 },
    ammoMax: 40,
  }),

  // ── 觀測哨（無武器，提供守軍跨海峽眼睛）──
  mkUnit("BLUE-OP-01", "blue", "radar_station", "太武觀測", "太武山觀測所", 118.40, 24.44, {
    core: { detectionRangeKm: 32, hpMax: 150 },
  }),

  // ── 運補船團（鴻運／閃電計畫）：中字號 LST／LSM，自外海衝向料羅灣 ──
  // 中海艦 LST（運補旗艦，史實九二海戰中重創）
  mkUnit("BLUE-LST-01", "blue", "supply_ship", "中海", "中海艦 LST（運補旗艦）", 118.56, 24.26, {
    speedKnots: 12,
    waypoints: [[118.50, 24.33], [118.46, 24.38], [118.42, 24.40]],
    core: { hpMax: 420 },
  }),
  // 臺生輪（運補，史實遭擊沉）
  mkUnit("BLUE-LST-02", "blue", "supply_ship", "臺生", "臺生輪（運補）", 118.58, 24.24, {
    speedKnots: 12,
    waypoints: [[118.52, 24.31], [118.47, 24.37], [118.43, 24.40]],
    core: { hpMax: 360 },
  }),
  // 美樂號 LSM（9/8 遭海岸砲第 150 連擊中，死傷 11）
  mkUnit("BLUE-LSM-01", "blue", "supply_ship", "美樂", "美樂號 LSM-242（運補）", 118.60, 24.27, {
    speedKnots: 11,
    waypoints: [[118.53, 24.33], [118.48, 24.38], [118.44, 24.41]],
    core: { hpMax: 300 },
  }),

  // ── 護航艦（1958 艦砲射程 ~12 km）──
  // 沱江號驅潛艦（九二海戰主力，史實重創仍力戰）
  mkUnit("BLUE-DD-01", "blue", "ship_surface", "沱江", "沱江號驅潛艦（護航）", 118.55, 24.30, {
    speedKnots: 26,
    waypoints: [[118.49, 24.35], [118.45, 24.39], [118.45, 24.42]],
    core: { rangeKm: 12, detectionRangeKm: 24, hpMax: 220 },
    ammoMax: 30,
  }),
  // 維源艦（永興號巡邏艦，護航）
  mkUnit("BLUE-DD-02", "blue", "ship_surface", "維源", "維源艦（永興號 · 護航）", 118.52, 24.28, {
    speedKnots: 24,
    waypoints: [[118.47, 24.34], [118.44, 24.38], [118.42, 24.42]],
    core: { rangeKm: 12, detectionRangeKm: 24, hpMax: 180 },
    ammoMax: 30,
  }),
];

const RED_UNITS: Unit[] = [
  // ── 福建沿海一線岸砲群（569 門火砲之代表性砲位）──
  // 廈門砲群（130mm 海岸砲群，瞰制金門西側）
  mkUnit("RED-ART-01", "red", "missile_launcher", "廈門砲群", "廈門前沿 130mm 海岸砲群", 118.08, 24.45, ARTY(24)),
  // 圍頭砲群（距料羅最近，瞰制料羅灣航道）
  mkUnit("RED-ART-02", "red", "missile_launcher", "圍頭砲群", "圍頭 152mm 加農砲群（瞰制料羅灣）", 118.59, 24.51, ARTY(22)),
  // 蓮河砲群
  mkUnit("RED-ART-03", "red", "missile_launcher", "蓮河砲群", "蓮河 152mm 榴彈砲群", 118.38, 24.57, ARTY(20)),
  // 大嶝島砲群（對古寧頭、瞰制北航道）
  mkUnit("RED-ART-04", "red", "missile_launcher", "大嶝砲群", "大嶝島 122mm 榴彈砲群", 118.32, 24.55, ARTY(18)),

  // ── 東海艦隊魚雷快艇（九二海戰出動 8 艘，高速、短射程、低 HP）──
  mkUnit("RED-TB-01", "red", "ship_surface", "魚雷艇1", "東海艦隊魚雷快艇 1", 118.22, 24.50, {
    speedKnots: 42, waypoints: [[118.35, 24.44], [118.43, 24.40]],
    core: { rangeKm: 8, speedKnots: 42, detectionRangeKm: 14, hpMax: 55 }, ammoMax: 4,
  }),
  mkUnit("RED-TB-02", "red", "ship_surface", "魚雷艇2", "東海艦隊魚雷快艇 2", 118.24, 24.52, {
    speedKnots: 42, waypoints: [[118.36, 24.45], [118.44, 24.41]],
    core: { rangeKm: 8, speedKnots: 42, detectionRangeKm: 14, hpMax: 55 }, ammoMax: 4,
  }),
  mkUnit("RED-TB-03", "red", "ship_surface", "魚雷艇3", "東海艦隊魚雷快艇 3", 118.20, 24.48, {
    speedKnots: 40, waypoints: [[118.34, 24.42], [118.42, 24.39]],
    core: { rangeKm: 8, speedKnots: 40, detectionRangeKm: 14, hpMax: 55 }, ammoMax: 4,
  }),

  // ── 觀測所 ──
  mkUnit("RED-OP-01", "red", "radar_station", "圍頭觀測", "圍頭觀測所", 118.58, 24.52, {
    core: { detectionRangeKm: 32, hpMax: 150 },
  }),
];

export const KINMEN_823_1958: Scenario = {
  id: "kinmen_823_1958",
  displayName: "823 砲戰 · 運補突圍 1958",
  briefing: {
    zh: "1958 年 8 月 23 日 17 時 30 分，解放軍廈門、圍頭、蓮河、大嶝一線岸砲群突襲砲擊金門，" +
      "兩小時內落彈約 5.7 萬發，副司令官趙家驤、章傑陣亡。共軍封鎖外援，逼金門撤守。" +
      "守軍每日需補給約 300 噸——國軍以中海、臺生、美樂等中字號運補船團，在沱江、維源護航下，" +
      "冒砲火與東海艦隊魚雷快艇攔截，強行駛入料羅灣卸載。守住金門、把船團安全送進料羅灣，即為勝利。",
    en: "23 Aug 1958, 17:30 — PLA shore batteries at Xiamen, Weitou, Lianhe and Dadeng open a surprise " +
      "bombardment of Kinmen: ~57,000 shells in two hours, killing deputy commanders Zhao Jiaxiang and " +
      "Zhang Jie. The PLA blockades resupply to force the offshore islands' abandonment. Kinmen needs " +
      "~300 tons of supply a day. The ROC runs LST/LSM convoys (Zhonghai, Taisheng, Meile), escorted by " +
      "Tuojiang and Weiyuan, through artillery fire and torpedo-boat interception into Liaoluo Bay to " +
      "unload. Hold Kinmen and land the convoy to win.",
  },
  startSimTimeSec: 0,
  durationSec: 2400, // 40 分鐘
  sides: SIDES,
  units: [...BLUE_UNITS, ...RED_UNITS],
  pendingCommands: [],
  camera: {
    center: [118.38, 24.42],
    zoom: 10.4,
    pitch: 45,
    bearing: 20,
  },
  victoryConditions: [
    // 藍方勝：運補船團進入料羅灣並停留卸載 5 分鐘
    {
      kind: "hold_area",
      centerLngLat: [118.42, 24.40], // 料羅灣
      radiusKm: 4,
      sideId: "blue",
      forSec: 300,
      label: "運補成功 — 補給船團進入料羅灣卸載 5 分鐘",
    },
    // 紅方勝：擊沉運補旗艦中海艦
    { kind: "destroy_unit", unitId: "BLUE-LST-01", sideId: "red", label: "共軍擊沉運補旗艦中海艦" },
    // 紅方勝（保底）：殲滅金門守軍與船團
    { kind: "eliminate_side", targetSideId: "blue", sideId: "red", label: "共軍殲滅金門守軍與船團" },
    // 時限結束比殘存戰力
    { kind: "time_limit", label: "時限結束 — 比殘存戰力" },
  ],
};
