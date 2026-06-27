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
import { flagIconNameOf } from "../wargame/symbology/flagMarkers";
import { cinemaDirector } from "../wargame/cinema/director";
import { getCinemaTrack } from "../wargame/cinema/cinemaTracks";
import { sampleTrack } from "../wargame/cinema/track";

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
  /** 1 = 未識別接觸（unknown）：顯示為匿名 "?"、不洩漏身份 / HP */
  unknownContact: number;
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
  const { units, scenario, simTimeSec } = scenarioStore.getState();
  const selectedId = scenarioStore.getSelectedUnitId();
  const fogStrict = scenarioStore.isFogOfWar();
  const activeSide = viewStore.getActiveSideId();   // null = spectator
  const playerSide = activeSide ? scenario.sides.find((s) => s.id === activeSide) : null;
  const hostileToActive = playerSide?.isHostileTo ?? [];

  // 紀錄片模式：marker 換成 1958 期旗（無對應旗的陣營 fallback 回軍標）
  const cinemaOn = cinemaDirector.isActive();

  const features: GeoJSON.Feature<GeoJSON.Point, FeatureProps>[] = [];
  for (const u of Object.values(units)) {
    let visible = 1;
    let bearingOnly = false;
    let acousticMark = false;
    let unknownDet = false;
    if (activeSide && hostileToActive.includes(u.sideId)) {
      const det = u.detectedBy[activeSide];
      visible = det && det !== "hidden" ? 1 : 0;
      // 漸進偵測：unknown 階段只看到匿名接觸，尚未識別身份 / HP
      if (det === "unknown") unknownDet = true;
      const q = u.contactQuality?.[activeSide];
      // 被動測向「未定位」接觸：位置未知 → 不畫單位圖示（改由測向射線呈現），等三角交會 / TMA 才定位
      if (visible === 1 && q === "bearing") bearingOnly = true;
      // 聲學定位接觸：有位置但無身份 → 只畫匿名標記（不洩漏 callsign / HP）；身份須潛望鏡目視
      if (visible === 1 && q === "acoustic") acousticMark = true;
    }
    // Spectator (activeSide == null) → everything visible 100%
    // FoW 嚴格 + 非 spectator + 未偵測 → skip 渲染
    if (visible === 0 && fogStrict) continue;
    // 未定位（僅方位）→ 不洩漏精確位置，跳過圖示渲染
    if (bearingOnly) continue;

    // 匿名接觸 = 漸進偵測未識別 OR 聲學定位（只有 mark、沒身份）
    const anonymous = unknownDet || acousticMark;
    const anonLabel = acousticMark ? "聲納接觸" : "未識別接觸";
    const hpFrac = u.hpCurrent / u.core.hpMax;

    // 紀錄片模式：有作者軌跡的單位 → sampleTrack 內插覆寫座標（平滑運鏡，與引擎脫鉤）；
    // 其餘單位（岸砲 / 觀測所）fallback 回引擎真實位置。
    let lng = u.position.lng;
    let lat = u.position.lat;
    if (cinemaOn) {
      const track = getCinemaTrack(scenario.id, u.id);
      if (track) {
        const pose = sampleTrack(track, simTimeSec);
        if (pose) { lng = pose.lng; lat = pose.lat; }
      }
    }

    features.push({
      type: "Feature",
      properties: {
        unitId: u.id,
        icon: (cinemaOn && flagIconNameOf(u.sideId)) || iconNameOf(u.kind, u.sideId),
        // 匿名接觸：不洩漏真實 callsign / HP
        callsign: anonymous ? anonLabel : u.callsign,
        selected: u.id === selectedId,
        visible,
        unknownContact: anonymous ? 1 : 0,
        hpBar: anonymous ? "" : hpBarText(hpFrac),
        hpColor: hpColorOf(hpFrac),
        hpText: anonymous ? "" : `${u.hpCurrent}/${u.core.hpMax}`,
      },
      geometry: { type: "Point", coordinates: [lng, lat] },
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
      // 未偵測敵方淡化到 15%；unknown 接觸 0.55（看得到光點但醒目度低）；已識別 1.0
      "icon-opacity": [
        "case",
        ["==", ["get", "visible"], 0], 0.15,
        ["==", ["get", "unknownContact"], 1], 0.55,
        1.0,
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
  const unsub3 = cinemaDirector.subscribe(refresh); // 紀錄片開關 → 軍標 ⇄ 期旗

  return () => {
    unsub1(); unsub2(); unsub3();
    if (map.getLayer(HPBAR_LAYER_ID)) map.removeLayer(HPBAR_LAYER_ID);
    if (map.getLayer(LABEL_LAYER_ID)) map.removeLayer(LABEL_LAYER_ID);
    if (map.getLayer(SYMBOL_LAYER_ID)) map.removeLayer(SYMBOL_LAYER_ID);
    if (map.getSource(SOURCE_ID)) map.removeSource(SOURCE_ID);
  };
}
