/**
 * Host → client 狀態快照。
 *
 * 不含 scenario（client 依 scenario_id 自行載入，只同步 acousticEnv）與
 * eventsAll（改送增量：eventsFrom 起的事件；每 KEYFRAME_EVERY 則送全量）。
 *
 * Client 端不跑 engine：收到快照後在「上一則 → 這一則」之間對單位 / 飛彈位置
 * 做線性插值，渲染延遲一個廣播週期換取平滑。
 */
import type { AcousticEnvironment, EngagementEvent, SimulationState } from "../types";
import { scenarioStore } from "../scenarioStore";
import { wargameClock } from "../clock";

export const SNAPSHOT_VERSION = 1;

export interface StateSnapshot {
  v: typeof SNAPSHOT_VERSION;
  scenarioId: string;
  /** host 廣播 session id；host 重新整理後 seq 從 0 重算，client 靠 epoch 變化重置 */
  epoch: string;
  seq: number;
  simTimeSec: number;
  rate: number;
  paused: boolean;
  acousticEnv?: AcousticEnvironment;
  units: SimulationState["units"];
  pendingCommands: SimulationState["pendingCommands"];
  missiles: SimulationState["missiles"];
  explosions: SimulationState["explosions"];
  wreckages: SimulationState["wreckages"];
  sonobuoys: SimulationState["sonobuoys"];
  passiveContacts?: SimulationState["passiveContacts"];
  holdProgress: SimulationState["holdProgress"];
  outcome: SimulationState["outcome"];
  /** events 陣列從 eventsAll 的哪個 index 開始 */
  eventsFrom: number;
  events: EngagementEvent[];
}

// ── Host 端 ────────────────────────────────────────────────────

export function buildSnapshot(
  state: SimulationState, epoch: string, seq: number, eventsFrom: number,
): StateSnapshot {
  return {
    v: SNAPSHOT_VERSION,
    scenarioId: state.scenario.id,
    epoch,
    seq,
    simTimeSec: state.simTimeSec,
    rate: wargameClock.getRate(),
    paused: wargameClock.isPaused(),
    acousticEnv: state.scenario.acousticEnv,
    units: state.units,
    pendingCommands: state.pendingCommands,
    missiles: state.missiles,
    explosions: state.explosions,
    wreckages: state.wreckages,
    sonobuoys: state.sonobuoys,
    passiveContacts: state.passiveContacts,
    holdProgress: state.holdProgress,
    outcome: state.outcome,
    eventsFrom,
    events: state.eventsAll.slice(eventsFrom),
  };
}

/** 把快照（DB 存的 / 重連用）還原成完整 state — host 重連時用 */
export function restoreFullState(snap: StateSnapshot): void {
  const cur = scenarioStore.getState();
  scenarioStore.setState({
    ...cur,
    scenario: snap.acousticEnv ? { ...cur.scenario, acousticEnv: snap.acousticEnv } : cur.scenario,
    simTimeSec: snap.simTimeSec,
    units: snap.units,
    pendingCommands: snap.pendingCommands,
    missiles: snap.missiles,
    explosions: snap.explosions,
    wreckages: snap.wreckages,
    sonobuoys: snap.sonobuoys,
    passiveContacts: snap.passiveContacts,
    holdProgress: snap.holdProgress,
    outcome: snap.outcome,
    eventsThisTick: [],
    eventsAll: snap.eventsFrom === 0 ? snap.events : cur.eventsAll,
  });
  wargameClock.seek(snap.simTimeSec);
  wargameClock.setRate(snap.rate);
}

// ── Client 端：插值套用 ─────────────────────────────────────────

let prev: StateSnapshot | null = null;
let cur: StateSnapshot | null = null;
let curArrivedAt = 0;
let interval = 500;
let authEvents: EngagementEvent[] = [];
let raf = 0;
/** 目前這則快照已插值到終點並寫入 → 之後的 frame 不必重寫 state */
let settled = false;

