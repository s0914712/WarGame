/**
 * 反潛聲納模型（E20）— 主動 / 被動聲納方程式。
 *
 * 被動（passive，只接收／聽）：
 *   SE = SL − TL − (NL − DI) − DT
 * 主動（active，拍發 ping + 收回波）：
 *   SE = SL_ping − 2·TL + TS − (NL − DI) − DT
 *
 *   SL  source level       聲源級（目標輻射噪音；主動時為自身 ping 源平）
 *   TL  transmission loss   傳播損失（球面擴散 + 吸收 + 溫躍層跨層損失）
 *   TS  target strength     目標強度（回波強度）
 *   NL  noise level         噪音級（環境 + 接收方自噪，dB 功率相加）
 *   DI  directivity index   陣列指向增益
 *   DT  detection threshold 偵測門檻
 *   SE  signal excess       訊號餘裕；≥ 0 → 偵測成立
 *
 * 不確定性以決定性方式處理（無 RNG）：SE ≥ 0 即偵測，交由偵測狀態機再分級。
 * 重播決定性保持。
 */
import type { AcousticProfile, Unit } from "../types";
import { UNIT_CATALOG } from "../catalog/units";

// ── 環境常數 ─────────────────────────────────────────────
const AMBIENT_NL_DB = 60;            // 環境噪音（海況中等）
const ABSORPTION_DB_PER_KM = 0.4;    // 吸收損失（低頻 ASW 概略值）
const RECEIVER_SPEED_NOISE = 0.4;    // 接收方每節自噪增量（dB/kn）
const LAYER_LOSS_DB = 8;             // 跨溫躍層單程額外損失（主動為雙程 → 影響加倍）
export const DEFAULT_LAYER_DEPTH_M = 60;

/** 取單位聲學特性（catalog） */
export function acousticsOf(u: Unit): AcousticProfile | undefined {
  return UNIT_CATALOG[u.kind].acoustics;
}

/** 深度（公尺，正值）— 由 altMeters 取負；水面以上視為 0 */
export function depthOf(u: Unit): number {
  return Math.max(0, -u.position.altMeters);
}

/** dB 功率相加 */
function dbSum(a: number, b: number): number {
  return 10 * Math.log10(10 ** (a / 10) + 10 ** (b / 10));
}

/** 單程傳播損失（dB）：球面擴散 20log10(r) + 吸收 + 溫躍層跨層損失 */
export function transmissionLossDb(rangeKm: number, layerCrossing: boolean): number {
  const rM = Math.max(1, rangeKm * 1000);
  let tl = 20 * Math.log10(rM) + ABSORPTION_DB_PER_KM * rangeKm;
  if (layerCrossing) tl += LAYER_LOSS_DB;
  return tl;
}

/** 聲源與接收方是否分處溫躍層兩側（跨層 → 額外損失） */
export function crossesLayer(depthA: number, depthB: number, layerDepthM: number): boolean {
  if (layerDepthM <= 0) return false;
  return (depthA > layerDepthM) !== (depthB > layerDepthM);
}

/** 目標被聽到的有效聲源級：max(航速相關輻射噪音, 主動拍發時的 ping 源平) */
export function effectiveSourceLevelDb(
  prof: AcousticProfile, speedKnots: number, activeSonarOn: boolean,
): number {
  const radiated = prof.sourceLevelDb + (prof.noisePerKnotDb ?? 0) * Math.max(0, speedKnots);
  if (activeSonarOn && prof.active) return Math.max(radiated, prof.active.sourceLevelDb);
  return radiated;
}

function noiseLevelDb(passiveSelfNoiseDb: number, receiverSpeedKnots: number): number {
  const selfNoise = passiveSelfNoiseDb + RECEIVER_SPEED_NOISE * Math.max(0, receiverSpeedKnots);
  return dbSum(AMBIENT_NL_DB, selfNoise);
}

/** 被動聲納 signal excess（dB）。≥ 0 → 聽得到 */
export function passiveSignalExcessDb(args: {
  sourceLevelDb: number;
  rangeKm: number;
  layerCrossing: boolean;
  passive: NonNullable<AcousticProfile["passive"]>;
  receiverSpeedKnots: number;
}): number {
  const tl = transmissionLossDb(args.rangeKm, args.layerCrossing);
  const nl = noiseLevelDb(args.passive.selfNoiseDb, args.receiverSpeedKnots);
  return args.sourceLevelDb - tl - (nl - args.passive.arrayGainDb) - args.passive.dtDb;
}

/** 主動聲納 signal excess（dB）。≥ 0 → 回波偵測成立 */
export function activeSignalExcessDb(args: {
  pingSourceLevelDb: number;
  rangeKm: number;
  layerCrossing: boolean;
  targetStrengthDb: number;
  passive: NonNullable<AcousticProfile["passive"]>;
  receiverSpeedKnots: number;
}): number {
  const tl = transmissionLossDb(args.rangeKm, args.layerCrossing);
  const nl = noiseLevelDb(args.passive.selfNoiseDb, args.receiverSpeedKnots);
  return args.pingSourceLevelDb - 2 * tl + args.targetStrengthDb
    - (nl - args.passive.arrayGainDb) - args.passive.dtDb;
}

/**
 * 聲學偵測總判定：sensor 是否（被動或主動）偵測到 target。
 * - 被動：用 sensor.passive 聽 target 的有效聲源級
 * - 主動：sensor.activeSonar 開且具 active + passive → 用 ping 回波
 */
export function sonarDetects(
  sensor: Unit, target: Unit, rangeKm: number, layerDepthM: number,
): boolean {
  const sa = acousticsOf(sensor);
  const ta = acousticsOf(target);
  if (!sa || !ta) return false;
  const layerCrossing = crossesLayer(depthOf(sensor), depthOf(target), layerDepthM);

  // 被動
  if (sa.passive) {
    const srcSL = effectiveSourceLevelDb(ta, target.position.speedKnots, target.activeSonar === true);
    const se = passiveSignalExcessDb({
      sourceLevelDb: srcSL,
      rangeKm,
      layerCrossing,
      passive: sa.passive,
      receiverSpeedKnots: sensor.position.speedKnots,
    });
    if (se >= 0) return true;
  }

  // 主動（拍發 ping）
  if (sensor.activeSonar && sa.active && sa.passive) {
    const se = activeSignalExcessDb({
      pingSourceLevelDb: sa.active.sourceLevelDb,
      rangeKm,
      layerCrossing,
      targetStrengthDb: ta.targetStrengthDb,
      passive: sa.passive,
      receiverSpeedKnots: sensor.position.speedKnots,
    });
    if (se >= 0) return true;
  }

  return false;
}
