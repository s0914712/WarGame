/**
 * 突穿機率 —— 已知一艘船的回報位置、航向、航速，依目前規劃的搜索航線，
 * 求「船舶航經搜索區、卻未被發現」的機率（屏障搜索的漏失率）。
 *
 * 蒙地卡羅：每次試驗
 *   1. 抽船舶回報位置（± σ）、航向（± σc）、航速（± σs，≥ 0）
 *   2. 船舶自回報時刻起直線等速航行（t = 0 為搜索開始，回報時刻為 t = −T）
 *   3. 解析求出航線落在搜索區內的時間區間（進入 / 離開時刻）
 *   4. 搜索期間逐步推進各架無人機，偵測模型與 runMonteCarlo 相同
 *      （反立方律逐段積分、導航誤差、感測器可用率）；只計「最後離開搜索區之前」的偵測
 *   5. 分類：發現 / 突穿（進入過且離開時未被發現）/ 未經過搜索區 / 滯留區內未發現
 * 突穿再依離開時刻細分：搜索開始前已通過、搜索期間通過、航線飛完後才通過。
 *
 * 純函式、零 browser 依賴。
 */
import type { LngLat } from "../types";
import { makeRng } from "../sim/rng";
import { gaussian, resampleTrack, segmentDetectionExponent, toLocalNm, wilsonInterval } from "./monteCarlo";
import type { DroneTrack, SearchBox } from "./tracks";

export interface TransitShip {
  /** 回報位置 */
  position: LngLat;
  /** 回報位置誤差 1σ（浬） */
  sigmaNm: number;
  courseDeg: number;
  courseSigmaDeg: number;
  speedKn: number;
  speedSigmaKn: number;
  /** 回報時刻 → 搜索開始（hr）。2 = 回報後 2 小時無人機才開始飛航線 */
  reportToStartHr: number;
}

export interface TransitInput {
  box: SearchBox;
  /** 多邊形搜索區（box 為其外接框）；省略 = 以 box 為搜索區 */
  polygon?: LngLat[];
  tracks: DroneTrack[];
  sweepWidthNm: number;
  /** 無人機搜索速度（節） */
  speedKn: number;
  navErrorSigmaNm: number;
  sensorAvailability: number;
  ship: TransitShip;
  trials: number;
  stepSec?: number;
  seed?: number;
}

export interface TransitResult {
  trials: number;
  /** 船舶航線進入搜索區的比例 */
  pEnter: number;
  /** 被發現（離開搜索區前） */
  pDetected: number;
  /** 突穿：進入過搜索區、離開時仍未被發現 */
  pPenetrated: number;
  pPenetratedCi95: [number, number];
  /** 條件突穿機率：P(突穿 | 進入搜索區) —— 屏障漏失率 */
  pPenetratedGivenEnter: number;
  pPenetratedGivenEnterCi95: [number, number];
  /** 未經過搜索區（也未被發現） */
  pMissed: number;
  /** 航速 ≈ 0 停在區內、至航線結束仍未被發現 */
  pLoiter: number;
  /** 突穿依離開時刻細分（佔全部試驗的比例） */
  penetratedBeforeSearch: number;
  penetratedDuringSearch: number;
  penetratedAfterSearch: number;
  /** 進入搜索區的試驗中，進入時刻的中位數（hr，相對搜索開始；負值 = 搜索前已進入） */
  medianEntryHr: number | null;
  /** 航線飛完所需時數 */
  searchDurationHr: number;
}

