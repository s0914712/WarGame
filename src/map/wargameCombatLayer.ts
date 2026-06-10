/**
 * 戰鬥視覺層 — 飛彈（小亮點 + 拖尾線）+ 爆炸（擴張環）。
 *
 * 訂閱 scenarioStore；missiles / explosions 變化即時 setData。
 * 爆炸用 simTime 算 age → circle-radius 隨 age 擴張、opacity 衰減。
 */
import type { Map as MapboxMap } from "mapbox-gl";
import { scenarioStore } from "../wargame/scenarioStore";
import { wargameClock } from "../wargame/clock";
import type { Explosion, Missile } from "../wargame/types";

const SRC_MISSILES = "wg-missiles-src";
const SRC_MISSILE_TRAILS = "wg-missile-trails-src";
const SRC_EXPLOSIONS = "wg-explosions-src";

const LAYER_MISSILE_TRAIL = "wg-missile-trail";
const LAYER_MISSILE = "wg-missile";
const LAYER_EXPLOSION = "wg-explosion";

function buildMissilesFC(missiles: Missile[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: missiles.map((m) => ({
      type: "Feature",
      properties: { id: m.id, attackerId: m.attackerId, interceptor: m.role === "interceptor" },
      geometry: { type: "Point", coordinates: [m.position.lng, m.position.lat] },
    })),
  };
}

function buildTrailsFC(missiles: Missile[], units: ReturnType<typeof scenarioStore.getState>["units"]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: missiles.map((m) => {
      // 拖尾從 attacker 當前位置（簡化）到 missile 當前位置
      const attacker = units[m.attackerId];
      const start = attacker
        ? [attacker.position.lng, attacker.position.lat]
        : m.targetPositionAtFire; // attacker 死了就用發射時的目標座標當起點
      return {
        type: "Feature",
        properties: { id: m.id, interceptor: m.role === "interceptor" },
        geometry: {
          type: "LineString",
          coordinates: [start, [m.position.lng, m.position.lat]],
        },
      };
    }),
  };
}

function buildExplosionsFC(explosions: Explosion[], simSec: number): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: explosions.map((e) => {
      const age = simSec - e.spawnedAtSimSec;
      const ageFrac = Math.min(1, Math.max(0, age / e.durationSec));
      // 爆炸環半徑：8 → 40 px 隨 age；opacity：1 → 0
      const radiusPx = 8 + ageFrac * 32;
      const opacity = 1 - ageFrac;
      return {
        type: "Feature",
        properties: {
          id: e.id,
          hit: e.hit,
          radiusPx,
          opacity,
        },
        geometry: { type: "Point", coordinates: e.position },
      };
    }),
  };
}

export function attachWargameCombatLayer(map: MapboxMap): () => void {
  // HMR cleanup
  for (const id of [LAYER_EXPLOSION, LAYER_MISSILE, LAYER_MISSILE_TRAIL]) {
    if (map.getLayer(id)) map.removeLayer(id);
  }
  for (const id of [SRC_EXPLOSIONS, SRC_MISSILES, SRC_MISSILE_TRAILS]) {
    if (map.getSource(id)) map.removeSource(id);
  }

  for (const id of [SRC_MISSILES, SRC_MISSILE_TRAILS, SRC_EXPLOSIONS]) {
    map.addSource(id, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  }

  // ── 飛彈拖尾（白橘漸層） ──
  map.addLayer({
    id: LAYER_MISSILE_TRAIL,
    type: "line",
    source: SRC_MISSILE_TRAILS,
    paint: {
      // 攔截彈青色 / 攻擊彈橘色
      "line-color": ["case", ["get", "interceptor"], "#7dd3fc", "#fed7aa"],
      "line-width": 1.5,
      "line-opacity": 0.7,
    },
  });

  // ── 飛彈光點（攔截彈青 / 攻擊彈橘） ──
  map.addLayer({
    id: LAYER_MISSILE,
    type: "circle",
    source: SRC_MISSILES,
    paint: {
      "circle-color": ["case", ["get", "interceptor"], "#38bdf8", "#fb923c"],
      "circle-radius": 4,
      "circle-stroke-color": ["case", ["get", "interceptor"], "#e0f2fe", "#fff7ed"],
      "circle-stroke-width": 1.5,
      "circle-blur": 0.3,
    },
  });

  // ── 爆炸環（hit=橘黃；miss=灰） ──
  map.addLayer({
    id: LAYER_EXPLOSION,
    type: "circle",
    source: SRC_EXPLOSIONS,
    paint: {
      "circle-color": [
        "case",
        ["==", ["get", "hit"], true],
        "#facc15",
        "#94a3b8",
      ],
      "circle-radius": ["get", "radiusPx"],
      "circle-opacity": ["*", 0.35, ["get", "opacity"]],
      "circle-stroke-color": [
        "case",
        ["==", ["get", "hit"], true],
        "#fde047",
        "#cbd5e1",
      ],
      "circle-stroke-width": 2,
      "circle-stroke-opacity": ["get", "opacity"],
      "circle-blur": 0.2,
    },
  });

  const refresh = () => {
    const state = scenarioStore.getState();
    const simSec = wargameClock.getSimTime();

    const missilesSrc = map.getSource(SRC_MISSILES) as mapboxgl.GeoJSONSource | undefined;
    const trailsSrc = map.getSource(SRC_MISSILE_TRAILS) as mapboxgl.GeoJSONSource | undefined;
    const expSrc = map.getSource(SRC_EXPLOSIONS) as mapboxgl.GeoJSONSource | undefined;

    if (missilesSrc) missilesSrc.setData(buildMissilesFC(state.missiles));
    if (trailsSrc) trailsSrc.setData(buildTrailsFC(state.missiles, state.units));
    if (expSrc) expSrc.setData(buildExplosionsFC(state.explosions, simSec));
  };

  refresh();
  // 飛彈位置每 tick 變化 → 訂閱 scenarioStore；
  // 爆炸 radius/opacity 依時間衰減 → 加 RAF 確保平滑
  const unsubScenario = scenarioStore.subscribe(refresh);
  let raf = 0;
  const loop = () => { refresh(); raf = requestAnimationFrame(loop); };
  raf = requestAnimationFrame(loop);

  return () => {
    cancelAnimationFrame(raf);
    unsubScenario();
    for (const id of [LAYER_EXPLOSION, LAYER_MISSILE, LAYER_MISSILE_TRAIL]) {
      if (map.getLayer(id)) map.removeLayer(id);
    }
    for (const id of [SRC_EXPLOSIONS, SRC_MISSILES, SRC_MISSILE_TRAILS]) {
      if (map.getSource(id)) map.removeSource(id);
    }
  };
}
