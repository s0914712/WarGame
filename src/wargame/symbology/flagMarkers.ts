/**
 * 紀錄片模式的「期旗 marker」— 借鏡 battle-of-hong-kong-1941 flags.js（canvas 畫旗）。
 *
 * 用途：紀錄片模式啟用時，把單位 marker 從 NATO 軍標換成 1958 史實旗幟，
 *   讓 823 砲戰重播更有時代感。退出紀錄片就還原軍標。
 *
 * 1958 正確旗幟：
 *   - 守軍（blue）→ 中華民國國旗「青天白日滿地紅」
 *   - 共軍（red） → 中華人民共和國國旗「五星紅旗」（1949 啟用，1958 正確）
 *   其他陣營無對應旗 → flagIconNameOf 回 null，由 caller fallback 回軍標。
 *
 * 與軍標同樣走 map.addImage（ImageData + pixelRatio 2），symbol layer 用 icon-image 取用。
 */
import type { Map as MapboxMap } from "mapbox-gl";
import type { SideId } from "../types";

const W = 44;   // 旗面邏輯寬
const H = 30;   // 旗面邏輯高
const DPR = 2;

const FLAG_SIDES: SideId[] = ["blue", "red"];

export function flagIconNameOf(side: SideId): string | null {
  return FLAG_SIDES.includes(side) ? `wg-flag-${side}` : null;
}

/** 啟動時呼叫一次：把 blue / red 兩面旗 cache 進 Mapbox image registry（idempotent）。 */
export function registerFlagMarkers(map: MapboxMap): void {
  for (const side of FLAG_SIDES) {
    const name = `wg-flag-${side}`;
    if (map.hasImage(name)) continue;
    const canvas = side === "blue" ? drawROC() : drawPRC();
    const ctx = canvas.getContext("2d");
    if (!ctx) continue;
    const img = ctx.getImageData(0, 0, canvas.width, canvas.height);
    map.addImage(name, img, { pixelRatio: DPR });
  }
}

function newCanvas(): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement("canvas");
  canvas.width = W * DPR;
  canvas.height = H * DPR;
  const ctx = canvas.getContext("2d")!;
  ctx.scale(DPR, DPR);
  return { canvas, ctx };
}

/** 細白邊讓旗子在地圖底圖上有對比 */
function strokeBorder(ctx: CanvasRenderingContext2D) {
  ctx.strokeStyle = "rgba(255,255,255,0.85)";
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, W - 1, H - 1);
}

/** 五角星路徑（tip 預設朝上，rot 旋轉弧度） */
function starPath(ctx: CanvasRenderingContext2D, cx: number, cy: number, outerR: number, rot: number) {
  const innerR = outerR * 0.382;
  ctx.beginPath();
  for (let i = 0; i < 10; i++) {
    const r = i % 2 === 0 ? outerR : innerR;
    const a = rot - Math.PI / 2 + (i * Math.PI) / 5;
    const x = cx + r * Math.cos(a);
    const y = cy + r * Math.sin(a);
    if (i === 0) ctx.moveTo(x, y);
    else ctx.lineTo(x, y);
  }
  ctx.closePath();
}

/** 中華民國國旗：紅地 + 左上藍底白日（12 道光芒） */
function drawROC(): HTMLCanvasElement {
  const { canvas, ctx } = newCanvas();
  // 紅地
  ctx.fillStyle = "#FE0000";
  ctx.fillRect(0, 0, W, H);
  // 藍底（左上 1/2 × 1/2）
  const cw = W / 2, ch = H / 2;
  ctx.fillStyle = "#000095";
  ctx.fillRect(0, 0, cw, ch);
  // 白日：12 道光芒 + 中心
  const cx = cw / 2, cy = ch / 2;
  const rayOuter = 6.4, rayInner = 3.9;
  ctx.fillStyle = "#FFFFFF";
  for (let i = 0; i < 12; i++) {
    const a0 = (i * Math.PI) / 6 - Math.PI / 12;
    const a1 = (i * Math.PI) / 6 + Math.PI / 12;
    const aMid = (i * Math.PI) / 6;
    ctx.beginPath();
    ctx.moveTo(cx + rayInner * Math.cos(a0), cy + rayInner * Math.sin(a0));
    ctx.lineTo(cx + rayOuter * Math.cos(aMid), cy + rayOuter * Math.sin(aMid));
    ctx.lineTo(cx + rayInner * Math.cos(a1), cy + rayInner * Math.sin(a1));
    ctx.closePath();
    ctx.fill();
  }
  // 藍環（製造白日的藍色間隙）+ 白心
  ctx.fillStyle = "#000095";
  ctx.beginPath(); ctx.arc(cx, cy, 4.0, 0, Math.PI * 2); ctx.fill();
  ctx.fillStyle = "#FFFFFF";
  ctx.beginPath(); ctx.arc(cx, cy, 3.1, 0, Math.PI * 2); ctx.fill();

  strokeBorder(ctx);
  return canvas;
}

/** 中華人民共和國國旗：紅地 + 左上一大四小金星 */
function drawPRC(): HTMLCanvasElement {
  const { canvas, ctx } = newCanvas();
  ctx.fillStyle = "#EE1C25";
  ctx.fillRect(0, 0, W, H);

  // 旗幟規範座標系：30 寬 × 20 高
  const sx = W / 30, sy = H / 20;
  ctx.fillStyle = "#FFDE00";

  // 大星：中心 (5,5)，外徑 3 單位
  const bigCx = 5 * sx, bigCy = 5 * sy, bigR = 3 * ((sx + sy) / 2);
  starPath(ctx, bigCx, bigCy, bigR, 0);
  ctx.fill();

  // 4 小星：中心 (10,2)(12,4)(12,7)(10,9)，外徑 1 單位，各有一角朝大星
  const smalls: [number, number][] = [[10, 2], [12, 4], [12, 7], [10, 9]];
  const smallR = 1.15 * ((sx + sy) / 2);
  for (const [ux, uy] of smalls) {
    const cx = ux * sx, cy = uy * sy;
    const rot = Math.atan2(bigCy - cy, bigCx - cx) + Math.PI / 2; // 一角指向大星
    starPath(ctx, cx, cy, smallR, rot);
    ctx.fill();
  }

  strokeBorder(ctx);
  return canvas;
}
