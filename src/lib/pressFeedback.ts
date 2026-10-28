/**
 * 全域按壓回饋：點擊 / 觸控任何按鈕時，在按壓點放一圈擴散光環（.wg-tap，樣式在 wargame/styles.css）；
 * 鍵盤 Enter / Space 觸發按鈕時，光環出現在按鈕中心。
 *
 * 另外在 document 掛一個空的 touchstart 監聽 —— iOS Safari 沒有它的話，
 * 觸控時 CSS :active（按下縮放 / 變色）不會生效，使用者按下去看不到任何反應。
 *
 * 只作用在可互動控制項上；地圖 canvas 的點擊不出光環（地圖有自己的指令標記）。
 */
const INTERACTIVE = 'button, [role="button"], a[href], summary, input[type="checkbox"], input[type="radio"]';
const RING_MS = 450;

function isDisabled(el: HTMLElement): boolean {
  return (el as HTMLButtonElement).disabled === true || el.getAttribute("aria-disabled") === "true";
}

function spawnRing(x: number, y: number): void {
  const ring = document.createElement("span");
  ring.className = "wg-tap";
  ring.style.left = `${x}px`;
  ring.style.top = `${y}px`;
  document.body.appendChild(ring);
  window.setTimeout(() => ring.remove(), RING_MS + 50);
}

/** 安裝全域按壓回饋；回傳卸載函式 */
export function installPressFeedback(): () => void {
  const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)");
  const noop = () => {};

  const onPointerDown = (e: PointerEvent) => {
    if (e.pointerType === "mouse" && e.button !== 0) return;
    if (reduceMotion?.matches) return;
    const el = (e.target as Element | null)?.closest?.(INTERACTIVE) as HTMLElement | null;
    if (!el || isDisabled(el)) return;
    spawnRing(e.clientX, e.clientY);
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.repeat || (e.key !== "Enter" && e.key !== " ")) return;
    if (reduceMotion?.matches) return;
    const el = e.target as HTMLElement | null;
    if (!el?.matches?.(INTERACTIVE) || isDisabled(el)) return;
    const r = el.getBoundingClientRect();
    spawnRing(r.left + r.width / 2, r.top + r.height / 2);
  };

  document.addEventListener("touchstart", noop, { passive: true });
  document.addEventListener("pointerdown", onPointerDown, { capture: true, passive: true });
  document.addEventListener("keydown", onKeyDown, { capture: true });
  return () => {
    document.removeEventListener("touchstart", noop);
    document.removeEventListener("pointerdown", onPointerDown, { capture: true });
    document.removeEventListener("keydown", onKeyDown, { capture: true });
  };
}
