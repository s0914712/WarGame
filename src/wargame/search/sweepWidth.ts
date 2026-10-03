/**
 * 掃掠寬度（W）— 依《搜索參數的選擇與機率》第五節。
 *
 * 未修正掃掠寬度 Wu 由查表取得（船舶長度 46 公尺以上、EO/IR 無人機），
 * 再套用天候 / 速度 / 疲勞修正：
 *
 *   W = Wu × Fw × Fv × Ff
 *
 * 文件範例：目標船長 100 m、高度 500 ft、速度 60 kn、能見度 10 km、
 * 風 20 kn、浪高 1.5 m → W = 6.4 × 0.5 × 1.5 = 4.8 浬。
 *
 * 純函式、零瀏覽器依賴（MCP server 也能用）。
 */

/** 表列的搜索目標分類（文件僅提供 46 公尺以上兩級） */
export type SearchTargetClass = "ship_46_91m" | "ship_over_91m";

/** 表列飛行高度（英尺） */
export const TABULATED_ALTITUDES_FT = [500, 1000, 1500, 2000] as const;
/** 表列能見度（公里）；>40 一律以 40 計 */
export const TABULATED_VISIBILITY_KM = [2, 5, 10, 20, 30, 40] as const;

/**
 * 未修正掃掠寬度 Wu（單位：海里）。
 * 索引：[高度 ft][目標分類][能見度 km]，數值直接取自文件表格。
 */
const WU_TABLE: Record<number, Record<SearchTargetClass, number[]>> = {
  500:  { ship_46_91m: [0.8, 3.4, 6.3, 13.6, 20.4, 26.6], ship_over_91m: [0.8, 3.5, 6.4, 14.3, 22.1, 29.8] },
  1000: { ship_46_91m: [0.8, 3.4, 6.3, 13.6, 20.4, 26.6], ship_over_91m: [0.8, 3.5, 6.4, 14.3, 22.2, 29.8] },
  1500: { ship_46_91m: [0.7, 3.4, 6.3, 13.6, 20.4, 26.6], ship_over_91m: [0.7, 3.4, 6.4, 14.3, 22.2, 29.8] },
  2000: { ship_46_91m: [0.5, 3.4, 6.3, 13.6, 20.4, 26.6], ship_over_91m: [0.6, 3.4, 6.4, 14.3, 22.2, 29.8] },
};

/** 取最接近的表列高度（文件只給四個高度，不外插） */
export function nearestTabulatedAltitudeFt(altitudeFt: number): number {
  let best: number = TABULATED_ALTITUDES_FT[0];
  let bestGap = Infinity;
  for (const a of TABULATED_ALTITUDES_FT) {
    const gap = Math.abs(a - altitudeFt);
    if (gap < bestGap) { bestGap = gap; best = a; }
  }
  return best;
}

/** 高度相對於表格的位置：表列點 / 兩點間內插 / 超出表格外插 */
export type AltitudeLookup = "tabulated" | "interpolated" | "extrapolated_low" | "extrapolated_high";

export function altitudeLookupKind(altitudeFt: number): AltitudeLookup {
  const lo = TABULATED_ALTITUDES_FT[0];
  const hi = TABULATED_ALTITUDES_FT[TABULATED_ALTITUDES_FT.length - 1] ?? lo;
  if ((TABULATED_ALTITUDES_FT as readonly number[]).includes(altitudeFt)) return "tabulated";
  if (altitudeFt < lo) return "extrapolated_low";
  if (altitudeFt > hi) return "extrapolated_high";
  return "interpolated";
}

/**
 * 依高度取一列（各能見度的 Wu）：
 *   - 表列高度之間 → 線性內插
 *   - 低於 500 ft → 沿用 500 ft（低空的視距受限交給地平線物理上限處理）
 *   - 高於 2000 ft → 沿 1500→2000 ft 的趨勢線性外插，並夾在 [0, 2000 ft 值]：
 *     表格隨高度幾乎不變、只有低能見度時略降，外插只允許延續下降、不允許放大，
 *     維持保守（表外沒有資料支撐，不該比表內更樂觀）
 */
