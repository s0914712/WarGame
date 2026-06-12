/**
 * 反潛聲學環境模型 — 由使用者可設定的海洋環境（BT 溫度剖面、海況、底質、水深）
 * 導出聲速剖面、層深(SLD)、環境噪音、傳播加成，並計算 Figure of Merit（聲納優值）
 * 與 >50% 偵測有效距離 R₅₀。串接 sonar.ts 的聲納方程式。
 *
 * 物理基礎（非全 ray tracing）：
 *   - 聲速：Mackenzie 1981 公式 c(T,S,z)
 *   - 層深：聲速剖面近表面極大值深度 = Sonic Layer Depth
 *   - 環境噪音：海況（Beaufort）→ 環境噪音級（Wenz 近似）
 *   - 底質/水深：淺水多次觸底 → 每 km 額外傳播損失；深水才成立會聚區
 *   - FOM = SL − (NL − DI) − DT（被動）；R₅₀ = TL(r)=FOM 的距離
 *
 * 純函式，無 RNG → 重播決定性。
 */
import type { AcousticEnvironment, AcousticProfile } from "../types";
import { transmissionLossDb, DEFAULT_AMBIENT_NL_DB, type SonarEnv } from "./sonar";

export const DEFAULT_SALINITY_PPT = 34;
const DEEP_WATER_FOR_CZ_M = 1000;     // 水深 ≥ 此值才成立會聚區
const SHALLOW_WATER_M = 300;          // 水深 < 此值起算淺水底反射
const RECEIVER_SPEED_NOISE = 0.4;     // 與 sonar.ts 一致

/** Mackenzie 1981 海水聲速（m/s）。T °C、S ppt、z 深度 m */
export function soundSpeedMackenzie(tempC: number, salinityPpt: number, depthM: number): number {
  const T = tempC, S = salinityPpt, z = depthM;
  return 1448.96 + 4.591 * T - 5.304e-2 * T * T + 2.374e-4 * T * T * T
    + 1.340 * (S - 35) + 1.630e-2 * z + 1.675e-7 * z * z
    - 1.025e-2 * T * (S - 35) - 7.139e-13 * T * z * z * z;
}

/**
 * 由 BT 溫度剖面導出 Sonic Layer Depth（聲速近表面極大值深度，= 混合層深度）。
 * 混合層內聲速隨壓力升、躍層處溫降使聲速降 → 極大值即層底。
 */
export function deriveSonicLayerDepthM(
  btProfile: { depthM: number; tempC: number }[], salinityPpt: number,
): number {
  if (btProfile.length === 0) return 0;
  const pts = [...btProfile].sort((a, b) => a.depthM - b.depthM);
  let bestDepth = pts[0]!.depthM;
  let bestC = -Infinity;
  for (const p of pts) {
    const c = soundSpeedMackenzie(p.tempC, salinityPpt, p.depthM);
    if (c >= bestC) { bestC = c; bestDepth = p.depthM; }
  }
  return Math.max(0, Math.min(300, bestDepth));
}

/** 海況（Beaufort 0..6）→ 環境噪音級（dB）。調成海況 3 ≈ 60 dB 對齊預設 */
export function seaStateToAmbientNlDb(seaState: number): number {
  const ss = Math.max(0, Math.min(6, seaState));
  return 44 + 5.3 * ss;
}

/** 底質單次反射損失（dB）：泥吸聲最強、岩反射最佳 */
export function bottomReflectionLossDb(bottomType: AcousticEnvironment["bottomType"]): number {
  switch (bottomType) {
    case "mud": return 15;
    case "sand": return 10;
    case "rock": return 6;
  }
}

/** 淺水底反射造成的每 km 額外傳播損失（深水 → 0） */
export function bottomLossDbPerKm(
  bottomType: AcousticEnvironment["bottomType"], waterDepthM: number,
): number {
  if (waterDepthM >= SHALLOW_WATER_M) return 0;
  const loss = bottomReflectionLossDb(bottomType) * ((SHALLOW_WATER_M - waterDepthM) / SHALLOW_WATER_M) * 0.2;
  return Math.max(0, Math.min(4, loss));
}

