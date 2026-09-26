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

  const totalLegs = Math.max(1, Math.ceil(creepLenNm / S));
  const n = Math.max(1, Math.floor(input.droneCount));
  const tracks: DroneTrack[] = [];

  // 航段平均分配給各機（餘數分給前幾架）
  const base = Math.floor(totalLegs / n);
  const extra = totalLegs % n;
  let legCursor = 0;

  for (let d = 0; d < n; d++) {
    const myLegs = base + (d < extra ? 1 : 0);
    const wps: LngLat[] = [];
    for (let k = 0; k < myLegs; k++) {
      const legIdx = legCursor + k;
      // 文件：第一條航跡距邊 ½ S，之後每條 +1 S
      const creepOff = Math.min((legIdx + 0.5) * S, creepLenNm);
      // boustrophedon：偶數段順向、奇數段逆向，迴轉自然落在區外側
      const forward = k % 2 === 0;
      const a = forward ? 0 : legLenNm;
      const b = forward ? legLenNm : 0;
      if (legIsEastWest) {
        wps.push(offsetNm(sw, a, creepOff), offsetNm(sw, b, creepOff));
      } else {
        wps.push(offsetNm(sw, creepOff, a), offsetNm(sw, creepOff, b));
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
