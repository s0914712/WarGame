/**
 * 任務目標地圖層：
 *   - hold_area：目標區圓（陣營色虛線 + 淡填色）+ 名稱 / 控制進度標籤；爭奪中改紅色描邊
 *   - destroy_unit：我方要擊毀的可見目標 → 紅環；敵方要擊毀的我方單位 → 金環（保護）
 *   - preserve_unit：需保全的單位外加金色護衛環
 * 資料來源 computeObjectives（已處理 FoW：看不到的目標不給座標）。
 */
import type { Map as MapboxMap } from "mapbox-gl";
import { scenarioStore } from "../wargame/scenarioStore";
import { viewStore } from "../wargame/viewStore";
import { wargameClock } from "../wargame/clock";
import { computeObjectives } from "../wargame/objectives";
import type { LngLat } from "../wargame/types";

const SRC_ZONES = "wg-obj-zones-src";
const SRC_LABELS = "wg-obj-labels-src";
const SRC_MARKS = "wg-obj-marks-src";

const LAYER_ZONE_FILL = "wg-obj-zone-fill";
const LAYER_ZONE_LINE = "wg-obj-zone-line";
const LAYER_ZONE_LABEL = "wg-obj-zone-label";
const LAYER_MARK = "wg-obj-mark";

const LAYERS = [LAYER_MARK, LAYER_ZONE_LABEL, LAYER_ZONE_LINE, LAYER_ZONE_FILL];
const SOURCES = [SRC_ZONES, SRC_LABELS, SRC_MARKS];

function circleRing([lng, lat]: LngLat, radiusKm: number, steps = 72): LngLat[] {
  const kx = 111.32 * Math.cos((lat * Math.PI) / 180);
  const ring: LngLat[] = [];
  for (let i = 0; i <= steps; i++) {
    const a = (2 * Math.PI * i) / steps;
    ring.push([lng + (radiusKm * Math.cos(a)) / kx, lat + (radiusKm * Math.sin(a)) / 110.574]);
  }
  return ring;
}

export function attachWargameObjectiveLayer(map: MapboxMap): () => void {
  for (const id of LAYERS) if (map.getLayer(id)) map.removeLayer(id);
  for (const id of SOURCES) if (map.getSource(id)) map.removeSource(id);
  for (const id of SOURCES) map.addSource(id, { type: "geojson", data: { type: "FeatureCollection", features: [] } });

  map.addLayer({
    id: LAYER_ZONE_FILL, type: "fill", source: SRC_ZONES,
    paint: { "fill-color": ["get", "color"], "fill-opacity": ["*", 0.1, ["+", 0.6, ["get", "progress"]]] },
  });
  map.addLayer({
    id: LAYER_ZONE_LINE, type: "line", source: SRC_ZONES,
    paint: {
      "line-color": ["case", ["get", "contested"], "#f87171", ["get", "color"]],
      "line-width": ["case", ["get", "contested"], 2.5, 2],
      "line-dasharray": [3, 2],
      "line-opacity": 0.9,
    },
  });
  map.addLayer({
    id: LAYER_ZONE_LABEL, type: "symbol", source: SRC_LABELS,
    layout: {
      "text-field": ["get", "text"],
      "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
      "text-size": 13,
      "text-allow-overlap": true,
      "text-anchor": "center",
    },
    paint: {
      "text-color": ["case", ["get", "contested"], "#fecaca", "#f8fafc"],
      "text-halo-color": "rgba(2, 6, 23, 0.9)",
      "text-halo-width": 1.6,
    },
  });
  map.addLayer({
    id: LAYER_MARK, type: "circle", source: SRC_MARKS,
    paint: {
      "circle-radius": 22,
      "circle-color": "rgba(0, 0, 0, 0)",
      "circle-stroke-color": ["get", "color"],
      "circle-stroke-width": 2,
      "circle-stroke-opacity": 0.9,
    },
  });

  let lastSig = "";
  const refresh = () => {
    const state = scenarioStore.getState();
    const pov = viewStore.getActiveSideId();
    const objs = computeObjectives(state, wargameClock.getSimTime(), pov);
    const sig = objs.map((o) => `${o.state}|${o.detail}|${o.contested ? 1 : 0}|${o.focus?.map((v) => v.toFixed(3)).join(",") ?? ""}`).join(";");
    if (sig === lastSig) return;
    lastSig = sig;

    const colorOf = (id: string | null) => (id && state.scenario.sides.find((s) => s.id === id)?.colorPrimary) || "#fbbf24";
    const zones: GeoJSON.Feature[] = [];
    const labels: GeoJSON.Feature[] = [];
    const marks: GeoJSON.Feature[] = [];
    for (const o of objs) {
      if (!o.focus) continue;
      if (o.kind === "hold_area" && o.radiusKm) {
        const props = { color: colorOf(o.sideId), progress: o.progress ?? 0, contested: !!o.contested };
        zones.push({ type: "Feature", properties: props, geometry: { type: "Polygon", coordinates: [circleRing(o.focus, o.radiusKm)] } });
        const pct = Math.round((o.progress ?? 0) * 100);
        labels.push({
          type: "Feature",
          // 地圖標籤只取「—」前的短名（完整敘述在目標 HUD）
          properties: { contested: !!o.contested, text: `◎ ${o.label.split(/\s*[—–]\s*/)[0]}\n${o.contested ? "⚔ 爭奪中" : o.state === "done" ? "已控制" : pct > 0 ? `控制 ${pct}%` : "未控制"}` },
          geometry: { type: "Point", coordinates: o.focus },
        });
      } else if (o.state === "active" && (o.kind === "destroy_unit" || o.kind === "preserve_unit")) {
        marks.push({
          type: "Feature",
          // 紅 = 我方要擊毀的目標；金 = 我方要保護的單位（含「敵方想擊毀的我方單位」）
          properties: { color: o.kind === "destroy_unit" && (pov == null || o.sideId === pov) ? "#f87171" : "#fbbf24" },
          geometry: { type: "Point", coordinates: o.focus },
        });
      }
    }
    (map.getSource(SRC_ZONES) as mapboxgl.GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features: zones });
    (map.getSource(SRC_LABELS) as mapboxgl.GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features: labels });
    (map.getSource(SRC_MARKS) as mapboxgl.GeoJSONSource | undefined)?.setData({ type: "FeatureCollection", features: marks });
  };

  refresh();
  const unsubA = scenarioStore.subscribe(refresh);
  const unsubB = viewStore.subscribe(refresh);

  return () => {
    unsubA();
    unsubB();
    for (const id of LAYERS) if (map.getLayer(id)) map.removeLayer(id);
    for (const id of SOURCES) if (map.getSource(id)) map.removeSource(id);
  };
}
