/**
 * 偵察計畫建議 —— 對一個關注區（AOI），回答三個問題：
 *   1. 現在看得到多少？（現有感測器覆蓋率 + 盲區格點）
 *   2. 派誰去補？（各偵察資產的進場時間、在站時數、掃完一次所需時間、POD；貪心組合到目標 POD）
 *   3. 哪些接觸該盯？（高優先類別、尚未「確認追蹤」的接觸 → 建議最近的偵察資產前往）
 *
 * 模型（刻意簡化，給規劃者量級感，不取代引擎模擬）：
 *   - 覆蓋：AOI 內格點，任一本方感測器在偵測距離內、且未超出對水面目標的雷達地平線即算覆蓋
 *     （海面目標高度取 0；水下 / 地形遮蔽不計）
 *   - 偵察資產掃掠寬度 W = 2 × 偵測距離（定距律）× 實戰折扣 0.5（偵測距離是極限，不是可靠分辨距離）
 *   - POD：隨機搜索公式 1 − exp(−W·v·T / A)（保守；平行航跡實際略高）
 *   - 多架合計：1 − Π(1 − PODᵢ)
 *
 * 純函式、零 browser 依賴。
 */
import type { LngLat, SideId, Unit, UnitKind } from "../types";
import { UNIT_CATALOG } from "../catalog/units";
import { haversineKm } from "../sim/geo";
import { radarHorizonKm } from "../sim/los";
import { pointInPolygon } from "../search/tracks";
import { weightOf, type TargetPriorityProfile } from "../sim/targetPriority";


const KMH_PER_KN = 1.852;

/** 可當偵察資產的單位：空中、有感測器、非一次性攻擊 */
export const RECON_KINDS: UnitKind[] = ["uav_ruiyuan", "uav_ruihuo", "drone", "asw_helo", "fighter"];

/** 偵測距離 → 有效掃掠寬度的折扣（偵測距離是「看得到光點」的極限） */
export const RECON_SWEEP_FACTOR = 0.5;

export interface CoverageResult {
  /** 0..1 */
  coveredFraction: number;
  /** AOI 面積（km²） */
  areaKm2: number;
  /** 未覆蓋的格點（中心座標）—— 地圖畫盲區用 */
  gapCells: LngLat[];
  /** 格點邊長（度）：[經度, 緯度] */
  cellDeg: [number, number];
  /** 貢獻覆蓋的感測器數 */
  sensorsUsed: number;
}

/** AOI 內的格點中心（約 gridN × gridN） */
function aoiGrid(aoi: LngLat[], gridN: number): { pts: LngLat[]; cellDeg: [number, number] } {
  let w = Infinity, e = -Infinity, s = Infinity, n = -Infinity;
  for (const [x, y] of aoi) { w = Math.min(w, x); e = Math.max(e, x); s = Math.min(s, y); n = Math.max(n, y); }
  const dx = (e - w) / gridN, dy = (n - s) / gridN;
  const pts: LngLat[] = [];
  for (let i = 0; i < gridN; i++) {
    for (let j = 0; j < gridN; j++) {
      const p: LngLat = [w + (i + 0.5) * dx, s + (j + 0.5) * dy];
      if (pointInPolygon(p[0], p[1], aoi)) pts.push(p);
    }
  }
  return { pts, cellDeg: [dx, dy] };
}

export function polygonAreaKm2(poly: LngLat[]): number {
  if (poly.length < 3) return 0;
  const lat0 = poly.reduce((a, p) => a + p[1], 0) / poly.length;
  const kx = 111.32 * Math.cos((lat0 * Math.PI) / 180), ky = 111.32;
  let twice = 0;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j]!, b = poly[i]!;
    twice += a[0] * kx * b[1] * ky - b[0] * kx * a[1] * ky;
  }
  return Math.abs(twice) / 2;
}

