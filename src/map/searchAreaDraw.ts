/**
 * 搜索區地圖繪製 + 座標提示。
 *
 * 繪製（searchPlannerStore.isPicking()）：
 *   - 點地圖逐一加頂點（上限 10），游標拉出橡皮筋線並預覽閉合邊
 *   - 最後一點雙擊完成；手機快速點兩下完成（兩次點擊間隔 < 350 ms、距離 < 24 px）
 *     —— 自己偵測連點，不依賴瀏覽器 dblclick（觸控裝置不一定會發）
 *   - Enter 完成、Backspace 刪最後一點、Esc 取消
 * 座標提示：任何搜索規劃的點地圖模式（繪製、LKP / 船舶位置點選、記錄接觸）下，
 *   游標旁顯示度分秒；繪製時另附與上一點的距離與方位。觸控裝置則顯示在剛點的位置。
 *
 * 草稿線畫在自己的 source（游標移動不觸發 store 通知，避免面板每幀重繪）。
 */
import type { Map as MapboxMap, MapMouseEvent } from "mapbox-gl";
import type { LngLat } from "../wargame/types";
import { searchPlannerStore } from "../wargame/search/searchPlannerStore";
import { formatDms } from "../wargame/search/dms";
import { bearingDeg, haversineKm } from "../wargame/sim/geo";
import { rulerStore } from "./rulerTool";

const SRC = "wg-search-draft-src";
const LAYER_FILL = "wg-search-draft-fill";
const LAYER_LINE = "wg-search-draft-line";
const LAYER_PTS = "wg-search-draft-pts";
const LAYER_NUM = "wg-search-draft-num";

/** 連點判定 */
const DOUBLE_TAP_MS = 350;
const DOUBLE_TAP_PX = 24;

function buildDraft(cursor: LngLat | null): GeoJSON.FeatureCollection {
  if (!searchPlannerStore.isPicking()) return { type: "FeatureCollection", features: [] };
  const pts = searchPlannerStore.getDraftPoints();
  const features: GeoJSON.Feature[] = [];
  const live = cursor && pts.length > 0 ? [...pts, cursor] : pts;
  const first = live[0];
  if (live.length >= 3 && first) {
    features.push({ type: "Feature", properties: { kind: "fill" }, geometry: { type: "Polygon", coordinates: [[...live, first]] } });
  }
  if (live.length >= 2) {
    features.push({ type: "Feature", properties: { kind: "line" }, geometry: { type: "LineString", coordinates: live } });
    // 預覽閉合邊（虛線較淡）
    const last = live[live.length - 1];
    if (live.length >= 3 && first && last) {
      features.push({ type: "Feature", properties: { kind: "closing" }, geometry: { type: "LineString", coordinates: [last, first] } });
    }
  }
  pts.forEach((p, i) => features.push({
    type: "Feature", properties: { kind: "vertex", n: String(i + 1) }, geometry: { type: "Point", coordinates: p },
  }));
  return { type: "FeatureCollection", features };
}

