/**
 * 六角格圖層 — 兵棋式相連六角格（每格 ≈ 100 km²）+ 紅藍勢力範圍著色。
 *
 * - 格線：只產生視窗內的格子，moveend 重算；太遠（格子過密）自動隱藏，勢力色塊照常顯示
 * - 勢力：hexStore.cells → 依陣營 colorPrimary 填色 + 描邊
 * - 塗色：hexStore 有筆刷時，左鍵按住拖曳連續塗格（暫停地圖拖曳），滑鼠所在格顯示預覽框
 *
 * 須最先掛（壓在雷達 / 單位 / 航線等所有兵棋圖層之下）。
 */
import type { Map as MapboxMap, MapMouseEvent, MapTouchEvent } from "mapbox-gl";
import { scenarioStore } from "../wargame/scenarioStore";
import { hexStore } from "../wargame/hex/hexStore";
import { hexKey, hexRing, hexesInBounds, lngLatToHex, parseHexKey, type Hex } from "../wargame/hex/hexGrid";

const SRC_GRID = "wg-hex-grid-src";
const SRC_CELLS = "wg-hex-cells-src";
const SRC_HOVER = "wg-hex-hover-src";

const LAYER_GRID = "wg-hex-grid";
const LAYER_FILL = "wg-hex-fill";
const LAYER_CELL_LINE = "wg-hex-cell-line";
const LAYER_HOVER = "wg-hex-hover";

const LAYERS = [LAYER_HOVER, LAYER_CELL_LINE, LAYER_FILL, LAYER_GRID];
const SOURCES = [SRC_GRID, SRC_CELLS, SRC_HOVER];

/** 格線最低縮放（再遠格子 < ~10px，只剩雜訊） */
const GRID_MIN_ZOOM = 6.3;
const GRID_MAX_HEXES = 20000;

const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

function hexPolygon(h: Hex, properties: Record<string, unknown> = {}): GeoJSON.Feature {
  return { type: "Feature", properties, geometry: { type: "Polygon", coordinates: [hexRing(h)] } };
}

/** 陣營色：場景定義的 colorPrimary；找不到時依 id 猜紅藍 */
function sideColor(sideId: string): string {
  const side = scenarioStore.getState().scenario.sides.find((s) => s.id === sideId);
  if (side) return side.colorPrimary;
  return /red|plan|pla/i.test(sideId) ? "#ef4444" : "#3b82f6";
}

