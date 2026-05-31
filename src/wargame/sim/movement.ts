/**
 * 移動模型 — waypoint 跟隨 + 燃料限制。
 *
 * 規則：
 *   - 有 waypoint：朝第一個 waypoint 前進，到達 → 移除該 waypoint
 *   - 達到 movementRangeKm → speed 強制為 0、不再消耗 waypoint（料盡）
 *   - 沒 waypoint：保持當前速度與航向（巡航/慣性）
 *
 * 純函式：傳入 Unit + dt → 回傳新 Unit。不副作用。
 */
import type { LngLat, Unit } from "../types";
import { advanceTowardKm, bearingDeg, haversineKm, knotsToKmPerSec } from "./geo";

const ARRIVE_THRESHOLD_KM = 0.5;

export function advanceUnit(unit: Unit, dtSec: number): Unit {
  // 料盡 → 停下
  if (unit.distanceTravelledKm >= unit.core.movementRangeKm) {
    if (unit.position.speedKnots === 0) return unit;
    return {
      ...unit,
      position: { ...unit.position, speedKnots: 0 },
    };
  }

  const currentSpeed = unit.position.speedKnots;
  if (currentSpeed <= 0) return unit;       // 靜止單位（基地、SAM 等待狀態）

  const stepKm = knotsToKmPerSec(currentSpeed) * dtSec;
  if (stepKm <= 0) return unit;

  const here: LngLat = [unit.position.lng, unit.position.lat];

  // 沒 waypoint → 朝 heading 慣性前進（簡化：用 heading 投射出虛擬點）
  if (unit.waypoints.length === 0) {
    const projectedKm = stepKm * 10;
    const headingRad = (unit.position.headingDeg * Math.PI) / 180;
    const dy = Math.cos(headingRad) * projectedKm / 111.32;
    const dx = Math.sin(headingRad) * projectedKm / (111.32 * Math.cos(unit.position.lat * Math.PI / 180));
    const virtual: LngLat = [unit.position.lng + dx, unit.position.lat + dy];
    const [nlng, nlat] = advanceTowardKm(here, virtual, stepKm);
    return {
      ...unit,
      position: { ...unit.position, lng: nlng, lat: nlat },
      distanceTravelledKm: unit.distanceTravelledKm + stepKm,
    };
  }

  // 有 waypoint
  const target = unit.waypoints[0]!;
  const toTarget = haversineKm(here, target);

  if (toTarget <= ARRIVE_THRESHOLD_KM) {
    // 抵達 → 消耗該 waypoint，下個 tick 處理下一個
    return {
      ...unit,
      position: { ...unit.position, lng: target[0], lat: target[1] },
      waypoints: unit.waypoints.slice(1),
      distanceTravelledKm: unit.distanceTravelledKm + toTarget,
    };
  }

  const heading = bearingDeg(here, target);
  const [nlng, nlat] = advanceTowardKm(here, target, stepKm);
  return {
    ...unit,
    position: {
      ...unit.position,
      lng: nlng,
      lat: nlat,
      headingDeg: heading,
    },
    distanceTravelledKm: unit.distanceTravelledKm + stepKm,
  };
}
