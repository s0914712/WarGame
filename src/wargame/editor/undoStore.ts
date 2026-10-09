/**
 * 單層復原（Ctrl+Z）。
 *
 * 只記「最近一次」玩家動作，復原後即清空（最多回復 1 次）：
 *   - 指令（submitCommand）→ 以反向指令還原（多人模式也走同一條 command bus，不直接改 state）
 *     同一個同步呼叫內送出的多筆指令（例：右鍵移動 = set_waypoints + set_speed）合併成一個動作
 *   - Plan Mode 刪除單位 → 放回原單位（含彈量 / 航線）
 *   - Plan Mode 放置單位 → 移除
 *
 * 聲標佈放無法收回 → 送出後清空復原紀錄（避免 Ctrl+Z 誤還原更早的動作）。
 */
import type { Command, Unit } from "../types";
import { scenarioStore } from "../scenarioStore";
import { applyOne } from "../sim/commands";

type Listener = () => void;

interface UndoEntry {
  label: string;
  run: () => void;
}

let entry: UndoEntry | null = null;
// 同步呼叫內的指令合併成同一筆
let groupOpen = false;
let groupInverse: Command[] = [];
let groupBroken = false;
// 復原本身送出的反向指令不要再被記錄
let replaying = false;

const listeners = new Set<Listener>();
function notify() { for (const cb of listeners) cb(); }

let send: (cmd: Command) => void = () => {};

/** 單位「已排隊但未套用」的指令也算進去 → 反向指令還原到玩家下令前看到的狀態 */
function effectiveUnit(unitId: string): Unit | undefined {
  const s = scenarioStore.getState();
  let u = s.units[unitId];
  if (!u) return undefined;
  for (const c of s.pendingCommands) {
    if (c.unitId === unitId && c.kind !== "deploy_sonobuoys") u = applyOne(u, c);
  }
  return u;
}

function inverseOf(cmd: Command): Command[] | null {
  const u = effectiveUnit(cmd.unitId);
  if (!u) return null;
  const base = { unitId: cmd.unitId, simAtSec: cmd.simAtSec };
  const id = (k: string) => `undo-${k}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const roe = u.roe ?? scenarioStore.getState().scenario.sides.find((s) => s.id === u.sideId)?.roe ?? "weapons_free";
  switch (cmd.kind) {
    case "set_waypoints":
      return [{ ...base, id: id("wp"), kind: "set_waypoints", waypoints: u.waypoints }];
    case "set_speed":
      return [{ ...base, id: id("spd"), kind: "set_speed", speedKnots: u.position.speedKnots }];
    case "hold":
      return [
        { ...base, id: id("wp"), kind: "set_waypoints", waypoints: u.waypoints },
        { ...base, id: id("spd"), kind: "set_speed", speedKnots: u.position.speedKnots },
      ];
    case "engage":
      // 空字串 = 解除接戰（applyOne 轉成 undefined，combat 會重新自動鎖定）
      return [{ ...base, id: id("eng"), kind: "engage", targetUnitId: u.engagingTargetId ?? "" }];
    case "set_roe":
      return [{ ...base, id: id("roe"), kind: "set_roe", roe }];
    case "set_active_sonar":
      return [{ ...base, id: id("sonar"), kind: "set_active_sonar", on: !!u.activeSonar }];
    case "set_towed_array":
      return [{ ...base, id: id("towed"), kind: "set_towed_array", on: u.towedArrayDeployed !== false }];
    case "set_depth":
      return [{ ...base, id: id("depth"), kind: "set_depth", depthM: u.targetDepthM ?? Math.max(0, -u.position.altMeters) }];
    case "deploy_sonobuoys":
      return null;
  }
}

function set(next: UndoEntry | null) {
  entry = next;
  notify();
}

export const undoStore = {
  /** commandBus 注入實際送出函式（避免循環 import） */
  bindSender(fn: (cmd: Command) => void): void { send = fn; },

  /** submitCommand 送出前呼叫（此時 state 仍是下令前） */
  recordCommand(cmd: Command): void {
    if (replaying) return;
    if (!groupOpen) {
      groupOpen = true;
      groupInverse = [];
      groupBroken = false;
      queueMicrotask(() => {
        groupOpen = false;
        if (groupBroken || groupInverse.length === 0) { set(null); return; }
        // 反向指令要倒序送（後下的先還原）
        const inv = [...groupInverse].reverse();
        set({ label: "指令", run: () => { for (const c of inv) send(c); } });
      });
    }
    const inv = inverseOf(cmd);
    if (!inv) groupBroken = true;
    else groupInverse.push(...inv);
  },

  recordRemoveUnit(unit: Unit): void {
    set({
      label: "刪除單位",
      run: () => {
        scenarioStore.addUnit(unit);
        scenarioStore.setSelectedUnitId(unit.id);
      },
    });
  },

  recordAddUnit(unitId: string): void {
    set({ label: "放置單位", run: () => scenarioStore.removeUnit(unitId) });
  },

  canUndo(): boolean { return entry != null; },
  getLabel(): string | null { return entry?.label ?? null; },

  /** 執行復原；回傳是否有東西可復原 */
  undo(): boolean {
    const e = entry;
    if (!e) return false;
    entry = null;
    replaying = true;
    try { e.run(); } finally { replaying = false; }
    notify();
    return true;
  },

  /** 清空復原紀錄 */
  clear(): void { if (entry) set(null); },

  subscribe(cb: Listener): () => void {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
};

// 換場景（含回放載入）→ 舊動作不再有意義
let lastScenarioId = scenarioStore.getState().scenario.id;
scenarioStore.subscribe(() => {
  const id = scenarioStore.getState().scenario.id;
  if (id !== lastScenarioId) {
    lastScenarioId = id;
    undoStore.clear();
  }
});
