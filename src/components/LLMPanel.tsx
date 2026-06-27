/**
 * LLM 介接面板 — 三分頁 modal：
 *   - 當前狀態：複製 state JSON 給 LLM
 *   - 套用指令：貼上 LLM JSON、執行、看結果
 *   - Schema：複製 schema doc 給 LLM 當 system prompt
 */
import { useState, useSyncExternalStore } from "react";
import { buildStateExport } from "../wargame/llm/exportState";
import { applyLlmCommands } from "../wargame/llm/applyCommands";
import type { LlmCommandResult } from "../wargame/llm/schema";
import { SCHEMA_DOC } from "../wargame/llm/schemaDoc";
import { aiConfigStore, isUsingEnvDefaults, DEFAULT_V2_PARAMS, type ScriptedV2Params } from "../wargame/llm/aiConfig";
import { scenarioStore } from "../wargame/scenarioStore";
import { callLlm } from "../wargame/llm/aiClient";
import { computeMatchScore } from "../wargame/sim/matchScore";
import { leaderboardStore } from "../wargame/llm/leaderboard";
import { t, useLang } from "../wargame/i18n/lang";

// Apertis 統一 endpoint preset — 一個 base URL / API key，model 切換即可比 3 個
const APERTIS_ENDPOINT_DEV = "/llm-proxy/v1/chat/completions";   // Vite proxy
const APERTIS_ENDPOINT_PROD = "https://api.apertis.ai/v1/chat/completions";
const APERTIS_MODELS = ["claude-sonnet-4.5", "deepseek-v4-flash", "qwen3.5-9b"] as const;

interface Props {
  open: boolean;
  onClose: () => void;
}

type Tab = "state" | "commands" | "schema" | "adversary" | "scoreboard";

export function LLMPanel({ open, onClose }: Props) {
  useLang();  // re-render on language toggle
  const [tab, setTab] = useState<Tab>("state");
  const [commandsText, setCommandsText] = useState("");
  const [result, setResult] = useState<LlmCommandResult | null>(null);
  const [parseError, setParseError] = useState<string | null>(null);

  if (!open) return null;

  const stateJson = JSON.stringify(buildStateExport(), null, 2);

  const handleExecute = () => {
    setParseError(null);
    setResult(null);
    let parsed: unknown;
    try {
      parsed = JSON.parse(commandsText);
    } catch (e) {
      setParseError(`JSON parse error: ${e instanceof Error ? e.message : String(e)}`);
      return;
    }
    setResult(applyLlmCommands(parsed));
  };

  const copy = async (text: string) => {
    try { await navigator.clipboard.writeText(text); } catch { /* ignore */ }
  };

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 100,
        background: "rgba(2, 6, 23, 0.75)", backdropFilter: "blur(4px)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(960px, 92vw)", height: "min(720px, 88vh)",
          background: "#0f172a", border: "1px solid rgba(148, 163, 184, 0.3)",
          borderRadius: 12, color: "#e2e8f0",
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
          display: "flex", flexDirection: "column",
          boxShadow: "0 20px 60px rgba(0,0,0,0.6)",
        }}
      >
        {/* Header */}
        <div style={{
          padding: "14px 18px", borderBottom: "1px solid rgba(148, 163, 184, 0.2)",
          display: "flex", alignItems: "center", justifyContent: "space-between",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
            <span style={{ fontSize: 22, fontWeight: 600 }}>{t("LLM Bridge")}</span>
            <span style={{ fontSize: 15, color: "#94a3b8" }}>
              wargame v1 protocol
            </span>
          </div>
          <button
            onClick={onClose}
            style={{
              width: 28, height: 28, border: "none", background: "transparent",
              color: "#94a3b8", fontSize: 30, cursor: "pointer",
            }}
          >×</button>
        </div>

        {/* Tabs */}
        <div style={{
          display: "flex", borderBottom: "1px solid rgba(148, 163, 184, 0.15)",
        }}>
          {(["state", "commands", "schema", "adversary", "scoreboard"] as Tab[]).map((tabId) => (
            <button
              key={tabId}
              onClick={() => setTab(tabId)}
              style={{
                flex: 1, padding: "10px 16px",
                background: tabId === tab ? "rgba(59, 130, 246, 0.12)" : "transparent",
                color: tabId === tab ? "#60a5fa" : "#94a3b8",
                border: "none",
                borderBottom: tabId === tab ? "2px solid #3b82f6" : "2px solid transparent",
                fontSize: 17, fontWeight: tabId === tab ? 600 : 400,
                cursor: "pointer",
              }}
            >
              {tabId === "state" && `1. ${t("Current State")}`}
              {tabId === "commands" && `2. ${t("Apply Commands")}`}
              {tabId === "schema" && `3. ${t("Schema")}`}
              {tabId === "adversary" && `4. 🤖 ${t("AI Autopilot")}`}
              {tabId === "scoreboard" && `5. 🏆 ${t("Scoreboard")}`}
            </button>
          ))}
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflow: "hidden", display: "flex", flexDirection: "column" }}>
          {tab === "state" && (
            <StateTab json={stateJson} onCopy={() => copy(stateJson)} />
          )}
          {tab === "commands" && (
            <CommandsTab
              text={commandsText}
              onChange={setCommandsText}
              onExecute={handleExecute}
              parseError={parseError}
              result={result}
            />
          )}
          {tab === "schema" && (
            <SchemaTab text={SCHEMA_DOC} onCopy={() => copy(SCHEMA_DOC)} />
          )}
          {tab === "adversary" && <AdversaryTab />}
          {tab === "scoreboard" && <ScoreboardTab />}
        </div>
      </div>
    </div>
  );
}