/** 單位對海面目標的有效偵測距離（取偵測距離與雷達地平線的較小者；水下 / 地面感測器不計地平線） */
function surfaceDetectKm(u: Unit): number {
  const cat = UNIT_CATALOG[u.kind];
  if (u.core.detectionRangeKm <= 0) return 0;
  if (cat.domain === "subsurface") return 0;      // 潛艦被動聲納不算海面覆蓋
  const alt = Math.max(u.position.altMeters ?? 0, cat.defaultAltitudeM, cat.domain === "sea" ? 25 : 0);
  return Math.min(u.core.detectionRangeKm, radarHorizonKm(alt, 0));
}

export function computeCoverage(aoi: LngLat[], ownUnits: Unit[], gridN = 28): CoverageResult {
  const { pts, cellDeg } = aoiGrid(aoi, gridN);
  const sensors = ownUnits
    .filter((u) => u.hpCurrent > 0)
    .map((u) => ({ pos: [u.position.lng, u.position.lat] as LngLat, r: surfaceDetectKm(u) }))
    .filter((s) => s.r > 0);
  const used = new Set<number>();
  const gaps: LngLat[] = [];
  let covered = 0;
  for (const p of pts) {
    let hit = false;
    for (let k = 0; k < sensors.length; k++) {
      const s = sensors[k]!;
      if (haversineKm(s.pos, p) <= s.r) { hit = true; used.add(k); break; }
    }
    if (hit) covered++; else gaps.push(p);
  }
  return {
    coveredFraction: pts.length > 0 ? covered / pts.length : 0,
    areaKm2: polygonAreaKm2(aoi),
    gapCells: gaps,
    cellDeg,
    sensorsUsed: used.size,
  };
}

export interface ReconOption {
  unitId: string;
  callsign: string;
  kind: UnitKind;
  /** 已有航線（正在執行任務） */
  busy: boolean;
  transitKm: number;
  transitHr: number;
  /** 剩餘航程換算的在站時數（扣往返）；≤0 = 去了回不來 */
  onStationHr: number;
  sweepWidthKm: number;
  /** 掃完 AOI 一次所需時數 */
  sweepOnceHr: number;
  /** 在站期間的 POD（隨機搜索公式） */
  pod: number;
  feasible: boolean;
}

function centroid(poly: LngLat[]): LngLat {
  const n = poly.length || 1;
  return [poly.reduce((a, p) => a + p[0], 0) / n, poly.reduce((a, p) => a + p[1], 0) / n];
}

/** 從某點到 AOI 的距離（在區內 = 0；否則取到最近頂點 / 質心的較小者 —— 規劃量級足夠） */
function distanceToAoiKm(p: LngLat, aoi: LngLat[]): number {
  if (pointInPolygon(p[0], p[1], aoi)) return 0;
  let best = haversineKm(p, centroid(aoi));
  for (const v of aoi) best = Math.min(best, haversineKm(p, v));
  // 頂點距離高估邊上的最近點：沿邊中點再補幾個取樣
  for (let i = 0; i < aoi.length; i++) {
    const a = aoi[i]!, b = aoi[(i + 1) % aoi.length]!;
    for (const f of [0.25, 0.5, 0.75]) best = Math.min(best, haversineKm(p, [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f]));
  }
  return best;
}

export function reconOptions(aoi: LngLat[], ownUnits: Unit[]): ReconOption[] {
  const areaKm2 = polygonAreaKm2(aoi);
  return ownUnits
    .filter((u) => u.hpCurrent > 0 && RECON_KINDS.includes(u.kind) && u.core.detectionRangeKm > 0)
    .map((u) => {
      const pos: LngLat = [u.position.lng, u.position.lat];
      const speedKmh = Math.max(1, u.core.speedKnots * KMH_PER_KN);
      const transitKm = distanceToAoiKm(pos, aoi);
      const transitHr = transitKm / speedKmh;
      const remainingKm = Math.max(0, u.core.movementRangeKm - u.distanceTravelledKm);
      const onStationHr = remainingKm / speedKmh - 2 * transitHr;
      const W = 2 * u.core.detectionRangeKm * RECON_SWEEP_FACTOR;
      const sweepOnceHr = areaKm2 > 0 ? areaKm2 / (W * speedKmh) : 0;
      const pod = onStationHr > 0 && areaKm2 > 0 ? 1 - Math.exp(-(W * speedKmh * onStationHr) / areaKm2) : 0;
      return {
        unitId: u.id, callsign: u.callsign, kind: u.kind,
        busy: u.waypoints.length > 0,
        transitKm, transitHr, onStationHr, sweepWidthKm: W, sweepOnceHr, pod,
        feasible: onStationHr > 0,
      };
    })
    .sort((a, b) => b.pod - a.pod || a.transitHr - b.transitHr);
}

