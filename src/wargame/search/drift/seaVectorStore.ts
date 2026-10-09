/**
 * 海流 / 風場向量圖層 store —— 開關、要顯示的時刻、載入狀態。
 *
 * 資料與落水漂流同源（seaFields.ts 讀 seacurrent frames，同一份 frame 快取）。
 * 時刻：落水漂流已算好時跟著「地圖顯示」拉桿（看到的箭頭就是推算粒子當下受的流與風）；
 * 否則顯示「現在」。只抓該時刻前後兩張 frame。
 */
import { loadSeaFields, type LoadedSeaFields } from "./seaFields";
import { searchPlannerStore } from "../searchPlannerStore";

export type SeaVectorKind = "current" | "wind";

const VISIBLE_KEY = "wargame.seaVectors.v1";
const HOUR = 3_600_000;

function loadVisible(): Record<SeaVectorKind, boolean> {
  const off = { current: false, wind: false };
  try {
    const raw = localStorage.getItem(VISIBLE_KEY);
    return raw ? { ...off, ...(JSON.parse(raw) as Partial<Record<SeaVectorKind, boolean>>) } : off;
  } catch {
    return off;
  }
}

let visible = loadVisible();
let status: "idle" | "loading" | "ready" | "error" = "idle";
let error = "";
let fields: LoadedSeaFields | null = null;
/** 目前已載入場資料的時刻（整點，epoch ms） */
let loadedHourMs = 0;
let seq = 0;
let version = 0;
const listeners = new Set<() => void>();

function notify(): void {
  version++;
  for (const cb of listeners) cb();
}

/** 要顯示的時刻：有對應目前參數的漂流結果 → 拉桿時刻；否則現在。取整點（海流每小時一張） */
function desiredHourMs(): number {
  const d = searchPlannerStore.getDrift();
  const inp = searchPlannerStore.getInputs();
  const followDrift = d.result && inp.bayesEnabled && inp.priorFromLkp && inp.driftModel === "leeway"
    && searchPlannerStore.isDriftCurrent();
  const t = followDrift ? d.result!.startMs + searchPlannerStore.getDriftViewHour() * HOUR : Date.now();
  return Math.round(t / HOUR) * HOUR;
}

async function refresh(): Promise<void> {
  if (!visible.current && !visible.wind) return;
  const want = desiredHourMs();
  if (status === "ready" && want === loadedHourMs) return;
  const my = ++seq;
  status = "loading";
  error = "";
  notify();
  try {
    const f = await loadSeaFields(want, want);
    if (my !== seq) return;
    fields = f;
    loadedHourMs = want;
    status = "ready";
  } catch (e) {
    if (my !== seq) return;
    status = "error";
    error = e instanceof Error ? e.message : String(e);
  }
  notify();
}

// 拉桿 / 漂流結果改變 → 換時刻（只有開著才抓）
searchPlannerStore.subscribe(() => {
  if ((visible.current || visible.wind) && desiredHourMs() !== loadedHourMs) void refresh();
});

export const seaVectorStore = {
  subscribe(cb: () => void): () => void {
    listeners.add(cb);
    return () => { listeners.delete(cb); };
  },
  getVersion: (): number => version,
  isOn: (k: SeaVectorKind): boolean => visible[k],
  anyOn: (): boolean => visible.current || visible.wind,
  getStatus: () => status,
  getError: (): string => error,
  getFields: (): LoadedSeaFields | null => fields,
  /** 箭頭目前代表的時刻（epoch ms）；尚未載入為 0 */
  getTimeMs: (): number => loadedHourMs,
  /** 是否在跟漂流拉桿的時刻（否則是「現在」） */
  followsDrift(): boolean {
    const d = searchPlannerStore.getDrift();
    const inp = searchPlannerStore.getInputs();
    return !!d.result && inp.bayesEnabled && inp.priorFromLkp && inp.driftModel === "leeway"
      && searchPlannerStore.isDriftCurrent();
  },
  /** 顯示時刻超出 seacurrent 預報範圍（沿用端點那張） */
  outOfRange(): boolean {
    if (!fields || !loadedHourMs) return false;
    const c = fields.coverage;
    return loadedHourMs < c.current.fromMs || loadedHourMs > c.current.toMs;
  },

  setOn(k: SeaVectorKind, on: boolean): void {
    if (visible[k] === on) return;
    visible = { ...visible, [k]: on };
    try { localStorage.setItem(VISIBLE_KEY, JSON.stringify(visible)); } catch { /* private mode */ }
    notify();
    if (on) void refresh();
  },
  /** 圖層掛載時呼叫：上次開著的話把資料抓回來 */
  ensureLoaded(): void {
    void refresh();
  },
  /** 「現在」模式下時間會走：每次地圖移動時順便檢查是否跨過整點 */
  checkTime(): void {
    if ((visible.current || visible.wind) && desiredHourMs() !== loadedHourMs) void refresh();
  },
};
