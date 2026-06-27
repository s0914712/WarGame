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
import { viewStore } from "../viewStore";
import { wargameClock } from "../clock";
import { UNIT_CATALOG } from "../catalog/units";
import { DEFAULT_MDR_KM } from "../sim/sonobuoyField";

type Listener = () => void;

export type EditorMode = "view" | "planRoute" | "placeUnit" | "defineSonobuoyArea";

let mode: EditorMode = "view";
let planningUnitId: UnitId | null = null;
let pendingWaypoints: LngLat[] = [];
let wasRunningBeforePlan = false;

// 聲標反潛屏幕 draft（defineSonobuoyArea 模式）
let sonobuoyUnitId: UnitId | null = null;
let sonobuoyCornerA: LngLat | null = null;
let sonobuoyCornerB: LngLat | null = null;
let sonobuoyCount = 12;
let sonobuoyMdrKm = DEFAULT_MDR_KM;

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

  // ── 聲標反潛屏幕（兩角定框）──────────────────────────────
  getSonobuoyDraft() {
    return {
      unitId: sonobuoyUnitId,
      cornerA: sonobuoyCornerA,
      cornerB: sonobuoyCornerB,
      count: sonobuoyCount,
      mdrKm: sonobuoyMdrKm,
    };
  },

  startSonobuoyArea(unitId: UnitId): void {
    mode = "defineSonobuoyArea";
    sonobuoyUnitId = unitId;
    sonobuoyCornerA = null;
    sonobuoyCornerB = null;
    wasRunningBeforePlan = !wargameClock.isPaused();
    wargameClock.pause();
    notify();
  },

  /** 點地圖：第 1 點存 A、第 2 點存 B；已滿兩角則重設為新 A */
  setSonobuoyCorner(lng: number, lat: number): void {
    if (mode !== "defineSonobuoyArea") return;
    if (!sonobuoyCornerA || sonobuoyCornerB) {
      sonobuoyCornerA = [lng, lat];
      sonobuoyCornerB = null;
    } else {
      sonobuoyCornerB = [lng, lat];
    }
    notify();
  },

  setSonobuoyCount(n: number): void {
    const v = Math.max(1, Math.min(64, Math.round(n)));
    if (v === sonobuoyCount) return;
    sonobuoyCount = v;
    notify();
  },

  commitSonobuoyField(): void {
    if (mode !== "defineSonobuoyArea" || !sonobuoyUnitId) return;
    if (sonobuoyCornerA && sonobuoyCornerB) {
      scenarioStore.enqueueCommand({
        id: makeCmdId(),
        unitId: sonobuoyUnitId,
        simAtSec: wargameClock.getSimTime(),
        kind: "deploy_sonobuoys",
        cornerA: sonobuoyCornerA,
        cornerB: sonobuoyCornerB,
        count: sonobuoyCount,
        mdrKm: sonobuoyMdrKm,
      });
    }
    this.exitPlanMode();
  },

  /** 內部：退出規劃模式並（可選）恢復原本的播放狀態 */
  exitPlanMode(): void {
    mode = "view";
    planningUnitId = null;
    pendingWaypoints = [];
    sonobuoyUnitId = null;
    sonobuoyCornerA = null;
    sonobuoyCornerB = null;
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

  /**
   * RTS 式右鍵攻擊：右鍵點到敵方單位 → 對選中的己方單位下達「接戰」攻擊計畫。
   * 回傳 true = 已下達攻擊命令（呼叫端就不要再當成移動處理）；false = 非有效敵方目標。
   * 注意：未定位（bearing）/ 未進入射程的目標仍可下令，combat 會在定位 + 進射程後自動開火。
   */
  quickEngage(attackerId: UnitId, targetId: UnitId): boolean {
    if (attackerId === targetId) return false;
    const state = scenarioStore.getState();
    const attacker = state.units[attackerId];
    const target = state.units[targetId];
    if (!attacker || !target) return false;
    if (attacker.hpCurrent <= 0 || target.hpCurrent <= 0) return false;
    // 只能命令己方單位（spectator 視角不限）
    const activeSide = viewStore.getActiveSideId();
    if (activeSide && attacker.sideId !== activeSide) return false;
    // 目標必須與攻方敵對
    const sides = state.scenario.sides;
    const atkSide = sides.find((s) => s.id === attacker.sideId);
    const tgtSide = sides.find((s) => s.id === target.sideId);
    const hostile = (atkSide?.isHostileTo.includes(target.sideId) ?? false)
      || (tgtSide?.isHostileTo.includes(attacker.sideId) ?? false);
    if (!hostile) return false;
    scenarioStore.enqueueCommand({
      id: makeCmdId(),
      unitId: attackerId,
      simAtSec: wargameClock.getSimTime(),
      kind: "engage",
      targetUnitId: targetId,
    });
    return true;
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
