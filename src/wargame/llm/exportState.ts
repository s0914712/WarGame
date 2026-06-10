/**
 * 把 scenarioStore + wargameClock 整理成 LLM 友善的 JSON。
 *
 * 純讀 — 沒副作用。LLM 拿到後可分析戰場做決策。
 */
import { scenarioStore } from "../scenarioStore";
import { wargameClock, formatTPlus } from "../clock";
import { viewStore } from "../viewStore";
import { UNIT_CATALOG } from "../catalog/units";
import {
  STATE_VERSION,
  type LlmStateExport,
  type LlmUnitView,
} from "./schema";

/**
 * 依當前 POV 匯出 state。spectator 時用 blue 作 fallback POV。
 * 可傳 povOverride 強制以某陣營視角匯出（給 AI Adversary loop 用，避免影響 UI POV）。
 */
export function buildStateExport(povOverride?: import("../types").SideId): LlmStateExport {
  const state = scenarioStore.getState();
  const povSide = povOverride ?? viewStore.getActiveSideId() ?? "blue";

  const playerSide = state.scenario.sides.find((s) => s.id === povSide);
  const hostileToPov = playerSide?.isHostileTo ?? [];

  const sideMap = new Map(state.scenario.sides.map((s) => [s.id, s]));

  const units: LlmUnitView[] = Object.values(state.units).map((u) => {
    const cat = UNIT_CATALOG[u.kind];
    let detectedByPlayer: LlmUnitView["detectedByPlayer"] = "own";
    if (u.sideId !== povSide) {
      if (hostileToPov.includes(u.sideId)) {
        const st = u.detectedBy[povSide];
        detectedByPlayer = st && st !== "hidden" ? (st as LlmUnitView["detectedByPlayer"]) : "hidden";
      } else {
        // 中立 — 視為「總是看得到」
        detectedByPlayer = "tracked";
      }
    }

    return {
      id: u.id,
      side: u.sideId,
      kind: u.kind,
      domain: cat.domain,
      callsign: u.callsign,
      name: u.displayName,
      position: {
        lng: round6(u.position.lng),
        lat: round6(u.position.lat),
        altMeters: u.position.altMeters,
      },
      speedKnots: u.position.speedKnots,
      headingDeg: Math.round(u.position.headingDeg),
      hp: { current: u.hpCurrent, max: u.core.hpMax },
      fuel: {
        remainingKm: Math.max(0, Math.round(u.core.movementRangeKm - u.distanceTravelledKm)),
        maxKm: u.core.movementRangeKm,
      },
      core: { ...u.core },
      waypoints: u.waypoints.map(([lng, lat]) => [round6(lng), round6(lat)] as [number, number]),
      detectedByPlayer,
      // 己方單位才回報 ROE（有效值：unit 覆寫 > side 預設 > weapons_free）
      ...(u.sideId === povSide
        ? { roe: u.roe ?? sideMap.get(u.sideId)?.roe ?? "weapons_free" }
        : {}),
      constraints: {
        forbidDomains: cat.constraints.forbidDomains,
      },
    };
  });

  return {
    version: STATE_VERSION,
    scenario: {
      id: state.scenario.id,
      name: state.scenario.displayName,
      // 時戳以 scenarioStore.simTimeSec 為準（engine 寫入的權威時間）。
      // wargameClock 只在 browser 透過 useSimLoop 同步推進；MCP / Node 直呼 step()
      // 不會碰 clock，所以舊版讀 wargameClock 會永遠卡在 T+0（過去的 bug）。
      simTime: formatTPlus(state.simTimeSec),
      simTimeSec: Math.round(state.simTimeSec),
      paused: wargameClock.isPaused(),
    },
    sides: state.scenario.sides.map((s) => ({
      id: s.id,
      name: s.displayName,
      isPlayer: s.isPlayer,
      hostileTo: s.isHostileTo,
    })),
    units,
  };
}

function round6(n: number): number {
  return Math.round(n * 1e6) / 1e6;
}
