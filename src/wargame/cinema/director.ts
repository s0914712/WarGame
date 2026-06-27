/**
 * 紀錄片 Director — 移植自 battle-of-hong-kong-1941 director.js 的精神，改接兵棋。
 *
 * 與 HK 版的關鍵差異：
 *   - 時間軸：讀兵棋 wargameClock.getSimTime()（live tick 或 replayPlayer scrub 都通），
 *     不自己跑 RAF clock、不重做軌跡插值（engine 權威 state 已足夠）。
 *   - 運鏡：驅動 Mapbox flyTo（不是 Three.js camera）。
 *   - 抓鏡頭暫停：玩家拖地圖 / 滾輪 → 進 free-look，閒置數秒後自動續播（與 HK 同手感）。
 *
 * 這層只在「紀錄片模式」啟用，不動到即時兵棋玩法；stop() 後完全無痕。
 */
import type { Map as MapboxMap } from "mapbox-gl";
import { scenarioStore } from "../scenarioStore";
import { wargameClock } from "../clock";
import { getStoryboard, type CinemaShot, type Storyboard } from "./storyboard";

export type NarrLang = "both" | "zh" | "en";

export interface CinemaCaption {
  dateLabel: string;
  titleZh: string;
  titleEn: string;
  narrZh: string;
  narrEn: string;
  /** 聚焦單位中，藍 / 紅各方仍存活的數量（給字幕強度條） */
  blueAlive: number;
  redAlive: number;
  lang: NarrLang;
}

const RESUME_IDLE_MS = 3500; // 玩家最後一次操作後，閒置這麼久就恢復自動運鏡
const FLY_DURATION_MS = 2200;

let map: MapboxMap | null = null;
let storyboard: Storyboard | null = null;
let active = false;
let lang: NarrLang = "both";

let appliedCaptionIndex = -1; // 字幕已套到第幾個 shot
let appliedCameraIndex = -1;  // 相機已飛到第幾個 shot
let lastUserInteractAt = -Infinity;

let unsubClock: (() => void) | null = null;
let mapListenersBound = false;

const listeners = new Set<() => void>();
function notify() { for (const cb of listeners) cb(); }

// caption 物件 cache：內容沒變就回同一個參考（useSyncExternalStore getSnapshot 要穩定參考）
let captionCache: CinemaCaption | null = null;

function onUserInteract() { lastUserInteractAt = performance.now(); }

function bindMapListeners() {
  if (!map || mapListenersBound) return;
  map.on("dragstart", onUserInteract);
  map.on("wheel", onUserInteract);
  map.on("rotatestart", onUserInteract);
  map.on("pitchstart", onUserInteract);
  mapListenersBound = true;
}

function unbindMapListeners() {
  if (!map || !mapListenersBound) return;
  map.off("dragstart", onUserInteract);
  map.off("wheel", onUserInteract);
  map.off("rotatestart", onUserInteract);
  map.off("pitchstart", onUserInteract);
  mapListenersBound = false;
}

/** 找出當下 simTime 對應的 active shot index（最後一個 atSimSec <= simTime） */
function activeShotIndex(simSec: number): number {
  if (!storyboard) return -1;
  const shots = storyboard.shots;
  let idx = 0;
  for (let i = 0; i < shots.length; i++) {
    const s = shots[i];
    if (s && s.atSimSec <= simSec) idx = i;
    else break;
  }
  return idx;
}

function countAlive(focus: string[] | undefined, sideId: string): number {
  if (!focus) return 0;
  const units = scenarioStore.getState().units;
  let n = 0;
  for (const id of focus) {
    const u = units[id];
    if (u && u.sideId === sideId && u.hpCurrent > 0) n++;
  }
  return n;
}

function buildCaption(shot: CinemaShot): CinemaCaption {
  return {
    dateLabel: shot.dateLabel,
    titleZh: shot.titleZh,
    titleEn: shot.titleEn,
    narrZh: shot.narrZh,
    narrEn: shot.narrEn,
    blueAlive: countAlive(shot.focus, "blue"),
    redAlive: countAlive(shot.focus, "red"),
    lang,
  };
}

