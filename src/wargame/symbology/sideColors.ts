/**
 * 統一陣營顏色 — UI、Mapbox layer、milsymbol colorMode 全部共用這份。
 *
 * 加新陣營：擴 SideId enum + 在這裡加一筆 + scenario 用對應色。
 */
import type { SideId } from "../types";

export const SIDE_COLORS: Record<SideId, { primary: string; secondary: string }> = {
  blue:    { primary: "#3B82F6", secondary: "#93C5FD" },
  red:     { primary: "#EF4444", secondary: "#FCA5A5" },
  neutral: { primary: "#9CA3AF", secondary: "#D1D5DB" },
  us:      { primary: "#10B981", secondary: "#6EE7B7" },   // emerald / 美軍綠
  japan:   { primary: "#F472B6", secondary: "#FBCFE8" },   // 預留
};
