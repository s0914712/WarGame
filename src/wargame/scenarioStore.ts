/**
 * 場景狀態 store。
 *
 * 與 wargameClock 平行：clock 管時間，scenarioStore 管「世界內容」。
 *
 * Phase 1：loadScenario（空場景）
 * Phase 2：updateUnitAttribute + selectedUnitId（UI 域）
 * Phase 3：tick mutation 走 setState
 * Phase 4：addUnit / removeUnit / enqueueCommand
 *
 * 所有 mutator 都會 notify listeners。
 */

import type { Command, CoreAttributes, Scenario, SimulationState, Unit, UnitId } from "./types";
// 用 scenarios/empty 的版本（含 sides 配置）— Plan Mode 入口需要
import { EMPTY_SCENARIO } from "./scenarios/empty";
import { UNIT_CATALOG } from "./catalog/units";
import { initUnitWeapons } from "./catalog/weapons";

type Listener = () => void;

let state: SimulationState = {
  scenario: EMPTY_SCENARIO,
  simTimeSec: 0,
  units: {},
  pendingCommands: [],
  eventsThisTick: [],
  eventsAll: [],
  missiles: [],
  explosions: [],
  wreckages: [],
  sonobuoys: [],
  holdProgress: {},
  outcome: null,
};

// 選中的單位 — UI 域，不在 SimulationState 內（engine 不關心）
let selectedUnitId: UnitId | null = null;

// FoW 嚴格模式 — 開啟時敵方未偵測 → 完全不渲染（戰爭迷霧）
//   關閉 → 敵方淡化 15% 顯示（除錯 / 教學模式）
let fogOfWar = true;

const listeners = new Set<Listener>();

function notify() {
  for (const cb of listeners) cb();
}

export const scenarioStore = {
  getState(): SimulationState {
    return state;
  },

  getSelectedUnitId(): UnitId | null {
    return selectedUnitId;
  },

  getSelectedUnit(): Unit | null {
    if (!selectedUnitId) return null;
    return state.units[selectedUnitId] ?? null;
  },

  loadScenario(scenario: Scenario): void {
    const units: Record<UnitId, Unit> = {};
    for (const u of scenario.units) {
      const cat = UNIT_CATALOG[u.kind];
      // catalog 的 defaultExtensions（滯空 endurance / 作戰半徑 commandRadiusKm 等）
      // 補進場景單位；場景自己寫的值優先
      const withExt = cat.defaultExtensions
        ? { ...u, extensions: { ...cat.defaultExtensions, ...u.extensions } }
        : u;
      units[u.id] = initUnitWeapons(withExt, cat.defaultLoadout);
    }
    state = {
      scenario,
      simTimeSec: scenario.startSimTimeSec,
      units,
      pendingCommands: [...scenario.pendingCommands],
      eventsThisTick: [],
      eventsAll: [],
      missiles: [],
      explosions: [],
      wreckages: [],
      sonobuoys: [],
      holdProgress: {},
      outcome: null,
    };
    selectedUnitId = null;
    notify();
  },

  setSelectedUnitId(id: UnitId | null): void {
    if (id === selectedUnitId) return;
    selectedUnitId = id;
    notify();
  },

  isFogOfWar(): boolean {
    return fogOfWar;
  },

  setFogOfWar(v: boolean): void {
    if (v === fogOfWar) return;
    fogOfWar = v;
    notify();
  },

  /**
   * 即時調整單位 core attribute（UnitEditorPanel 用）。
   * Engine 下一個 tick 就會用新值（射程圈即時縮放、速率影響後續位移）。
   */
  updateUnitAttribute<K extends keyof CoreAttributes>(
    unitId: UnitId,
    key: K,
    value: CoreAttributes[K],
  ): void {
    const unit = state.units[unitId];
    if (!unit) return;
    if (unit.core[key] === value) return;

    const nextUnit: Unit = {
      ...unit,
      core: { ...unit.core, [key]: value },
    };
    // hpMax 改變時，hpCurrent clamp
    if (key === "hpMax" && nextUnit.hpCurrent > (value as number)) {
      nextUnit.hpCurrent = value as number;
    }

    state = { ...state, units: { ...state.units, [unitId]: nextUnit } };
    notify();
  },

  /** 套用使用者設定的聲學環境（場景開始前設定畫面）→ 寫入 scenario.acousticEnv */
  applyAcousticEnv(env: import("./types").AcousticEnvironment): void {
    state = { ...state, scenario: { ...state.scenario, acousticEnv: env } };
    notify();
  },

  /** Phase 3 內部 tick 呼叫；其他地方不要直接寫 */
  setState(next: SimulationState): void {
    state = next;
    notify();
  },

  /**
   * 排隊指令（編輯器使用）。
   * 下一個 engine tick 會檢查 simAtSec ≤ simTimeSec → 套用 → 從佇列移除。
   */
  enqueueCommand(cmd: Command): void {
    state = { ...state, pendingCommands: [...state.pendingCommands, cmd] };
    notify();
  },

  /** Plan Mode：放置新單位（立即插入 state，不走指令佇列） */
  addUnit(unit: Unit): void {
    const u = initUnitWeapons(unit, UNIT_CATALOG[unit.kind].defaultLoadout);
    state = { ...state, units: { ...state.units, [u.id]: u } };
    notify();
  },

  /** Plan Mode：刪除單位 */
  removeUnit(unitId: UnitId): void {
    if (!state.units[unitId]) return;
    const { [unitId]: _, ...rest } = state.units;
    void _;
    state = { ...state, units: rest };
    if (selectedUnitId === unitId) selectedUnitId = null;
    notify();
  },

  /** Plan Mode：把當前 units / sides / camera export 成 Scenario JSON */
  exportScenarioJson(): string {
    const s = state.scenario;
    const exported = {
      ...s,
      units: Object.values(state.units),
    };
    return JSON.stringify(exported, null, 2);
  },

  subscribe(cb: Listener): () => void {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
};

export type ScenarioStore = typeof scenarioStore;