// ── Tab: State ──────────────────────────────────────────
function StateTab({ json, onCopy }: { json: string; onCopy: () => void }) {
  return (
    <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10, height: "100%" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: 16, color: "#94a3b8" }}>
          複製這段 JSON 給 LLM 作為「當前戰場態勢」context
        </div>
        <button onClick={onCopy} style={primaryBtn}>複製 ({Math.round(json.length / 1024)} KB)</button>
      </div>
      <textarea
        readOnly
        value={json}
        style={{
          flex: 1, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: 15, lineHeight: 1.5, padding: 12,
          background: "#020617", color: "#cbd5e1",
          border: "1px solid rgba(148, 163, 184, 0.2)", borderRadius: 6, resize: "none",
        }}
      />
    </div>
  );
}

// ── Tab: Commands ───────────────────────────────────────
function CommandsTab({
  text, onChange, onExecute, parseError, result,
}: {
  text: string; onChange: (s: string) => void; onExecute: () => void;
  parseError: string | null; result: LlmCommandResult | null;
}) {
  return (
    <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10, height: "100%" }}>
      <div style={{ fontSize: 16, color: "#94a3b8" }}>
        把 LLM 產生的 commands JSON 貼到下方，按執行 — 套用前 clock 自動暫停。
      </div>
      <textarea
        value={text}
        onChange={(e) => onChange(e.target.value)}
        placeholder={EXAMPLE_COMMANDS}
        style={{
          flex: 1, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: 15, lineHeight: 1.5, padding: 12,
          background: "#020617", color: "#e2e8f0",
          border: "1px solid rgba(148, 163, 184, 0.2)", borderRadius: 6, resize: "none",
        }}
      />
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        <button onClick={onExecute} disabled={!text.trim()} style={{
          ...primaryBtn, opacity: text.trim() ? 1 : 0.4, cursor: text.trim() ? "pointer" : "not-allowed",
        }}>
          執行指令
        </button>
        <button onClick={() => onChange(EXAMPLE_COMMANDS)} style={secondaryBtn}>
          載入範例
        </button>
        {parseError && (
          <span style={{ fontSize: 15, color: "#fca5a5" }}>{parseError}</span>
        )}
      </div>

      {result && (
        <div style={{
          maxHeight: 200, overflow: "auto",
          padding: 10, background: "#020617",
          border: "1px solid rgba(148, 163, 184, 0.2)", borderRadius: 6,
        }}>
          <div style={{ fontSize: 16, marginBottom: 8 }}>
            <span style={{ color: "#a7f3d0" }}>✓ {result.summary.applied} applied</span>
            {result.summary.rejected > 0 && (
              <>{" · "}<span style={{ color: "#fca5a5" }}>✗ {result.summary.rejected} rejected</span></>
            )}
          </div>
          <pre style={{
            fontSize: 15, fontFamily: "ui-monospace, monospace",
            margin: 0, color: "#cbd5e1", whiteSpace: "pre-wrap",
          }}>
            {JSON.stringify(result, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

// ── Tab: Schema ─────────────────────────────────────────
function SchemaTab({ text, onCopy }: { text: string; onCopy: () => void }) {
  return (
    <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 10, height: "100%" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <div style={{ fontSize: 16, color: "#94a3b8" }}>
          把這份 schema 放進 LLM system prompt（一次貼上就好）
        </div>
        <button onClick={onCopy} style={primaryBtn}>複製 schema</button>
      </div>
      <textarea
        readOnly
        value={text}
        style={{
          flex: 1, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
          fontSize: 15, lineHeight: 1.5, padding: 12,
          background: "#020617", color: "#cbd5e1",
          border: "1px solid rgba(148, 163, 184, 0.2)", borderRadius: 6, resize: "none",
        }}
      />
    </div>
  );
}

// ── Tab: Adversary（紅方 LLM 自動駕駛） ─────────────────
function AdversaryTab() {
  // 訂閱 aiConfigStore (config + status)
  useSyncExternalStore(aiConfigStore.subscribe, aiConfigStore.getConfig, aiConfigStore.getConfig);
  const cfg = aiConfigStore.getConfig();
  const status = aiConfigStore.getStatus();
  const sides = scenarioStore.getState().scenario.sides;
  const envSet = isUsingEnvDefaults();
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<string>("");

  const handleTest = async () => {
    setTesting(true); setTestResult("");
    try {
      const stateForLlm = buildStateExport(cfg.sideId);
      const prompt = `Current state:\n\`\`\`json\n${JSON.stringify(stateForLlm).slice(0, 2000)}...\n\`\`\`\nReturn a tiny test commands JSON (single hold command on any of your units).`;
      const sys = `${SCHEMA_DOC}\n\nYou control side ${cfg.sideId}.`;
      const r = await callLlm(cfg, sys, prompt);
      setTestResult(`✓ 成功\n\n${r.content.slice(0, 600)}`);
    } catch (e) {
      setTestResult(`✗ 失敗\n\n${(e as Error).message}`);
    } finally {
      setTesting(false);
    }
  };

  return (
    <div style={{ padding: 16, overflow: "auto", height: "100%", display: "flex", flexDirection: "column", gap: 14 }}>
      {/* 開關 + 警告 */}
      <div style={{
        padding: 12, background: cfg.enabled ? "rgba(34, 197, 94, 0.12)" : "rgba(148, 163, 184, 0.1)",
        border: `1px solid ${cfg.enabled ? "rgba(34, 197, 94, 0.4)" : "rgba(148, 163, 184, 0.3)"}`,
        borderRadius: 6,
      }}>
        <label style={{ display: "flex", alignItems: "center", gap: 10, cursor: "pointer" }}>
          <input
            type="checkbox"
            checked={cfg.enabled}
            onChange={(e) => aiConfigStore.updateConfig({ enabled: e.target.checked })}
          />
          <span style={{ fontSize: 17, fontWeight: 600 }}>
            啟用 AI Adversary（LLM 自動操控 {sides.find(s => s.id === cfg.sideId)?.displayName ?? cfg.sideId} 方）
          </span>
        </label>
        <div style={{ fontSize: 14, color: "#fbbf24", marginTop: 6 }}>
          ⚠ API key 存在瀏覽器 localStorage — 僅供本機 demo 使用，**勿在共用電腦上設定**
        </div>
      </div>

      {/* AI 模式 + 控制陣營 */}
      <div style={{ display: "flex", gap: 12 }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 15, color: "#94a3b8", marginBottom: 4 }}>AI 模式</div>
          <select
            value={cfg.mode}
            onChange={(e) => aiConfigStore.updateConfig({ mode: e.target.value as typeof cfg.mode })}
            style={inputStyle}
          >
            <option value="llm">LLM（呼叫 API / LLM API）</option>
            <option value="scripted">Scripted v1（greedy nearest / basic）</option>
            <option value="scripted_v2">Scripted v2 QMIX-inspired（中央分配 + 角色 / centralized）</option>
          </select>
        </div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 15, color: "#94a3b8", marginBottom: 4 }}>控制陣營</div>
          <select
            value={cfg.sideId}
            onChange={(e) => aiConfigStore.updateConfig({ sideId: e.target.value as typeof cfg.sideId })}
            style={inputStyle}
          >
            {sides.map((s) => (
              <option key={s.id} value={s.id}>{s.displayName} ({s.id})</option>
            ))}
          </select>
        </div>
      </div>

      {/* LLM-only 設定（scripted 模式時收起） */}
      {cfg.mode === "llm" && <>
      <div>
        <div style={{ fontSize: 15, color: "#94a3b8", marginBottom: 4, display: "flex", gap: 6, alignItems: "center" }}>
          Endpoint URL（OpenAI compatible / Anthropic 都支援）
          {envSet.endpoint && <EnvBadge />}
        </div>
        <input
          value={cfg.endpoint}
          onChange={(e) => aiConfigStore.updateConfig({ endpoint: e.target.value })}
          placeholder="https://api.openai.com/v1/chat/completions"
          style={inputStyle}
        />
        <div style={{ display: "flex", gap: 6, marginTop: 4, alignItems: "center", flexWrap: "wrap" }}>
          <span style={{ fontSize: 14, color: "#64748b" }}>快速套用：</span>
          <button
            onClick={() => aiConfigStore.updateConfig({
              endpoint: (import.meta as ImportMeta).env?.DEV ? APERTIS_ENDPOINT_DEV : APERTIS_ENDPOINT_PROD,
            })}
            style={presetBtn}
            title="Apertis 統一 endpoint — dev 走 Vite proxy，prod 直連（注意 CORS）"
          >
            Apertis
          </button>
          <button
            onClick={() => aiConfigStore.updateConfig({ endpoint: "https://api.openai.com/v1/chat/completions" })}
            style={presetBtn}
          >
            OpenAI
          </button>
          <button
            onClick={() => aiConfigStore.updateConfig({ endpoint: "https://openrouter.ai/api/v1/chat/completions" })}
            style={presetBtn}
          >
            OpenRouter
          </button>
        </div>
      </div>

      {/* API Key */}
      <div>
        <div style={{ fontSize: 15, color: "#94a3b8", marginBottom: 4, display: "flex", gap: 6, alignItems: "center" }}>
          API Key
          {envSet.apiKey && <EnvBadge />}
        </div>
        <input
          type="password"
          value={cfg.apiKey}
          onChange={(e) => aiConfigStore.updateConfig({ apiKey: e.target.value })}
          placeholder="sk-..."
          style={inputStyle}
        />
      </div>

      {/* Model：Apertis 3 模型 dropdown + custom */}
      <div>
        <div style={{ fontSize: 15, color: "#94a3b8", marginBottom: 4, display: "flex", gap: 6, alignItems: "center" }}>
          Model
          {envSet.model && <EnvBadge />}
        </div>
        <div style={{ display: "flex", gap: 6 }}>
          <select
            value={(APERTIS_MODELS as readonly string[]).includes(cfg.model) ? cfg.model : "__custom__"}
            onChange={(e) => {
              const v = e.target.value;
              if (v !== "__custom__") aiConfigStore.updateConfig({ model: v });
            }}
            style={{ ...inputStyle, flex: "0 0 220px" }}
          >
            {APERTIS_MODELS.map((m) => (
              <option key={m} value={m}>{m}</option>
            ))}
            <option value="__custom__">Custom…</option>
          </select>
          <input
            value={cfg.model}
            onChange={(e) => aiConfigStore.updateConfig({ model: e.target.value })}
            placeholder="gpt-4o-mini / etc."
            style={{ ...inputStyle, flex: 1 }}
          />
        </div>
        <div style={{ fontSize: 14, color: "#64748b", marginTop: 4 }}>
          Apertis 三模型同一 endpoint / API key — 選好後切到「🏆 比分」tab 紀錄分數比較
        </div>
      </div>

      {/* Temperature（LLM only） */}
      <div>
        <div style={{ fontSize: 15, color: "#94a3b8", marginBottom: 4 }}>
          Temperature: {cfg.temperature.toFixed(2)}
        </div>
        <input
          type="range" min={0} max={1} step={0.05}
          value={cfg.temperature}
          onChange={(e) => aiConfigStore.updateConfig({ temperature: Number(e.target.value) })}
          style={{ width: "100%" }}
        />
      </div>
      </>}

      {/* Scripted v2 (QMIX-inspired) 可調參數 */}
      {cfg.mode === "scripted_v2" && <V2ParamsPanel />}

      {/* 通用：呼叫間隔 */}
      <div>
        <div style={{ fontSize: 15, color: "#94a3b8", marginBottom: 4 }}>
          決策間隔 (sim sec): {cfg.intervalSimSec}
        </div>
        <input
          type="range" min={5} max={600} step={5}
          value={cfg.intervalSimSec}
          onChange={(e) => aiConfigStore.updateConfig({ intervalSimSec: Number(e.target.value) })}
          style={{ width: "100%" }}
        />
        <div style={{ fontSize: 14, color: "#64748b", marginTop: 2 }}>
          {cfg.mode === "llm"
            ? "LLM 模式建議 60+ sec，避免 API rate limit"
            : "腳本模式可設低（5-30 sec），回應快"}
        </div>
      </div>

      {/* Test + Reset 按鈕 */}
      <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
        {cfg.mode === "llm" && (
          <button
            onClick={handleTest}
            disabled={testing || !cfg.apiKey.trim()}
            style={{ ...primaryBtn, opacity: (testing || !cfg.apiKey.trim()) ? 0.4 : 1 }}
          >
            {testing ? "測試中..." : "測試呼叫（不會套用指令）"}
          </button>
        )}
        <button
          onClick={() => {
            if (confirm("清掉本機 localStorage 設定、改用 .env 預設值？")) {
              aiConfigStore.resetToDefaults();
              setTestResult("");
            }
          }}
          style={{
            padding: "6px 14px", background: "rgba(148, 163, 184, 0.15)",
            color: "#cbd5e1", border: "1px solid rgba(148, 163, 184, 0.3)",
            borderRadius: 6, fontSize: 16, cursor: "pointer", fontFamily: "inherit",
          }}
          title="清掉 localStorage、回到 .env 預設值"
        >
          重設為 .env
        </button>
      </div>
      <div>
        {testResult && (
          <pre style={{
            marginTop: 8, padding: 10, background: "#020617",
            border: "1px solid rgba(148, 163, 184, 0.2)", borderRadius: 4,
            fontSize: 14, color: "#cbd5e1", maxHeight: 140, overflow: "auto",
            whiteSpace: "pre-wrap", margin: 0,
          }}>{testResult}</pre>
        )}
      </div>

      {/* Status */}
      <div style={{
        padding: 10, background: "#020617",
        border: "1px solid rgba(148, 163, 184, 0.2)", borderRadius: 6,
        fontSize: 15, fontFamily: "ui-monospace, monospace",
      }}>
        <div style={{ fontSize: 16, fontWeight: 600, marginBottom: 6, color: "#cbd5e1" }}>
          執行狀態 {status.inFlight && <span style={{ color: "#fbbf24" }}>🔄 呼叫中</span>}
        </div>
        <div style={{ color: "#94a3b8", lineHeight: 1.6 }}>
          上次呼叫：{status.lastCallSimSec !== null ? `T+${status.lastCallSimSec.toFixed(0)}s` : "—"}
          {status.lastCallWallTime && ` (${new Date(status.lastCallWallTime).toLocaleTimeString()})`}
        </div>
        {status.lastError && (
          <div style={{ color: "#fca5a5", marginTop: 4 }}>
            錯誤：{status.lastError}
          </div>
        )}
        {status.lastResult && (
          <div style={{ color: "#a7f3d0", marginTop: 4 }}>
            上次結果：套用 {status.lastResult.summary.applied} 條 / 拒絕 {status.lastResult.summary.rejected} 條
          </div>
        )}
      </div>
    </div>
  );
}

// ── Scripted v2 (QMIX-inspired) 可調參數面板 ─────────────
function V2ParamsPanel() {
  useSyncExternalStore(aiConfigStore.subscribe, aiConfigStore.getConfig, aiConfigStore.getConfig);
  const p = aiConfigStore.getConfig().v2Params;
  const set = (patch: Partial<ScriptedV2Params>) =>
    aiConfigStore.updateConfig({ v2Params: { ...p, ...patch } });

  // 6 sliders metadata
  const sliders: Array<{
    key: keyof ScriptedV2Params; label: string; hint: string;
    min: number; max: number; step: number;
  }> = [
    { key: "aggression",    label: "攻擊性 / Aggression",    hint: "↑ 推進更深 / 更願吃對方火力",
      min: 0,    max: 2,    step: 0.1 },
    { key: "hvuPriority",   label: "HVU 優先 / HVU Priority", hint: "CVN/airbase/supply 加分。↑ 集火高價值",
      min: 0,    max: 4,    step: 0.2 },
    { key: "coordination",  label: "協調強度 / Coordination", hint: "↑ 分散打 / ↓ 群毆同目標",
      min: 0,    max: 1,    step: 0.05 },
    { key: "finishing",     label: "收尾傾向 / Finishing",    hint: "↑ 優先打殘血（HP<40%）",
      min: 0,    max: 1.5,  step: 0.1 },
    { key: "approachPct",   label: "推進到射程的 % / Approach", hint: "0.8 = 推到 80% 射程處留邊際",
      min: 0.5,  max: 1.0,  step: 0.05 },
    { key: "selfPreserve",  label: "自保 HP 門檻 / Self-preserve", hint: "HP 低於此就 hold（不再衝）",
      min: 0,    max: 0.5,  step: 0.025 },
  ];

  return (
    <div style={{
      padding: 12, background: "rgba(99, 102, 241, 0.08)",
      border: "1px solid rgba(99, 102, 241, 0.3)", borderRadius: 6,
      display: "flex", flexDirection: "column", gap: 10,
    }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
        <span style={{ fontSize: 16, fontWeight: 600, color: "#a5b4fc" }}>
          ⚙ v2 QMIX-inspired utility 參數
        </span>
        <button
          onClick={() => set({ ...DEFAULT_V2_PARAMS })}
          style={{
            padding: "3px 10px", background: "rgba(148, 163, 184, 0.15)",
            color: "#cbd5e1", border: "1px solid rgba(148, 163, 184, 0.3)",
            borderRadius: 4, fontSize: 13, cursor: "pointer", fontFamily: "inherit",
          }}
        >重設為預設</button>
      </div>

      {sliders.map((s) => (
        <div key={s.key}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 14, marginBottom: 2 }}>
            <span style={{ color: "#cbd5e1" }}>{s.label}</span>
            <span style={{ color: "#e2e8f0", fontFamily: "ui-monospace, monospace" }}>
              {p[s.key].toFixed(s.step < 0.05 ? 3 : 2)}
            </span>
          </div>
          <input
            type="range" min={s.min} max={s.max} step={s.step}
            value={p[s.key]}
            onChange={(e) => set({ [s.key]: Number(e.target.value) } as Partial<ScriptedV2Params>)}
            style={{ width: "100%", accentColor: "#6366f1" }}
          />
          <div style={{ fontSize: 12, color: "#64748b", marginTop: 1 }}>{s.hint}</div>
        </div>
      ))}

      <div style={{ fontSize: 12, color: "#64748b", lineHeight: 1.4, marginTop: 4 }}>
        u = threat×aggression + hvu + role + range + finish − dist×0.7 − assigned×coordination
      </div>
    </div>
  );
}

