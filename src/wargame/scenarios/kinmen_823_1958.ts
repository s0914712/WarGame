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
  /**
   * 明確武器掛載 — 設了就**繞過** catalog defaultLoadout（避免新武器系統把 1958
   * 船艦塞進現代 sam_ship/ciws/asm/torpedo 組合，導致海戰互相攔截打不死人）。
   * 1958 期：岸砲/艦砲 → asm（短射程，當砲彈用）、魚雷艇 → torpedo、補給艦 → 無武器。
   */
  weapons?: Unit["weapons"];
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
  // 有明確 weapons → ammo 由各彈艙加總，否則沿用 opts.ammoMax / catalog 預設
  const ammoMax = opts.weapons
    ? opts.weapons.reduce((s, m) => s + m.ammoMax, 0)
    : (opts.ammoMax ?? cat.defaultAmmoMax);
  const ammoCurrent = opts.weapons
    ? opts.weapons.reduce((s, m) => s + m.ammoCurrent, 0)
    : ammoMax;
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
    ammoCurrent,
    ...(opts.weapons ? { weapons: opts.weapons } : {}),
    detectedBy: {},
    lastTickSimSec: 0,
  };
}

// 1958 期武器掛載（繞過現代 catalog defaultLoadout：避免 sam_ship/ciws 點防禦互相攔截）。
// 引擎無「艦砲」武器 → 借 asm（短射程，當砲彈用）；魚雷艇用 torpedo。射程沿用 core.rangeKm。
const GUN = (ammo: number): Unit["weapons"] => [{ weaponId: "asm", ammoCurrent: ammo, ammoMax: ammo }];
const TORP = (ammo: number): Unit["weapons"] => [{ weaponId: "torpedo", ammoCurrent: ammo, ammoMax: ammo }];

