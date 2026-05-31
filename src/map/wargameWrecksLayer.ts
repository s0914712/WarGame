/**
 * 殘骸標記層 — destroyed unit 留下的 ✗ marker + callsign，淡入淡出。
 *
 * age 0 → 1.0 opacity；age = durationSec → 0
 * 用 simSec - destroyedAtSimSec 計算 age，每幀 refresh（沿用 combat layer 的 RAF）
 */
import type { Map as MapboxMap } from "mapbox-gl";
import { scenarioStore } from "../wargame/scenarioStore";
import { wargameClock } from "../wargame/clock";
import type { Wreck } from "../wargame/types";

const SRC_ID = "wg-wrecks-src";
const SYM_ID = "wg-wrecks-symbol";
const LABEL_ID = "wg-wrecks-label";

function buildFC(wrecks: Wreck[], simSec: number, sideColorMap: Map<string, string>): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: wrecks.map((w) => {
      const age = simSec - w.destroyedAtSimSec;
      const ageFrac = Math.min(1, Math.max(0, age / w.durationSec));
      return {
        type: "Feature",
        properties: {
          id: w.id,
          callsign: w.callsign,
          color: sideColorMap.get(w.sideId) ?? "#94a3b8",
          opacity: 1 - ageFrac * 0.7,         // 淡到 30% 最低
        },
        geometry: { type: "Point", coordinates: w.position },
      };
    }),
  };
}

export function attachWargameWrecksLayer(map: MapboxMap): () => void {
  for (const id of [LABEL_ID, SYM_ID]) {
    if (map.getLayer(id)) map.removeLayer(id);
  }
  if (map.getSource(SRC_ID)) map.removeSource(SRC_ID);

  map.addSource(SRC_ID, { type: "geojson", data: { type: "FeatureCollection", features: [] } });

  map.addLayer({
    id: SYM_ID,
    type: "symbol",
    source: SRC_ID,
    layout: {
      "text-field": "✗",
      "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
      "text-size": 22,
      "text-allow-overlap": true,
      "text-ignore-placement": true,
    },
    paint: {
      "text-color": ["get", "color"],
      "text-opacity": ["get", "opacity"],
      "text-halo-color": "rgba(15, 23, 42, 0.85)",
      "text-halo-width": 1.5,
    },
  });

  map.addLayer({
    id: LABEL_ID,
    type: "symbol",
    source: SRC_ID,
    layout: {
      "text-field": ["get", "callsign"],
      "text-font": ["Open Sans Regular", "Arial Unicode MS Regular"],
      "text-size": 11,
      "text-offset": [0, 1.4],
      "text-anchor": "top",
      "text-allow-overlap": false,
      "text-optional": true,
    },
    paint: {
      "text-color": "#94a3b8",
      "text-opacity": ["*", 0.8, ["get", "opacity"]],
      "text-halo-color": "rgba(15, 23, 42, 0.85)",
      "text-halo-width": 1,
    },
  });

  const refresh = () => {
    const state = scenarioStore.getState();
    const simSec = wargameClock.getSimTime();
    const sideColorMap = new Map(state.scenario.sides.map((s) => [s.id, s.colorPrimary]));
    const src = map.getSource(SRC_ID) as mapboxgl.GeoJSONSource | undefined;
    if (src) src.setData(buildFC(state.wreckages, simSec, sideColorMap));
  };

  refresh();
  const unsub = scenarioStore.subscribe(refresh);
  // 沿用 combat layer 的 RAF 更新 — 殘骸 opacity 也要平滑變化
  let raf = 0;
  const loop = () => { refresh(); raf = requestAnimationFrame(loop); };
  raf = requestAnimationFrame(loop);

  return () => {
    cancelAnimationFrame(raf);
    unsub();
    for (const id of [LABEL_ID, SYM_ID]) {
      if (map.getLayer(id)) map.removeLayer(id);
    }
    if (map.getSource(SRC_ID)) map.removeSource(SRC_ID);
  };
}
