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
export const DEFAULT_AMBIENT_NL_DB = 60;   // 環境噪音（海況中等，可被聲學環境覆寫）
const AMBIENT_NL_DB = DEFAULT_AMBIENT_NL_DB;
const ABSORPTION_DB_PER_KM = 0.4;    // 吸收損失（低頻 ASW 概略值）
const RECEIVER_SPEED_NOISE = 0.4;    // 接收方每節自噪增量（dB/kn）
const LAYER_LOSS_DB = 8;             // 跨溫躍層單程額外損失（主動為雙程 → 影響加倍）
export const DEFAULT_LAYER_DEPTH_M = 60;

// ── 會聚區（Convergence Zone, CZ）──
// 深水中聲線下折再上折，在 ~N×CZ 間距處形成偵測環（環內 TL 大幅降低），
// 環與環之間為「陰影區」聽不到。典型首環 ~55km，之後每 ~55km 一環。
const CZ_HALF_WIDTH_KM = 5;          // 環半寬（±km 內視為環內）
const CZ_GAIN_DB = 18;               // 環內聲線聚焦 → 單程 TL 減少量

/** 會聚區增益（dB，正值代表 TL 減少）。czSpacingKm ≤ 0 → 關閉 */
function convergenceGainDb(rangeKm: number, czSpacingKm: number): number {
  if (czSpacingKm <= 0) return 0;
  const n = Math.round(rangeKm / czSpacingKm);
  if (n < 1) return 0;   // n=0 是直達路徑，不算 CZ
  return Math.abs(rangeKm - n * czSpacingKm) <= CZ_HALF_WIDTH_KM ? CZ_GAIN_DB : 0;
}

/** 取單位聲學特性（catalog） */
export function acousticsOf(u: Unit): AcousticProfile | undefined {
  return UNIT_CATALOG[u.kind].acoustics;
}

/** 深度（公尺，正值）— 由 altMeters 取負；水面以上視為 0 */
export function depthOf(u: Unit): number {
  return Math.max(0, -u.position.altMeters);
}

/** 單位是否裝備拖曳陣列：catalog 有 towedArray 且（潛艦 或 hasTowedArray 旗標） */
export function unitHasTowedArray(u: Unit): boolean {
  const cat = UNIT_CATALOG[u.kind];
  if (!cat.acoustics?.towedArray) return false;
  return cat.domain === "subsurface" || u.hasTowedArray === true;
}

/** 拖曳陣列目前是否有效偵測：裝備 + 佈放 + 速度 ≤ speedLimit */
export function towedArrayActive(u: Unit): boolean {
  if (!unitHasTowedArray(u)) return false;
  const ta = UNIT_CATALOG[u.kind].acoustics!.towedArray!;
  if (u.towedArrayDeployed === false) return false;   // 省略 = 已佈放
  return u.position.speedKnots <= ta.speedLimitKn;
}

// ── 可控下潛深度 ─────────────────────────────────────────
/** 潛艦最大下潛深度（公尺） */
export const SUB_MAX_DEPTH_M = 500;
/** ≤ 此深度視為潛望鏡 / 呼吸管深度 → 暴露於雷達 / 光學偵測 */
export const PERISCOPE_EXPOSE_MAX_M = 25;

/** 潛艦是否在潛望鏡 / 近水面深度（會被雷達 / 反潛機看到） */
export function isPeriscopeDepth(u: Unit): boolean {
  return depthOf(u) <= PERISCOPE_EXPOSE_MAX_M;
}

/** 潛望鏡目視偵測距離（公里，B3）— 約 7 浬。潛艦在潛望鏡深度時用潛望鏡目視水面 / 空中目標 */
export const PERISCOPE_VISUAL_RANGE_KM = 7 * 1.852;   // ≈ 13 km

// ── 吊放聲納（dipping sonar，A4 反潛直升機）─────────────
/** 反潛直升機懸停（吊放聲納入水）的最大速度（節）；> 此速度視為移動 → 聲納收起無法偵測 */
export const DIP_HOVER_MAX_KN = 8;

/** 反潛直升機目前是否吊放聲納作業中（懸停 / 低速 → 換能器入水） */
export function isDippingActive(u: Unit): boolean {
  if (u.kind !== "asw_helo") return false;
  return u.position.speedKnots <= DIP_HOVER_MAX_KN;
}

/** dB 功率相加 */
function dbSum(a: number, b: number): number {
  return 10 * Math.log10(10 ** (a / 10) + 10 ** (b / 10));
}

