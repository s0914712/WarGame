/**
 * Match Score — 給「紅方 LLM 跑共軍登陸」場景的計分。
 *
 * 設計：紅方視角，分數越高代表 AI 越會打。
 *   +30 / 已成立的灘頭（hold_area 持滿 forSec）
 *   +15 / 進行中的灘頭（占有進度 ratio × 15）
 *   +2  / 殺死一個藍方單位
 *   +1  / 殺死一個美方單位（高風險高報酬）
 *   +1  / 紅方倖存單位
 *   +50 / 紅方戰略勝利
 *   -50 / 藍方戰略勝利
 *   -10 / time_limit 觸發（沒打完）
 *
 * 場景中性：對任何 scenario 都算，但只有登陸/海戰類才有意義。
 */
import type { SimulationState, SideId } from "../types";

export interface ScoreBreakdown {
  holdsCompleted: number;     // 已 hold 滿
  holdsInProgress: number;    // 進行中
  holdScore: number;
  bluekills: number;
  uskills: number;
  killScore: number;
  redAlive: number;
  redTotal: number;
  survivorScore: number;
  outcomeScore: number;       // +50 / -50 / -10
  total: number;
  // 額外：模擬時間（單位 min）
  simElapsedMin: number;
  // 結果敘述
  outcomeLabel: string;
}

export function computeMatchScore(
  state: SimulationState,
  forSideId: SideId = "red",
): ScoreBreakdown {
  let holdsCompleted = 0;
  let holdsInProgress = 0;
  let holdScore = 0;

  state.scenario.victoryConditions.forEach((vc, idx) => {
    if (vc.kind !== "hold_area" || vc.sideId !== forSideId) return;
    const startedAt = state.holdProgress[idx];
    if (typeof startedAt !== "number") return;
    const elapsed = state.simTimeSec - startedAt;
    if (elapsed >= vc.forSec) {
      holdsCompleted += 1;
      holdScore += 30;
    } else if (elapsed > 0) {
      holdsInProgress += 1;
      holdScore += Math.round((elapsed / vc.forSec) * 15);
    }
  });

  // 原始 roster：用來查 side（wreckage 會 expire，不能依賴）
  const originalSideById: Record<string, SideId> = {};
  for (const u of state.scenario.units) originalSideById[u.id] = u.sideId;

  // kills — eventsAll 抓 "destroyed"，用原始 side 分類
  let bluekills = 0;
  let uskills = 0;
  const seenKilled = new Set<string>();
  for (const ev of state.eventsAll) {
    if (ev.kind !== "destroyed" || !ev.targetId) continue;
    if (seenKilled.has(ev.targetId)) continue;
    seenKilled.add(ev.targetId);
    const side = originalSideById[ev.targetId];
    if (side === "blue") bluekills += 1;
    else if (side === "us") uskills += 1;
  }
  const killScore = bluekills * 2 + uskills * 1;

  // 紅方倖存
  let redAlive = 0;
  let redTotal = 0;
  for (const u of state.scenario.units) {
    if (u.sideId === forSideId) {
      redTotal += 1;
      if (state.units[u.id]) redAlive += 1;
    }
  }
  const survivorScore = redAlive;

  // outcome
  let outcomeScore = 0;
  let outcomeLabel = "進行中";
  if (state.outcome) {
    if (state.outcome.winner === forSideId) {
      outcomeScore = 50;
      outcomeLabel = `勝利：${state.outcome.reason}`;
    } else if (state.outcome.winner === null) {
      outcomeScore = -10;
      outcomeLabel = `時限結束：${state.outcome.reason}`;
    } else {
      outcomeScore = -50;
      outcomeLabel = `失敗（${state.outcome.winner} 勝）：${state.outcome.reason}`;
    }
  }

  const total = holdScore + killScore + survivorScore + outcomeScore;

  return {
    holdsCompleted, holdsInProgress, holdScore,
    bluekills, uskills, killScore,
    redAlive, redTotal, survivorScore,
    outcomeScore, total,
    simElapsedMin: Math.round((state.simTimeSec - state.scenario.startSimTimeSec) / 60),
    outcomeLabel,
  };
}
