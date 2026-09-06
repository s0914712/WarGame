/**
 * 六大搜索圖形 — 依《六大搜索圖形》全文。
 *
 * 每個圖形帶：適用情境 / 航段方向 / 起始點 / 關鍵參數 / 主要限制（速查對照表），
 * 以及該文件第十節「無人機使用指引」的修改注意事項。
 */

export type SearchPatternId = "TS" | "PS" | "CS" | "SS" | "VS" | "contour";

/** 圖形說明的單一語言文字 */
export interface PatternText {
  name: string;
  whenToUse: string;
  legDirection: string;
  startPoint: string;
  keyParams: string;
  limits: string;
  uavNotes: string;
}

export interface SearchPatternInfo {
  id: SearchPatternId;
  /** 英文正式名（兩種語言共用） */
  nameEn: string;
  zh: PatternText;
  en: PatternText;
  /** 第十節無人機使用指引：yes = 可直接沿用、caution = 需特別評估 */
  uavSuitable: "yes" | "caution";
  /** 本規劃器是否能自動產生航線（等高線需地形剖面，不自動產生） */
  autoRoutable: boolean;
}

export const SEARCH_PATTERNS: Record<SearchPatternId, SearchPatternInfo> = {
  TS: {
    id: "TS",
    nameEn: "Track Line Search",
    uavSuitable: "yes",
    autoRoutable: true,
    zh: {
      name: "沿航跡搜索",
      whenToUse: "航空器／船舶沿預定航路失蹤、第一時間反應",
      legDirection: "沿預定航路兩側",
      startPoint: "起飛地或目的地",
      keyParams: "日 1,000–2,000 ft／夜 2,000–3,000 ft；1 S 或 ½ S 偏移",
      limits: "假設目標在航路附近；失敗後須轉入密集搜索",
      uavNotes: "高度須降至 400 ft AGL 以下，與載人機分層",
    },
    en: {
      name: "Track Line Search",
      whenToUse: "Aircraft/vessel missing along a known intended route; first-response sortie",
      legDirection: "Along both sides of the intended route",
      startPoint: "Departure point or destination",
      keyParams: "Day 1,000–2,000 ft / night 2,000–3,000 ft; 1 S or ½ S offset",
      limits: "Assumes the target is near the route; escalate to a dense pattern if it fails",
      uavNotes: "Descend below 400 ft AGL to deconflict from manned aircraft",
    },
  },
  PS: {
    id: "PS",
    nameEn: "Parallel Track Search",
    uavSuitable: "yes",
    autoRoutable: true,
    zh: {
      name: "平行航跡搜索",
      whenToUse: "大面積、地形平坦、目標位置不精確、需均勻覆蓋",
      legDirection: "平行長邊（主軸）",
      startPoint: "搜索區一角，首航跡距邊 ½ S",
      keyParams: "航段間距 1 S；迴轉於區外",
      limits: "須注意漂流使目標漂出區外",
      uavNotes: "最適合無人機自動航線；S 須依鏡頭 FOV 與 GSD 重算，遠小於載人機",
    },
    en: {
      name: "Parallel Track Search",
      whenToUse: "Large area, flat terrain, imprecise target position, uniform coverage needed",
      legDirection: "Parallel to the long side (major axis)",
      startPoint: "A corner of the area; first leg ½ S from the edge",
      keyParams: "Legs spaced 1 S apart; turns made outside the area",
      limits: "Watch for drift carrying the target out of the area",
      uavNotes: "Best fit for autonomous UAV routing; recompute S from camera FOV and GSD — far smaller than for manned aircraft",
    },
  },
  CS: {
    id: "CS",
    nameEn: "Creeping Line Search",
    uavSuitable: "yes",
    autoRoutable: true,
    zh: {
      name: "蠕行線搜索",
      whenToUse: "目標較可能靠近搜索區某一端",
      legDirection: "平行短邊（次軸）",
      startPoint: "目標最可能所在之一端",
      keyParams: "多載具版需 ≥5 具、以第 2 具為軸心",
      limits: "較慢、需 OSC 高度協調",
      uavNotes: "多機協同版本需重新設計（原設計為 ≥5 艘船艇）",
    },
    en: {
      name: "Creeping Line Search",
      whenToUse: "Target more likely near one end of the area",
      legDirection: "Parallel to the short side (minor axis)",
      startPoint: "The end where the target is most likely",
      keyParams: "Multi-unit version needs ≥5 units, pivoting on the second unit",
      limits: "Slower; needs close OSC coordination",
      uavNotes: "Multi-unit variant needs redesign — the original assumes ≥5 surface craft",
    },
  },
  SS: {
    id: "SS",
    nameEn: "Expanding Square Search",
    uavSuitable: "yes",
    autoRoutable: true,
    zh: {
      name: "擴展方形搜索",
      whenToUse: "目標位置已知且範圍小（距起點 ≤15–20 浬）",
      legDirection: "同心方形外擴",
      startPoint: "通報位置／最可能位置",
      keyParams: "前 2 段＝1 S，每 2 段加 1 S；航段數 5、9、13、17…；重搜轉 45°",
      limits: "要求精確導航；水面資產半徑通常 ≤5 浬",
      uavNotes: "適合 MOB 定點；無人機以 GNSS 飛行，DR 導航建議不適用，須改以「基準點隨漂流移動」重算航線",
    },
    en: {
      name: "Expanding Square Search",
      whenToUse: "Target position known within a small area (≤15–20 NM from the start point)",
      legDirection: "Concentric squares expanding outward",
      startPoint: "Reported position / most probable position",
      keyParams: "First 2 legs = 1 S, then +1 S every 2 legs; leg counts 5, 9, 13, 17…; rotate 45° to re-search",
      limits: "Demands precise navigation; surface assets usually limited to ≤5 NM radius",
      uavNotes: "Good for man-overboard datums; UAVs fly GNSS so the DR-navigation guidance does not apply — recompute the pattern about a drifting datum instead",
    },
  },
  VS: {
    id: "VS",
    nameEn: "Sector Search",
    uavSuitable: "yes",
    autoRoutable: true,
    zh: {
      name: "扇形搜索",
      whenToUse: "LKP／落水點／基準點誤差小、區域不大",
      legDirection: "自基準點放射",
      startPoint: "圖形周邊或基準點正上方",
      keyParams: "船艇半徑 2–5 浬、轉向 120°、總里程 9R",
      limits: "僅限受訓機組＋具電子導航裝備",
      uavNotes: "適合小範圍高 POD；續航力限制使半徑通常遠小於 2 浬",
    },
    en: {
      name: "Sector Search",
      whenToUse: "LKP / splash point / datum known with small error, over a small area",
      legDirection: "Radial legs from the datum",
      startPoint: "Pattern edge, or directly over the datum",
      keyParams: "Surface radius 2–5 NM, 120° turns, total track ≈ 9R",
      limits: "Trained crews with electronic navigation only",
      uavNotes: "Good for small high-POD areas; endurance usually caps the radius well below 2 NM",
    },
  },
  contour: {
    id: "contour",
    nameEn: "Contour Search",
    uavSuitable: "caution",
    autoRoutable: false,
    zh: {
      name: "等高線搜索",
      whenToUse: "山坡與谷地、高程急遽變化",
      legDirection: "沿等高層環繞",
      startPoint: "最高峰上方",
      keyParams: "逐層下降＋8 字形反向盤旋；谷地圓形搜索、圓心每圈移 1 S",
      limits: "可能極度危險；風 >30 kt 應避免；一區一機",
      uavNotes: "山區訊號遮蔽、電池續航與風速限制；安全考量對小型無人機更嚴苛",
    },
    en: {
      name: "Contour Search",
      whenToUse: "Hillsides and valleys where sharp elevation change rules out other patterns",
      legDirection: "Circuits along selected contour levels",
      startPoint: "Above the highest peak",
      keyParams: "Descend one level per circuit with a reversing figure-8; valleys searched in circles, centre moved 1 S each lap",
      limits: "Can be extremely hazardous; avoid in winds >30 kt; one aircraft per area",
      uavNotes: "Terrain masking of the control link, battery endurance and wind limits; the safety case is harsher still for small UAVs",
    },
  },
};

