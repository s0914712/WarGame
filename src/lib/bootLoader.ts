/**
 * 開機載入畫面（index.html 的 #wg-boot）的 React 端介面。
 *
 * index.html 在 JS bundle 下載前就顯示進度條（0 → ~40% 緩慢逼近）；
 * app 啟動後用 stage() 回報真實階段推進，全部就緒呼叫 done() 淡出並移除。
 * 非兵棋模式（civilian / search）自有載入畫面 → main.tsx 直接 done()。
 */
interface BootApi {
  stage(base: number, ceil: number, zh: string, en?: string): void;
  hint(zh: string, en?: string): void;
  done(): void;
  fail(msg: string): void;
}

function api(): BootApi | undefined {
  return (window as unknown as { __wgBoot?: BootApi }).__wgBoot;
}

export const bootLoader = {
  /** 進度推進到 base%，並在等待下一階段時緩慢爬向 ceil% */
  stage(base: number, ceil: number, zh: string, en?: string): void { api()?.stage(base, ceil, zh, en); },
  /** 進度條下方的補充提示（如網路慢） */
  hint(zh: string, en?: string): void { api()?.hint(zh, en); },
  /** 100% → 淡出移除（重複呼叫無害） */
  done(): void { api()?.done(); },
  fail(msg: string): void { api()?.fail(msg); },
};
