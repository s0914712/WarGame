/**
 * Leeway 漂流模型（瀏覽器版）—— 照 OpenDrift `opendrift/models/leeway.py` 的公式移植，
 * 供落水（MOB）搜救規劃推算粒子雲。純函式，零 browser 依賴；海流 / 風場由呼叫端提供。
 *
 * 物理（Allen & Plourde 1999；OpenDrift Leeway.update()）：
 *   順風漂移 dw = ((DWSLOPE + ε_dw/20)·W + DWOFFSET + ε_dw/2) × 0.01   [m/s]
 *   側風漂移 cw = ((CWSLOPE + ε_cw/20)·W + CWOFFSET + ε_cw/2) × 0.01
 *   W = 10 m 風速（m/s），係數單位：斜率 %、截距 cm/s、ε ~ N(0, STD) cm/s
 *   粒子奇偶交替偏右 / 偏左（各用 CWR / CWL 係數），每小時 4% 機率換邊（jibing）
 *   位移 = 漂移 + 海流
 *
 * 簡化（相對 OpenDrift）：不模擬翻覆、Stokes drift、擱淺後再漂離；
 * 粒子進到陸地格（海流 u=v=0）即視為擱淺停止。
 */

export type LngLat = [number, number];

export interface LeewayObject {
  /** OpenDrift OBJECTPROP.DAT 的序號（seacurrent 的 object_type 參數同此編號） */
  id: number;
  key: string;
  zh: string;
  en: string;
  dwSlope: number; dwOffset: number; dwStd: number;
  cwrSlope: number; cwrOffset: number; cwrStd: number;
  cwlSlope: number; cwlOffset: number; cwlStd: number;
}

/** 係數逐字取自 OpenDrift OBJECTPROP.DAT（同序號），只收 MOB / 搜救常用的幾類 */
export const LEEWAY_OBJECTS: LeewayObject[] = [
  { id: 1, key: "PIW-1", zh: "落水人員（狀態不明，平均值）", en: "Person in water, unknown state",
    dwSlope: 0.96, dwOffset: 0, dwStd: 12, cwrSlope: 0.54, cwrOffset: 0, cwrStd: 9.4, cwlSlope: -0.54, cwlOffset: 0, cwlStd: 9.4 },
  { id: 2, key: "PIW-2", zh: "落水人員，直立、穿 III 型救生衣、有意識", en: "PIW, vertical, PFD type III, conscious",
    dwSlope: 0.48, dwOffset: 0, dwStd: 8.3, cwrSlope: 0.15, cwrOffset: 0, cwrStd: 6.7, cwlSlope: -0.15, cwlOffset: 0, cwlStd: 6.7 },
  { id: 3, key: "PIW-3", zh: "落水人員，坐姿、穿 I / II 型救生衣", en: "PIW, sitting, PFD type I or II",
    dwSlope: 1.6, dwOffset: -3.98, dwStd: 2.42, cwrSlope: 0.13, cwrOffset: 0.33, cwrStd: 2.11, cwlSlope: -0.13, cwlOffset: -0.33, cwlStd: 2.11 },
  { id: 4, key: "PIW-4", zh: "落水人員，穿救生衣（臉朝上）", en: "PIW, survival suit (face up)",
    dwSlope: 1.71, dwOffset: 1.12, dwStd: 3.93, cwrSlope: 1.36, cwrOffset: -3.3, cwrStd: 1.71, cwlSlope: -0.13, cwlOffset: -2.65, cwlStd: 1.62 },
  { id: 5, key: "PIW-5", zh: "落水人員，穿潛水衣（臉朝上）", en: "PIW, scuba suit (face up)",
    dwSlope: 0.63, dwOffset: 0, dwStd: 5.3, cwrSlope: 0.31, cwrOffset: 0, cwrStd: 4.5, cwlSlope: -0.31, cwlOffset: 0, cwlStd: 4.5 },
  { id: 6, key: "PIW-6", zh: "落水人員，已無生命跡象（臉朝下）", en: "PIW, deceased (face down)",
    dwSlope: 1.117, dwOffset: 10.2, dwStd: 3.04, cwrSlope: 0.04, cwrOffset: 3.9, cwrStd: 4.05, cwlSlope: -0.04, cwlOffset: -3.9, cwlStd: 4.05 },
  { id: 7, key: "LIFE-RAFT-DB-10", zh: "救生筏，深壓艙（容量 / 載重不明）", en: "Life raft, deep ballast, general",
    dwSlope: 3.52, dwOffset: -2.5, dwStd: 6.1, cwrSlope: 0.62, cwrOffset: -3, cwrStd: 3.5, cwlSlope: -0.45, cwlOffset: -0.2, cwlStd: 3.6 },
  { id: 20, key: "LIFE-RAFT-SB-6", zh: "救生筏，淺壓艙＋頂篷", en: "Life raft, shallow ballast + canopy",
    dwSlope: 2.68, dwOffset: 0, dwStd: 12, cwrSlope: 1.1, cwrOffset: 0, cwrStd: 9.4, cwlSlope: -1.1, cwlOffset: 0, cwlStd: 9.4 },
  { id: 26, key: "LIFE-RAFT-NB-1", zh: "救生筏，無壓艙（seacurrent 預設）", en: "Life raft, no ballast (seacurrent default)",
    dwSlope: 3.7, dwOffset: 0, dwStd: 12, cwrSlope: 1.98, cwrOffset: 0, cwrStd: 9.4, cwlSlope: -1.98, cwlOffset: 0, cwlStd: 9.4 },
  { id: 44, key: "SKIFF-1", zh: "小艇（舷外機快艇）", en: "Skiff, outboard runabout",
    dwSlope: 3.15, dwOffset: 0, dwStd: 2.2, cwrSlope: 1.29, cwrOffset: 0, cwrStd: 2.2, cwlSlope: -1.29, cwlOffset: 0, cwlStd: 2.2 },
  { id: 50, key: "FISHING-VESSEL-1", zh: "漁船（失去動力，平均值）", en: "Fishing vessel, general",
    dwSlope: 2.47, dwOffset: 0, dwStd: 12, cwrSlope: 2.76, cwrOffset: 0, cwrStd: 9.4, cwlSlope: -2.76, cwlOffset: 0, cwlStd: 9.4 },
  { id: 66, key: "FV-DEBRIS", zh: "漁船殘骸", en: "Fishing vessel debris",
    dwSlope: 1.97, dwOffset: 0, dwStd: 8.3, cwrSlope: 0.36, cwrOffset: 0, cwrStd: 6.7, cwlSlope: -0.36, cwlOffset: 0, cwlStd: 6.7 },
];