/**
 * 貪心組合：依 POD 由高到低加入（優先閒置者），直到合計 POD ≥ 目標或用完。
 * 回傳選中的資產與合計 POD。
 */
export function suggestTasking(options: ReconOption[], targetPod: number, includeBusy = false): {
  chosen: ReconOption[]; combinedPod: number;
} {
  const pool = options
    .filter((o) => o.feasible && (includeBusy || !o.busy))
    .sort((a, b) => b.pod - a.pod);
  const chosen: ReconOption[] = [];
  let miss = 1;
  for (const o of pool) {
    if (1 - miss >= targetPod) break;
    chosen.push(o);
    miss *= 1 - o.pod;
  }
  return { chosen, combinedPod: 1 - miss };
}

export interface TrackTask {
  contactId: string;
  contactKind: UnitKind;
  contactPos: LngLat;
  state: "unknown" | "classified";
  weight: number;
  /** 建議前往的偵察資產 */
  assetId: string | null;
  assetCallsign: string | null;
  etaHr: number | null;
}

/**
 * 尚未確認追蹤的高優先接觸 → 建議最近的閒置偵察資產前往盯住（升級到 tracked，
 * 讓 weapons_tight 的射手能開火）。有攻擊優序時只列 ≥ minWeight 的類別；沒有則全列。
 */
export function trackingTasks(
  sideId: SideId, enemies: Unit[], ownUnits: Unit[],
  profile: TargetPriorityProfile | undefined, minWeight = 4, exclude: Set<string> = new Set(),
  includeBusy = false,
): TrackTask[] {
  const assets = ownUnits.filter((u) => u.hpCurrent > 0 && RECON_KINDS.includes(u.kind) && u.core.detectionRangeKm > 0 && !exclude.has(u.id));
  const used = new Set<string>();
  const contacts = enemies
    .filter((e) => e.hpCurrent > 0)
    .map((e) => ({ e, st: e.detectedBy[sideId] }))
    .filter((x): x is { e: Unit; st: "unknown" | "classified" } => x.st === "unknown" || x.st === "classified")
    .map(({ e, st }) => ({ e, st, w: profile ? weightOf(profile, e.kind) : 3 }))
    .filter((x) => !profile || x.w >= minWeight)
    .sort((a, b) => b.w - a.w);
  return contacts.map(({ e, st, w }) => {
    const pos: LngLat = [e.position.lng, e.position.lat];
    let best: { u: Unit; hr: number } | null = null;
    for (const u of assets) {
      if (used.has(u.id) || (!includeBusy && u.waypoints.length > 0)) continue;
      const hr = haversineKm([u.position.lng, u.position.lat], pos) / Math.max(1, u.core.speedKnots * KMH_PER_KN);
      if (!best || hr < best.hr) best = { u, hr };
    }
    if (best) used.add(best.u.id);
    return {
      contactId: e.id, contactKind: e.kind, contactPos: pos, state: st, weight: w,
      assetId: best?.u.id ?? null, assetCallsign: best?.u.callsign ?? null, etaHr: best?.hr ?? null,
    };
  });
}



/** 搜索規劃器的搜索區（多邊形或兩角框）當關注區；沒有回 null */
export function aoiFromSearchArea(polygon: LngLat[] | null, a: LngLat | null, b: LngLat | null): LngLat[] | null {
  if (polygon && polygon.length >= 3) return polygon;
  if (!a || !b) return null;
  const w = Math.min(a[0], b[0]), e = Math.max(a[0], b[0]), s = Math.min(a[1], b[1]), n = Math.max(a[1], b[1]);
  if (!(e > w && n > s)) return null;
  return [[w, s], [e, s], [e, n], [w, n]];
}
