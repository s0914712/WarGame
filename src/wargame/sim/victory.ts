/**
 * 勝負判定 — 純函式，每 tick 呼叫。
 *
 * 邏輯：
 *   - 已 outcome → 不重算
 *   - 逐條檢查 victoryConditions（順序代表優先序，先滿足者勝）
 *   - hold_area 需要計時：用 holdProgress map 持續追蹤
 *   - time_limit 在 simTime >= scenario.durationSec 時觸發，比兵力多寡
 */
import type { LngLat, Scenario, SideId, SimulationState, Unit, VictoryCondition } from "../types";
import { haversineKm } from "./geo";

export interface VictoryCheckResult {
  outcome: SimulationState["outcome"];
  holdProgress: SimulationState["holdProgress"];
}

export function checkVictory(
  scenario: Scenario,
  units: Record<string, Unit>,
  simTimeSec: number,
  prevHoldProgress: SimulationState["holdProgress"],
  prevOutcome: SimulationState["outcome"],
): VictoryCheckResult {
  // 已分勝負 → 不重算（避免覆寫）
  if (prevOutcome) {
    return { outcome: prevOutcome, holdProgress: prevHoldProgress };
  }

  const nextHold: SimulationState["holdProgress"] = { ...prevHoldProgress };

  for (let i = 0; i < scenario.victoryConditions.length; i++) {
    const cond = scenario.victoryConditions[i]!;
    const result = evaluate(cond, i, units, scenario, simTimeSec, nextHold);
    if (result) {
      return {
        outcome: {
          winner: result.winner,
          reason: result.reason,
          conditionLabel: cond.label,
        },
        holdProgress: nextHold,
      };
    }
  }

  return { outcome: null, holdProgress: nextHold };
}

interface EvalHit {
  winner: SideId | null;
  reason: string;
}

function evaluate(
  cond: VictoryCondition,
  idx: number,
  units: Record<string, Unit>,
  scenario: Scenario,
  simTimeSec: number,
  holdProgress: SimulationState["holdProgress"],
): EvalHit | null {
  switch (cond.kind) {
    case "preserve_unit": {
      const u = units[cond.unitId];
      if (!u || u.hpCurrent <= 0) {
        // 該單位陣亡 → 對手勝（任何敵對 sideId 都算贏）
        const enemy = findEnemyOf(scenario, cond.sideId);
        return {
          winner: enemy,
          reason: `${cond.sideId} 方應保存的單位 ${cond.unitId} 被擊毀`,
        };
      }
      // 時限到 + 還活著 → sideId 勝
      if (simTimeSec >= scenario.durationSec) {
        return {
          winner: cond.sideId,
          reason: `時限結束，${cond.unitId} 仍存活`,
        };
      }
      return null;
    }

    case "destroy_unit": {
      const u = units[cond.unitId];
      if (!u || u.hpCurrent <= 0) {
        return {
          winner: cond.sideId,
          reason: `目標 ${cond.unitId} 已被擊毀`,
        };
      }
      return null;
    }

    case "eliminate_side": {
      const stillAlive = Object.values(units).some(
        (u) => u.sideId === cond.targetSideId && u.hpCurrent > 0,
      );
      if (!stillAlive) {
        return {
          winner: cond.sideId,
          reason: `${cond.targetSideId} 方兵力已全滅`,
        };
      }
      return null;
    }

    case "hold_area": {
      const insideOwn = Object.values(units).some((u) => {
        if (u.sideId !== cond.sideId) return false;
        if (u.hpCurrent <= 0) return false;
        if (cond.requireKinds && !cond.requireKinds.includes(u.kind)) return false;
        const d = haversineKm([u.position.lng, u.position.lat], cond.centerLngLat);
        return d <= cond.radiusKm;
      });
      const startedAt = holdProgress[idx];
      if (insideOwn) {
        if (startedAt == null) {
          holdProgress[idx] = simTimeSec;
        } else if (simTimeSec - startedAt >= cond.forSec) {
          return {
            winner: cond.sideId,
            reason: `${cond.sideId} 方持續控制目標區域 ${cond.forSec} 秒`,
          };
        }
      } else {
        holdProgress[idx] = null;
      }
      return null;
    }

    case "time_limit": {
      if (simTimeSec < scenario.durationSec) return null;
      // 比較兵力（含 hp 加權）— 多者勝、相當則平手
      const score: Partial<Record<SideId, number>> = {};
      for (const u of Object.values(units)) {
        if (u.hpCurrent <= 0) continue;
        score[u.sideId] = (score[u.sideId] ?? 0) + u.hpCurrent;
      }
      // 排除 neutral
      delete score.neutral;
      const entries = Object.entries(score) as [SideId, number][];
      entries.sort((a, b) => b[1] - a[1]);
      if (entries.length === 0) {
        return { winner: null, reason: "時限結束，雙方兵力皆耗盡" };
      }
      if (entries.length === 1 || (entries[1] && entries[0]![1] > entries[1][1] * 1.2)) {
        return {
          winner: entries[0]![0],
          reason: `時限結束，${entries[0]![0]} 方殘存戰力最高（hp ${entries[0]![1]}）`,
        };
      }
      return { winner: null, reason: "時限結束，雙方戰力相當（平手）" };
    }
  }
}

/** 給 preserve_unit 用：找一個對 sideId 敵對的陣營當「對手」 */
function findEnemyOf(scenario: Scenario, sideId: SideId): SideId | null {
  for (const s of scenario.sides) {
    if (s.id === sideId) continue;
    if (s.isHostileTo.includes(sideId)) return s.id;
  }
  return null;
}

void {} as unknown as LngLat;  // silence unused import linter
