/**
 * UI 域全域旗標 store。
 * 目前只放 demoMode；之後若有更多 UI 偏好可加進來。
 */
type Listener = () => void;

let demoMode = false;
let tutorialOpen = false;
let landingOpen = true;     // 預設首次開頁顯示主選單
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

  subscribe(cb: Listener): () => void {
    listeners.add(cb);
    return () => listeners.delete(cb);
  },
};