/** 以參數 t 表示的直線 s(t) = s0 + v·t 落在多邊形內的時間區間（t ≥ tMin），已排序 */
export function insideIntervals(
  s0: [number, number], v: [number, number], poly: [number, number][], tMin: number,
): [number, number][] {
  const inside = (x: number, y: number) => pointInPoly(x, y, poly);
  const speed2 = v[0] * v[0] + v[1] * v[1];
  if (speed2 < 1e-12) {
    // 靜止：在區內就是從 tMin 起一直在區內
    return inside(s0[0], s0[1]) ? [[tMin, Infinity]] : [];
  }
  // 與各邊的交點時刻
  const ts: number[] = [];
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const p = poly[j], q = poly[i];
    if (!p || !q) continue;
    const ex = q[0] - p[0], ey = q[1] - p[1];
    const den = v[0] * ey - v[1] * ex;
    if (Math.abs(den) < 1e-12) continue;                 // 平行
    const wx = p[0] - s0[0], wy = p[1] - s0[1];
    const t = (wx * ey - wy * ex) / den;
    const u = (wx * v[1] - wy * v[0]) / den;
    if (u >= -1e-12 && u <= 1 + 1e-12) ts.push(t);
  }
  const cuts = [tMin, ...ts.filter((t) => t > tMin).sort((a, b) => a - b)];
  const out: [number, number][] = [];
  for (let k = 0; k < cuts.length; k++) {
    const a = cuts[k] as number;
    const b = k + 1 < cuts.length ? (cuts[k + 1] as number) : Infinity;
    if (b - a < 1e-9) continue;
    // 區間中點（最後一段取 a + 1 hr）判斷內外
    const mid = Number.isFinite(b) ? (a + b) / 2 : a + 1;
    if (inside(s0[0] + v[0] * mid, s0[1] + v[1] * mid)) {
      const last = out[out.length - 1];
      if (last && Math.abs(last[1] - a) < 1e-9) last[1] = b;   // 相鄰區間合併
      else out.push([a, b]);
    }
  }
  // 直線不可能在區內停留無限久（v ≠ 0），最後一段若到 ∞ 表示數值誤差 → 夾到最後交點
  return out.filter(([a, b]) => Number.isFinite(b) || a === tMin);
}

function pointInPoly(x: number, y: number, poly: [number, number][]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const pi = poly[i], pj = poly[j];
    if (!pi || !pj) continue;
    if ((pi[1] > y) !== (pj[1] > y) && x < ((pj[0] - pi[0]) * (y - pi[1])) / (pj[1] - pi[1]) + pi[0]) inside = !inside;
  }
  return inside;
}

