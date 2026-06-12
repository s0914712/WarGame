/**
 * 模擬引擎 — 純函式 tick + step（含 sub-tick 切片）。
 *
 * Phase 3 流程：
 *   1. applyDueCommands — 排隊指令到期套用
 *   2. movement — 所有單位前進
 *   3. detection — 重算 detectedBy
 *
 * Phase 5 會再加 combat 步驟。
 *
 * 重要：60x 速率時一幀 ≈ 0.96 秒 sim time，太粗會讓飛彈交戰時序錯亂。
 * step() 內把總 dt 切成 ≤ 0.5s 的 sub-tick。
 */
import type { SimulationState, Unit, UnitId } from "../types";
import { applyDueCommands } from "./commands";
import { computeDetection } from "./detection";
import { advanceUnit, adjustDepth } from "./movement";
import { runCombat } from "./combat";
import { COMBAT_RULES_V1 } from "./rules/v1";
import { checkVictory } from "./victory";
import { runReplenishment } from "./replenishment";
import { runRtb } from "./rtb";

const SUBTICK_MAX_SEC = 0.5;

/** 切片進行 — 外部呼叫這個 */
export function step(state: SimulationState, dtTotalSec: number): SimulationState {
  if (dtTotalSec <= 0) return state;
  let cur = state;
  let remaining = dtTotalSec;
  while (remaining > 0) {
    const dt = Math.min(remaining, SUBTICK_MAX_SEC);
    cur = tick(cur, dt);
    remaining -= dt;
  }
  return cur;
}

/** 單一 tick — 不要直接外部呼叫，永遠透過 step() 進入以確保 sub-tick 切片 */
export function tick(state: SimulationState, dtSec: number): SimulationState {
  // 1. 命令套用（含聲標佈放）
  const { units: unitsAfterCmd, pendingCommands, sonobuoys: newBuoys } = applyDueCommands(state);
  const nextSimSec0 = state.simTimeSec + dtSec;
  // 聲標：併入新佈放 + 過濾電池到期者
  const sonobuoys = [...(state.sonobuoys ?? []), ...newBuoys]
    .filter((b) => nextSimSec0 <= b.deployedAtSimSec + b.lifetimeSec);

  // 2. RTB — 戰機彈藥/燃料低 → 覆寫 waypoints 為最近 friendly airbase
  const afterRtb = runRtb({ ...state, units: unitsAfterCmd });
  const unitsAfterRtb = afterRtb.units;

  // 3. 移動
  const unitsAfterMove: Record<UnitId, Unit> = {};
  for (const u of Object.values(unitsAfterRtb)) {
    unitsAfterMove[u.id] = adjustDepth(advanceUnit(u, dtSec), dtSec);
  }

  // 4. 偵測（漸進狀態機 + A5 地形遮蔽/地平線 + E20 反潛聲納 + 聲標屏幕；emit detection 事件）
  const nextSimSec = nextSimSec0;
  const occlusionEnabled = state.scenario.terrainOcclusion !== false;   // 省略 = 啟用
  const acousticModel = state.scenario.acousticModel === true;          // 省略 = 關閉
  const detection = computeDetection(
    unitsAfterMove, state.scenario.sides, dtSec, nextSimSec,
    occlusionEnabled, acousticModel, state.scenario.sonarLayerDepthM,
    state.scenario.convergenceZoneKm, sonobuoys,
  );

  // 5. 戰鬥 — 把 detection 事件併入本 tick：eventsThisTick 由此重置、eventsAll 先接 detection
  const afterCombat = runCombat(
    {
      ...state,
      units: detection.units,
      pendingCommands,
      simTimeSec: nextSimSec,
      sonobuoys,
      eventsThisTick: detection.events,
      eventsAll: [...state.eventsAll, ...detection.events],
    },
    COMBAT_RULES_V1,
    dtSec,
  );

  // 6. 補給（RAS / 機場補給範圍內回油 + 補彈）
  const afterReplen = runReplenishment(afterCombat, dtSec);

  // 7. 勝負判定
  const victory = checkVictory(
    afterReplen.scenario,
    afterReplen.units,
    afterReplen.simTimeSec,
    afterReplen.holdProgress,
    afterReplen.outcome,
  );

  if (victory.outcome !== afterReplen.outcome ||
      victory.holdProgress !== afterReplen.holdProgress) {
    return {
      ...afterReplen,
      outcome: victory.outcome,
      holdProgress: victory.holdProgress,
    };
  }
  return afterReplen;
}
