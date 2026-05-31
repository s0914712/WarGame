/**
 * LLM 介接的 JSON schema 型別。
 *
 * 三個 document：
 *   - LlmStateExport：給 LLM 讀的當前世界狀態
 *   - LlmCommandDocument：LLM 產出的指令包
 *   - LlmCommandResult：執行回報（讓 LLM 自校 / 重試）
 *
 * 版本欄位是契約核心：未來改 schema 時可以同時支援多版本，舊 LLM prompt 不會壞。
 */
import type { CoreAttributes, SideId, UnitKind } from "../types";
import type { RouteIssue } from "../sim/validate";

export const STATE_VERSION = "wargame-state-v1";
export const COMMANDS_VERSION = "wargame-commands-v1";
export const RESULT_VERSION = "wargame-result-v1";

// ── State export ────────────────────────────────────────
export interface LlmStateExport {
  version: typeof STATE_VERSION;
  scenario: {
    id: string;
    name: string;
    simTime: string;             // "T+HH:MM:SS"
    simTimeSec: number;
    paused: boolean;
  };
  sides: Array<{
    id: SideId;
    name: string;
    isPlayer: boolean;
    hostileTo: SideId[];
  }>;
  units: LlmUnitView[];
}

export interface LlmUnitView {
  id: string;
  side: SideId;
  kind: UnitKind;
  domain: "land" | "air" | "sea" | "subsurface";
  callsign: string;
  name: string;
  position: { lng: number; lat: number; altMeters: number };
  speedKnots: number;
  headingDeg: number;
  hp: { current: number; max: number };
  fuel: { remainingKm: number; maxKm: number };
  core: CoreAttributes;
  waypoints: [number, number][];
  /** 玩家方（藍）對該單位的偵測狀態，hostile 才有意義 */
  detectedByPlayer: "hidden" | "unknown" | "classified" | "tracked" | "own";
  constraints: {
    forbidDomains?: ("land" | "air" | "sea" | "subsurface")[];
  };
}

// ── Command document ────────────────────────────────────
export type LlmCommand =
  | LlmSetWaypointsCommand
  | LlmSetSpeedCommand
  | LlmEngageCommand
  | LlmHoldCommand
  | LlmUpdateAttributesCommand;

export interface LlmSetWaypointsCommand {
  kind: "set_waypoints";
  unitId: string;
  /** [lng, lat] 順序（注意不是 [lat, lng]） */
  waypoints: [number, number][];
  /** 多少 sim sec 後執行；省略 = 立即 */
  executeAtSimSec?: number;
  /** 此計畫必須在此 sim sec 之前完成（用作驗證警告） */
  mustCompleteBySimSec?: number;
}

export interface LlmSetSpeedCommand {
  kind: "set_speed";
  unitId: string;
  speedKnots: number;
  executeAtSimSec?: number;
}

export interface LlmEngageCommand {
  kind: "engage";
  unitId: string;
  targetUnitId: string;
  executeAtSimSec?: number;
}

export interface LlmHoldCommand {
  kind: "hold";
  unitId: string;
  executeAtSimSec?: number;
}

/** 立即更新單位 core 屬性（射程 / 速率 / 航程 / 偵測 / 血量上限） */
export interface LlmUpdateAttributesCommand {
  kind: "update_attributes";
  unitId: string;
  core: Partial<CoreAttributes>;
}

export interface LlmCommandDocument {
  version: typeof COMMANDS_VERSION;
  commands: LlmCommand[];
}

// ── Result ──────────────────────────────────────────────
export type LlmCommandResultEntry =
  | {
      index: number;
      status: "applied";
      commandId?: string;        // 若進入指令佇列才會有
      warnings?: string[];       // route validation warning（如超出航程）
    }
  | {
      index: number;
      status: "rejected";
      reason: string;
      issues?: RouteIssue[];
    };

export interface LlmCommandResult {
  version: typeof RESULT_VERSION;
  summary: { submitted: number; applied: number; rejected: number };
  results: LlmCommandResultEntry[];
}
