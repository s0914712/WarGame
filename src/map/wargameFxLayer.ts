/**
 * 戰鬥回饋特效層（純視覺，不影響模擬）：
 *   - 浮動戰鬥文字：命中 −54 / 擊毀 / 攔截 / MISS，從事件位置往上飄、淡出（牆鐘 1.6s，任何倍速都看得到）
 *   - 來襲警示環：目前視角己方單位若有攻擊彈正飛向它 → 紅色脈動環
 *
 * FoW：只在「目前視角有權知道」時顯示——己方參與（射手或目標）或目標單位可見；上帝視角全顯示。
 */
import type { Map as MapboxMap } from "mapbox-gl";
import { scenarioStore } from "../wargame/scenarioStore";
import { viewStore } from "../wargame/viewStore";
import type { EngagementEvent, SideId, SimulationState } from "../wargame/types";

const SRC_TEXT = "wg-fx-text-src";
const SRC_THREAT = "wg-fx-threat-src";
const LAYER_TEXT = "wg-fx-text";
const LAYER_THREAT = "wg-fx-threat";

const TEXT_LIFE_MS = 1600;
const MAX_FLOATERS = 40;

interface Floater { text: string; color: string; size: number; pos: [number, number]; born: number }

function sideOf(state: SimulationState, unitId?: string): SideId | undefined {
  if (!unitId) return undefined;
  return state.units[unitId]?.sideId ?? state.scenario.units.find((u) => u.id === unitId)?.sideId;
}

function knowable(state: SimulationState, e: EngagementEvent, pov: SideId | null): boolean {
  if (pov == null) return true;
  if (sideOf(state, e.attackerId) === pov) return true;
  if ((e.targetSideId ?? sideOf(state, e.targetId)) === pov) return true;
  const t = e.targetId ? state.units[e.targetId] : undefined;
  return !!t && (t.detectedBy[pov] ?? "hidden") !== "hidden" && t.contactQuality?.[pov] !== "bearing";
}

function floaterFor(e: EngagementEvent): Omit<Floater, "pos" | "born"> | null {
  switch (e.kind) {
    case "hit": return { text: e.damage != null ? `−${e.damage}` : "HIT", color: "#fde047", size: 16 };
    case "destroyed": return { text: "✖ 擊毀", color: "#f87171", size: 18 };
    case "intercept": return { text: "攔截", color: "#7dd3fc", size: 14 };
    case "miss": return { text: "MISS", color: "#94a3b8", size: 12 };
    default: return null;
  }
}

