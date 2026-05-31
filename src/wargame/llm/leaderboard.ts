/**
 * Match leaderboard — localStorage 排行榜，跨 reload 持久化。
 *
 * 用途：跑 3 個 LLM 對同一場景，記錄 (model, score, outcome, sim time) 後排序比較。
 */
import type { ScoreBreakdown } from "../sim/matchScore";

export interface LeaderboardEntry {
  ts: number;                 // wall time
  model: string;
  scenarioId: string;
  total: number;
  breakdown: ScoreBreakdown;  // 完整 breakdown 方便事後檢視
}

const KEY = "wargame.leaderboard.v1";

function load(): LeaderboardEntry[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function save(entries: LeaderboardEntry[]) {
  try {
    localStorage.setItem(KEY, JSON.stringify(entries));
  } catch {
    /* quota / private mode → ignore */
  }
}

const listeners = new Set<() => void>();
let cache: LeaderboardEntry[] = load();

export const leaderboardStore = {
  getEntries(): LeaderboardEntry[] {
    return cache;
  },

  /** 加一筆紀錄（同 model+scenario 不去重，使用者可多次跑） */
  add(entry: Omit<LeaderboardEntry, "ts">): void {
    cache = [...cache, { ...entry, ts: Date.now() }];
    save(cache);
    for (const cb of listeners) cb();
  },

  clear(): void {
    cache = [];
    save(cache);
    for (const cb of listeners) cb();
  },

  removeAt(idx: number): void {
    cache = cache.filter((_, i) => i !== idx);
    save(cache);
    for (const cb of listeners) cb();
  },

  subscribe(cb: () => void): () => void {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
};
