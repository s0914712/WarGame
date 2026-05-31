/**
 * Wargame 模式的底圖樣式選項。
 * 兵推預設深色（戰場感），但加 satellite 給「實景對位」demo 用。
 */
export interface WargameMapStyle {
  id: string;
  name: string;
  url: string;
  /** 適合的「自然」對比樣式（symbol 文字光暈用） */
  isDark: boolean;
}

export const WARGAME_MAP_STYLES: WargameMapStyle[] = [
  { id: "dark",      name: "暗色（預設）",    url: "mapbox://styles/mapbox/dark-v11",          isDark: true },
  { id: "satellite", name: "衛星圖",          url: "mapbox://styles/mapbox/satellite-v9",      isDark: true },
  { id: "sat-streets", name: "衛星 + 道路",   url: "mapbox://styles/mapbox/satellite-streets-v12", isDark: true },
  { id: "nav-night", name: "夜間導航",        url: "mapbox://styles/mapbox/navigation-night-v1", isDark: true },
  { id: "outdoors",  name: "地形圖",          url: "mapbox://styles/mapbox/outdoors-v12",      isDark: false },
  { id: "streets",   name: "街道圖",          url: "mapbox://styles/mapbox/streets-v12",       isDark: false },
  { id: "light",     name: "淺色",            url: "mapbox://styles/mapbox/light-v11",         isDark: false },
];

export const DEFAULT_STYLE_ID = "dark";

export function getStyleById(id: string): WargameMapStyle {
  return WARGAME_MAP_STYLES.find((s) => s.id === id) ?? WARGAME_MAP_STYLES[0]!;
}
