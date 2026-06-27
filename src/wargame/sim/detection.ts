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
import type {
  ContactQuality, DetectionState, EngagementEvent, PassiveContact, Side, SideId,
  Sonobuoy, TmaTrack, Unit, UnitId,
} from "../types";
import { haversineKm, bearingDeg } from "./geo";
import { UNIT_CATALOG } from "../catalog/units";
import { radarHorizonKm, isTerrainOccluded } from "./los";
import {
  sonarActiveDetects, sonarPassiveDetects, acousticsOf, isPeriscopeDepth,
  PERISCOPE_VISUAL_RANGE_KM, DEFAULT_LAYER_DEPTH_M, type SonarEnv,
} from "./sonar";
import {
  advanceTmaTrack, tmaSolved, bearingSpreadDeg,
  TRIANGULATE_MIN_SPREAD_DEG, TRIANGULATE_DWELL_SEC,
} from "./localization";

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
  /** 被動測向接觸（E21）— 供測向射線渲染 */
  passiveContacts: PassiveContact[];
  /** TMA 機動測距追蹤（E21）：sensorId → (targetId → TmaTrack) */
  tmaTracks: Record<UnitId, Record<UnitId, TmaTrack>>;
  /** 三角交會持續計時（E21）：observerSideId → (targetId → 累計秒數) */
  crossFixTimers: Partial<Record<SideId, Record<UnitId, number>>>;
}

