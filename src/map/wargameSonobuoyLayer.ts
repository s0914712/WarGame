/**
 * 聲標反潛屏幕圖層 — 已佈聲標（點 + MDR 涵蓋圈）+ 兩角定框即時預覽（框 + 預覽格網 + P_FZ 標籤）。
 *
 * 訂閱 scenarioStore（state.sonobuoys）+ editorStore（defineSonobuoyArea draft）。
 */
import type { Map as MapboxMap } from "mapbox-gl";
import type { LngLat, Sonobuoy } from "../wargame/types";
import { scenarioStore } from "../wargame/scenarioStore";
import { editorStore } from "../wargame/editor/editorStore";
import { planSonobuoyField } from "../wargame/sim/sonobuoyField";

const SRC_RINGS = "wg-sonobuoy-rings-src";
const SRC_BUOYS = "wg-sonobuoy-pts-src";
const SRC_BOX = "wg-sonobuoy-box-src";

const LAYER_RINGS = "wg-sonobuoy-rings";
const LAYER_BUOYS = "wg-sonobuoy-pts";
const LAYER_BOX = "wg-sonobuoy-box";
const LAYER_LABEL = "wg-sonobuoy-label";

const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

/** km → 度近似多邊形圓（64 邊） */
function circleCoords(lng: number, lat: number, radiusKm: number, steps = 48): [number, number][] {
  const coords: [number, number][] = [];
  const latPerKm = 1 / 111.32;
  const lngPerKm = 1 / (111.32 * Math.cos((lat * Math.PI) / 180));
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    coords.push([lng + Math.cos(a) * radiusKm * lngPerKm, lat + Math.sin(a) * radiusKm * latPerKm]);
  }
  return coords;
}

function sideColorOf(sideId: string): string {
  const s = scenarioStore.getState().scenario.sides.find((x) => x.id === sideId);
  return s?.colorPrimary ?? "#38bdf8";
}

interface Draft {
  mode: string;
  cornerA: LngLat | null;
  cornerB: LngLat | null;
  count: number;
  mdrKm: number;
}
function getDraft(): Draft {
  const d = editorStore.getSonobuoyDraft();
  return { mode: editorStore.getMode(), cornerA: d.cornerA, cornerB: d.cornerB, count: d.count, mdrKm: d.mdrKm };
}

function deployedBuoys(): Sonobuoy[] {
  return scenarioStore.getState().sonobuoys ?? [];
}

function buildRings(): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const b of deployedBuoys()) {
    features.push({
      type: "Feature",
      properties: { color: sideColorOf(b.sideId), preview: 0 },
      geometry: { type: "Polygon", coordinates: [circleCoords(b.position[0], b.position[1], b.mdrKm)] },
    });
  }
  const d = getDraft();
  if (d.mode === "defineSonobuoyArea" && d.cornerA && d.cornerB) {
    const plan = planSonobuoyField({ cornerA: d.cornerA, cornerB: d.cornerB, count: d.count, mdrKm: d.mdrKm });
    for (const p of plan.buoys) {
      features.push({
        type: "Feature",
        properties: { color: "#7dd3fc", preview: 1 },
        geometry: { type: "Polygon", coordinates: [circleCoords(p[0], p[1], d.mdrKm)] },
      });
    }
  }
  return { type: "FeatureCollection", features };
}

function buildBuoys(): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const b of deployedBuoys()) {
    features.push({
      type: "Feature",
      properties: { color: sideColorOf(b.sideId), preview: 0 },
      geometry: { type: "Point", coordinates: [b.position[0], b.position[1]] },
    });
  }
  const d = getDraft();
  if (d.mode === "defineSonobuoyArea") {
    if (d.cornerA && d.cornerB) {
      const plan = planSonobuoyField({ cornerA: d.cornerA, cornerB: d.cornerB, count: d.count, mdrKm: d.mdrKm });
      for (const p of plan.buoys) {
        features.push({ type: "Feature", properties: { color: "#7dd3fc", preview: 1 }, geometry: { type: "Point", coordinates: p } });
      }
    } else if (d.cornerA) {
      features.push({ type: "Feature", properties: { color: "#7dd3fc", preview: 1 }, geometry: { type: "Point", coordinates: d.cornerA } });
    }
  }
  return { type: "FeatureCollection", features };
}