// 岸砲共用調校：固定砲位、坑道硬化高 HP、跨海峽自我觀測。
// 彈量刻意壓低（asm 每發 ~60% HP，太多發會把海上船團瞬間清空）→ 以反砲戰為主。
const ARTY = (rangeKm: number, hpMax = 120): MkOpts => ({
  core: { rangeKm, speedKnots: 0, movementRangeKm: 0, detectionRangeKm: 26, hpMax },
  weapons: GUN(10),
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
  // 注意：勿放進料羅灣 hold_area（半徑 4km）內，否則開局即「控制目標區」→ t≈300 誤判勝利
  mkUnit("BLUE-ART-04", "blue", "missile_launcher", "M55八吋", "M55 八吋自走砲（203mm，反砲戰主力）", 118.36, 24.46, {
    core: { rangeKm: 24, speedKnots: 0, movementRangeKm: 6, detectionRangeKm: 28, hpMax: 100 },
    weapons: GUN(14),
  }),

  // ── 觀測哨（無武器，提供守軍跨海峽眼睛）──
  mkUnit("BLUE-OP-01", "blue", "radar_station", "太武觀測", "太武山觀測所", 118.40, 24.44, {
    core: { detectionRangeKm: 32, hpMax: 150 },
  }),

  // ── 運補船團（鴻運／閃電計畫）：中字號 LST／LSM，自外海衝向料羅灣 ──
  // 中海艦 LST（運補旗艦，史實九二海戰中重創）
  // 速度刻意拉高（史實 LST ~12kt，此處為「強行衝灘」全速）→ 約 t=1800 抵料羅灣，
  // 對齊分鏡「衝進料羅灣」並讓 hold_area 在時限內完成。
  mkUnit("BLUE-LST-01", "blue", "supply_ship", "中海", "中海艦 LST（運補旗艦）", 118.56, 24.26, {
    speedKnots: 22,
    waypoints: [[118.50, 24.33], [118.46, 24.38], [118.42, 24.40]],
    core: { hpMax: 420 },
  }),
  // 臺生輪（運補，史實遭擊沉）
  mkUnit("BLUE-LST-02", "blue", "supply_ship", "臺生", "臺生輪（運補）", 118.58, 24.24, {
    speedKnots: 22,
    waypoints: [[118.52, 24.31], [118.47, 24.37], [118.43, 24.40]],
    core: { hpMax: 360 },
  }),
  // 美堅號 LSM-249（九二海戰實際卸載艦，載「彈道測向儀」雷達 + 美軍顧問 + 中外記者 30 餘人）
  mkUnit("BLUE-LSM-01", "blue", "supply_ship", "美堅", "美堅號 LSM-249（載彈道測向儀）", 118.60, 24.27, {
    speedKnots: 20,
    waypoints: [[118.53, 24.33], [118.48, 24.38], [118.44, 24.41]],
    core: { hpMax: 300 },
  }),

  // ── 護航支隊（總指揮黎玉璽少將；1958 艦砲射程 ~12 km）──
  // 沱江號 PC-1247 驅潛艦（艦長劉溢川少校）— 九二海戰主角：主砲卡彈遭砲艇圍攻、彈孔 70 餘、
  // 10 餘陣亡，失去動力後由維源/柳江拖回，戰後評估無修復價值除役。低 HP 反映其脆弱。
  mkUnit("BLUE-DD-01", "blue", "ship_surface", "沱江", "沱江號 PC-1247 驅潛艦（艦長劉溢川）", 118.55, 24.30, {
    speedKnots: 26,
    waypoints: [[118.49, 24.35], [118.45, 24.39], [118.45, 24.42]],
    core: { rangeKm: 12, detectionRangeKm: 24, hpMax: 150 },
    weapons: GUN(18),
  }),
  // 維源號 PCE-869 巡邏艦（旗艦 · 支隊長姚道義上校）
  mkUnit("BLUE-DD-02", "blue", "ship_surface", "維源", "維源號 PCE-869 巡邏艦（旗艦·姚道義）", 118.52, 24.28, {
    speedKnots: 24,
    waypoints: [[118.47, 24.34], [118.44, 24.38], [118.42, 24.42]],
    core: { rangeKm: 12, detectionRangeKm: 26, hpMax: 200 },
    weapons: GUN(24),
  }),
  // 柳江號 PC-461 驅潛艦（艦長李仕材少校）
  mkUnit("BLUE-DD-03", "blue", "ship_surface", "柳江", "柳江號 PC-461 驅潛艦（艦長李仕材）", 118.54, 24.32, {
    speedKnots: 26,
    waypoints: [[118.48, 24.36], [118.45, 24.40], [118.44, 24.42]],
    core: { rangeKm: 12, detectionRangeKm: 24, hpMax: 180 },
    weapons: GUN(22),
  }),
];

const RED_UNITS: Unit[] = [
  // ── 福建沿海一線岸砲群（569 門火砲之代表性砲位）──
  // 廈門砲群（130mm 海岸砲群，瞰制金門西側）
  mkUnit("RED-ART-01", "red", "missile_launcher", "廈門砲群", "廈門前沿 130mm 海岸砲群", 118.08, 24.45, ARTY(24)),
  // 圍頭砲群（距料羅最近，瞰制料羅灣航道）
  mkUnit("RED-ART-02", "red", "missile_launcher", "圍頭砲群", "圍頭 152mm 加農砲群（瞰制料羅灣）", 118.59, 24.51, ARTY(17)),
  // 蓮河砲群
  mkUnit("RED-ART-03", "red", "missile_launcher", "蓮河砲群", "蓮河 152mm 榴彈砲群", 118.38, 24.57, ARTY(20)),
  // 大嶝島砲群（對古寧頭、瞰制北航道）
  mkUnit("RED-ART-04", "red", "missile_launcher", "大嶝砲群", "大嶝島 122mm 榴彈砲群", 118.32, 24.55, ARTY(18)),

  // ── 東海艦隊魚雷快艇大隊（九二海戰出動 6 艘 123-K/B 型，參謀長張逸民指揮·174 艇）──
  // 自廈門 / 大嶝錨地外海待命（金門岸砲射程外），夜間沿北水道高速殺出攔截船團。
  // 史實：劇烈顛簸損失 1/3 魚雷、雷達誤判目標、魚雷定深 3m 過深均脫靶；撤退中 180 艇舵損
  // 遭 174 艇相撞沉沒、174 艇再被國軍砲火擊沉。起點拉遠 → 約 t=1300 進料羅外海接戰。
  mkUnit("RED-TB-01", "red", "ship_surface", "魚雷174", "魚雷快艇 174（張逸民·123-K 型）", 118.13, 24.57, {
    speedKnots: 42, waypoints: [[118.30, 24.47], [118.43, 24.40]],
    core: { rangeKm: 8, speedKnots: 42, detectionRangeKm: 14, hpMax: 70 }, weapons: TORP(4),
  }),
  mkUnit("RED-TB-02", "red", "ship_surface", "魚雷177", "魚雷快艇 177（123-K 型）", 118.15, 24.59, {
    speedKnots: 42, waypoints: [[118.32, 24.48], [118.44, 24.41]],
    core: { rangeKm: 8, speedKnots: 42, detectionRangeKm: 14, hpMax: 70 }, weapons: TORP(4),
  }),
  mkUnit("RED-TB-03", "red", "ship_surface", "魚雷180", "魚雷快艇 180（123-K 型）", 118.10, 24.55, {
    speedKnots: 40, waypoints: [[118.28, 24.45], [118.42, 24.39]],
    core: { rangeKm: 8, speedKnots: 40, detectionRangeKm: 14, hpMax: 70 }, weapons: TORP(4),
  }),

  // ── 55 甲型 75 噸快速砲艇（大隊長魏垣武）：以雙管 37mm 機砲與沱江近距對轟 ──
  mkUnit("RED-GB-01", "red", "ship_surface", "砲艇556", "55 甲型快速砲艇 556（37mm）", 118.16, 24.54, {
    speedKnots: 30, waypoints: [[118.31, 24.46], [118.43, 24.41]],
    core: { rangeKm: 6, speedKnots: 30, detectionRangeKm: 12, hpMax: 90 }, weapons: GUN(20),
  }),
  mkUnit("RED-GB-02", "red", "ship_surface", "砲艇557", "55 甲型快速砲艇 557（37mm）", 118.18, 24.56, {
    speedKnots: 30, waypoints: [[118.33, 24.47], [118.44, 24.40]],
    core: { rangeKm: 6, speedKnots: 30, detectionRangeKm: 12, hpMax: 90 }, weapons: GUN(20),
  }),
  mkUnit("RED-GB-03", "red", "ship_surface", "砲艇558", "55 甲型快速砲艇 558（37mm）", 118.14, 24.52, {
    speedKnots: 30, waypoints: [[118.29, 24.44], [118.42, 24.40]],
    core: { rangeKm: 6, speedKnots: 30, detectionRangeKm: 12, hpMax: 90 }, weapons: GUN(20),
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
      "兩小時內落彈約 5.7 萬發，副司令官趙家驤、章傑陣亡。共軍封鎖外援、逼金門撤守，守軍每日需補給約 300 噸。\n" +
      "本場景聚焦 9 月 1–2 日「九二海戰」（料羅灣海戰）：美堅號 LSM-249 載「彈道測向儀」雷達與美軍顧問搶運料羅，" +
      "由海軍副總司令黎玉璽指揮、姚道義旗艦維源號率沱江、柳江護航。解放軍張逸民魚雷快艇大隊（174 等 6 艇）與" +
      "魏垣武 55 甲型砲艇（556/557/558）夜襲船團——魚雷因定深過深、誤判目標全脫靶，砲艇與沱江近距對轟（沱江主砲卡彈、" +
      "彈孔 70 餘、10 餘殉職、重創除役），撤退中共軍 174、180 艇相撞 / 遭砲火擊沉。把運補艦安全送進料羅灣卸載，即為勝利。",
    en: "23 Aug 1958, 17:30 — PLA shore batteries (Xiamen, Weitou, Lianhe, Dadeng) open a surprise " +
      "bombardment of Kinmen: ~57,000 shells in two hours, killing deputy commanders Zhao Jiaxiang and Zhang Jie. " +
      "Kinmen needs ~300 tons of supply a day.\n" +
      "This scenario centers on the Battle of Liaoluo Bay (1–2 Sep). LSM-249 Meijian runs a ballistic " +
      "direction-finding radar and US advisors into Liaoluo, escorted by flagship Weiyuan (PCE-869, Cdr Yao Daoyi) " +
      "with Tuojiang (PC-1247) and Liujiang (PC-461) under VADM Li Yuxi. Zhang Yimin's torpedo-boat squadron (boat 174 " +
      "and five others) and Wei Yuanwu's 55-type gunboats (556/557/558) ambush at night — the torpedoes all miss " +
      "(set too deep, wrong target), the gunboats trade fire with Tuojiang (jammed main gun, 70+ holes, crippled), " +
      "and PLA boats 174 and 180 are lost in the retreat. Land the supply ship at Liaoluo to win.",
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
      requireKinds: ["supply_ship"], // 必須是運補艦抵達卸載（岸砲/護航艦在區內不算）
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
