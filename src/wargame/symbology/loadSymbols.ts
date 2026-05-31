/**
 * 啟動時把 9 個 NATO 軍事符號 cache 進 Mapbox image registry。
 *
 * 流程：milsymbol.Symbol(sidc, {size: N}) → asCanvas() → getImageData →
 *       map.addImage(name, ImageData, { pixelRatio: 2 })
 *
 * 之後 symbol layer 用 "icon-image": "{iconName}" 就能直接顯示。
 */
import type { Map as MapboxMap } from "mapbox-gl";
import ms from "milsymbol";
import { ALL_SIDC_VARIANTS } from "./sidc";
import { SIDE_COLORS } from "./sideColors";
import type { SideId } from "../types";

const SYMBOL_SIZE_PX = 56;
const PIXEL_RATIO = 2;

/**
 * 給 milsymbol 的 colorMode：依該 variant 的 side 把對應的 affiliation 顏色換成 side 主色。
 * 例如 us 是 Friend 框，但 colorMode.Friend 改成綠色 → us 單位顯示為綠框。
 */
function makeColorMode(side: SideId) {
  const c = SIDE_COLORS[side].primary;
  // 預設 milsymbol Medium 主題，再覆寫對應 affiliation
  // 結構照 milsymbol 規範：Civilian / Friend / Hostile / Neutral / Unknown / Suspect
  switch (side) {
    case "blue":
      return { Friend: "#80E0FF", Hostile: "#FF8080", Neutral: "#AAFFAA", Unknown: "#FFFF80", Suspect: "#FF80FF", Civilian: "#FF80FF" };
    case "us":
      return { Friend: c, Hostile: "#FF8080", Neutral: "#AAFFAA", Unknown: "#FFFF80", Suspect: "#FF80FF", Civilian: "#FF80FF" };
    case "japan":
      return { Friend: c, Hostile: "#FF8080", Neutral: "#AAFFAA", Unknown: "#FFFF80", Suspect: "#FF80FF", Civilian: "#FF80FF" };
    case "red":
    case "neutral":
    default:
      return undefined; // 用 milsymbol 預設
  }
}

export function loadWargameSymbols(map: MapboxMap): void {
  for (const variant of ALL_SIDC_VARIANTS) {
    if (map.hasImage(variant.iconName)) continue;
    const canvas = renderSidcCanvas(variant.sidc, variant.side);
    if (!canvas) continue;
    const ctx = canvas.getContext("2d");
    if (!ctx) continue;
    const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
    map.addImage(variant.iconName, imgData, { pixelRatio: PIXEL_RATIO });
  }
}

function renderSidcCanvas(sidc: string, side: SideId): HTMLCanvasElement | null {
  try {
    const colorMode = makeColorMode(side);
    const sym = new ms.Symbol(sidc, {
      size: SYMBOL_SIZE_PX,
      ...(colorMode ? { colorMode } : {}),
    });
    return sym.asCanvas(PIXEL_RATIO);
  } catch (e) {
    console.warn("[wargame symbology] failed to render sidc", sidc, e);
    return null;
  }
}