function buildBox(): GeoJSON.FeatureCollection {
  const d = getDraft();
  if (d.mode !== "defineSonobuoyArea" || !d.cornerA || !d.cornerB) return EMPTY;
  const [aLng, aLat] = d.cornerA;
  const [bLng, bLat] = d.cornerB;
  const ring: [number, number][] = [[aLng, aLat], [bLng, aLat], [bLng, bLat], [aLng, bLat], [aLng, aLat]];
  const plan = planSonobuoyField({ cornerA: d.cornerA, cornerB: d.cornerB, count: d.count, mdrKm: d.mdrKm });
  const label = `聲標屏幕  P_FZ ${(plan.pFZ * 100).toFixed(0)}%\n${plan.rows}×${plan.cols} · ${plan.count}枚 · ${plan.lengthNm.toFixed(0)}×${plan.widthNm.toFixed(0)}nm`;
  return {
    type: "FeatureCollection",
    features: [
      { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: ring } },
      { type: "Feature", properties: { label }, geometry: { type: "Point", coordinates: [(aLng + bLng) / 2, Math.max(aLat, bLat)] } },
    ],
  };
}

export function attachWargameSonobuoyLayer(map: MapboxMap): () => void {
  for (const id of [LAYER_LABEL, LAYER_BOX, LAYER_BUOYS, LAYER_RINGS]) if (map.getLayer(id)) map.removeLayer(id);
  for (const id of [SRC_BOX, SRC_BUOYS, SRC_RINGS]) if (map.getSource(id)) map.removeSource(id);

  map.addSource(SRC_RINGS, { type: "geojson", data: buildRings() });
  map.addSource(SRC_BUOYS, { type: "geojson", data: buildBuoys() });
  map.addSource(SRC_BOX, { type: "geojson", data: buildBox() });

  // MDR 涵蓋圈（淡）
  map.addLayer({
    id: LAYER_RINGS, type: "fill", source: SRC_RINGS,
    paint: {
      "fill-color": ["get", "color"],
      "fill-opacity": ["case", ["==", ["get", "preview"], 1], 0.07, 0.10],
    },
  });
  // 聲標點
  map.addLayer({
    id: LAYER_BUOYS, type: "circle", source: SRC_BUOYS,
    paint: {
      "circle-radius": ["case", ["==", ["get", "preview"], 1], 3, 4],
      "circle-color": ["get", "color"],
      "circle-stroke-color": "#0f172a",
      "circle-stroke-width": 1,
      "circle-opacity": ["case", ["==", ["get", "preview"], 1], 0.7, 1],
    },
  });
  // 搜索框外框（預覽）
  map.addLayer({
    id: LAYER_BOX, type: "line", source: SRC_BOX,
    paint: { "line-color": "#7dd3fc", "line-width": 1.5, "line-dasharray": [2, 1.5], "line-opacity": 0.9 },
  });
  // P_FZ 標籤
  map.addLayer({
    id: LAYER_LABEL, type: "symbol", source: SRC_BOX,
    layout: {
      "text-field": ["get", "label"], "text-size": 13, "text-anchor": "bottom",
      "text-offset": [0, -0.5], "text-allow-overlap": true,
      "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
    },
    paint: { "text-color": "#e0f2fe", "text-halo-color": "rgba(15,23,42,0.92)", "text-halo-width": 2 },
  });

  const refresh = () => {
    (map.getSource(SRC_RINGS) as mapboxgl.GeoJSONSource | undefined)?.setData(buildRings());
    (map.getSource(SRC_BUOYS) as mapboxgl.GeoJSONSource | undefined)?.setData(buildBuoys());
    (map.getSource(SRC_BOX) as mapboxgl.GeoJSONSource | undefined)?.setData(buildBox());
  };
  const unsub1 = scenarioStore.subscribe(refresh);
  const unsub2 = editorStore.subscribe(refresh);

  return () => {
    unsub1(); unsub2();
    for (const id of [LAYER_LABEL, LAYER_BOX, LAYER_BUOYS, LAYER_RINGS]) if (map.getLayer(id)) map.removeLayer(id);
    for (const id of [SRC_BOX, SRC_BUOYS, SRC_RINGS]) if (map.getSource(id)) map.removeSource(id);
  };
}