// ── Tab: Scoreboard（多模型對戰比分） ───────────────────
function ScoreboardTab() {
  // 訂閱 scenarioStore（state 變即時更新分數）+ leaderboardStore
  useSyncExternalStore(scenarioStore.subscribe, scenarioStore.getState, scenarioStore.getState);
  useSyncExternalStore(leaderboardStore.subscribe, leaderboardStore.getEntries, leaderboardStore.getEntries);
  useSyncExternalStore(aiConfigStore.subscribe, aiConfigStore.getConfig, aiConfigStore.getConfig);

  const state = scenarioStore.getState();
  const cfg = aiConfigStore.getConfig();
  const entries = leaderboardStore.getEntries();
  const score = computeMatchScore(state, cfg.sideId);

  const handleRecord = () => {
    leaderboardStore.add({
      model: cfg.mode === "scripted" ? `scripted-v1 (${cfg.sideId})`
           : cfg.mode === "scripted_v2" ? `scripted-v2-qmix (${cfg.sideId})`
           : `${cfg.model} (${cfg.sideId})`,
      scenarioId: state.scenario.id,
      total: score.total,
      breakdown: score,
    });
  };

  // 排序：分數高 → 低
  const sorted = [...entries].sort((a, b) => b.total - a.total);

  return (
    <div style={{ padding: 16, overflow: "auto", height: "100%", display: "flex", flexDirection: "column", gap: 14 }}>
      {/* 當前場景 + AI side 標頭 */}
      <div style={{
        padding: 10, background: "rgba(59, 130, 246, 0.1)",
        border: "1px solid rgba(59, 130, 246, 0.3)", borderRadius: 6,
      }}>
        <div style={{ fontSize: 14, color: "#94a3b8" }}>當前場景</div>
        <div style={{ fontSize: 17, fontWeight: 600 }}>{state.scenario.displayName}</div>
        <div style={{ fontSize: 14, color: "#94a3b8", marginTop: 2 }}>
          AI 控制：{cfg.sideId} · Model：<code style={{ color: "#a5b4fc" }}>
            {cfg.mode === "scripted" ? "scripted-v1"
             : cfg.mode === "scripted_v2" ? "scripted-v2-qmix"
             : cfg.model}
          </code>
        </div>
      </div>

      {/* 即時分數卡 */}
      <div style={{
        padding: 14, background: "#020617",
        border: "1px solid rgba(148, 163, 184, 0.2)", borderRadius: 6,
        display: "flex", flexDirection: "column", gap: 8,
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "baseline" }}>
          <span style={{ fontSize: 15, color: "#94a3b8" }}>即時分數（T+{score.simElapsedMin} min）</span>
          <span style={{ fontSize: 36, fontWeight: 700, color: score.total >= 0 ? "#a7f3d0" : "#fca5a5" }}>
            {score.total}
          </span>
        </div>
        <div style={{ fontSize: 14, color: "#cbd5e1", lineHeight: 1.7 }}>
          <ScoreRow label="灘頭達成" value={`${score.holdsCompleted} 完成 + ${score.holdsInProgress} 進行中`} pts={score.holdScore} />
          <ScoreRow label="殲滅藍方" value={`${score.bluekills} 單位`} pts={score.bluekills * 2} />
          <ScoreRow label="殲滅美方" value={`${score.uskills} 單位`} pts={score.uskills} />
          <ScoreRow label="紅方倖存" value={`${score.redAlive} / ${score.redTotal}`} pts={score.survivorScore} />
          <ScoreRow label="結果" value={score.outcomeLabel} pts={score.outcomeScore} />
        </div>
        <button
          onClick={handleRecord}
          disabled={!cfg.model.trim()}
          style={{ ...primaryBtn, marginTop: 6, alignSelf: "flex-start" }}
          title="把當前分數加進排行榜（同 model 可多次紀錄）"
        >
          📌 紀錄此分數到排行榜
        </button>
      </div>

      {/* 排行榜 */}
      <div style={{
        padding: 12, background: "#020617",
        border: "1px solid rgba(148, 163, 184, 0.2)", borderRadius: 6,
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 8 }}>
          <span style={{ fontSize: 16, fontWeight: 600 }}>🏆 排行榜（{sorted.length}）</span>
          {entries.length > 0 && (
            <button
              onClick={() => { if (confirm("清空排行榜？")) leaderboardStore.clear(); }}
              style={secondaryBtn}
            >清空</button>
          )}
        </div>
        {sorted.length === 0 ? (
          <div style={{ fontSize: 14, color: "#64748b", padding: 12, textAlign: "center" }}>
            還沒有紀錄。跑完一局後點「紀錄此分數」加入。
          </div>
        ) : (
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 14 }}>
            <thead>
              <tr style={{ color: "#94a3b8", textAlign: "left" }}>
                <th style={th}>#</th>
                <th style={th}>Model</th>
                <th style={th}>場景</th>
                <th style={{ ...th, textAlign: "right" }}>分數</th>
                <th style={th}>結果</th>
                <th style={{ ...th, textAlign: "right" }}>T+min</th>
                <th style={th}></th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((e, i) => {
                const origIdx = entries.indexOf(e);
                return (
                  <tr key={`${e.ts}-${i}`} style={{ borderTop: "1px solid rgba(148, 163, 184, 0.1)" }}>
                    <td style={td}>{i + 1}</td>
                    <td style={{ ...td, fontFamily: "ui-monospace, monospace", color: "#a5b4fc" }}>{e.model}</td>
                    <td style={td}>{e.scenarioId}</td>
                    <td style={{ ...td, textAlign: "right", fontWeight: 600, color: e.total >= 0 ? "#a7f3d0" : "#fca5a5" }}>
                      {e.total}
                    </td>
                    <td style={td}>{e.breakdown.outcomeLabel.split("：")[0]}</td>
                    <td style={{ ...td, textAlign: "right", color: "#94a3b8" }}>{e.breakdown.simElapsedMin}</td>
                    <td style={td}>
                      <button
                        onClick={() => leaderboardStore.removeAt(origIdx)}
                        style={{ background: "transparent", border: "none", color: "#64748b", cursor: "pointer", fontSize: 14 }}
                        title="刪除這筆"
                      >×</button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      <div style={{ fontSize: 13, color: "#64748b", lineHeight: 1.5 }}>
        計分規則：+30/已成立灘頭、+15×進度/進行中、+2/藍殺、+1/美殺、+1/紅倖存、+50勝、-50敗、-10時限
      </div>
    </div>
  );
}

function ScoreRow({ label, value, pts }: { label: string; value: string; pts: number }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between" }}>
      <span><span style={{ color: "#94a3b8" }}>{label}：</span>{value}</span>
      <span style={{ color: pts >= 0 ? "#a7f3d0" : "#fca5a5", fontFamily: "ui-monospace, monospace" }}>
        {pts >= 0 ? "+" : ""}{pts}
      </span>
    </div>
  );
}

const th: React.CSSProperties = { padding: "4px 6px", fontSize: 14, fontWeight: 500 };
const td: React.CSSProperties = { padding: "6px", fontSize: 14 };
const presetBtn: React.CSSProperties = {
  padding: "2px 8px", background: "rgba(99, 102, 241, 0.15)",
  color: "#a5b4fc", border: "1px solid rgba(99, 102, 241, 0.4)",
  borderRadius: 4, fontSize: 13, cursor: "pointer", fontFamily: "ui-monospace, monospace",
};

function EnvBadge() {
  return (
    <span
      title="從 .env (VITE_LLM_*) 載入的預設值；可在欄位內覆寫"
      style={{
        fontSize: 13,
        padding: "1px 6px",
        background: "rgba(34, 197, 94, 0.18)",
        color: "#86efac",
        border: "1px solid rgba(34, 197, 94, 0.4)",
        borderRadius: 3,
        fontFamily: "ui-monospace, monospace",
      }}
    >
      .env
    </span>
  );
}

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "8px 10px",
  background: "#020617",
  color: "#e2e8f0",
  border: "1px solid rgba(148, 163, 184, 0.3)",
  borderRadius: 4,
  fontSize: 16,
  fontFamily: "ui-monospace, monospace",
  boxSizing: "border-box",
};

const EXAMPLE_COMMANDS = `{
  "version": "wargame-commands-v1",
  "commands": [
    {
      "kind": "set_waypoints",
      "unitId": "BLUE-SH-01",
      "waypoints": [[121.0, 25.0], [120.5, 24.5]],
      "mustCompleteBySimSec": 3600
    },
    {
      "kind": "set_speed",
      "unitId": "BLUE-SH-01",
      "speedKnots": 25
    }
  ]
}`;

const primaryBtn: React.CSSProperties = {
  padding: "6px 14px", background: "#3b82f6", color: "#fff",
  border: "none", borderRadius: 6, fontSize: 16, fontWeight: 600,
  cursor: "pointer", fontFamily: "inherit",
};

const secondaryBtn: React.CSSProperties = {
  padding: "6px 14px", background: "rgba(148, 163, 184, 0.15)",
  color: "#cbd5e1", border: "1px solid rgba(148, 163, 184, 0.3)",
  borderRadius: 6, fontSize: 16, cursor: "pointer", fontFamily: "inherit",
};
