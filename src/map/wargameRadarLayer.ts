/**
 * ISR 視覺化 — 雷達站的常駐偵測圈 + 偵測連線（data link）。
 *
 * - 偵測圈：青色虛線圓，半徑 = radar.core.detectionRangeKm
 * - 連線：雷達與每個（已被偵測到的）敵方畫一條細黃線
 *
 * 與 wargameRangeRings 不同 — 那個只給選中單位用；這個是雷達的常駐 ISR。
 */
import type { Map as MapboxMap } from "mapbox-gl";
import type { LngLat, SideId } from "../wargame/types";
import { scenarioStore } from "../wargame/scenarioStore";
import { viewStore } from "../wargame/viewStore";
import { haversineKm } from "../wargame/sim/geo";

const SRC_RINGS = "wg-radar-rings-src";
const SRC_LINKS = "wg-radar-links-src";
const LAYER_RINGS = "wg-radar-rings";
const LAYER_LINKS = "wg-radar-links";

function circleCoords(lng: number, lat: number, radiusKm: number, steps = 96): LngLat[] {
  const coords: LngLat[] = [];
  const latPerKm = 1 / 111.32;
  const lngPerKm = 1 / (111.32 * Math.cos((lat * Math.PI) / 180));
  for (let i = 0; i <= steps; i++) {
    const a = (i / steps) * Math.PI * 2;
    coords.push([lng + Math.cos(a) * radiusKm * lngPerKm, lat + Math.sin(a) * radiusKm * latPerKm]);
  }
  return coords;
}

/** spectator 顯示所有陣營雷達；單一陣營 POV 只顯示該方雷達 */
function radarSideFilter(u: { kind: string; sideId: SideId }): boolean {
  if (u.kind !== "radar_station") return false;
  const active = viewStore.getActiveSideId();
  return active === null || u.sideId === active;
}

function buildRingsFC(): GeoJSON.FeatureCollection {
  const { units, scenario } = scenarioStore.getState();
  const sideMap = new Map(scenario.sides.map((s) => [s.id, s]));
  return {
    type: "FeatureCollection",
    features: Object.values(units)
      .filter(radarSideFilter)
      .map((u) => ({
        type: "Feature",
        properties: { id: u.id, color: sideMap.get(u.sideId)?.colorPrimary ?? "#22d3ee" },
        geometry: {
          type: "Polygon",
          coordinates: [circleCoords(u.position.lng, u.position.lat, u.core.detectionRangeKm)],
        },
      })),
  };
}

function buildLinksFC(): GeoJSON.FeatureCollection {
  const { units, scenario } = scenarioStore.getState();
  const activeSide = viewStore.getActiveSideId();
  if (!activeSide) return { type: "FeatureCollection", features: [] }; // spectator 不畫 datalink

  const playerSide = scenario.sides.find((s) => s.id === activeSide);
  const hostiles = playerSide?.isHostileTo ?? [];

  const radars = Object.values(units).filter((u) => u.kind === "radar_station" && u.sideId === activeSide);
  const detectedHostiles = Object.values(units).filter((u) => {
    if (!hostiles.includes(u.sideId)) return false;
    const det = u.detectedBy[activeSide];
    return det && det !== "hidden";
  });

  const features: GeoJSON.Feature[] = [];
  for (const r of radars) {
    for (const h of detectedHostiles) {
      const d = haversineKm([r.position.lng, r.position.lat], [h.position.lng, h.position.lat]);
      if (d > r.core.detectionRangeKm) continue;
      features.push({
        type: "Feature",
        properties: { from: r.id, to: h.id },
        geometry: {
          type: "LineString",
          coordinates: [
            [r.position.lng, r.position.lat],
            [h.position.lng, h.position.lat],
          ],
        },
      });
    }
  }
  return { type: "FeatureCollection", features };
}

export function attachWargameRadarLayer(map: MapboxMap): () => void {
  for (const id of [LAYER_LINKS, LAYER_RINGS]) {
    if (map.getLayer(id)) map.removeLayer(id);
  }
  for (const id of [SRC_LINKS, SRC_RINGS]) {
    if (map.getSource(id)) map.removeSource(id);
  }

  map.addSource(SRC_RINGS, { type: "geojson", data: buildRingsFC() });
  map.addSource(SRC_LINKS, { type: "geojson", data: buildLinksFC() });

  map.addLayer({
    id: LAYER_RINGS,
    type: "line",
    source: SRC_RINGS,
    paint: {
      "line-color": ["get", "color"],   // 按陣營著色（藍方雷達藍環、紅方紅環）
      "line-width": 1.5,
      "line-opacity": 0.5,
      "line-dasharray": [3, 3],
    },
  });

  map.addLayer({
    id: LAYER_LINKS,
    type: "line",
    source: SRC_LINKS,
    paint: {
      "line-color": "#fde047",
      "line-width": 1,
      "line-opacity": 0.55,
      "line-dasharray": [1, 2],
    },
  });

  const refresh = () => {
    const ringsSrc = map.getSource(SRC_RINGS) as mapboxgl.GeoJSONSource | undefined;
    const linksSrc = map.getSource(SRC_LINKS) as mapboxgl.GeoJSONSource | undefined;
    if (ringsSrc) ringsSrc.setData(buildRingsFC());
    if (linksSrc) linksSrc.setData(buildLinksFC());
  };

  const unsub1 = scenarioStore.subscribe(refresh);
  const unsub2 = viewStore.subscribe(refresh);

  return () => {
    unsub1(); unsub2();
    for (const id of [LAYER_LINKS, LAYER_RINGS]) {
      if (map.getLayer(id)) map.removeLayer(id);
    }
    for (const id of [SRC_LINKS, SRC_RINGS]) {
      if (map.getSource(id)) map.removeSource(id);
    }
  };
}
