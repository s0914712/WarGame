/**
 * 兵棋全域快捷鍵（指令卡字母鍵之外的部分）。
 *
 *   Delete        Plan Mode：刪除選中單位 ／ 規劃航線：移除最後一個航點
 *   Ctrl/⌘ + Z    復原上一動（最多 1 次）；規劃航線中 = 移除最後一個航點
 *   Esc           攻擊選標中 = 取消；一般模式 = 取消選取單位
 *   ?             開啟 UI 速查表
 *
 * 文字 / 數字輸入框有焦點時一律不攔（輸入座標、Ctrl+Z 原生復原照常）。
 */
import { useEffect } from "react";
import { editorStore } from "../wargame/editor/editorStore";
import { undoStore } from "../wargame/editor/undoStore";
import { scenarioStore } from "../wargame/scenarioStore";
import { hexStore } from "../wargame/hex/hexStore";
import { rulerStore } from "../map/rulerTool";

export function isTypingTarget(t: EventTarget | null): boolean {
  const el = t as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || el.isContentEditable;
}

export function useWargameHotkeys({ onOpenCheat }: { onOpenCheat: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      const mode = editorStore.getMode();

      // Ctrl/⌘ + Z
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.code === "KeyZ") {
        e.preventDefault();
        if (e.repeat) return;
        if (mode === "planRoute") editorStore.removeLastWaypoint();
        else if (mode === "view" || mode === "placeUnit") undoStore.undo();
        return;
      }
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      if (e.key === "Delete") {
        if (mode === "planRoute") {
          e.preventDefault();
          editorStore.removeLastWaypoint();
        } else if (mode === "placeUnit") {
          const id = scenarioStore.getSelectedUnitId();
          if (id && editorStore.deleteUnit(id)) e.preventDefault();
        }
        return;
      }

      if (e.key === "Escape") {
        if (mode === "attackTarget") {
          e.preventDefault();
          editorStore.cancel();
        } else if (mode === "view" && !hexStore.getBrush() && !rulerStore.isActive()) {
          scenarioStore.setSelectedUnitId(null);
        }
        return;
      }

      if (e.key === "?") {
        e.preventDefault();
        onOpenCheat();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onOpenCheat]);
}