export function attachSearchAreaDraw(map: MapboxMap, getLang: () => "zh" | "en"): () => void {
  for (const id of [LAYER_NUM, LAYER_PTS, LAYER_LINE, LAYER_FILL]) if (map.getLayer(id)) map.removeLayer(id);
  if (map.getSource(SRC)) map.removeSource(SRC);

  map.addSource(SRC, { type: "geojson", data: buildDraft(null) });
  map.addLayer({
    id: LAYER_FILL, type: "fill", source: SRC, filter: ["==", ["get", "kind"], "fill"],
    paint: { "fill-color": "#facc15", "fill-opacity": 0.08 },
  });
  map.addLayer({
    id: LAYER_LINE, type: "line", source: SRC,
    filter: ["any", ["==", ["get", "kind"], "line"], ["==", ["get", "kind"], "closing"]],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: {
      "line-color": "#facc15", "line-width": 2.2,
      "line-opacity": ["case", ["==", ["get", "kind"], "closing"], 0.45, 0.95],
      "line-dasharray": [2, 1.5],
    },
  });
  map.addLayer({
    id: LAYER_PTS, type: "circle", source: SRC, filter: ["==", ["get", "kind"], "vertex"],
    paint: { "circle-radius": 8, "circle-color": "#facc15", "circle-stroke-color": "#0f172a", "circle-stroke-width": 1.5 },
  });
  map.addLayer({
    id: LAYER_NUM, type: "symbol", source: SRC, filter: ["==", ["get", "kind"], "vertex"],
    layout: {
      "text-field": ["get", "n"], "text-size": 11, "text-allow-overlap": true, "text-ignore-placement": true,
      "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
    },
    paint: { "text-color": "#0f172a" },
  });

  // ── 座標提示 ─────────────────────────────────────────
  const tip = document.createElement("div");
  Object.assign(tip.style, {
    position: "absolute", zIndex: "35", pointerEvents: "none", display: "none",
    padding: "4px 8px", borderRadius: "5px", whiteSpace: "nowrap",
    background: "rgba(15,23,42,0.92)", border: "1px solid rgba(250,204,21,0.5)",
    color: "#fef9c3", font: "600 12px ui-monospace, monospace", lineHeight: "1.45",
    transform: "translate(14px, 14px)",
  } satisfies Partial<CSSStyleDeclaration>);
  map.getContainer().appendChild(tip);

  /**
   * @param fromLast 附上與上一頂點的距離 / 方位（游標移動時）；點擊後顯示剛加的點則不附
   */
  const showTip = (p: LngLat, x: number, y: number, fromLast = true) => {
    if (!searchPlannerStore.isMapClickMode()) { tip.style.display = "none"; return; }
    let text = `${formatDms(p[1], "lat")}  ${formatDms(p[0], "lng")}`;
    const pts = searchPlannerStore.getDraftPoints();
    const last = pts[pts.length - 1];
    if (searchPlannerStore.isPicking()) {
      const n = pts.length;
      const en = getLang() === "en";
      if (!fromLast) {
        text += `\n${en ? `${n}/10 vertices · double-tap/double-click to finish` : `已 ${n}/10 點 · 雙擊完成`}`;
        tip.textContent = text;
        tip.style.whiteSpace = "pre";
        tip.style.left = `${x}px`;
        tip.style.top = `${y}px`;
        tip.style.display = "block";
        return;
      }
      if (last) {
        const nm = haversineKm(last, p) / 1.852;
        text += `\n${en ? "from" : "距"} #${n} ${nm.toFixed(2)} nm · ${String(Math.round(bearingDeg(last, p)) % 360).padStart(3, "0")}°`;
      }
      text += `\n${en ? `vertex ${n + 1}/10 · double-click to finish` : `第 ${n + 1}/10 點 · 雙擊完成`}`;
    }
    tip.textContent = text;
    tip.style.whiteSpace = "pre";
    tip.style.left = `${x}px`;
    tip.style.top = `${y}px`;
    tip.style.display = "block";
  };

  // ── 互動 ────────────────────────────────────────────
  let cursor: LngLat | null = null;
  let raf = 0;
  const redraw = () => {
    (map.getSource(SRC) as mapboxgl.GeoJSONSource | undefined)?.setData(buildDraft(cursor));
  };
  const onMove = (e: MapMouseEvent) => {
    if (!searchPlannerStore.isMapClickMode()) { tip.style.display = "none"; return; }
    const p: LngLat = [e.lngLat.lng, e.lngLat.lat];
    showTip(p, e.point.x, e.point.y);
    if (!searchPlannerStore.isPicking()) return;
    cursor = p;
    if (!raf) raf = requestAnimationFrame(() => { raf = 0; redraw(); });
  };
  const onLeave = () => { tip.style.display = "none"; cursor = null; redraw(); };

  let lastClick: { t: number; x: number; y: number } | null = null;
  /** 以連點完成後，瀏覽器的 dblclick / 觸控雙擊縮放會晚一點才到 —— 這段時間內吞掉 */
  let suppressDblUntil = 0;
  const onClick = (e: MapMouseEvent) => {
    if (rulerStore.isActive()) return;
    const p: LngLat = [e.lngLat.lng, e.lngLat.lat];
    if (!searchPlannerStore.isPicking()) {
      // 其他點地圖模式（LKP / 船舶位置）：觸控沒有 mousemove，在點擊處顯示座標
      showTip(p, e.point.x, e.point.y);
      return;
    }
    const now = performance.now();
    const isDouble = lastClick !== null
      && now - lastClick.t < DOUBLE_TAP_MS
      && Math.hypot(e.point.x - lastClick.x, e.point.y - lastClick.y) < DOUBLE_TAP_PX;
    if (isDouble) {
      lastClick = null;
      suppressDblUntil = now + 600;
      searchPlannerStore.finishDraft();
      return;
    }
    lastClick = { t: now, x: e.point.x, y: e.point.y };
    // 與上一頂點幾乎同一位置（慢速重複點擊）→ 不重複加點
    const pts = searchPlannerStore.getDraftPoints();
    const prev = pts[pts.length - 1];
    if (prev) {
      const q = map.project(prev);
      if (Math.hypot(q.x - e.point.x, q.y - e.point.y) < 6) return;
    }
    searchPlannerStore.addDraftPoint(p[0], p[1]);
    showTip(p, e.point.x, e.point.y, false);
  };
  const onDbl = (e: MapMouseEvent) => {
    if (searchPlannerStore.isPicking() || performance.now() < suppressDblUntil) e.preventDefault();
  };
  const onKey = (e: KeyboardEvent) => {
    if (!searchPlannerStore.isPicking()) return;
    const tag = (e.target as HTMLElement | null)?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
    if (e.key === "Enter") { e.preventDefault(); searchPlannerStore.finishDraft(); }
    else if (e.key === "Backspace") { e.preventDefault(); searchPlannerStore.undoDraftPoint(); }
    else if (e.key === "Escape") searchPlannerStore.cancelPick();
  };

  // 繪製中停用雙擊縮放（雙擊 = 完成）；開始繪製時關掉尺規避免搶點擊
  let wasPicking = false;
  let cursorOwned = false;
  let enableTimer = 0;
  const onStore = () => {
    const picking = searchPlannerStore.isPicking();
    if (picking !== wasPicking) {
      if (enableTimer) { clearTimeout(enableTimer); enableTimer = 0; }
      if (picking) { map.doubleClickZoom.disable(); rulerStore.setActive(false); }
      // 延後恢復雙擊縮放：完成繪製的那次雙擊，瀏覽器事件還在路上
      else enableTimer = window.setTimeout(() => { enableTimer = 0; map.doubleClickZoom.enable(); }, 600);
      wasPicking = picking;
      lastClick = null;
    }
    const mode = searchPlannerStore.isMapClickMode();
    if (mode) { map.getCanvas().style.cursor = "crosshair"; cursorOwned = true; }
    else if (cursorOwned) { map.getCanvas().style.cursor = ""; cursorOwned = false; tip.style.display = "none"; }
    if (!picking) cursor = null;
    redraw();
  };

  map.on("mousemove", onMove);
  map.on("click", onClick);
  map.on("dblclick", onDbl);
  map.getCanvas().addEventListener("mouseleave", onLeave);
  window.addEventListener("keydown", onKey);
  const unsub = searchPlannerStore.subscribe(onStore);
  onStore();

  return () => {
    unsub();
    if (raf) cancelAnimationFrame(raf);
    if (enableTimer) clearTimeout(enableTimer);
    if (wasPicking || enableTimer) map.doubleClickZoom.enable();
    map.off("mousemove", onMove);
    map.off("click", onClick);
    map.off("dblclick", onDbl);
    map.getCanvas().removeEventListener("mouseleave", onLeave);
    window.removeEventListener("keydown", onKey);
    tip.remove();
    for (const id of [LAYER_NUM, LAYER_PTS, LAYER_LINE, LAYER_FILL]) if (map.getLayer(id)) map.removeLayer(id);
    if (map.getSource(SRC)) map.removeSource(SRC);
  };
}
