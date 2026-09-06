/**
 * 搜索規劃器文字層 — 引擎保持語言中立，所有面向使用者的字串在此產生。
 *
 * 引擎（planner / pod / patterns）只回傳結構化代碼 + 參數；此模組把它們
 * 轉成中文或英文。新增語言只要多一份 SearchStrings。
 */
import type { CoverageLevel } from "./pod";
import type { NoticeCode, PlannerNotice } from "./planner";
import type { PatternReasonCode, SearchPatternId } from "./patterns";
import { SEARCH_PATTERNS } from "./patterns";

export type SearchLang = "zh" | "en";

const n = (v: number | string | undefined, d = 0) =>
  typeof v === "number" ? v.toFixed(d) : String(v ?? "");

// ── 條件敘述 ──────────────────────────────────────────────
const CONDITION_ZH: Record<string, string> = { good: "良好", poor: "不良", severe: "極差" };
const CONDITION_EN: Record<string, string> = { good: "good", poor: "poor", severe: "severe" };

// ── 規劃提示 ──────────────────────────────────────────────
function noticeZh(x: PlannerNotice): string {
  const p = x.params;
  switch (x.code) {
    case "zero_sweep_width":
      return "掃掠寬度為 0（能見度過低）—— 航跡間距以 0.1 浬保底，結果僅供參考";
    case "spacing_over_ceiling":
      return `航跡間距 ${n(p.spacing, 2)} 浬超過${CONDITION_ZH[String(p.condition)] ?? ""}條件建議上限 ${n(p.ceiling, 1)} 浬`;
    case "spacing_clamped":
      return `理論航跡間距超過${CONDITION_ZH[String(p.condition)] ?? ""}條件上限，已夾限為 ${n(p.ceiling, 1)} 浬`;
    case "coverage_poor":
      return `覆蓋因子 ${n(p.coverage, 2)} 低於 0.5 —— 文件六(六)不建議；應縮小航跡間距或增加載具`;
    case "coverage_excess":
      return `C = ${n(p.coverage, 2)} 已超出文件 POD 圖範圍（約 0–2），POD 屬曲線外推值；`
        + "航跡間距遠小於掃掠寬度代表重複掃掠同一片海面，可考慮放寬 S 以擴大搜索面積";
    case "sorties_required":
      return `單架次滯空 ${n(p.onStation, 1)} hr 不足以飛完 ${n(p.needed, 1)} hr 的航線，每架需 ${n(p.sorties)} 個架次輪替`;
    case "transit_exceeds_endurance":
      return "往返進場時間已超過滯空時數 —— 此機型無法抵達該區域執行搜索";
    case "false_contacts":
      return `預期 ${n(p.contacts, 1)} 個假接觸需查證（95% 區間 ${n(p.lo)}–${n(p.hi)} 個），`
        + `吃掉 ${n(p.hours, 1)} 載具時數、佔總需求 ${n(p.share, 0)}% —— `
        + "假目標與真目標偵測函數相同，搜得再久也濾不掉，只能逐一查證（Stone §6）";
  }
}

