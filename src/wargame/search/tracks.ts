/**
 * 搜索航線產生 — 把圖形 + 搜索區 + 航跡間距轉成每架無人機的 waypoint 陣列。
 *
 * 產出可直接餵給 scenarioStore.enqueueCommand({ kind: "set_waypoints" })，
 * 讓無人機在兵推裡真的飛這條搜索航線。
 *
 * 幾何採局部平面近似（搜索區尺度 < 200 km，誤差 < 0.5%），與 sim/geo.ts 同慣例。
 */
import type { LngLat } from "../types";
import { KM_PER_NM, type SearchPatternId } from "./patterns";

const KM_PER_DEG_LAT = 111.32;

/** 搜索區：兩角定義的正矩形框（與聲標屏幕同慣例） */
export interface SearchBox {
  west: number; east: number; south: number; north: number;
}

export function boxFromCorners(a: LngLat, b: LngLat): SearchBox {
  return {
    west: Math.min(a[0], b[0]), east: Math.max(a[0], b[0]),
    south: Math.min(a[1], b[1]), north: Math.max(a[1], b[1]),
  };
}

function kmPerDegLng(latDeg: number): number {
  return KM_PER_DEG_LAT * Math.cos((latDeg * Math.PI) / 180);
}

/** 多邊形搜索區的頂點上限（手動輸入經緯度） */
export const MAX_POLYGON_VERTICES = 10;

/** 多邊形的外接正矩形 —— 既有以框為基礎的計算（分布、密度、標籤位置）沿用它 */
export function boxFromPolygon(poly: LngLat[]): SearchBox {
  let west = Infinity, east = -Infinity, south = Infinity, north = -Infinity;
  for (const [lng, lat] of poly) {
    west = Math.min(west, lng); east = Math.max(east, lng);
    south = Math.min(south, lat); north = Math.max(north, lat);
  }
  return { west, east, south, north };
}

/** 射線法判斷點是否在多邊形內（經緯度平面即可，搜索區尺度下不影響內外判定） */
export function pointInPolygon(lng: number, lat: number, poly: LngLat[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const pi = poly[i], pj = poly[j];
    if (!pi || !pj) continue;
    if ((pi[1] > lat) !== (pj[1] > lat)
      && lng < ((pj[0] - pi[0]) * (lat - pi[1])) / (pj[1] - pi[1]) + pi[0]) {
      inside = !inside;
    }
  }
  return inside;
}

/**
 * 多邊形面積（浬²）—— 以外接框中緯度做局部平面投影後套鞋帶公式。
 * 回傳 0 代表退化（共線 / 點數不足）。
 */
export function polygonAreaNm2(poly: LngLat[]): number {
  if (poly.length < 3) return 0;
  const box = boxFromPolygon(poly);
  const kx = kmPerDegLng((box.north + box.south) / 2) / KM_PER_NM;
  const ky = KM_PER_DEG_LAT / KM_PER_NM;
  let twice = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const pi = poly[i], pj = poly[j];
    if (!pi || !pj) continue;
    twice += (pj[0] * kx) * (pi[1] * ky) - (pi[0] * kx) * (pj[1] * ky);
  }
  return Math.abs(twice) / 2;
}

/** 兩邊是否相交（不含共用端點的相鄰邊）—— 用來擋掉自相交的多邊形 */
function segmentsCross(a: LngLat, b: LngLat, c: LngLat, d: LngLat): boolean {
  const o = (p: LngLat, q: LngLat, r: LngLat) => (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const d1 = o(c, d, a), d2 = o(c, d, b), d3 = o(a, b, c), d4 = o(a, b, d);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
}

export type PolygonIssue = "too_few" | "too_many" | "invalid_coord" | "self_intersecting" | "zero_area";

/** 檢查使用者輸入的多邊形；null = 合法 */
export function validatePolygon(poly: LngLat[]): PolygonIssue | null {
  if (poly.length < 3) return "too_few";
  if (poly.length > MAX_POLYGON_VERTICES) return "too_many";
  for (const [lng, lat] of poly) {
    if (!Number.isFinite(lng) || !Number.isFinite(lat) || Math.abs(lng) > 180 || Math.abs(lat) > 85) {
      return "invalid_coord";
    }
  }
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      // 相鄰邊（含首尾）共用頂點，不算相交
      if (j === i + 1 || (i === 0 && j === n - 1)) continue;
      const a = poly[i], b = poly[(i + 1) % n], c = poly[j], d = poly[(j + 1) % n];
      if (a && b && c && d && segmentsCross(a, b, c, d)) return "self_intersecting";
    }
  }
  if (!(polygonAreaNm2(poly) > 0)) return "zero_area";
  return null;
}

