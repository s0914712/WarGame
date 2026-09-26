/**
 * 目標位置機率分布 —— Stone (1983) §2、§6。
 *
 * 這是本規劃器原本整個缺席的一半。Stone §1 列出分析者的六項任務，
 * 其中第 1（事前分布）、第 5（依搜索結果更新）、第 6（搜索效能）
 * 都建立在「目標位置是一個機率分布」之上，而不是「使用者畫的一個框」。
 *
 * ── 表示法：加權粒子（Stone §2, p.213 的 CASP 表示法）──────
 * 目標分布以 J 個粒子表示，第 j 個粒子是向量
 *
 *   (Xⱼ, Yⱼ, Uⱼ, Vⱼ, Tⱼ, wⱼ, nⱼ)
 *
 * = 位置、南北/東西速度、時間、權重、來自第幾個 scenario。
 * 有 N 個 scenario、第 n 個機率 qₙ 時，抽 qₙ·J 個粒子；初始位置由該
 * scenario 的位置分布抽樣，速度由其運動分布抽樣。CASP 典型用 J = 10,000。
 *
 * 用粒子而非解析高斯的理由（Stone §2）：多 scenario 加權後的分布通常
 * 不是常態，而且運動模型（風流合成）會讓它進一步偏離。
 *
 * ── 失敗搜索的更新（Stone §6 式 2）────────────────────────
 *
 *   p̃(j) = p(j)·(1 − b(j, tⱼ)) / Σₖ p(k)·(1 − b(k, tₖ))
 *
 * 搜完沒找到 → 把「本來就該被搜到卻沒被搜到」的地方降權，機率質量自動
 * 流向沒搜過的區域。下一趟就該往那裡搜 —— 這是「規劃器」與「計算機」
 * 的分界線。
 *
 * 本模組的 b(j) 直接用蒙地卡羅那份 Koopman 反立方律的封閉解計算，
 * 因此更新所用的偵測模型與模擬完全一致。
 *
 * 純函式 + 可重現亂數。
 */
import type { LngLat } from "../types";
import { makeRng } from "../sim/rng";
import { KM_PER_NM } from "./patterns";
import { segmentDetectionExponent } from "./monteCarlo";
import type { DroneTrack } from "./tracks";

const KM_PER_DEG_LAT = 111.32;
const kmPerDegLng = (lat: number) => KM_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);

/**
 * 一個搜索情境（scenario）—— Stone §2：線索與可能解釋分組成數個
 * 各自邏輯自洽的 scenario，每個給一個機率描述與可信度權重。
 */
export interface SearchScenario {
  id: string;
  /** 情境名稱（中文） */
  label: string;
  /** 情境名稱（英文）；省略則英文介面沿用 label */
  labelEn?: string;
  /** 情境可信度 qₙ（會自動正規化） */
  weight: number;
  /** 最後已知位置 / 基準點 */
  datum: LngLat;
  /** 初始位置誤差（圓常態 1σ，浬）。如 LORAN / GPS 定位誤差、目視回報誤差 */
  positionSigmaNm: number;
  /** 漂流速度（節）：風流合成的平均值與標準差 */
  driftSpeedKn: number;
  driftSpeedSigmaKn: number;
  /** 漂流航向（度，0=北）平均值與標準差 */
  driftCourseDeg: number;
  driftCourseSigmaDeg: number;
}

/** 加權粒子（CASP 表示法） */
export interface Particle {
  lng: number;
  lat: number;
  /** 東向速度（節） */
  uKn: number;
  /** 北向速度（節） */
  vKn: number;
  weight: number;
  scenarioId: string;
}

/** Box–Muller 標準常態 */
function gaussian(rng: () => number): number {
  const u1 = Math.max(1e-12, rng());
  return Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * rng());
}

function offsetNm(origin: LngLat, dxNm: number, dyNm: number): LngLat {
  const [lng, lat] = origin;
  return [
    lng + (dxNm * KM_PER_NM) / kmPerDegLng(lat),
    lat + (dyNm * KM_PER_NM) / KM_PER_DEG_LAT,
  ];
}

/**
 * 依各 scenario 的權重抽出粒子群。
 * Stone §2：第 n 個 scenario 分到 qₙ·J 個粒子，初始權重 wⱼ = 1/J。
 */
export function sampleParticles(
  scenarios: SearchScenario[],
  count: number,
  seed = 20260906,
): Particle[] {
  const total = scenarios.reduce((s, x) => s + Math.max(0, x.weight), 0);
  if (total <= 0 || scenarios.length === 0) return [];
  const rng = makeRng(seed);
  const J = Math.max(1, Math.floor(count));
  const out: Particle[] = [];

  for (const sc of scenarios) {
    const q = Math.max(0, sc.weight) / total;
    const n = Math.round(q * J);
    for (let i = 0; i < n; i++) {
      const pos = offsetNm(
        sc.datum,
        gaussian(rng) * sc.positionSigmaNm,
        gaussian(rng) * sc.positionSigmaNm,
      );
      const speed = Math.max(0, sc.driftSpeedKn + gaussian(rng) * sc.driftSpeedSigmaKn);
      const courseRad = ((sc.driftCourseDeg + gaussian(rng) * sc.driftCourseSigmaDeg) * Math.PI) / 180;
      out.push({
        lng: pos[0],
        lat: pos[1],
        uKn: speed * Math.sin(courseRad),
        vKn: speed * Math.cos(courseRad),
        weight: 1 / J,
        scenarioId: sc.id,
      });
    }
  }
  return normalize(out);
}