export function leewayObject(id: number): LeewayObject {
  return LEEWAY_OBJECTS.find((o) => o.id === id) ?? LEEWAY_OBJECTS[0]!;
}

/** 某時刻的向量場取樣器：回傳 [東向, 北向] m/s；null = 無資料 */
export type VectorSampler = (lng: number, lat: number) => [number, number] | null;

export interface DriftEnvironment {
  /** 海流：null = 陸地或網格外 → 粒子擱淺 */
  currentAt(tMs: number): VectorSampler;
  /** 10 m 風：null = 網格外 → 該步不算風壓漂移 */
  windAt(tMs: number): VectorSampler;
}

export interface LeewayInput {
  lkp: LngLat;
  /** 落水位置誤差（圓常態 1σ，浬） */
  positionSigmaNm: number;
  /** 落水時刻（epoch ms） */
  startMs: number;
  /** 推算時數 */
  hours: number;
  objectId: number;
  count: number;
  seed: number;
  /** 積分步長（分鐘），預設 10 */
  stepMin?: number;
  /** 每小時換邊機率，OpenDrift 預設 0.04 */
  jibeProbPerHr?: number;
}

export interface LeewayResult {
  /** 第 h 小時（0..hours）的粒子位置：[lng0, lat0, lng1, lat1, ...] */
  hourly: Float32Array[];
  /** 第 h 小時時是否已擱淺 */
  strandedHourly: Uint8Array[];
  count: number;
  hours: number;
  startMs: number;
  /** 有幾個積分步驟的風場取不到（粒子 × 步數） */
  windMissingSteps: number;
  totalSteps: number;
}

const M_PER_DEG_LAT = 111_320;
const KM_PER_NM = 1.852;

function makeRng(seed: number): () => number {
  let s = (seed >>> 0) || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

function gaussian(rng: () => number): number {
  const u1 = Math.max(1e-12, rng());
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * rng());
}

