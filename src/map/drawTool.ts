/**
 * 繪圖工具 — 在兵棋地圖上畫線段 / 矩形 / 圓（標註用，不影響模擬）。
 *
 * 操作（選了工具之後）：
 *   - 線段：點地圖加點，雙擊或 Enter 完成（≥ 2 點）；右鍵刪最後一點
 *   - 矩形：點第一角 → 移動預覽 → 點對角完成
 *   - 圓：點圓心 → 移動預覽半徑 → 再點完成
 *   - 多邊形：點地圖加頂點，雙擊或 Enter 完成（≥ 3 點）；右鍵刪最後一點；
 *     或在尺規面板貼上十進位經緯度（addPolygon）
 *   - Esc：取消目前草稿；沒有草稿時離開工具
 * 完成一個圖形後工具保持啟用，可連續畫。
 *
 * 圖形依場景 id 存 localStorage（wg-draw-v1:<scenarioId>）；標籤單位跟尺規（海里 / 公里）。
 * 狀態與圖層同檔（同 rulerTool）：drawStore 給 React 訂閱，attachDrawLayer 掛到 map。
 * 各 app 的 map click / contextmenu handler 須在 drawStore.isCapturing() 時讓路。
 */
import type { Map as MapboxMap, MapMouseEvent } from "mapbox-gl";
import type { LngLat } from "../wargame/types";
import { haversineKm } from "../wargame/sim/geo";
import { scenarioStore } from "../wargame/scenarioStore";
import { formatDistance, rulerStore } from "./rulerTool";

export type DrawKind = "line" | "rect" | "circle" | "polygon";

export interface DrawShape {
  id: string;
  kind: DrawKind;
  /** line / polygon：各頂點（polygon 不重複首點）；rect：[角 A, 對角 B]；circle：[圓心, 圓周上一點] */
  pts: LngLat[];
  color: string;
}

export const DRAW_COLORS = ["#facc15", "#f87171", "#60a5fa", "#4ade80", "#e879f9", "#f8fafc"] as const;

type Listener = () => void;

let open = false;
let tool: DrawKind | null = null;
let color: string = DRAW_COLORS[0];
let shapes: DrawShape[] = [];
let draft: LngLat[] = [];
let cursor: LngLat | null = null;
let scenarioId = "";
let version = 0;
const listeners = new Set<Listener>();
function notify() { version++; for (const cb of listeners) cb(); }

const storageKey = (id: string) => `wg-draw-v1:${id}`;

function load(id: string): DrawShape[] {
  try {
    const raw = localStorage.getItem(storageKey(id));
    const arr = raw ? (JSON.parse(raw) as DrawShape[]) : [];
    return Array.isArray(arr) ? arr.filter((s) => s && Array.isArray(s.pts) && (s.kind === "line" || s.kind === "rect" || s.kind === "circle" || s.kind === "polygon")) : [];
  } catch {
    return [];
  }
}

function save(): void {
  if (!scenarioId) return;
  try {
    if (shapes.length === 0) localStorage.removeItem(storageKey(scenarioId));
    else localStorage.setItem(storageKey(scenarioId), JSON.stringify(shapes));
  } catch { /* 無痕模式 / 配額 → 只是不記住 */ }
}

/** 換場景 → 讀該場景的圖形、清掉草稿 */
function syncScenario(): void {
  const id = scenarioStore.getState().scenario.id;
  if (id === scenarioId) return;
  scenarioId = id;
  shapes = load(id);
  draft = [];
  cursor = null;
  notify();
}
scenarioStore.subscribe(syncScenario);

const same = (a: LngLat | undefined, b: LngLat) => !!a && Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9;

function commit(kind: DrawKind, pts: LngLat[]): void {
  shapes = [...shapes, { id: `d${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`, kind, pts, color }];
  draft = [];
  cursor = null;
  save();
  notify();
}