/**
 * 一條航段（局部浬座標中，固定 creepOff 的水平或垂直線）被多邊形截出的區間。
 * 回傳沿航段方向 [起, 迄] 的浬數區間，已排序；凹多邊形可能有多段。
 */
function legIntervalsInPolygon(
  polyLocal: [number, number][], legIsEastWest: boolean, creepOff: number,
): [number, number][] {
  const xs: number[] = [];
  for (let i = 0, j = polyLocal.length - 1; i < polyLocal.length; j = i++) {
    const pi = polyLocal[i], pj = polyLocal[j];
    if (!pi || !pj) continue;
    // 航段為東西向 → 掃描線 y = creepOff；南北向 → x = creepOff
    const [ai, bi] = legIsEastWest ? [pi[1], pi[0]] : [pi[0], pi[1]];
    const [aj, bj] = legIsEastWest ? [pj[1], pj[0]] : [pj[0], pj[1]];
    if ((ai > creepOff) !== (aj > creepOff)) {
      xs.push(bi + ((creepOff - ai) / (aj - ai)) * (bj - bi));
    }
  }
  xs.sort((p, q) => p - q);
  const out: [number, number][] = [];
  for (let k = 0; k + 1 < xs.length; k += 2) {
    const s = xs[k], e = xs[k + 1];
    if (s !== undefined && e !== undefined && e - s > 1e-6) out.push([s, e]);
  }
  return out;
}

/** 搜索區幾何量測（浬） */
export function measureBox(box: SearchBox): {
  widthNm: number; heightNm: number; areaNm2: number;
  longSideNm: number; shortSideNm: number;
  /** 長邊是否為東西向 */
  longAxisIsEastWest: boolean;
  centre: LngLat;
} {
  const midLat = (box.north + box.south) / 2;
  const widthKm = (box.east - box.west) * kmPerDegLng(midLat);
  const heightKm = (box.north - box.south) * KM_PER_DEG_LAT;
  const widthNm = Math.abs(widthKm) / KM_PER_NM;
  const heightNm = Math.abs(heightKm) / KM_PER_NM;
  return {
    widthNm, heightNm,
    areaNm2: widthNm * heightNm,
    longSideNm: Math.max(widthNm, heightNm),
    shortSideNm: Math.min(widthNm, heightNm),
    longAxisIsEastWest: widthNm >= heightNm,
    centre: [(box.west + box.east) / 2, (box.south + box.north) / 2],
  };
}

/** 以 origin 為原點，偏移 (東 dxNm, 北 dyNm) 浬後的座標 */
function offsetNm(origin: LngLat, dxNm: number, dyNm: number): LngLat {
  const [lng, lat] = origin;
  const dLat = (dyNm * KM_PER_NM) / KM_PER_DEG_LAT;
  const dLng = (dxNm * KM_PER_NM) / kmPerDegLng(lat);
  return [lng + dLng, lat + dLat];
}

/** 每架搜索航線一色 —— 地圖圖層與 UI 清單共用，序號對應 DroneTrack.index */
export const TRACK_COLORS = [
  "#38bdf8", "#fbbf24", "#a78bfa", "#4ade80",
  "#f472b6", "#fb923c", "#22d3ee", "#facc15",
];

/** 一架無人機的搜索航線 */
export interface DroneTrack {
  /** 0-based 序號，對應第幾架 */
  index: number;
  waypoints: LngLat[];
  /** 航跡總長（浬） */
  trackNm: number;
}