function rowAtAltitude(targetClass: SearchTargetClass, altitudeFt: number): number[] {
  const alts = TABULATED_ALTITUDES_FT;
  const rowOf = (a: number) => WU_TABLE[a]?.[targetClass] ?? [];
  const lerp = (r0: number[], r1: number[], f: number) => r0.map((v, i) => v + f * ((r1[i] ?? v) - v));

  const first: number = alts[0];
  const last: number = alts[alts.length - 1] ?? first;
  if (altitudeFt <= first) return rowOf(first);
  if (altitudeFt >= last) {
    const prev = alts[alts.length - 2] ?? first;
    const rLast = rowOf(last);
    const f = (altitudeFt - prev) / (last - prev);
    return lerp(rowOf(prev), rLast, f).map((v, i) => Math.min(rLast[i] ?? v, Math.max(0, v)));
  }
  for (let i = 0; i < alts.length - 1; i++) {
    const a0 = alts[i], a1 = alts[i + 1];
    if (a0 === undefined || a1 === undefined) continue;
    if (altitudeFt >= a0 && altitudeFt <= a1) return lerp(rowOf(a0), rowOf(a1), (altitudeFt - a0) / (a1 - a0));
  }
  return rowOf(last);
}

/**
 * 未修正掃掠寬度 Wu（浬）。能見度在表列點之間以線性內插；
 * 低於 2 km 依比例外推到 0、高於 40 km 一律取 >40 那欄（文件即以 >40 封頂）。
 * 高度亦線性內插，超出 500–2000 ft 依 rowAtAltitude() 的保守規則外插。
 */
export function uncorrectedSweepWidthNm(args: {
  targetClass: SearchTargetClass;
  visibilityKm: number;
  altitudeFt: number;
}): number {
  const row = rowAtAltitude(args.targetClass, args.altitudeFt);
  if (row.length === 0) return 0;

  const vis = args.visibilityKm;
  const pts = TABULATED_VISIBILITY_KM;
  const first = pts[0] ?? 2;
  const firstW = row[0] ?? 0;
  const lastW = row[row.length - 1] ?? 0;

  if (vis <= first) {
    // 2 km 以下：由原點線性外推，避免能見度趨零時仍給出有限掃掠寬
    return Math.max(0, (vis / first) * firstW);
  }
  if (vis >= (pts[pts.length - 1] ?? 40)) return lastW;

  for (let i = 0; i < pts.length - 1; i++) {
    const lo = pts[i], hi = pts[i + 1];
    const wLo = row[i], wHi = row[i + 1];
    if (lo === undefined || hi === undefined || wLo === undefined || wHi === undefined) continue;
    if (vis >= lo && vis <= hi) {
      const f = (vis - lo) / (hi - lo);
      return wLo + f * (wHi - wLo);
    }
  }
  return lastW;
}

/**
 * 載台經驗值 → 未修正掃掠寬度。
 *
 * 使用者輸入「此載台在某能見度下，目視可分辨船隻的距離 R」（例：瑞鳶 3000 ft、
 * 能見度良好、8 浬）。以定距律（cookie-cutter）假設：R 內必定發現、R 外看不到，
 * 則掃掠寬度 = 橫向距離函數的積分 = 2R。
 *
 * 經驗值綁定其記錄時的能見度；當前能見度較差時，以 Wu 查表在兩個能見度下的
 * 比值等比縮小（借用表格的能見度衰減形狀）。當前能見度較好時**不放大** ——
 * 經驗沒涵蓋的條件不外推，維持保守。
 */
