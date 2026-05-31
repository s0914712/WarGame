/**
 * 選中單位脈動環 — Mapbox circle layer，半徑 + 透明度隨時間 sin 波動。
 *
 * 用 RAF 每幀讀 selectedUnit 位置 + 算 phase 寫進 paint。
 * 沒選中 → 空 source。
 */
import type { Map as MapboxMap } from "mapbox-gl";
import { scenarioStore } from "../wargame/scenarioStore";

const SRC_ID = "wg-selection-src";
const RING_OUTER = "wg-selection-outer";
const RING_INNER = "wg-selection-inner";

function buildFC(): GeoJSON.FeatureCollection<GeoJSON.Point> {
  const u = scenarioStore.getSelectedUnit();
  if (!u) return { type: "FeatureCollection", features: [] };
  return {
    type: "FeatureCollection",
    features: [{
      type: "Feature",
      properties: { id: u.id },
      geometry: { type: "Point", coordinates: [u.position.lng, u.position.lat] },
    }],
  };
}

export function attachWargameSelectionLayer(map: MapboxMap): () => void {
  for (const id of [RING_OUTER, RING_INNER]) {
    if (map.getLayer(id)) map.removeLayer(id);
  }
  if (map.getSource(SRC_ID)) map.removeSource(SRC_ID);

  map.addSource(SRC_ID, { type: "geojson", data: buildFC() });

  map.addLayer({
    id: RING_OUTER,
    type: "circle",
    source: SRC_ID,
    paint: {
      "circle-color": "transparent",
      "circle-radius": 28,
      "circle-stroke-color": "#fde047",
      "circle-stroke-width": 2,
      "circle-stroke-opacity": 0.5,
    },
  });

  map.addLayer({
    id: RING_INNER,
    type: "circle",
    source: SRC_ID,
    paint: {
      "circle-color": "transparent",
      "circle-radius": 16,
      "circle-stroke-color": "#fde047",
      "circle-stroke-width": 2,
      "circle-stroke-opacity": 0.85,
    },
  });

  const refreshData = () => {
    const src = map.getSource(SRC_ID) as mapboxgl.GeoJSONSource | undefined;
    if (src) src.setData(buildFC());
  };

  const unsub = scenarioStore.subscribe(refreshData);

  // RAF 動畫：脈動 radius / opacity
  let raf = 0;
  const start = performance.now();
  const loop = () => {
    const t = (performance.now() - start) / 1000;
    const phase = (Math.sin(t * 2.4) + 1) * 0.5;       // 0..1
    if (map.getLayer(RING_OUTER)) {
      map.setPaintProperty(RING_OUTER, "circle-radius", 24 + phase * 10);
      map.setPaintProperty(RING_OUTER, "circle-stroke-opacity", 0.25 + (1 - phase) * 0.5);
    }
    if (map.getLayer(RING_INNER)) {
      map.setPaintProperty(RING_INNER, "circle-radius", 14 + phase * 4);
    }
    raf = requestAnimationFrame(loop);
  };
  raf = requestAnimationFrame(loop);

  return () => {
    cancelAnimationFrame(raf);
    unsub();
    for (const id of [RING_OUTER, RING_INNER]) {
      if (map.getLayer(id)) map.removeLayer(id);
    }
    if (map.getSource(SRC_ID)) map.removeSource(SRC_ID);
  };
}