/**
 * 由聲學環境導出 engine/detection 要用的有效參數：
 *   - layerDepthM（SLD）
 *   - czSpacingKm（深水才成立；否則 0）
 *   - sonarEnv（環境噪音 + 淺水底損）
 */
export function deriveSonarEnv(
  env: AcousticEnvironment, scenarioCzKm: number | undefined,
): { layerDepthM: number; czSpacingKm: number; sonarEnv: SonarEnv } {
  const czSpacingKm = env.waterDepthM >= DEEP_WATER_FOR_CZ_M ? (scenarioCzKm ?? 0) : 0;
  return {
    layerDepthM: env.layerDepthM,
    czSpacingKm,
    sonarEnv: {
      ambientNlDb: seaStateToAmbientNlDb(env.seaState),
      bottomLossDbPerKm: bottomLossDbPerKm(env.bottomType, env.waterDepthM),
    },
  };
}

function dbSum(a: number, b: number): number {
  return 10 * Math.log10(10 ** (a / 10) + 10 ** (b / 10));
}

/** 被動 Figure of Merit（聲納優值，dB）= SL − (NL − DI) − DT */
export function passiveFigureOfMeritDb(args: {
  sourceLevelDb: number;
  passive: NonNullable<AcousticProfile["passive"]>;
  receiverSpeedKnots: number;
  ambientNlDb?: number;
}): number {
  const nl = dbSum(
    args.ambientNlDb ?? DEFAULT_AMBIENT_NL_DB,
    args.passive.selfNoiseDb + RECEIVER_SPEED_NOISE * Math.max(0, args.receiverSpeedKnots),
  );
  return args.sourceLevelDb - (nl - args.passive.arrayGainDb) - args.passive.dtDb;
}

/** 主動聲納允許的最大「單程」TL（dB）= [SL_ping + TS − (NL − DI) − DT] / 2 */
export function activeMaxOneWayTlDb(args: {
  pingSourceLevelDb: number;
  targetStrengthDb: number;
  passive: NonNullable<AcousticProfile["passive"]>;
  receiverSpeedKnots: number;
  ambientNlDb?: number;
}): number {
  const nl = dbSum(
    args.ambientNlDb ?? DEFAULT_AMBIENT_NL_DB,
    args.passive.selfNoiseDb + RECEIVER_SPEED_NOISE * Math.max(0, args.receiverSpeedKnots),
  );
  return (args.pingSourceLevelDb + args.targetStrengthDb - (nl - args.passive.arrayGainDb) - args.passive.dtDb) / 2;
}

/**
 * >50% 偵測有效距離 R₅₀（km）：直達路徑上 TL(r) = maxTlDb 的距離。
 * 被動：maxTlDb = FOM；主動：maxTlDb = FOM_active / 2（雙程）。
 * TL 在直達區單調遞增 → 二分搜尋首次達標距離。
 */
export function effectiveDetectionRangeKm(
  maxTlDb: number,
  opts: { layerCrossing?: boolean; bottomLossDbPerKm?: number } = {},
): number {
  const layerCrossing = opts.layerCrossing ?? false;
  const bottom = opts.bottomLossDbPerKm ?? 0;
  // TL(0.01km) 必 < maxTlDb；若 0.05km 已超出代表幾乎無偵測
  let lo = 0.02, hi = 400;
  // 直達區用 czSpacingKm=0（不含會聚環，求直達 R₅₀）
  if (transmissionLossDb(lo, layerCrossing, 0, bottom) >= maxTlDb) return lo;
  if (transmissionLossDb(hi, layerCrossing, 0, bottom) < maxTlDb) return hi;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (transmissionLossDb(mid, layerCrossing, 0, bottom) < maxTlDb) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
}
