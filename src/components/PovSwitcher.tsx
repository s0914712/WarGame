/**
 * POV 切換器 — 右上角藥丸式按鈕。
 *
 * 四選一：藍方 / 紅方 / 中立 / 全局觀察者（spectator）。
 * 切換時：
 *   - 各圖層的 FoW / 偵測 / 雷達歸屬都跟著轉
 *   - 選中單位自動清除（viewStore 內處理）
 *   - LLM exportState 從新視角看
 */
import { useSyncExternalStore } from "react";
import { Globe } from "lucide-react";
import { scenarioStore } from "../wargame/scenarioStore";
import { viewStore, type ActiveView } from "../wargame/viewStore";

interface Snapshot {
  active: ActiveView;
  // serialized sides 長度 + 順序，避免 scenarios 切換時錯亂
  sidesSig: string;
}

let cached: Snapshot = build();

function build(): Snapshot {
  const sides = scenarioStore.getState().scenario.sides;
  return {
    active: viewStore.getActiveView(),
    sidesSig: sides.map((s) => s.id).join("|"),
  };
}

function getSnapshot(): Snapshot {
  const next = build();
  if (next.active !== cached.active || next.sidesSig !== cached.sidesSig) {
    cached = next;
  }
  return cached;
}

function subscribe(cb: () => void): () => void {
  const u1 = viewStore.subscribe(cb);
  const u2 = scenarioStore.subscribe(cb);
  return () => { u1(); u2(); };
}

export function PovSwitcher() {
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  const sides = scenarioStore.getState().scenario.sides;
  const active = viewStore.getActiveView();

  const options: { id: ActiveView; label: string; color: string }[] = [
    ...sides.map((s) => ({
      id: s.id as ActiveView,
      label: s.displayName,
      color: s.colorPrimary,
    })),
    { id: "spectator", label: "全局觀察", color: "#94a3b8" },
  ];

  return (
    <div
      style={{
        position: "absolute",
        top: 64,
        right: 16,
        zIndex: 22,
        padding: "10px 12px",
        background: "rgba(15, 23, 42, 0.92)",
        backdropFilter: "blur(6px)",
        border: "1px solid rgba(148, 163, 184, 0.3)",
        borderRadius: 8,
        color: "#e2e8f0",
        fontFamily: "ui-sans-serif, system-ui, sans-serif",
        display: "flex",
        alignItems: "center",
        gap: 8,
      }}
    >
      <span style={{ fontSize: 17, color: "#94a3b8", letterSpacing: 0.5, fontWeight: 600 }}>POV</span>
      <div style={{ display: "flex", gap: 4 }}>
        {options.map((opt) => {
          const isActive = opt.id === active;
          return (
            <button
              key={opt.id}
              onClick={() => viewStore.setActiveView(opt.id)}
              title={opt.id === "spectator" ? "上帝視角 — 無 FoW、顯示所有雷達" : `從${opt.label}視角看戰場`}
              className="wg-btn"
              style={{
                padding: "6px 12px",
                borderRadius: 4,
                border: `1px solid ${isActive ? opt.color : "rgba(148, 163, 184, 0.3)"}`,
                background: isActive ? opt.color : "rgba(30, 41, 59, 0.4)",
                color: isActive ? "#fff" : "#cbd5e1",
                fontSize: 17,
                fontWeight: isActive ? 600 : 400,
                cursor: "pointer",
                fontFamily: "inherit",
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              {opt.id === "spectator" ? (
                <Globe size={12} />
              ) : (
                <span style={{
                  width: 9, height: 9, borderRadius: "50%",
                  background: opt.color,
                  opacity: isActive ? 1 : 0.7,
                  boxShadow: isActive ? `0 0 8px ${opt.color}` : "none",
                }} />
              )}
              {opt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