/** 權重正規化 */
export function normalize(ps: Particle[]): Particle[] {
  const total = ps.reduce((s, p) => s + p.weight, 0);
  if (total <= 0) return ps.map((p) => ({ ...p, weight: 1 / Math.max(1, ps.length) }));
  return ps.map((p) => ({ ...p, weight: p.weight / total }));
}

/**
 * 推進粒子到 hours 小時後的位置（等速直線）。
 *
 * Stone §2 的範例用 Integrated Ornstein-Uhlenbeck 過程讓洋流隨時間去相關，
 * 但他在 §2 Problem Areas 自己指出：該模型「因資料稀少而未經檢驗，
 * 連鬆弛率 λ 都沒有好的估計」。故此處採等速直線（每個粒子的速度在抽樣時
 * 就固定），這相當於 λ→0 的極限，是保守且可驗證的選擇。
 */
export function propagate(ps: Particle[], hours: number): Particle[] {
  if (hours === 0) return ps;
  return ps.map((p) => {
    const next = offsetNm([p.lng, p.lat], p.uKn * hours, p.vKn * hours);
    return { ...p, lng: next[0], lat: next[1] };
  });
}

/** 粒子雲的統計量 —— 餵給最佳矩形計算 */
export interface DistributionStats {
  /** 加權平均位置 */
  meanLngLat: LngLat;
  /** 東西向 / 南北向的邊際標準差（浬）—— 軸對齊矩形用這兩個 */
  sigmaEastNm: number;
  sigmaNorthNm: number;
  /** 主軸標準差（浬，σ1 ≥ σ2）與主軸方位（度，0=北） */
  sigmaMajorNm: number;
  sigmaMinorNm: number;
  majorAxisBearingDeg: number;
  /** 相關係數；|ρ| 大表示軸對齊矩形會比主軸對齊矩形吃虧 */
  correlation: number;
}

export function distributionStats(ps: Particle[]): DistributionStats | null {
  if (ps.length === 0) return null;
  const wsum = ps.reduce((s, p) => s + p.weight, 0);
  if (wsum <= 0) return null;
  const mLng = ps.reduce((s, p) => s + p.weight * p.lng, 0) / wsum;
  const mLat = ps.reduce((s, p) => s + p.weight * p.lat, 0) / wsum;
  const kLng = kmPerDegLng(mLat) / KM_PER_NM;   // 每度經度多少浬
  const kLat = KM_PER_DEG_LAT / KM_PER_NM;

  let sxx = 0, syy = 0, sxy = 0;
  for (const p of ps) {
    const dx = (p.lng - mLng) * kLng;
    const dy = (p.lat - mLat) * kLat;
    const w = p.weight / wsum;
    sxx += w * dx * dx;
    syy += w * dy * dy;
    sxy += w * dx * dy;
  }

  // 2×2 共變異數矩陣特徵值
  const tr = sxx + syy;
  const det = sxx * syy - sxy * sxy;
  const disc = Math.max(0, (tr * tr) / 4 - det);
  const l1 = tr / 2 + Math.sqrt(disc);
  const l2 = Math.max(0, tr / 2 - Math.sqrt(disc));
  // 主軸方向（東為 x、北為 y）→ 轉成羅盤方位
  const angleMathRad = Math.abs(sxy) < 1e-12 && Math.abs(sxx - syy) < 1e-12
    ? 0
    : 0.5 * Math.atan2(2 * sxy, sxx - syy);
  const bearing = (90 - (angleMathRad * 180) / Math.PI + 360) % 360;

  const sx = Math.sqrt(sxx), sy = Math.sqrt(syy);
  return {
    meanLngLat: [mLng, mLat],
    sigmaEastNm: sx,
    sigmaNorthNm: sy,
    sigmaMajorNm: Math.sqrt(l1),
    sigmaMinorNm: Math.sqrt(l2),
    majorAxisBearingDeg: bearing,
    correlation: sx > 0 && sy > 0 ? sxy / (sx * sy) : 0,
  };
}

// ── 失敗搜索的貝氏更新（Stone §6 式 2）────────────────────
export interface SearchFeedbackInput {
  particles: Particle[];
  /** 本趟實際飛的航線 */
  tracks: DroneTrack[];
  /** 修正後掃掠寬度（浬） */
  sweepWidthNm: number;
}

