/**
 * 潛艦被動聲納測向圖層 — 虛線方位射線（bearing-only，表示「該方位有音源」）。
 *
 * 被動聲納只得方位、不得距離；故從潛艦沿方位畫一條虛線指向音源，
 * 射線略過目標延伸（距離未知）。多艘潛艦對同一音源的虛線會交會 → 三角定位。
 *
 * 純渲染：用 sonar 純函式判定被動接觸，不改引擎 / 狀態。POV 只畫己方潛艦（觀察視角畫全部）。
 */
import type { Map as MapboxMap } from "mapbox-gl";
import { scenarioStore } from "../wargame/scenarioStore";
import { viewStore } from "../wargame/viewStore";
import { UNIT_CATALOG } from "../wargame/catalog/units";
import { sonarPassiveDetects } from "../wargame/sim/sonar";
import { effectiveSonarParams } from "../wargame/sim/acousticEnvironment";
import { haversineKm, bearingDeg } from "../wargame/sim/geo";

const SRC_ID = "wg-bearing-src";
const LAYER_ID = "wg-bearing-line";
const DEG = Math.PI / 180;

function inWater(kind: string): boolean {
  const d = UNIT_CATALOG[kind as keyof typeof UNIT_CATALOG]?.domain;
  return d === "sea" || d === "subsurface";
}

function buildFC(): GeoJSON.FeatureCollection {
  const state = scenarioStore.getState();
  const sides = state.scenario.sides;
  const activeSide = viewStore.getActiveSideId();   // null = 觀察
  const params = effectiveSonarParams(state.scenario);
  const units = Object.values(state.units);
  const features: GeoJSON.Feature[] = [];

  for (const sub of units) {
    if (UNIT_CATALOG[sub.kind].domain !== "subsurface") continue;
    if (sub.hpCurrent <= 0) continue;
    if (activeSide && sub.sideId !== activeSide) continue;   // 只畫己方潛艦
    const side = sides.find((s) => s.id === sub.sideId);
    const hostiles = side?.isHostileTo ?? [];
    if (hostiles.length === 0) continue;
    const color = side?.colorPrimary ?? "#5eead4";

    for (const t of units) {
      if (!hostiles.includes(t.sideId)) continue;
      if (t.hpCurrent <= 0 || !inWater(t.kind)) continue;
      const range = haversineKm(
        [sub.position.lng, sub.position.lat],
        [t.position.lng, t.position.lat],
      );
      if (!sonarPassiveDetects(sub, t, range, params.layerDepthM, params.czSpacingKm, params.sonarEnv)) continue;

      // 沿方位畫虛線，略過目標延伸（距離未知）
      const brg = bearingDeg([sub.position.lng, sub.position.lat], [t.position.lng, t.position.lat]) * DEG;
      const farKm = Math.max(8, range * 1.5);
      const latPerKm = 1 / 111.32;
      const lngPerKm = 1 / (111.32 * Math.cos(sub.position.lat * DEG));
      const end: [number, number] = [
        sub.position.lng + Math.sin(brg) * farKm * lngPerKm,
        sub.position.lat + Math.cos(brg) * farKm * latPerKm,
      ];
      features.push({
        type: "Feature",
        properties: { color },
        geometry: { type: "LineString", coordinates: [[sub.position.lng, sub.position.lat], end] },
      });
    }
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