export interface GenerateTracksInput {
  pattern: SearchPatternId;
  box: SearchBox;
  trackSpacingNm: number;
  droneCount: number;
  /** SS / VS 用的基準點；省略 → 取搜索區中心 */
  datum?: LngLat;
  /** SS / VS 的搜索半徑（浬）；省略 → 取搜索區短邊的一半 */
  radiusNm?: number;
  /** TS 用的航路兩端；省略 → 取搜索區長軸中線 */
  trackLine?: [LngLat, LngLat];
  /**
   * 多邊形搜索區（3–10 點）。提供時 box 應為其外接框；
   * PS / CS 的航段會被裁切到多邊形內，其他圖形以基準點為中心不受影響。
   */
  polygon?: LngLat[];
}

function trackLengthNm(wps: LngLat[]): number {
  let total = 0;
  for (let i = 1; i < wps.length; i++) {
    const cur = wps[i], prev = wps[i - 1];
    if (!cur || !prev) continue;
    const midLat = (cur[1] + prev[1]) / 2;
    const dxKm = (cur[0] - prev[0]) * kmPerDegLng(midLat);
    const dyKm = (cur[1] - prev[1]) * KM_PER_DEG_LAT;
    total += Math.hypot(dxKm, dyKm) / KM_PER_NM;
  }
  return total;
}

/**
 * 平行航跡 / 蠕行線 —— 兩者僅差在航段平行長邊還是短邊。
 *
 * 文件三(三)：搜索載具自搜索區一角進入，第一條航跡距搜索區一側為 ½ 航跡間距，
 * 後續各航跡彼此平行、相隔 1 個航跡間距。
 * 多機：把搜索區沿「推進方向」切成等份，一機一份（等同橫隊並列，彼此隔 1 S）。
 */
