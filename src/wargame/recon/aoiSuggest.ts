/**
 * 依攻擊優序自動推估關注區（AOI）—— 「高優先目標可能在哪、會往哪走」。
 *
 * 只用本方可得的資訊（不偷看迷霧）：
 *   1. 接觸群：本方已偵測到（≥ unknown）的高優先類別敵方，依 40 km 聚類，
 *      用各自航向航速推算 1 小時後位置，取外包並加緩衝 → 「現在在哪、往哪去」
 *   2. 敵方目標區：場景勝利條件（簡報公開資訊）中敵方的 hold_area（如登陸區）
 *      與 destroy_unit（敵方要打我方哪個單位）→ 「最後會到哪」
 *   3. 航經走廊：接觸群 → 最可能前往的敵方目標區（requireKinds 相符者優先）的帶狀區
 *
 * 分數 = 類別優序分數加權；無攻擊優序時所有類別視為 3 分、全部列入。
 * 每個多邊形 ≤ 10 個頂點（可直接設為搜索區 / 關注區）。純函式。
 */
import type { LngLat, Scenario, SideId, Unit, UnitKind } from "../types";
import { haversineKm } from "../sim/geo";
import { CATEGORY_OF, DEFAULT_WEIGHT, weightOf, type TargetCategory, type TargetPriorityProfile } from "../sim/targetPriority";

const KM_PER_DEG_LAT = 111.32;
const KMH_PER_KN = 1.852;
const MAX_VERTICES = 10;

export type AoiSource = "contacts" | "objective" | "corridor" | "protect";

export interface AoiSuggestion {
  id: string;
  source: AoiSource;
  /** 中 / 英說明 */
  labelZh: string;
  labelEn: string;
  polygon: LngLat[];
  score: number;
  /** 牽涉的目標類別 */
  categories: TargetCategory[];
}

export interface AoiSuggestOptions {
  /** 接觸推算時距（hr） */
  projectHr?: number;
  /** 高優先門檻（有攻擊優序時） */
  minWeight?: number;
  /** 接觸聚類距離（km） */
  clusterKm?: number;
  /** 最多回傳幾個 */
  limit?: number;
}

const CAT_ZH: Record<TargetCategory, string> = {
  amphibious: "登陸艦", air_defense: "防空", sensor: "雷達", base_logistics: "基地 / 後勤",
  surface_combatant: "水面艦", submarine: "潛艦", aircraft: "戰機", uav: "無人機", missile_launcher: "飛彈車",
};
const CAT_EN: Record<TargetCategory, string> = {
  amphibious: "amphibious ships", air_defense: "air defence", sensor: "radars", base_logistics: "bases / logistics",
  surface_combatant: "surface combatants", submarine: "submarines", aircraft: "aircraft", uav: "UAVs", missile_launcher: "missile launchers",
};

// ── 幾何：局部平面（km）⇄ 經緯度 ─────────────────────────
function kx(lat: number) { return KM_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180); }
function offsetKm(p: LngLat, dxKm: number, dyKm: number): LngLat {
  return [p[0] + dxKm / kx(p[1]), p[1] + dyKm / KM_PER_DEG_LAT];
}

function hull(pts: LngLat[]): LngLat[] {
  if (pts.length < 3) return pts;
  const lat0 = pts.reduce((a, p) => a + p[1], 0) / pts.length;
  const k = kx(lat0);
  const P = [...pts].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const cross = (o: LngLat, a: LngLat, b: LngLat) =>
    (a[0] - o[0]) * k * (b[1] - o[1]) * KM_PER_DEG_LAT - (a[1] - o[1]) * KM_PER_DEG_LAT * (b[0] - o[0]) * k;
  const lower: LngLat[] = [];
  for (const p of P) { while (lower.length >= 2 && cross(lower[lower.length - 2]!, lower[lower.length - 1]!, p) <= 0) lower.pop(); lower.push(p); }
  const upper: LngLat[] = [];
  for (let i = P.length - 1; i >= 0; i--) { const p = P[i]!; while (upper.length >= 2 && cross(upper[upper.length - 2]!, upper[upper.length - 1]!, p) <= 0) upper.pop(); upper.push(p); }
  return [...lower.slice(0, -1), ...upper.slice(0, -1)];
}