function noticeEn(x: PlannerNotice): string {
  const p = x.params;
  switch (x.code) {
    case "zero_sweep_width":
      return "Sweep width is zero (visibility too low) — track spacing floored at 0.1 NM; treat results as indicative only";
    case "spacing_over_ceiling":
      return `Track spacing ${n(p.spacing, 2)} NM exceeds the ${CONDITION_EN[String(p.condition)] ?? ""}-conditions ceiling of ${n(p.ceiling, 1)} NM`;
    case "spacing_clamped":
      return `Theoretical track spacing exceeded the ${CONDITION_EN[String(p.condition)] ?? ""}-conditions ceiling; clamped to ${n(p.ceiling, 1)} NM`;
    case "coverage_poor":
      return `Coverage factor ${n(p.coverage, 2)} is below 0.5 — not recommended per §6(6); reduce track spacing or add assets`;
    case "coverage_excess":
      return `C = ${n(p.coverage, 2)} is beyond the source POD chart's range (about 0–2), so this POD is an extrapolation. `
        + "Spacing far below sweep width means re-scanning the same water — consider widening S to cover more area";
    case "sorties_required":
      return `On-station endurance of ${n(p.onStation, 1)} hr cannot cover a ${n(p.needed, 1)} hr route; each aircraft needs ${n(p.sorties)} sorties`;
    case "transit_exceeds_endurance":
      return "Transit time out and back already exceeds endurance — this airframe cannot reach the area";
    case "false_contacts":
      return `Expect ${n(p.contacts, 1)} false contacts to investigate (95% interval ${n(p.lo)}–${n(p.hi)}), `
        + `consuming ${n(p.hours, 1)} aircraft-hours — ${n(p.share, 0)}% of the total requirement. `
        + "False targets share the target's detection function, so more searching will not filter them out — each must be checked (Stone §6)";
  }
}

// ── 覆蓋因子評語 ──────────────────────────────────────────
const COVERAGE_ZH: Record<CoverageLevel, string> = {
  poor: "覆蓋因子低於 0.5 —— 文件六(六)不建議",
  minimum: "達文件建議下限 0.5，適用於載具有限之長時間重複搜索",
  good: "覆蓋良好；接近文件六(一)之理想值 S = W",
  ideal: "S ≤ W，符合文件六(一)理想值；注意 C = 1.0 不等於 POD 100%（七(四)5）",
  excess: "遠高於理想值 —— POD 屬曲線外推，且代表重複掃掠同一片海面",
};
const COVERAGE_EN: Record<CoverageLevel, string> = {
  poor: "Coverage below 0.5 — not recommended per §6(6)",
  minimum: "At the recommended floor of 0.5; suitable for sustained repeat searches with limited assets",
  good: "Good coverage; close to the ideal S = W of §6(1)",
  ideal: "S ≤ W, matching the §6(1) ideal. Note C = 1.0 does not mean 100% POD (§7(4)5)",
  excess: "Far above ideal — POD is extrapolated, and the pattern re-scans the same water",
};

// ── 圖形建議理由 ──────────────────────────────────────────
const REASON_ZH: Record<PatternReasonCode, string> = {
  known_track_line: "已知失蹤航路 —— 文件二(一)：目標多半在預定航路上或其附近，應先沿航路快速搜索",
  tight_datum: "基準點誤差很小且區域不大 —— 文件六(二)：扇形搜索在中心區域航跡間距極小，可獲得高 POD",
  known_position: "目標位置已知且距起點 ≤15–20 浬 —— 文件五(二)：適用擴展方形搜索",
  biased_to_one_end: "目標較可能位於搜索區某一端 —— 文件四(一)：宜採蠕行線搜索，航段平行短邊",
  large_area_elongated: "大面積、狹長區域且目標位置不精確 —— 文件三(二)：平行航跡可提供均勻覆蓋，航段沿長邊",
  large_area_uniform: "大面積、需均勻覆蓋且目標位置不精確 —— 文件三(二)：平行航跡搜索",
};
const REASON_EN: Record<PatternReasonCode, string> = {
  known_track_line: "Intended route is known — §2(1): the target is usually on or near it, so sweep the route first",
  tight_datum: "Datum error is small and the area compact — §6(2): sector search packs tracks tightly at the centre for high POD",
  known_position: "Position known within 15–20 NM of the start point — §5(2): expanding square applies",
  biased_to_one_end: "Target more likely at one end of the area — §4(1): creeping line, legs parallel to the short side",
  large_area_elongated: "Large elongated area with imprecise position — §3(2): parallel track gives uniform coverage, legs along the long axis",
  large_area_uniform: "Large area needing uniform coverage with imprecise position — §3(2): parallel track search",
};
const MULTI_ASSET_ZH = "；多機採橫隊並列、彼此相隔 1 個航跡間距（文件三(四)）";
const MULTI_ASSET_EN = "; multiple assets fly line abreast, one track spacing apart (§3(4))";

