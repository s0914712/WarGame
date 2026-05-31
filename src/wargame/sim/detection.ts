/**
 * 偵測模型（Phase 3 簡化版）。
 *
 * 規則：
 *   - 對每對 (sensor unit, opposing unit)：距離 ≤ sensor 的 core.detectionRangeKm → tracked
 *   - 否則 → hidden
 *
 * Phase 3 不做漸進狀態機（unknown → classified → tracked）+ 失聯衰減，
 * 純二值化先把流程走通。Phase 5 polish 時再加。
 *
 * 純函式：傳入 units 全集 + sides 配置 → 回傳新 units 全集（detectedBy 更新）。
 */
import type { Side, SideId, Unit, UnitId } from "../types";
import { haversineKm } from "./geo";

export function computeDetection(
  units: Record<UnitId, Unit>,
  sides: Side[],
): Record<UnitId, Unit> {
  const sideMap = new Map<SideId, Side>(sides.map((s) => [s.id, s]));

  // 1. 收集每個 sideId 下，距離某 unit 在誰的偵測範圍內
  //    sensorsBySide[sideId] = 該陣營所有有 detectionRange > 0 的 units
  const sensorsBySide = new Map<SideId, Unit[]>();
  for (const u of Object.values(units)) {
    if (u.core.detectionRangeKm <= 0) continue;
    let arr = sensorsBySide.get(u.sideId);
    if (!arr) {
      arr = [];
      sensorsBySide.set(u.sideId, arr);
    }
    arr.push(u);
  }

  // 2. 對每個 unit 重新計算 detectedBy
  const next: Record<UnitId, Unit> = {};
  for (const u of Object.values(units)) {
    const detectedBy: Unit["detectedBy"] = {};

    // 對每個敵對 side 檢查
    for (const [observerSideId, side] of sideMap) {
      if (observerSideId === u.sideId) continue;
      const myOwnSide = sideMap.get(u.sideId);
      const isHostileToObserver = side.isHostileTo.includes(u.sideId)
        || (myOwnSide?.isHostileTo.includes(observerSideId) ?? false);
      // 只追蹤敵對關係的偵測；中立可被觀察但 detectedBy 不重要
      if (!isHostileToObserver) continue;

      const sensors = sensorsBySide.get(observerSideId);
      if (!sensors || sensors.length === 0) continue;

      // stealth：目標的 extensions.stealth (0..1) → 等比例壓低感測器有效範圍
      const stealthRaw = typeof u.extensions.stealth === "number"
        ? (u.extensions.stealth as number) : 0;
      const stealth = Math.max(0, Math.min(0.95, stealthRaw));

      let detected = false;
      for (const s of sensors) {
        const effRangeKm = s.core.detectionRangeKm * (1 - stealth);
        if (effRangeKm <= 0) continue;
        const d = haversineKm([s.position.lng, s.position.lat], [u.position.lng, u.position.lat]);
        if (d <= effRangeKm) {
          detected = true;
          break;
        }
      }
      if (detected) detectedBy[observerSideId] = "tracked";
      else detectedBy[observerSideId] = "hidden";
    }

    // detectedBy 沒變就重用同一個 unit reference（減少不必要 GC）
    if (sameDetectedBy(u.detectedBy, detectedBy)) {
      next[u.id] = u;
    } else {
      next[u.id] = { ...u, detectedBy };
    }
  }

  return next;
}

function sameDetectedBy(a: Unit["detectedBy"], b: Unit["detectedBy"]): boolean {
  const ak = Object.keys(a);
  const bk = Object.keys(b);
  if (ak.length !== bk.length) return false;
  for (const k of ak) {
    if ((a as Record<string, string>)[k] !== (b as Record<string, string>)[k]) return false;
  }
  return true;
}
