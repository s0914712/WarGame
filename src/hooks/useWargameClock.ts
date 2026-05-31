/**
 * useWargameClock — 兵推時鐘的 React 介面。
 *
 * - 啟動單一 RAF loop，每幀呼叫 wargameClock.tickFromWall(now)
 * - 同步把 sim-time 寫進 timeStore（讓既有 weather/news 圖層在兵推模式下不壞）
 * - 用 useSyncExternalStore + cached snapshot 給 UI 用
 *   - getSnapshot 必須回傳穩定 reference 否則 React 會無限 re-render
 *   - UI 不需要 60fps 更新 → 用 250ms 節流刷快取
 *   - scenes 不該透過 React，應直接呼叫 wargameClock.getSimTime()
 */

import { useEffect, useSyncExternalStore } from "react";
import { wargameClock } from "../wargame/clock";
import { timeStore } from "../state/timeStore";

const UI_THROTTLE_MS = 250;

interface ClockSnapshot {
  simTime: number;
  rate: number;
  isPaused: boolean;
  tPlus: string;
}

let cachedSnapshot: ClockSnapshot = buildSnapshot();
let lastSnapshotAt = 0;

function buildSnapshot(): ClockSnapshot {
  return {
    simTime: wargameClock.getSimTime(),
    rate: wargameClock.getRate(),
    isPaused: wargameClock.isPaused(),
    tPlus: wargameClock.getTPlus(),
  };
}

function snapshotsDiffer(a: ClockSnapshot, b: ClockSnapshot): boolean {
  // 比 tPlus（每秒才會變字串）+ rate + paused；simTime 用 tPlus 隱含比較
  return a.tPlus !== b.tPlus || a.rate !== b.rate || a.isPaused !== b.isPaused;
}

function getSnapshot(): ClockSnapshot {
  const now = performance.now();
  if (now - lastSnapshotAt < UI_THROTTLE_MS) return cachedSnapshot;
  lastSnapshotAt = now;
  const next = buildSnapshot();
  if (snapshotsDiffer(next, cachedSnapshot)) cachedSnapshot = next;
  return cachedSnapshot;
}

function subscribe(cb: () => void): () => void {
  // 1. clock 直接 notify（暫停 / 速率變化會即時觸發）
  // 2. 250ms interval 保證每秒至少 4 次 UI 重算 tPlus
  const unsub = wargameClock.subscribe(cb);
  const interval = window.setInterval(cb, UI_THROTTLE_MS);
  return () => {
    unsub();
    window.clearInterval(interval);
  };
}

/** 啟動 RAF + timeStore 同步。整個 wargame mode 期間都在跑。 */
function useWargameRaf() {
  useEffect(() => {
    let raf = 0;
    const epoch = Math.floor(Date.now() / 1000);

    const loop = (now: number) => {
      wargameClock.tickFromWall(now);
      timeStore.setTime(epoch + wargameClock.getSimTime());
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => cancelAnimationFrame(raf);
  }, []);
}

export function useWargameClock() {
  useWargameRaf();
  const snapshot = useSyncExternalStore(subscribe, getSnapshot, getSnapshot);

  return {
    ...snapshot,
    pause: () => wargameClock.pause(),
    resume: () => wargameClock.resume(),
    toggle: () => wargameClock.toggle(),
    setRate: (r: number) => wargameClock.setRate(r),
    seek: (sec: number) => wargameClock.seek(sec),
    reset: () => wargameClock.reset(),
  };
}
