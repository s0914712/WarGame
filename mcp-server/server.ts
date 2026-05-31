#!/usr/bin/env node
/**
 * Taiwan Wargame MCP server (stdio transport).
 *
 * Exposes the headless sim engine via 7 tools so an LLM can:
 *   - list / load scenarios
 *   - step time forward, get state, issue commands
 *   - compute match score (red invasion scoring)
 *   - run autonomous benchmark across multiple LLM models
 *
 * Run: `node --import tsx ./server.ts`   or `tsx ./server.ts`
 * Self-test: `tsx ./server.ts --self-test`
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema, ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";

import {
  listScenarios, loadScenario, stepSim, getState,
  applyCommands, computeScore, runBenchmark,
} from "./adapters.ts";
import type { BenchmarkRequest, GetStateOpts } from "./adapters.ts";
import type { SideId } from "../src/wargame/types.ts";

const TOOL_DEFS = [
  {
    name: "list_scenarios",
    description: "List all available wargame scenarios with metadata (id, unit count, sides, tags).",
    inputSchema: { type: "object", properties: {}, additionalProperties: false },
  },
  {
    name: "load_scenario",
    description: "Load a scenario by id, reset the simulation, return initial state summary including briefing and victory conditions.",
    inputSchema: {
      type: "object",
      properties: { scenarioId: { type: "string", description: "id from list_scenarios" } },
      required: ["scenarioId"], additionalProperties: false,
    },
  },
  {
    name: "step",
    description: "Advance simulation time by N seconds. Returns events emitted, current sim time, and outcome if game ended.",
    inputSchema: {
      type: "object",
      properties: {
        dtSimSec: { type: "number", description: "How many sim seconds to advance (60 = 1 sim minute)" },
        returnEvents: { type: "boolean", default: true, description: "Include events emitted this step" },
      },
      required: ["dtSimSec"], additionalProperties: false,
    },
  },
  {
    name: "get_state",
    description: "Get current simulation state. Default returns LLM-friendly export (filterable by sideFilter, includes only what that side can see). For large scenarios use brief=true (1-line/unit), onlySides=['red'] and limit=20 to keep output small. Use full=true only when you really need raw engine state.",
    inputSchema: {
      type: "object",
      properties: {
        sideFilter: { type: "string", enum: ["blue", "red", "us", "japan", "neutral"], description: "Apply fog-of-war from this side's perspective (affects detectedByPlayer)" },
        full: { type: "boolean", default: false, description: "Return full engine state (large, no fog filter)" },
        brief: { type: "boolean", default: false, description: "Compress each unit to a 1-line summary (pos/hp/spd/hdg/fuel/det/wpts). Recommended for large scenarios." },
        limit: { type: "number", description: "Cap number of units returned (sorted by HP desc — keeps healthiest first)" },
        onlySides: { type: "array", items: { type: "string", enum: ["blue", "red", "us", "japan", "neutral"] }, description: "Restrict to these sides (e.g., ['red'] to see only enemy)" },
        bySideSummary: { type: "boolean", default: false, description: "When brief=true, also include per-side aggregate { count, totalHp, maxHp, avgFuelPct }" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "apply_commands",
    description: "Apply a wargame-commands-v1 JSON document (the schema the LLM produces). Returns applied/rejected counts and details.",
    inputSchema: {
      type: "object",
      properties: {
        commandsJson: { description: "A wargame-commands-v1 object (or its JSON string). Get schema via get_state then look at SCHEMA_DOC, or examine examples in src/wargame/llm/" },
      },
      required: ["commandsJson"], additionalProperties: false,
    },
  },
  {
    name: "compute_score",
    description: "Compute the match score for a given side (default red, for invasion scenarios). Returns breakdown: holds / kills / survivors / outcome.",
    inputSchema: {
      type: "object",
      properties: {
        sideId: { type: "string", enum: ["blue", "red", "us", "japan", "neutral"], default: "red" },
      },
      additionalProperties: false,
    },
  },
  {
    name: "run_benchmark",
    description: "Auto-run a scenario across multiple LLM models. Each model controls `sideId` (default red), engine pauses every `decisionIntervalSec` to call LLM for commands. Returns final scores per model. WARNING: makes real API calls — provide endpoint + apiKey.",
    inputSchema: {
      type: "object",
      properties: {
        scenarioId: { type: "string" },
        models: { type: "array", items: { type: "string" }, description: "e.g. ['claude-sonnet-4.5', 'deepseek-v4-flash', 'qwen3.5-9b']" },
        endpoint: { type: "string", description: "OpenAI-compatible chat completions URL, e.g. https://api.apertis.ai/v1/chat/completions" },
        apiKey: { type: "string", description: "Bearer API key" },
        sideId: { type: "string", enum: ["blue", "red", "us", "japan", "neutral"], default: "red" },
        maxSimSec: { type: "number", default: 5400, description: "Sim time cap (90 min)" },
        decisionIntervalSec: { type: "number", default: 60, description: "Sim seconds between LLM calls" },
        runsPerModel: { type: "number", default: 1 },
        temperature: { type: "number", default: 0.5 },
        verbose: { type: "boolean", default: false, description: "Log progress to stderr" },
      },
      required: ["scenarioId", "models", "endpoint", "apiKey"], additionalProperties: false,
    },
  },
] as const;

// ── self-test path: skip MCP, just verify imports work ──
if (process.argv.includes("--self-test")) {
  const scenarios = listScenarios();
  process.stdout.write(`✓ ${scenarios.length} scenarios loaded\n`);
  const first = scenarios[0];
  if (first) {
    const loaded = loadScenario(first.id);
    process.stdout.write(`✓ loaded "${loaded.scenarioId}" — ${loaded.unitCount} units\n`);
    const stepped = stepSim(60);
    process.stdout.write(`✓ stepped 60s → simTime=${stepped.simTimeSec}\n`);
    const score = computeScore("red");
    process.stdout.write(`✓ score=${score.total} (${score.outcomeLabel})\n`);
  }
  process.stdout.write("\nSelf-test passed. Tools registered: " + TOOL_DEFS.map(t => t.name).join(", ") + "\n");
  process.exit(0);
}

// ── normal path: MCP stdio server ──
const server = new Server(
  { name: "wargame", version: "0.1.0" },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOL_DEFS }));

server.setRequestHandler(CallToolRequestSchema, async (req) => {
  const name = req.params.name;
  const args = (req.params.arguments ?? {}) as Record<string, unknown>;
  try {
    let result: unknown;
    switch (name) {
      case "list_scenarios":   result = listScenarios(); break;
      case "load_scenario":    result = loadScenario(String(args.scenarioId)); break;
      case "step":             result = stepSim(Number(args.dtSimSec), { returnEvents: args.returnEvents !== false }); break;
      case "get_state": {
        const o: GetStateOpts = {
          sideFilter: args.sideFilter as SideId | undefined,
          full: Boolean(args.full),
          brief: Boolean(args.brief),
          bySideSummary: Boolean(args.bySideSummary),
        };
        if (typeof args.limit === "number") o.limit = args.limit;
        if (Array.isArray(args.onlySides)) o.onlySides = args.onlySides as SideId[];
        result = getState(o);
        break;
      }
      case "apply_commands":   result = applyCommands(args.commandsJson as string | object); break;
      case "compute_score":    result = computeScore((args.sideId ?? "red") as Parameters<typeof computeScore>[0]); break;
      case "run_benchmark":    result = await runBenchmark(args as unknown as BenchmarkRequest); break;
      default:
        throw new Error(`Unknown tool: ${name}`);
    }
    return {
      content: [{ type: "text", text: JSON.stringify(result, null, 2) }],
    };
  } catch (e) {
    return {
      content: [{ type: "text", text: `Error: ${(e as Error).message}` }],
      isError: true,
    };
  }
});

const transport = new StdioServerTransport();
await server.connect(transport);
process.stderr.write("wargame MCP server ready (stdio)\n");
