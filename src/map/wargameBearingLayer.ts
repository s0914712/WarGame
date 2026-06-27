/**
 * 被動測向射線圖層（E21）— 虛線方位射線，表示「該方位有音源、但距離未知（未定位）」。
 *
 * 資料來源：engine 每 tick 算好的 `state.passiveContacts`（涵蓋潛艦 / 水面艦艦艏陣列 /
 * 拖曳陣列等所有被動感測器）。只畫 quality === "bearing"（尚未三角交會 / TMA 解算）的接觸：
 * 多條射線交會處 = 三角定位；解算後該接觸升 fixed → 由符號層顯示單位圖示，射線即消失。
 *
 * 射線長度固定（不依真實距離 → 不洩漏距離）。POV 只畫己方；觀察視角畫全部。
 * 純渲染：不改引擎 / 狀態。
 */
import type { Map as MapboxMap } from "mapbox-gl";
import { scenarioStore } from "../wargame/scenarioStore";
import { viewStore } from "../wargame/viewStore";

const SRC_ID = "wg-bearing-src";
const LAYER_ID = "wg-bearing-line";
const DEG = Math.PI / 180;
const RAY_LEN_KM = 55;   // 固定射線長度（不洩漏真實距離）

function buildFC(): GeoJSON.FeatureCollection {
  const state = scenarioStore.getState();
  const sides = state.scenario.sides;
  const activeSide = viewStore.getActiveSideId();   // null = 觀察視角
  const contacts = state.passiveContacts ?? [];
  const features: GeoJSON.Feature[] = [];

  for (const c of contacts) {
    if (c.quality !== "bearing") continue;                       // 已定位 → 由符號層畫圖示
    if (activeSide && c.observerSideId !== activeSide) continue;  // POV 只畫己方測向
    const color = sides.find((s) => s.id === c.observerSideId)?.colorPrimary ?? "#5eead4";

    const [lng, lat] = c.sensorPos;
    const brg = c.bearingDeg * DEG;
    const latPerKm = 1 / 111.32;
    const lngPerKm = 1 / (111.32 * Math.cos(lat * DEG));
    const end: [number, number] = [
      lng + Math.sin(brg) * RAY_LEN_KM * lngPerKm,
      lat + Math.cos(brg) * RAY_LEN_KM * latPerKm,
    ];
    features.push({
      type: "Feature",
      properties: { color },
      geometry: { type: "LineString", coordinates: [[lng, lat], end] },
    });
  }
  return { type: "FeatureCollection", features };
}

export function attachWargameBearingLayer(map: MapboxMap): () => void {
  if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
  if (map.getSource(SRC_ID)) map.removeSource(SRC_ID);

  map.addSource(SRC_ID, { type: "geojson", data: buildFC() });
  map.addLayer({
    id: LAYER_ID,
    type: "line",
    source: SRC_ID,
    paint: {
      "line-color": ["get", "color"],
      "line-width": 1,
      "line-opacity": 0.55,
      "line-dasharray": [3, 3],
    },
  });

  const refresh = () => {
    const src = map.getSource(SRC_ID) as mapboxgl.GeoJSONSource | undefined;
    if (src) src.setData(buildFC());
  };
  const unsub1 = scenarioStore.subscribe(refresh);
  const unsub2 = viewStore.subscribe(refresh);

  return () => {
    unsub1(); unsub2();
    if (map.getLayer(LAYER_ID)) map.removeLayer(LAYER_ID);
    if (map.getSource(SRC_ID)) map.removeSource(SRC_ID);
  };
}
