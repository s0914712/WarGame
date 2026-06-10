/**
 * 把 LLM 產出的 JSON 套用到 scenarioStore。
 *
 * 流程：
 *   1. 解析 + 驗證 version 與 commands array
 *   2. 對每個 command 走 type-specific 檢查
 *   3. set_waypoints 跑 validatePlan；error severity 直接 reject
 *   4. update_attributes 對照 catalog uiRanges 做 clamp（不 reject）
 *   5. 其他直接 enqueueCommand
 *   6. 統一回傳 LlmCommandResult
 *
 * 永遠回傳結果（不 throw），方便 LLM 自校。
 */
import { scenarioStore } from "../scenarioStore";
import { wargameClock } from "../clock";
import { UNIT_CATALOG } from "../catalog/units";
import { validatePlan } from "../sim/validate";
import type { Command, CoreAttributes, RoeMode, SideId } from "../types";

const VALID_ROE: RoeMode[] = ["weapons_free", "weapons_tight", "defensive_only", "weapons_hold"];
import {
  COMMANDS_VERSION,
  RESULT_VERSION,
  type LlmCommand,
  type LlmCommandDocument,
  type LlmCommandResult,
  type LlmCommandResultEntry,
} from "./schema";

export interface ApplyOptions {
  /** 套用前自動暫停 clock。預設 true；AI Adversary loop 傳 false（不該打斷玩家） */
  pauseFirst?: boolean;
  /** 限制只能命令指定陣營的單位（AI loop 用，避免越權） */
  sideFilter?: SideId;
}

export function applyLlmCommands(
  raw: unknown,
  opts: ApplyOptions = {},
): LlmCommandResult {
  const pauseFirst = opts.pauseFirst ?? true;
  const sideFilter = opts.sideFilter;

  // ── 1. document 層級驗證 ──
  const doc = raw as LlmCommandDocument;
  if (!doc || typeof doc !== "object") {
    return errResult([{ index: -1, status: "rejected", reason: "Input is not a JSON object" }], 0);
  }
  if (doc.version !== COMMANDS_VERSION) {
    return errResult(
      [{ index: -1, status: "rejected", reason: `Unsupported version "${doc.version}"; expected "${COMMANDS_VERSION}"` }],
      0,
    );
  }
  if (!Array.isArray(doc.commands)) {
    return errResult([{ index: -1, status: "rejected", reason: "Missing or invalid 'commands' array" }], 0);
  }

  if (pauseFirst) wargameClock.pause();

  // ── 2. 逐條套用 ──
  const results: LlmCommandResultEntry[] = doc.commands.map((cmd, i) => applyOne(cmd, i, sideFilter));

  const applied = results.filter((r) => r.status === "applied").length;
  const rejected = results.filter((r) => r.status === "rejected").length;

  return {
    version: RESULT_VERSION,
    summary: { submitted: doc.commands.length, applied, rejected },
    results,
  };
}

function errResult(results: LlmCommandResultEntry[], submitted: number): LlmCommandResult {
  return {
    version: RESULT_VERSION,
    summary: { submitted, applied: 0, rejected: results.length },
    results,
  };
}

