/**
 * 兵推時鐘（wargameClock）。
 *
 * 與 src/state/timeStore.ts 並行：
 *   - timeStore 鎖死「unix wall time」，給民用圖層用
 *   - wargameClock 是「sim-time T+ 累計秒」，可暫停、可加速、可 seek
 *
 * 設計：
 *   - 單一 RAF（useWargameClock）每幀呼叫 tickFromWall(now)
 *   - 暫停就停止呼叫 setTime；scenes 透過 subscribe 拉值 → 自然凍結
 *   - 任何寫入都 notify listeners，UI 用 useSyncExternalStore 接
 */

type Listener = () => void;

let simTimeSec = 0;
let simRate = 5;             // 1 wall-sec → 5 sim-sec
let isPaused = true;          // 預設暫停，等使用者按播放
let lastWallNow = performance.now();

const listeners = new Set<Listener>();

function notify() {
  for (const cb of listeners) cb();
}

export const SIM_RATE_PRESETS = [1, 5, 30, 60] as const;

/** 把秒數格式化成 T+HH:MM:SS（時數沒上限） */
export function formatTPlus(sec: number): string {
  const total = Math.max(0, Math.floor(sec));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  return `T+${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

export const wargameClock = {
  getSimTime(): number {
    return simTimeSec;
  },

  getRate(): number {
    return simRate;
  },

  isPaused(): boolean {
    return isPaused;
  },

  getTPlus(): string {
    return formatTPlus(simTimeSec);
  },

  pause(): void {
    if (isPaused) return;
    isPaused = true;
    notify();
  },

  resume(): void {
    if (!isPaused) return;
    isPaused = false;
    lastWallNow = performance.now();   // 重設基準避免大跳
    notify();
  },

  toggle(): void {
    if (isPaused) this.resume();
    else this.pause();
  },

  setRate(r: number): void {
    if (r === simRate) return;
    simRate = r;
    notify();
  },

  seek(sec: number): void {
    const next = Math.max(0, sec);
    if (next === simTimeSec) return;
    simTimeSec = next;
    notify();
  },

  /** 由 useWargameClock 的 RAF loop 呼叫；暫停時 no-op */
  tickFromWall(wallNow: number): void {
    if (isPaused) {
      lastWallNow = wallNow;
      return;
    }
    const dtWall = (wallNow - lastWallNow) / 1000;
    lastWallNow = wallNow;
    simTimeSec += dtWall * simRate;
    notify();
  },

  /** 重置場景時呼叫 */
  reset(): void {
    simTimeSec = 0;
    isPaused = true;
    lastWallNow = performance.now();
    notify();
  },

  subscribe(cb: Listener): () => void {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
};

export type WargameClock = typeof wargameClock;
