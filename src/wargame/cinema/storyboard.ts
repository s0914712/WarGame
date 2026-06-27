/**
 * 紀錄片分鏡（storyboard）— 借鏡 battle-of-hong-kong-1941 的 director 資料模型。
 *
 * 一個 storyboard = 一連串 shot，每個 shot 綁一個 sim-time 起點（atSimSec）。
 * Director 在播放 / replay 時，依當下 simTime 找出「最後一個 atSimSec <= simTime」
 * 的 shot 當作 active shot，自動運鏡（Mapbox flyTo）+ 顯示雙語字幕。
 *
 * 與 HK 版差異：HK 讀自己預編的 track 插值座標；這裡時間軸直接吃兵棋引擎的
 * 權威 simTime（live tick 或 replayPlayer scrub 都通），不重做插值。
 */

export interface CinemaShot {
  /** 此鏡頭生效的 sim-time 起點（秒） */
  atSimSec: number;
  /** 字幕日期 / 時刻標籤 */
  dateLabel: string;
  titleZh: string;
  titleEn: string;
  narrZh: string;
  narrEn: string;
  /** Mapbox 相機關鍵格 */
  camera: { center: [number, number]; zoom: number; pitch: number; bearing: number };
  /** 此鏡頭聚焦的單位 id（給字幕殘存戰力統計 / 之後 marker 高亮用） */
  focus?: string[];
}

export interface Storyboard {
  scenarioId: string;
  shots: CinemaShot[];
}

/**
 * 823 砲戰 · 運補突圍 的分鏡。
 * 6 幕：突襲砲擊 → 守軍還擊 → 船團出港 → 魚雷艇攔截 → 料羅灣海戰 → 衝灘卸載 → 收尾拉遠。
 */
