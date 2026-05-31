/**
 * Replay 播放器。
 *
 * 載入 Recording 後：
 *   - replay 模式 ON：所有寫入（engine.tick / enqueueCommand / updateAttr）被 player 接管
 *   - 拖動進度條 → seek 到對應 snapshot → scenarioStore.setState + clock.seek
 *   - 退出 replay：把記憶體狀態恢復成「目前 scenario 重新載入」
 *
 * 注意：replay 模式下，useSimLoop 仍會跑 engine.tick；為避免污染，
 *   進 replay 即 pause clock；要前進就拖 scrub bar。
 */
import { scenarioStore } from "../scenarioStore";
import { wargameClock } from "../clock";
import type { Recording } from "./recorder";

let recording: Recording | null = null;
let isActive = false;
let currentIndex = 0;

const listeners = new Set<() => void>();
function notify() { for (const cb of listeners) cb(); }

export const replayPlayer = {
  isActive(): boolean { return isActive; },
  getRecording(): Recording | null { return recording; },
  getCurrentIndex(): number { return currentIndex; },
  getSnapshotCount(): number { return recording?.snapshots.length ?? 0; },

  load(rec: Recording): boolean {
    if (!rec || rec.version !== "wargame-replay-v1" || !Array.isArray(rec.snapshots)) {
      return false;
    }
    recording = rec;
    isActive = true;
    currentIndex = 0;
    wargameClock.pause();
    this.seekToIndex(0);
    notify();
    return true;
  },

  seekToIndex(idx: number): void {
    if (!recording) return;
    const clamped = Math.max(0, Math.min(recording.snapshots.length - 1, idx));
    const snap = recording.snapshots[clamped];
    if (!snap) return;
    currentIndex = clamped;
    scenarioStore.setState(structuredClone(snap.state));
    wargameClock.seek(snap.simSec);
    notify();
  },

  next(): void { this.seekToIndex(currentIndex + 1); },
  prev(): void { this.seekToIndex(currentIndex - 1); },

  exit(): void {
    recording = null;
    isActive = false;
    currentIndex = 0;
    notify();
  },

  subscribe(cb: () => void): () => void {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
};

/** 解析上傳的 JSON 檔；失敗回 null */
export async function loadRecordingFromFile(file: File): Promise<Recording | null> {
  try {
    const text = await file.text();
    const json = JSON.parse(text) as Recording;
    if (json.version !== "wargame-replay-v1") return null;
    return json;
  } catch {
    return null;
  }
}
