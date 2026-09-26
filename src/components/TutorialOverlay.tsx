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
import { t, useLang } from "../wargame/i18n/lang";

const STORAGE_KEY = "wargame.tutorial.completed.v1";

interface Step {
  title: { zh: string; en: string };
  body: { zh: string; en: string };
  /** Popover 錨點位置 + 箭頭朝向 */
  anchor: "top-left" | "top-center" | "top-right" | "right" | "bottom-left" | "bottom-center" | "bottom-right" | "center" | "left";
}

const STEPS: Step[] = [
  {
    title: { zh: "歡迎來到台灣兵棋", en: "Welcome to Taiwan Wargame" },
    body: { zh: "這是一個可暫停即時制的台海兵推平台。8 個快速導覽帶你走完所有面板。",
            en: "Pausable real-time Taiwan Strait wargame. An 8-step quick tour of every panel." },
    anchor: "center",
  },
  {
    title: { zh: "頂部資訊列", en: "Top Bar" },
    body: { zh: "頂部一排：左側 ▶ 播放 / ⏸ 暫停（Space）與 1×–60× 速率（按 1234）；中間藍紅雙方存活 / 擊毀。",
            en: "One bar across the top: Play/Pause (Space) and 1×–60× rate (keys 1234) on the left; alive/killed per side in the middle." },
    anchor: "top-left",
  },
  {
    title: { zh: "場景 / 視角 / 選單", en: "Scenario / POV / Menu" },
    body: { zh: "頂部列右側：切換場景、視角（POV）、FoW、語言、LLM。☰ 選單收納底圖、錄製 / 回放、Plan Mode、簡報與教學。",
            en: "Right side of the top bar: scenario, POV, FoW, language, LLM. The ☰ menu holds base map, record/replay, Plan Mode, briefing and help." },
    anchor: "top-right",
  },
  {
    title: { zh: "底部控制台", en: "Bottom Console" },
    body: { zh: "左鍵點單位 → 底部中間顯示 HP / 油料 / 彈藥 / 航線。右鍵地圖＝移動、右鍵敵方＝攻擊、Shift＋右鍵＝排隊航點。",
            en: "Left-click a unit → the console centre shows HP / fuel / ammo / route. Right-click map = move, right-click enemy = attack, Shift+right-click = queue waypoint." },
    anchor: "bottom-center",
  },
  {
    title: { zh: "指令卡（快捷鍵）", en: "Command Card (Hotkeys)" },
    body: { zh: "右下指令卡，每格右側字母就是快捷鍵：R 規劃航線（Enter 套用 / Esc 取消）、C 清線、H 停止、F/T/D/G 交戰規則、S 聲納、Y 拖曳陣列、B 聲標。",
            en: "Bottom-right command card — the letter on each button is its hotkey: R route (Enter apply / Esc cancel), C clear, H stop, F/T/D/G ROE, S sonar, Y towed array, B sonobuoys." },
    anchor: "bottom-right",
  },
  {
    title: { zh: "戰報", en: "Engagement Log" },
    body: { zh: "底部左側：每個偵測 / 開火 / 命中 / 擊毀依時間滾動。",
            en: "Bottom-left: every detection / fire / hit / kill, scrolling in time order." },
    anchor: "bottom-left",
  },
  {
    title: { zh: "Plan Mode 擺單位", en: "Plan Mode — Place Units" },
    body: { zh: "☰ 選單 → Plan Mode：選陣營 + 單位種類 → 點地圖放單位；選中單位後可在控制台刪除。",
            en: "☰ menu → Plan Mode: pick side + unit kind, click the map to place; delete a selected unit from the console." },
    anchor: "left",
  },
  {
    title: { zh: "🤖 LLM 介接", en: "🤖 LLM Bridge" },
    body: { zh: "頂部列 LLM 鈕：給 LLM 看當前狀態 / 套用 LLM 產出的指令 / 啟用自動駕駛讓 AI 操控某一方。",
            en: "LLM button in the top bar: feed state JSON to an LLM, paste its commands back, or let an AI drive a side." },
    anchor: "top-right",
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
  const lang = useLang();

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
            <GraduationCap size={14} /> {t("Tutorial step")} {s.step + 1} / {STEPS.length}
          </span>
          <button onClick={finish} className="wg-btn" style={{
            background: "transparent", border: "none", color: "#94a3b8",
            cursor: "pointer", padding: 0,
          }}>
            <X size={16} />
          </button>
        </div>

        <h3 style={{ margin: "0 0 8px", fontSize: 24, fontWeight: 700, color: "#e2e8f0" }}>
          {step.title[lang]}
        </h3>
        <p style={{ margin: "0 0 16px", fontSize: 17, lineHeight: 1.6, color: "#cbd5e1" }}>
          {step.body[lang]}
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
            {t("Skip")}
          </button>

          <div style={{ display: "flex", gap: 6 }}>
            {s.step > 0 && (
              <button onClick={prev} className="wg-btn" style={{
                padding: "8px 14px",
                background: "rgba(148, 163, 184, 0.15)", color: "#cbd5e1",
                border: "1px solid rgba(148, 163, 184, 0.3)", borderRadius: 4,
                fontSize: 16, cursor: "pointer", fontFamily: "inherit",
              }}>
                {t("Previous")}
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
              {isLast ? t("Start (tutorial)") : t("Next")}
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
    case "top-left":      return { top: m + 56, left: m };
    case "top-center":    return { top: 110, left: "50%", transform: "translateX(-50%)" };
    case "top-right":     return { top: m + 56, right: m };
    case "left":          return { top: "40%", left: m };
    case "right":         return { top: "40%", right: m };
    case "bottom-left":   return { bottom: m + 196, left: m };
    case "bottom-center": return { bottom: m + 196, left: "50%", transform: "translateX(-50%)" };
    case "bottom-right":  return { bottom: m + 196, right: m };
  }
}

/** 給其他組件呼叫，重啟教學（重新從第 0 步） */
export function launchTutorial(): void {
  TUTORIAL_STEP_INDEX = 0;
  uiStore.setTutorialOpen(true);
}