/** 凸多邊形頂點過多 → 反覆移除「三角形面積最小」的頂點直到 ≤ max（形狀略縮、仍為凸） */
function simplify(poly: LngLat[], max = MAX_VERTICES): LngLat[] {
  const p = [...poly];
  const area = (a: LngLat, b: LngLat, c: LngLat) => Math.abs((b[0] - a[0]) * (c[1] - a[1]) - (c[0] - a[0]) * (b[1] - a[1]));
  while (p.length > max) {
    let best = 0, bestA = Infinity;
    for (let i = 0; i < p.length; i++) {
      const a = area(p[(i - 1 + p.length) % p.length]!, p[i]!, p[(i + 1) % p.length]!);
      if (a < bestA) { bestA = a; best = i; }
    }
    p.splice(best, 1);
  }
  return p;
}

/** 一組點的緩衝外包（每點八方向外擴 bufferKm 後取凸包），≤ 10 頂點 */
export function bufferedHull(points: LngLat[], bufferKm: number): LngLat[] {
  const ring: LngLat[] = [];
  for (const p of points) {
    for (let k = 0; k < 8; k++) {
      const a = (k * Math.PI) / 4;
      ring.push(offsetKm(p, Math.cos(a) * bufferKm, Math.sin(a) * bufferKm));
    }
  }
  return simplify(hull(ring));
}

/** 圓 → 正八邊形 */
function circle(center: LngLat, radiusKm: number): LngLat[] {
  return Array.from({ length: 8 }, (_, k) => {
    const a = (k * Math.PI) / 4;
    return offsetKm(center, Math.cos(a) * radiusKm, Math.sin(a) * radiusKm);
  });
}

/** 兩點之間寬 2·halfKm 的帶狀走廊（含兩端圓角近似 → 取緩衝外包） */
function corridor(a: LngLat, b: LngLat, halfKm: number): LngLat[] {
  return bufferedHull([a, b], halfKm);
}

function centroid(pts: LngLat[]): LngLat {
  return [pts.reduce((s, p) => s + p[0], 0) / pts.length, pts.reduce((s, p) => s + p[1], 0) / pts.length];
}

function deadReckon(u: Unit, hr: number): LngLat {
  const d = Math.max(0, u.position.speedKnots) * KMH_PER_KN * hr;
  const brg = (u.position.headingDeg * Math.PI) / 180;
  return offsetKm([u.position.lng, u.position.lat], Math.sin(brg) * d, Math.cos(brg) * d);
}

