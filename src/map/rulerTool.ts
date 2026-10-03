/**
 * 尺規工具 — 在地圖上點選多點量測距離（海里 / 公里）與方位。
 *
 * 操作：
 *   - 開啟後，點地圖加點；滑鼠移動時顯示到游標的即時線段
 *   - 雙擊結束本次量測（保留在圖上）；之後再點會開新的量測
 *   - 右鍵刪除最後一點；Esc 結束量測
 *
 * 距離走大圓（haversine），方位為真方位（0° = 真北）。
 * 狀態與圖層同檔：rulerStore 給 React 控制列訂閱，attachRulerLayer 掛到 map。
 * 各 app 的 map click handler 須在 rulerStore.isActive() 時讓路。
 */
import type { Map as MapboxMap, MapMouseEvent } from "mapbox-gl";
import type { LngLat } from "../wargame/types";
import { bearingDeg, haversineKm } from "../wargame/sim/geo";
import { langStore } from "../wargame/i18n/lang";

const getLang = (): "zh" | "en" => (langStore.get() === "en" ? "en" : "zh");

export type RulerUnit = "nm" | "km";

const KM_PER_NM = 1.852;
const UNIT_KEY = "wg-ruler-unit";

type Listener = () => void;

let active = false;
let unit: RulerUnit = loadUnit();
let points: LngLat[] = [];
let cursor: LngLat | null = null;
/** 本次量測已雙擊結束 —— 下一次點擊會清掉重來 */
let finished = false;
let version = 0;
const listeners = new Set<Listener>();
function notify() { version++; for (const cb of listeners) cb(); }

function loadUnit(): RulerUnit {
  try {
    return localStorage.getItem(UNIT_KEY) === "km" ? "km" : "nm";
  } catch {
    return "nm";
  }
}

export function formatDistance(km: number, u: RulerUnit): string {
  const v = u === "nm" ? km / KM_PER_NM : km;
  const digits = v < 10 ? 2 : v < 1000 ? 1 : 0;
  return `${v.toFixed(digits)} ${u === "nm" ? "nm" : "km"}`;
}

export function formatBearing(deg: number): string {
  return `${String(Math.round(deg) % 360).padStart(3, "0")}°`;
}

/** 各段距離（km）與方位；含游標時最後一段為即時線段 */
export function measureSegments(pts: LngLat[]): { km: number; bearing: number; from: LngLat; to: LngLat }[] {
  const out: { km: number; bearing: number; from: LngLat; to: LngLat }[] = [];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    if (!a || !b) continue;
    out.push({ km: haversineKm(a, b), bearing: bearingDeg(a, b), from: a, to: b });
  }
  return out;
}

/** 目前要畫 / 統計的點列（量測中且有游標 → 附上游標點） */
function livePoints(): LngLat[] {
  return active && !finished && cursor && points.length > 0 ? [...points, cursor] : points;
}

export const rulerStore = {
  getVersion: () => version,
  isActive: () => active,
  getUnit: () => unit,
  getPoints: () => points,
  isFinished: () => finished,

  /** 總距離（km）與段數；含即時線段 */
  getSummary(): { totalKm: number; segments: number; lastBearing: number | null } {
    const segs = measureSegments(livePoints());
    const last = segs[segs.length - 1];
    return {
      totalKm: segs.reduce((s, x) => s + x.km, 0),
      segments: segs.length,
      lastBearing: last ? last.bearing : null,
    };
  },

  setActive(on: boolean): void {
    if (active === on) return;
    active = on;
    cursor = null;
    if (!on) finished = points.length > 0;   // 關閉後保留已量的線，直到清除
    notify();
  },

  setUnit(u: RulerUnit): void {
    if (unit === u) return;
    unit = u;
    try { localStorage.setItem(UNIT_KEY, u); } catch { /* 無痕模式等 → 只是不記住 */ }
    notify();
  },

  addPoint(p: LngLat): void {
    if (finished) { points = []; finished = false; }
    // 雙擊會先觸發兩次 click：同一位置的重複點忽略
    const last = points[points.length - 1];
    if (last && Math.abs(last[0] - p[0]) < 1e-9 && Math.abs(last[1] - p[1]) < 1e-9) return;
    points = [...points, p];
    notify();
  },

  setCursor(p: LngLat | null): void {
    cursor = p;
    if (active && !finished && points.length > 0) notify();
  },

  finish(): void {
    if (points.length === 0) return;
    finished = true;
    cursor = null;
    notify();
  },

  undo(): void {
    if (points.length === 0) return;
    points = points.slice(0, -1);
    finished = false;
    notify();
  },

  clear(): void {
    points = [];
    cursor = null;
    finished = false;
    notify();
  },

  subscribe(cb: Listener): () => void {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
};

// ── 地圖圖層 ──────────────────────────────────────────────
const SRC = "wg-ruler-src";
const LAYER_LINE = "wg-ruler-line";
const LAYER_PTS = "wg-ruler-pts";
const LAYER_LABEL = "wg-ruler-label";

function buildData(lang: "zh" | "en"): GeoJSON.FeatureCollection {
  const pts = livePoints();
  const features: GeoJSON.Feature[] = [];
  if (pts.length >= 2) {
    features.push({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: pts } });
  }
  points.forEach((p) => features.push({
    type: "Feature", properties: { kind: "vertex" }, geometry: { type: "Point", coordinates: p },
  }));
  // 各段中點標距離 + 方位
  const segs = measureSegments(pts);
  segs.forEach((s) => features.push({
    type: "Feature",
    properties: { kind: "seg", label: `${formatDistance(s.km, unit)} · ${formatBearing(s.bearing)}` },
    geometry: { type: "Point", coordinates: [(s.from[0] + s.to[0]) / 2, (s.from[1] + s.to[1]) / 2] },
  }));
  // 末點標總長（多於一段才需要）
  const end = pts[pts.length - 1];
  if (segs.length >= 2 && end) {
    const total = segs.reduce((acc, s) => acc + s.km, 0);
    features.push({
      type: "Feature",
      properties: { kind: "total", label: `${lang === "en" ? "Total" : "總長"} ${formatDistance(total, unit)}` },
      geometry: { type: "Point", coordinates: end },
    });
  }
  return { type: "FeatureCollection", features };
}

