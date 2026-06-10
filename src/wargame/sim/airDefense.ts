/**
 * 分層防空（B8）— 攔截彈發射規劃。
 *
 * 對每個來襲的「攻擊飛彈」，找出守方（與被攻擊單位同陣營）具備攔截能力、
 * 剖面可攔、在攔截範圍內、冷卻已過、且仍有彈藥的單位 → 發射一枚追擊式攔截彈。
 *
 * 分層自然形成：飛彈逼近過程中會先後進入長程 SAM（愛國者）→ 中程 SAM →
 * 艦載點防禦的接戰範圍；海面掠飛（sea_skim）剖面只有低空 / 點防禦攔得到，
 * 高空巡弋會被各層 SAM 接戰。
 *
 * 攔截彈消耗單位 ammoCurrent（與攻擊共用彈艙）；發射受 cooldownSec 節流。
 * 純函式：不改 state，只回傳要新增的攔截彈 + 守方單位 patch + 事件。
 */
import type {
  EngagementEvent, InterceptorCapability, Missile, Unit, UnitId,
} from "../types";
import { UNIT_CATALOG } from "../catalog/units";
import { haversineKm } from "./geo";

/** 取單位有效攔截能力：per-unit 覆寫 > catalog 預設 */
export function interceptorCapOf(u: Unit): InterceptorCapability | undefined {
  return u.interceptor ?? UNIT_CATALOG[u.kind].defaultInterceptor;
}

export interface InterceptPlan {
  interceptors: Missile[];
  /** 已扣彈 + 更新冷卻計時的守方單位 */
  unitPatches: Record<UnitId, Unit>;
  events: EngagementEvent[];
}

export function planInterceptors(
  units: Record<UnitId, Unit>,
  missiles: Missile[],
  simSec: number,
): InterceptPlan {
  const interceptors: Missile[] = [];
  const unitPatches: Record<UnitId, Unit> = {};
  const events: EngagementEvent[] = [];

  const threats = missiles.filter((m) => (m.role ?? "attack") === "attack");
  if (threats.length === 0) return { interceptors, unitPatches, events };

  // 已被某守方鎖定的 (defenderId|threatId) — 避免同一守方對同一來襲彈重複發射
  const engaged = new Set<string>();
  for (const m of missiles) {
    if (m.role === "interceptor" && m.interceptTargetMissileId) {
      engaged.add(`${m.attackerId}|${m.interceptTargetMissileId}`);
    }
  }

  for (const d of Object.values(units)) {
    if (d.hpCurrent <= 0) continue;
    const cap = interceptorCapOf(d);
    if (!cap) continue;
    if (d.lastInterceptSimSec != null && simSec - d.lastInterceptSimSec < cap.cooldownSec) continue;
    const base = unitPatches[d.id] ?? d;
    if (base.ammoCurrent <= 0) continue;

    // 找最近、剖面可攔、範圍內、且尚未被自己鎖定、且打向我方的來襲彈
    let best: { threat: Missile; dist: number } | null = null;
    for (const t of threats) {
      const tgt = units[t.targetId];
      if (!tgt || tgt.sideId !== d.sideId) continue;        // 只保衛同陣營
      const prof = t.profile ?? "cruise";
      if (!cap.profiles.includes(prof)) continue;
      if (engaged.has(`${d.id}|${t.id}`)) continue;
      const dist = haversineKm(
        [d.position.lng, d.position.lat],
        [t.position.lng, t.position.lat],
      );
      if (dist > cap.rangeKm) continue;
      if (!best || dist < best.dist) best = { threat: t, dist };
    }
    if (!best) continue;

    const t = best.threat;
    interceptors.push({
      id: `int-${simSec.toFixed(1)}-${d.id}-${t.id}`,
      attackerId: d.id,
      targetId: t.targetId,                  // 名義目標（實際每 tick 追擊 t.position）
      position: { lng: d.position.lng, lat: d.position.lat },
      targetPositionAtFire: [t.position.lng, t.position.lat],
      speedKnots: cap.speedKnots,
      damage: 0,
      spawnedAtSimSec: simSec,
      distanceTravelledKm: 0,
      role: "interceptor",
      interceptTargetMissileId: t.id,
      interceptPKill: cap.pKill,
    });
    engaged.add(`${d.id}|${t.id}`);
    unitPatches[d.id] = {
      ...base,
      ammoCurrent: Math.max(0, base.ammoCurrent - 1),
      lastInterceptSimSec: simSec,
    };
    events.push({
      id: `evt-${simSec}-int-launch-${d.id}-${t.id}`,
      simAtSec: simSec,
      kind: "intercept",
      attackerId: d.id,
      position: [d.position.lng, d.position.lat],
      message: `${d.callsign} 發射攔截彈（剩彈 ${unitPatches[d.id]!.ammoCurrent}）`,
    });
  }

  return { interceptors, unitPatches, events };
}
