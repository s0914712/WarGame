/**
 * v1 戰鬥規則 — B6 後僅保留命中判定（resolveImpact）。
 *
 * 武器選擇 / 開火 / 飛彈剖面與速度已移到 combat.ts（依 catalog/weapons 掛載）。
 * pKill 與 damageFrac 由發射武器寫入 Missile，這裡直接讀。
 *
 * 之後想換 Salvo Combat Model / Lanchester — 換掉此 resolveImpact 即可。
 */
import type { CombatRuleSet } from "../combat";

const DAMAGE_FRAC = 0.6;
const DEFAULT_P_KILL = 0.6;

export const COMBAT_RULES_V1: CombatRuleSet = {
  resolveImpact(missile, target, rng) {
    const pKill = typeof missile.pKill === "number"
      ? missile.pKill
      : (typeof target.extensions.pKillBase === "number"
          ? (target.extensions.pKillBase as number)
          : DEFAULT_P_KILL);
    const hit = rng() < pKill;
    const damageFrac = typeof missile.damageFrac === "number" ? missile.damageFrac : DAMAGE_FRAC;
    return { hit, damageFrac: hit ? damageFrac : 0 };
  },
};
