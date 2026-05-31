/**
 * MCP adapters — wrap engine + scenarioStore + LLM call for use from MCP server.
 *
 * 所有 state mutation 都走 scenarioStore.setState() / loadScenario()，跟 browser 路徑一致。
 * 不引入瀏覽器 API（DOM/Mapbox/Three.js）— 經 grep 驗證 src/wargame/ 是純 TS。
 */
import { SCENARIO_REGISTRY } from "../src/wargame/scenarios/registry.ts";
import { scenarioStore } from "../src/wargame/scenarioStore.ts";
import { step } from "../src/wargame/sim/engine.ts";
import { applyLlmCommands } from "../src/wargame/llm/applyCommands.ts";
import { buildStateExport } from "../src/wargame/llm/exportState.ts";
import { SCHEMA_DOC } from "../src/wargame/llm/schemaDoc.ts";
import { computeMatchScore } from "../src/wargame/sim/matchScore.ts";
import type { SideId } from "../src/wargame/types.ts";

// ── tool: list_scenarios ────────────────────────────────
export function listScenarios() {
  return SCENARIO_REGISTRY.map(e => ({
    id: e.scenario.id,
    displayName: e.scenario.displayName,
    durationSec: e.scenario.durationSec,
    unitCount: e.scenario.units.length,
    sides: e.scenario.sides.map(s => ({ id: s.id, displayName: s.displayName, ownership: s.ownership })),
    victoryConditions: e.scenario.victoryConditions.length,
    tags: e.tags ?? [],
    shortDescription: e.shortDescription,
  }));
}

// ── tool: load_scenario ─────────────────────────────────
export function loadScenario(scenarioId: string) {
  const entry = SCENARIO_REGISTRY.find(e => e.scenario.id === scenarioId);
  if (!entry) throw new Error(`Unknown scenarioId: ${scenarioId}. Use list_scenarios.`);
  scenarioStore.loadScenario(entry.scenario);
  const s = scenarioStore.getState();
  return {
    scenarioId: s.scenario.id,
    simTimeSec: s.simTimeSec,
    unitCount: Object.keys(s.units).length,
    sides: s.scenario.sides.map(side => ({ id: side.id, displayName: side.displayName })),
    victoryConditions: s.scenario.victoryConditions.map(vc => ({ kind: vc.kind, label: vc.label ?? "" })),
    briefing: s.scenario.briefing,
    camera: s.scenario.camera,
  };
}

// ── tool: step ──────────────────────────────────────────
export function stepSim(dtSimSec: number, opts: { returnEvents?: boolean } = {}) {
  const cur = scenarioStore.getState();
  const next = step(cur, dtSimSec);
  if (next !== cur) scenarioStore.setState(next);
  const out: Record<string, unknown> = {
    simTimeSec: next.simTimeSec,
    unitCountAlive: Object.keys(next.units).length,
    outcome: next.outcome,
  };
  if (opts.returnEvents !== false) {
    // 只回傳這段 step 內新發生的 events（eventsThisTick）
    out.events = next.eventsThisTick.map(ev => ({
      simAtSec: ev.simAtSec,
      kind: ev.kind,
      message: ev.message,
      attackerId: ev.attackerId,
      targetId: ev.targetId,
    }));
  }
  return out;
}

// ── tool: get_state ─────────────────────────────────────
export interface GetStateOpts {
  sideFilter?: SideId;
  full?: boolean;
  /** 預設 false：回 LLM-friendly export；true：每單位濃縮成 1 行字 */
  brief?: boolean;
  /** 限制每側 N 個單位（依 hp 降序）— 防止 90 單位場景吐 KB 級 JSON */
  limit?: number;
  /** 只回某些 side 的單位（["red"], ["blue","us"] 等）— 不指定 = 全部 */
  onlySides?: SideId[];
  /** brief mode 額外加 by_side summary */
  bySideSummary?: boolean;
}

interface BriefUnit {
  id: string;
  side: SideId;
  kind: string;
  callsign: string;
  pos: string;        // "lng,lat,alt"
  hp: string;         // "current/max"
  spd: number;        // knots
  hdg: number;        // deg
  fuel: string;       // "remainKm/maxKm"
  det?: string;       // 從 POV 看到的偵測狀態
  wpts: number;       // 剩餘 waypoints 數
}

