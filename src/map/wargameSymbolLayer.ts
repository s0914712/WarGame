/**
 * 兵推 NATO 軍事符號圖層（取代 Three.js UnitScene 的幾何渲染）。
 *
 * 流程：
 *   1. loadWargameSymbols(map) 把 9 個圖示註冊進 Mapbox image registry
 *   2. attach 時建立 GeoJSON source + symbol layer
 *   3. 訂閱 scenarioStore：units / selectedUnitId 變動 → setData
 *
 * 點擊：caller 用 map.queryRenderedFeatures(point, { layers: [LAYER_ID] })
 *      取 feature.properties.unitId
 */
import type { Map as MapboxMap } from "mapbox-gl";
import { scenarioStore } from "../wargame/scenarioStore";
import { viewStore } from "../wargame/viewStore";
import { iconNameOf } from "../wargame/symbology/sidc";

const SOURCE_ID = "wargame-units-src";
export const SYMBOL_LAYER_ID = "wargame-units-symbol";
const LABEL_LAYER_ID = "wargame-units-label";
const HPBAR_LAYER_ID = "wargame-units-hpbar";

interface FeatureProps {
  unitId: string;
  icon: string;
  callsign: string;
  selected: boolean;
  /** 1 = 玩家方視角看得到（己方 / 中立 / 已偵測敵方）；0 = 玩家方未偵測 */
  visible: number;
  hpBar: string;           // "▰▰▰▱▱" 之類的 5 段條
  hpColor: string;         // 顏色按 HP % 換 green/yellow/red
  hpText: string;          // "180/250"
}

function hpBarText(frac: number): string {
  const SEGMENTS = 6;
  const filled = Math.max(0, Math.min(SEGMENTS, Math.round(frac * SEGMENTS)));
  return "▰".repeat(filled) + "▱".repeat(SEGMENTS - filled);
}

function hpColorOf(frac: number): string {
  if (frac > 0.7) return "#4ade80";   // green
  if (frac > 0.3) return "#facc15";   // yellow
  return "#ef4444";                    // red
}

function buildFeatureCollection(): GeoJSON.FeatureCollection<GeoJSON.Point, FeatureProps> {
  const { units, scenario } = scenarioStore.getState();
  const selectedId = scenarioStore.getSelectedUnitId();
  const fogStrict = scenarioStore.isFogOfWar();
  const activeSide = viewStore.getActiveSideId();   // null = spectator
  const playerSide = activeSide ? scenario.sides.find((s) => s.id === activeSide) : null;
  const hostileToActive = playerSide?.isHostileTo ?? [];

  const features: GeoJSON.Feature<GeoJSON.Point, FeatureProps>[] = [];
  for (const u of Object.values(units)) {
    let visible = 1;
    if (activeSide && hostileToActive.includes(u.sideId)) {
      const det = u.detectedBy[activeSide];
      visible = det && det !== "hidden" ? 1 : 0;
    }
    // Spectator (activeSide == null) → everything visible 100%
    // FoW 嚴格 + 非 spectator + 未偵測 → skip 渲染
    if (visible === 0 && fogStrict) continue;

    const hpFrac = u.hpCurrent / u.core.hpMax;
    features.push({
      type: "Feature",
      properties: {
        unitId: u.id,
        icon: iconNameOf(u.kind, u.sideId),
        callsign: u.callsign,
        selected: u.id === selectedId,
        visible,
        hpBar: hpBarText(hpFrac),
        hpColor: hpColorOf(hpFrac),
        hpText: `${u.hpCurrent}/${u.core.hpMax}`,
      },
      geometry: { type: "Point", coordinates: [u.position.lng, u.position.lat] },
    });
  }
  return { type: "FeatureCollection", features };
}

export function attachWargameSymbolLayer(map: MapboxMap): () => void {
  // HMR 重複掛載防護
  if (map.getLayer(HPBAR_LAYER_ID)) map.removeLayer(HPBAR_LAYER_ID);
  if (map.getLayer(LABEL_LAYER_ID)) map.removeLayer(LABEL_LAYER_ID);
  if (map.getLayer(SYMBOL_LAYER_ID)) map.removeLayer(SYMBOL_LAYER_ID);
  if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);

  map.addSource(SOURCE_ID, {
    type: "geojson",
    data: buildFeatureCollection(),
  });

  map.addLayer({
    id: SYMBOL_LAYER_ID,
    type: "symbol",
    source: SOURCE_ID,
    layout: {
      "icon-image": ["get", "icon"],
      // base 0.5；選中放大到 0.7
      "icon-size": ["case", ["get", "selected"], 0.7, 0.5],
      "icon-allow-overlap": true,
      "icon-ignore-placement": true,
      "icon-anchor": "center",
    },
    paint: {
      // 未偵測敵方淡化到 15%（仍看得到位置但醒目度低）
      "icon-opacity": [
        "case",
        ["==", ["get", "visible"], 1],
        1.0,
        0.15,
      ],
    },
  });

  // HP bar — 單位上方
  map.addLayer({
    id: HPBAR_LAYER_ID,
    type: "symbol",
    source: SOURCE_ID,
    layout: {
      "text-field": ["get", "hpBar"],
      "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
      "text-size": 14,
      "text-offset": [0, -2.0],
      "text-anchor": "bottom",
      "text-allow-overlap": true,
      "text-ignore-placement": true,
      "text-letter-spacing": -0.1,
    },
    paint: {
      "text-color": ["get", "hpColor"],
      "text-opacity": ["case", ["==", ["get", "visible"], 1], 1.0, 0.15],
      "text-halo-color": "rgba(15, 23, 42, 0.85)",
      "text-halo-width": 1.5,
    },
  });

  // callsign 標籤 — 字體放大到 14
  map.addLayer({
    id: LABEL_LAYER_ID,
    type: "symbol",
    source: SOURCE_ID,
    layout: {
      "text-field": ["get", "callsign"],
      "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
      "text-size": 14,
      "text-offset": [0, 1.8],
      "text-anchor": "top",
      "text-allow-overlap": false,
      "text-optional": true,
    },
    paint: {
      "text-color": "#e2e8f0",
      "text-opacity": ["case", ["==", ["get", "visible"], 1], 1.0, 0.5],
      "text-halo-color": "rgba(15, 23, 42, 0.92)",
      "text-halo-width": 2,
    },
  });

  const refresh = () => {
    const src = map.getSource(SOURCE_ID) as mapboxgl.GeoJSONSource | undefined;
    if (!src) return;
    src.setData(buildFeatureCollection());
  };

  const unsub1 = scenarioStore.subscribe(refresh);
  const unsub2 = viewStore.subscribe(refresh);     // POV 切換時重畫

  return () => {
    unsub1(); unsub2();
    if (map.getLayer(HPBAR_LAYER_ID)) map.removeLayer(HPBAR_LAYER_ID);
    if (map.getLayer(LABEL_LAYER_ID)) map.removeLayer(LABEL_LAYER_ID);
    if (map.getLayer(SYMBOL_LAYER_ID)) map.removeLayer(SYMBOL_LAYER_ID);
    if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
  };
}
