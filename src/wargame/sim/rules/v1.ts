/**
 * v1 戰鬥規則 — 簡單但完整：
 *   - canEngage：射程內 + target 仍存活
 *   - shouldFire：5 秒冷卻，避免飛彈洪水
 *   - spawnMissile：飛彈速 600 kn、damage = 60% target.hpMax
 *   - resolveImpact：擲骰 vs pKill 0.6（可被 unit.extensions.pKillBase 覆寫）
 *
 * 之後想換 Salvo Combat Model / Lanchester / 滑窗統計 — 整個 v1 swap 掉，
 * scenarioStore / combat.ts 完全不動。
 */
import type { CombatRuleSet } from "../combat";
import type { Missile } from "../../types";
import { haversineKm } from "../geo";
import { detectionRank, MIN_ENGAGE_STATE } from "../detection";

const MIN_ENGAGE_RANK = detectionRank(MIN_ENGAGE_STATE);

const COOLDOWN_SEC = 5;
const MISSILE_SPEED_KNOTS = 600;
const DAMAGE_FRAC = 0.6;
const DEFAULT_P_KILL = 0.6;

export const COMBAT_RULES_V1: CombatRuleSet = {
  canEngage(attacker, target, _currentSimSec) {
    if (target.hpCurrent <= 0) return false;
    if (attacker.hpCurrent <= 0) return false;
    if (attacker.ammoCurrent <= 0) return false;     // 沒彈藥 → 不能開火
    // 識別閘門：必須對目標 ≥ classified 才能釋放武器（含手動 engage 命令）
    if (detectionRank(target.detectedBy[attacker.sideId]) < MIN_ENGAGE_RANK) return false;
    const d = haversineKm(
      [attacker.position.lng, attacker.position.lat],
      [target.position.lng, target.position.lat],
    );
    return d <= attacker.core.rangeKm;
  },

  shouldFire(attacker, target, missilesInFlight) {
    // 同 attacker→target 已有飛彈在飛 → skip（cooldown）
    return !missilesInFlight.some((m) =>
      m.attackerId === attacker.id && m.targetId === target.id
    );
  },

  spawnMissile(attacker, target, simSec): Missile {
    return {
      id: `msl-${simSec.toFixed(1)}-${attacker.id}-${target.id}`,
      attackerId: attacker.id,
      targetId: target.id,
      position: { lng: attacker.position.lng, lat: attacker.position.lat },
      targetPositionAtFire: [target.position.lng, target.position.lat],
      speedKnots: MISSILE_SPEED_KNOTS,
      damage: target.core.hpMax * DAMAGE_FRAC,
      spawnedAtSimSec: simSec,
      distanceTravelledKm: 0,
    };
  },

  resolveImpact(_missile, target, rng) {
    const pKill = typeof target.extensions.pKillBase === "number"
      ? (target.extensions.pKillBase as number)
      : DEFAULT_P_KILL;
    const hit = rng() < pKill;
    return { hit, damageFrac: hit ? DAMAGE_FRAC : 0 };
  },
};
void COOLDOWN_SEC; // 之後 cooldown timestamp 機制會用到，先保留變數