// ── UI 標籤 ───────────────────────────────────────────────
export interface SearchStrings {
  title: string; subtitle: string;
  reset: string; close: string; open: string;
  secArea: string; secSolve: string; secSensor: string; secAsset: string;
  secSpacing: string; secMonteCarlo: string; secTracks: string;
  pickOnMap: string; clear: string; noArea: string;
  pickFirstCorner: string; pickSecondCorner: string; cancel: string;
  dirGivenAssets: string; dirGivenTime: string;
  droneCount: string; availableTime: string; targetPod: string;
  searchTarget: string; targetSmall: string; targetLarge: string;
  altitude: string; visibility: string; wind: string; seaState: string;
  weatherFactor: string; speedFactor: string; suggest: string; fatigued: string;
  speed: string; endurance: string; transit: string; applyAirframe: string;
  trackSpacing: string; auto: string; pattern: string; autoPattern: string;
  podModel: string; podModelChart: string; podModelRandom: string;
  datumUncertainty: string; biasedToOneEnd: string; knownTrackLine: string;
  results: string;
  sweepWidth: string; coverage: string; sweepTime: string; elapsedTime: string;
  pod: string; cumulativePod: string; totalTrack: string;
  recommendedDrones: string; recommendedPattern: string; reason: string;
  achievedPod: string; actualTime: string;
  perAircraft: string; sorties: string; onStationPerSortie: string;
  theoretical: string; ofTarget: string; requiredCoverage: string;
  patternWhenToUse: string; patternLegs: string; patternStart: string;
  patternParams: string; patternLimits: string; patternUav: string;
  mcEnable: string; mcTrials: string; mcDrift: string; mcDriftBearing: string;
  mcRandomBearing: string; mcNavError: string; mcSensorAvail: string;
  mcDistribution: string; mcUniform: string; mcGaussian: string; mcSigma: string;
  mcRun: string; mcRunning: string; mcEmpiricalPod: string; mcCi: string;
  mcMedianDetection: string; mcP90Detection: string; mcVsAnalytic: string;
  mcCurveTitle: string; mcNotFound: string; mcNeedTracks: string;
  generateTracks: string; actualTrack: string; vsEstimate: string;
  assignTo: string; noAirUnits: string; applyToUnits: string; trackLabel: string;
  contourNotRoutable: string; moreAssignedThanTracks: string;
  podCapNote: string; footer: string;
  hours: string; minutes: string;
  // ── Stone (1983) 擴充 ──
  stoneSection: string;
  sensorTested: string; sensorTestedNote: string;
  navError: string; sweepSpread: string;
  podRange: string; podUpper: string; podNominal: string; podLower: string;
  sigmaOverW: string; sigmaOverWNote: string; eInvFloor: string;
  sweepUncertainOn: string;
  secPrior: string; bayesEnable: string; particleCount: string; elapsedHr: string;
  scenarios: string; scenarioWeight: string; scenarioSigma: string;
  scenarioDrift: string; scenarioCourse: string;
  rebuildPrior: string; priorStats: string; majorAxis: string;
  optimalRect: string; optimalRectSize: string; yourBox: string;
  rectLoss: string; rectLossNone: string; applyOptimalRect: string;
  containment: string; conditionalDetect: string;
  secSorties: string; recordFailure: string; resetHistory: string;
  sortieN: string; posThisSortie: string; cumulativePos: string;
  unsearchedMass: string; stopThreshold: string;
  adviceContinue: string; adviceConsider: string; adviceExhausted: string;
  adviceExhaustedNote: string;
  needBayes: string; needTracksForSortie: string;
  midSearchNote: string;
  secFalseTargets: string; falseEnable: string; falseCount: string;
  investigationTime: string; expectedContacts: string; contactsCi: string;
  investigationHours: string; worstCase: string; timeWithContacts: string;
  falseTargetsNote: string;
  densityBands: string; densityBandsNote: string;
  contactLog: string; logContact: string; logContactActive: string;
  clearContacts: string; noContacts: string; contactHint: string;
  checkFirst: string; contactP: string; contactDelta: string; contactGamma: string;
  rankingNote: string; integratedCount: string;
}