/**
 * 掛尺規圖層與互動（標籤跟著介面語言）。
 * 回傳 detach（切底圖時先 detach 再重掛）。
 */
export function attachRulerLayer(map: MapboxMap): () => void {
  for (const id of [LAYER_LABEL, LAYER_PTS, LAYER_LINE]) if (map.getLayer(id)) map.removeLayer(id);
  if (map.getSource(SRC)) map.removeSource(SRC);

  map.addSource(SRC, { type: "geojson", data: buildData(getLang()) });
  map.addLayer({
    id: LAYER_LINE, type: "line", source: SRC,
    filter: ["==", ["geometry-type"], "LineString"],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": "#f472b6", "line-width": 2.5, "line-dasharray": [2, 1.5] },
  });
  map.addLayer({
    id: LAYER_PTS, type: "circle", source: SRC,
    filter: ["==", ["get", "kind"], "vertex"],
    paint: {
      "circle-radius": 4.5, "circle-color": "#f472b6",
      "circle-stroke-color": "#0f172a", "circle-stroke-width": 1.5,
    },
  });
  map.addLayer({
    id: LAYER_LABEL, type: "symbol", source: SRC,
    filter: ["any", ["==", ["get", "kind"], "seg"], ["==", ["get", "kind"], "total"]],
    layout: {
      "text-field": ["get", "label"],
      "text-size": ["case", ["==", ["get", "kind"], "total"], 14, 12],
      "text-anchor": ["case", ["==", ["get", "kind"], "total"], "left", "bottom"],
      "text-offset": ["case", ["==", ["get", "kind"], "total"], ["literal", [0.8, 0]], ["literal", [0, -0.4]]],
      "text-allow-overlap": true, "text-ignore-placement": true,
      "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
    },
    paint: { "text-color": "#fbcfe8", "text-halo-color": "rgba(15,23,42,0.95)", "text-halo-width": 2 },
  });

  /** 游標是否由尺規設成十字 —— 關閉時只還原自己改的，不覆蓋其他模式 */
  let cursorOwned = false;
  let wasActive = false;
  const refresh = () => {
    (map.getSource(SRC) as mapboxgl.GeoJSONSource | undefined)?.setData(buildData(getLang()));
    const canvas = map.getCanvas();
    if (active) {
      canvas.style.cursor = "crosshair";
      cursorOwned = true;
    } else if (cursorOwned) {
      canvas.style.cursor = "";
      cursorOwned = false;
    }
    // 量測中停用雙擊縮放（雙擊用來結束量測）；只在狀態切換時動，避免干擾他處設定
    if (active !== wasActive) {
      if (active) map.doubleClickZoom.disable(); else map.doubleClickZoom.enable();
      wasActive = active;
    }
  };

  // 滑鼠移動以 RAF 合併，避免每個 mousemove 都 setData
  let raf = 0;
  let pending: LngLat | null = null;
  const onMove = (e: MapMouseEvent) => {
    if (!active || finished || points.length === 0) return;
    pending = [e.lngLat.lng, e.lngLat.lat];
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; rulerStore.setCursor(pending); });
  };
  const onClick = (e: MapMouseEvent) => {
    if (!active) return;
    rulerStore.addPoint([e.lngLat.lng, e.lngLat.lat]);
  };
  const onDbl = (e: MapMouseEvent) => {
    if (!active) return;
    e.preventDefault();
    rulerStore.finish();
  };
  const onContext = (e: MapMouseEvent) => {
    if (!active) return;
    e.preventDefault();
    rulerStore.undo();
  };
  const onKey = (e: KeyboardEvent) => {
    if (!active || e.key !== "Escape") return;
    if (points.length > 0 && !finished) rulerStore.finish();
    else rulerStore.setActive(false);
  };
  const onLeave = () => rulerStore.setCursor(null);

  map.on("mousemove", onMove);
  map.on("click", onClick);
  map.on("dblclick", onDbl);
  map.on("contextmenu", onContext);
  map.getCanvas().addEventListener("mouseleave", onLeave);
  window.addEventListener("keydown", onKey);
  const unsub = rulerStore.subscribe(refresh);
  const unsubLang = langStore.subscribe(refresh);
  refresh();

  return () => {
    unsub();
    unsubLang();
    if (wasActive) map.doubleClickZoom.enable();
    if (raf) cancelAnimationFrame(raf);
    map.off("mousemove", onMove);
    map.off("click", onClick);
    map.off("dblclick", onDbl);
    map.off("contextmenu", onContext);
    map.getCanvas().removeEventListener("mouseleave", onLeave);
    window.removeEventListener("keydown", onKey);
    for (const id of [LAYER_LABEL, LAYER_PTS, LAYER_LINE]) if (map.getLayer(id)) map.removeLayer(id);
    if (map.getSource(SRC)) map.removeSource(SRC);
  };
}
