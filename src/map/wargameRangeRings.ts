/**
 * 兵推單位射程圈 / 偵測圈 — Mapbox GeoJSON fill 圖層。
 *
 * 為什麼用 Mapbox 而不是 Three.js：
 *   - 圓圈跟地面貼合（不像 3D 物件需處理高度）
 *   - 半徑單位是公里，setData 即可即時縮放
 *   - 對使用者操作 slider 反應更直接
 *
 * Phase 2：只顯示「選中單位」的射程 / 偵測圈。
 * Phase 3 之後可加 wgRangeRings/wgDetectionRings toggle 顯示所有單位（教學模式）。
 */

import type { Map as MapboxMap } from "mapbox-gl";
import type { Unit } from "../wargame/types";
import { scenarioStore } from "../wargame/scenarioStore";

const SOURCE_ID = "wargame-range-rings-src";
const LAYER_RANGE = "wargame-ring-range";
const LAYER_DETECT = "wargame-ring-detect";

interface CircleProps {
  kind: "range" | "detection";
}

/** 用 64 邊形逼近圓 — 經緯度上 km → 度的換算（不嚴謹但足夠視覺用） */
function circleCoords(lng: number, lat: number, radiusKm: number, steps = 64): [number, number][] {
  const coords: [number, number][] = [];
  // 1 緯度 ≈ 111.32 km；1 經度 ≈ 111.32 * cos(lat) km
  const latPerKm = 1 / 111.32;
  const lngPerKm = 1 / (111.32 * Math.cos((lat * Math.PI) / 180));
  for (let i = 0; i <= steps; i++) {
    const angle = (i / steps) * Math.PI * 2;
    const dy = Math.sin(angle) * radiusKm * latPerKm;
    const dx = Math.cos(angle) * radiusKm * lngPerKm;
    coords.push([lng + dx, lat + dy]);
  }
  return coords;
}

function buildFeatureCollection(unit: Unit | null): GeoJSON.FeatureCollection<GeoJSON.Polygon, CircleProps> {
  if (!unit) return { type: "FeatureCollection", features: [] };
  const { lng, lat } = unit.position;
  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: { kind: "detection" },
        geometry: { type: "Polygon", coordinates: [circleCoords(lng, lat, unit.core.detectionRangeKm)] },
      },
      {
        type: "Feature",
        properties: { kind: "range" },
        geometry: { type: "Polygon", coordinates: [circleCoords(lng, lat, unit.core.rangeKm)] },
      },
    ],
  };
}

/**
 * 掛上後會自動訂閱 scenarioStore — 選中單位變化或 attribute 變化都會 setData。
 * 回傳 unsubscribe + cleanup 函式。
 */
export function attachWargameRangeRings(map: MapboxMap): () => void {
  if (map.getSource(SOURCE_ID)) {
    // 已存在（HMR 場景）→ 先移除
    if (map.getLayer(LAYER_RANGE)) map.removeLayer(LAYER_RANGE);
    if (map.getLayer(LAYER_DETECT)) map.removeLayer(LAYER_DETECT);
    map.removeSource(SOURCE_ID);
  }

  map.addSource(SOURCE_ID, {
    type: "geojson",
    data: buildFeatureCollection(scenarioStore.getSelectedUnit()),
  });

  map.addLayer({
    id: LAYER_DETECT,
    type: "fill",
    source: SOURCE_ID,
    filter: ["==", ["get", "kind"], "detection"],
    paint: {
      "fill-color": "#facc15",
      "fill-opacity": 0.10,
      "fill-outline-color": "#facc15",
    },
  });

  map.addLayer({
    id: LAYER_RANGE,
    type: "fill",
    source: SOURCE_ID,
    filter: ["==", ["get", "kind"], "range"],
    paint: {
      "fill-color": "#ef4444",
      "fill-opacity": 0.13,
      "fill-outline-color": "#ef4444",
    },
  });

  const refresh = () => {
    const src = map.getSource(SOURCE_ID) as mapboxgl.GeoJSONSource | undefined;
    if (!src) return;
    src.setData(buildFeatureCollection(scenarioStore.getSelectedUnit()));
  };

  const unsub = scenarioStore.subscribe(refresh);

  return () => {
    unsub();
    if (map.getLayer(LAYER_RANGE)) map.removeLayer(LAYER_RANGE);
    if (map.getLayer(LAYER_DETECT)) map.removeLayer(LAYER_DETECT);
    if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
  };
}