function generateLadder(input: GenerateTracksInput, legsAlongLongAxis: boolean): DroneTrack[] {
  const m = measureBox(input.box);
  const S = Math.max(0.01, input.trackSpacingNm);
  const sw: LngLat = [input.box.west, input.box.south];

  // legAxis = 航段延伸方向；creepAxis = 逐條推進方向
  const legIsEastWest = legsAlongLongAxis ? m.longAxisIsEastWest : !m.longAxisIsEastWest;
  const legLenNm = legIsEastWest ? m.widthNm : m.heightNm;
  const creepLenNm = legIsEastWest ? m.heightNm : m.widthNm;

  // 多邊形：轉成以西南角為原點的局部浬座標，供航段裁切
  const kx = kmPerDegLng(sw[1]) / KM_PER_NM;
  const ky = KM_PER_DEG_LAT / KM_PER_NM;
  const polyLocal = input.polygon && input.polygon.length >= 3
    ? input.polygon.map(([lng, lat]) => [(lng - sw[0]) * kx, (lat - sw[1]) * ky] as [number, number])
    : null;
  /** 第 legIdx 條航段在區內的區間（矩形時就是整條） */
  const intervalsFor = (creepOff: number): [number, number][] =>
    polyLocal ? legIntervalsInPolygon(polyLocal, legIsEastWest, creepOff) : [[0, legLenNm]];
  const at = (along: number, creepOff: number): LngLat =>
    legIsEastWest ? offsetNm(sw, along, creepOff) : offsetNm(sw, creepOff, along);

  const totalLegs = Math.max(1, Math.ceil(creepLenNm / S));
  const n = Math.max(1, Math.floor(input.droneCount));
  const tracks: DroneTrack[] = [];

  // 先算出每條航段在區內的區間（矩形時就是整條）
  const legs = Array.from({ length: totalLegs }, (_, legIdx) => {
    // 文件：第一條航跡距邊 ½ S，之後每條 +1 S
    // 多邊形：最後一條若超出範圍，改放在剩餘條帶的中線 —— 夾到遠側邊上
    // 常常只碰到一個頂點（如三角形尖端），裁出來的航段長度趨近 0
    const nominal = (legIdx + 0.5) * S;
    const creepOff = polyLocal && nominal > creepLenNm
      ? (legIdx * S + creepLenNm) / 2
      : Math.min(nominal, creepLenNm);
    return { creepOff, intervals: intervalsFor(creepOff) };
  }).filter((l) => l.intervals.length > 0);   // 多邊形在該航段上沒有面積 → 略過

  // 分配給各機（連續切塊）：
  //   矩形 → 各段等長，照條數均分（餘數分給前幾架）
  //   多邊形 → 各段長短不一，改依累計長度均分，避免某架負擔遠多於他機
  // 以實際飛行跨距計（含凹多邊形區間之間跨越缺口的那段）
  const legLen = (l: (typeof legs)[number]) =>
    (l.intervals[l.intervals.length - 1]?.[1] ?? 0) - (l.intervals[0]?.[0] ?? 0);
  const counts: number[] = [];
  if (!polyLocal) {
    const base = Math.floor(legs.length / n);
    const extra = legs.length % n;
    for (let d = 0; d < n; d++) counts.push(base + (d < extra ? 1 : 0));
  } else {
    const total = legs.reduce((acc, l) => acc + legLen(l), 0);
    let cum = 0, start = 0;
    for (let d = 0; d < n; d++) {
      const target = (total * (d + 1)) / n;
      let end = start;
      // 至少留給後面每架各一條（若還有的話）
      const maxEnd = legs.length - Math.max(0, n - d - 1);
      while (end < legs.length && (end < maxEnd || d === n - 1)) {
        const l = legs[end];
        if (!l) break;
        const len = legLen(l);
        // 加進這條後離目標較近才加
        if (d < n - 1 && end > start && Math.abs(cum + len - target) > Math.abs(cum - target)) break;
        cum += len;
        end++;
      }
      counts.push(end - start);
      start = end;
    }
  }

  let legCursor = 0;
  for (let d = 0; d < n; d++) {
    const myLegs = counts[d] ?? 0;
    const wps: LngLat[] = [];
    for (let k = 0; k < myLegs; k++) {
      const leg = legs[legCursor + k];
      if (!leg) continue;
      // boustrophedon：偶數段順向、奇數段逆向，迴轉自然落在區外側
      const forward = k % 2 === 0;
      const ordered = forward ? leg.intervals : [...leg.intervals].reverse();
      for (const [s0, e0] of ordered) {
        const [a, b] = forward ? [s0, e0] : [e0, s0];
        wps.push(at(a, leg.creepOff), at(b, leg.creepOff));
      }
    }
    legCursor += myLegs;
    if (wps.length > 0) tracks.push({ index: d, waypoints: wps, trackNm: trackLengthNm(wps) });
  }
  return tracks;
}

/**
 * 擴展方形搜索（文件五(三)）：自基準點開始，前兩條腿等於航跡間距，
 * 每後續兩條腿再加一個航跡間距，以同心方形向外擴展。
 * 多機：各機以 45° 旋轉錯開（文件：重搜轉 45°），避免航線重疊。
 */
function generateExpandingSquare(input: GenerateTracksInput): DroneTrack[] {
  const m = measureBox(input.box);
  const datum = input.datum ?? m.centre;
  const S = Math.max(0.01, input.trackSpacingNm);
  const R = input.radiusNm ?? m.shortSideNm / 2;
  const n = Math.max(1, Math.floor(input.droneCount));
  const tracks: DroneTrack[] = [];

  for (let d = 0; d < n; d++) {
    const rot = (d * 45 * Math.PI) / 180;
    const wps: LngLat[] = [datum];
    let x = 0, y = 0;
    let legLen = S;
    let dir = 0;                       // 0=北 1=東 2=南 3=西
    let legsAtThisLength = 0;
    // 腿長序列 S,S,2S,2S,3S,3S… 直到超出半徑
    for (let leg = 0; leg < 200; leg++) {
      switch (dir) {
        case 0: y += legLen; break;
        case 1: x += legLen; break;
        case 2: y -= legLen; break;
        case 3: x -= legLen; break;
      }
      const rx = x * Math.cos(rot) - y * Math.sin(rot);
      const ry = x * Math.sin(rot) + y * Math.cos(rot);
      wps.push(offsetNm(datum, rx, ry));
      dir = (dir + 1) % 4;
      legsAtThisLength++;
      if (legsAtThisLength === 2) { legsAtThisLength = 0; legLen += S; }
      if (Math.hypot(x, y) > R) break;
    }
    tracks.push({ index: d, waypoints: wps, trackNm: trackLengthNm(wps) });
  }
  return tracks;
}