/** 取指定語言的圖形說明 */
export function patternText(id: SearchPatternId, lang: "zh" | "en"): PatternText {
  return SEARCH_PATTERNS[id][lang];
}

// ── 擴展方形搜索：航段數 N 與總航跡里程 D（文件表 4-3）─────────
/** [半徑 R 浬][航跡間距 S 浬] → { legs, trackNm }；表格空缺表示該組合不適用 */
const SS_TABLE: Record<number, Partial<Record<number, [number, number]>>> = {
  1:  { 0.5: [9, 12],    1: [5, 8] },
  2:  { 0.5: [17, 40],   1: [9, 24] },
  3:  { 0.5: [25, 84],   1: [13, 48],  2: [5, 16] },
  4:  { 0.5: [33, 144],  1: [17, 80],  2: [9, 48],   3: [5, 24] },
  5:  { 0.5: [41, 220],  1: [21, 120], 2: [9, 48],   3: [9, 72] },
  6:  { 0.5: [49, 312],  1: [25, 168], 2: [13, 96],  3: [9, 72],   4: [5, 32] },
  7:  { 0.5: [57, 420],  1: [29, 224], 2: [13, 96],  3: [9, 72],   4: [9, 36],   5: [5, 40] },
  8:  { 0.5: [65, 544],  1: [33, 288], 2: [17, 160], 3: [13, 144], 4: [9, 36],   5: [9, 120] },
  9:  { 0.5: [73, 684],  1: [37, 360], 2: [17, 160], 3: [13, 144], 4: [9, 36],   5: [9, 120] },
  10: { 0.5: [81, 840],  1: [41, 440], 2: [21, 240], 3: [13, 144], 4: [9, 36],   5: [9, 120] },
  11: {                  1: [45, 528], 2: [21, 240], 3: [17, 240], 4: [13, 192], 5: [9, 120] },
  12: {                  1: [49, 624], 2: [25, 336], 3: [17, 240], 4: [13, 192], 5: [9, 120] },
  13: {                  1: [53, 728], 2: [25, 336], 3: [17, 240], 4: [13, 192], 5: [13, 240] },
  14: {                  1: [57, 840], 2: [29, 448], 3: [21, 360], 4: [13, 192], 5: [13, 240] },
  15: {                                2: [29, 448], 3: [21, 360], 4: [17, 320], 5: [13, 240], 10: [5, 80] },
  16: {                                2: [33, 576], 3: [21, 360], 4: [17, 320], 5: [13, 240], 10: [9, 240] },
  17: {                                2: [33, 576], 3: [25, 504], 4: [17, 320], 5: [13, 240], 10: [9, 240] },
  18: {                                2: [37, 720], 3: [25, 504], 4: [17, 320], 5: [17, 400], 10: [9, 240] },
  19: {                                2: [37, 720], 3: [25, 504], 4: [21, 480], 5: [17, 400], 10: [9, 240] },
  20: {                                2: [41, 880], 3: [29, 672], 4: [21, 480], 5: [17, 400], 10: [9, 240] },
};

