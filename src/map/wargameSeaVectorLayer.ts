/**
 * 海流 / 風場向量箭頭 —— seacurrent 預報在 seaVectorStore 指定時刻的場。
 *
 * - 海流：粗箭頭，顏色 / 大小依流速（m/s）；陸地格不畫
 * - 風：細長箭頭，顏色 / 大小依風速（m/s）
 * - 箭頭指向「流向 / 吹向」（不是氣象慣用的「來向」），與漂流方向直接對得起來
 * - 只取畫面範圍內的格點，依縮放抽稀，避免箭頭擠成一片
 *
 * 由 attachWargameSearchLayer 一併掛載（兵推 / ?mode=search 共用），壓在漂流粒子之下。
 */
import type { Map as MapboxMap } from "mapbox-gl";
import { seaVectorStore } from "../wargame/search/drift/seaVectorStore";

const SRC = "wg-seavec-src";
const LAYER_CURRENT = "wg-seavec-current";
const LAYER_WIND = "wg-seavec-wind";
const ICON_CURRENT = "wg-seavec-arrow";
const ICON_WIND = "wg-seavec-windarrow";
const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

/** 色階（m/s）—— 面板圖例共用 */
export const CURRENT_STOPS: [number, string][] = [[0, "#38bdf8"], [0.25, "#22d3ee"], [0.5, "#4ade80"], [1, "#facc15"], [1.5, "#f97316"], [2, "#ef4444"]];
export const WIND_STOPS: [number, string][] = [[0, "#cbd5e1"], [5, "#a5b4fc"], [10, "#c084fc"], [15, "#f472b6"], [20, "#ef4444"]];

function colorExpr(stops: [number, string][]): unknown {
  return ["interpolate", ["linear"], ["get", "spd"], ...stops.flat()];
}

/** 畫一支朝上（北）的箭頭當 SDF icon；wind = 細長桿 + 小箭頭 */
function arrowImage(wind: boolean): ImageData {
  const S = 48;
  const c = document.createElement("canvas");
  c.width = S; c.height = S;
  const g = c.getContext("2d")!;
  g.fillStyle = "#fff";
  g.strokeStyle = "#fff";
  g.lineCap = "round";
  if (wind) {
    g.lineWidth = 3;
    g.beginPath(); g.moveTo(24, 44); g.lineTo(24, 10); g.stroke();
    g.beginPath(); g.moveTo(24, 4); g.lineTo(16, 16); g.lineTo(32, 16); g.closePath(); g.fill();
  } else {
    g.lineWidth = 7;
    g.beginPath(); g.moveTo(24, 42); g.lineTo(24, 18); g.stroke();
    g.beginPath(); g.moveTo(24, 4); g.lineTo(11, 22); g.lineTo(37, 22); g.closePath(); g.fill();
  }
  return g.getImageData(0, 0, S, S);
}

function ensureImages(map: MapboxMap): void {
  if (!map.hasImage(ICON_CURRENT)) map.addImage(ICON_CURRENT, arrowImage(false), { sdf: true, pixelRatio: 2 });
  if (!map.hasImage(ICON_WIND)) map.addImage(ICON_WIND, arrowImage(true), { sdf: true, pixelRatio: 2 });
}

/** 依縮放決定格距（度）：海流原生 0.2°、風原生 1°，縮小時抽稀 */
function spacingDeg(kind: "current" | "wind", zoom: number): number {
  if (kind === "current") return zoom >= 8 ? 0.2 : zoom >= 6.8 ? 0.4 : zoom >= 5.8 ? 0.6 : 1.0;
  return zoom >= 7 ? 0.5 : zoom >= 5.5 ? 1 : 2;
}

