/**
 * OpenAI-compatible LLM client（瀏覽器直連）。
 *
 * 支援的端點（同一份程式碼）：
 *   - OpenAI:     https://api.openai.com/v1/chat/completions
 *   - Anthropic:  https://api.anthropic.com/v1/messages（自動切 message format）
 *   - OpenRouter: https://openrouter.ai/api/v1/chat/completions
 *   - Ollama:     http://localhost:11434/v1/chat/completions
 *   - 自架 LiteLLM / vLLM 等
 *
 * 自動偵測：URL 含 "anthropic.com" → 改用 Messages API 格式
 */
import type { AiConfig } from "./aiConfig";

export interface LlmCallResult {
  content: string;
  raw: unknown;
}

function isAnthropicEndpoint(url: string): boolean {
  return url.includes("anthropic.com");
}

export async function callLlm(
  cfg: AiConfig,
  systemPrompt: string,
  userPrompt: string,
  signal?: AbortSignal,
): Promise<LlmCallResult> {
  const isAnthropic = isAnthropicEndpoint(cfg.endpoint);

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (isAnthropic) {
    headers["x-api-key"] = cfg.apiKey;
    headers["anthropic-version"] = "2023-06-01";
    headers["anthropic-dangerous-direct-browser-access"] = "true";
  } else {
    headers["Authorization"] = `Bearer ${cfg.apiKey}`;
  }

  const body = isAnthropic
    ? {
        model: cfg.model,
        max_tokens: 4096,
        temperature: cfg.temperature,
        system: systemPrompt,
        messages: [{ role: "user", content: userPrompt }],
      }
    : {
        model: cfg.model,
        temperature: cfg.temperature,
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        response_format: { type: "json_object" },
      };

  const res = await fetch(cfg.endpoint, {
    method: "POST",
    headers,
    body: JSON.stringify(body),
    signal,
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`LLM ${res.status}: ${text.slice(0, 300)}`);
  }

  const json = await res.json();

  let content: string | undefined;
  if (isAnthropic) {
    // Anthropic: { content: [{ type: "text", text: "..." }] }
    const block = Array.isArray(json.content) ? json.content.find((b: { type: string }) => b.type === "text") : null;
    content = block?.text;
  } else {
    // OpenAI: { choices: [{ message: { content: "..." } }] }
    content = json.choices?.[0]?.message?.content;
  }

  if (!content) throw new Error("LLM returned no content");
  return { content, raw: json };
}

/** 從 LLM 回應裡撈出 JSON 物件 — 容錯處理 markdown code block 包裹 */
export function extractJson(text: string): unknown {
  let s = text.trim();
  // 剝掉 ```json ... ``` / ``` ... ``` 包裝
  const fence = s.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/);
  if (fence) s = fence[1]!.trim();
  return JSON.parse(s);
}
