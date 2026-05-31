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
import { aiConfigStore, isUsingEnvDefaults } from "../wargame/llm/aiConfig";
import { scenarioStore } from "../wargame/scenarioStore";
import { callLlm } from "../wargame/llm/aiClient";

interface Props {
  open: boolean;
  onClose: () => void;
}

type Tab = "state" | "commands" | "schema" | "adversary";

export function LLMPanel({ open, onClose }: Props) {
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
            <span style={{ fontSize: 22, fontWeight: 600 }}>LLM 介接</span>
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
          {(["state", "commands", "schema", "adversary"] as Tab[]).map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              style={{
                flex: 1, padding: "10px 16px",
                background: t === tab ? "rgba(59, 130, 246, 0.12)" : "transparent",
                color: t === tab ? "#60a5fa" : "#94a3b8",
                border: "none",
                borderBottom: t === tab ? "2px solid #3b82f6" : "2px solid transparent",
                fontSize: 17, fontWeight: t === tab ? 600 : 400,
                cursor: "pointer",
              }}
            >
              {t === "state" && "1. 當前狀態"}
              {t === "commands" && "2. 套用指令"}
              {t === "schema" && "3. Schema"}
              {t === "adversary" && "4. 🤖 自動駕駛"}
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
            <option value="llm">LLM（呼叫 API）</option>
            <option value="scripted">Scripted（純規則，免 API）</option>
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
        <div style={{ fontSize: 14, color: "#64748b", marginTop: 4 }}>
          常用：OpenAI / Anthropic (https://api.anthropic.com/v1/messages) / OpenRouter / Ollama (http://localhost:11434/v1/chat/completions)
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

      {/* Model */}
      <div>
        <div style={{ fontSize: 15, color: "#94a3b8", marginBottom: 4, display: "flex", gap: 6, alignItems: "center" }}>
          Model
          {envSet.model && <EnvBadge />}
        </div>
        <input
          value={cfg.model}
          onChange={(e) => aiConfigStore.updateConfig({ model: e.target.value })}
          placeholder="gpt-4o-mini / gemma-4-31b-it:free / etc."
          style={inputStyle}
        />
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
          {cfg.mode === "scripted"
            ? "腳本模式可設低（5-30 sec），回應快"
            : "LLM 模式建議 60+ sec，避免 API rate limit"}
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
