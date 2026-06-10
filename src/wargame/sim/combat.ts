/**
 * 戰鬥流程（Phase 5 MVP）。
 *
 * Pipeline 每 tick：
 *   1. 自動鎖定：對所有「沒設 engagingTargetId」的單位，掃描偵測範圍內最近的敵方 → 設為目標
 *   2. 開火判定：對所有 engagingTargetId 有設的單位，若 canEngage（射程 + 仍有目標）→ 產生 Missile
 *      （冷卻：同一 attacker→target 配對若已有飛彈在飛 → skip）
 *   3. 飛彈推進：所有 missile 朝 targetPositionAtFire 前進
 *   4. 命中判定：抵達目標座標 → resolveImpact → hit/miss → emit event + apply damage
 *   5. 銷毀：hpCurrent ≤ 0 → emit destroyed + 從 units 移除
 *   6. 爆炸特效清理：超過 durationSec 的 explosion 移除
 *
 * 採用 CombatRuleSet 抽象，v1 規則在 rules/v1.ts；之後想換 sophisticated 模型（Salvo Combat）
 * 直接 swap ruleSet 即可。
 */
import type {
  EngagementEvent, Explosion, LngLat, Missile, RoeMode, SideId, SimulationState, Unit, UnitId, Wreck,
} from "../types";
import { advanceTowardKm, haversineKm, knotsToKmPerSec } from "./geo";
import { makeRng, seedFromStrings } from "./rng";
import { detectionRank, MIN_ENGAGE_STATE } from "./detection";
import { planInterceptors } from "./airDefense";

const MIN_ENGAGE_RANK = detectionRank(MIN_ENGAGE_STATE);

/** 有效 ROE：unit 覆寫 > side 預設 > weapons_free */
function effectiveRoe(unitRoe: RoeMode | undefined, sideRoe: RoeMode | undefined): RoeMode {
  return unitRoe ?? sideRoe ?? "weapons_free";
}

/** defensive_only 用：該敵方是否正對我方任一單位發射飛彈 */
function isShootingAtSide(
  hostile: Unit, mySideId: SideId, missiles: Missile[], units: Record<UnitId, Unit>,
): boolean {
  return missiles.some((m) =>
    m.attackerId === hostile.id && units[m.targetId]?.sideId === mySideId
  );
}

const MISSILE_ARRIVE_THRESHOLD_KM = 1.0;
const EXPLOSION_DURATION_SEC = 6;
const WRECK_DURATION_SEC = 30;       // 殘骸停留 30 sim-sec
const AUTO_ENGAGE = true;            // Phase 5 預設自動鎖敵；之後可加 toggle

// ── CombatRuleSet 抽象 ───────────────────────────────────
export interface CombatRuleSet {
  canEngage(attacker: Unit, target: Unit, currentSimSec: number): boolean;
  shouldFire(attacker: Unit, target: Unit, missilesInFlight: Missile[]): boolean;
  spawnMissile(attacker: Unit, target: Unit, simSec: number): Missile;
  resolveImpact(
    missile: Missile, target: Unit, rng: () => number,
  ): { hit: boolean; damageFrac: number };
}

