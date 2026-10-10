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
 * 流程（LLM 模式，見 llm/adversary.ts）：
 *   - buildAdversaryPrompts：精簡、符合戰爭迷霧的戰場摘要 + 任務目標 + 上回合記憶
 *   - 呼叫 LLM → 解析 assessment（戰場研判）與各指令 reason
 *   - applyLlmCommands({ sideFilter, repairRoutes, forbidAttributeEdits })
 *   - 研判 / 指令 / 結果寫回 aiConfigStore.status；意圖與被拒原因留作下回合記憶
 */
import { useEffect } from "react";
import { wargameClock } from "../wargame/clock";
import { aiConfigStore } from "../wargame/llm/aiConfig";
import { callLlm, extractJson } from "../wargame/llm/aiClient";
import { applyLlmCommands } from "../wargame/llm/applyCommands";
import {
  buildAdversaryPrompts, parseAdversaryResponse, nextMemory, ordersView, type AdversaryMemory,
} from "../wargame/llm/adversary";
import { scenarioStore } from "../wargame/scenarioStore";
import { runScriptedAiTick } from "../wargame/ai/scriptedAi";
import { runScriptedAiV2Tick } from "../wargame/ai/scriptedAiV2";
import type { LlmCommandResult } from "../wargame/llm/schema";
import { netStore } from "../wargame/net/netStore";

const CHECK_INTERVAL_MS = 1000;  // 每秒檢查一次條件，不必每幀

export function useAiSideLoop() {
  useEffect(() => {
    let lastCallSimSec = -Infinity;
    let memory: AdversaryMemory | null = null;
    let memoryScenario = "";
    let inFlight = false;
    let abortCtrl: AbortController | null = null;

    const tick = async () => {
      const cfg = aiConfigStore.getConfig();
      if (!cfg.enabled || inFlight) return;
      // 多人：AI 只在 host 跑，且不操作已被玩家認領的陣營
      if (netStore.isClient()) return;
      if (netStore.isHost() && netStore.claimedSides().includes(cfg.sideId)) return;
      if (cfg.mode === "llm" && !cfg.apiKey.trim()) return;
      if (wargameClock.isPaused()) return;
      const simSec = wargameClock.getSimTime();
      // 換場景 / 重新開始（時間倒退）→ 重設節奏與記憶，否則 AI 會一直等到超過舊的呼叫時刻
      const scenId = scenarioStore.getState().scenario.id;
      if (simSec < lastCallSimSec || scenId !== memoryScenario) {
        lastCallSimSec = -Infinity;
        memory = null;
        memoryScenario = scenId;
      }
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
      if (cfg.mode === "scripted" || cfg.mode === "scripted_v2") {
        const r = cfg.mode === "scripted_v2"
          ? runScriptedAiV2Tick(cfg.sideId)
          : runScriptedAiTick(cfg.sideId);
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
        const { system, user } = buildAdversaryPrompts(cfg.sideId, { intervalSec: cfg.intervalSimSec, memory, strategy: cfg.strategy });
        abortCtrl = new AbortController();
        const { content, raw } = await callLlm(cfg, system, user, abortCtrl.signal);

        const turn = parseAdversaryResponse(extractJson(content));
        const result = applyLlmCommands(turn.doc, {
          pauseFirst: false,
          sideFilter: cfg.sideId,
          repairRoutes: true,
          forbidAttributeEdits: true,   // AI 不得直接改自己的屬性（等同作弊）
        });
        memory = nextMemory(turn, result);

        aiConfigStore.setStatus({
          inFlight: false,
          lastResult: result,
          lastAssessment: turn.assessment,
          lastOrders: ordersView(turn, result),
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