export const drawStore = {
  getVersion: () => version,
  isOpen: () => open,
  getTool: () => tool,
  getColor: () => color,
  getShapes: () => shapes,
  getDraft: () => draft,
  /** 正在攔截地圖點擊（選了工具） */
  isCapturing: () => tool !== null,

  setOpen(on: boolean): void {
    if (open === on) return;
    open = on;
    if (!on) { tool = null; draft = []; cursor = null; }
    syncScenario();
    notify();
  },

  setTool(k: DrawKind | null): void {
    if (tool === k) return;
    tool = k;
    draft = [];
    cursor = null;
    if (k) { open = true; rulerStore.setActive(false); }   // 與尺規互斥：同時開會搶點擊
    notify();
  },

  setColor(c: string): void {
    if (color === c) return;
    color = c;
    notify();
  },

  addPoint(p: LngLat): void {
    if (!tool) return;
    if (same(draft[draft.length - 1], p)) return;   // 雙擊會先觸發兩次 click
    if (tool === "line" || tool === "polygon") { draft = [...draft, p]; notify(); return; }
    // rect / circle：第一點起頭，第二點完成
    if (draft.length === 0) { draft = [p]; notify(); return; }
    commit(tool, [draft[0]!, p]);
  },

  setCursor(p: LngLat | null): void {
    cursor = p;
    if (tool && draft.length > 0) notify();
  },

  /** 線段 / 多邊形完成（雙擊 / Enter） */
  finish(): void {
    if (tool === "line" && draft.length >= 2) commit("line", draft);
    else if (tool === "polygon" && draft.length >= 3) commit("polygon", draft);
  },

  /** 以座標直接建立多邊形（手動輸入）；首尾重複的閉合點會去掉 */
  addPolygon(pts: LngLat[]): boolean {
    const ring = pts.length > 1 && same(pts[0], pts[pts.length - 1]!) ? pts.slice(0, -1) : pts;
    if (ring.length < 3) return false;
    const keepTool = tool;
    commit("polygon", ring);
    tool = keepTool;
    return true;
  },

  /** 右鍵：草稿退一點 */
  undoPoint(): void {
    if (draft.length === 0) return;
    draft = draft.slice(0, -1);
    notify();
  },

  /** Esc：有草稿 → 取消草稿；沒有 → 離開工具 */
  cancel(): void {
    if (draft.length > 0) { draft = []; cursor = null; notify(); return; }
    drawStore.setTool(null);
  },

  remove(id: string): void {
    shapes = shapes.filter((s) => s.id !== id);
    save();
    notify();
  },

  undoShape(): void {
    if (shapes.length === 0) return;
    shapes = shapes.slice(0, -1);
    save();
    notify();
  },

  clearAll(): void {
    shapes = [];
    draft = [];
    save();
    notify();
  },

  subscribe(cb: Listener): () => void {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
};

// ── 幾何 / 標籤 ──────────────────────────────────────────
const R_KM = 6371.0088;

/** 從 c 沿真方位 brgDeg 走 km 公里的點（大圓） */
function destination(c: LngLat, km: number, brgDeg: number): LngLat {
  const d = km / R_KM, b = (brgDeg * Math.PI) / 180;
  const la1 = (c[1] * Math.PI) / 180, lo1 = (c[0] * Math.PI) / 180;
  const la2 = Math.asin(Math.sin(la1) * Math.cos(d) + Math.cos(la1) * Math.sin(d) * Math.cos(b));
  const lo2 = lo1 + Math.atan2(Math.sin(b) * Math.sin(d) * Math.cos(la1), Math.cos(d) - Math.sin(la1) * Math.sin(la2));
  return [(lo2 * 180) / Math.PI, (la2 * 180) / Math.PI];
}

function circleRing(c: LngLat, km: number): LngLat[] {
  const ring: LngLat[] = [];
  for (let i = 0; i <= 64; i++) ring.push(destination(c, km, (i / 64) * 360));
  return ring;
}

function rectRing(a: LngLat, b: LngLat): LngLat[] {
  return [[a[0], a[1]], [b[0], a[1]], [b[0], b[1]], [a[0], b[1]], [a[0], a[1]]];
}

/** 球面多邊形面積（km²），以頂點中心做等距方位近似；搜索區尺度（數百 km）誤差 < 1% */
function polygonAreaKm2(pts: LngLat[]): number {
  const lat0 = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  const kx = 111.32 * Math.cos((lat0 * Math.PI) / 180), ky = 110.57;
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!, q = pts[(i + 1) % pts.length]!;
    a += p[0] * kx * (q[1] * ky) - q[0] * kx * (p[1] * ky);
  }
  return Math.abs(a) / 2;
}

function lineKm(pts: LngLat[]): number {
  let km = 0;
  for (let i = 1; i < pts.length; i++) km += haversineKm(pts[i - 1]!, pts[i]!);
  return km;
}