const KINMEN_823_STORYBOARD: Storyboard = {
  scenarioId: "kinmen_823_1958",
  shots: [
    {
      atSimSec: 0,
      dateLabel: "1958-08-23 17:30",
      titleZh: "突襲砲擊",
      titleEn: "The Surprise Bombardment",
      narrZh: "八月二十三日十七時三十分，福州軍區前指司令葉飛一聲令下，廈門、圍頭、蓮河、大嶝一線岸砲群同時開火；兩小時內五萬七千發砲彈傾瀉金門，副司令官趙家驤、章傑當場殉職。",
      narrEn: "17:30, 23 August — on Ye Fei's order, PLA shore batteries at Xiamen, Weitou, Lianhe and Dadeng open fire at once. 57,000 shells fall on Kinmen in two hours; deputy commanders Zhao Jiaxiang and Zhang Jie are killed on the spot.",
      camera: { center: [118.30, 24.47], zoom: 10.2, pitch: 50, bearing: 35 },
      focus: ["RED-ART-01", "RED-ART-02", "RED-ART-03", "RED-ART-04", "BLUE-ART-01"],
    },
    {
      atSimSec: 180,
      dateLabel: "1958-08 · 守軍還擊",
      titleZh: "太武山的回擊",
      titleEn: "Kinmen Returns Fire",
      narrZh: "金門守軍自坑道陣地還擊；其後 M55 八吋自走砲投入反砲戰，一小時內摧毀圍頭砲陣地數十處，守軍漸復戰力。",
      narrEn: "The ROC garrison answers from tunnel emplacements; the M55 eight-inch self-propelled guns soon join the counter-battery duel, smashing dozens of Weitou gun pits within an hour as the defenders recover.",
      camera: { center: [118.40, 24.45], zoom: 11.0, pitch: 55, bearing: 10 },
      focus: ["BLUE-ART-01", "BLUE-ART-02", "BLUE-ART-03", "BLUE-ART-04"],
    },
    {
      atSimSec: 420,
      dateLabel: "1958 · 運補出港",
      titleZh: "船團出港",
      titleEn: "The Convoy Sets Out",
      narrZh: "金門軍民每日需補給約三百噸。封鎖之下，黎玉璽副總司令指揮船團——美堅號載著「彈道測向儀」雷達，在旗艦維源率沱江、柳江護航下，自外海駛向料羅灣。",
      narrEn: "Kinmen needs some 300 tons of supply a day. Under blockade, VADM Li Yuxi leads the convoy — Meijian carrying the ballistic direction-finding radar, escorted by flagship Weiyuan with Tuojiang and Liujiang — toward Liaoluo Bay.",
      camera: { center: [118.50, 24.34], zoom: 10.6, pitch: 50, bearing: 330 },
      focus: ["BLUE-LST-01", "BLUE-LSM-01", "BLUE-DD-01", "BLUE-DD-02", "BLUE-DD-03"],
    },
    {
      atSimSec: 840,
      dateLabel: "1958-09-01 · 攔截",
      titleZh: "魚雷快艇出擊",
      titleEn: "Torpedo Boats Strike",
      narrZh: "張逸民率 174 等六艘魚雷快艇、魏垣武 55 甲型砲艇趁夜高速殺出——但海上劇烈顛簸，魚雷竟先損失三分之一，雷達還誤把脫隊的美堅號當成旗艦維源號。",
      narrEn: "Zhang Yimin's six torpedo boats (174 leading) and Wei Yuanwu's 55-type gunboats race out in the dark — but the heavy swell costs them a third of their torpedoes, and their radar mistakes the strayed Meijian for the flagship Weiyuan.",
      camera: { center: [118.38, 24.44], zoom: 11.0, pitch: 55, bearing: 300 },
      focus: ["RED-TB-01", "RED-TB-02", "RED-TB-03", "RED-GB-01", "RED-GB-02", "BLUE-LSM-01"],
    },
    {
      atSimSec: 1320,
      dateLabel: "1958-09-02 · 料羅灣海戰",
      titleZh: "料羅灣海戰（九二海戰）",
      titleEn: "Battle of Liaoluo Bay",
      narrZh: "魚雷定深三公尺、過深全脫靶；砲艇逼近與沱江對轟，沱江主砲卡彈、彈孔七十餘、十餘人殉職重創。維源、柳江趕至痛擊，撤退中共軍 180 艇舵損遭 174 艇相撞、174 艇再被砲火擊沉。",
      narrEn: "The torpedoes, set three metres deep, all run under their targets; the gunboats close in and trade fire with Tuojiang — her main gun jams, 70+ holes, a dozen dead. Weiyuan and Liujiang rush in; in the retreat PLA boat 180 loses steering and is rammed by 174, which is then sunk by gunfire.",
      camera: { center: [118.43, 24.41], zoom: 11.8, pitch: 58, bearing: 20 },
      focus: ["BLUE-DD-01", "BLUE-DD-02", "BLUE-DD-03", "RED-GB-01", "RED-GB-02", "RED-TB-01"],
    },
    {
      atSimSec: 1800,
      dateLabel: "1958-09 · 閃電計畫 · 進灣",
      titleZh: "衝進料羅灣",
      titleEn: "Into Liaoluo Bay",
      narrZh: "美堅號搶灘料羅，把「彈道測向儀」雷達與美軍顧問安全送上金門；沱江雖重創，仍完成將雷達運抵的機密任務——這正是金門得以撐住的命脈。",
      narrEn: "Meijian beaches at Liaoluo, landing the ballistic direction-finding radar and US advisors safely; Tuojiang, though crippled, completes its secret mission of delivering the radar — the lifeline that keeps Kinmen holding.",
      camera: { center: [118.43, 24.41], zoom: 12.2, pitch: 60, bearing: 0 },
      focus: ["BLUE-LST-01", "BLUE-LSM-01", "BLUE-DD-01"],
    },
    {
      atSimSec: 2100,
      dateLabel: "1958 · 單打雙不打",
      titleZh: "撐住的金門",
      titleEn: "Kinmen Holds",
      narrZh: "九二海戰後國軍改採外海換乘小艇轉運，運補不再中斷；沱江戰後獲頒榮譽虎旗。砲戰歷四十四天，十月二十五日後共軍改「單打雙不打」——金門守住了，海峽的分界線就此固定。",
      narrEn: "After Liaoluo the ROC switched to offshore transfer by small craft, and resupply never broke again; Tuojiang was later awarded the Honor Tiger Flag. The bombardment ran 44 days; from 25 October the PLA shelled on odd days only — Kinmen held, and the line across the strait was set.",
      camera: { center: [118.35, 24.44], zoom: 9.8, pitch: 45, bearing: 15 },
      focus: ["BLUE-LST-01", "BLUE-LST-02", "BLUE-ART-01"],
    },
  ],
};

const STORYBOARDS: Record<string, Storyboard> = {
  [KINMEN_823_STORYBOARD.scenarioId]: KINMEN_823_STORYBOARD,
};

/** 取場景對應的 storyboard；沒有就回 undefined（紀錄片鈕不顯示） */
export function getStoryboard(scenarioId: string | undefined): Storyboard | undefined {
  if (!scenarioId) return undefined;
  return STORYBOARDS[scenarioId];
}