// ── 主函式 ───────────────────────────────────────────────
export function suggestAois(
  sideId: SideId, scenario: Scenario, units: Unit[], profile: TargetPriorityProfile | undefined,
  opts: AoiSuggestOptions = {},
): AoiSuggestion[] {
  const projectHr = opts.projectHr ?? 1;
  const minWeight = profile ? (opts.minWeight ?? 4) : 0;
  const clusterKm = opts.clusterKm ?? 40;
  const side = scenario.sides.find((s) => s.id === sideId);
  if (!side) return [];
  const hostile = side.isHostileTo;
  const w = (kind: UnitKind) => (profile ? weightOf(profile, kind) : DEFAULT_WEIGHT);
  const out: AoiSuggestion[] = [];

  // ── 1. 接觸群 ──
  const contacts = units.filter((u) => {
    if (!hostile.includes(u.sideId) || u.hpCurrent <= 0) return false;
    const st = u.detectedBy[sideId];
    return (st === "unknown" || st === "classified" || st === "tracked") && w(u.kind) >= Math.max(1, minWeight);
  });
  const clusters: Unit[][] = [];
  for (const c of contacts) {
    const pos: LngLat = [c.position.lng, c.position.lat];
    const home = clusters.find((cl) => cl.some((o) => haversineKm([o.position.lng, o.position.lat], pos) <= clusterKm));
    if (home) home.push(c); else clusters.push([c]);
  }
  const clusterInfo = clusters.map((cl, i) => {
    const now = cl.map((u) => [u.position.lng, u.position.lat] as LngLat);
    const later = cl.map((u) => deadReckon(u, projectHr));
    const maxTravel = Math.max(0, ...cl.map((u) => u.position.speedKnots * KMH_PER_KN * projectHr));
    const bufferKm = 15 + 0.3 * maxTravel;
    const cats = [...new Set(cl.map((u) => CATEGORY_OF[u.kind]))];
    const score = cl.reduce((s, u) => s + w(u.kind), 0);
    const counts = cats.map((c) => `${CAT_ZH[c]} ×${cl.filter((u) => CATEGORY_OF[u.kind] === c).length}`).join("、");
    const countsEn = cats.map((c) => `${cl.filter((u) => CATEGORY_OF[u.kind] === c).length}× ${CAT_EN[c]}`).join(", ");
    out.push({
      id: `contacts-${i}`, source: "contacts",
      labelZh: `接觸群：${counts}（含 ${projectHr} 小時推算航跡）`,
      labelEn: `Contact group: ${countsEn} (incl. ${projectHr} h dead-reckoning)`,
      polygon: bufferedHull([...now, ...later], bufferKm),
      score, categories: cats,
    });
    return { units: cl, center: centroid([...now, ...later]), cats, score, bufferKm };
  });

  // ── 2. 敵方目標區（勝利條件，公開資訊）──
  const objectives: { center: LngLat; kinds?: UnitKind[]; label: string }[] = [];
  scenario.victoryConditions.forEach((vc, i) => {
    if (vc.kind === "hold_area" && hostile.includes(vc.sideId)) {
      const kinds = vc.requireKinds;
      const cats = kinds ? [...new Set(kinds.map((k) => CATEGORY_OF[k]))] : [];
      const wt = kinds && kinds.length > 0 ? Math.max(...kinds.map(w)) : DEFAULT_WEIGHT;
      if (profile && wt < minWeight) return;
      objectives.push({ center: vc.centerLngLat, kinds, label: vc.label ?? "" });
      const what = cats.length > 0 ? cats.map((c) => CAT_ZH[c]).join("、") : "敵軍";
      const whatEn = cats.length > 0 ? cats.map((c) => CAT_EN[c]).join(", ") : "enemy forces";
      out.push({
        id: `objective-${i}`, source: "objective",
        labelZh: `敵方目標區${vc.label ? `「${vc.label}」` : ""}：${what}須抵達並停留`,
        labelEn: `Enemy objective${vc.label ? ` "${vc.label}"` : ""}: ${whatEn} must reach and hold`,
        polygon: circle(vc.centerLngLat, vc.radiusKm + 10),
        // 目標區是敵方「一定會去」的地方 → 分數加倍
        score: wt * 2, categories: cats,
      });
    }
    if (vc.kind === "destroy_unit" && hostile.includes(vc.sideId)) {
      const target = units.find((u) => u.id === vc.unitId && u.sideId === sideId);
      if (!target) return;
      out.push({
        id: `protect-${i}`, source: "protect",
        labelZh: `敵方打擊目標：我方 ${target.callsign} 周邊`,
        labelEn: `Enemy strike objective: around our ${target.callsign}`,
        polygon: circle([target.position.lng, target.position.lat], 60),
        score: DEFAULT_WEIGHT * 2, categories: [],
      });
    }
  });

  // ── 3. 航經走廊：接觸群 → 最可能的目標區 ──
  for (const [i, c] of clusterInfo.entries()) {
    if (objectives.length === 0) break;
    // 目標區要求的 kind 與接觸群相符者優先；其次取最近
    const scored = objectives.map((o) => {
      const match = o.kinds ? c.units.some((u) => o.kinds!.includes(u.kind)) : false;
      return { o, match, d: haversineKm(c.center, o.center) };
    }).sort((a, b) => Number(b.match) - Number(a.match) || a.d - b.d);
    const best = scored[0];
    if (!best || (!best.match && objectives.some((o) => o.kinds))) continue;   // 沒有相符的目標區就不硬猜
    out.push({
      id: `corridor-${i}`, source: "corridor",
      labelZh: `推估航經走廊：接觸群 → ${best.o.label || "敵方目標區"}（約 ${Math.round(best.d)} km）`,
      labelEn: `Likely transit corridor: contact group → ${best.o.label || "enemy objective"} (~${Math.round(best.d)} km)`,
      polygon: corridor(c.center, best.o.center, c.bufferKm + 10),
      score: c.score * 0.9, categories: c.cats,
    });
  }

  return out.sort((a, b) => b.score - a.score).slice(0, opts.limit ?? 6);
}