/**
 * 擴展方形搜索的航段數與總航跡里程。
 * 先查文件表 4-3（R、S 取最接近的表列值）；查無則以幾何公式推算，
 * 並標記 source 讓 UI 說明數值來源。
 */
export function expandingSquareLegs(radiusNm: number, spacingNm: number): {
  legs: number; trackNm: number; source: "table_4_3" | "computed";
} {
  const rKeys = Object.keys(SS_TABLE).map(Number);
  const r = rKeys.reduce((a, b) => (Math.abs(b - radiusNm) < Math.abs(a - radiusNm) ? b : a), rKeys[0] ?? 1);
  const row = SS_TABLE[r];
  if (row) {
    const sKeys = Object.keys(row).map(Number);
    const s0 = sKeys[0];
    if (s0 !== undefined) {
      const s = sKeys.reduce((a, b) => (Math.abs(b - spacingNm) < Math.abs(a - spacingNm) ? b : a), s0);
      const hit = row[s];
      if (hit) return { legs: hit[0], trackNm: hit[1], source: "table_4_3" };
    }
  }
  // 幾何推算：航段長 S,S,2S,2S,3S,3S,… 直到覆蓋半徑
  const n = Math.max(1, Math.ceil(radiusNm / Math.max(spacingNm, 0.01)));
  let legs = 0;
  let track = 0;
  for (let k = 1; k <= n; k++) {
    legs += 2;
    track += 2 * k * spacingNm;
  }
  return { legs, trackNm: track, source: "computed" };
}