export function runTransitAnalysis(input: TransitInput): TransitResult {
  const stepSec = input.stepSec ?? 30;
  const trials = Math.max(1, Math.floor(input.trials));
  const rng = makeRng(input.seed ?? 20260906);
  const origin: LngLat = [input.box.west, input.box.south];
  const ship = input.ship;

  const polyLocal: [number, number][] = input.polygon && input.polygon.length >= 3
    ? input.polygon.map((p) => toLocalNm(p, origin))
    : ([
      [input.box.west, input.box.south], [input.box.east, input.box.south],
      [input.box.east, input.box.north], [input.box.west, input.box.north],
    ] as LngLat[]).map((p) => toLocalNm(p, origin));

  const sampled = input.tracks.map((t) => resampleTrack(t, origin, input.speedKn, stepSec));
  const maxSteps = sampled.reduce((mx, s) => Math.max(mx, s.length), 0);
  const searchDurationHr = (maxSteps * stepSec) / 3600;
  const stepHr = stepSec / 3600;
  const trackNormals = sampled.map((s) => {
    const a = s[0], b = s[Math.min(1, s.length - 1)];
    if (!a || !b) return [0, 1] as [number, number];
    const dx = b[0] - a[0], dy = b[1] - a[1];
    const len = Math.hypot(dx, dy) || 1;
    return [-dy / len, dx / len] as [number, number];
  });
  const k = (input.sweepWidthNm * input.sweepWidthNm) / (4 * Math.PI);
  const pos0 = toLocalNm(ship.position, origin);
  const T = Math.max(0, ship.reportToStartHr);

  let entered = 0, detected = 0, penetrated = 0, missed = 0, loiter = 0;
  let penBefore = 0, penDuring = 0, penAfter = 0;
  const entryTimes: number[] = [];

  for (let n = 0; n < trials; n++) {
    // ── 抽樣船舶 ──
    const course = ((ship.courseDeg + gaussian(rng) * ship.courseSigmaDeg) * Math.PI) / 180;
    const spd = Math.max(0, ship.speedKn + gaussian(rng) * ship.speedSigmaKn);
    const v: [number, number] = [Math.sin(course) * spd, Math.cos(course) * spd];   // 浬/hr
    const rx = pos0[0] + gaussian(rng) * ship.sigmaNm;
    const ry = pos0[1] + gaussian(rng) * ship.sigmaNm;
    const s0: [number, number] = [rx + v[0] * T, ry + v[1] * T];                   // 搜索開始時位置

    const ivs = insideIntervals(s0, v, polyLocal, -T);
    const didEnter = ivs.length > 0;
    const lastIv = ivs[ivs.length - 1];
    const tExit = lastIv ? lastIv[1] : -Infinity;
    if (didEnter && ivs[0]) entryTimes.push(ivs[0][0]);

    // ── 各架導航偏移 / 感測器可用（與 runMonteCarlo 同序抽樣） ──
    const offsets: [number, number][] = [];
    const active: boolean[] = [];
    for (let d = 0; d < sampled.length; d++) {
      const e = input.navErrorSigmaNm > 0 ? gaussian(rng) * input.navErrorSigmaNm : 0;
      const nrm = trackNormals[d] ?? [0, 1];
      offsets.push([nrm[0] * e, nrm[1] * e]);
      active.push(rng() < input.sensorAvailability);
    }

    // ── 搜索期間逐步偵測；只計最後離開搜索區之前（未進入者則整段都計） ──
    const detectUntil = didEnter ? tExit : Infinity;
    let found = false;
    for (let step = 1; step < maxSteps && !found; step++) {
      const tMid = (step - 0.5) * stepHr;
      if (tMid > detectUntil) break;
      const mx = s0[0] + v[0] * tMid, my = s0[1] + v[1] * tMid;
      let exponent = 0;
      for (let d = 0; d < sampled.length; d++) {
        if (!active[d]) continue;
        const path = sampled[d];
        const a = path?.[step - 1], b = path?.[step];
        if (!a || !b) continue;
        const off = offsets[d] ?? [0, 0];
        exponent += segmentDetectionExponent(mx, my, a[0] + off[0], a[1] + off[1], b[0] + off[0], b[1] + off[1], k);
      }
      if (exponent > 0 && rng() < 1 - Math.exp(-exponent)) found = true;
    }

    if (didEnter) entered++;
    if (found) { detected++; continue; }
    if (!didEnter) { missed++; continue; }
    if (!Number.isFinite(tExit)) { loiter++; continue; }
    penetrated++;
    if (tExit <= 0) penBefore++;
    else if ((ivs[0]?.[0] ?? 0) >= searchDurationHr) penAfter++;
    else penDuring++;
  }

  entryTimes.sort((a, b) => a - b);
  const med = entryTimes.length > 0 ? entryTimes[Math.floor(entryTimes.length / 2)] ?? null : null;
  return {
    trials,
    pEnter: entered / trials,
    pDetected: detected / trials,
    pPenetrated: penetrated / trials,
    pPenetratedCi95: wilsonInterval(penetrated, trials),
    pPenetratedGivenEnter: entered > 0 ? penetrated / entered : 0,
    pPenetratedGivenEnterCi95: entered > 0 ? wilsonInterval(penetrated, entered) : [0, 0],
    pMissed: missed / trials,
    pLoiter: loiter / trials,
    penetratedBeforeSearch: penBefore / trials,
    penetratedDuringSearch: penDuring / trials,
    penetratedAfterSearch: penAfter / trials,
    medianEntryHr: med,
    searchDurationHr,
  };
}
