/**
 * Demo Mode 開關 — 進入後隱藏所有非必要 UI，只保留地圖 + 戰況 + T+。
 * 進入後按鈕變透明小圖示在角落；按 Esc 也能退出。
 */
import { useEffect, useSyncExternalStore } from "react";
import { Monitor, X } from "lucide-react";
import { uiStore } from "../wargame/uiStore";

function getDemo(): boolean { return uiStore.isDemoMode(); }

export function DemoModeToggle({ isMobile = false }: { isMobile?: boolean } = {}) {
  const demo = useSyncExternalStore(uiStore.subscribe, getDemo, getDemo);

  // Esc 退出 demo 模式
  useEffect(() => {
    if (!demo) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        uiStore.setDemoMode(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [demo]);

  if (demo) {
    // 退出鈕（小、低調，左下角）
    return (
      <button
        onClick={() => uiStore.setDemoMode(false)}
        title="退出 Demo Mode (Esc)"
        className="wg-btn"
        style={{
          position: "absolute",
          bottom: `calc(env(safe-area-inset-bottom, 0px) + 16px)`,
          left: 16,
          zIndex: 30,
          width: isMobile ? 44 : 36, height: isMobile ? 44 : 36,
          borderRadius: 6,
          background: "rgba(15, 23, 42, 0.5)",
          color: "#94a3b8",
          border: "1px solid rgba(148, 163, 184, 0.25)",
          cursor: "pointer",
          display: "flex", alignItems: "center", justifyContent: "center",
        }}
      >
        <X size={16} />
      </button>
    );
  }

  // 行動版非 demo 時：入口改由選單抽屜提供，這裡不渲染浮動按鈕
  if (isMobile) return null;

  // 進入鈕（小，左下角）
  return (
    <button
      onClick={() => uiStore.setDemoMode(true)}
      title="進入 Demo Mode（隱藏控制面板，純展示）"
      className="wg-btn"
      style={{
        position: "absolute",
        bottom: 60,
        left: 16,
        zIndex: 22,
        padding: "8px 12px",
        background: "rgba(15, 23, 42, 0.92)",
        color: "#cbd5e1",
        border: "1px solid rgba(148, 163, 184, 0.3)",
        borderRadius: 8,
        cursor: "pointer",
        fontSize: 16,
        fontFamily: "ui-sans-serif, system-ui, sans-serif",
        display: "flex", alignItems: "center", gap: 6,
      }}
    >
      <Monitor size={14} />
      Demo Mode
    </button>
  );
}
