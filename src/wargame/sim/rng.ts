/**
 * Deterministic PRNG（LCG）— 給 combat 使用。
 *
 * seed = (simTimeSec, attackerId, targetId) 可組出，讓重播 deterministic。
 */
export function seedFromStrings(...keys: (string | number)[]): number {
  let h = 2166136261 >>> 0;
  for (const k of keys) {
    const s = String(k);
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619);
    }
  }
  return h >>> 0;
}

export function makeRng(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
