/**
 * 紀錄片作者手刻軌跡（per scenario / per unit）。
 *
 * 時間軸對齊 storyboard.ts 的分鏡節點：
 *   180 守軍還擊 · 420 船團出港 · 840 魚雷艇攔截 · 1320 料羅灣海戰 · 1800 衝進料羅灣 · 2100 卸載
 *
 * 控制點取自 kinmen_823_1958.ts 各船的 start + waypoints，僅補上時間戳，讓 marker
 * 在紀錄片模式沿這條曲線平滑前進（與引擎物理脫鉤，純為運鏡敘事）。岸砲 / 觀測所
 * 無軌跡 → 維持引擎位置。
 */
import type { TrackPoint } from "./track";

type ScenarioTracks = Record<string, TrackPoint[]>;

const KINMEN_823: ScenarioTracks = {
  // ── 運補旗艦 中海艦：外海待命 → 出港 → 穿越攔截區 → 衝進料羅灣 → 卸載 ──
  "BLUE-LST-01": [
    { atSimSec: 0, lng: 118.56, lat: 24.26 },
    { atSimSec: 420, lng: 118.56, lat: 24.26 }, // 出港
    { atSimSec: 840, lng: 118.50, lat: 24.33 }, // 攔截區
    { atSimSec: 1320, lng: 118.46, lat: 24.38 }, // 海戰
    { atSimSec: 1800, lng: 118.42, lat: 24.40 }, // 衝進料羅灣
    { atSimSec: 2400, lng: 118.42, lat: 24.40 }, // 卸載
  ],
  // ── 臺生輪 ──
  "BLUE-LST-02": [
    { atSimSec: 0, lng: 118.58, lat: 24.24 },
    { atSimSec: 420, lng: 118.58, lat: 24.24 },
    { atSimSec: 840, lng: 118.52, lat: 24.31 },
    { atSimSec: 1320, lng: 118.47, lat: 24.37 },
    { atSimSec: 1800, lng: 118.43, lat: 24.40 },
    { atSimSec: 2400, lng: 118.43, lat: 24.40 },
  ],
  // ── 美樂號 LSM ──
  "BLUE-LSM-01": [
    { atSimSec: 0, lng: 118.60, lat: 24.27 },
    { atSimSec: 480, lng: 118.60, lat: 24.27 },
    { atSimSec: 900, lng: 118.53, lat: 24.33 },
    { atSimSec: 1380, lng: 118.48, lat: 24.38 },
    { atSimSec: 1860, lng: 118.44, lat: 24.41 },
    { atSimSec: 2400, lng: 118.44, lat: 24.41 },
  ],
  // ── 護航艦 沱江：略前出，替船團擋火 ──
  "BLUE-DD-01": [
    { atSimSec: 0, lng: 118.55, lat: 24.30 },
    { atSimSec: 360, lng: 118.55, lat: 24.30 },
    { atSimSec: 780, lng: 118.49, lat: 24.35 },
    { atSimSec: 1260, lng: 118.45, lat: 24.39 },
    { atSimSec: 1800, lng: 118.45, lat: 24.42 },
    { atSimSec: 2400, lng: 118.45, lat: 24.42 },
  ],
  // ── 護航艦 維源（旗艦）──
  "BLUE-DD-02": [
    { atSimSec: 0, lng: 118.52, lat: 24.28 },
    { atSimSec: 360, lng: 118.52, lat: 24.28 },
    { atSimSec: 780, lng: 118.47, lat: 24.34 },
    { atSimSec: 1260, lng: 118.44, lat: 24.38 },
    { atSimSec: 1800, lng: 118.42, lat: 24.42 },
    { atSimSec: 2400, lng: 118.42, lat: 24.42 },
  ],
  // ── 護航艦 柳江 ──
  "BLUE-DD-03": [
    { atSimSec: 0, lng: 118.54, lat: 24.32 },
    { atSimSec: 360, lng: 118.54, lat: 24.32 },
    { atSimSec: 780, lng: 118.48, lat: 24.36 },
    { atSimSec: 1260, lng: 118.45, lat: 24.40 },
    { atSimSec: 1800, lng: 118.44, lat: 24.42 },
    { atSimSec: 2400, lng: 118.44, lat: 24.42 },
  ],
  // ── 魚雷快艇：待命 → 出擊攔截 → 撲向船團 ──
  "RED-TB-01": [
    { atSimSec: 0, lng: 118.13, lat: 24.57 },
    { atSimSec: 360, lng: 118.13, lat: 24.57 },
    { atSimSec: 900, lng: 118.30, lat: 24.47 },
    { atSimSec: 1320, lng: 118.43, lat: 24.40 },
    { atSimSec: 2400, lng: 118.43, lat: 24.40 },
  ],
  "RED-TB-02": [
    { atSimSec: 0, lng: 118.15, lat: 24.59 },
    { atSimSec: 360, lng: 118.15, lat: 24.59 },
    { atSimSec: 900, lng: 118.32, lat: 24.48 },
    { atSimSec: 1320, lng: 118.44, lat: 24.41 },
    { atSimSec: 2400, lng: 118.44, lat: 24.41 },
  ],
  "RED-TB-03": [
    { atSimSec: 0, lng: 118.10, lat: 24.55 },
    { atSimSec: 360, lng: 118.10, lat: 24.55 },
    { atSimSec: 900, lng: 118.28, lat: 24.45 },
    { atSimSec: 1320, lng: 118.42, lat: 24.39 },
    { atSimSec: 2400, lng: 118.42, lat: 24.39 },
  ],
  // ── 55 甲型砲艇：隨魚雷艇後出擊，與沱江近距對轟 ──
  "RED-GB-01": [
    { atSimSec: 0, lng: 118.16, lat: 24.54 },
    { atSimSec: 480, lng: 118.16, lat: 24.54 },
    { atSimSec: 960, lng: 118.31, lat: 24.46 },
    { atSimSec: 1380, lng: 118.43, lat: 24.41 },
    { atSimSec: 2400, lng: 118.43, lat: 24.41 },
  ],
  "RED-GB-02": [
    { atSimSec: 0, lng: 118.18, lat: 24.56 },
    { atSimSec: 480, lng: 118.18, lat: 24.56 },
    { atSimSec: 960, lng: 118.33, lat: 24.47 },
    { atSimSec: 1380, lng: 118.44, lat: 24.40 },
    { atSimSec: 2400, lng: 118.44, lat: 24.40 },
  ],
  "RED-GB-03": [
    { atSimSec: 0, lng: 118.14, lat: 24.52 },
    { atSimSec: 480, lng: 118.14, lat: 24.52 },
    { atSimSec: 960, lng: 118.29, lat: 24.44 },
    { atSimSec: 1380, lng: 118.42, lat: 24.40 },
    { atSimSec: 2400, lng: 118.42, lat: 24.40 },
  ],
};

const ALL_TRACKS: Record<string, ScenarioTracks> = {
  kinmen_823_1958: KINMEN_823,
};

/** 取某場景某單位的紀錄片軌跡；無則回 null（caller fallback 回引擎位置）。 */
export function getCinemaTrack(scenarioId: string, unitId: string): TrackPoint[] | null {
  return ALL_TRACKS[scenarioId]?.[unitId] ?? null;
}

/** 該場景是否有任何作者軌跡（用來決定要不要走 sampleTrack 路徑）。 */
export function hasCinemaTracks(scenarioId: string): boolean {
  return ALL_TRACKS[scenarioId] !== undefined;
}
