/**
 * 航線視覺化 — 已套用航線（current）與規劃中航線（pending）兩條。
 *
 * - current：選中單位的 unit.waypoints（淡藍虛線 + 編號圓點）
 * - pending：editorStore.pendingWaypoints（亮橘虛線 + 編號圓點）
 *
 * 兩條都從單位當前位置畫出第一段。
 *
 * 訂閱兩個 store；任何變化即時 setData。
 */
import type { Map as MapboxMap } from "mapbox-gl";
import type { LngLat, Unit } from "../wargame/types";
import { scenarioStore } from "../wargame/scenarioStore";
import { editorStore } from "../wargame/editor/editorStore";
import { validatePlan } from "../wargame/sim/validate";
import { wargameClock } from "../wargame/clock";

const SRC_CURRENT_LINE = "wg-route-current-line-src";
const SRC_CURRENT_PTS = "wg-route-current-pts-src";
const SRC_PENDING_LINE = "wg-route-pending-line-src";
const SRC_PENDING_PTS = "wg-route-pending-pts-src";

const LAYER_CURRENT_LINE = "wg-route-current-line";
const LAYER_CURRENT_PTS = "wg-route-current-pts";
const LAYER_CURRENT_LABELS = "wg-route-current-labels";
const LAYER_PENDING_LINE = "wg-route-pending-line";
const LAYER_PENDING_PTS = "wg-route-pending-pts";
const LAYER_PENDING_LABELS = "wg-route-pending-labels";

function lineFC(unit: Unit | null, waypoints: LngLat[]): GeoJSON.FeatureCollection {
  if (!unit || waypoints.length === 0) return { type: "FeatureCollection", features: [] };
  const coords: LngLat[] = [[unit.position.lng, unit.position.lat], ...waypoints];
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {},
        geometry: { type: "LineString", coordinates: coords },
      },
    ],
  };
}

function ptFC(waypoints: LngLat[], invalidIdx: Set<number> = new Set()): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: waypoints.map((wp, i) => ({
      type: "Feature",
      properties: { idx: i + 1, invalid: invalidIdx.has(i) },
      geometry: { type: "Point", coordinates: wp },
    })),
  };
}

