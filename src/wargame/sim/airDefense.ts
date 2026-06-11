/**
 * 分層防空（B8）— 攔截彈發射規劃（B6 後改由武器掛載驅動）。
 *
 * 守方單位（與被攻擊單位同陣營）凡掛載「具攔截能力的武器」（spec.interceptProfiles 非空，
 * 如艦載 SAM / CIWS / 愛國者），即可對來襲攻擊彈發射追擊式攔截彈。
 * 一艘艦的 SAM（遠）與 CIWS（近）為不同武器、不同彈艙，可同 tick 各射一發 → 天然分層。
 *
 * 攔截彈消耗該武器自己的彈艙（與反艦飛彈分離）；發射受該武器 cooldownSec 節流。
 * 純函式：不改 state，只回傳要新增的攔截彈 + 守方單位 patch + 事件。
 */
import type { EngagementEvent, Missile, Unit, UnitId } from "../types";
import { haversineKm } from "./geo";
import { loadoutOf, consumeAmmo } from "../catalog/weapons";

export interface InterceptPlan {
  interceptors: Missile[];
  /** 已扣彈的守方單位 */
  unitPatches: Record<UnitId, Unit>;
  events: EngagementEvent[];
}

export function planInterceptors(
  units: Record<UnitId, Unit>,
  missiles: Missile[],
  simSec: number,
): InterceptPlan {
  const interceptors: Missile[] = [];
  const events: EngagementEvent[] = [];
  const working: Record<UnitId, Unit> = {};   // 累積扣彈後的守方

  const threats = missiles.filter((m) => (m.role ?? "attack") === "attack");
  if (threats.length === 0) return { interceptors, unitPatches: {}, events };

  for (const d0 of Object.values(units)) {
    if (d0.hpCurrent <= 0) continue;
    let d = working[d0.id] ?? d0;

    for (const lw of loadoutOf(d)) {
      const profiles = lw.spec.interceptProfiles;
      if (!profiles || profiles.length === 0) continue;          // 非攔截武器
      if (lw.mag.ammoCurrent <= 0) continue;
      if (lw.spec.cooldownSec && lw.mag.lastFireSimSec != null &&
          simSec - lw.mag.lastFireSimSec < lw.spec.cooldownSec) continue;

      // 找最近、剖面可攔、範圍內、打向我方的來襲彈
      let best: { threat: Missile; dist: number } | null = null;
      for (const t of threats) {
        const tgt = units[t.targetId];
        if (!tgt || tgt.sideId !== d.sideId) continue;            // 只保衛同陣營
        if (!profiles.includes(t.profile ?? "cruise")) continue;
        const dist = haversineKm(
          [d.position.lng, d.position.lat],
          [t.position.lng, t.position.lat],
        );
        if (dist > lw.rangeKm) continue;
        if (!best || dist < best.dist) best = { threat: t, dist };
      }
      if (!best) continue;

      const t = best.threat;
      interceptors.push({
        id: `int-${simSec.toFixed(1)}-${d.id}-${lw.mag.weaponId}-${t.id}`,
        attackerId: d.id,
        targetId: t.targetId,
        position: { lng: d.position.lng, lat: d.position.lat },
        targetPositionAtFire: [t.position.lng, t.position.lat],
        speedKnots: lw.spec.speedKnots ?? 2400,
        damage: 0,
        spawnedAtSimSec: simSec,
        distanceTravelledKm: 0,
        role: "interceptor",
        interceptTargetMissileId: t.id,
        interceptPKill: lw.spec.pKill,
      });
      d = consumeAmmo(d, lw.mag.weaponId, simSec);   // 扣此武器彈艙
      working[d0.id] = d;
      events.push({
        id: `evt-${simSec}-int-${d.id}-${lw.mag.weaponId}-${t.id}`,
        simAtSec: simSec,
        kind: "intercept",
        attackerId: d.id,
        position: [d.position.lng, d.position.lat],
        message: `${d.callsign} 發射${lw.spec.name}攔截來襲飛彈`,
      });
    }
  }

  return { interceptors, unitPatches: working, events };
}
