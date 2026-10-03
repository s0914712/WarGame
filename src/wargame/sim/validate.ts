/**
 * 規劃驗證 — 純函式，沒副作用。
 *
 * 統一回傳 RouteValidation；UI 可決定要警告 / 禁用 / 提示。
 * Engine 暫不強制（只用 movementRangeKm 自然停下），未來可在 tick 開頭呼叫
 * validate 然後丟棄違規 waypoints。
 *
 * 擴展方向（新加 IssueType 即可，caller 跑 switch 不會 stale）：
 *   - "weather_blocked"（颱風 / 大霧區域）
 *   - "airspace_violation"（禁飛區）
 *   - "threat_zone"（穿越敵方密集防空）
 *   - "supply_required"（彈藥補給站太遠）
 */
import type { LngLat, Unit } from "../types";
import { UNIT_CATALOG } from "../catalog/units";
import { haversineKm } from "./geo";
import { getTerrainProbe } from "./terrain";

export type RouteIssueType =
  | "fuel_exceeded"
  | "time_exceeded"
  | "domain_invalid"
  | "command_radius_exceeded";

export interface RouteIssue {
  type: RouteIssueType;
  /** 0-based 航點索引；undefined 表示整條航線層級的問題（如總燃料） */
  waypointIdx?: number;
  message: string;
  /** 嚴重程度。warning 仍可套用；error 阻擋套用 */
  severity: "warning" | "error";
}

export interface RouteValidation {
  totalKm: number;
  totalSec: number;
  /** 剩餘燃料（公里） */
  remainingFuelKm: number;
  withinFuel: boolean;
  withinTime: boolean;
  /** 哪些 waypoint 違反 domain 限制（0-based set，方便 UI 標紅） */
  invalidWaypointIdx: number[];
  /**
   * 管制 / 資料鏈半徑（km）— 來自 unit.extensions.commandRadiusKm（如 UAV 作戰半徑）。
   * 沒設此 extension 的單位為 undefined（不檢查）。
   */
  commandRadiusKm?: number;
  /** 航線上離出發點最遠的距離（km）— 與 commandRadiusKm 比對 */
  maxRadiusKm: number;
  issues: RouteIssue[];
  /** 沒有 error 級 issue 才為 true。warning 不影響此值 */
  ok: boolean;
}

export interface ValidateOptions {
  /** 任務必須在此 sim sec 之前完成；undefined → 用 catalog 預設 */
  mustCompleteBySimSec?: number;
  /** 當前 sim 時間（用來算「剩多少時間 budget」） */
  currentSimSec?: number;
}

export function validatePlan(
  unit: Unit,
  waypoints: LngLat[],
  opts: ValidateOptions = {},
): RouteValidation {
  const catalog = UNIT_CATALOG[unit.kind];
  const probe = getTerrainProbe();

  // ── 距離計算（從 unit 當前位置出發） ──
  let totalKm = 0;
  let prev: LngLat = [unit.position.lng, unit.position.lat];
  for (const wp of waypoints) {
    totalKm += haversineKm(prev, wp);
    prev = wp;
  }

  const speedKnots = unit.core.speedKnots > 0 ? unit.core.speedKnots : 1;
  const totalSec = (totalKm / (speedKnots * 1.852)) * 3600;

  const remainingFuelKm = unit.core.movementRangeKm - unit.distanceTravelledKm;
  const withinFuel = totalKm <= remainingFuelKm;

  // ── 管制 / 資料鏈半徑（UAV 作戰半徑）──
  // 從規劃當下的位置（= 發航 / 起飛點）量到每個航點的直線距離，取最大值。
  const origin: LngLat = [unit.position.lng, unit.position.lat];
  let maxRadiusKm = 0;
  for (const wp of waypoints) {
    const d = haversineKm(origin, wp);
    if (d > maxRadiusKm) maxRadiusKm = d;
  }
  const rawRadius = unit.extensions.commandRadiusKm;
  const commandRadiusKm = typeof rawRadius === "number" && rawRadius > 0 ? rawRadius : undefined;

  // ── 時間 budget ──
  const currentSec = opts.currentSimSec ?? 0;
  const timeBudgetSec = opts.mustCompleteBySimSec !== undefined
    ? opts.mustCompleteBySimSec - currentSec
    : catalog.constraints.defaultPlanTimeLimitSec;
  const withinTime = timeBudgetSec === undefined || totalSec <= timeBudgetSec;

  // ── domain 檢查（每個 waypoint） ──
  const invalidWaypointIdx: number[] = [];
  const forbid = catalog.constraints.forbidDomains ?? [];
  if (forbid.length > 0) {
    waypoints.forEach((wp, i) => {
      const [lng, lat] = wp;
      if (forbid.includes("land") && probe.isLand(lng, lat)) invalidWaypointIdx.push(i);
      else if (forbid.includes("sea") && probe.isWater(lng, lat)) invalidWaypointIdx.push(i);
    });
  }

  // ── 組 issues ──
  const issues: RouteIssue[] = [];

  if (!withinFuel) {
    issues.push({
      type: "fuel_exceeded",
      severity: "warning",       // engine 會自然停下，是 warning
      message: `航程 ${totalKm.toFixed(0)} km 超出剩餘油料 ${remainingFuelKm.toFixed(0)} km`,
    });
  }

  if (!withinTime && timeBudgetSec !== undefined) {
    issues.push({
      type: "time_exceeded",
      severity: "warning",
      message: `預計 ${formatDuration(totalSec)} 完成 · 時間預算 ${formatDuration(timeBudgetSec)}`,
    });
  }

  if (commandRadiusKm !== undefined && maxRadiusKm > commandRadiusKm) {
    issues.push({
      type: "command_radius_exceeded",
      severity: "warning",     // 超出即失去管制鏈路，但不阻擋規劃
      message: `最遠航點 ${maxRadiusKm.toFixed(0)} km 超出作戰半徑 ${commandRadiusKm.toFixed(0)} km`,
    });
  }

  for (const idx of invalidWaypointIdx) {
    issues.push({
      type: "domain_invalid",
      severity: "error",
      waypointIdx: idx,
      message: `航點 ${idx + 1} 不可達 — ${catalog.displayName}不能進入${describeForbidden(forbid)}`,
    });
  }

  const hasError = issues.some((x) => x.severity === "error");
  return {
    totalKm,
    totalSec,
    remainingFuelKm,
    withinFuel,
    withinTime,
    invalidWaypointIdx,
    commandRadiusKm,
    maxRadiusKm,
    issues,
    ok: !hasError,
  };
}

function describeForbidden(domains: Unit["kind"] extends never ? never : string[]): string {
  if (domains.length === 0) return "禁區";
  const labels: Record<string, string> = { land: "陸地", sea: "海面", air: "空中" };
  return domains.map((d) => labels[d] ?? d).join(" / ");
}

function formatDuration(sec: number): string {
  if (sec < 60) return `${Math.round(sec)}s`;
  if (sec < 3600) return `${Math.round(sec / 60)}min`;
  return `${(sec / 3600).toFixed(1)}h`;
}