/**
 * 扇形搜索（文件六）：自基準點放射，轉向 120°、總里程約 9R。
 * 實作為三個邊長 R 的正三角形，每個相對前一個旋轉 30°，共 9 條航段。
 * 多機：各機起始方位再均分 360°/n 錯開。
 */
function generateSector(input: GenerateTracksInput): DroneTrack[] {
  const m = measureBox(input.box);
  const datum = input.datum ?? m.centre;
  const R = input.radiusNm ?? Math.min(m.shortSideNm / 2, 5);
  const n = Math.max(1, Math.floor(input.droneCount));
  const tracks: DroneTrack[] = [];

  for (let d = 0; d < n; d++) {
    const startDeg = (d * 360) / n;
    const wps: LngLat[] = [datum];
    for (let tri = 0; tri < 3; tri++) {
      // 每個三角形相對前一個轉 30°
      const base = startDeg + tri * 30;
      let x = 0, y = 0;
      for (let leg = 0; leg < 3; leg++) {
        const brg = ((base + leg * 120) * Math.PI) / 180;
        x += R * Math.sin(brg);
        y += R * Math.cos(brg);
        wps.push(offsetNm(datum, x, y));
      }
    }
    tracks.push({ index: d, waypoints: wps, trackNm: trackLengthNm(wps) });
  }
  return tracks;
}

/**
 * 沿航跡搜索（文件二）：第一航段沿航路飛，返程於航路上下方各偏移
 * 1 個航跡間距飛第二、第三航段。多機時各機分攤這三條航段。
 */
function generateTrackLine(input: GenerateTracksInput): DroneTrack[] {
  const m = measureBox(input.box);
  const S = Math.max(0.01, input.trackSpacingNm);
  const line: [LngLat, LngLat] = input.trackLine ?? (m.longAxisIsEastWest
    ? [[input.box.west, m.centre[1]], [input.box.east, m.centre[1]]]
    : [[m.centre[0], input.box.south], [m.centre[0], input.box.north]]);

  // 航路方向的單位法向量（用來做 ±S 偏移）
  const midLat = (line[0][1] + line[1][1]) / 2;
  const dxKm = (line[1][0] - line[0][0]) * kmPerDegLng(midLat);
  const dyKm = (line[1][1] - line[0][1]) * KM_PER_DEG_LAT;
  const lenKm = Math.hypot(dxKm, dyKm) || 1;
  const nxNm = (-dyKm / lenKm) * S;    // 法向 x（浬）
  const nyNm = (dxKm / lenKm) * S;

  const legs: LngLat[][] = [
    [line[0], line[1]],
    [offsetNm(line[1], nxNm, nyNm), offsetNm(line[0], nxNm, nyNm)],
    [offsetNm(line[0], -nxNm, -nyNm), offsetNm(line[1], -nxNm, -nyNm)],
  ];

  const n = Math.max(1, Math.floor(input.droneCount));
  const tracks: DroneTrack[] = [];
  for (let d = 0; d < n; d++) {
    const wps: LngLat[] = [];
    for (let i = d; i < legs.length; i += n) {
      const leg = legs[i];
      if (leg) wps.push(...leg);
    }
    if (wps.length > 0) tracks.push({ index: d, waypoints: wps, trackNm: trackLengthNm(wps) });
  }
  return tracks;
}

/**
 * 依圖形產生每架無人機的搜索航線。
 * 等高線搜索需要地形剖面，不自動產生（回傳空陣列）—— 對應文件第十節的「△」。
 */
export function generateSearchTracks(input: GenerateTracksInput): DroneTrack[] {
  switch (input.pattern) {
    case "PS": return generateLadder(input, true);
    case "CS": return generateLadder(input, false);
    case "SS": return generateExpandingSquare(input);
    case "VS": return generateSector(input);
    case "TS": return generateTrackLine(input);
    case "contour": return [];
  }
}