function applyCamera(shot: CinemaShot) {
  if (!map) return;
  map.flyTo({
    center: shot.camera.center,
    zoom: shot.camera.zoom,
    pitch: shot.camera.pitch,
    bearing: shot.camera.bearing,
    duration: FLY_DURATION_MS,
    essential: true,
  });
}

/** clock / store 每次變動都會呼叫；只在 shot 切換時才動字幕與相機 */
function tick() {
  if (!active || !storyboard) return;
  const simSec = wargameClock.getSimTime();
  const idx = activeShotIndex(simSec);
  if (idx < 0) return;
  const shot = storyboard.shots[idx];
  if (!shot) return;

  // 字幕：shot 換了就更新（free-look 期間字幕照走）
  if (idx !== appliedCaptionIndex) {
    appliedCaptionIndex = idx;
    captionCache = buildCaption(shot);
    notify();
  } else if (captionCache) {
    // 同一 shot 內，存活數可能變 → 內容變了才換參考
    const next = buildCaption(shot);
    if (next.blueAlive !== captionCache.blueAlive || next.redAlive !== captionCache.redAlive) {
      captionCache = next;
      notify();
    }
  }

  // 相機：玩家近期有操作（free-look）就先不搶鏡頭，等閒置後補飛
  const idle = performance.now() - lastUserInteractAt > RESUME_IDLE_MS;
  if (idx !== appliedCameraIndex && idle) {
    appliedCameraIndex = idx;
    applyCamera(shot);
  }
}

export const cinemaDirector = {
  isActive(): boolean { return active; },
  getCaption(): CinemaCaption | null { return captionCache; },
  getLang(): NarrLang { return lang; },

  /** 目前場景有沒有 storyboard（決定紀錄片鈕顯不顯示） */
  hasStoryboardForCurrentScenario(): boolean {
    const id = scenarioStore.getState().scenario?.id;
    return !!getStoryboard(id);
  },

  /** 啟動紀錄片模式：綁地圖、訂閱時鐘、跳到當下 shot */
  start(m: MapboxMap | null): boolean {
    const id = scenarioStore.getState().scenario?.id;
    const sb = getStoryboard(id);
    if (!sb || !m) return false;
    map = m;
    storyboard = sb;
    active = true;
    appliedCaptionIndex = -1;
    appliedCameraIndex = -1;
    lastUserInteractAt = -Infinity;
    bindMapListeners();
    // 時鐘與場景任一變動都重算（live tick notify、replay seek notify、戰損 notify）
    const unsubA = wargameClock.subscribe(tick);
    const unsubB = scenarioStore.subscribe(tick);
    unsubClock = () => { unsubA(); unsubB(); };
    tick();
    notify();
    return true;
  },

  /** 退出紀錄片模式：解綁、清字幕，恢復成沒這功能的樣子 */
  stop(): void {
    active = false;
    storyboard = null;
    captionCache = null;
    appliedCaptionIndex = -1;
    appliedCameraIndex = -1;
    unbindMapListeners();
    if (unsubClock) { unsubClock(); unsubClock = null; }
    map = null;
    notify();
  },

  /** 中／EN／雙語切換 */
  cycleLang(): void {
    lang = lang === "both" ? "zh" : lang === "zh" ? "en" : "both";
    if (captionCache) captionCache = { ...captionCache, lang };
    notify();
  },

  /** 手動重新框住當下鏡頭（free-look 後想立刻回到分鏡） */
  recenter(): void {
    if (!active || !storyboard) return;
    const idx = activeShotIndex(wargameClock.getSimTime());
    const shot = idx >= 0 ? storyboard.shots[idx] : undefined;
    if (!shot) return;
    appliedCameraIndex = idx;
    lastUserInteractAt = -Infinity;
    applyCamera(shot);
  },

  subscribe(cb: () => void): () => void {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
};
