/**
 * seacurrent 專案的海流 / 風場預報（https://github.com/s0914712/seacurrent）
 *
 * 來源：其 scheduled-forecast workflow（每 2 天）發布到 GitHub Pages 的
 * scheduled_results/frames/：
 *   - current/hNNN.json   CWA 海流預報，每小時、0.2° 網格（110–126°E、7–36°N），陸地 u=v=0
 *   - wind_10m/hNNN.json  10 m 風，每 6 小時、1° 網格
 * 格式為 grib2json / leaflet-velocity：[{header, data(u)}, {header, data(v)}]，資料列由北往南。
 *
 * 只抓需要的時段，已抓的 frame 快取在模組內（同一份預報重算漂流不必重抓）。
 */
import type { DriftEnvironment, VectorSampler } from "./leeway";

export const SEACURRENT_FRAMES_URL: string =
  import.meta.env?.VITE_SEACURRENT_FRAMES_URL ||
  "https://s0914712.github.io/seacurrent/scheduled_results/frames";

interface Grid {
  lo1: number; la1: number; dx: number; dy: number; nx: number; ny: number;
  u: Float32Array; v: Float32Array;
}

interface GribRecord {
  header: { lo1: number; la1: number; dx: number; dy: number; nx: number; ny: number };
  data: number[];
}

interface FrameIndexEntry { base_time: string; hours: number[]; step: string }
interface FrameIndex { current: FrameIndexEntry; layers: Record<string, FrameIndexEntry> }

export interface SeriesCoverage { fromMs: number; toMs: number }

export interface SeaFieldsCoverage {
  current: SeriesCoverage;
  wind: SeriesCoverage;
  /** 要求的時段超出海流預報 → 以端點那張外推（漂流結果可信度下降） */
  currentExtrapolated: boolean;
  windExtrapolated: boolean;
}

const gridCache = new Map<string, Promise<Grid>>();
let indexPromise: Promise<FrameIndex> | null = null;

function loadIndex(): Promise<FrameIndex> {
  if (!indexPromise) {
    // index 每 2 天換一次；以小時為單位的 query 避開 Pages 快取又不至於每次重抓
    indexPromise = fetch(`${SEACURRENT_FRAMES_URL}/index.json?t=${Math.floor(Date.now() / 3_600_000)}`)
      .then((r) => { if (!r.ok) throw new Error(`index.json HTTP ${r.status}`); return r.json() as Promise<FrameIndex>; })
      .catch((e) => { indexPromise = null; throw e; });
  }
  return indexPromise;
}

function loadGrid(url: string): Promise<Grid> {
  let p = gridCache.get(url);
  if (!p) {
    p = fetch(url)
      .then((r) => { if (!r.ok) throw new Error(`${url.split("/").slice(-2).join("/")} HTTP ${r.status}`); return r.json() as Promise<GribRecord[]>; })
      .then((recs) => {
        const [ru, rv] = recs;
        if (!ru || !rv) throw new Error("frame 格式不符");
        const h = ru.header;
        return {
          lo1: h.lo1, la1: h.la1, dx: h.dx, dy: h.dy, nx: h.nx, ny: h.ny,
          u: Float32Array.from(ru.data, (x) => x ?? 0),
          v: Float32Array.from(rv.data, (x) => x ?? 0),
        };
      })
      .catch((e) => { gridCache.delete(url); throw e; });
    gridCache.set(url, p);
  }
  return p;
}

/** 雙線性內插；maskZero = 海流：u=v=0 的格點視為陸地、不參與內插，四角皆陸地 → null */
function sampleGrid(g: Grid, lng: number, lat: number, maskZero: boolean): [number, number] | null {
  const fx = (lng - g.lo1) / g.dx;
  const fy = (g.la1 - lat) / g.dy;
  if (fx < 0 || fy < 0 || fx > g.nx - 1 || fy > g.ny - 1) return null;
  const x0 = Math.min(Math.floor(fx), g.nx - 2);
  const y0 = Math.min(Math.floor(fy), g.ny - 2);
  const tx = fx - x0;
  const ty = fy - y0;
  let su = 0, sv = 0, sw = 0;
  for (let k = 0; k < 4; k++) {
    const x = x0 + (k & 1);
    const y = y0 + (k >> 1);
    const w = ((k & 1) ? tx : 1 - tx) * ((k >> 1) ? ty : 1 - ty);
    const idx = y * g.nx + x;
    const u = g.u[idx]!;
    const v = g.v[idx]!;
    if (maskZero && u === 0 && v === 0) continue;
    su += u * w; sv += v * w; sw += w;
  }
  if (maskZero) {
    // 最近格點是陸地 → 擱淺（避免粒子沿著海岸線內插值鑽進陸地）
    const nearest = Math.round(fy) * g.nx + Math.round(fx);
    if (g.u[nearest] === 0 && g.v[nearest] === 0) return null;
  }
  if (sw <= 0) return null;
  return [su / sw, sv / sw];
}

