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

/**
 * 未修正掃掠寬度 Wu（浬）。能見度在表列點之間以線性內插；
 * 低於 2 km 依比例外推到 0、高於 40 km 一律取 >40 那欄（文件即以 >40 封頂）。
 */
export function uncorrectedSweepWidthNm(args: {
  targetClass: SearchTargetClass;
  visibilityKm: number;
  altitudeFt: number;
}): number {
  const table = WU_TABLE[nearestTabulatedAltitudeFt(args.altitudeFt)];
  const row = table?.[args.targetClass];
  if (!row || row.length === 0) return 0;

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

/** 掃掠寬度修正因子。未提供者一律視為 1.0（無修正） */
export interface SweepWidthCorrections {
  /** Fw／Wx 天候修正因子（風 / 浪 / 海況惡化 → < 1） */
  weather: number;
  /** Fv 速度修正因子 */
  speed: number;
  /** 是否套用疲勞修正 Ff = 0.9（文件五(二)：過度疲勞時掃掠寬減 10%） */
  fatigued: boolean;
}

/** 疲勞修正因子（文件明訂 0.9） */
export const FATIGUE_FACTOR = 0.9;

export const DEFAULT_CORRECTIONS: SweepWidthCorrections = {
  weather: 1.0,
  speed: 1.0,
  fatigued: false,
};

/** 修正後掃掠寬度 W = Wu × Fw × Fv × Ff（浬） */
export function correctedSweepWidthNm(uncorrectedNm: number, c: SweepWidthCorrections): number {
  const ff = c.fatigued ? FATIGUE_FACTOR : 1;
  return Math.max(0, uncorrectedNm * c.weather * c.speed * ff);
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