export function attachWargameFxLayer(map: MapboxMap): () => void {
  for (const id of [LAYER_TEXT, LAYER_THREAT]) if (map.getLayer(id)) map.removeLayer(id);
  for (const id of [SRC_TEXT, SRC_THREAT]) if (map.getSource(id)) map.removeSource(id);
  for (const id of [SRC_TEXT, SRC_THREAT]) map.addSource(id, { type: "geojson", data: { type: "FeatureCollection", features: [] } });

  map.addLayer({
    id: LAYER_THREAT, type: "circle", source: SRC_THREAT,
    paint: {
      "circle-radius": ["get", "r"],
      "circle-color": "rgba(0, 0, 0, 0)",
      "circle-stroke-color": "#ef4444",
      "circle-stroke-width": 2,
      "circle-stroke-opacity": ["get", "a"],
    },
  });
  map.addLayer({
    id: LAYER_TEXT, type: "symbol", source: SRC_TEXT,
    layout: {
      "text-field": ["get", "text"],
      "text-font": ["Open Sans Bold", "Arial Unicode MS Bold"],
      "text-size": ["get", "size"],
      "text-allow-overlap": true,
      "text-ignore-placement": true,
    },
    paint: {
      "text-color": ["get", "color"],
      "text-opacity": ["get", "alpha"],
      "text-halo-color": "rgba(2, 6, 23, 0.95)",
      "text-halo-width": 1.8,
    },
  });

  let floaters: Floater[] = [];
  let seen = scenarioStore.getState().eventsAll.length;   // 掛載前的舊事件不重播
  let lastScenarioId = scenarioStore.getState().scenario.id;

  const ingest = () => {
    const state = scenarioStore.getState();
    const all = state.eventsAll;
    // 換場景 / 回放重置 → 事件陣列變短
    if (state.scenario.id !== lastScenarioId || all.length < seen) {
      lastScenarioId = state.scenario.id;
      seen = all.length;
      floaters = [];
      return;
    }
    const pov = viewStore.getActiveSideId();
    const now = performance.now();
    for (let i = seen; i < all.length; i++) {
      const e = all[i]!;
      if (!e.position) continue;
      const f = floaterFor(e);
      if (!f || !knowable(state, e, pov)) continue;
      // 同位置連續事件錯開一點，避免文字疊在一起
      const stack = floaters.filter((x) => now - x.born < 400 && x.pos[0] === e.position![0] && x.pos[1] === e.position![1]).length;
      floaters.push({ ...f, pos: e.position, born: now - stack * 220 });
    }
    seen = all.length;
    if (floaters.length > MAX_FLOATERS) floaters = floaters.slice(-MAX_FLOATERS);
  };

  const render = () => {
    const now = performance.now();
    floaters = floaters.filter((f) => now - f.born < TEXT_LIFE_MS);
    const textSrc = map.getSource(SRC_TEXT) as mapboxgl.GeoJSONSource | undefined;
    // 上飄：text-translate 不能逐 feature 設 → 直接把座標往北推（像素換算成緯度）
    const metersPerPx = 40075016 * Math.cos((map.getCenter().lat * Math.PI) / 180) / (512 * 2 ** map.getZoom());
    textSrc?.setData({
      type: "FeatureCollection",
      features: floaters.map((f) => {
        const t = (now - f.born) / TEXT_LIFE_MS;
        const risePx = 10 + t * 34;
        const dLat = (risePx * metersPerPx) / 110574;
        return {
          type: "Feature",
          properties: { text: f.text, color: f.color, size: f.size * (t < 0.12 ? 1 + (0.12 - t) * 3 : 1), alpha: t < 0.7 ? 1 : 1 - (t - 0.7) / 0.3 },
          geometry: { type: "Point", coordinates: [f.pos[0], f.pos[1] + dLat] },
        };
      }),
    });

    // 來襲警示環
    const pov = viewStore.getActiveSideId();
    const state = scenarioStore.getState();
    const threatened = new Set<string>();
    if (pov) {
      for (const m of state.missiles) {
        if (m.role === "interceptor") continue;
        const t = state.units[m.targetId];
        if (t && t.sideId === pov && t.hpCurrent > 0) threatened.add(t.id);
      }
    }
    const pulse = (now % 900) / 900;
    (map.getSource(SRC_THREAT) as mapboxgl.GeoJSONSource | undefined)?.setData({
      type: "FeatureCollection",
      features: [...threatened].map((id) => {
        const u = state.units[id]!;
        return {
          type: "Feature",
          properties: { r: 18 + pulse * 14, a: 1 - pulse },
          geometry: { type: "Point", coordinates: [u.position.lng, u.position.lat] },
        };
      }),
    });
  };

  ingest();
  const unsub = scenarioStore.subscribe(ingest);
  let raf = 0;
  const loop = () => { render(); raf = requestAnimationFrame(loop); };
  raf = requestAnimationFrame(loop);

  return () => {
    cancelAnimationFrame(raf);
    unsub();
    for (const id of [LAYER_TEXT, LAYER_THREAT]) if (map.getLayer(id)) map.removeLayer(id);
    for (const id of [SRC_TEXT, SRC_THREAT]) if (map.getSource(id)) map.removeSource(id);
  };
}
