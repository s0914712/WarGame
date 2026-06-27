# Wargame strategies (replayable command docs)

Each `*.json` here is a self-contained `wargame-commands-v1` document with `_meta`
describing the scenario, doctrine, and result. Because the sim is **deterministic**,
replaying a doc reproduces the exact same outcome.

## How replay works

`executeAtSimSec` is **relative to apply time** (engine:
`execSimSec = currentSimSec + executeAtSimSec`). So a whole-game script must be
applied **once at T+0**, right after `load_scenario`, before any `step`. Then the
`executeAtSimSec` values act as absolute sim-seconds.

`engage` targets do **not** need to be detected at apply time — detection is only
enforced at firing time — so you can queue all fire orders at T+0 while red is still
`hidden`.

### Recipe (MCP tools)

```text
1. load_scenario   { scenarioId: "<from _meta.scenario>" }
2. apply_commands  { commandsJson: <the {version, commands} part of the json> }   # at T+0
3. step            { dtSimSec: <scenario duration, e.g. 5400> }
4. compute_score   { sideId: "blue" }   and   { sideId: "red" }
```

> When passing to `apply_commands`, you can include `_meta` or strip it — the validator
> only reads `version` + `commands`.

## Index

| file | scenario | side | result |
|---|---|---|---|
| `blue_invasion_h_hour_v1.json` | invasion_h_hour_2030 | blue | LOSS (red wins T+90 tiebreaker, red residual hp 10750). All 3 landings denied (holds 0). Baseline. |

## v1 doctrine + why it loses (and what v2 should fix)

- **Doctrine:** mass 6× Hsiung Feng III (250 km) on the 075 LHAs; ships finish the south
  LPD; keep surface ships **held** at coastal standoff (`engage` makes ships charge into
  the SSN/055 screen and die); push one sub into the south lane; hold fighters.
- **Why it loses:**
  1. Red's opening DF-17/DF-26 + J-16 suppression kills ~4 of 6 launchers + 1 Patriot early.
  2. The 075/052D HHQ-9 umbrella shoots down anti-ship missiles; 2 surviving launchers
     can't sustain saturation.
  3. 51 vs 34 starting force — even an even kill-trade loses the residual tiebreaker.
- **v2 (TODO):** relocate/disperse the Hsiung Feng + Patriots in the first 60 s (they have
  ~60 kt mobility) to survive the DF first wave; then concentrate ALL shooters on the
  4× 052D + 4× 055 escorts **first** to collapse the air-defense umbrella before hitting
  transports. Need ~3:1 trade to overcome the force deficit.
