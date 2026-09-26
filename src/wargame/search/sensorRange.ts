/**
 * 高度 → 理論偵測距離 —— 掃掠寬度表之外的物理天花板。
 *
 * ── 為什麼需要 ──────────────────────────────────────────
 * 掃掠寬度表（《搜索參數的選擇與機率》五(一)）給的是 46 公尺以上船舶、
 * 載人 SAR 航空器的經驗值；表中四個高度（500–2000 ft）的數值幾乎相同，
 * 因為載人機的限制是**觀測員的視覺辨識**，不是幾何。
 *
 * 無人機不一樣。《六大搜索圖形》第十節的無人機使用指引明講：
 *
 *   「S 須依鏡頭 FOV 與 GSD 重算，遠小於載人機」
 *
 * 本模組算出兩個物理上限，讓規劃者看到「表上的掃掠寬度在這個高度 + 這顆
 * 鏡頭下到底做不做得到」：
 *
 *   1. 幾何地平線 —— 看不到地平線以下的東西
 *   2. 光學解析度（GSD）—— 目標在畫面上不到幾個像素就無法判讀
 *
 * 兩者取小即為最大側向偵測距離；掃掠寬度不可能超過它的兩倍。
 *
 * 純函式、語言中立。
 */

const KM_PER_NM = 1.852;

/**
 * 幾何地平線距離（浬）。標準大氣折射下的航海慣用式：
 *
 *   d(nm) = 1.17 × √h(ft)
 *
 * 感測器與目標各自的地平線可相加 —— 兩者只要在彼此的地平線內即可互見。
 *
 * @param sensorAltFt   感測器高度（英尺）
 * @param targetHeightM 目標可見部位高度（公尺）；船舶上層結構取 10–30 m
 */
export function horizonRangeNm(sensorAltFt: number, targetHeightM: number): number {
  const h = Math.max(0, sensorAltFt);
  const tFt = Math.max(0, targetHeightM) * 3.28084;
  return 1.17 * (Math.sqrt(h) + Math.sqrt(tFt));
}

/** 常見搜索目標的可見部位高度與判讀用特徵尺寸 */
export const TARGET_GEOMETRY = {
  ship_46_91m: { heightM: 12, dimensionM: 46, label: "船舶 46–91 m" },
  ship_over_91m: { heightM: 20, dimensionM: 91, label: "船舶 >91 m" },
  /** 保留給日後擴充 —— 這兩類是 GSD 會咬人的情形 */
  liferaft: { heightM: 1, dimensionM: 2.5, label: "救生筏" },
  person: { heightM: 0.4, dimensionM: 0.6, label: "落水人員" },
} as const;

export type TargetGeometryKey = keyof typeof TARGET_GEOMETRY;

/** EO/IR 酬載規格 */
export interface EoIrSensor {
  /** 窄視場水平 FOV（度）—— 搜索時通常用中／窄視場 */
  hfovDeg: number;
  /** 水平像素數 */
  pixelsH: number;
  /**
   * 判讀所需的目標橫跨像素數。Johnson 準則：
   * 偵測 ≈ 2、辨識 ≈ 6、識別 ≈ 12 個像素（此處為單維像素數）。
   * 搜索階段只要「偵測」，故預設 2；要能分辨真假目標則需 6 以上。
   */
  pixelsOnTarget: number;
}

export const DEFAULT_EOIR: EoIrSensor = {
  hfovDeg: 2.5,      // 典型中小型雲台窄視場
  pixelsH: 1280,
  pixelsOnTarget: 2, // 偵測門檻
};

/** 單像素角解析度（弳度） */
export function ifovRad(sensor: EoIrSensor): number {
  const fov = Math.max(1e-6, sensor.hfovDeg) * (Math.PI / 180);
  return fov / Math.max(1, sensor.pixelsH);
}

/**
 * 光學解析度上限（浬）。目標特徵尺寸 D 要橫跨 N 個像素，
 * 每像素角解析度 IFOV，則最大斜距
 *
 *   R = D / (N × IFOV)
 */
export function gsdLimitedRangeNm(sensor: EoIrSensor, targetDimensionM: number): number {
  const denom = Math.max(1, sensor.pixelsOnTarget) * ifovRad(sensor);
  if (denom <= 0) return Infinity;
  return targetDimensionM / denom / 1000 / KM_PER_NM;
}

/** 在斜距 R 處的地面取樣距離 GSD（公尺 / 像素）—— 供 UI 顯示直觀量 */
export function gsdAtRangeM(sensor: EoIrSensor, rangeNm: number): number {
  return ifovRad(sensor) * rangeNm * KM_PER_NM * 1000;
}

export interface RangeLimits {
  /** 幾何地平線距離（浬） */
  horizonNm: number;
  /** 光學解析度上限（斜距，浬） */
  gsdNm: number;
  /** 解析度上限換算成側向距離（扣掉高度那一段斜邊） */
  gsdLateralNm: number;
  /** 兩者取小 —— 最大側向偵測距離 */
  maxLateralNm: number;
  /** 掃掠寬度的物理上限 = 2 × maxLateral */
  sweepWidthCapNm: number;
  /** 哪一項是瓶頸 */
  limitedBy: "horizon" | "resolution";
  /** 在最大距離處的 GSD（m/px），給規劃者一個直觀的畫質感受 */
  gsdAtMaxM: number;
}

export function rangeLimits(args: {
  altitudeFt: number;
  target: { heightM: number; dimensionM: number };
  sensor: EoIrSensor;
}): RangeLimits {
  const horizonNm = horizonRangeNm(args.altitudeFt, args.target.heightM);
  const gsdNm = gsdLimitedRangeNm(args.sensor, args.target.dimensionM);
  // 解析度上限是「斜距」；換成側向距離要扣掉高度那一段
  const altNm = (Math.max(0, args.altitudeFt) * 0.3048) / 1000 / KM_PER_NM;
  const gsdLateralNm = Math.sqrt(Math.max(0, gsdNm * gsdNm - altNm * altNm));
  const maxLateralNm = Math.min(horizonNm, gsdLateralNm);
  return {
    horizonNm,
    gsdNm,
    gsdLateralNm,
    maxLateralNm,
    // 硬上界：偵測機率在 maxLateral 之外為 0，故 W = ∫p dx ≤ 2·maxLateral。
    // 這是「不可能超過」的界，不是掃掠寬度的估計值 —— 實際 W 通常遠小於此。
    sweepWidthCapNm: 2 * maxLateralNm,
    limitedBy: gsdLateralNm < horizonNm ? "resolution" : "horizon",
    gsdAtMaxM: gsdAtRangeM(args.sensor, maxLateralNm),
  };
}

/**
 * 把查表得到的掃掠寬度夾到物理上限。
 *
 * 回傳 capped 與是否真的被夾 —— UI 應該把「被夾」講出來，因為那代表
 * 表上的數值在這個高度 / 這顆鏡頭下做不到，不是使用者參數填錯。
 */
export function capSweepWidth(tableWidthNm: number, limits: RangeLimits): {
  cappedNm: number; wasCapped: boolean;
} {
  const capped = Math.min(tableWidthNm, limits.sweepWidthCapNm);
  return { cappedNm: capped, wasCapped: capped < tableWidthNm - 1e-9 };
}
