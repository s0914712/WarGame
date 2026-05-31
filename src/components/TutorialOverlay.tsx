/**
 * 8 步驟教學動畫 — 半透明 backdrop + 指向各 UI 元素的 popover。
 *
 * - 首次造訪自動跳出（localStorage 記憶）
 * - 可手動由 TutorialButton 重啟
 * - Esc / 「跳過」隨時退出
 * - 用 anchor 預定位置（左上、頂中、左下…），不用動態查 DOM rect
 */
import { useEffect, useSyncExternalStore } from "react";
import { ChevronRight, X, GraduationCap } from "lucide-react";
import { uiStore } from "../wargame/uiStore";

const STORAGE_KEY = "wargame.tutorial.completed.v1";

interface Step {
  title: string;
  body: string;
  /** Popover 錨點位置 + 箭頭朝向 */
  anchor: "top-left" | "top-center" | "top-right" | "right" | "bottom-left" | "bottom-center" | "bottom-right" | "center" | "left";
}

const STEPS: Step[] = [
  {
    title: "歡迎來到台灣兵棋",
    body: "這是一個可暫停即時制的台海兵推平台。8 個快速導覽帶你走完所有面板。",
    anchor: "center",
  },
  {
    title: "戰況總覽",
    body: "頂部中央：藍紅雙方存活 / 擊毀 / 戰役時長。數字變化會跳動提示。",
    anchor: "top-center",
  },
  {
    title: "時鐘控制",
    body: "左上：▶ 播放、⏸ 暫停（Space）、1×~60× 速率切換（按 1234）、FoW 開關。",
    anchor: "top-left",
  },
  {
    title: "場景選單",
    body: "右上：點場景名展開 → 切換到金門防衛、東沙空襲等其他場景。底圖樣式（衛星 / 地形）在隔壁。",
    anchor: "top-right",
  },
  {
    title: "Plan Mode 擺單位",
    body: "左側「📋 Plan Mode」→ 進入後選陣營 + 單位種類 → 點地圖放單位。完成後退出開戰。",
    anchor: "left",
  },
  {
    title: "單位編輯 / 規劃航線",
    body: "點任意單位 → 右側 Panel：5 個 slider 調射程 / 速率 / 偵測；按「規劃航線」連點航點。",
    anchor: "right",
  },
  {
    title: "戰報 + Replay",
    body: "左下：戰報滾動每個偵測 / 開火 / 擊毀；右下：● 錄製可下載 JSON、📂 載入回放。",
    anchor: "bottom-left",
  },
  {
    title: "🤖 LLM 介接",
    body: "右下角藍鈕：給 LLM 看當前狀態 / 套用 LLM 產出的指令 / 啟用自動駕駛讓 AI 操控紅方。",
    anchor: "bottom-right",
  },
];

let TUTORIAL_STEP_INDEX = 0;

// 必須 cache snapshot 物件 — useSyncExternalStore 用 Object.is 比較，
// 每次回傳新物件會被認為「store 變了」→ 觸發無限重渲染（React 會拋錯黑屏）
let cachedSnap = { open: false, step: 0 };
function getSnap() {
  const open = uiStore.isTutorialOpen();
  const step = TUTORIAL_STEP_INDEX;
  if (cachedSnap.open !== open || cachedSnap.step !== step) {
    cachedSnap = { open, step };
  }
  return cachedSnap;
}
let stepListeners = new Set<() => void>();
function notifyStep() { for (const cb of stepListeners) cb(); }

function setStep(i: number) {
  TUTORIAL_STEP_INDEX = i;
  notifyStep();
}

function subscribe(cb: () => void): () => void {
  const u1 = uiStore.subscribe(cb);
  stepListeners.add(cb);
  return () => { u1(); stepListeners.delete(cb); };
}