function applyOne(cmd: LlmCommand, index: number, sideFilter?: SideId): LlmCommandResultEntry {
  if (!cmd || typeof cmd !== "object" || !("kind" in cmd)) {
    return { index, status: "rejected", reason: "Command missing 'kind'" };
  }
  if (!("unitId" in cmd) || typeof cmd.unitId !== "string") {
    return { index, status: "rejected", reason: "Command missing 'unitId'" };
  }

  const state = scenarioStore.getState();
  const unit = state.units[cmd.unitId];
  if (!unit) {
    return { index, status: "rejected", reason: `Unknown unitId "${cmd.unitId}"` };
  }
  if (sideFilter && unit.sideId !== sideFilter) {
    return {
      index, status: "rejected",
      reason: `Unit "${cmd.unitId}" belongs to side "${unit.sideId}", not "${sideFilter}"`,
    };
  }

  const currentSimSec = wargameClock.getSimTime();
  const execSimSec = currentSimSec + (("executeAtSimSec" in cmd && cmd.executeAtSimSec) || 0);

  switch (cmd.kind) {
    // ── set_waypoints：驗證後 enqueue ──
    case "set_waypoints": {
      if (!Array.isArray(cmd.waypoints)) {
        return { index, status: "rejected", reason: "'waypoints' must be an array" };
      }
      for (const wp of cmd.waypoints) {
        if (!Array.isArray(wp) || wp.length !== 2 ||
            typeof wp[0] !== "number" || typeof wp[1] !== "number") {
          return { index, status: "rejected", reason: "Each waypoint must be [lng, lat] numbers" };
        }
      }
      const validation = validatePlan(unit, cmd.waypoints, {
        currentSimSec,
        mustCompleteBySimSec: cmd.mustCompleteBySimSec,
      });
      if (!validation.ok) {
        return {
          index,
          status: "rejected",
          reason: validation.issues.find((x) => x.severity === "error")?.message ?? "Validation failed",
          issues: validation.issues,
        };
      }
      const id = makeCmdId();
      const queueCmd: Command = {
        id,
        unitId: cmd.unitId,
        simAtSec: execSimSec,
        kind: "set_waypoints",
        waypoints: cmd.waypoints,
        mustCompleteBySimSec: cmd.mustCompleteBySimSec,
      };
      scenarioStore.enqueueCommand(queueCmd);
      const warnings = validation.issues.filter((x) => x.severity === "warning").map((x) => x.message);
      return warnings.length > 0
        ? { index, status: "applied", commandId: id, warnings }
        : { index, status: "applied", commandId: id };
    }

    // ── set_speed ──
    case "set_speed": {
      if (typeof cmd.speedKnots !== "number" || cmd.speedKnots < 0) {
        return { index, status: "rejected", reason: "'speedKnots' must be a non-negative number" };
      }
      const range = UNIT_CATALOG[unit.kind].uiRanges.speedKnots;
      const clamped = clamp(cmd.speedKnots, range.min, range.max);
      const id = makeCmdId();
      scenarioStore.enqueueCommand({
        id, unitId: cmd.unitId, simAtSec: execSimSec, kind: "set_speed", speedKnots: clamped,
      });
      const warnings = clamped !== cmd.speedKnots
        ? [`speedKnots clamped ${cmd.speedKnots} → ${clamped} (allowed: ${range.min}–${range.max})`]
        : undefined;
      return warnings ? { index, status: "applied", commandId: id, warnings } : { index, status: "applied", commandId: id };
    }

    // ── engage ──
    case "engage": {
      if (typeof cmd.targetUnitId !== "string") {
        return { index, status: "rejected", reason: "'targetUnitId' must be a string" };
      }
      if (!state.units[cmd.targetUnitId]) {
        return { index, status: "rejected", reason: `Unknown targetUnitId "${cmd.targetUnitId}"` };
      }
      const id = makeCmdId();
      scenarioStore.enqueueCommand({
        id, unitId: cmd.unitId, simAtSec: execSimSec, kind: "engage", targetUnitId: cmd.targetUnitId,
      });
      return { index, status: "applied", commandId: id };
    }

    // ── hold ──
    case "hold": {
      const id = makeCmdId();
      scenarioStore.enqueueCommand({ id, unitId: cmd.unitId, simAtSec: execSimSec, kind: "hold" });
      return { index, status: "applied", commandId: id };
    }

    // ── set_roe ──
    case "set_roe": {
      if (!VALID_ROE.includes(cmd.roe)) {
        return {
          index, status: "rejected",
          reason: `'roe' must be one of ${VALID_ROE.join(" | ")}; got "${cmd.roe}"`,
        };
      }
      const id = makeCmdId();
      scenarioStore.enqueueCommand({
        id, unitId: cmd.unitId, simAtSec: execSimSec, kind: "set_roe", roe: cmd.roe,
      });
      return { index, status: "applied", commandId: id };
    }

    // ── update_attributes（直接寫，不走指令佇列）──
    case "update_attributes": {
      if (!cmd.core || typeof cmd.core !== "object") {
        return { index, status: "rejected", reason: "'core' must be an object" };
      }
      const catalog = UNIT_CATALOG[unit.kind];
      const warnings: string[] = [];
      for (const [k, v] of Object.entries(cmd.core)) {
        const key = k as keyof CoreAttributes;
        const range = catalog.uiRanges[key];
        if (!range) {
          warnings.push(`Unknown attribute "${k}" ignored`);
          continue;
        }
        if (typeof v !== "number") {
          warnings.push(`Attribute "${k}" must be number, got ${typeof v}; ignored`);
          continue;
        }
        const clamped = clamp(v, range.min, range.max);
        if (clamped !== v) {
          warnings.push(`"${k}" clamped ${v} → ${clamped} (allowed: ${range.min}–${range.max})`);
        }
        scenarioStore.updateUnitAttribute(cmd.unitId, key, clamped);
      }
      return warnings.length > 0
        ? { index, status: "applied", warnings }
        : { index, status: "applied" };
    }

    default: {
      // exhaustive check — TS 會抓
      const _exhaust: never = cmd;
      void _exhaust;
      return { index, status: "rejected", reason: `Unknown command kind` };
    }
  }
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function makeCmdId(): string {
  return `llm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