/**
 * 單程傳播損失（dB）：球面擴散 20log10(r) + 吸收 + 溫躍層跨層損失
 * + 淺水底反射加成（bottomLossDbPerKm·r）− 會聚區增益。
 */
export function transmissionLossDb(
  rangeKm: number, layerCrossing: boolean, czSpacingKm = 0, bottomLossDbPerKm = 0,
): number {
  const rM = Math.max(1, rangeKm * 1000);
  let tl = 20 * Math.log10(rM) + ABSORPTION_DB_PER_KM * rangeKm;
  if (layerCrossing) tl += LAYER_LOSS_DB;
  if (bottomLossDbPerKm > 0) tl += bottomLossDbPerKm * rangeKm;   // 淺水多次觸底
  tl -= convergenceGainDb(rangeKm, czSpacingKm);   // 會聚區聚焦 → 損失降低
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

function noiseLevelDb(
  passiveSelfNoiseDb: number, receiverSpeedKnots: number, ambientNlDb = AMBIENT_NL_DB,
): number {
  const selfNoise = passiveSelfNoiseDb + RECEIVER_SPEED_NOISE * Math.max(0, receiverSpeedKnots);
  return dbSum(ambientNlDb, selfNoise);
}

/** 聲學環境參數（由 scenario.acousticEnv 導出；省略 → 預設） */
export interface SonarEnv {
  ambientNlDb?: number;
  bottomLossDbPerKm?: number;
  czSpacingKm?: number;
  /**
   * 混響散射強度（dB，A3 主動聲納混響限制）。> 0（淺水 / 海底反射強）時主動聲納改為
   * 「混響限制（reverberation-limited）」而非「噪音限制」：回波與混響皆隨 ping 源平 + 距離
   * 同比變化（2·TL 相消）→ 加大 ping 功率或拉近距離都無法改善訊號餘裕，只能靠 TS − Sr。
   * 省略 / 0 = 深水開闊海域，純噪音限制（保留舊行為）。
   */
  reverbScatterDb?: number;
}

/** 被動聲納 signal excess（dB）。≥ 0 → 聽得到 */
export function passiveSignalExcessDb(args: {
  sourceLevelDb: number;
  rangeKm: number;
  layerCrossing: boolean;
  passive: NonNullable<AcousticProfile["passive"]>;
  receiverSpeedKnots: number;
  czSpacingKm?: number;
  ambientNlDb?: number;
  bottomLossDbPerKm?: number;
}): number {
  const tl = transmissionLossDb(args.rangeKm, args.layerCrossing, args.czSpacingKm ?? 0, args.bottomLossDbPerKm ?? 0);
  const nl = noiseLevelDb(args.passive.selfNoiseDb, args.receiverSpeedKnots, args.ambientNlDb);
  return args.sourceLevelDb - tl - (nl - args.passive.arrayGainDb) - args.passive.dtDb;
}

/** 主動聲納 signal excess（dB）。≥ 0 → 回波偵測成立。
 *
 * 噪音限制：SE_n = SL_ping − 2·TL + TS − (NL − DI) − DT
 * 混響限制（A3，reverbScatterDb > 0）：回波與混響皆 ∝ SL − 2·TL → 相消，
 *   SE_r = TS + DI − Sr − DT（與 ping 功率 / 距離無關）。
 * 實際偵測取兩者較嚴者：SE = min(SE_n, SE_r)。淺水安靜潛艦即使近距、強 ping 也難偵獲。
 */
export function activeSignalExcessDb(args: {
  pingSourceLevelDb: number;
  rangeKm: number;
  layerCrossing: boolean;
  targetStrengthDb: number;
  passive: NonNullable<AcousticProfile["passive"]>;
  receiverSpeedKnots: number;
  czSpacingKm?: number;
  ambientNlDb?: number;
  bottomLossDbPerKm?: number;
  reverbScatterDb?: number;
}): number {
  const tl = transmissionLossDb(args.rangeKm, args.layerCrossing, args.czSpacingKm ?? 0, args.bottomLossDbPerKm ?? 0);
  const nl = noiseLevelDb(args.passive.selfNoiseDb, args.receiverSpeedKnots, args.ambientNlDb);
  const seNoise = args.pingSourceLevelDb - 2 * tl + args.targetStrengthDb
    - (nl - args.passive.arrayGainDb) - args.passive.dtDb;
  const reverb = args.reverbScatterDb ?? 0;
  if (reverb <= 0) return seNoise;
  const seReverb = args.targetStrengthDb + args.passive.arrayGainDb - reverb - args.passive.dtDb;
  return Math.min(seNoise, seReverb);
}

/**
 * 聲學偵測總判定：sensor 是否（被動或主動）偵測到 target。
 * - 被動：用 sensor.passive 聽 target 的有效聲源級
 * - 主動：sensor.activeSonar 開且具 active + passive → 用 ping 回波
 */
export function sonarDetects(
  sensor: Unit, target: Unit, rangeKm: number, layerDepthM: number, czSpacingKm = 0,
  env: SonarEnv = {},
): boolean {
  if (sonarPassiveDetects(sensor, target, rangeKm, layerDepthM, czSpacingKm, env)) return true;
  if (sonarActiveDetects(sensor, target, rangeKm, layerDepthM, czSpacingKm, env)) return true;
  return false;
}

/**
 * 主動聲納偵測（拍發 ping 收回波；含 A3 混響限制 + A4 吊放聲納）。
 * 給出距離 → 屬「已定位」(fixed) 接觸（不像被動只得方位）。
 *   - 水面艦 / 潛艦：需 activeSonar 開
 *   - 反潛直升機：吊放聲納懸停作業中（isDippingActive）即自動主動拍發，
 *     換能器吊放至溫躍層下 → 不受跨層損失（layerCrossing = false）
 */
export function sonarActiveDetects(
  sensor: Unit, target: Unit, rangeKm: number, layerDepthM: number, czSpacingKm = 0,
  env: SonarEnv = {},
): boolean {
  const sa = acousticsOf(sensor);
  const ta = acousticsOf(target);
  if (!sa || !ta || !sa.active || !sa.passive) return false;

  const dipping = isDippingActive(sensor);
  if (!sensor.activeSonar && !dipping) return false;   // 未開主動 ping 且非吊放作業

  // 吊放聲納換能器吊放至層下 → 略過跨層損失（直接探測層下潛艦）
  const layerCrossing = dipping ? false : crossesLayer(depthOf(sensor), depthOf(target), layerDepthM);
  const se = activeSignalExcessDb({
    pingSourceLevelDb: sa.active.sourceLevelDb,
    rangeKm,
    layerCrossing,
    targetStrengthDb: ta.targetStrengthDb,
    passive: sa.passive,
    receiverSpeedKnots: sensor.position.speedKnots,
    czSpacingKm,
    ambientNlDb: env.ambientNlDb,
    bottomLossDbPerKm: env.bottomLossDbPerKm,
    reverbScatterDb: env.reverbScatterDb,
  });
  return se >= 0;
}

/**
 * 純被動偵測（艦艏/側舷 + 拖曳陣列；不含主動 ping）。
 * 被動只得「方位」不得距離 → 用於測向三角定位（bearing-only）。
 */
export function sonarPassiveDetects(
  sensor: Unit, target: Unit, rangeKm: number, layerDepthM: number, czSpacingKm = 0,
  env: SonarEnv = {},
): boolean {
  const sa = acousticsOf(sensor);
  const ta = acousticsOf(target);
  if (!sa || !ta) return false;
  // 反潛直升機：吊放聲納換能器入水（懸停）才能聽音；移動中收起 → 無被動偵測
  if (sensor.kind === "asw_helo" && !isDippingActive(sensor)) return false;
  const layerCrossing = crossesLayer(depthOf(sensor), depthOf(target), layerDepthM);
  const ambientNlDb = env.ambientNlDb;
  const bottomLossDbPerKm = env.bottomLossDbPerKm;
  const srcSL = effectiveSourceLevelDb(ta, target.position.speedKnots, target.activeSonar === true);

  // 艦艏 / 側舷陣列
  if (sa.passive) {
    const se = passiveSignalExcessDb({
      sourceLevelDb: srcSL, rangeKm, layerCrossing, passive: sa.passive,
      receiverSpeedKnots: sensor.position.speedKnots, czSpacingKm, ambientNlDb, bottomLossDbPerKm,
    });
    if (se >= 0) return true;
  }
  // 拖曳陣列 TACTAS（需佈放 + 低速）
  if (towedArrayActive(sensor)) {
    const t = sa.towedArray!;
    const se = passiveSignalExcessDb({
      sourceLevelDb: srcSL, rangeKm, layerCrossing,
      passive: { arrayGainDb: t.arrayGainDb, dtDb: t.dtDb, selfNoiseDb: t.selfNoiseDb },
      receiverSpeedKnots: sensor.position.speedKnots, czSpacingKm, ambientNlDb, bottomLossDbPerKm,
    });
    if (se >= 0) return true;
  }
  return false;
}