function shapeLabel(kind: DrawKind, pts: LngLat[]): string {
  const u = rulerStore.getUnit();
  const a = pts[0]!, b = pts[1] ?? pts[0]!;
  if (kind === "line") return formatDistance(lineKm(pts), u);
  if (kind === "polygon") {
    const k = u === "nm" ? 1.852 * 1.852 : 1;
    const area = polygonAreaKm2(pts) / k;
    return `${pts.length} 點 · 周長 ${formatDistance(lineKm([...pts, pts[0]!]), u)} · ${area.toFixed(area < 100 ? 1 : 0)} ${u}²`;
  }
  if (kind === "circle") {
    const r = haversineKm(a, b);
    return `r ${formatDistance(r, u)}`;
  }
  const midLat = (a[1] + b[1]) / 2;
  const w = haversineKm([a[0], midLat], [b[0], midLat]);
  const h = haversineKm([a[0], a[1]], [a[0], b[1]]);
  const k = u === "nm" ? 1.852 : 1;
  const area = (w / k) * (h / k);
  return `${formatDistance(w, u)} × ${formatDistance(h, u)} · ${area.toFixed(area < 100 ? 1 : 0)} ${u}²`;
}

/** 圖形清單 / 標籤共用的一行描述 */
export function describeShape(s: DrawShape): string {
  const name = s.kind === "line" ? "線段" : s.kind === "rect" ? "矩形" : s.kind === "polygon" ? "多邊形" : "圓";
  return `${name} · ${shapeLabel(s.kind, s.pts)}`;
}

function shapeFeatures(kind: DrawKind, pts: LngLat[], col: string, isDraft: boolean): GeoJSON.Feature[] {
  const props = { color: col, draft: isDraft ? 1 : 0 };
  const out: GeoJSON.Feature[] = [];
  const a = pts[0], b = pts[1];
  if (kind === "polygon" && pts.length >= 3) {
    out.push({ type: "Feature", properties: props, geometry: { type: "Polygon", coordinates: [[...pts, pts[0]!]] } });
    const top = pts.reduce((m, p) => (p[1] > m[1] ? p : m), pts[0]!);
    out.push({ type: "Feature", properties: { ...props, kind: "label", label: shapeLabel("polygon", pts) }, geometry: { type: "Point", coordinates: top } });
  } else if (kind === "line" || kind === "polygon") {   // 多邊形草稿 < 3 點時先畫成線
    if (pts.length >= 2) out.push({ type: "Feature", properties: props, geometry: { type: "LineString", coordinates: pts } });
    const end = pts[pts.length - 1];
    if (kind === "line" && pts.length >= 2 && end) {
      out.push({ type: "Feature", properties: { ...props, kind: "label", label: shapeLabel("line", pts) }, geometry: { type: "Point", coordinates: end } });
    }
  } else if (a && b) {
    const ring = kind === "rect" ? rectRing(a, b) : circleRing(a, haversineKm(a, b));
    out.push({ type: "Feature", properties: props, geometry: { type: "Polygon", coordinates: [ring] } });
    if (kind === "circle") {
      out.push({ type: "Feature", properties: { ...props, dash: 1 }, geometry: { type: "LineString", coordinates: [a, b] } });
    }
    const at: LngLat = kind === "rect" ? [(a[0] + b[0]) / 2, Math.max(a[1], b[1])] : b;
    out.push({ type: "Feature", properties: { ...props, kind: "label", label: shapeLabel(kind, [a, b]) }, geometry: { type: "Point", coordinates: at } });
  }
  return out;
}

function buildData(): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const s of shapes) features.push(...shapeFeatures(s.kind, s.pts, s.color, false));
  if (tool && draft.length > 0) {
    const live = cursor ? [...draft, cursor] : draft;
    features.push(...shapeFeatures(tool, live, color, true));
    draft.forEach((p) => features.push({
      type: "Feature", properties: { color, kind: "vertex" }, geometry: { type: "Point", coordinates: p },
    }));
  }
  return { type: "FeatureCollection", features };
}

// ── 地圖圖層 ──────────────────────────────────────────────
const SRC = "wg-draw-src";
const L_FILL = "wg-draw-fill";
const L_LINE = "wg-draw-line";
const L_PTS = "wg-draw-pts";
const L_LABEL = "wg-draw-label";
const LAYERS = [L_LABEL, L_PTS, L_LINE, L_FILL];

