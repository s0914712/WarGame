/**
 * 視角 store — 玩家當下「從哪個陣營看戰場」。
 *
 * 三種模式：
 *   - "blue" / "red" / "neutral"：那個陣營的 POV（FoW 套用、雷達是該方的、LLM 看那方狀態）
 *   - "spectator"：全局視角（god mode，無 FoW、所有雷達都顯示）
 *
 * 與 scenarioStore / wargameClock 平行，independently subscribable。
 */
import type { SideId } from "./types";
import { scenarioStore } from "./scenarioStore";

export type ActiveView = SideId | "spectator";

type Listener = () => void;

let activeView: ActiveView = "blue";
const listeners = new Set<Listener>();

function notify() {
  for (const cb of listeners) cb();
}

export const viewStore = {
  getActiveView(): ActiveView {
    return activeView;
  },

  /** spectator 時回 null；UI / layer 用這個判斷「是不是 god mode」 */
  getActiveSideId(): SideId | null {
    return activeView === "spectator" ? null : activeView;
  },

  isSpectator(): boolean {
    return activeView === "spectator";
  },

  setActiveView(v: ActiveView): void {
    if (v === activeView) return;
    activeView = v;
    // 切換 POV → 取消選單位（原來選的可能是現在看不到的敵方）
    scenarioStore.setSelectedUnitId(null);
    notify();
  },

  subscribe(cb: Listener): () => void {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
};