export function getState(opts: GetStateOpts = {}) {
  // full mode: raw engine state
  if (opts.full) {
    const s = scenarioStore.getState();
    return {
      simTimeSec: s.simTimeSec,
      outcome: s.outcome,
      units: Object.values(s.units),
      pendingCommands: s.pendingCommands,
      holdProgress: s.holdProgress,
      missilesActive: s.missiles.length,
      wreckagesCount: s.wreckages.length,
    };
  }

  const exp = buildStateExport(opts.sideFilter);

  // 套 onlySides 過濾
  let units = exp.units;
  if (opts.onlySides?.length) {
    const set = new Set(opts.onlySides);
    units = units.filter(u => set.has(u.side as SideId));
  }

  // 套 limit（依 hp 降序，先給 LLM 看活得最好的單位 — 戰術上比較有意義）
  if (opts.limit && units.length > opts.limit) {
    units = [...units].sort((a, b) => b.hp.current - a.hp.current).slice(0, opts.limit);
  }

  // brief mode：壓成 1 行 / unit
  if (opts.brief) {
    const bs: BriefUnit[] = units.map(u => ({
      id: u.id,
      side: u.side as SideId,
      kind: u.kind,
      callsign: u.callsign,
      pos: `${u.position.lng.toFixed(3)},${u.position.lat.toFixed(3)},${u.position.altMeters}`,
      hp: `${u.hp.current}/${u.hp.max}`,
      spd: u.speedKnots,
      hdg: u.headingDeg,
      fuel: `${u.fuel.remainingKm}/${u.fuel.maxKm}`,
      det: u.detectedByPlayer !== "own" ? u.detectedByPlayer : undefined,
      wpts: u.waypoints.length,
    }));

    const out: Record<string, unknown> = {
      version: exp.version,
      scenario: exp.scenario,
      unitsShown: bs.length,
      unitsTotal: exp.units.length,
      units: bs,
    };

    if (opts.bySideSummary) {
      const summary: Record<string, { count: number; totalHp: number; maxHp: number; avgFuelPct: number }> = {};
      for (const u of exp.units) {
        const k = u.side;
        if (!summary[k]) summary[k] = { count: 0, totalHp: 0, maxHp: 0, avgFuelPct: 0 };
        summary[k]!.count += 1;
        summary[k]!.totalHp += u.hp.current;
        summary[k]!.maxHp += u.hp.max;
        summary[k]!.avgFuelPct += u.fuel.maxKm > 0 ? u.fuel.remainingKm / u.fuel.maxKm : 0;
      }
      for (const k of Object.keys(summary)) {
        summary[k]!.avgFuelPct = Math.round((summary[k]!.avgFuelPct / Math.max(1, summary[k]!.count)) * 100);
      }
      out.bySide = summary;
    }
    return out;
  }

  // 預設：原 LLM export（若有 onlySides/limit 套用後）
  return opts.onlySides?.length || opts.limit
    ? { ...exp, units, unitsTotal: exp.units.length }
    : exp;
}

// ── tool: apply_commands ────────────────────────────────
export function applyCommands(commandsJson: string | object) {
  const parsed = typeof commandsJson === "string" ? JSON.parse(commandsJson) : commandsJson;
  return applyLlmCommands(parsed);
}

// ── tool: compute_score ─────────────────────────────────
export function computeScore(sideId: SideId = "red") {
  return computeMatchScore(scenarioStore.getState(), sideId);
}

// ── tool: run_benchmark ─────────────────────────────────
export interface BenchmarkRequest {
  scenarioId: string;
  models: string[];
  endpoint: string;
  apiKey: string;
  sideId?: SideId;
  /** 跑到場景結束 or 這個 simSec 上限（預設 5400 = 90 min） */
  maxSimSec?: number;
  /** 每次推進多久 sim-time 後叫一次 LLM 出指令（預設 60） */
  decisionIntervalSec?: number;
  /** 每個 model 跑幾局取平均（預設 1） */
  runsPerModel?: number;
  temperature?: number;
  /** 是否在每次 step 之後印 progress 到 stderr（不影響 MCP stdout） */
  verbose?: boolean;
}

