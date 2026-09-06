/**
 * 搜索規劃圖層 — 搜索區框 + 掃掠帶 + 產生的搜索航線。
 *
 * 訂閱 searchPlannerStore：
 *   - 搜索區（兩角框）+ 面積 / POD 標籤
 *   - 各架無人機的搜索航線（依序號分色）
 *   - 掃掠帶（沿航線加寬 W，直觀顯示覆蓋率）
 */
import type { Map as MapboxMap } from "mapbox-gl";
import type { LngLat } from "../wargame/types";
import { searchPlannerStore, solve } from "../wargame/search/searchPlannerStore";
import { measureBox, boxFromCorners, TRACK_COLORS } from "../wargame/search/tracks";
import { SEARCH_PATTERNS } from "../wargame/search/patterns";
import { langStore } from "../wargame/i18n/lang";
import { searchStrings } from "../wargame/search/i18n";
import { podForDisplay, POD_DISPLAY_CAP } from "../wargame/search/pod";

const SRC_BOX = "wg-search-box-src";
const SRC_SWEEP = "wg-search-sweep-src";
const SRC_TRACKS = "wg-search-tracks-src";

const LAYER_SWEEP = "wg-search-sweep";
const LAYER_BOX = "wg-search-box";
const LAYER_TRACKS = "wg-search-tracks";
const LAYER_TRACK_PTS = "wg-search-track-pts";
const LAYER_LABEL = "wg-search-label";

const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

const lang = (): "zh" | "en" => (langStore.get() === "en" ? "en" : "zh");

function buildBox(): GeoJSON.FeatureCollection {
  const { a, b } = searchPlannerStore.getCorners();
  if (!a) return EMPTY;
  if (!b) {
    // 只點了第一角 → 畫一個標記點
    return { type: "FeatureCollection", features: [
      { type: "Feature", properties: { label: searchStrings(lang()).pickSecondCorner }, geometry: { type: "Point", coordinates: a } },
    ] };
  }
  const box = boxFromCorners(a, b);
  const ring: [number, number][] = [
    [box.west, box.south], [box.east, box.south],
    [box.east, box.north], [box.west, box.north], [box.west, box.south],
  ];
  const m = measureBox(box);
  const sol = solve();

  const t = searchStrings(lang());
  let label = `${t.secArea.replace(/^[①1][. ]*/, "")} ${m.widthNm.toFixed(1)}×${m.heightNm.toFixed(1)} nm · ${m.areaNm2.toFixed(0)} nm²`;
  if (sol) {
    const pat = SEARCH_PATTERNS[sol.pattern][lang()];
    const pod = sol.forward ? sol.forward.pod : sol.inverse?.achievedPod ?? 0;
    const hrs = sol.forward ? sol.forward.timeHr : sol.inverse?.actualTimeHr ?? 0;
    label += `\n${pat.name} · ${sol.droneCount}× · S=${sol.trackSpacingNm.toFixed(2)} nm`;
    const shown = podForDisplay(pod);
    label += `\n${hrs.toFixed(1)} hr · POD ${shown >= POD_DISPLAY_CAP ? ">99.9" : (shown * 100).toFixed(0)}%`;
  }

  return {
    type: "FeatureCollection",
    features: [
      { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [ring] } },
      { type: "Feature", properties: { label }, geometry: { type: "Point", coordinates: [(box.west + box.east) / 2, box.north] } },
    ],
  };
}

function buildTracks(): GeoJSON.FeatureCollection {
  const tracks = searchPlannerStore.getTracks();
  const features: GeoJSON.Feature[] = [];
  tracks.forEach((t) => {
    const start = t.waypoints[0];
    if (t.waypoints.length < 2 || !start) return;
    const color = TRACK_COLORS[t.index % TRACK_COLORS.length] ?? "#38bdf8";
    features.push({
      type: "Feature",
      properties: { color, idx: t.index },
      geometry: { type: "LineString", coordinates: t.waypoints as LngLat[] },
    });
    // 起點標記
    features.push({
      type: "Feature",
      properties: { color, start: 1 },
      geometry: { type: "Point", coordinates: start },
    });
  });
  return { type: "FeatureCollection", features };
}