// ── 主入口（engine 呼叫） ───────────────────────────────
export function runCombat(
  state: SimulationState,
  ruleSet: CombatRuleSet,
  dtSec: number,
): SimulationState {
  let units = state.units;
  let missiles = state.missiles;
  let explosions = state.explosions;
  let wreckages = state.wreckages;
  const events: EngagementEvent[] = [];
  const simSec = state.simTimeSec;

  // ── 1. 自動鎖定（受 ROE 約束）──
  if (AUTO_ENGAGE) {
    const sideMap = new Map(state.scenario.sides.map((s) => [s.id, s]));
    for (const u of Object.values(units)) {
      if (u.engagingTargetId) continue;
      const mySide = sideMap.get(u.sideId);
      if (!mySide) continue;
      const hostiles = mySide.isHostileTo;
      if (hostiles.length === 0) continue;
      const roe = effectiveRoe(u.roe, mySide.roe);
      if (roe === "weapons_hold") continue;   // 不主動接戰，只接受明確 engage 命令
      // 找最近、符合 ROE + 已分類（≥ classified）+ 在射程內的敵方
      let best: { id: UnitId; dist: number } | null = null;
      for (const o of Object.values(units)) {
        if (!hostiles.includes(o.sideId)) continue;
        if (o.hpCurrent <= 0) continue;
        const det = o.detectedBy[u.sideId];
        if (detectionRank(det) < MIN_ENGAGE_RANK) continue;   // 未分類不可主動接戰
        if (roe === "weapons_tight" && det !== "tracked") continue;
        if (roe === "defensive_only" && !isShootingAtSide(o, u.sideId, missiles, units)) continue;
        const d = haversineKm([u.position.lng, u.position.lat], [o.position.lng, o.position.lat]);
        if (d > u.core.rangeKm) continue;
        if (!best || d < best.dist) best = { id: o.id, dist: d };
      }
      if (best) {
        units = { ...units, [u.id]: { ...u, engagingTargetId: best.id } };
      }
    }
  }

  // ── 2. 開火判定 ──
  for (const u of Object.values(units)) {
    if (!u.engagingTargetId) continue;
    if (u.hpCurrent <= 0) continue;
    const target = units[u.engagingTargetId];
    if (!target || target.hpCurrent <= 0) {
      // 目標消失 → 清掉鎖定
      units = { ...units, [u.id]: { ...u, engagingTargetId: undefined } };
      continue;
    }
    if (!ruleSet.canEngage(u, target, simSec)) continue;
    if (!ruleSet.shouldFire(u, target, missiles)) continue;
    const m = ruleSet.spawnMissile(u, target, simSec);
    missiles = [...missiles, m];
    // 扣 1 彈藥
    units = { ...units, [u.id]: { ...u, ammoCurrent: Math.max(0, u.ammoCurrent - 1) } };
    events.push({
      id: `evt-${simSec}-${u.id}-${target.id}-fire`,
      simAtSec: simSec,
      kind: "weapon_release",
      attackerId: u.id,
      targetId: target.id,
      position: [u.position.lng, u.position.lat],
      message: `${u.callsign} → ${target.callsign} 開火（剩彈 ${u.ammoCurrent - 1}/${u.ammoMax}）`,
    });
  }

  // ── 2.5 分層防空：守方發射攔截彈 ──
  {
    const plan = planInterceptors(units, missiles, simSec);
    if (plan.interceptors.length > 0) {
      missiles = [...missiles, ...plan.interceptors];
      for (const [uid, patched] of Object.entries(plan.unitPatches)) {
        units = { ...units, [uid]: patched };
      }
      for (const e of plan.events) events.push(e);
    }
  }

  // ── 3. 飛彈推進 ──
  const nextMissiles: Missile[] = [];

  // 3a. 攔截彈先推進並判定 — 攔截成功的來襲彈記入 destroyedThreatIds，
  //     稍後攻擊彈推進時跳過（攔截在抵達前發生 → 取消命中）
  const destroyedThreatIds = new Set<string>();
  const attackById = new Map<string, Missile>();
  for (const m of missiles) {
    if ((m.role ?? "attack") === "attack") attackById.set(m.id, m);
  }
  for (const mi of missiles) {
    if (mi.role !== "interceptor") continue;
    const threatId = mi.interceptTargetMissileId;
    const threat = threatId ? attackById.get(threatId) : undefined;
    // 來襲彈已不存在（已被攔 / 已命中 / 已被其他攔截彈摧毀）→ 攔截彈失效消失
    if (!threat || (threatId && destroyedThreatIds.has(threatId))) continue;

    const stepKm = knotsToKmPerSec(mi.speedKnots) * dtSec;
    const from: LngLat = [mi.position.lng, mi.position.lat];
    const aim: LngLat = [threat.position.lng, threat.position.lat];
    const dist = haversineKm(from, aim);

    if (dist <= MISSILE_ARRIVE_THRESHOLD_KM || stepKm >= dist) {
      // 抵達 → 擲骰判定攔截
      const rng = makeRng(seedFromStrings(mi.id, simSec));
      const success = rng() < (mi.interceptPKill ?? 0.5);
      explosions = [...explosions, {
        id: `exp-${mi.id}`,
        position: aim,
        spawnedAtSimSec: simSec,
        durationSec: EXPLOSION_DURATION_SEC,
        hit: success,
      }];
      if (success) {
        destroyedThreatIds.add(threat.id);
        events.push({
          id: `evt-${simSec}-${mi.id}-kill`,
          simAtSec: simSec,
          kind: "intercept",
          attackerId: mi.attackerId,
          targetId: threat.attackerId,
          position: aim,
          message: `攔截成功 — 擊落來襲飛彈`,
        });
      } else {
        events.push({
          id: `evt-${simSec}-${mi.id}-leak`,
          simAtSec: simSec,
          kind: "miss",
          attackerId: mi.attackerId,
          position: aim,
          message: `攔截失敗 — 飛彈漏防`,
        });
      }
      continue;   // 攔截彈用畢消失
    }

    // 續飛：每 tick 重新導引到來襲彈當前位置
    const [nlng, nlat] = advanceTowardKm(from, aim, stepKm);
    nextMissiles.push({
      ...mi,
      position: { lng: nlng, lat: nlat },
      targetPositionAtFire: aim,
      distanceTravelledKm: mi.distanceTravelledKm + stepKm,
    });
  }

  // 3b. 攻擊彈推進（被攔截的跳過 → 不結算命中）
  for (const m of missiles) {
    if ((m.role ?? "attack") !== "attack") continue;
    if (destroyedThreatIds.has(m.id)) continue;
    const stepKm = knotsToKmPerSec(m.speedKnots) * dtSec;
    const from: LngLat = [m.position.lng, m.position.lat];
    const distToTarget = haversineKm(from, m.targetPositionAtFire);

    if (distToTarget <= MISSILE_ARRIVE_THRESHOLD_KM || stepKm >= distToTarget) {
      // 抵達 → 解算
      const target = units[m.targetId];
      if (target && target.hpCurrent > 0) {
        const rng = makeRng(seedFromStrings(m.id, simSec));
        const outcome = ruleSet.resolveImpact(m, target, rng);
        if (outcome.hit) {
          const dmg = Math.round(outcome.damageFrac * target.core.hpMax);
          const newHp = Math.max(0, target.hpCurrent - dmg);
          const damaged: Unit = { ...target, hpCurrent: newHp };
          units = { ...units, [target.id]: damaged };
          events.push({
            id: `evt-${simSec}-${m.id}-hit`,
            simAtSec: simSec,
            kind: "hit",
            attackerId: m.attackerId,
            targetId: target.id,
            position: m.targetPositionAtFire,
            message: `${target.callsign} 被命中 −${dmg} hp（剩 ${newHp}）`,
          });
          if (newHp <= 0) {
            events.push({
              id: `evt-${simSec}-${target.id}-killed`,
              simAtSec: simSec,
              kind: "destroyed",
              attackerId: m.attackerId,
              targetId: target.id,
              targetSideId: target.sideId,
              position: [target.position.lng, target.position.lat],
              message: `${target.callsign} 被擊毀`,
            });
            // 推進殘骸（會渲染為 ✗ marker、30 秒後消失）
            wreckages = [...wreckages, {
              id: `wreck-${target.id}-${simSec}`,
              position: [target.position.lng, target.position.lat],
              sideId: target.sideId,
              kind: target.kind,
              callsign: target.callsign,
              destroyedAtSimSec: simSec,
              durationSec: WRECK_DURATION_SEC,
            } as Wreck];
            // 移除 unit
            const { [target.id]: _removed, ...rest } = units;
            void _removed;
            units = rest;
          }
        } else {
          events.push({
            id: `evt-${simSec}-${m.id}-miss`,
            simAtSec: simSec,
            kind: "miss",
            attackerId: m.attackerId,
            targetId: target.id,
            position: m.targetPositionAtFire,
            message: `${m.id} 落空`,
          });
        }
        explosions = [...explosions, mkExplosion(m, outcome.hit, simSec)];
      }
      // 飛彈無論 hit / miss 都不放回 nextMissiles
      continue;
    }

    // 還在飛
    const [nlng, nlat] = advanceTowardKm(from, m.targetPositionAtFire, stepKm);
    nextMissiles.push({
      ...m,
      position: { lng: nlng, lat: nlat },
      distanceTravelledKm: m.distanceTravelledKm + stepKm,
    });
  }

  // ── 4. 爆炸 + 殘骸清理 ──
  explosions = explosions.filter((e) => simSec - e.spawnedAtSimSec < e.durationSec);
  wreckages = wreckages.filter((w) => simSec - w.destroyedAtSimSec < w.durationSec);

  // ── 5. 順手清掉已死亡單位的 engagingTargetId 引用 ──
  for (const u of Object.values(units)) {
    if (u.engagingTargetId && !units[u.engagingTargetId]) {
      units = { ...units, [u.id]: { ...u, engagingTargetId: undefined } };
    }
  }

  if (events.length === 0 &&
      missiles === state.missiles &&
      explosions === state.explosions &&
      wreckages === state.wreckages &&
      units === state.units) {
    return state;
  }

  return {
    ...state,
    units,
    missiles: nextMissiles,
    explosions,
    wreckages,
    eventsThisTick: [...state.eventsThisTick, ...events],
    eventsAll: [...state.eventsAll, ...events],
  };
}

function mkExplosion(m: Missile, hit: boolean, simSec: number): Explosion {
  return {
    id: `exp-${m.id}`,
    position: m.targetPositionAtFire,
    spawnedAtSimSec: simSec,
    durationSec: EXPLOSION_DURATION_SEC,
    hit,
  };
}
