/**
 * 任務目標即時狀態 — 把 scenario.victoryConditions + 目前 SimulationState 轉成 UI 可讀的進度。
 * 純函式（無 browser 依賴）；目標 HUD 與地圖目標層共用。
 *
 * FoW：destroy_unit 的敵方目標只在「目前視角看得到」時才給座標（避免洩漏位置）。
 */
import type { LngLat, SideId, SimulationState, Unit, VictoryCondition } from "./types";
import { haversineKm } from "./sim/geo";

export type ObjectiveState = "active" | "done" | "failed";

export interface ObjectiveStatus {
  idx: number;
  kind: VictoryCondition["kind"];
  /** 誰的目標（time_limit = null，中性） */
  sideId: SideId | null;
  label: string;
  /** 0–1；無進度概念 = null */
  progress: number | null;
  detail: string;
  state: ObjectiveState;
  /** 地圖定位（目標區中心 / 可見的目標單位位置） */
  focus?: LngLat;
  /** hold_area：區域半徑；有敵方單位在區內 = 爭奪中 */
  radiusKm?: number;
  contested?: boolean;
}

function fmtClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), ss = s % 60;
  const mm = String(m).padStart(2, "0"), sss = String(ss).padStart(2, "0");
  return h > 0 ? `${h}:${mm}:${sss}` : `${mm}:${sss}`;
}

function visibleTo(u: Unit, pov: SideId | null): boolean {
  if (pov == null || u.sideId === pov) return true;
  return (u.detectedBy[pov] ?? "hidden") !== "hidden" && u.contactQuality?.[pov] !== "bearing";
}

export function computeObjectives(state: SimulationState, simSec: number, pov: SideId | null): ObjectiveStatus[] {
  const scn = state.scenario;
  const units = state.units;
  const sideName = (id: SideId) => scn.sides.find((s) => s.id === id)?.displayName ?? id;
  // 被擊毀的單位會從 state.units 移除 → 名稱從場景初始單位表找
  const callsignOf = (id: string) => units[id]?.callsign ?? scn.units.find((u) => u.id === id)?.callsign ?? id;
  const alive = (id: string) => { const u = units[id]; return !!u && u.hpCurrent > 0; };
  const winner = state.outcome?.winner;

  return scn.victoryConditions.map((c, idx): ObjectiveStatus => {
    switch (c.kind) {
      case "preserve_unit": {
        const u = units[c.unitId];
        const ok = alive(c.unitId);
        return {
          idx, kind: c.kind, sideId: c.sideId,
          label: c.label ?? `保全 ${callsignOf(c.unitId)}`,
          progress: ok && u ? u.hpCurrent / Math.max(1, u.core.hpMax) : 0,
          detail: ok && u ? `HP ${Math.round(u.hpCurrent)}/${u.core.hpMax}` : "已被擊毀",
          state: ok ? (winner === c.sideId ? "done" : "active") : "failed",
          focus: ok && u && visibleTo(u, pov) ? [u.position.lng, u.position.lat] : undefined,
        };
      }
      case "destroy_unit": {
        const u = units[c.unitId];
        const dead = !alive(c.unitId);
        return {
          idx, kind: c.kind, sideId: c.sideId,
          label: c.label ?? `擊毀 ${callsignOf(c.unitId)}`,
          progress: dead ? 1 : null,
          detail: dead ? "目標已擊毀" : u && visibleTo(u, pov) ? "目標已發現" : "目標位置不明",
          state: dead ? "done" : "active",
          focus: !dead && u && visibleTo(u, pov) ? [u.position.lng, u.position.lat] : undefined,
        };
      }
      case "eliminate_side": {
        const total = scn.units.filter((u) => u.sideId === c.targetSideId).length;
        const left = Object.values(units).filter((u) => u.sideId === c.targetSideId && u.hpCurrent > 0).length;
        return {
          idx, kind: c.kind, sideId: c.sideId,
          label: c.label ?? `殲滅 ${sideName(c.targetSideId)}`,
          progress: total > 0 ? 1 - left / total : null,
          detail: `${sideName(c.targetSideId).split(/[（(]/)[0]!.trim()} 殘存 ${left}/${total}`,
          state: left === 0 ? "done" : "active",
        };
      }
      case "hold_area": {
        const startedAt = state.holdProgress?.[idx] ?? null;
        const held = startedAt != null ? simSec - startedAt : 0;
        const inside = (u: Unit) => u.hpCurrent > 0
          && haversineKm([u.position.lng, u.position.lat], c.centerLngLat) <= c.radiusKm;
        // 爭奪：敵對陣營有「目前視角看得到」的單位在區內
        const hostile = scn.sides.find((s) => s.id === c.sideId)?.isHostileTo ?? [];
        const contested = Object.values(units).some((u) => hostile.includes(u.sideId) && inside(u) && visibleTo(u, pov));
        const done = winner === c.sideId;
        return {
          idx, kind: c.kind, sideId: c.sideId,
          label: c.label ?? `控制目標區（${c.radiusKm} km）`,
          progress: done ? 1 : Math.min(1, held / Math.max(1, c.forSec)),
          detail: done ? "已達成"
            : startedAt != null ? `控制中 ${fmtClock(held)} / ${fmtClock(c.forSec)}`
            : `未控制 · 需連續 ${fmtClock(c.forSec)}`,
          state: done ? "done" : "active",
          focus: c.centerLngLat, radiusKm: c.radiusKm, contested,
        };
      }
      case "time_limit": {
        const left = scn.durationSec - simSec;
        return {
          idx, kind: c.kind, sideId: null,
          label: c.label ?? "時限結束 → 殘存戰力高者勝",
          progress: scn.durationSec > 0 ? Math.min(1, simSec / scn.durationSec) : null,
          detail: left > 0 ? `剩餘 ${fmtClock(left)}` : "時間到",
          state: left > 0 ? "active" : "done",
        };
      }
    }
  });
}

export { fmtClock as formatObjectiveClock };