/** 掃掠帶：航線以 W 寬度加粗顯示（用 line-width 的公尺換算，隨 zoom 縮放） */
function buildSweep(): GeoJSON.FeatureCollection {
  const tracks = searchPlannerStore.getTracks();
  const sol = solve();
  if (tracks.length === 0 || !sol) return EMPTY;
  const W = sol.forward?.sweepWidth.correctedNm ?? sol.inverse?.sweepWidth.correctedNm ?? 0;
  if (!(W > 0)) return EMPTY;
  return {
    type: "FeatureCollection",
    features: tracks.filter((t) => t.waypoints.length >= 2).map((t) => ({
      type: "Feature" as const,
      properties: { sweepNm: W },
      geometry: { type: "LineString" as const, coordinates: t.waypoints as LngLat[] },
    })),
  };
}

export function attachWargameSearchLayer(map: MapboxMap): () => void {
  const all = [LAYER_LABEL, LAYER_TRACK_PTS, LAYER_TRACKS, LAYER_BOX, LAYER_SWEEP];
  for (const id of all) if (map.getLayer(id)) map.removeLayer(id);
  for (const id of [SRC_TRACKS, SRC_BOX, SRC_SWEEP]) if (map.getSource(id)) map.removeSource(id);

  map.addSource(SRC_SWEEP, { type: "geojson", data: buildSweep() });
  map.addSource(SRC_BOX, { type: "geojson", data: buildBox() });
  map.addSource(SRC_TRACKS, { type: "geojson", data: buildTracks() });

  // 掃掠帶 — 用 W（浬）換算成螢幕寬度：1 浬 ≈ 1852 m，line-width 隨 zoom 內插
  map.addLayer({
    id: LAYER_SWEEP, type: "line", source: SRC_SWEEP,
    layout: { "line-cap": "butt", "line-join": "round" },
    paint: {
      "line-color": "#22d3ee",
      "line-opacity": 0.13,
      // 依緯度 0 的公尺/像素關係近似：width_px = W_nm × 1852 / (156543 / 2^zoom)
      "line-width": [
        "interpolate", ["exponential", 2], ["zoom"],
        4,  ["*", ["get", "sweepNm"], 1852 / (156543 / Math.pow(2, 4))],
        14, ["*", ["get", "sweepNm"], 1852 / (156543 / Math.pow(2, 14))],
      ],
    },
  });

  // 搜索區框
  map.addLayer({
    id: LAYER_BOX, type: "line", source: SRC_BOX,
    paint: { "line-color": "#facc15", "line-width": 2, "line-dasharray": [3, 2], "line-opacity": 0.95 },
  });

  // 搜索航線
  map.addLayer({
    id: LAYER_TRACKS, type: "line", source: SRC_TRACKS,
    filter: ["==", ["geometry-type"], "LineString"],
    layout: { "line-cap": "round", "line-join": "round" },
    paint: { "line-color": ["get", "color"], "line-width": 1.8, "line-opacity": 0.9 },
  });

  // 航線起點
  map.addLayer({
    id: LAYER_TRACK_PTS, type: "circle", source: SRC_TRACKS,
    filter: ["==", ["geometry-type"], "Point"],
    paint: {
      "circle-radius": 5, "circle-color": ["get", "color"],
      "circle-stroke-color": "#0f172a", "circle-stroke-width": 1.5,
    },
  });

  // 區域標籤
  map.addLayer({
    id: LAYER_LABEL, type: "symbol", source: SRC_BOX,
    filter: ["==", ["geometry-type"], "Point"],
    layout: {
      "text-field": ["get", "label"], "text-size": 13, "text-anchor": "bottom",
      "text-offset": [0, -0.6], "text-allow-overlap": true, "text-line-height": 1.3,
      "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
    },
    paint: { "text-color": "#fef9c3", "text-halo-color": "rgba(15,23,42,0.92)", "text-halo-width": 2 },
  });

  const refresh = () => {
    (map.getSource(SRC_SWEEP) as mapboxgl.GeoJSONSource | undefined)?.setData(buildSweep());
    (map.getSource(SRC_BOX) as mapboxgl.GeoJSONSource | undefined)?.setData(buildBox());
    (map.getSource(SRC_TRACKS) as mapboxgl.GeoJSONSource | undefined)?.setData(buildTracks());
  };
  const unsub = searchPlannerStore.subscribe(refresh);
  const unsubLang = langStore.subscribe(refresh);

  return () => {
    unsub(); unsubLang();
    for (const id of all) if (map.getLayer(id)) map.removeLayer(id);
    for (const id of [SRC_TRACKS, SRC_BOX, SRC_SWEEP]) if (map.getSource(id)) map.removeSource(id);
  };
}