export function experienceSweepWidthNm(args: {
  /** 經驗可分辨距離（浬） */
  rangeNm: number;
  /** 經驗值記錄時的能見度（公里） */
  referenceVisibilityKm: number;
  /** 當前能見度（公里） */
  visibilityKm: number;
  targetClass: SearchTargetClass;
  altitudeFt: number;
}): { uncorrectedNm: number; visibilityFactor: number } {
  const ref = uncorrectedSweepWidthNm({
    targetClass: args.targetClass, visibilityKm: args.referenceVisibilityKm, altitudeFt: args.altitudeFt,
  });
  const now = uncorrectedSweepWidthNm({
    targetClass: args.targetClass, visibilityKm: args.visibilityKm, altitudeFt: args.altitudeFt,
  });
  const visibilityFactor = ref > 0 ? Math.min(1, now / ref) : 1;
  return {
    uncorrectedNm: 2 * Math.max(0, args.rangeNm) * visibilityFactor,
    visibilityFactor,
  };
}

/** 掃掠寬度修正因子。未提供者一律視為 1.0（無修正） */
/**
 * 感測器實戰效能折扣 —— Stone (1983) §3，引 Koopman [1980] p.21。
 *
 * 「搜索感測器常未經測試。此時規劃者只能依感測器的設計規格估計橫向距離
 *  函數，但應知道**這些估計通常偏樂觀**。事實上 Koopman 指出，二戰經驗
 *  顯示系統在實戰情境下的表現，典型只有設計能力的 60–70%。」
 *
 * 本規劃器的 Wu 查表就是規格／測試條件下的值，原本只套天候 / 速度 / 疲勞
 * 三項修正，等於預設感測器能發揮 100% 設計能力。加入此折扣讓預設偏保守。
 */
export const OPERATIONAL_DEGRADATION = {
  /** 感測器已在近似條件下實測過 → 不折扣 */
  tested: 1.0,
  /** 未實測、僅有設計規格 → 取 Koopman 區間中值 0.65 */
  untested: 0.65,
  /** Koopman 區間上下界，供 UI 顯示範圍 */
  koopmanRange: [0.6, 0.7] as const,
} as const;

export interface SweepWidthCorrections {
  /** Fw／Wx 天候修正因子（風 / 浪 / 海況惡化 → < 1） */
  weather: number;
  /** Fv 速度修正因子 */
  speed: number;
  /** 是否套用疲勞修正 Ff = 0.9（文件五(二)：過度疲勞時掃掠寬減 10%） */
  fatigued: boolean;
  /**
   * 實戰效能折扣（Stone §3 / Koopman [1980]）。省略 = 1.0（不折扣）。
   * 感測器未在近似條件下實測時，建議用 OPERATIONAL_DEGRADATION.untested。
   */
  operational?: number;
}

/** 疲勞修正因子（文件明訂 0.9） */
export const FATIGUE_FACTOR = 0.9;

export const DEFAULT_CORRECTIONS: SweepWidthCorrections = {
  weather: 1.0,
  speed: 1.0,
  fatigued: false,
};

/** 修正後掃掠寬度 W = Wu × Fw × Fv × Ff × Fo（浬） */
export function correctedSweepWidthNm(uncorrectedNm: number, c: SweepWidthCorrections): number {
  const ff = c.fatigued ? FATIGUE_FACTOR : 1;
  const fo = c.operational ?? 1;
  return Math.max(0, uncorrectedNm * c.weather * c.speed * ff * fo);
}

/**
 * 天候修正因子建議值。文件只給了「風 20 kn／浪高 1.5 m → Fw = 0.5」這一個
 * 錨點與「條件不良時應縮小」的原則，故此處為依該錨點外推的線性建議值，
 * 非文件原表 —— UI 允許使用者直接覆寫。
 */
export function suggestWeatherFactor(windKn: number, seaStateM: number): number {
  const windPenalty = Math.min(0.5, Math.max(0, (windKn - 10) / 20) * 0.5);
  const seaPenalty = Math.min(0.4, Math.max(0, (seaStateM - 0.5) / 2.0) * 0.4);
  return Math.max(0.2, Math.min(1, 1 - windPenalty - seaPenalty));
}
