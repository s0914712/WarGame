/**
 * 落水漂流粒子雲 —— 搜索規劃器 Leeway 漂流結果在「時間軸拉桿」所選小時的粒子位置，
 * 加上質心逐時路徑與落水點。由 attachWargameSearchLayer 一併掛載（兵推 / ?mode=search 共用）。
 *
 * 擱淺（觸岸）粒子以橘色標示：搜救上代表「可能已上岸」，要另派岸際搜索。
 */
import type { Map as MapboxMap } from "mapbox-gl";
import { searchPlannerStore } from "../wargame/search/searchPlannerStore";

const SRC_PTS = "wg-drift-pts-src";
const SRC_PATH = "wg-drift-path-src";
const LAYER_PTS = "wg-drift-pts";
const LAYER_PATH = "wg-drift-path";
const LAYER_PATH_DOTS = "wg-drift-path-dots";
const LAYER_MOB = "wg-drift-mob";
const LAYERS = [LAYER_MOB, LAYER_PATH_DOTS, LAYER_PATH, LAYER_PTS];
const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

/** 地圖上最多畫幾顆（粒子數上萬時抽樣，避免拖慢；統計仍用全部） */
const MAX_DRAW = 4000;

function visible(): boolean {
  const inp = searchPlannerStore.getInputs();
  return inp.bayesEnabled && inp.priorFromLkp && inp.driftModel === "leeway" && searchPlannerStore.isDriftCurrent();
}

function buildPoints(): GeoJSON.FeatureCollection {
  const res = searchPlannerStore.getDrift().result;
  if (!res || !visible()) return EMPTY;
  const h = Math.min(searchPlannerStore.getDriftViewHour(), res.hours);
  const pos = res.hourly[h]!;
  const st = res.strandedHourly[h]!;
  const stride = Math.max(1, Math.ceil(res.count / MAX_DRAW));
  const features: GeoJSON.Feature[] = [];
  for (let i = 0; i < res.count; i += stride) {
    features.push({
      type: "Feature",
      properties: { s: st[i] },
      geometry: { type: "Point", coordinates: [pos[i * 2]!, pos[i * 2 + 1]!] },
    });
  }
  return { type: "FeatureCollection", features };
}

function buildPath(): GeoJSON.FeatureCollection {
  const res = searchPlannerStore.getDrift().result;
  const lkp = searchPlannerStore.getInputs().mcLkp;
  if (!res || !visible() || !lkp) return EMPTY;
  const coords: [number, number][] = [];
  const dots: GeoJSON.Feature[] = [];
  for (let h = 0; h <= res.hours; h++) {
    const pos = res.hourly[h]!;
    let sx = 0, sy = 0;
    for (let i = 0; i < res.count; i++) { sx += pos[i * 2]!; sy += pos[i * 2 + 1]!; }
    const c: [number, number] = [sx / res.count, sy / res.count];
    coords.push(c);
    if (h > 0 && h % 6 === 0) {
      dots.push({ type: "Feature", properties: { label: `T+${h}h` }, geometry: { type: "Point", coordinates: c } });
    }
  }
  return {
    type: "FeatureCollection",
    features: [
      { type: "Feature", properties: { kind: "path" }, geometry: { type: "LineString", coordinates: coords } },
      ...dots,
      { type: "Feature", properties: { kind: "mob", label: "MOB" }, geometry: { type: "Point", coordinates: lkp } },
    ],
  };
}

export function attachWargameDriftLayer(map: MapboxMap): () => void {
  for (const id of LAYERS) if (map.getLayer(id)) map.removeLayer(id);
  for (const id of [SRC_PTS, SRC_PATH]) if (map.getSource(id)) map.removeSource(id);

  map.addSource(SRC_PTS, { type: "geojson", data: buildPoints() });
  map.addSource(SRC_PATH, { type: "geojson", data: buildPath() });
  map.addLayer({
    id: LAYER_PTS, type: "circle", source: SRC_PTS,
    paint: {
      "circle-color": ["case", ["==", ["get", "s"], 1], "#fb923c", "#f87171"] as unknown as string,
      "circle-radius": ["interpolate", ["linear"], ["zoom"], 6, 1.2, 10, 2.5, 13, 4],
      "circle-opacity": 0.55,
    },
  });
  map.addLayer({
    id: LAYER_PATH, type: "line", source: SRC_PATH, filter: ["==", ["get", "kind"], "path"],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": "#fecaca", "line-width": 1.6, "line-dasharray": [2, 1.5], "line-opacity": 0.9 },
  });
  map.addLayer({
    id: LAYER_PATH_DOTS, type: "symbol", source: SRC_PATH, filter: ["has", "label"],
    layout: {
      "text-field": ["get", "label"], "text-size": 11, "text-offset": [0, 1.1],
      "text-allow-overlap": true,
    },
    paint: { "text-color": "#fee2e2", "text-halo-color": "#7f1d1d", "text-halo-width": 1.4 },
  });
  map.addLayer({
    id: LAYER_MOB, type: "circle", source: SRC_PATH, filter: ["==", ["get", "kind"], "mob"],
    paint: { "circle-color": "#ef4444", "circle-radius": 6, "circle-stroke-color": "#fff", "circle-stroke-width": 2 },
  });

  const refresh = () => {
    (map.getSource(SRC_PTS) as mapboxgl.GeoJSONSource | undefined)?.setData(buildPoints());
    (map.getSource(SRC_PATH) as mapboxgl.GeoJSONSource | undefined)?.setData(buildPath());
  };
  // 只在漂流結果 / 顯示小時 / 是否可見改變時重畫（store 每次 notify 都會叫，拉其他欄位不必重建）
  let lastSig = "";
  let lastResult: unknown = null;
  const unsub = searchPlannerStore.subscribe(() => {
    const d = searchPlannerStore.getDrift();
    const sig = `${visible()}|${searchPlannerStore.getDriftViewHour()}`;
    if (sig === lastSig && d.result === lastResult) return;
    lastSig = sig;
    lastResult = d.result;
    refresh();
  });

  return () => {
    unsub();
    for (const id of LAYERS) if (map.getLayer(id)) map.removeLayer(id);
    for (const id of [SRC_PTS, SRC_PATH]) if (map.getSource(id)) map.removeSource(id);
  };
}
