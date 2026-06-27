/**
 * AI Adversary 設定 + 執行時狀態（持久化到 localStorage）。
 *
 * Config 由使用者調；Status 由 useAiSideLoop 寫入 — 兩者共用一個 store。
 */
import type { SideId } from "../types";
import type { LlmCommandResult } from "./schema";

export type AiMode = "llm" | "scripted" | "scripted_v2";

/**
 * Scripted AI v2 (QMIX-inspired) 的可調參數。
 * 6 個高階旋鈕 → 內部公式 weights。Default 對應原本 hardcode 值。
 */
export interface ScriptedV2Params {
  /** 攻擊性 0–2：threat_weight × range_bonus。↑ 推進更深 / 更願意吃對方火力 */
  aggression: number;
  /** HVU 優先 0–4：CVN/airbase/supply 加分。↑ 集火高價值目標 */
  hvuPriority: number;
  /** 協調強度 0–1：每多 1 隊伍打同目標的 penalty。↑ 分散打 / ↓ 群毆 */
  coordination: number;
  /** 收尾傾向 0–1.5：HP<40% 加分。↑ 優先打殘血 */
  finishing: number;
  /** 推進到射程的 % 0.5–1.0：0.8 = 推到 80% 射程處（留邊際） */
  approachPct: number;
  /** 自保 HP 門檻 0–0.5：HP 低於此 % 就 hold（不再衝） */
  selfPreserve: number;
}

export const DEFAULT_V2_PARAMS: ScriptedV2Params = {
  aggression: 1.0,
  hvuPriority: 2.0,
  coordination: 0.4,
  finishing: 0.6,
  approachPct: 0.80,
  selfPreserve: 0.25,
};

export interface AiConfig {
  enabled: boolean;
  mode: AiMode;           // llm = 呼叫 LLM API；scripted = 純規則引擎（不用 API key）
  endpoint: string;       // OpenAI-compatible chat completions URL
  apiKey: string;
  model: string;
  intervalSimSec: number; // 兩次決策之間的最短 sim-time 間隔
  sideId: SideId;         // AI 控制哪個陣營
  temperature: number;
  v2Params: ScriptedV2Params;  // Scripted v2 (QMIX-inspired) 的可調 weights
}

export interface AiStatus {
  inFlight: boolean;
  lastCallSimSec: number | null;
  lastCallWallTime: number | null;
  lastResult: LlmCommandResult | null;
  lastError: string | null;
  lastResponseRaw: string | null;
}

const STORAGE_KEY = "wargame.ai.config.v1";

/**
 * 從 Vite 環境變數讀預設值。VITE_ 前綴的會被 bundle 進 client。
 *
 * 安全規則：
 *   - production build：**絕對不要** 在 GitHub Secrets 設 VITE_LLM_API_KEY（會曝光）
 *   - 本機 dev：方便用 .env 預填 endpoint/model；apiKey 也只在本機 OK
 *   - production 環境下強制 ignore apiKey env，讓使用者一定要手動輸入
 */
function envDefaults(): Partial<AiConfig> {
  const env = (import.meta as ImportMeta).env ?? {};
  const isProd = env.PROD === true;
  return {
    endpoint: env.VITE_LLM_ENDPOINT,
    apiKey: isProd ? undefined : env.VITE_LLM_API_KEY,   // prod 絕不從 env 取 key
    model: env.VITE_LLM_MODEL,
  };
}

const DEFAULT_CONFIG: AiConfig = {
  enabled: false,
  mode: "llm",
  endpoint: "https://api.openai.com/v1/chat/completions",
  apiKey: "",
  model: "gpt-4o-mini",
  intervalSimSec: 60,
  sideId: "red",
  temperature: 0.5,
  v2Params: { ...DEFAULT_V2_PARAMS },
};

function loadFromStorage(): AiConfig {
  // 優先順序：localStorage（使用者改過）> env > hardcoded default
  // 如果 localStorage 的某欄位是空字串 → fallback 到 env
  const env = envDefaults();
  const envMerged: AiConfig = {
    ...DEFAULT_CONFIG,
    ...Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined && v !== "")),
  };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return envMerged;
    const parsed = JSON.parse(raw);
    // localStorage 空字串 fallback 到 env
    const merged: Record<string, unknown> = { ...envMerged };
    for (const [k, v] of Object.entries(parsed)) {
      if (typeof v === "string" && v.trim() === "") continue;
      merged[k] = v;
    }
    // 確保 v2Params 至少有預設（舊 localStorage 沒這欄）+ 缺欄補上
    const stored = (merged.v2Params ?? {}) as Partial<ScriptedV2Params>;
    merged.v2Params = { ...DEFAULT_V2_PARAMS, ...stored };
    return merged as unknown as AiConfig;
  } catch {
    return envMerged;
  }
}

export function isUsingEnvDefaults(): { endpoint: boolean; apiKey: boolean; model: boolean } {
  const env = envDefaults();
  return {
    endpoint: !!env.endpoint,
    apiKey: !!env.apiKey,
    model: !!env.model,
  };
}

function save(c: AiConfig) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(c));
  } catch {
    /* quota / private mode → silently ignore */
  }
}

let config: AiConfig = loadFromStorage();
let status: AiStatus = {
  inFlight: false,
  lastCallSimSec: null,
  lastCallWallTime: null,
  lastResult: null,
  lastError: null,
  lastResponseRaw: null,
};

const listeners = new Set<() => void>();
function notify() { for (const cb of listeners) cb(); }

export const aiConfigStore = {
  getConfig(): AiConfig { return config; },
  getStatus(): AiStatus { return status; },

  updateConfig(patch: Partial<AiConfig>): void {
    config = { ...config, ...patch };
    save(config);
    notify();
  },

  /** 清除 localStorage 覆寫值、回到 .env / default — 給 UI Reset 按鈕用 */
  resetToDefaults(): void {
    try {
      localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* private mode */
    }
    config = loadFromStorage();  // 重讀（會落回 env + default）
    notify();
  },

  setStatus(patch: Partial<AiStatus>): void {
    status = { ...status, ...patch };
    notify();
  },

  /** 一次重置（清狀態但不清 config） */
  resetStatus(): void {
    status = {
      inFlight: false,
      lastCallSimSec: null,
      lastCallWallTime: null,
      lastResult: null,
      lastError: null,
      lastResponseRaw: null,
    };
    notify();
  },

  subscribe(cb: () => void): () => void {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
};
