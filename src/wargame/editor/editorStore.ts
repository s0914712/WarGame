/**
 * 編輯器狀態（external store）。
 *
 * Phase 4：只做「規劃航線」(planRoute) 模式 — 對某個單位設定一連串 waypoint。
 *
 * 流程：
 *   1. 使用者選中單位 → UnitEditorPanel 按「規劃航線」
 *      → editorStore.startPlanRoute(unitId)
 *      → clock 自動暫停
 *   2. 地圖點擊 → editorStore.appendWaypoint(lng, lat)
 *   3. ✓ 確認 → editorStore.commit() → enqueueCommand 寫進 scenarioStore
 *   4. ✗ 取消 → editorStore.cancel() → 清空 pending
 */
import type { LngLat, SideId, Unit, UnitId, UnitKind } from "../types";
import { scenarioStore } from "../scenarioStore";
import { wargameClock } from "../clock";
import { UNIT_CATALOG } from "../catalog/units";

type Listener = () => void;

export type EditorMode = "view" | "planRoute" | "placeUnit";

let mode: EditorMode = "view";
let planningUnitId: UnitId | null = null;
let pendingWaypoints: LngLat[] = [];
let wasRunningBeforePlan = false;

// Plan Mode：當前選中要放置的單位種類 + 陣營
let placingKind: UnitKind = "ship_surface";
let placingSide: SideId = "blue";

const listeners = new Set<Listener>();

function notify() {
  for (const cb of listeners) cb();
}

function makeCmdId(): string {
  return `cmd-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}

export const editorStore = {
  getMode(): EditorMode {
    return mode;
  },

  getPlanningUnitId(): UnitId | null {
    return planningUnitId;
  },

  getPendingWaypoints(): LngLat[] {
    return pendingWaypoints;
  },

  getPlacingKind(): UnitKind { return placingKind; },
  getPlacingSide(): SideId { return placingSide; },

  setPlacingKind(k: UnitKind): void {
    if (k === placingKind) return;
    placingKind = k; notify();
  },
  setPlacingSide(s: SideId): void {
    if (s === placingSide) return;
    placingSide = s; notify();
  },

  /** 進入 Plan Mode（放置單位） */
  enterPlaceMode(): void {
    if (mode === "placeUnit") return;
    mode = "placeUnit";
    wasRunningBeforePlan = !wargameClock.isPaused();
    wargameClock.pause();
    notify();
  },

  /** 退出 Plan Mode */
  exitPlaceMode(): void {
    if (mode !== "placeUnit") return;
    mode = "view";
    if (wasRunningBeforePlan) {
      wargameClock.resume();
      wasRunningBeforePlan = false;
    }
    notify();
  },

  /** 點地圖放單位（Plan Mode 內） */
  placeUnitAt(lng: number, lat: number): Unit | null {
    if (mode !== "placeUnit") return null;
    const cat = UNIT_CATALOG[placingKind];
    const id = `${placingSide.toUpperCase()}-${placingKind.slice(0, 2).toUpperCase()}-${Math.random().toString(36).slice(2, 7)}`;
    const unit: Unit = {
      id,
      sideId: placingSide,
      kind: placingKind,
      callsign: id,
      displayName: cat.displayName,
      position: {
        lng, lat,
        altMeters: cat.defaultAltitudeM,
        headingDeg: 0, speedKnots: 0,
      },
      waypoints: [],
      core: { ...cat.defaultCore },
      extensions: {},
      distanceTravelledKm: 0,
      hpCurrent: cat.defaultCore.hpMax,
      ammoMax: cat.defaultAmmoMax,
      ammoCurrent: cat.defaultAmmoMax,
      detectedBy: {},
      lastTickSimSec: 0,
    };
    scenarioStore.addUnit(unit);
    return unit;
  },

  startPlanRoute(unitId: UnitId): void {
    if (mode === "planRoute" && planningUnitId === unitId) return;
    mode = "planRoute";
    planningUnitId = unitId;
    pendingWaypoints = [];
    wasRunningBeforePlan = !wargameClock.isPaused();
    wargameClock.pause();
    notify();
  },

  appendWaypoint(lng: number, lat: number): void {
    if (mode !== "planRoute" || !planningUnitId) return;
    pendingWaypoints = [...pendingWaypoints, [lng, lat]];
    notify();
  },

  removeLastWaypoint(): void {
    if (mode !== "planRoute" || pendingWaypoints.length === 0) return;
    pendingWaypoints = pendingWaypoints.slice(0, -1);
    notify();
  },

  clearPending(): void {
    if (pendingWaypoints.length === 0) return;
    pendingWaypoints = [];
    notify();
  },

  commit(): void {
    if (mode !== "planRoute" || !planningUnitId) return;
    if (pendingWaypoints.length > 0) {
      // 寫入指令佇列（engine 下一個 tick 就會套用）
      scenarioStore.enqueueCommand({
        id: makeCmdId(),
        unitId: planningUnitId,
        simAtSec: wargameClock.getSimTime(),
        kind: "set_waypoints",
        waypoints: pendingWaypoints,
      });
    }
    this.exitPlanMode();
  },

  cancel(): void {
    this.exitPlanMode();
  },

  /** 內部：退出規劃模式並（可選）恢復原本的播放狀態 */
  exitPlanMode(): void {
    mode = "view";
    planningUnitId = null;
    pendingWaypoints = [];
    if (wasRunningBeforePlan) {
      wargameClock.resume();
      wasRunningBeforePlan = false;
    }
    notify();
  },

  /**
   * RTS 式右鍵移動（不必按套用）：
   *   - additive=false：立即前往該點（取代現有航線）
   *   - additive=true（Shift）：接續排隊一個航點（類似即時戰略佇列移動）
   * 靜止單位會自動給個巡航速度。
   */
  quickMove(unitId: UnitId, lng: number, lat: number, additive: boolean): void {
    const state = scenarioStore.getState();
    const unit = state.units[unitId];
    if (!unit) return;
    let base: LngLat[] = [];
    if (additive) {
      // 以最近一筆對此單位待套用的 set_waypoints 為基底，否則用單位現有航線（連點才會累積）
      let pendingWps: LngLat[] | null = null;
      for (const c of state.pendingCommands) {
        if (c.unitId === unitId && c.kind === "set_waypoints") pendingWps = c.waypoints;
      }
      base = pendingWps ?? unit.waypoints;
    }
    const waypoints: LngLat[] = [...base, [lng, lat]];
    const simAtSec = wargameClock.getSimTime();
    scenarioStore.enqueueCommand({ id: makeCmdId(), unitId, simAtSec, kind: "set_waypoints", waypoints });
    if (unit.position.speedKnots <= 0) {
      const cruise = Math.max(1, Math.round(unit.core.speedKnots * 0.6));
      scenarioStore.enqueueCommand({ id: makeCmdId(), unitId, simAtSec, kind: "set_speed", speedKnots: cruise });
    }
  },

  /** 清掉某個單位「目前已套用」的 waypoint（不是 pending）。 */
  clearUnitWaypoints(unitId: UnitId): void {
    scenarioStore.enqueueCommand({
      id: makeCmdId(),
      unitId,
      simAtSec: wargameClock.getSimTime(),
      kind: "set_waypoints",
      waypoints: [],
    });
  },

  subscribe(cb: Listener): () => void {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
};

export type EditorStore = typeof editorStore;
