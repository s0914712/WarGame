/**
 * 灰色地帶情資 store — 兵推地圖的外部情資圖層（taiwan-grayzone-monitor 專案）。
 *
 * 資料：grayzone CI（update-ais.yml → src/build_pulse_feed.py）每輪輸出的
 * docs/pulse_feed.json，經其 GitHub Pages 提供（CORS *）。內容：
 *   - 近 24h AIS 航跡（tier-1：中國漁船 + 可疑船）
 *   - 高風險分類（critical / high）最後位置
 *   - SAR 暗船（GFW 延遲數天，取資料末日往回 7 天）
 *   - 台灣周邊海纜 + 數位部障礙狀態
 *
 * - 第一次打開任一子圖層才 fetch（約 1 MB，gzip 後 ~200 KB）
 * - 子圖層開關存 localStorage；資料不存（每次進兵推重抓）
 * - 純本機顯示：多人連線不同步，也不進模擬
 */

export type GrayzoneLayerKey = "tracks" | "highRisk" | "dark" | "cables";
export const GRAYZONE_LAYER_KEYS: GrayzoneLayerKey[] = ["tracks", "highRisk", "dark", "cables"];

/** [lon, lat, unix 秒, 航速 kn] */
export type TrackPoint = [number, number, number, number | null];

export interface GrayzoneTrack {
  mmsi: string;
  name: string;
  type: string;
  risk?: "critical" | "high";
  pts: TrackPoint[];
}

export interface GrayzoneHighRisk {
  mmsi: string;
  name: string;
  risk_level: "critical" | "high";
  risk_score: number | null;
  vessel_type: string | null;
  lat: number;
  lon: number;
  last_seen: string | null;
  flags: string[];
  cables_nearby: string[];
  sanctioned: boolean;
}

export interface GrayzoneCableFault {
  segment: string | null;
  name_zh: string | null;
  fault_date: string | null;
  estimated_repair: string | null;
  location_zh: string | null;
}

export interface GrayzoneFeed {
  version: number;
  generated_at: string;
  source: string;
  tracks: { start: string | null; end: string | null; snapshots: number; vessels: GrayzoneTrack[] };
  high_risk: { updated_at: string | null; vessels: GrayzoneHighRisk[] };
  /** points: [lon, lat, 日期 YYYY-MM-DD, 偵測次數] */
  dark: { source: string; start: string | null; end: string | null; points: [number, number, string, number][] };
  cables: {
    updated_at: string | null;
    fault_count: number;
    geojson: GeoJSON.FeatureCollection<GeoJSON.Geometry, {
      slug: string; name: string; cable_type: string | null; status: string | null;
      fault: boolean; faults: GrayzoneCableFault[];
    }>;
  };
}

export type GrayzoneStatus = "idle" | "loading" | "ready" | "error";

export const GRAYZONE_FEED_URL: string =
  import.meta.env.VITE_GRAYZONE_FEED_URL ||
  "https://s0914712.github.io/taiwan-grayzone-monitor/pulse_feed.json";

const VISIBLE_KEY = "wargame.grayzone.layers.v1";

let layers = loadLayers();
let status: GrayzoneStatus = "idle";
let error = "";
let feed: GrayzoneFeed | null = null;
let version = 0;
const listeners = new Set<() => void>();

function loadLayers(): Record<GrayzoneLayerKey, boolean> {
  const off = { tracks: false, highRisk: false, dark: false, cables: false };
  try {
    const raw = localStorage.getItem(VISIBLE_KEY);
    return raw ? { ...off, ...(JSON.parse(raw) as Partial<Record<GrayzoneLayerKey, boolean>>) } : off;
  } catch {
    return off;
  }
}

function notify(): void {
  version++;
  for (const cb of listeners) cb();
}

async function load(): Promise<void> {
  if (status === "loading") return;
  status = "loading";
  error = "";
  notify();
  try {
    // 加時間戳避開 Pages / 瀏覽器快取（feed 每 30 分～2 小時更新）
    const res = await fetch(`${GRAYZONE_FEED_URL}?t=${Math.floor(Date.now() / 600_000)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = (await res.json()) as GrayzoneFeed;
    if (!json || json.version !== 1 || !json.tracks) throw new Error("格式不符（version ≠ 1）");
    feed = json;
    status = "ready";
  } catch (e) {
    error = e instanceof Error ? e.message : String(e);
    status = "error";
  }
  notify();
}

export const grayzoneStore = {
  subscribe(cb: () => void): () => void {
    listeners.add(cb);
    return () => { listeners.delete(cb); };
  },
  getVersion: (): number => version,
  isOn: (k: GrayzoneLayerKey): boolean => layers[k],
  anyOn: (): boolean => GRAYZONE_LAYER_KEYS.some((k) => layers[k]),
  getStatus: (): GrayzoneStatus => status,
  getError: (): string => error,
  getFeed: (): GrayzoneFeed | null => feed,

  setOn(k: GrayzoneLayerKey, on: boolean): void {
    if (layers[k] === on) return;
    layers = { ...layers, [k]: on };
    try { localStorage.setItem(VISIBLE_KEY, JSON.stringify(layers)); } catch { /* private mode */ }
    notify();
    if (on) this.ensureLoaded();
  },
  /** 有子圖層開著且尚未載入 → 載入（失敗後不自動重試，等使用者按重新載入） */
  ensureLoaded(): void {
    if (status === "idle" && this.anyOn()) void load();
  },
  reload(): void {
    void load();
  },
};