const ZH: SearchStrings = {
  title: "搜索規劃器", subtitle: "IAMSAR 掃掠寬度 · POD · 六大圖形",
  reset: "重設", close: "關閉", open: "開啟",
  secArea: "① 搜索區", secSolve: "② 要解算什麼", secSensor: "③ 目標與感測條件",
  secAsset: "④ 無人機性能", secSpacing: "⑤ 航跡間距與圖形",
  secMonteCarlo: "⑥ 蒙地卡羅模擬", secTracks: "⑦ 產生搜索航線",
  pickOnMap: "在地圖上框選", clear: "清除", noArea: "尚未框選搜索區",
  pickFirstCorner: "點地圖定搜索區第一角", pickSecondCorner: "再點一次定對角", cancel: "取消",
  dirGivenAssets: "給架數 → 求時間 / POD", dirGivenTime: "給時間 → 求架數 / 方式",
  droneCount: "無人機數量", availableTime: "可用時間", targetPod: "目標發現機率 POD",
  searchTarget: "搜索目標", targetSmall: "船舶 46–91 m", targetLarge: "船舶 >91 m",
  altitude: "飛行高度", visibility: "能見度", wind: "風速", seaState: "浪高",
  weatherFactor: "天候修正 Fw", speedFactor: "速度修正 Fv", suggest: "建議",
  fatigued: "人員過度疲勞（掃掠寬 ×0.9）",
  speed: "搜索速度", endurance: "滯空時數", transit: "單程進場", applyAirframe: "套用機型：",
  trackSpacing: "航跡間距 S", auto: "自動", pattern: "搜索圖形", autoPattern: "自動建議",
  podModel: "POD 模型", podModelChart: "IAMSAR POD 圖（表 4-2 擬合）", podModelRandom: "隨機搜索律 1−e⁻ᶜ（保守）",
  datumUncertainty: "基準點誤差半徑", biasedToOneEnd: "目標較可能靠近搜索區某一端",
  knownTrackLine: "有已知的失蹤航路",
  results: "解算結果",
  sweepWidth: "掃掠寬度 W", coverage: "覆蓋因子 C = W/S", sweepTime: "掃完全區時間",
  elapsedTime: "含往返 / 輪替歷時", pod: "發現機率 POD", cumulativePod: "重複搜索累積 POD",
  totalTrack: "全隊總航跡",
  recommendedDrones: "建議無人機數量", recommendedPattern: "建議搜索方式", reason: "採用理由",
  achievedPod: "達成 POD", actualTime: "實際掃區時間",
  perAircraft: "每架", sorties: "架次", onStationPerSortie: "單架次可搜",
  theoretical: "理論值", ofTarget: "目標", requiredCoverage: "所需 C",
  patternWhenToUse: "適用", patternLegs: "航段", patternStart: "起始",
  patternParams: "參數", patternLimits: "限制", patternUav: "無人機",
  mcEnable: "啟用蒙地卡羅", mcTrials: "試驗次數", mcDrift: "目標漂流速度",
  mcDriftBearing: "漂流方向", mcRandomBearing: "每次隨機",
  mcNavError: "導航誤差 σ", mcSensorAvail: "感測器可用率",
  mcDistribution: "目標位置分布", mcUniform: "均勻散布（解析式假設）", mcGaussian: "集中於基準點",
  mcSigma: "分布 σ", mcRun: "執行模擬", mcRunning: "模擬中…",
  mcEmpiricalPod: "經驗 POD", mcCi: "95% 信賴區間",
  mcMedianDetection: "中位發現時間", mcP90Detection: "90% 發現時間",
  mcVsAnalytic: "與解析式差距", mcCurveTitle: "POD 隨時間累積",
  mcNotFound: "未達該百分位", mcNeedTracks: "需先產生搜索航線才能模擬",
  generateTracks: "產生搜索航線", actualTrack: "實際航線",
  vsEstimate: "比 A=T×N×P×S 估算的",
  assignTo: "指派給（依序對應航線顏色）：", noAirUnits: "此陣營沒有空中載台",
  applyToUnits: "套用航線到", trackLabel: "航線",
  contourNotRoutable: "等高線搜索需要地形剖面，本規劃器不自動產生航線（文件第十節列為「△」）。請改選其他圖形，或人工規劃航線。",
  moreAssignedThanTracks: "指派架數多於航線數 —— 多出的會循環共用航線，建議把數量調成一致。",
  podCapNote: "文件七(四)5：覆蓋因子 1.0 亦不代表已檢查區內每一處位置，故不顯示 100%",
  footer: "掃掠寬度表、天候／疲勞修正、覆蓋因子與 POD、六大圖形與擴展方形航段表，均依《搜索參數的選擇與機率》與《六大搜索圖形》實作。POD 曲線由文件表 4-2 反解而得，可完整重現該表數值。",
  hours: "小時", minutes: "分",
  stoneSection: "Stone (1983) 擴充",
  sensorTested: "感測器已在近似條件下實測",
  sensorTestedNote: "未實測時套 ×0.65 —— Koopman [1980]：二戰經驗顯示系統實戰只發揮設計能力的 60–70%",
  navError: "航跡放置誤差 σ",
  sweepSpread: "掃掠寬不確定性 ±",
  podRange: "發現機率區間",
  podUpper: "定距上界", podNominal: "標稱", podLower: "指數下界",
  sigmaOverW: "σ/W",
  sigmaOverWNote: "Stone Figure 7：σ/W 決定實際偵測函數落在上下界之間何處",
  eInvFloor: "σ/W 大時一次完整覆蓋的地板 1−e⁻¹ = 63.2%（Reber 1956）",
  sweepUncertainOn: "已對掃掠寬取分布 b̄ = Σβᵢ·B(ωᵢ)（Stone §4）",
  secPrior: "⑧ 目標機率分布（Stone §2）",
  bayesEnable: "啟用事前分布與貝氏更新",
  particleCount: "粒子數",
  elapsedHr: "基準點→抵達現場",
  scenarios: "情境（權重會自動正規化）",
  scenarioWeight: "可信度", scenarioSigma: "位置誤差 σ",
  scenarioDrift: "漂流速度", scenarioCourse: "漂流航向",
  rebuildPrior: "重建分布",
  priorStats: "分布統計", majorAxis: "主軸方位",
  optimalRect: "最佳搜索矩形（Stone §5）",
  optimalRectSize: "最佳框",
  yourBox: "你畫的框",
  rectLoss: "相對最佳損失",
  rectLossNone: "已接近最佳",
  applyOptimalRect: "套用最佳框",
  containment: "目標落在框內", conditionalDetect: "框內被發現",
  secSorties: "⑨ 搜索歷程與停止準則（Stone §6/§7）",
  recordFailure: "記錄一趟「未發現」",
  resetHistory: "重置歷程",
  sortieN: "已執行趟次",
  posThisSortie: "本趟成功機率 POS",
  cumulativePos: "累積成功機率",
  unsearchedMass: "未搜索的機率質量",
  stopThreshold: "停止門檻",
  adviceContinue: "繼續搜索",
  adviceConsider: "接近門檻，可考慮收尾",
  adviceExhausted: "建議停止",
  adviceExhaustedNote: "Stone §7：累積機率已達門檻，代表在既有假設下重複同樣搜索多半早已找到。失敗更可能是運氣或假設有誤，而非規劃不當 —— 若無新情報就該停。",
  needBayes: "需先啟用事前分布",
  needTracksForSortie: "需先產生搜索航線",
  midSearchNote: "分布實際推進到「抵達現場 + 掃區時間÷2」的搜索期中點（Stone §5 的實務慣例）",
  secFalseTargets: "⑩ 假目標與接觸查證（Stone §6）",
  falseEnable: "計入假目標",
  falseCount: "全區預期假接觸",
  investigationTime: "每個查證耗時",
  expectedContacts: "預期偵測到的假接觸",
  contactsCi: "95% 區間",
  investigationHours: "查證吃掉的載具時數",
  worstCase: "最壞情況（95% 上緣）",
  timeWithContacts: "含查證後每架時數",
  falseTargetsNote: "假目標與真目標偵測函數相同 —— 搜得再久也濾不掉，只能逐一查證。Stone §6：進入查證階段必須先終止廣域搜索，對無人機而言就是從滯空時數裡扣。",
  densityBands: "假目標密度分帶（航道 / 漂流帶）",
  densityBandsNote: "同樣的總數重新分配到航道與輻合帶。總量不變，但接觸的查證優先順序會變。",
  contactLog: "接觸記錄",
  logContact: "點地圖記錄接觸",
  logContactActive: "點地圖新增接觸 · 再按一次結束",
  clearContacts: "清空",
  noContacts: "尚無接觸記錄",
  contactHint: "記錄搜索中發現、尚待查證的接觸；系統依 Stone 式(5) 排出先查順序",
  checkFirst: "優先查證順序",
  contactP: "p(格)", contactDelta: "δ(格)", contactGamma: "是目標的機率 γ",
  rankingNote: "γ 正比於 p(j)/δ(j) —— 目標機率相對假目標密度高的接觸才值得先查。航道上的接觸即使機率不低也會被往後排。",
  integratedCount: "區內假目標期望總數",
};

