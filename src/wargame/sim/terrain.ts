/**
 * 地形探針 — 判斷某座標是陸地 / 海洋。
 *
 * v1：簡化 Taiwan 主島多邊形 + ray casting，正確率 ~90%（不含外島）。
 *
 * 未來擴展（不改 caller）：
 *   - 改成從 public/geo/taiwan-land.geojson 載入多邊形
 *   - 加 DEM 海拔查詢（區分海平面下的潛艦水域 vs 灘岸）
 *   - 加禁飛區 / 管制空域 / 領海邊界
 *   - 接 Mapbox terrain query API
 *
 * 介面是 hook 形式，未來 setTerrainProbe(myImpl) 就能整批替換。
 */
import type { LngLat } from "../types";

export interface TerrainProbe {
  /** 該座標是否在陸地上 */
  isLand(lng: number, lat: number): boolean;
  /** 該座標是否在水域 */
  isWater(lng: number, lat: number): boolean;
  /** 該座標地形海拔（公尺）。水域 = 0；陸地依與中央山脈距離估計。供 LOS 遮蔽用 */
  elevationAt(lng: number, lat: number): number;
}

// ── 中央山脈遮蔽模型（A5，無 DEM 的粗略近似）──
// 台灣中央山脈大致沿 lng≈121.0 縱貫；以三角形剖面估計遮蔽高度，
// 越靠脊線越高、近海岸趨 0。足以呈現「山脈擋雷達、低空目標被本島遮蔽」。
const SPINE_LNG = 121.0;
const SPINE_HALFWIDTH_DEG = 0.45;   // 脊線兩側 ~45km 內視為高地
const RIDGE_PEAK_M = 3000;          // 中央山脈有效遮蔽峰高

// ── v1：粗略台灣主島多邊形（順時針）──
// 不含澎湖 / 金門 / 馬祖 / 蘭嶼 / 綠島；demo 用足夠
const TAIWAN_POLYGON: LngLat[] = [
  [121.55, 25.30],  // 富貴角
  [121.95, 25.00],  // 三貂角
  [121.95, 24.60],  // 蘇澳東
  [121.65, 23.20],  // 台東外海
  [121.00, 22.00],  // 鵝鑾鼻南端
  [120.85, 21.90],  // 鵝鑾鼻
  [120.25, 22.50],  // 高雄
  [120.10, 23.00],  // 嘉義沿海
  [120.15, 23.80],  // 雲林
  [120.60, 24.30],  // 苗栗
  [120.95, 24.85],  // 新竹
  [121.20, 25.10],  // 桃園
  [121.55, 25.30],  // 收尾
];

function pointInPolygon(lng: number, lat: number, poly: LngLat[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i] as LngLat;
    const [xj, yj] = poly[j] as LngLat;
    const intersect = (yi > lat) !== (yj > lat) &&
      lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

export const defaultTerrainProbe: TerrainProbe = {
  isLand(lng, lat) {
    return pointInPolygon(lng, lat, TAIWAN_POLYGON);
  },
  isWater(lng, lat) {
    return !pointInPolygon(lng, lat, TAIWAN_POLYGON);
  },
  elevationAt(lng, lat) {
    if (!pointInPolygon(lng, lat, TAIWAN_POLYGON)) return 0;
    const t = Math.max(0, 1 - Math.abs(lng - SPINE_LNG) / SPINE_HALFWIDTH_DEG);
    return RIDGE_PEAK_M * t;
  },
};

let active: TerrainProbe = defaultTerrainProbe;

export function getTerrainProbe(): TerrainProbe {
  return active;
}

/** 替換為更精準的實作（測試 / 未來 GeoJSON 載入版本用） */
export function setTerrainProbe(probe: TerrainProbe): void {
  active = probe;
}
