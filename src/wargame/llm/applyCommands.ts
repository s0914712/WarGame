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
import { SUB_MAX_DEPTH_M } from "../sim/sonar";
import { getTerrainProbe } from "../sim/terrain";
import type { Command, CoreAttributes, LngLat, RoeMode, SideId, Unit } from "../types";

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
  /** 指令出口；預設 scenarioStore.enqueueCommand。多人玩家端傳 commandBus.submitCommand */
  enqueue?: (cmd: Command) => void;
  /** 禁止 update_attributes（多人模式：直接改屬性等同作弊，且 client 改了也會被 host 覆寫） */
  forbidAttributeEdits?: boolean;
  /**
   * 海上單位的航點落在陸地時，自動推到最近海面（回 warning）而不是整條拒絕。
   * AI 指揮官用：LLM 對海岸線的估計常差幾公里，整條拒絕會讓單位整回合原地不動。
   */
  repairRoutes?: boolean;
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
  const enqueue = opts.enqueue ?? ((c: Command) => scenarioStore.enqueueCommand(c));
  const results: LlmCommandResultEntry[] = doc.commands.map((cmd, i) =>
    applyOne(cmd, i, sideFilter, enqueue, opts.forbidAttributeEdits ?? false, opts.repairRoutes ?? false));

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

function applyOne(
  cmd: LlmCommand, index: number, sideFilter: SideId | undefined,
  enqueue: (cmd: Command) => void, forbidAttributeEdits: boolean, repairRoutes: boolean,
): LlmCommandResultEntry {
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

  // 權威時間取 engine state（Node / MCP 不會推進 wargameClock，讀 clock 會永遠是 T+0）
  const currentSimSec = state.simTimeSec;
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
      const repairNotes: string[] = [];
      if (repairRoutes) cmd.waypoints = repairSeaRoute(unit, cmd.waypoints, repairNotes);
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
      enqueue(queueCmd);
      const warnings = [...repairNotes, ...validation.issues.filter((x) => x.severity === "warning").map((x) => x.message)];
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
      enqueue({
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
      enqueue({
        id, unitId: cmd.unitId, simAtSec: execSimSec, kind: "engage", targetUnitId: cmd.targetUnitId,
      });
      return { index, status: "applied", commandId: id };
    }

    // ── hold ──
    case "hold": {
      const id = makeCmdId();
      enqueue({ id, unitId: cmd.unitId, simAtSec: execSimSec, kind: "hold" });
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
      enqueue({
        id, unitId: cmd.unitId, simAtSec: execSimSec, kind: "set_roe", roe: cmd.roe,
      });
      return { index, status: "applied", commandId: id };
    }

    // ── set_active_sonar ──
    case "set_active_sonar": {
      if (typeof cmd.on !== "boolean") {
        return { index, status: "rejected", reason: "'on' must be a boolean" };
      }
      const id = makeCmdId();
      enqueue({
        id, unitId: cmd.unitId, simAtSec: execSimSec, kind: "set_active_sonar", on: cmd.on,
      });
      return { index, status: "applied", commandId: id };
    }

    // ── set_towed_array ──
    case "set_towed_array": {
      if (typeof cmd.on !== "boolean") {
        return { index, status: "rejected", reason: "'on' must be a boolean" };
      }
      const id = makeCmdId();
      enqueue({
        id, unitId: cmd.unitId, simAtSec: execSimSec, kind: "set_towed_array", on: cmd.on,
      });
      return { index, status: "applied", commandId: id };
    }

    // ── set_depth（潛艦）──
    case "set_depth": {
      if (typeof cmd.depthM !== "number" || cmd.depthM < 0) {
        return { index, status: "rejected", reason: "'depthM' must be a non-negative number" };
      }
      if (UNIT_CATALOG[unit.kind].domain !== "subsurface") {
        return { index, status: "rejected", reason: `Unit "${cmd.unitId}" is not a submarine` };
      }
      const clamped = clamp(cmd.depthM, 0, SUB_MAX_DEPTH_M);
      const id = makeCmdId();
      enqueue({
        id, unitId: cmd.unitId, simAtSec: execSimSec, kind: "set_depth", depthM: clamped,
      });
      const warnings = clamped !== cmd.depthM
        ? [`depthM clamped ${cmd.depthM} → ${clamped} (allowed 0–${SUB_MAX_DEPTH_M})`]
        : undefined;
      return warnings ? { index, status: "applied", commandId: id, warnings } : { index, status: "applied", commandId: id };
    }

    // ── deploy_sonobuoys（反潛機佈放聲標屏幕）──
    case "deploy_sonobuoys": {
      const okCorner = (c: unknown): c is [number, number] =>
        Array.isArray(c) && c.length === 2 && typeof c[0] === "number" && typeof c[1] === "number";
      if (!okCorner(cmd.cornerA) || !okCorner(cmd.cornerB)) {
        return { index, status: "rejected", reason: "'cornerA'/'cornerB' must be [lng, lat]" };
      }
      if (typeof cmd.count !== "number" || cmd.count < 1) {
        return { index, status: "rejected", reason: "'count' must be a positive number" };
      }
      const id = makeCmdId();
      enqueue({
        id, unitId: cmd.unitId, simAtSec: execSimSec, kind: "deploy_sonobuoys",
        cornerA: cmd.cornerA, cornerB: cmd.cornerB,
        count: Math.min(64, Math.round(cmd.count)),
        ...(typeof cmd.mdrKm === "number" ? { mdrKm: cmd.mdrKm } : {}),
        ...(typeof cmd.lifetimeSec === "number" ? { lifetimeSec: cmd.lifetimeSec } : {}),
      });
      return { index, status: "applied", commandId: id };
    }

    // ── update_attributes（直接寫，不走指令佇列）──
    case "update_attributes": {
      if (forbidAttributeEdits) {
        return { index, status: "rejected", reason: "update_attributes is disabled in multiplayer" };
      }
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

/** 海上單位（禁陸）落在陸地的航點 → 沿 24 個方位往外找最近海面，再多留 3 km 離岸 */
function repairSeaRoute(unit: Unit, waypoints: LngLat[], notes: string[]): LngLat[] {
  const forbid = UNIT_CATALOG[unit.kind].constraints.forbidDomains ?? [];
  if (!forbid.includes("land") || forbid.includes("sea")) return waypoints;
  const probe = getTerrainProbe();
  return waypoints.map((wp, i) => {
    const [lng, lat] = wp;
    if (!probe.isLand(lng, lat)) return wp;
    const kLng = 111 * Math.cos((lat * Math.PI) / 180);
    for (let km = 3; km <= 150; km += 3) {
      for (let b = 0; b < 360; b += 15) {
        const rad = (b * Math.PI) / 180;
        const p: LngLat = [lng + (Math.sin(rad) * km) / kLng, lat + (Math.cos(rad) * km) / 111];
        if (probe.isLand(p[0], p[1])) continue;
        const out = km + 3;
        const q: LngLat = [lng + (Math.sin(rad) * out) / kLng, lat + (Math.cos(rad) * out) / 111];
        const fixed: LngLat = probe.isLand(q[0], q[1]) ? p : q;
        const r = (n: number) => Math.round(n * 1000) / 1000;
        notes.push(`航點 ${i + 1} 在陸地，已移到最近海面 [${r(fixed[0])}, ${r(fixed[1])}]`);
        return [r(fixed[0]), r(fixed[1])];
      }
    }
    return wp;
  });
}

function clamp(v: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, v));
}

function makeCmdId(): string {
  return `llm-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
}
