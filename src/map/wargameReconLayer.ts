/**
 * 偵察盲區圖層 —— 資產面板開在「偵察計畫」分頁、且有關注區時，
 * 把現有感測器覆蓋不到的格點畫成紅色方格。
 *
 * 單位每 tick 移動；覆蓋最多每 2 秒（真實時間）重算一次。
 */
import type { Map as MapboxMap } from "mapbox-gl";
import { scenarioStore } from "../wargame/scenarioStore";
import { searchPlannerStore } from "../wargame/search/searchPlannerStore";
import { viewStore } from "../wargame/viewStore";
import { aoiFromSearchArea, computeCoverage } from "../wargame/recon/reconPlanner";
import { suggestAois } from "../wargame/recon/aoiSuggest";
import { langStore } from "../wargame/i18n/lang";
import { assetPanelStore } from "../components/wargame/AssetPanel";

const SRC = "wg-recon-gaps-src";
const LAYER = "wg-recon-gaps";
const SRC_SUG = "wg-recon-sug-src";
const LAYER_SUG = "wg-recon-sug";
const LAYER_SUG_LABEL = "wg-recon-sug-label";
const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };
const THROTTLE_MS = 2000;

/** 建議關注區預覽（紫色虛線 + 編號標籤） */
function buildSuggestions(): GeoJSON.FeatureCollection {
  if (!assetPanelStore.isOpen() || assetPanelStore.getTab() !== "recon") return EMPTY;
  const st = scenarioStore.getState();
  const sideId = assetPanelStore.getSide() ?? viewStore.getActiveSideId() ?? "blue";
  const side = st.scenario.sides.find((s) => s.id === sideId);
  if (!side) return EMPTY;
  const en = langStore.get() === "en";
  const sug = suggestAois(sideId, st.scenario, Object.values(st.units), side.targetPriority);
  return {
    type: "FeatureCollection",
    features: sug.flatMap((g, i) => {
      const first = g.polygon[0];
      if (!first) return [];
      const ring = [...g.polygon, first];
      const top = g.polygon.reduce((a, p) => (p[1] > a[1] ? p : a), first);
      return [
        { type: "Feature" as const, properties: { i }, geometry: { type: "LineString" as const, coordinates: ring } },
        {
          type: "Feature" as const,
          properties: { label: `${i + 1}. ${(en ? g.labelEn : g.labelZh).split(/[：:]/)[0]}` },
          geometry: { type: "Point" as const, coordinates: top },
        },
      ];
    }),
  };
}

function build(): GeoJSON.FeatureCollection {
  if (!assetPanelStore.isOpen() || assetPanelStore.getTab() !== "recon") return EMPTY;
  const { a, b } = searchPlannerStore.getCorners();
  const aoi = aoiFromSearchArea(searchPlannerStore.getPolygon(), a, b);
  if (!aoi) return EMPTY;
  const sideId = assetPanelStore.getSide() ?? viewStore.getActiveSideId() ?? "blue";
  const own = Object.values(scenarioStore.getState().units).filter((u) => u.sideId === sideId);
  const cov = computeCoverage(aoi, own);
  const [dx, dy] = cov.cellDeg;
  const hx = dx / 2, hy = dy / 2;
  return {
    type: "FeatureCollection",
    features: cov.gapCells.map(([x, y]) => ({
      type: "Feature" as const,
      properties: {},
      geometry: {
        type: "Polygon" as const,
        coordinates: [[[x - hx, y - hy], [x + hx, y - hy], [x + hx, y + hy], [x - hx, y + hy], [x - hx, y - hy]]],
      },
    })),
  };
}

export function attachWargameReconLayer(map: MapboxMap): () => void {
  if (map.getLayer(LAYER)) map.removeLayer(LAYER);
  if (map.getSource(SRC)) map.removeSource(SRC);
  map.addSource(SRC, { type: "geojson", data: build() });
  map.addLayer({
    id: LAYER, type: "fill", source: SRC,
    paint: { "fill-color": "#ef4444", "fill-opacity": 0.28, "fill-outline-color": "rgba(239,68,68,0.6)" },
  });
  if (map.getLayer(LAYER_SUG_LABEL)) map.removeLayer(LAYER_SUG_LABEL);
  if (map.getLayer(LAYER_SUG)) map.removeLayer(LAYER_SUG);
  if (map.getSource(SRC_SUG)) map.removeSource(SRC_SUG);
  map.addSource(SRC_SUG, { type: "geojson", data: buildSuggestions() });
  map.addLayer({
    id: LAYER_SUG, type: "line", source: SRC_SUG, filter: ["==", ["geometry-type"], "LineString"],
    paint: { "line-color": "#a78bfa", "line-width": 1.8, "line-dasharray": [3, 2], "line-opacity": 0.9 },
  });
  map.addLayer({
    id: LAYER_SUG_LABEL, type: "symbol", source: SRC_SUG, filter: ["==", ["geometry-type"], "Point"],
    layout: {
      "text-field": ["get", "label"], "text-size": 12, "text-anchor": "bottom", "text-offset": [0, -0.4],
      "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"], "text-allow-overlap": false,
    },
    paint: { "text-color": "#ddd6fe", "text-halo-color": "rgba(15,23,42,0.92)", "text-halo-width": 2 },
  });

  let last = 0;
  let timer = 0;
  const refresh = () => {
    (map.getSource(SRC) as mapboxgl.GeoJSONSource | undefined)?.setData(build());
    (map.getSource(SRC_SUG) as mapboxgl.GeoJSONSource | undefined)?.setData(buildSuggestions());
    last = performance.now();
  };
  /** 面板 / 關注區變動：立即更新 */
  const now = () => { if (timer) { clearTimeout(timer); timer = 0; } refresh(); };
  /** 單位移動：節流 */
  const throttled = () => {
    if (!assetPanelStore.isOpen() || assetPanelStore.getTab() !== "recon") return;
    if (timer) return;
    const wait = Math.max(0, THROTTLE_MS - (performance.now() - last));
    timer = window.setTimeout(() => { timer = 0; refresh(); }, wait);
  };
  const u1 = assetPanelStore.subscribe(now);
  const u2 = searchPlannerStore.subscribe(now);
  const u3 = scenarioStore.subscribe(throttled);

  return () => {
    u1(); u2(); u3();
    if (timer) clearTimeout(timer);
    if (map.getLayer(LAYER)) map.removeLayer(LAYER);
    if (map.getSource(SRC)) map.removeSource(SRC);
    if (map.getLayer(LAYER_SUG_LABEL)) map.removeLayer(LAYER_SUG_LABEL);
    if (map.getLayer(LAYER_SUG)) map.removeLayer(LAYER_SUG);
    if (map.getSource(SRC_SUG)) map.removeSource(SRC_SUG);
  };
}