export interface BenchmarkRunResult {
  finalScore: number;
  outcome: { winner: string | null; reason: string } | null;
  simElapsedMin: number;
  llmCallsMade: number;
  llmErrors: number;
  applied: number;
  rejected: number;
}

export interface BenchmarkModelResult {
  model: string;
  runs: BenchmarkRunResult[];
  averageScore: number;
}

export async function runBenchmark(req: BenchmarkRequest): Promise<BenchmarkModelResult[]> {
  const sideId = req.sideId ?? "red";
  const maxSimSec = req.maxSimSec ?? 5400;
  const stepSec = req.decisionIntervalSec ?? 60;
  const runsPerModel = req.runsPerModel ?? 1;
  const temp = req.temperature ?? 0.5;
  const results: BenchmarkModelResult[] = [];

  for (const model of req.models) {
    const runs: BenchmarkRunResult[] = [];
    for (let r = 0; r < runsPerModel; r++) {
      if (req.verbose) process.stderr.write(`\n[benchmark] ${model} run ${r + 1}/${runsPerModel}\n`);
      loadScenario(req.scenarioId);
      let llmCalls = 0, llmErrs = 0, applied = 0, rejected = 0;
      while (true) {
        const s = scenarioStore.getState();
        if (s.outcome) break;
        if (s.simTimeSec - s.scenario.startSimTimeSec >= maxSimSec) break;

        // 推進 stepSec 秒
        const next = step(s, stepSec);
        if (next !== s) scenarioStore.setState(next);

        // 叫 LLM 決策
        try {
          const stateJson = JSON.stringify(buildStateExport(sideId)).slice(0, 6000);
          const userPrompt = `Current state:\n\`\`\`json\n${stateJson}\n\`\`\`\nReturn a single wargame-commands-v1 JSON.`;
          const sys = `${SCHEMA_DOC}\n\nYou control side ${sideId}.`;
          const content = await callLlmDirect({
            endpoint: req.endpoint, apiKey: req.apiKey, model, temperature: temp,
          }, sys, userPrompt);
          llmCalls += 1;
          try {
            const json = extractJsonLoose(content);
            const result = applyLlmCommands(json, { sideFilter: sideId });
            applied += result.summary.applied;
            rejected += result.summary.rejected;
          } catch (e) {
            if (req.verbose) process.stderr.write(`[benchmark] parse fail: ${(e as Error).message}\n`);
            rejected += 1;
          }
        } catch (e) {
          llmErrs += 1;
          if (req.verbose) process.stderr.write(`[benchmark] LLM error: ${(e as Error).message}\n`);
        }
      }
      const score = computeMatchScore(scenarioStore.getState(), sideId);
      runs.push({
        finalScore: score.total,
        outcome: scenarioStore.getState().outcome,
        simElapsedMin: score.simElapsedMin,
        llmCallsMade: llmCalls, llmErrors: llmErrs,
        applied, rejected,
      });
    }
    const avg = runs.reduce((acc, r) => acc + r.finalScore, 0) / Math.max(1, runs.length);
    results.push({ model, runs, averageScore: Math.round(avg * 10) / 10 });
  }
  return results;
}

// ── LLM call (OpenAI-compatible only, since Apertis is OpenAI-flavoured) ──
//   Note: aiClient.ts in src/ also handles Anthropic Messages format, but for
//   benchmark via Apertis we only need OpenAI-compatible.
async function callLlmDirect(
  cfg: { endpoint: string; apiKey: string; model: string; temperature: number },
  systemPrompt: string,
  userPrompt: string,
): Promise<string> {
  const res = await fetch(cfg.endpoint, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${cfg.apiKey}`,
    },
    body: JSON.stringify({
      model: cfg.model,
      temperature: cfg.temperature,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      // 不強制 response_format — 部分 model 不支援
    }),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`LLM ${res.status}: ${text.slice(0, 200)}`);
  }
  const json = await res.json() as { choices?: Array<{ message?: { content?: string } }> };
  const content = json?.choices?.[0]?.message?.content;
  if (!content) throw new Error("LLM returned no content");
  return content;
}

function extractJsonLoose(text: string): unknown {
  let s = text.trim();
  const fence = s.match(/^```(?:json)?\s*\n?([\s\S]*?)\n?```$/);
  if (fence) s = fence[1]!.trim();
  return JSON.parse(s);
}
