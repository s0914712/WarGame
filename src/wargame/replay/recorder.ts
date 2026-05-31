/**
 * Replay 錄影器。
 *
 * 工作：
 *   - start() → 訂閱 scenarioStore，每 SNAPSHOT_INTERVAL_SEC sim-sec 取一張 snapshot
 *   - stop() → 回傳完整 Recording 物件（可下載為 JSON）
 *   - 用 structuredClone 取 deep copy（避免後續 mutation 污染 snapshot）
 *
 * 不錄製 wargameClock 設定（rate/pause）— replay 走自己的時間軸。
 */
import { scenarioStore } from "../scenarioStore";
import { wargameClock } from "../clock";
import type { SimulationState } from "../types";

export const REPLAY_VERSION = "wargame-replay-v1";
const SNAPSHOT_INTERVAL_SEC = 10;

export interface RecordingSnapshot {
  simSec: number;
  state: SimulationState;
}

export interface Recording {
  version: typeof REPLAY_VERSION;
  scenarioId: string;
  scenarioName: string;
  startedAtSimSec: number;
  endedAtSimSec: number;
  recordedAtWallTime: string;
  snapshots: RecordingSnapshot[];
}

let isRecording = false;
let snapshots: RecordingSnapshot[] = [];
let startSimSec = 0;
let lastSnapshotSimSec = -Infinity;
let unsubScenario: (() => void) | null = null;

const listeners = new Set<() => void>();
function notify() { for (const cb of listeners) cb(); }

function takeSnapshot() {
  const simSec = wargameClock.getSimTime();
  const state = scenarioStore.getState();
  snapshots.push({
    simSec,
    state: structuredClone(state),
  });
  lastSnapshotSimSec = simSec;
}

export const recorderStore = {
  isRecording(): boolean { return isRecording; },
  getSnapshotCount(): number { return snapshots.length; },
  getStartSimSec(): number { return startSimSec; },
  getDurationSec(): number {
    return isRecording ? wargameClock.getSimTime() - startSimSec : 0;
  },

  start(): void {
    if (isRecording) return;
    isRecording = true;
    startSimSec = wargameClock.getSimTime();
    snapshots = [];
    lastSnapshotSimSec = -Infinity;
    takeSnapshot();  // 起始 snapshot
    unsubScenario = scenarioStore.subscribe(() => {
      const simSec = wargameClock.getSimTime();
      if (simSec - lastSnapshotSimSec >= SNAPSHOT_INTERVAL_SEC) {
        takeSnapshot();
      }
    });
    notify();
  },

  stop(): Recording | null {
    if (!isRecording) return null;
    isRecording = false;
    unsubScenario?.();
    unsubScenario = null;
    // 收尾 snapshot
    if (wargameClock.getSimTime() - lastSnapshotSimSec > 0.1) takeSnapshot();

    const state = scenarioStore.getState();
    const rec: Recording = {
      version: REPLAY_VERSION,
      scenarioId: state.scenario.id,
      scenarioName: state.scenario.displayName,
      startedAtSimSec: startSimSec,
      endedAtSimSec: wargameClock.getSimTime(),
      recordedAtWallTime: new Date().toISOString(),
      snapshots: [...snapshots],
    };
    notify();
    return rec;
  },

  downloadCurrent(): void {
    const rec = this.stop();
    if (!rec || rec.snapshots.length === 0) return;
    const blob = new Blob([JSON.stringify(rec)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `wargame-replay-${rec.scenarioId}-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  },

  subscribe(cb: () => void): () => void {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
};