interface LoadedSeries { baseMs: number; hours: number[]; grids: Map<number, Grid>; maskZero: boolean }

/** 在時間序列中內插：t 落在兩張之間 → 兩張各自取樣後線性內插 */
function seriesSampler(s: LoadedSeries, tMs: number): VectorSampler {
  const tHr = (tMs - s.baseMs) / 3_600_000;
  const hs = s.hours.filter((h) => s.grids.has(h));
  if (hs.length === 0) return () => null;
  if (tHr <= hs[0]!) { const g = s.grids.get(hs[0]!)!; return (x, y) => sampleGrid(g, x, y, s.maskZero); }
  const last = hs[hs.length - 1]!;
  if (tHr >= last) { const g = s.grids.get(last)!; return (x, y) => sampleGrid(g, x, y, s.maskZero); }
  let i = 0;
  while (hs[i + 1]! < tHr) i++;
  const h0 = hs[i]!, h1 = hs[i + 1]!;
  const f = (tHr - h0) / (h1 - h0);
  const g0 = s.grids.get(h0)!, g1 = s.grids.get(h1)!;
  return (x, y) => {
    const a = sampleGrid(g0, x, y, s.maskZero);
    const b = sampleGrid(g1, x, y, s.maskZero);
    if (!a || !b) return a ?? b;   // 海陸交界時兩張遮罩略有差異：取有值的那張
    return [a[0] + (b[0] - a[0]) * f, a[1] + (b[1] - a[1]) * f];
  };
}

/** 需要的預報小時：涵蓋 [fromHr, toHr] 再各往外多一張（內插用），並夾在可用範圍內 */
function hoursNeeded(all: number[], fromHr: number, toHr: number): number[] {
  const sorted = [...all].sort((a, b) => a - b);
  let lo = 0;
  while (lo + 1 < sorted.length && sorted[lo + 1]! <= fromHr) lo++;
  let hi = sorted.length - 1;
  while (hi - 1 >= 0 && sorted[hi - 1]! >= toHr) hi--;
  return sorted.slice(lo, hi + 1);
}

async function loadSeries(entry: FrameIndexEntry, dir: string, fromMs: number, toMs: number, maskZero: boolean,
  onFrame: () => void): Promise<LoadedSeries> {
  const baseMs = Date.parse(entry.base_time);
  const need = hoursNeeded(entry.hours, (fromMs - baseMs) / 3_600_000, (toMs - baseMs) / 3_600_000);
  const grids = new Map<number, Grid>();
  // 同時最多 6 個請求
  let next = 0;
  const worker = async () => {
    while (next < need.length) {
      const h = need[next++]!;
      const file = entry.step.replace("{:03d}", String(h).padStart(3, "0"));
      // 檔名每輪預報都一樣（h000…）；帶 base_time 讓快取鍵跟著預報換
      grids.set(h, await loadGrid(`${SEACURRENT_FRAMES_URL}/${dir}/${file}?b=${encodeURIComponent(entry.base_time)}`));
      onFrame();
    }
  };
  await Promise.all(Array.from({ length: Math.min(6, need.length) }, worker));
  return { baseMs, hours: need, grids, maskZero };
}

export interface LoadedSeaFields {
  env: DriftEnvironment;
  coverage: SeaFieldsCoverage;
  /** 預報發布時刻（current base_time） */
  baseTime: string;
}

/** 載入 [fromMs, toMs] 期間的海流 + 風場，回傳給 runLeeway 用的環境 */
export async function loadSeaFields(fromMs: number, toMs: number,
  onProgress?: (done: number) => void): Promise<LoadedSeaFields> {
  const index = await loadIndex();
  const windEntry = index.layers["wind_10m"];
  if (!index.current || !windEntry) throw new Error("index.json 缺 current / wind_10m");
  let done = 0;
  const tick = () => { done++; onProgress?.(done); };
  const [current, wind] = await Promise.all([
    loadSeries(index.current, "current", fromMs, toMs, true, tick),
    loadSeries(windEntry, "wind_10m", fromMs, toMs, false, tick),
  ]);
  const span = (e: FrameIndexEntry): SeriesCoverage => {
    const base = Date.parse(e.base_time);
    return { fromMs: base + Math.min(...e.hours) * 3_600_000, toMs: base + Math.max(...e.hours) * 3_600_000 };
  };
  const cCov = span(index.current);
  const wCov = span(windEntry);
  return {
    env: {
      currentAt: (t) => seriesSampler(current, t),
      windAt: (t) => seriesSampler(wind, t),
    },
    coverage: {
      current: cCov,
      wind: wCov,
      currentExtrapolated: fromMs < cCov.fromMs || toMs > cCov.toMs,
      windExtrapolated: fromMs < wCov.fromMs || toMs > wCov.toMs,
    },
    baseTime: index.current.base_time,
  };
}
