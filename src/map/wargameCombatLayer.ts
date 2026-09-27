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
const LAYER_EXPLOSION_FLASH = "wg-explosion-flash";

const KIND_COLOR = ["match", ["get", "kind"], "interceptor", "#38bdf8", "torpedo", "#2dd4bf", "shell", "#fde047", "#fb923c"] as unknown as mapboxgl.Expression;

/** 彈種：決定光點顏色 / 大小與拖尾長度 */
type ProjectileKind = "interceptor" | "torpedo" | "shell" | "missile";

function projectileKind(m: Missile): ProjectileKind {
  if (m.role === "interceptor") return "interceptor";
  if (m.weaponId === "torpedo") return "torpedo";
  if (m.weaponId === "gun") return "shell";
  return "missile";
}

/** 拖尾最大長度（km）— 砲彈短促、飛彈長 */
const TAIL_KM: Record<ProjectileKind, number> = { interceptor: 4, torpedo: 2.5, shell: 1.5, missile: 6 };
const TAIL_SEGMENTS = 4;

function buildMissilesFC(missiles: Missile[]): GeoJSON.FeatureCollection {
  return {
    type: "FeatureCollection",
    features: missiles.map((m) => ({
      type: "Feature",
      properties: { id: m.id, attackerId: m.attackerId, kind: projectileKind(m) },
      geometry: { type: "Point", coordinates: [m.position.lng, m.position.lat] },
    })),
  };
}

/**
 * 彗星式拖尾：沿「目標 → 彈體」反方向往後拉一小段，切成數節、越後越淡。
 * 不再從發射者畫線 → 不會因發射者移動而歪掉，也不會洩漏隱匿發射者（潛艦）的位置。
 */
function buildTrailsFC(missiles: Missile[], missilesById: Map<string, Missile>): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [];
  for (const m of missiles) {
    const kind = projectileKind(m);
    // 攔截彈追的是來襲彈當前位置；其餘飛向開火時的目標座標
    const threat = m.interceptTargetMissileId ? missilesById.get(m.interceptTargetMissileId) : undefined;
    const aim: [number, number] = threat ? [threat.position.lng, threat.position.lat] : m.targetPositionAtFire;
    const cosLat = Math.cos((m.position.lat * Math.PI) / 180);
    const dx = (m.position.lng - aim[0]) * cosLat;
    const dy = m.position.lat - aim[1];
    const len = Math.hypot(dx, dy);
    if (len < 1e-9) continue;
    const tailKm = Math.min(m.distanceTravelledKm, TAIL_KM[kind]);
    if (tailKm <= 0) continue;
    const tailDeg = tailKm / 111.32;
    const at = (f: number): [number, number] => [
      m.position.lng + (dx / len) * tailDeg * f / cosLat,
      m.position.lat + (dy / len) * tailDeg * f,
    ];
    for (let i = 0; i < TAIL_SEGMENTS; i++) {
      features.push({
        type: "Feature",
        properties: { kind, fade: 1 - i / TAIL_SEGMENTS },
        geometry: { type: "LineString", coordinates: [at(i / TAIL_SEGMENTS), at((i + 1) / TAIL_SEGMENTS)] },
      });
    }
  }
  return { type: "FeatureCollection", features };
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
          // 命中瞬間的白熱閃光：前 30% 壽命內快速縮小淡出
          flashPx: e.hit && ageFrac < 0.3 ? 12 * (1 - ageFrac / 0.3) + 3 : 0,
          flashOpacity: e.hit && ageFrac < 0.3 ? 1 - ageFrac / 0.3 : 0,
        },
        geometry: { type: "Point", coordinates: e.position },
      };
    }),
  };
}

export function attachWargameCombatLayer(map: MapboxMap): () => void {
  // HMR cleanup
  for (const id of [LAYER_EXPLOSION_FLASH, LAYER_EXPLOSION, LAYER_MISSILE, LAYER_MISSILE_TRAIL]) {
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
    layout: { "line-cap": "round" },
    paint: {
      "line-color": KIND_COLOR,
      "line-width": ["+", 0.8, ["*", 1.8, ["get", "fade"]]],
      "line-opacity": ["*", 0.85, ["get", "fade"]],
      "line-blur": 0.5,
    },
  });

  // ── 彈體光點（攔截彈青 / 魚雷藍綠 / 砲彈黃 / 飛彈橘） ──
  map.addLayer({
    id: LAYER_MISSILE,
    type: "circle",
    source: SRC_MISSILES,
    paint: {
      "circle-color": KIND_COLOR,
      "circle-radius": ["match", ["get", "kind"], "shell", 2.5, "torpedo", 3, 4],
      "circle-stroke-color": "#fff7ed",
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

  // ── 命中閃光（白熱核心，蓋在爆炸環上） ──
  map.addLayer({
    id: LAYER_EXPLOSION_FLASH,
    type: "circle",
    source: SRC_EXPLOSIONS,
    filter: ["==", ["get", "hit"], true],
    paint: {
      "circle-color": "#fffbeb",
      "circle-radius": ["get", "flashPx"],
      "circle-opacity": ["get", "flashOpacity"],
      "circle-blur": 0.6,
    },
  });

  const refresh = () => {
    const state = scenarioStore.getState();
    const simSec = wargameClock.getSimTime();

    const missilesSrc = map.getSource(SRC_MISSILES) as mapboxgl.GeoJSONSource | undefined;
    const trailsSrc = map.getSource(SRC_MISSILE_TRAILS) as mapboxgl.GeoJSONSource | undefined;
    const expSrc = map.getSource(SRC_EXPLOSIONS) as mapboxgl.GeoJSONSource | undefined;

    if (missilesSrc) missilesSrc.setData(buildMissilesFC(state.missiles));
    if (trailsSrc) trailsSrc.setData(buildTrailsFC(state.missiles, new Map(state.missiles.map((m) => [m.id, m]))));
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
    for (const id of [LAYER_EXPLOSION_FLASH, LAYER_EXPLOSION, LAYER_MISSILE, LAYER_MISSILE_TRAIL]) {
      if (map.getLayer(id)) map.removeLayer(id);
    }
    for (const id of [SRC_EXPLOSIONS, SRC_MISSILES, SRC_MISSILE_TRAILS]) {
      if (map.getSource(id)) map.removeSource(id);
    }
  };
}