export function attachWargameHexLayer(map: MapboxMap): () => void {
  // HMR / 換底圖 cleanup
  for (const id of LAYERS) if (map.getLayer(id)) map.removeLayer(id);
  for (const id of SOURCES) if (map.getSource(id)) map.removeSource(id);
  for (const id of SOURCES) map.addSource(id, { type: "geojson", data: EMPTY });

  map.addLayer({
    id: LAYER_FILL,
    type: "fill",
    source: SRC_CELLS,
    paint: { "fill-color": ["get", "color"], "fill-opacity": 0.24 },
  });
  map.addLayer({
    id: LAYER_GRID,
    type: "line",
    source: SRC_GRID,
    minzoom: GRID_MIN_ZOOM,
    paint: {
      "line-color": "#cbd5e1",
      "line-width": ["interpolate", ["linear"], ["zoom"], GRID_MIN_ZOOM, 0.4, 10, 1],
      "line-opacity": ["interpolate", ["linear"], ["zoom"], GRID_MIN_ZOOM, 0.08, 8, 0.2, 11, 0.3],
    },
  });
  map.addLayer({
    id: LAYER_CELL_LINE,
    type: "line",
    source: SRC_CELLS,
    paint: { "line-color": ["get", "color"], "line-width": 1.2, "line-opacity": 0.75 },
  });
  map.addLayer({
    id: LAYER_HOVER,
    type: "line",
    source: SRC_HOVER,
    paint: { "line-color": ["get", "color"], "line-width": 2.5, "line-opacity": 0.95 },
  });

  const setData = (src: string, fc: GeoJSON.FeatureCollection) => {
    (map.getSource(src) as mapboxgl.GeoJSONSource | undefined)?.setData(fc);
  };

  // ── 格線（視窗內） ──
  let gridShown = false;
  const refreshGrid = () => {
    if (!hexStore.isVisible() || map.getZoom() < GRID_MIN_ZOOM) {
      if (gridShown) { setData(SRC_GRID, EMPTY); gridShown = false; }
      return;
    }
    const b = map.getBounds();
    if (!b) return;
    const hexes = hexesInBounds(b.getWest(), b.getSouth(), b.getEast(), b.getNorth(), GRID_MAX_HEXES);
    setData(SRC_GRID, hexes ? { type: "FeatureCollection", features: hexes.map((h) => hexPolygon(h)) } : EMPTY);
    gridShown = !!hexes;
  };

  // ── 勢力色塊 ──
  const refreshCells = () => {
    if (!hexStore.isVisible()) { setData(SRC_CELLS, EMPTY); return; }
    const features: GeoJSON.Feature[] = [];
    for (const [key, sideId] of hexStore.getCells()) {
      features.push(hexPolygon(parseHexKey(key), { color: sideColor(sideId) }));
    }
    setData(SRC_CELLS, { type: "FeatureCollection", features });
  };

  // ── 塗色互動 ──
  let painting = false;
  let hoverKey = "";
  const brushColor = () => {
    const b = hexStore.getBrush();
    return !b ? "#ffffff" : b === "erase" ? "#e2e8f0" : sideColor(b);
  };
  const updateHover = (lng: number, lat: number) => {
    if (!hexStore.getBrush()) return;
    const h = lngLatToHex(lng, lat);
    const key = hexKey(h);
    if (key === hoverKey) return;
    hoverKey = key;
    setData(SRC_HOVER, { type: "FeatureCollection", features: [hexPolygon(h, { color: brushColor() })] });
  };
  const clearHover = () => {
    if (!hoverKey) return;
    hoverKey = "";
    setData(SRC_HOVER, EMPTY);
  };
  const paintAt = (lng: number, lat: number) => { hexStore.paint(hexKey(lngLatToHex(lng, lat))); };

  const startPaint = (lng: number, lat: number) => {
    painting = true;
    map.dragPan.disable();
    paintAt(lng, lat);
  };
  const stopPaint = () => {
    if (!painting) return;
    painting = false;
    map.dragPan.enable();
  };

  const onMouseDown = (e: MapMouseEvent) => {
    if (!hexStore.getBrush() || e.originalEvent.button !== 0) return;
    startPaint(e.lngLat.lng, e.lngLat.lat);
  };
  const onMouseMove = (e: MapMouseEvent) => {
    updateHover(e.lngLat.lng, e.lngLat.lat);
    if (painting) paintAt(e.lngLat.lng, e.lngLat.lat);
  };
  const onTouchStart = (e: MapTouchEvent) => {
    if (!hexStore.getBrush() || e.points.length !== 1) return;
    e.preventDefault();
    startPaint(e.lngLat.lng, e.lngLat.lat);
  };
  const onTouchMove = (e: MapTouchEvent) => {
    if (painting) paintAt(e.lngLat.lng, e.lngLat.lat);
  };

  map.on("mousedown", onMouseDown);
  map.on("mousemove", onMouseMove);
  map.on("mouseout", clearHover);
  map.on("touchstart", onTouchStart);
  map.on("touchmove", onTouchMove);
  map.on("touchend", stopPaint);
  window.addEventListener("mouseup", stopPaint);
  map.on("moveend", refreshGrid);

  // 筆刷 / 顯示切換：游標 + 重畫
  let lastVisible = hexStore.isVisible();
  let lastBrush = hexStore.getBrush();
  const onStore = () => {
    const vis = hexStore.isVisible();
    const b = hexStore.getBrush();
    if (vis !== lastVisible) { lastVisible = vis; refreshGrid(); }
    if (b !== lastBrush) {
      lastBrush = b;
      map.getCanvas().style.cursor = b ? "crosshair" : "";
      // 換筆刷 → 清掉舊色預覽框，下次滑鼠移動用新色重畫
      clearHover();
      if (!b) stopPaint();
    }
    refreshCells();
  };
  const unsubHex = hexStore.subscribe(onStore);

  // 場景換了（陣營顏色可能不同）→ 重畫色塊；只在場景 id 變時做，避免每 tick 重建
  let lastScenario = scenarioStore.getState().scenario.id;
  const unsubScenario = scenarioStore.subscribe(() => {
    const id = scenarioStore.getState().scenario.id;
    if (id !== lastScenario) { lastScenario = id; refreshCells(); }
  });

  refreshGrid();
  refreshCells();
  if (hexStore.getBrush()) map.getCanvas().style.cursor = "crosshair";

  return () => {
    stopPaint();
    unsubHex();
    unsubScenario();
    map.off("mousedown", onMouseDown);
    map.off("mousemove", onMouseMove);
    map.off("mouseout", clearHover);
    map.off("touchstart", onTouchStart);
    map.off("touchmove", onTouchMove);
    map.off("touchend", stopPaint);
    map.off("moveend", refreshGrid);
    window.removeEventListener("mouseup", stopPaint);
    for (const id of LAYERS) if (map.getLayer(id)) map.removeLayer(id);
    for (const id of SOURCES) if (map.getSource(id)) map.removeSource(id);
  };
}
