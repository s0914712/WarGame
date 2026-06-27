/**
 * UI 域全域旗標 store。
 * 目前只放 demoMode；之後若有更多 UI 偏好可加進來。
 */
type Listener = () => void;

let demoMode = false;
let tutorialOpen = false;
let landingOpen = true;     // 預設首次開頁顯示主選單
let suppressBriefingOnce = false;   // 紀錄片直入時，抑制下一次場景 briefing 自動跳出
const listeners = new Set<Listener>();

function notify() { for (const cb of listeners) cb(); }

export const uiStore = {
  isDemoMode(): boolean { return demoMode; },
  setDemoMode(v: boolean): void {
    if (v === demoMode) return;
    demoMode = v;
    notify();
  },
  toggleDemoMode(): void { this.setDemoMode(!demoMode); },

  isTutorialOpen(): boolean { return tutorialOpen; },
  setTutorialOpen(v: boolean): void {
    if (v === tutorialOpen) return;
    tutorialOpen = v;
    notify();
  },

  isLandingOpen(): boolean { return landingOpen; },
  setLandingOpen(v: boolean): void {
    if (v === landingOpen) return;
    landingOpen = v;
    notify();
  },

  /** 設定「下一次載入場景時抑制 briefing 自動跳出」（紀錄片直入用），不 notify。 */
  setSuppressBriefingOnce(): void { suppressBriefingOnce = true; },
  /** 讀取並清掉抑制旗標（read-once）。 */
  peekAndClearBriefingSuppress(): boolean {
    if (!suppressBriefingOnce) return false;
    suppressBriefingOnce = false;
    return true;
  },

  subscribe(cb: Listener): () => void {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
};
