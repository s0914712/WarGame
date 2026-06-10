/**
 * 偵測模型 — 漸進狀態機（A2，對標 CMO）。
 *
 * 「看到光點 ≠ 知道是誰 ≠ 可以打」：每對 (觀察方 side × 目標 unit) 維護接觸計時，
 * 在有效感測範圍內持續接觸 → 逐級升級；失去接觸 → 保持後反向降級直到失聯。
 *
 *   在範圍內（沿用 stealth 折扣 effRange = detectionRangeKm × (1 - stealth)）：
 *     inSec 累計：
 *       inSec ≥ CLASSIFY_SEC + TRACK_SEC → tracked
 *       inSec ≥ CLASSIFY_SEC             → classified
 *       inSec > 0                        → unknown
 *   離開範圍：
 *     凍結 inSec（peak rank 由 inSec 推回），outSec 累計：
 *       outSec < HOLD_SEC                → 維持
 *       之後每 DECAY_STEP_SEC 降一級，降到 hidden → 計時歸零（完全失聯）
 *
 * 純時間驅動、無 RNG → 重播決定性。升降級會 emit detection EngagementEvent。
 *
 * 純函式：傳入 units 全集 + sides + dt + simSec → 回傳 { units, events }。
 */
import type { DetectionState, EngagementEvent, Side, SideId, Unit, UnitId } from "../types";
import { haversineKm } from "./geo";
import { UNIT_CATALOG } from "../catalog/units";
import { radarHorizonKm, isTerrainOccluded } from "./los";
import { sonarDetects, acousticsOf, DEFAULT_LAYER_DEPTH_M } from "./sonar";

/** 平台有效感測高度（公尺）：取座標高度與 catalog 平台高度的大者 + 桅高 */
function platformAltM(u: Unit): number {
  const cat = UNIT_CATALOG[u.kind];
  const base = Math.max(u.position.altMeters, cat.defaultAltitudeM);
  const mast = cat.domain === "sea" ? 20 : cat.domain === "land" ? 10 : 0;
  return base + mast;
}

// ── 調平衡常數 ───────────────────────────────────────────
const CLASSIFY_SEC = 20;     // unknown → classified
const TRACK_SEC = 20;        // classified → tracked（再累計）
const HOLD_SEC = 10;         // 失去接觸後維持原狀態多久
const DECAY_STEP_SEC = 15;   // 之後每隔多久降一級

// ── rank helper（供 combat 開火閘門共用） ───────────────
const RANK: Record<DetectionState, number> = {
  hidden: 0,
  unknown: 1,
  classified: 2,
  tracked: 3,
};
const STATE_BY_RANK: DetectionState[] = ["hidden", "unknown", "classified", "tracked"];

/** detectionState → 數值序（hidden 0 < unknown 1 < classified 2 < tracked 3） */
export function detectionRank(s: DetectionState | undefined): number {
  return s ? RANK[s] : 0;
}

/** 開火 / 接戰最低識別門檻：必須 ≥ classified 才能釋放武器 */
export const MIN_ENGAGE_STATE: DetectionState = "classified";

interface Timer { inSec: number; outSec: number; }

/** 由「在範圍內累計秒數」推回 detection 等級 */
function stateFromInSec(inSec: number): DetectionState {
  if (inSec >= CLASSIFY_SEC + TRACK_SEC) return "tracked";
  if (inSec >= CLASSIFY_SEC) return "classified";
  if (inSec > 0) return "unknown";
  return "hidden";
}

export interface DetectionResult {
  units: Record<UnitId, Unit>;
  events: EngagementEvent[];
}