const EN: SearchStrings = {
  title: "Search Planner", subtitle: "IAMSAR sweep width · POD · six patterns",
  reset: "Reset", close: "Close", open: "Open",
  secArea: "1. Search area", secSolve: "2. What to solve for", secSensor: "3. Target and sensor conditions",
  secAsset: "4. UAV performance", secSpacing: "5. Track spacing and pattern",
  secMonteCarlo: "6. Monte Carlo simulation", secTracks: "7. Generate search tracks",
  pickOnMap: "Draw on map", clear: "Clear", noArea: "No search area defined yet",
  pickFirstCorner: "Click the map to set the first corner", pickSecondCorner: "Click again to set the opposite corner", cancel: "Cancel",
  dirGivenAssets: "Given assets → time / POD", dirGivenTime: "Given time → assets / pattern",
  droneCount: "Number of UAVs", availableTime: "Time available", targetPod: "Target POD",
  searchTarget: "Search target", targetSmall: "Ship 46–91 m", targetLarge: "Ship >91 m",
  altitude: "Search altitude", visibility: "Visibility", wind: "Wind speed", seaState: "Sea state",
  weatherFactor: "Weather factor Fw", speedFactor: "Speed factor Fv", suggest: "Suggest",
  fatigued: "Crew fatigued (sweep width ×0.9)",
  speed: "Search speed", endurance: "Endurance", transit: "Transit (one way)", applyAirframe: "Load airframe:",
  trackSpacing: "Track spacing S", auto: "Auto", pattern: "Search pattern", autoPattern: "Auto-recommend",
  podModel: "POD model", podModelChart: "IAMSAR POD chart (fitted to Table 4-2)", podModelRandom: "Random search law 1−e⁻ᶜ (conservative)",
  datumUncertainty: "Datum uncertainty radius", biasedToOneEnd: "Target likely near one end of the area",
  knownTrackLine: "Intended route is known",
  results: "Results",
  sweepWidth: "Sweep width W", coverage: "Coverage factor C = W/S", sweepTime: "Time to sweep the area",
  elapsedTime: "Elapsed incl. transit / sorties", pod: "Probability of detection", cumulativePod: "Cumulative POD, repeat searches",
  totalTrack: "Total track, all assets",
  recommendedDrones: "Recommended UAVs", recommendedPattern: "Recommended pattern", reason: "Rationale",
  achievedPod: "Achieved POD", actualTime: "Actual sweep time",
  perAircraft: "each", sorties: "sorties", onStationPerSortie: "on-station per sortie",
  theoretical: "exact", ofTarget: "target", requiredCoverage: "required C",
  patternWhenToUse: "Use when", patternLegs: "Legs", patternStart: "Start",
  patternParams: "Params", patternLimits: "Limits", patternUav: "UAV",
  mcEnable: "Enable Monte Carlo", mcTrials: "Trials", mcDrift: "Target drift speed",
  mcDriftBearing: "Drift bearing", mcRandomBearing: "Random each trial",
  mcNavError: "Navigation error σ", mcSensorAvail: "Sensor availability",
  mcDistribution: "Target position distribution", mcUniform: "Uniform (the analytic assumption)", mcGaussian: "Concentrated at datum",
  mcSigma: "Distribution σ", mcRun: "Run simulation", mcRunning: "Running…",
  mcEmpiricalPod: "Empirical POD", mcCi: "95% confidence interval",
  mcMedianDetection: "Median time to detect", mcP90Detection: "90th-percentile detect time",
  mcVsAnalytic: "vs analytic", mcCurveTitle: "Cumulative POD over time",
  mcNotFound: "not reached", mcNeedTracks: "Generate search tracks first",
  generateTracks: "Generate search tracks", actualTrack: "Actual route",
  vsEstimate: "vs the A=T×N×P×S estimate of",
  assignTo: "Assign to (in order, matching track colours):", noAirUnits: "No air assets on this side",
  applyToUnits: "Apply tracks to", trackLabel: "Track",
  contourNotRoutable: "Contour search needs a terrain profile, so this planner does not auto-generate the route (marked \"△\" in §10 of the source). Choose another pattern or plan it manually.",
  moreAssignedThanTracks: "More aircraft assigned than tracks generated — the extras will reuse tracks in rotation. Match the counts instead.",
  podCapNote: "§7(4)5: a coverage factor of 1.0 still does not mean every point was examined, so 100% is never shown",
  footer: "Sweep-width tables, weather/fatigue corrections, coverage factor and POD, the six patterns and the expanding-square leg table all follow the source documents. The POD curve was reverse-engineered from Table 4-2 and reproduces it exactly.",
  hours: "h", minutes: "m",
  stoneSection: "Stone (1983) extensions",
  sensorTested: "Sensor tested under comparable conditions",
  sensorTestedNote: "Untested sensors get ×0.65 — Koopman [1980]: WWII experience showed systems performing at 60–70% of design capability",
  navError: "Track placement error σ",
  sweepSpread: "Sweep width uncertainty ±",
  podRange: "Detection probability range",
  podUpper: "definite-range upper", podNominal: "nominal", podLower: "exponential lower",
  sigmaOverW: "σ/W",
  sigmaOverWNote: "Stone Figure 7: σ/W sets where the real detection function sits between the bounds",
  eInvFloor: "Floor for one full coverage at large σ/W: 1−e⁻¹ = 63.2% (Reber 1956)",
  sweepUncertainOn: "Sweep width treated as a distribution, b̄ = Σβᵢ·B(ωᵢ) (Stone §4)",
  secPrior: "8. Target probability distribution (Stone §2)",
  bayesEnable: "Enable prior distribution and Bayesian update",
  particleCount: "Particles",
  elapsedHr: "Datum → on scene",
  scenarios: "Scenarios (weights are normalised)",
  scenarioWeight: "Credence", scenarioSigma: "Position error σ",
  scenarioDrift: "Drift speed", scenarioCourse: "Drift course",
  rebuildPrior: "Rebuild distribution",
  priorStats: "Distribution", majorAxis: "Major axis",
  optimalRect: "Optimal search rectangle (Stone §5)",
  optimalRectSize: "Optimal box",
  yourBox: "Your box",
  rectLoss: "Loss vs optimal",
  rectLossNone: "close to optimal",
  applyOptimalRect: "Use optimal box",
  containment: "Target inside box", conditionalDetect: "Found if inside",
  secSorties: "9. Search history and stopping rule (Stone §6/§7)",
  recordFailure: "Record an unsuccessful sortie",
  resetHistory: "Reset history",
  sortieN: "Sorties flown",
  posThisSortie: "POS this sortie",
  cumulativePos: "Cumulative probability of success",
  unsearchedMass: "Unsearched probability mass",
  stopThreshold: "Stop threshold",
  adviceContinue: "Keep searching",
  adviceConsider: "Approaching threshold — consider wrapping up",
  adviceExhausted: "Recommend stopping",
  adviceExhaustedNote: "Stone §7: the cumulative probability has reached the threshold, meaning repeating this search under the same assumptions would usually have found the target by now. Failure is more likely bad luck or a faulty assumption than poor planning — with no new information, stop.",
  needBayes: "Enable the prior distribution first",
  needTracksForSortie: "Generate search tracks first",
  midSearchNote: "The distribution is advanced to on-scene + half the sweep time — the mid-search instant (Stone §5's practical convention)",
  secFalseTargets: "10. False targets and contact investigation (Stone §6)",
  falseEnable: "Account for false targets",
  falseCount: "Expected false contacts in area",
  investigationTime: "Time per investigation",
  expectedContacts: "Expected false contacts detected",
  contactsCi: "95% interval",
  investigationHours: "Aircraft-hours spent investigating",
  worstCase: "Worst case (95th percentile)",
  timeWithContacts: "Hours per aircraft incl. investigation",
  falseTargetsNote: "False targets share the target's detection function — searching longer will not filter them out, each must be checked. Stone §6: entering the investigation phase requires terminating broad search; for a UAV that comes straight out of endurance.",
  densityBands: "Spatial density bands (lanes / drift zones)",
  densityBandsNote: "Redistributes the same total across shipping lanes and convergence zones. The total is unchanged, but the investigation order changes.",
  contactLog: "Contact log",
  logContact: "Log contacts on map",
  logContactActive: "Tap the map to add · press again to finish",
  clearContacts: "Clear",
  noContacts: "No contacts logged",
  contactHint: "Log contacts found but not yet investigated; ranked by Stone Eq. (5)",
  checkFirst: "Investigate in this order",
  contactP: "p(cell)", contactDelta: "δ(cell)", contactGamma: "P(is target) γ",
  rankingNote: "γ is proportional to p(j)/δ(j) — only contacts whose target probability is high relative to the local false-target density are worth checking first. A contact in a shipping lane gets demoted even if its probability is decent.",
  integratedCount: "Expected false targets in area",
};

export function searchStrings(lang: SearchLang): SearchStrings {
  return lang === "en" ? EN : ZH;
}

export function formatNotice(x: PlannerNotice, lang: SearchLang): string {
  return lang === "en" ? noticeEn(x) : noticeZh(x);
}

export function coverageNote(level: CoverageLevel, lang: SearchLang): string {
  return lang === "en" ? COVERAGE_EN[level] : COVERAGE_ZH[level];
}

export function patternReason(
  code: PatternReasonCode, multiAsset: boolean, lang: SearchLang,
): string {
  const base = lang === "en" ? REASON_EN[code] : REASON_ZH[code];
  if (!multiAsset) return base;
  return base + (lang === "en" ? MULTI_ASSET_EN : MULTI_ASSET_ZH);
}

/** 圖形顯示名（含 id 前綴），供下拉選單與標題用 */
export function patternLabel(id: SearchPatternId, lang: SearchLang): string {
  return `${id} · ${SEARCH_PATTERNS[id][lang].name}`;
}

export type { NoticeCode };