function build(map: MapboxMap): GeoJSON.FeatureCollection {
  const f = seaVectorStore.getFields();
  const t = seaVectorStore.getTimeMs();
  if (!f || !t || !seaVectorStore.anyOn()) return EMPTY;
  const b = map.getBounds();
  if (!b) return EMPTY;
  const zoom = map.getZoom();
  const features: GeoJSON.Feature[] = [];
  const add = (kind: "current" | "wind") => {
    if (!seaVectorStore.isOn(kind)) return;
    const sampler = kind === "current" ? f.env.currentAt(t) : f.env.windAt(t);
    const d = spacingDeg(kind, zoom);
    // 對齊格點（拖曳地圖時箭頭不跟著飄）
    const w = Math.floor(b.getWest() / d) * d, e = b.getEast();
    const s = Math.floor(b.getSouth() / d) * d, n = b.getNorth();
    for (let lat = s; lat <= n; lat += d) {
      for (let lng = w; lng <= e; lng += d) {
        const v = sampler(lng, lat);
        if (!v) continue;   // 陸地 / 網格外
        const spd = Math.hypot(v[0], v[1]);
        if (spd < (kind === "current" ? 0.02 : 0.3)) continue;
        features.push({
          type: "Feature",
          properties: { k: kind, spd, brg: (Math.atan2(v[0], v[1]) * 180) / Math.PI },
          geometry: { type: "Point", coordinates: [lng, lat] },
        });
      }
    }
  };
  add("current");
  add("wind");
  return { type: "FeatureCollection", features };
}

export function attachWargameSeaVectorLayer(map: MapboxMap): () => void {
  for (const id of [LAYER_WIND, LAYER_CURRENT]) if (map.getLayer(id)) map.removeLayer(id);
  if (map.getSource(SRC)) map.removeSource(SRC);
  ensureImages(map);
  map.addSource(SRC, { type: "geojson", data: build(map) });

  const common: mapboxgl.SymbolLayerSpecification["layout"] = {
    "icon-rotate": ["get", "brg"],
    "icon-rotation-alignment": "map",
    "icon-allow-overlap": true,
    "icon-ignore-placement": true,
  };
  map.addLayer({
    id: LAYER_WIND, type: "symbol", source: SRC, filter: ["==", ["get", "k"], "wind"],
    layout: {
      ...common,
      "icon-image": ICON_WIND,
      "icon-size": ["interpolate", ["linear"], ["get", "spd"], 0, 0.55, 20, 1.2],
    },
    paint: {
      "icon-color": colorExpr(WIND_STOPS) as string,
      "icon-opacity": 0.75,
      "icon-halo-color": "rgba(15,23,42,0.7)", "icon-halo-width": 1,
    },
  });
  map.addLayer({
    id: LAYER_CURRENT, type: "symbol", source: SRC, filter: ["==", ["get", "k"], "current"],
    layout: {
      ...common,
      "icon-image": ICON_CURRENT,
      "icon-size": ["interpolate", ["linear"], ["get", "spd"], 0, 0.5, 1.5, 1.15],
    },
    paint: {
      "icon-color": colorExpr(CURRENT_STOPS) as string,
      "icon-opacity": 0.85,
      "icon-halo-color": "rgba(15,23,42,0.8)", "icon-halo-width": 1,
    },
  });

  const refresh = () => (map.getSource(SRC) as mapboxgl.GeoJSONSource | undefined)?.setData(build(map));
  let lastVersion = -1;
  const unsub = seaVectorStore.subscribe(() => {
    const v = seaVectorStore.getVersion();
    if (v === lastVersion) return;
    lastVersion = v;
    refresh();
  });
  const onMoveEnd = () => { seaVectorStore.checkTime(); refresh(); };
  map.on("moveend", onMoveEnd);
  seaVectorStore.ensureLoaded();

  return () => {
    unsub();
    map.off("moveend", onMoveEnd);
    for (const id of [LAYER_WIND, LAYER_CURRENT]) if (map.getLayer(id)) map.removeLayer(id);
    if (map.getSource(SRC)) map.removeSource(SRC);
  };
}
