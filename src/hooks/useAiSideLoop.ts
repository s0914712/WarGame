/**
 * AI Adversary loop — 週期性把 AI 方 state 餵 LLM、套回指令。
 *
 * 觸發條件：
 *   1. aiConfig.enabled = true
 *   2. apiKey 非空
 *   3. 上次呼叫至今 simTime 已經過 intervalSimSec
 *   4. 沒有 in-flight 請求
 *   5. clock 沒暫停（暫停時不該推進敵方）
 *
 * 流程：
 *   - 用 buildStateExport(aiSide) 拿 AI 視角 state（過濾 FoW）
 *   - 呼叫 LLM
 *   - 解析 JSON → applyLlmCommands({ pauseFirst: false, sideFilter: aiSide })
 *   - 寫狀態回 aiConfigStore.status
 */
import { useEffect } from "react";
import { wargameClock } from "../wargame/clock";
import { aiConfigStore } from "../wargame/llm/aiConfig";
import { buildStateExport } from "../wargame/llm/exportState";
import { callLlm, extractJson } from "../wargame/llm/aiClient";
import { applyLlmCommands } from "../wargame/llm/applyCommands";
import { SCHEMA_DOC } from "../wargame/llm/schemaDoc";
import { runScriptedAiTick } from "../wargame/ai/scriptedAi";
import type { LlmCommandResult } from "../wargame/llm/schema";

const CHECK_INTERVAL_MS = 1000;  // 每秒檢查一次條件，不必每幀

export function useAiSideLoop() {
  useEffect(() => {
    let lastCallSimSec = -Infinity;
    let inFlight = false;
    let abortCtrl: AbortController | null = null;

    const tick = async () => {
      const cfg = aiConfigStore.getConfig();
      if (!cfg.enabled || inFlight) return;
      if (cfg.mode === "llm" && !cfg.apiKey.trim()) return;
      if (wargameClock.isPaused()) return;
      const simSec = wargameClock.getSimTime();
      if (simSec - lastCallSimSec < cfg.intervalSimSec) return;

      lastCallSimSec = simSec;
      inFlight = true;
      aiConfigStore.setStatus({
        inFlight: true,
        lastCallSimSec: simSec,
        lastCallWallTime: Date.now(),
        lastError: null,
      });

      // ── 腳本模式：純規則，同步執行 ──
      if (cfg.mode === "scripted") {
        const r = runScriptedAiTick(cfg.sideId);
        const result: LlmCommandResult = {
          version: "wargame-result-v1",
          summary: { submitted: r.commandsIssued, applied: r.commandsIssued, rejected: 0 },
          results: r.details.map((msg, i) => ({ index: i, status: "applied" as const, warnings: [msg] })),
        };
        aiConfigStore.setStatus({
          inFlight: false,
          lastResult: result,
          lastResponseRaw: `[scripted]\n${r.details.join("\n")}`,
        });
        inFlight = false;
        return;
      }

      try {
        const stateForLlm = buildStateExport(cfg.sideId);
        const systemPrompt = `${SCHEMA_DOC}

---

# Adversary instructions

You are an autonomous wargame commander controlling side **${cfg.sideId}**.
Every ${cfg.intervalSimSec} sim seconds you'll be invoked to plan moves.
Output a SHORT, decisive commands document.
Prefer 1-3 commands per call. Don't overwhelm with bulk moves.
Focus on: positioning own forces, engaging detected hostiles, evading threats.`;

        const userPrompt = `Current battlefield state (your POV: ${cfg.sideId}):

\`\`\`json
${JSON.stringify(stateForLlm, null, 2)}
\`\`\`

Output ONLY a JSON commands document (no prose, no markdown).`;

        abortCtrl = new AbortController();
        const { content, raw } = await callLlm(cfg, systemPrompt, userPrompt, abortCtrl.signal);

        const parsed = extractJson(content);
        const result = applyLlmCommands(parsed, {
          pauseFirst: false,
          sideFilter: cfg.sideId,
        });

        aiConfigStore.setStatus({
          inFlight: false,
          lastResult: result,
          lastResponseRaw: typeof content === "string" ? content : JSON.stringify(raw).slice(0, 1000),
        });
      } catch (e) {
        if ((e as Error).name !== "AbortError") {
          aiConfigStore.setStatus({
            inFlight: false,
            lastError: (e as Error).message,
          });
        }
      } finally {
        inFlight = false;
      }
    };

    const interval = window.setInterval(tick, CHECK_INTERVAL_MS);
    return () => {
      window.clearInterval(interval);
      abortCtrl?.abort();
    };
  }, []);
}