export interface SearchFeedbackResult {
  /** 更新後的粒子（已正規化） */
  particles: Particle[];
  /**
   * 本趟的成功機率 POS（probability of success）
   * = Σⱼ wⱼ·b(j)，即「若目標真在這個分布裡，這趟找到它的機率」。
   */
  pos: number;
  /** 加權平均偵測機率（等於 pos，另列供理解） */
  meanDetection: number;
  /** 有多少機率質量落在完全沒被搜到的地方（b < 1%） */
  unsearchedMass: number;
}

/**
 * 對每個粒子算本趟的偵測機率 b(j)，再套 Stone 式 (2) 更新權重。
 *
 * b(j) = 1 − exp(−Σ 航段偵測指數)，用的是與蒙地卡羅同一份
 * Koopman 反立方律封閉解，故「模擬」與「更新」不會用到兩套模型。
 */
export function updateForUnsuccessfulSearch(input: SearchFeedbackInput): SearchFeedbackResult {
  const { particles, tracks, sweepWidthNm } = input;
  if (particles.length === 0 || tracks.length === 0 || !(sweepWidthNm > 0)) {
    return { particles, pos: 0, meanDetection: 0, unsearchedMass: 1 };
  }
  const k = (sweepWidthNm * sweepWidthNm) / (4 * Math.PI);
  const first = particles[0];
  if (!first) return { particles, pos: 0, meanDetection: 0, unsearchedMass: 1 };
  const originLat = first.lat;
  const kLng = kmPerDegLng(originLat) / KM_PER_NM;
  const kLat = KM_PER_DEG_LAT / KM_PER_NM;
  const toLocal = (lng: number, lat: number): [number, number] => [lng * kLng, lat * kLat];

  // 航線先轉本地平面座標（浬）
  const localTracks = tracks.map((t) => t.waypoints.map((w) => toLocal(w[0], w[1])));

  let pos = 0;
  let unsearched = 0;
  const updated: Particle[] = particles.map((p) => {
    const [px, py] = toLocal(p.lng, p.lat);
    let exponent = 0;
    for (const path of localTracks) {
      for (let i = 1; i < path.length; i++) {
        const a = path[i - 1], b = path[i];
        if (!a || !b) continue;
        exponent += segmentDetectionExponent(px, py, a[0], a[1], b[0], b[1], k);
      }
    }
    const bDetect = 1 - Math.exp(-exponent);
    pos += p.weight * bDetect;
    if (bDetect < 0.01) unsearched += p.weight;
    // Stone 式 (2)：沒找到 → 權重乘上「沒被偵測到」的機率
    return { ...p, weight: p.weight * (1 - bDetect) };
  });

  return {
    particles: normalize(updated),
    pos,
    meanDetection: pos,
    unsearchedMass: unsearched,
  };
}

// ── 搜索效能與停止準則（Stone §7）─────────────────────────
/**
 * 累積成功機率。Stone §7「No False Targets」：對偵測與識別同時完成的
 * 感測器（目視、相機、EO/IR 皆屬此類），事前發現機率 P 本身就是很好的
 * 效能指標 —— 不需要 SEP（Stone 還指出 SEP 有個病態：一旦取得接觸
 * SEP 反而下降）。
 */
export function cumulativeSuccess(posPerSortie: number[]): number {
  let miss = 1;
  for (const p of posPerSortie) miss *= 1 - Math.max(0, Math.min(1, p));
  return 1 - miss;
}

export type StopAdvice = "continue" | "consider_stopping" | "exhausted";

/**
 * 停止建議。Stone §7：
 * 「P 高（如 0.9）意味著在假設條件下重複同樣的搜索，九成會找到目標。
 *  因此失敗是運氣不好或假設有誤，而非規劃不當 —— 我們已經用盡了
 *  搜索所依據的資訊；若無新情報，就該停。」
 * 「當然，"高" 的定義是主觀的。」故門檻可調。
 */
export function stopAdvice(cumulativePos: number, threshold = 0.9): StopAdvice {
  if (cumulativePos >= threshold) return "exhausted";
  if (cumulativePos >= threshold * 0.8) return "consider_stopping";
  return "continue";
}

/** 把粒子雲柵格化成機率圖（供地圖層繪製熱區） */
export interface ProbabilityCell {
  lng: number;
  lat: number;
  probability: number;
}

export function rasterize(ps: Particle[], cellSizeNm: number): ProbabilityCell[] {
  if (ps.length === 0 || cellSizeNm <= 0) return [];
  const first = ps[0];
  if (!first) return [];
  const dLat = (cellSizeNm * KM_PER_NM) / KM_PER_DEG_LAT;
  const dLng = (cellSizeNm * KM_PER_NM) / kmPerDegLng(first.lat);
  const bins = new Map<string, ProbabilityCell>();
  for (const p of ps) {
    const ix = Math.floor(p.lng / dLng);
    const iy = Math.floor(p.lat / dLat);
    const key = `${ix}|${iy}`;
    const cur = bins.get(key);
    if (cur) cur.probability += p.weight;
    else bins.set(key, { lng: (ix + 0.5) * dLng, lat: (iy + 0.5) * dLat, probability: p.weight });
  }
  return [...bins.values()].sort((a, b) => b.probability - a.probability);
}