export function computeDetection(
  units: Record<UnitId, Unit>,
  sides: Side[],
  dtSec: number,
  simSec: number,
  occlusionEnabled = true,
  acousticModel = false,
  sonarLayerDepthM = DEFAULT_LAYER_DEPTH_M,
): DetectionResult {
  const sideMap = new Map<SideId, Side>(sides.map((s) => [s.id, s]));
  const events: EngagementEvent[] = [];

  // 1. 收集每個 sideId 下有偵測能力（detectionRange > 0）的 sensor units
  const sensorsBySide = new Map<SideId, Unit[]>();
  for (const u of Object.values(units)) {
    if (u.core.detectionRangeKm <= 0) continue;
    let arr = sensorsBySide.get(u.sideId);
    if (!arr) { arr = []; sensorsBySide.set(u.sideId, arr); }
    arr.push(u);
  }

  // 2. 對每個 unit 重算 detectedBy + detectionTimers
  const next: Record<UnitId, Unit> = {};
  for (const u of Object.values(units)) {
    const detectedBy: Unit["detectedBy"] = {};
    const timers: Partial<Record<SideId, Timer>> = {};

    // stealth：目標 extensions.stealth (0..0.95) → 等比例壓低感測器有效範圍
    const stealthRaw = typeof u.extensions.stealth === "number"
      ? (u.extensions.stealth as number) : 0;
    const stealth = Math.max(0, Math.min(0.95, stealthRaw));

    for (const [observerSideId, side] of sideMap) {
      if (observerSideId === u.sideId) continue;
      const myOwnSide = sideMap.get(u.sideId);
      const isHostileToObserver = side.isHostileTo.includes(u.sideId)
        || (myOwnSide?.isHostileTo.includes(observerSideId) ?? false);
      if (!isHostileToObserver) continue;

      // 判斷是否在任一 sensor 有效範圍內（含 A5 地平線 + 地形遮蔽 + E20 聲納）
      const sensors = sensorsBySide.get(observerSideId);
      const uDomain = UNIT_CATALOG[u.kind].domain;
      const uAlt = platformAltM(u);
      const targetInWater = uDomain === "sea" || uDomain === "subsurface";
      // 啟用聲納模型時，水下目標只能靠聲納偵測（雷達看不到水下）
      const radarCanSeeTarget = !acousticModel || uDomain !== "subsurface";
      let inRange = false;
      if (sensors && sensors.length > 0) {
        for (const s of sensors) {
          const sDomain = UNIT_CATALOG[s.kind].domain;

          // ── 雷達 / 光學路徑 ──（潛艦在水下不用雷達；水下目標雷達看不到）
          if (radarCanSeeTarget && (!acousticModel || sDomain !== "subsurface")) {
            const effRangeKm = s.core.detectionRangeKm * (1 - stealth);
            if (effRangeKm > 0) {
              const d = haversineKm(
                [s.position.lng, s.position.lat],
                [u.position.lng, u.position.lat],
              );
              if (d <= effRangeKm) {
                let blocked = false;
                if (occlusionEnabled && sDomain !== "subsurface" && uDomain !== "subsurface") {
                  const sAlt = platformAltM(s);
                  if (d > radarHorizonKm(sAlt, uAlt)) blocked = true;        // 超出雷達地平線
                  else if (isTerrainOccluded(
                    [s.position.lng, s.position.lat], sAlt,
                    [u.position.lng, u.position.lat], uAlt,
                  )) blocked = true;                                         // 山脈遮蔽
                }
                if (!blocked) { inRange = true; break; }
              }
            }
          }

          // ── 聲納路徑（E20）──（水中目標 + 雙方具聲學特性）
          if (acousticModel && targetInWater && acousticsOf(s)) {
            const d = haversineKm(
              [s.position.lng, s.position.lat],
              [u.position.lng, u.position.lat],
            );
            if (sonarDetects(s, u, d, sonarLayerDepthM)) { inRange = true; break; }
          }
        }
      }

      const prevState: DetectionState = u.detectedBy[observerSideId] ?? "hidden";
      const prev: Timer = u.detectionTimers?.[observerSideId] ?? { inSec: 0, outSec: 0 };

      let inSec = prev.inSec;
      let outSec = prev.outSec;
      let newState: DetectionState;

      if (inRange) {
        inSec = prev.inSec + dtSec;   // prevState=hidden 時 prev.inSec=0，等於從頭累計
        outSec = 0;
        newState = stateFromInSec(inSec);
      } else if (prevState === "hidden") {
        // 從未接觸 → 維持 hidden，計時歸零
        inSec = 0; outSec = 0;
        newState = "hidden";
      } else {
        // 失去接觸：凍結 inSec、累計 outSec、由 peak rank 往下衰減
        outSec = prev.outSec + dtSec;
        const peakRank = RANK[stateFromInSec(prev.inSec)];
        const decaySteps = outSec < HOLD_SEC
          ? 0
          : Math.floor((outSec - HOLD_SEC) / DECAY_STEP_SEC) + 1;
        const newRank = Math.max(0, peakRank - decaySteps);
        newState = STATE_BY_RANK[newRank]!;
        if (newRank === 0) { inSec = 0; outSec = 0; }   // 完全失聯 → reset
      }

      detectedBy[observerSideId] = newState;
      if (inSec !== 0 || outSec !== 0) timers[observerSideId] = { inSec, outSec };

      // ── emit 關鍵升降級事件 ──
      const ev = detectionEvent(prevState, newState, side, u, simSec);
      if (ev) events.push(ev);
    }

    const nextTimers = Object.keys(timers).length > 0 ? timers : undefined;
    if (sameDetectedBy(u.detectedBy, detectedBy) && sameTimers(u.detectionTimers, nextTimers)) {
      next[u.id] = u;
    } else {
      next[u.id] = { ...u, detectedBy, detectionTimers: nextTimers };
    }
  }

  return { units: next, events };
}

/** 只在「發現 / 完成分類 / 鎖定 / 失去接觸」這幾個有意義的門檻發事件，避免洗版 */
function detectionEvent(
  prev: DetectionState,
  next: DetectionState,
  observer: Side,
  target: Unit,
  simSec: number,
): EngagementEvent | null {
  const pr = RANK[prev];
  const nr = RANK[next];
  const who = observer.displayName;
  let msg: string | null = null;
  let tag = "";
  if (pr === 0 && nr >= 1) { msg = `${who} 發現未識別接觸 ${target.callsign}`; tag = "contact"; }
  else if (pr < 2 && nr >= 2) { msg = `${who} 完成分類 ${target.callsign}（可接戰）`; tag = "classified"; }
  else if (pr < 3 && nr === 3) { msg = `${who} 鎖定追蹤 ${target.callsign}`; tag = "tracked"; }
  else if (pr >= 1 && nr === 0) { msg = `${who} 對 ${target.callsign} 失去接觸`; tag = "lost"; }
  if (!msg) return null;
  return {
    id: `evt-${simSec.toFixed(1)}-det-${observer.id}-${target.id}-${tag}`,
    simAtSec: simSec,
    kind: "detection",
    targetId: target.id,
    position: [target.position.lng, target.position.lat],
    message: msg,
  };
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

function sameTimers(
  a: Unit["detectionTimers"],
  b: Partial<Record<SideId, Timer>> | undefined,
): boolean {
  const ak = a ? Object.keys(a) : [];
  const bk = b ? Object.keys(b) : [];
  if (ak.length !== bk.length) return false;
  for (const k of ak) {
    const av = a![k as SideId]!;
    const bv = b?.[k as SideId];
    if (!bv || av.inSec !== bv.inSec || av.outSec !== bv.outSec) return false;
  }
  return true;
}