export function attachDrawLayer(map: MapboxMap): () => void {
  for (const id of LAYERS) if (map.getLayer(id)) map.removeLayer(id);
  if (map.getSource(SRC)) map.removeSource(SRC);
  syncScenario();

  map.addSource(SRC, { type: "geojson", data: buildData() });
  map.addLayer({
    id: L_FILL, type: "fill", source: SRC,
    filter: ["==", ["geometry-type"], "Polygon"],
    paint: { "fill-color": ["get", "color"], "fill-opacity": ["case", ["==", ["get", "draft"], 1], 0.08, 0.14] },
  });
  map.addLayer({
    id: L_LINE, type: "line", source: SRC,
    filter: ["in", ["geometry-type"], ["literal", ["LineString", "Polygon"]]],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": ["get", "color"],
      "line-width": ["case", ["==", ["get", "dash"], 1], 1.2, 2.4],
      "line-opacity": ["case", ["==", ["get", "draft"], 1], 0.75, 0.95],
    },
  });
  map.addLayer({
    id: L_PTS, type: "circle", source: SRC,
    filter: ["==", ["get", "kind"], "vertex"],
    paint: { "circle-radius": 4, "circle-color": ["get", "color"], "circle-stroke-color": "#0f172a", "circle-stroke-width": 1.5 },
  });
  map.addLayer({
    id: L_LABEL, type: "symbol", source: SRC,
    filter: ["==", ["get", "kind"], "label"],
    layout: {
      "text-field": ["get", "label"], "text-size": 12, "text-anchor": "bottom-left", "text-offset": [0.5, -0.3],
      "text-allow-overlap": true, "text-ignore-placement": true,
      "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
    },
    paint: { "text-color": ["get", "color"], "text-halo-color": "rgba(15,23,42,0.95)", "text-halo-width": 2 },
  });

  let cursorOwned = false;
  let wasCapturing = false;
  const refresh = () => {
    (map.getSource(SRC) as mapboxgl.GeoJSONSource | undefined)?.setData(buildData());
    const cap = tool !== null;
    const canvas = map.getCanvas();
    if (cap) { canvas.style.cursor = "crosshair"; cursorOwned = true; }
    else if (cursorOwned) { canvas.style.cursor = ""; cursorOwned = false; }
    if (cap !== wasCapturing) {   // 畫線時雙擊 = 完成，不縮放
      if (cap) map.doubleClickZoom.disable(); else map.doubleClickZoom.enable();
      wasCapturing = cap;
    }
  };

  let raf = 0;
  let pending: LngLat | null = null;
  const onMove = (e: MapMouseEvent) => {
    if (!tool || draft.length === 0) return;
    pending = [e.lngLat.lng, e.lngLat.lat];
    if (raf) return;
    raf = requestAnimationFrame(() => { raf = 0; drawStore.setCursor(pending); });
  };
  const onClick = (e: MapMouseEvent) => { if (tool) drawStore.addPoint([e.lngLat.lng, e.lngLat.lat]); };
  const onDbl = (e: MapMouseEvent) => { if (!tool) return; e.preventDefault(); drawStore.finish(); };
  const onContext = (e: MapMouseEvent) => { if (!tool) return; e.preventDefault(); drawStore.undoPoint(); };
  const onKey = (e: KeyboardEvent) => {
    if (!tool) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT")) return;
    if (e.key === "Escape") { e.stopImmediatePropagation(); drawStore.cancel(); }
    else if (e.key === "Enter") drawStore.finish();
  };
  const onLeave = () => drawStore.setCursor(null);

  map.on("mousemove", onMove);
  map.on("click", onClick);
  map.on("dblclick", onDbl);
  map.on("contextmenu", onContext);
  map.getCanvas().addEventListener("mouseleave", onLeave);
  window.addEventListener("keydown", onKey, true);
  const unsub = drawStore.subscribe(refresh);
  const unsubUnit = rulerStore.subscribe(refresh);   // 尺規切海里 / 公里 → 標籤跟著換
  refresh();

  return () => {
    unsub();
    unsubUnit();
    if (wasCapturing) map.doubleClickZoom.enable();
    if (raf) cancelAnimationFrame(raf);
    map.off("mousemove", onMove);
    map.off("click", onClick);
    map.off("dblclick", onDbl);
    map.off("contextmenu", onContext);
    map.getCanvas().removeEventListener("mouseleave", onLeave);
    window.removeEventListener("keydown", onKey, true);
    for (const id of LAYERS) if (map.getLayer(id)) map.removeLayer(id);
    if (map.getSource(SRC)) map.removeSource(SRC);
  };
}
