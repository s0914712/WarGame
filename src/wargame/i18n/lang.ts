/**
 * Lang store — 中文(zh) / 英文(en) 切換，持久化到 localStorage。
 *
 * 設計原則：
 *   - 字典不完整 OK — fallback 順序 dict[lang][key] → dict.zh[key] → key 本身。
 *     未翻譯的字串會直接顯示 key（通常是中文原字），UI 不會破。
 *   - 只翻 high-traffic surfaces（HUD / picker / briefing / panel headers / tabs）。
 *     單位名稱 / scenario briefing 內文等保留原語，避免巨量 dict 維護成本。
 *
 * 用法：
 *   import { t, langStore, useLang } from "../wargame/i18n/lang";
 *   t("Pause")                              // 純函式，讀當前 lang
 *   const lang = useLang();                  // React hook，會 re-render
 */
export type Lang = "zh" | "en";

const STORAGE_KEY = "wargame.lang.v1";

function load(): Lang {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === "en" || raw === "zh") return raw;
  } catch { /* private mode */ }
  // 預設依瀏覽器語系 — 非中文一律 en
  const nav = typeof navigator !== "undefined" ? navigator.language : "";
  return nav.toLowerCase().startsWith("zh") ? "zh" : "en";
}

let current: Lang = load();
const listeners = new Set<() => void>();

export const langStore = {
  get(): Lang { return current; },
  set(lang: Lang): void {
    if (lang === current) return;
    current = lang;
    try { localStorage.setItem(STORAGE_KEY, lang); } catch { /* ignore */ }
    for (const cb of listeners) cb();
  },
  toggle(): void { this.set(current === "zh" ? "en" : "zh"); },
  subscribe(cb: () => void): () => void {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
};

// ── 字典 ─────────────────────────────────────────────────
// key 用「英文短語 + 視需要的 ::scope 後綴」。Scope 用來消歧義（如 Reset 在不同地方語境不同）。
type Dict = Record<string, string>;

const ZH: Dict = {
  // HUD / clock
  "Pause": "暫停",
  "Resume": "繼續",
  "PAUSED": "已暫停",
  "Speed": "速率",
  "Lang::CN": "中",
  "Lang::EN": "EN",

  // Scenario
  "Scenario": "場景",
  "Briefing": "簡報",
  "Start": "開始",
  "Reset": "重置",
  "Victory Conditions": "勝利條件",
  "Sides": "陣營",
  "Units": "單位",

  // Welcome / mode
  "Welcome": "歡迎",
  "Plan Mode": "Plan 模式",
  "Scenario Mode": "戰役模式",
  "Tutorial": "教學",
  "Choose your role": "選擇你的陣營",
  "Free placement, no enemies": "自由擺放、無敵方",
  "Pick a side and fight": "選邊作戰",

  // LLM panel
  "LLM Bridge": "LLM 介接",
  "Current State": "當前狀態",
  "Apply Commands": "套用指令",
  "Schema": "Schema",
  "AI Autopilot": "自動駕駛",
  "Scoreboard": "比分",
  "Copy": "複製",
  "Execute": "執行",
  "Load Example": "載入範例",
  "Test Call (no commands applied)": "測試呼叫（不會套用指令）",
  "Reset to .env": "重設為 .env",
  "Model": "Model",
  "Endpoint": "Endpoint",
  "API Key": "API Key",
  "Temperature": "Temperature",
  "Decision interval (sim sec)": "決策間隔（sim sec）",
  "AI Mode": "AI 模式",
  "Controlled side": "控制陣營",
  "Enable AI Adversary": "啟用 AI Adversary",

  // Engagement log / generic
  "Engagement Log": "戰報",
  "Close": "關閉",
  "Cancel": "取消",
  "OK": "確定",
  "Apply": "套用",
  "Delete": "刪除",
  "Save": "儲存",
  "Load": "載入",
  "Back": "返回",
  "Yes": "是",
  "No": "否",
  "Confirm": "確認",

  // Unit Editor Panel
  "Side": "陣營",
  "Type": "類型",
  "Fuel": "油料",
  "Ammo": "彈藥",
  "Plan Route": "規劃航線",
  "Plan Route Mode": "規劃航線模式",
  "Plan Route Mode hint": "點擊地圖加航點 · Backspace 移除上一點 · Enter 套用 · Esc 取消",
  "waypoints": "個航點",
  "remaining fuel": "剩餘油料",
  "Clear Route": "清除航線",
  "Delete Unit": "刪除單位",
  "Current Route": "目前航線",
  "Apply with N": "套用",

  // Slider labels (core attributes)
  "Range (km)": "射程 (km)",
  "Speed (kn)": "速率 (kn)",
  "Movement (km)": "航程 (km)",
  "Detection (km)": "偵測距離 (km)",
  "HP": "耐損值",

  // Replay panel
  "Record": "錄製",
  "Stop & download": "結束並下載",
  "snapshots": "張",
  "prev": "上一張",
  "next": "下一張",
  "exit": "退出",
  "Exit replay": "退出 replay 回到場景",
  "Start recording": "開始錄製當前場景",
  "Load replay": "載入 .json replay 檔",

  // Tutorial
  "Tutorial step": "教學",
  "Skip": "跳過",
  "Previous": "上一步",
  "Next": "下一步",
  "Start (tutorial)": "開始",

  // Scenario Briefing modal sections
  "Mission Briefing": "任務說明",
  "Initial Forces": "初始兵力",
  "Victory Conditions (priority)": "勝負條件（優先序）",
  "Total N units": "合計 N 單位",
  "Open Tutorial": "打開教學",
  "Show Chinese original": "顯示中文原文",
  "Show English": "顯示英文",
};

// 英文是 key 本身；只放需要美化的（如 PAUSED 維持全大寫）
const EN: Dict = {
  "PAUSED": "PAUSED",
};

const DICTS: Record<Lang, Dict> = { zh: ZH, en: EN };

/** 同步取譯文。lang 不傳就讀 store。 */
export function t(key: string, lang?: Lang): string {
  const L = lang ?? current;
  return DICTS[L][key] ?? (L === "zh" ? ZH[key] ?? key : key);
}

/**
 * React hook — re-render on lang change.
 * 為了避免 useSyncExternalStore 在 SSR 不存在，這裡簡單 useState + 訂閱。
 */
import { useEffect, useState } from "react";
export function useLang(): Lang {
  const [lang, setLang] = useState<Lang>(current);
  useEffect(() => langStore.subscribe(() => setLang(langStore.get())), []);
  return lang;
}
