/**
 * 六角格勢力範圍 store — 格線顯示開關、目前筆刷、各格所屬陣營。
 *
 * - 筆刷：某陣營 id（塗該方勢力）/ "erase"（清除）/ null（不塗，一般操作）
 * - 標記依場景分開存 localStorage（wargame.hex.v1.<scenarioId>），切場景自動換一套
 * - 純本機狀態：多人連線時不同步（各玩家各自標記自己的判讀）
 */
import type { SideId } from "../types";
import { scenarioStore } from "../scenarioStore";

export type HexBrush = SideId | "erase" | null;

const STORAGE_PREFIX = "wargame.hex.v1.";
const VISIBLE_KEY = "wargame.hex.visible.v1";

let visible = loadVisible();
let brush: HexBrush = null;
let cells = new Map<string, SideId>();
let scenarioId = "";
let version = 0;
const listeners = new Set<() => void>();

function loadVisible(): boolean {
  try { return localStorage.getItem(VISIBLE_KEY) === "1"; } catch { return false; }
}

function loadCells(id: string): Map<string, SideId> {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + id);
    if (!raw) return new Map();
    const obj = JSON.parse(raw) as Record<string, SideId>;
    return new Map(Object.entries(obj));
  } catch {
    return new Map();
  }
}

function saveCells(): void {
  if (!scenarioId) return;
  try {
    if (cells.size === 0) localStorage.removeItem(STORAGE_PREFIX + scenarioId);
    else localStorage.setItem(STORAGE_PREFIX + scenarioId, JSON.stringify(Object.fromEntries(cells)));
  } catch { /* private mode / quota */ }
}

function notify(): void {
  version++;
  for (const cb of listeners) cb();
}

/** 場景切換 → 換一套標記；筆刷若是新場景不存在的陣營就收起 */
function syncScenario(): void {
  const scn = scenarioStore.getState().scenario;
  if (scn.id === scenarioId) return;
  scenarioId = scn.id;
  cells = loadCells(scenarioId);
  if (brush && brush !== "erase" && !scn.sides.some((s) => s.id === brush)) brush = null;
  notify();
}
syncScenario();
scenarioStore.subscribe(syncScenario);

export const hexStore = {
  isVisible(): boolean { return visible; },
  setVisible(v: boolean): void {
    if (v === visible) return;
    visible = v;
    if (!v) brush = null;
    try { localStorage.setItem(VISIBLE_KEY, v ? "1" : "0"); } catch { /* ignore */ }
    notify();
  },

  getBrush(): HexBrush { return brush; },
  /** 選筆刷會自動打開格線 */
  setBrush(b: HexBrush): void {
    if (b === brush) return;
    brush = b;
    if (b) {
      visible = true;
      try { localStorage.setItem(VISIBLE_KEY, "1"); } catch { /* ignore */ }
    }
    notify();
  },

  getCells(): ReadonlyMap<string, SideId> { return cells; },

  /** 用目前筆刷塗一格；有變化回 true */
  paint(key: string): boolean {
    if (!brush) return false;
    if (brush === "erase") {
      if (!cells.delete(key)) return false;
    } else {
      if (cells.get(key) === brush) return false;
      cells.set(key, brush);
    }
    saveCells();
    notify();
    return true;
  },

  clear(sideId?: SideId): void {
    if (cells.size === 0) return;
    if (sideId) {
      for (const [k, s] of cells) if (s === sideId) cells.delete(k);
    } else {
      cells.clear();
    }
    saveCells();
    notify();
  },

  countBySide(): Partial<Record<SideId, number>> {
    const out: Partial<Record<SideId, number>> = {};
    for (const s of cells.values()) out[s] = (out[s] ?? 0) + 1;
    return out;
  },

  /** useSyncExternalStore 用：primitive → 快照穩定 */
  getVersion(): number { return version; },

  subscribe(cb: () => void): () => void {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
};