export function attachWargameRouteLayer(map: MapboxMap): () => void {
  // HMR cleanup
  for (const id of [
    LAYER_CURRENT_LABELS, LAYER_CURRENT_PTS, LAYER_CURRENT_LINE,
    LAYER_PENDING_LABELS, LAYER_PENDING_PTS, LAYER_PENDING_LINE,
  ]) {
    if (map.getLayer(id)) map.removeLayer(id);
  }
  for (const id of [
    SRC_CURRENT_LINE, SRC_CURRENT_PTS, SRC_PENDING_LINE, SRC_PENDING_PTS,
  ]) {
    if (map.getSource(id)) map.removeSource(id);
  }

  // 空 source
  for (const id of [SRC_CURRENT_LINE, SRC_CURRENT_PTS, SRC_PENDING_LINE, SRC_PENDING_PTS]) {
    map.addSource(id, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  }

  // ── current route（淡藍） ──
  map.addLayer({
    id: LAYER_CURRENT_LINE,
    type: "line",
    source: SRC_CURRENT_LINE,
    paint: {
      "line-color": "#60a5fa",
      "line-width": 2,
      "line-opacity": 0.7,
      "line-dasharray": [2, 2],
    },
  });
  map.addLayer({
    id: LAYER_CURRENT_PTS,
    type: "circle",
    source: SRC_CURRENT_PTS,
    paint: {
      "circle-color": "#60a5fa",
      "circle-radius": 8,
      "circle-stroke-color": "#0f172a",
      "circle-stroke-width": 2,
      "circle-opacity": 0.85,
    },
  });
  map.addLayer({
    id: LAYER_CURRENT_LABELS,
    type: "symbol",
    source: SRC_CURRENT_PTS,
    layout: {
      "text-field": ["to-string", ["get", "idx"]],
      "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
      "text-size": 11,
      "text-allow-overlap": true,
    },
    paint: { "text-color": "#0f172a" },
  });

  // ── pending route（亮橘） ──
  map.addLayer({
    id: LAYER_PENDING_LINE,
    type: "line",
    source: SRC_PENDING_LINE,
    paint: {
      "line-color": "#fb923c",
      "line-width": 3,
      "line-opacity": 0.9,
      "line-dasharray": [1.5, 1.5],
    },
  });
  map.addLayer({
    id: LAYER_PENDING_PTS,
    type: "circle",
    source: SRC_PENDING_PTS,
    paint: {
      // 違規 waypoint 顯示紅色，其他維持橘色
      "circle-color": [
        "case",
        ["==", ["get", "invalid"], true],
        "#ef4444",
        "#fb923c",
      ],
      "circle-radius": 9,
      "circle-stroke-color": "#0f172a",
      "circle-stroke-width": 2,
    },
  });
  map.addLayer({
    id: LAYER_PENDING_LABELS,
    type: "symbol",
    source: SRC_PENDING_PTS,
    layout: {
      "text-field": ["to-string", ["get", "idx"]],
      "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
      "text-size": 12,
      "text-allow-overlap": true,
    },
    paint: { "text-color": "#0f172a" },
  });

  const refresh = () => {
    // current route：選中單位的 unit.waypoints
    const selectedUnit = scenarioStore.getSelectedUnit();
    // 規劃模式時，current 線改畫「規劃中那個 unit」的 current waypoints
    const planningId = editorStore.getPlanningUnitId();
    const planningUnit = planningId ? scenarioStore.getState().units[planningId] ?? null : null;
    const targetUnit = planningUnit ?? selectedUnit;

    const currentSrc = map.getSource(SRC_CURRENT_LINE) as mapboxgl.GeoJSONSource | undefined;
    const currentPtsSrc = map.getSource(SRC_CURRENT_PTS) as mapboxgl.GeoJSONSource | undefined;
    if (currentSrc && currentPtsSrc) {
      currentSrc.setData(lineFC(targetUnit, targetUnit?.waypoints ?? []));
      currentPtsSrc.setData(ptFC(targetUnit?.waypoints ?? []));
    }

    // pending route：editorStore.pendingWaypoints（+ 驗證標紅）
    const pending = editorStore.getPendingWaypoints();
    const invalidIdx = planningUnit
      ? new Set(validatePlan(planningUnit, pending, { currentSimSec: wargameClock.getSimTime() }).invalidWaypointIdx)
      : new Set<number>();
    const pendingSrc = map.getSource(SRC_PENDING_LINE) as mapboxgl.GeoJSONSource | undefined;
    const pendingPtsSrc = map.getSource(SRC_PENDING_PTS) as mapboxgl.GeoJSONSource | undefined;
    if (pendingSrc && pendingPtsSrc) {
      pendingSrc.setData(lineFC(planningUnit, pending));
      pendingPtsSrc.setData(ptFC(pending, invalidIdx));
    }
  };

  refresh();
  const unsubScenario = scenarioStore.subscribe(refresh);
  const unsubEditor = editorStore.subscribe(refresh);

  return () => {
    unsubScenario();
    unsubEditor();
    for (const id of [
      LAYER_CURRENT_LABELS, LAYER_CURRENT_PTS, LAYER_CURRENT_LINE,
      LAYER_PENDING_LABELS, LAYER_PENDING_PTS, LAYER_PENDING_LINE,
    ]) {
      if (map.getLayer(id)) map.removeLayer(id);
    }
    for (const id of [SRC_CURRENT_LINE, SRC_CURRENT_PTS, SRC_PENDING_LINE, SRC_PENDING_PTS]) {
      if (map.getSource(id)) map.removeSource(id);
    }
  };
}