export function runLeeway(input: LeewayInput, env: DriftEnvironment): LeewayResult {
  const obj = leewayObject(input.objectId);
  const n = Math.max(1, Math.floor(input.count));
  const hours = Math.max(0, Math.ceil(input.hours));
  const stepMin = input.stepMin ?? 10;
  const stepsPerHour = Math.max(1, Math.round(60 / stepMin));
  const dt = 3600 / stepsPerHour;
  const jibeP = 1 - Math.exp(-(-Math.log(1 - (input.jibeProbPerHr ?? 0.04)) / 3600) * dt);
  const rng = makeRng(input.seed);

  const lng = new Float64Array(n);
  const lat = new Float64Array(n);
  const dwSlope = new Float64Array(n);
  const dwEps = new Float64Array(n);
  const cwSlope = new Float64Array(n);
  const cwOffset = new Float64Array(n);
  const cwEps = new Float64Array(n);
  const stranded = new Uint8Array(n);

  const [lng0, lat0] = input.lkp;
  const sigmaDegLat = (input.positionSigmaNm * KM_PER_NM * 1000) / M_PER_DEG_LAT;
  const sigmaDegLng = sigmaDegLat / Math.cos((lat0 * Math.PI) / 180);
  for (let i = 0; i < n; i++) {
    lng[i] = lng0 + gaussian(rng) * sigmaDegLng;
    lat[i] = lat0 + gaussian(rng) * sigmaDegLat;
    // 順風係數擾動：避免斜率變負（物體必須順風漂）
    let e = gaussian(rng) * obj.dwStd;
    while (obj.dwSlope + e / 20 < 0) e = gaussian(rng) * obj.dwStd;
    dwSlope[i] = obj.dwSlope;
    dwEps[i] = e;
    // 奇數偏左、偶數偏右（與 OpenDrift 相同）
    const left = i % 2 === 1;
    cwSlope[i] = left ? obj.cwlSlope : obj.cwrSlope;
    cwOffset[i] = left ? obj.cwlOffset : obj.cwrOffset;
    cwEps[i] = gaussian(rng) * (left ? obj.cwlStd : obj.cwrStd);
  }

  const snapshot = (): [Float32Array, Uint8Array] => {
    const pos = new Float32Array(n * 2);
    for (let i = 0; i < n; i++) { pos[i * 2] = lng[i]!; pos[i * 2 + 1] = lat[i]!; }
    return [pos, stranded.slice()];
  };

  // 起點就在陸地上（LKP 點到岸上或誤差圈跨岸）的粒子直接標擱淺
  const cur0 = env.currentAt(input.startMs);
  for (let i = 0; i < n; i++) if (!cur0(lng[i]!, lat[i]!)) stranded[i] = 1;

  const first = snapshot();
  const hourly: Float32Array[] = [first[0]];
  const strandedHourly: Uint8Array[] = [first[1]];
  let windMissing = 0;
  let total = 0;

  for (let h = 0; h < hours; h++) {
    for (let s = 0; s < stepsPerHour; s++) {
      const tMs = input.startMs + (h * stepsPerHour + s) * dt * 1000;
      const cur = env.currentAt(tMs);
      const wind = env.windAt(tMs);
      for (let i = 0; i < n; i++) {
        if (stranded[i]) continue;
        total++;
        const c = cur(lng[i]!, lat[i]!);
        if (!c) { stranded[i] = 1; continue; }
        let ux = c[0];
        let uy = c[1];
        const w = wind(lng[i]!, lat[i]!);
        if (w) {
          const W = Math.hypot(w[0], w[1]);
          const th = Math.atan2(w[0], w[1]);   // 風「吹向」的方位
          const dw = ((dwSlope[i]! + dwEps[i]! / 20) * W + obj.dwOffset + dwEps[i]! / 2) * 0.01;
          const cw = ((cwSlope[i]! + cwEps[i]! / 20) * W + cwOffset[i]! + cwEps[i]! / 2) * 0.01;
          // OpenDrift：update_positions(-x_leeway, y_leeway)
          ux += dw * Math.sin(th) - cw * Math.cos(th);
          uy += dw * Math.cos(th) + cw * Math.sin(th);
        } else {
          windMissing++;
        }
        const la = lat[i]!;
        lat[i] = la + (uy * dt) / M_PER_DEG_LAT;
        lng[i] = lng[i]! + (ux * dt) / (M_PER_DEG_LAT * Math.cos((la * Math.PI) / 180));
        // 換邊：OpenDrift 只翻側風斜率的正負
        if (rng() < jibeP) cwSlope[i] = -cwSlope[i]!;
      }
    }
    const snap = snapshot();
    hourly.push(snap[0]);
    strandedHourly.push(snap[1]);
  }

  return { hourly, strandedHourly, count: n, hours, startMs: input.startMs, windMissingSteps: windMissing, totalSteps: total };
}

/** 第 tHr 小時（可為小數，線性內插；超出範圍取端點）的粒子位置 */
export function positionsAt(result: LeewayResult, tHr: number): { pos: Float32Array; stranded: Uint8Array } {
  const t = Math.min(Math.max(0, tHr), result.hours);
  const h0 = Math.floor(t);
  const h1 = Math.min(result.hours, h0 + 1);
  const f = t - h0;
  const a = result.hourly[h0]!;
  const b = result.hourly[h1]!;
  if (f === 0 || h0 === h1) return { pos: a, stranded: result.strandedHourly[h0]! };
  const pos = new Float32Array(a.length);
  for (let k = 0; k < a.length; k++) pos[k] = a[k]! + (b[k]! - a[k]!) * f;
  return { pos, stranded: result.strandedHourly[h1]! };
}