export function TutorialOverlay() {
  const s = useSyncExternalStore(subscribe, getSnap, getSnap);

  // 不再自動跳出 — 由 LandingScreen 的「介紹」按鈕觸發。
  // 保留 STORAGE_KEY 作為「已完成」記號（未來可用於分析）
  void STORAGE_KEY;

  useEffect(() => {
    if (!s.open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") finish();
      else if (e.key === "ArrowRight" || e.key === "Enter") next();
      else if (e.key === "ArrowLeft") prev();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [s.open]);

  if (!s.open) return null;

  const step = STEPS[s.step]!;
  const isLast = s.step === STEPS.length - 1;

  const finish = () => {
    try { localStorage.setItem(STORAGE_KEY, "1"); } catch { /* */ }
    uiStore.setTutorialOpen(false);
    setStep(0);
  };
  const next = () => {
    if (isLast) finish();
    else setStep(s.step + 1);
  };
  const prev = () => {
    if (s.step > 0) setStep(s.step - 1);
  };

  return (
    <>
      {/* 半透明 backdrop */}
      <div
        onClick={finish}
        style={{
          position: "fixed", inset: 0, zIndex: 200,
          background: "rgba(2, 6, 23, 0.6)",
          backdropFilter: "blur(2px)",
        }}
      />

      {/* Popover */}
      <div
        className="wg-fade-in"
        style={{
          position: "fixed",
          zIndex: 201,
          width: 360,
          background: "linear-gradient(135deg, rgba(30, 41, 59, 0.98) 0%, rgba(15, 23, 42, 0.98) 100%)",
          border: "1px solid rgba(59, 130, 246, 0.4)",
          borderRadius: 10,
          padding: 18,
          color: "#e2e8f0",
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
          boxShadow: "0 20px 60px rgba(0,0,0,0.7), 0 0 0 1px rgba(59, 130, 246, 0.2)",
          ...positionOf(step.anchor),
        }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
          <span style={{
            fontSize: 15, color: "#60a5fa", fontWeight: 700, letterSpacing: 1,
            display: "flex", alignItems: "center", gap: 4,
          }}>
            <GraduationCap size={14} /> 教學 {s.step + 1} / {STEPS.length}
          </span>
          <button onClick={finish} className="wg-btn" style={{
            background: "transparent", border: "none", color: "#94a3b8",
            cursor: "pointer", padding: 0,
          }}>
            <X size={16} />
          </button>
        </div>

        <h3 style={{ margin: "0 0 8px", fontSize: 24, fontWeight: 700, color: "#e2e8f0" }}>
          {step.title}
        </h3>
        <p style={{ margin: "0 0 16px", fontSize: 17, lineHeight: 1.6, color: "#cbd5e1" }}>
          {step.body}
        </p>

        {/* 進度條 */}
        <div style={{
          display: "flex", gap: 3, marginBottom: 14,
        }}>
          {STEPS.map((_, i) => (
            <div key={i} style={{
              flex: 1, height: 3, borderRadius: 2,
              background: i <= s.step ? "#3b82f6" : "rgba(148, 163, 184, 0.2)",
              transition: "background 0.2s",
            }} />
          ))}
        </div>

        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
          <button onClick={finish} className="wg-btn" style={{
            padding: "6px 12px",
            background: "transparent", color: "#94a3b8",
            border: "1px solid rgba(148, 163, 184, 0.3)", borderRadius: 4,
            fontSize: 16, cursor: "pointer", fontFamily: "inherit",
          }}>
            跳過
          </button>

          <div style={{ display: "flex", gap: 6 }}>
            {s.step > 0 && (
              <button onClick={prev} className="wg-btn" style={{
                padding: "8px 14px",
                background: "rgba(148, 163, 184, 0.15)", color: "#cbd5e1",
                border: "1px solid rgba(148, 163, 184, 0.3)", borderRadius: 4,
                fontSize: 16, cursor: "pointer", fontFamily: "inherit",
              }}>
                上一步
              </button>
            )}
            <button onClick={next} className="wg-btn" style={{
              padding: "8px 16px",
              background: "#3b82f6", color: "#fff",
              border: "none", borderRadius: 4,
              fontSize: 17, fontWeight: 600, cursor: "pointer",
              fontFamily: "inherit",
              display: "flex", alignItems: "center", gap: 6,
            }}>
              {isLast ? "開始" : "下一步"}
              {!isLast && <ChevronRight size={14} />}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}

function positionOf(anchor: Step["anchor"]): React.CSSProperties {
  const m = 80;  // margin from edge
  switch (anchor) {
    case "center":        return { top: "50%", left: "50%", transform: "translate(-50%, -50%)" };
    case "top-left":      return { top: m, left: m };
    case "top-center":    return { top: 110, left: "50%", transform: "translateX(-50%)" };
    case "top-right":     return { top: m, right: m };
    case "left":          return { top: "40%", left: m };
    case "right":         return { top: "40%", right: m };
    case "bottom-left":   return { bottom: m, left: m };
    case "bottom-center": return { bottom: m, left: "50%", transform: "translateX(-50%)" };
    case "bottom-right":  return { bottom: m, right: m };
  }
}

/** 給其他組件呼叫，重啟教學（重新從第 0 步） */
export function launchTutorial(): void {
  TUTORIAL_STEP_INDEX = 0;
  uiStore.setTutorialOpen(true);
}
