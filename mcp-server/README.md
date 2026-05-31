# Wargame MCP Server

Headless sim engine exposed as MCP tools. Two use modes:

1. **Claude (or any MCP client) plays the wargame interactively** — call `load_scenario` → `step` → `apply_commands` → `compute_score` in a loop, decide moves yourself.
2. **Autonomous benchmark across N models** — call `run_benchmark` with a list of model names, an OpenAI-compatible endpoint, and API key. Each model plays the scenario solo; final scores returned.

## Setup

```bash
cd mcp-server
npm install
npx tsx server.ts --self-test    # verify imports + 60s tick works
```

Then in Claude Code (project-root `.mcp.json` already wired):

```
/mcp
```

You should see the `wargame` server with 7 tools.

## Tools

| Tool | Purpose |
|------|---------|
| `list_scenarios` | enumerate the 7 built-in scenarios |
| `load_scenario` | load + reset, returns briefing + victory conditions |
| `step` | advance N sim-seconds, returns events emitted |
| `get_state` | LLM-friendly state JSON (filterable by side; `full=true` for raw engine state) |
| `apply_commands` | apply a `wargame-commands-v1` document |
| `compute_score` | match score for a side (default `red`) — breakdown of holds/kills/survivors |
| `run_benchmark` | auto-run scenario across N models, return final scores per model |

## Benchmark example

```jsonc
// Tool: run_benchmark
{
  "scenarioId": "invasion_h_hour_2030",
  "models": ["claude-sonnet-4.5", "deepseek-v4-flash", "qwen3.5-9b"],
  "endpoint": "https://api.apertis.ai/v1/chat/completions",
  "apiKey": "sk-...",
  "sideId": "red",
  "decisionIntervalSec": 60,
  "maxSimSec": 5400,
  "runsPerModel": 1,
  "verbose": true
}
```

Returns one object per model with `runs[]` and `averageScore`.

## Notes

- **No browser dependencies**: imports from `src/wargame/*` only, which is pure TS.
- **State is process-global** across MCP calls — `load_scenario` resets, `step` mutates. One MCP session = one ongoing game.
- **LLM call in benchmark** uses OpenAI-compatible format only (Apertis, OpenRouter, OpenAI, vLLM, etc). Anthropic Messages API not implemented in the benchmark loop — use OpenAI-compatible passthrough.
- **Determinism**: engine has an LCG RNG, so identical seed + identical commands = identical outcome. LLM stochasticity dominates in practice; benchmark with `runsPerModel: 3+` for meaningful averages.
- **CORS** is not a concern here — Node `fetch` doesn't do preflight.