function lerp(a: number, b: number, t: number) { return a + (b - a) * t; }

function lerpAngle(a: number, b: number, t: number) {
  const d = ((b - a + 540) % 360) - 180;
  return (a + d * t + 360) % 360;
}

function frame() {
  raf = requestAnimationFrame(frame);
  if (!cur || settled) return;
  const t = prev ? Math.min(1, (performance.now() - curArrivedAt) / interval) : 1;
  if (t >= 1) settled = true;
  const units: SimulationState["units"] = {};
  for (const [id, u] of Object.entries(cur.units)) {
    const p = prev?.units[id];
    units[id] = p && t < 1
      ? {
          ...u,
          position: {
            ...u.position,
            lng: lerp(p.position.lng, u.position.lng, t),
            lat: lerp(p.position.lat, u.position.lat, t),
            altMeters: lerp(p.position.altMeters, u.position.altMeters, t),
            headingDeg: lerpAngle(p.position.headingDeg, u.position.headingDeg, t),
          },
        }
      : u;
  }
  const prevMissiles = prev ? new Map(prev.missiles.map((m) => [m.id, m])) : null;
  const missiles = cur.missiles.map((m) => {
    const p = prevMissiles?.get(m.id);
    return p && t < 1
      ? { ...m, position: { lng: lerp(p.position.lng, m.position.lng, t), lat: lerp(p.position.lat, m.position.lat, t) } }
      : m;
  });
  const simTimeSec = prev && t < 1 ? lerp(prev.simTimeSec, cur.simTimeSec, t) : cur.simTimeSec;

  const state = scenarioStore.getState();
  scenarioStore.setState({
    ...state,
    simTimeSec,
    units,
    missiles,
    pendingCommands: cur.pendingCommands,
    explosions: cur.explosions,
    wreckages: cur.wreckages,
    sonobuoys: cur.sonobuoys,
    passiveContacts: cur.passiveContacts,
    holdProgress: cur.holdProgress,
    outcome: cur.outcome,
    eventsThisTick: [],
    eventsAll: authEvents,
  });
}

export const clientApplier = {
  start(): void {
    prev = null; cur = null; authEvents = []; settled = false;
    if (!raf) raf = requestAnimationFrame(frame);
  },

  stop(): void {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
    prev = null; cur = null; authEvents = [];
  },

  receive(snap: StateSnapshot): void {
    if (snap.v !== SNAPSHOT_VERSION) return;
    if (cur && snap.epoch !== cur.epoch) {
      // host 重連（新 epoch）：丟掉插值起點，從這則重新開始
      prev = null; cur = null;
    }
    if (cur && snap.seq <= cur.seq) return;   // 亂序 / 重複
    const now = performance.now();
    if (cur) interval = Math.min(2000, Math.max(100, now - curArrivedAt));

    // 事件：只在連續（或全量 keyframe）時接上
    if (snap.eventsFrom === 0) authEvents = snap.events;
    else if (snap.eventsFrom <= authEvents.length) {
      authEvents = authEvents.slice(0, snap.eventsFrom).concat(snap.events);
    }

    // 聲學環境由 host 決定
    const st = scenarioStore.getState();
    if (snap.acousticEnv && st.scenario.acousticEnv !== snap.acousticEnv) {
      scenarioStore.applyAcousticEnv(snap.acousticEnv);
    }

    // 時鐘對齊：rate / pause 跟 host；誤差 > 1s 才 seek（避免 HUD 跳動）
    wargameClock.setRate(snap.rate);
    if (snap.paused) wargameClock.pause(); else wargameClock.resume();
    if (Math.abs(wargameClock.getSimTime() - snap.simTimeSec) > 1) {
      wargameClock.seek(snap.simTimeSec);
    }

    prev = cur;
    cur = snap;
    curArrivedAt = now;
    settled = false;
  },
};
