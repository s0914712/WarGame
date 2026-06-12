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
import type { CoreAttributes, RoeMode, SideId, UnitKind } from "../types";
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
  /** 己方已佈放的聲標屏幕（反潛）；無則省略 */
  sonobuoys?: Array<{ lng: number; lat: number; mdrKm: number; side: SideId }>;
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
  /** POV 方對該單位的偵測狀態，hostile 才有意義。≥ classified 才可開火 */
  detectedByPlayer: "hidden" | "unknown" | "classified" | "tracked" | "own";
  /** 己方單位（own）的當前 ROE；敵方省略 */
  roe?: RoeMode;
  /** 己方單位（own）主動聲納是否拍發中（E20）；非聲納單位省略 */
  activeSonar?: boolean;
  /** 己方潛艦（own）當前深度（公尺，正值）；非潛艦省略 */
  depthM?: number;
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
  | LlmSetRoeCommand
  | LlmSetActiveSonarCommand
  | LlmSetDepthCommand
  | LlmSetTowedArrayCommand
  | LlmDeploySonobuoysCommand
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

/** 設定單位交戰規則（ROE）。weapons_hold = 不主動接戰；weapons_free = 自由接戰 */
export interface LlmSetRoeCommand {
  kind: "set_roe";
  unitId: string;
  roe: RoeMode;
  executeAtSimSec?: number;
}

/** 開 / 關主動聲納（反潛）。on=true 拍發 ping → 偵潛距離大增，但自身被敵方被動聲納遠距偵知 */
export interface LlmSetActiveSonarCommand {
  kind: "set_active_sonar";
  unitId: string;
  on: boolean;
  executeAtSimSec?: number;
}

/** 設定潛艦下潛深度（公尺，正值 0–500）。層下藏匿、潛望鏡深度（≤25m）暴露於雷達 */
export interface LlmSetDepthCommand {
  kind: "set_depth";
  unitId: string;
  depthM: number;
  executeAtSimSec?: number;
}

/** 佈放 / 收回拖曳陣列（TACTAS）。on=true 高增益被動偵潛，但須低速才有效 */
export interface LlmSetTowedArrayCommand {
  kind: "set_towed_array";
  unitId: string;
  on: boolean;
  executeAtSimSec?: number;
}

/**
 * 反潛機佈放聲標反潛屏幕：兩角定義搜索框，自動格網佈點。
 * 每枚聲標在 mdrKm 內偵測敵潛。cornerA/B 為 [lng, lat]。
 */
export interface LlmDeploySonobuoysCommand {
  kind: "deploy_sonobuoys";
  unitId: string;
  cornerA: [number, number];
  cornerB: [number, number];
  count: number;
  mdrKm?: number;
  lifetimeSec?: number;
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