export function computeDetection(
  units: Record<UnitId, Unit>,
  sides: Side[],
  dtSec: number,
  simSec: number,
  occlusionEnabled = true,
  acousticModel = false,
  sonarLayerDepthM = DEFAULT_LAYER_DEPTH_M,
  sonarConvergenceKm = 0,
  sonobuoys: Sonobuoy[] = [],
  sonarEnv: SonarEnv = {},
  prevTmaTracks: Record<UnitId, Record<UnitId, TmaTrack>> = {},
  prevCrossFix: Partial<Record<SideId, Record<UnitId, number>>> = {},
): DetectionResult {
  const sideMap = new Map<SideId, Side>(sides.map((s) => [s.id, s]));
  const events: EngagementEvent[] = [];
  const passiveContacts: PassiveContact[] = [];
  const tmaTracks: Record<UnitId, Record<UnitId, TmaTrack>> = {};
  const crossFixTimers: Partial<Record<SideId, Record<UnitId, number>>> = {};

  // 1. 收集每個 sideId 下有偵測能力（detectionRange > 0）的 sensor units
  const sensorsBySide = new Map<SideId, Unit[]>();
  for (const u of Object.values(units)) {
    if (u.core.detectionRangeKm <= 0) continue;
    let arr = sensorsBySide.get(u.sideId);
    if (!arr) { arr = []; sensorsBySide.set(u.sideId, arr); }
    arr.push(u);
  }

  // 1b. 聲標屏幕：依陣營分組（水中目標在 MDR 內即被該陣營偵測）
  const buoysBySide = new Map<SideId, Sonobuoy[]>();
  for (const b of sonobuoys) {
    let arr = buoysBySide.get(b.sideId);
    if (!arr) { arr = []; buoysBySide.set(b.sideId, arr); }
    arr.push(b);
  }

  // 2. 對每個 unit 重算 detectedBy + detectionTimers + contactQuality
  const next: Record<UnitId, Unit> = {};
  for (const u of Object.values(units)) {
    const detectedBy: Unit["detectedBy"] = {};
    const timers: Partial<Record<SideId, Timer>> = {};
    const contactQuality: Partial<Record<SideId, ContactQuality>> = {};

    // stealth：目標 extensions.stealth (0..0.95) → 等比例壓低感測器有效範圍
    const stealthRaw = typeof u.extensions.stealth === "number"
      ? (u.extensions.stealth as number) : 0;
    const stealth = Math.max(0, Math.min(0.95, stealthRaw));
    const uDomain = UNIT_CATALOG[u.kind].domain;
    const uAlt = platformAltM(u);
    const uPos: [number, number] = [u.position.lng, u.position.lat];
    const targetInWater = uDomain === "sea" || uDomain === "subsurface";
    // 啟用聲納模型時，水下目標只能靠聲納偵測（雷達看不到水下）；
    // 但潛望鏡 / 近水面深度的潛艦會暴露於雷達 / 光學
    const radarCanSeeTarget = !acousticModel || uDomain !== "subsurface" || isPeriscopeDepth(u);

    for (const [observerSideId, side] of sideMap) {
      if (observerSideId === u.sideId) continue;
      const myOwnSide = sideMap.get(u.sideId);
      const isHostileToObserver = side.isHostileTo.includes(u.sideId)
        || (myOwnSide?.isHostileTo.includes(observerSideId) ?? false);
      if (!isHostileToObserver) continue;

      // 分三類偵測：
      //   visualHit  → 目視 / 雷達（位置 + 身份 → "visual"）
      //   acousticFix→ 主動 / 吊放 / 聲標（位置但無身份 → "acoustic" 匿名標記）
      //   passiveHolds → 被動測向（只得方位 → "bearing"；交會夠久 / TMA 才升 "acoustic"）
      const sensors = sensorsBySide.get(observerSideId);
      let visualHit = false;
      let acousticFix = false;
      const passiveHolds: { sensor: Unit; bearingDeg: number }[] = [];

      if (sensors && sensors.length > 0) {
        for (const s of sensors) {
          const sDomain = UNIT_CATALOG[s.kind].domain;
          const sPos: [number, number] = [s.position.lng, s.position.lat];

          // ── 雷達 / 光學路徑 ──（聲學模型下潛艦不用雷達搜索，改走潛望鏡目視）
          const sensorCanRadar = !acousticModel || sDomain !== "subsurface";
          if (radarCanSeeTarget && sensorCanRadar) {
            const effRangeKm = s.core.detectionRangeKm * (1 - stealth);
            if (effRangeKm > 0) {
              const d = haversineKm(sPos, uPos);
              if (d <= effRangeKm) {
                let blocked = false;
                if (occlusionEnabled && sDomain !== "subsurface" && uDomain !== "subsurface") {
                  const sAlt = platformAltM(s);
                  if (d > radarHorizonKm(sAlt, uAlt)) blocked = true;        // 超出雷達地平線
                  else if (isTerrainOccluded(sPos, sAlt, uPos, uAlt)) blocked = true;  // 山脈遮蔽
                }
                if (!blocked) visualHit = true;                              // 雷達 → 識別
              }
            }
          }

          // ── 潛望鏡目視（B3）──（潛艦在潛望鏡深度，目視 ~7浬內的水面 / 空中目標 → 識別）
          if (acousticModel && sDomain === "subsurface" && isPeriscopeDepth(s)
              && uDomain !== "subsurface") {
            if (haversineKm(sPos, uPos) <= PERISCOPE_VISUAL_RANGE_KM) visualHit = true;
          }

          // ── 聲納路徑（E20）──（水中目標 + sensor 具聲學特性）
          if (acousticModel && targetInWater && acousticsOf(s)) {
            const d = haversineKm(sPos, uPos);
            // 主動 / 吊放聲納 → 給距離但無身份 → acoustic 標記
            if (sonarActiveDetects(s, u, d, sonarLayerDepthM, sonarConvergenceKm, sonarEnv)) {
              acousticFix = true;
            }
            // 被動聲納 → 只得方位 → bearing（待三角交會 / TMA 才升 acoustic）
            if (sonarPassiveDetects(s, u, d, sonarLayerDepthM, sonarConvergenceKm, sonarEnv)) {
              passiveHolds.push({ sensor: s, bearingDeg: bearingDeg(sPos, uPos) });
            }
          }
        }
      }

      // ── 聲標屏幕路徑 ──（水中目標 + 觀察方有聲標在 MDR 內 → 點偵測給位置 → acoustic）
      if (targetInWater && !acousticFix) {
        const buoys = buoysBySide.get(observerSideId);
        if (buoys) {
          for (const b of buoys) {
            if (haversineKm(b.position, uPos) <= b.mdrKm) { acousticFix = true; break; }
          }
        }
      }

      const inRange = visualHit || acousticFix || passiveHolds.length > 0;

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

      // ── TMA 機動測距追蹤：持有被動接觸的每個感測器累積自身機動 ──
      for (const h of passiveHolds) {
        const adv = advanceTmaTrack(
          prevTmaTracks[h.sensor.id]?.[u.id], h.sensor.position.headingDeg, dtSec,
        );
        let bucket = tmaTracks[h.sensor.id];
        if (!bucket) { bucket = {}; tmaTracks[h.sensor.id] = bucket; }
        bucket[u.id] = adv;
      }

      // ── 三角交會持續計時：交會幾何成立才累加，破壞即歸零（須持續 TRIANGULATE_DWELL_SEC）──
      const spread = bearingSpreadDeg(passiveHolds.map((h) => h.bearingDeg));
      const crossGeomNow = passiveHolds.length >= 2 && spread >= TRIANGULATE_MIN_SPREAD_DEG;
      const prevCf = prevCrossFix[observerSideId]?.[u.id] ?? 0;
      const cfSec = crossGeomNow ? prevCf + dtSec : 0;
      if (cfSec > 0) {
        let bucket = crossFixTimers[observerSideId];
        if (!bucket) { bucket = {}; crossFixTimers[observerSideId] = bucket; }
        bucket[u.id] = cfSec;
      }

      // ── 定位 / 識別品質 ──
      //   visual   ：目視 / 雷達（位置 + 身份）
      //   acoustic ：主動/聲標/吊放，或被動三角交會持續夠久 / TMA 解算（位置但匿名）
      //   bearing  ：只得方位（未定位）
      let quality: ContactQuality | undefined;
      if (inRange) {
        if (visualHit) {
          quality = "visual";
        } else if (acousticFix) {
          quality = "acoustic";
        } else {
          const triangulated = crossGeomNow && cfSec >= TRIANGULATE_DWELL_SEC;
          const solved = passiveHolds.some((h) => tmaSolved(tmaTracks[h.sensor.id]?.[u.id]));
          quality = triangulated || solved ? "acoustic" : "bearing";
        }
      } else if (newState !== "hidden") {
        // 記憶接觸（失聯衰減中）：沿用上一 tick 品質，bearing 接觸不會在失聯時突現位置
        quality = u.contactQuality?.[observerSideId] ?? "visual";
      }
      if (quality) {
        contactQuality[observerSideId] = quality;
        // 被動測向接觸 → 輸出射線（fixed 也輸出，渲染層自行決定畫不畫）
        for (const h of passiveHolds) {
          passiveContacts.push({
            observerSideId,
            sensorId: h.sensor.id,
            sensorPos: [h.sensor.position.lng, h.sensor.position.lat],
            bearingDeg: h.bearingDeg,
            targetId: u.id,
            quality,
          });
        }
      }

      // ── emit 關鍵升降級事件 ──
      const ev = detectionEvent(prevState, newState, side, u, simSec);
      if (ev) events.push(ev);
    }

    const nextTimers = Object.keys(timers).length > 0 ? timers : undefined;
    const nextQuality = Object.keys(contactQuality).length > 0 ? contactQuality : undefined;
    if (sameDetectedBy(u.detectedBy, detectedBy)
        && sameTimers(u.detectionTimers, nextTimers)
        && sameDetectedBy(u.contactQuality ?? {}, contactQuality)) {
      next[u.id] = u;
    } else {
      next[u.id] = { ...u, detectedBy, detectionTimers: nextTimers, contactQuality: nextQuality };
    }
  }

  return { units: next, events, passiveContacts, tmaTracks, crossFixTimers };
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

function sameDetectedBy(
  a: Partial<Record<SideId, string>>, b: Partial<Record<SideId, string>>,
): boolean {
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