// ── 航跡間距建議（文件六(二)、六(三)）─────────────────────
export const KM_PER_NM = 1.852;

/**
 * 依搜索條件給出航跡間距上限建議：
 *   良好（風 <15 kn 且能見度 >3 浬）→ 不超過 3 浬
 *   不良（風 >15 kn 或 能見度 1–3 浬）→ 宜採 1 浬
 * 回傳的是「條件上限」，實際 S 仍應由 C = W/S 決定並取兩者較小值。
 */
export function trackSpacingCeilingNm(windKn: number, visibilityKm: number): {
  ceilingNm: number; condition: "good" | "poor" | "severe";
} {
  const visNm = visibilityKm / KM_PER_NM;
  // 良好：風 <15 kn 且能見度 >3 浬 → 不超過 3 浬（文件六(二)）
  if (windKn < 15 && visNm > 3) return { ceilingNm: 3, condition: "good" };
  // 不良：風 >15 kn 或能見度 1–3 浬 → 宜採 1 浬（文件六(三)）
  if (visNm >= 1) return { ceilingNm: 1, condition: "poor" };
  // 能見度 <1 浬：目視搜索效能極低（文件二(一)）
  return { ceilingNm: 0.5, condition: "severe" };
}

/**
 * 圖形建議理由代碼 — 對應文件條目，文字由 i18n 層產生。
 */
export type PatternReasonCode =
  | "known_track_line"      // 二(一)
  | "tight_datum"           // 六(二)
  | "known_position"        // 五(二)
  | "biased_to_one_end"     // 四(一)
  | "large_area_elongated"  // 三(二)
  | "large_area_uniform";   // 三(二)

export interface PatternRecommendation {
  pattern: SearchPatternId;
  reasonCode: PatternReasonCode;
  /** 多機時附加「橫隊並列、彼此相隔 1 S」註記（文件三(四)） */
  multiAssetNote: boolean;
  alternatives: SearchPatternId[];
}

/**
 * 圖形建議 — 對應文件一(三)「影響協調官選擇搜索方法的十項因素」中
 * 本規劃器可量化的幾項：目標位置精確度、搜索區大小與形狀、可用單位數量。
 * 其餘因素（天候、地形、助航設施、時間限制）仍須由協調官判斷。
 */
export function recommendPattern(args: {
  /** 目標位置不確定半徑（浬）；很小 → 定點圖形 */
  datumUncertaintyNm: number;
  areaNm2: number;
  /** 區域長寬比（長邊 ÷ 短邊） */
  aspectRatio: number;
  droneCount: number;
  /** 目標是否集中在區域某一端 */
  targetBiasedToOneEnd: boolean;
  /** 是否有已知的失蹤航路 */
  hasKnownTrackLine: boolean;
}): PatternRecommendation {
  const { datumUncertaintyNm, aspectRatio, droneCount, targetBiasedToOneEnd, hasKnownTrackLine } = args;
  const multi = droneCount >= 2;

  if (hasKnownTrackLine) {
    return { pattern: "TS", reasonCode: "known_track_line", multiAssetNote: false, alternatives: ["PS"] };
  }
  if (datumUncertaintyNm > 0 && datumUncertaintyNm <= 2) {
    return { pattern: "VS", reasonCode: "tight_datum", multiAssetNote: false, alternatives: ["SS"] };
  }
  if (datumUncertaintyNm > 2 && datumUncertaintyNm <= 20) {
    return { pattern: "SS", reasonCode: "known_position", multiAssetNote: false, alternatives: ["VS", "PS"] };
  }
  if (targetBiasedToOneEnd) {
    return { pattern: "CS", reasonCode: "biased_to_one_end", multiAssetNote: multi, alternatives: ["PS"] };
  }
  return {
    pattern: "PS",
    reasonCode: aspectRatio > 2.5 ? "large_area_elongated" : "large_area_uniform",
    multiAssetNote: multi,
    alternatives: ["CS", "TS"],
  };
}
