/**
 * 經緯度 度分秒（DMS，60 進位）⇄ 十進位度 轉換與解析。
 *
 * 搜索區多邊形輸入用：海圖 / 通報慣用 23°12′30″N 這種寫法，
 * 引擎內部一律用十進位度。純函式、零 browser 依賴。
 */

export type CoordAxis = "lng" | "lat";

/** 一個座標分量的度分秒；neg = 西經 / 南緯 */
export interface Dms {
  deg: number;
  min: number;
  sec: number;
  neg: boolean;
}

/** 秒數顯示的小數位（0.1″ ≈ 3 m，搜索規劃足夠） */
export const DMS_SEC_DECIMALS = 1;

/** 十進位度 → 度分秒（秒四捨五入到 DMS_SEC_DECIMALS 位並處理進位，避免出現 60″） */
export function decimalToDms(value: number): Dms {
  const neg = value < 0;
  const scale = 10 ** DMS_SEC_DECIMALS;
  // 以「最小秒單位」整數運算，避免 59.99999″ 之類的浮點殘差
  const totalUnits = Math.round(Math.abs(value) * 3600 * scale);
  const deg = Math.floor(totalUnits / (3600 * scale));
  const rest = totalUnits - deg * 3600 * scale;
  const min = Math.floor(rest / (60 * scale));
  const sec = (rest - min * 60 * scale) / scale;
  return { deg, min, sec, neg };
}

/** 度分秒 → 十進位度 */
export function dmsToDecimal(d: Dms): number {
  const v = d.deg + d.min / 60 + d.sec / 3600;
  return d.neg ? -v : v;
}

export type DmsIssue = "out_of_range" | "minsec_range";

/** 檢查度分秒各欄位；null = 合法 */
export function validateDms(d: Dms, axis: CoordAxis): DmsIssue | null {
  if (![d.deg, d.min, d.sec].every(Number.isFinite)) return "out_of_range";
  if (d.min < 0 || d.min >= 60 || d.sec < 0 || d.sec >= 60) return "minsec_range";
  if (d.deg < 0 || !Number.isInteger(d.deg) || !Number.isInteger(d.min)) return "minsec_range";
  const limit = axis === "lng" ? 180 : 85;
  if (Math.abs(dmsToDecimal(d)) > limit) return "out_of_range";
  return null;
}

/** 顯示用：119°30′15.0″E */
export function formatDms(value: number, axis: CoordAxis): string {
  const d = decimalToDms(value);
  const hemi = axis === "lng" ? (d.neg ? "W" : "E") : (d.neg ? "S" : "N");
  return `${d.deg}°${String(d.min).padStart(2, "0")}′${d.sec.toFixed(DMS_SEC_DECIMALS).padStart(2 + 1 + DMS_SEC_DECIMALS, "0")}″${hemi}`;
}

/**
 * 解析單一座標字串，接受：
 *   119°30′15.5″E · 119°30'15.5"E · 119 30 15.5 · 119-30-15 · 119度30分15秒
 *   E119°30′ · 23°12.5′N（度 + 十進位分）· 119.5（十進位度）· -23.2
 * 半球字母 W / S（或負號）→ 負值。失敗回 null。
 */
export function parseCoordinate(text: string, axis: CoordAxis): number | null {
  let s = text.trim().toUpperCase();
  if (!s) return null;
  let neg = false;
  const hemi = s.match(/[NSEW東西南北]/g);
  if (hemi) {
    if (hemi.length > 1) return null;
    const h = hemi[0] as string;
    const isLngHemi = "EW東西".includes(h);
    if ((axis === "lng") !== isLngHemi) return null;   // 經度欄寫了 N/S 之類
    neg = "WS西南".includes(h);
    s = s.replace(/[NSEW東西南北]/g, " ");
  }
  if (s.trim().startsWith("-")) {
    if (neg) return null;                                // 同時有負號與 W/S → 不明確
    neg = true;
    s = s.trim().slice(1);
  }
  // 度分秒符號（含全形 / 中文）統一成空白分隔
  const parts = s
    .replace(/[°º˚度'′’‘分"″”“秒:：-]/g, " ")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0 || parts.length > 3) return null;
  if (!parts.every((p) => /^\d+(\.\d+)?$/.test(p))) return null;
  const nums = parts.map(Number);
  const [deg = 0, min = 0, sec = 0] = nums;
  // 只有最後一個欄位可以帶小數（119.5° 或 23°12.5′ 或 23°12′30.5″）
  if (nums.slice(0, -1).some((v) => !Number.isInteger(v))) return null;
  if (parts.length >= 2 && (min >= 60 || sec >= 60)) return null;
  const v = deg + min / 60 + sec / 3600;
  const limit = axis === "lng" ? 180 : 85;
  if (v > limit) return null;
  return neg ? -v : v;
}

/** 一行座標的書寫順序：經度在前 / 緯度在前 */
export type CoordOrder = "lnglat" | "latlng";

/**
 * 解析一行座標（回傳 [經度, 緯度]）。座標內部可能含空白（119 30 15），所以：
 *   1. 有逗號 / 分號 / tab → 依此切兩半
 *   2. 有半球字母 → 依字母判斷哪段是經度、哪段是緯度（不看 order）
 *   3. 純數字以空白分隔 → 2 個 = 十進位度、4 個 = 度分、6 個 = 度分秒，對半切
 * 沒有半球字母時先依 order 解讀；若數值超出該軸範圍（例：緯度 119）則改試另一順序 ——
 * 台海經度 119–122 不可能是緯度，所以順序寫反也能自動辨識。失敗回 null。
 */
export function parseLngLatLine(line: string, order: CoordOrder = "lnglat"): [number, number] | null {
  const raw = line.trim();
  if (!raw) return null;

  const tryPair = (lngText: string, latText: string): [number, number] | null => {
    const lng = parseCoordinate(lngText, "lng");
    const lat = parseCoordinate(latText, "lat");
    return lng !== null && lat !== null ? [lng, lat] : null;
  };
  /** a、b 為書寫順序的兩段 */
  const tryOrdered = (a: string, b: string): [number, number] | null =>
    order === "lnglat" ? (tryPair(a, b) ?? tryPair(b, a)) : (tryPair(b, a) ?? tryPair(a, b));

  const bySep = raw.split(/[,，;；\t]+/).map((x) => x.trim()).filter(Boolean);
  if (bySep.length === 2) {
    const [a = "", b = ""] = bySep;
    return tryOrdered(a, b);
  }

  const lngHemi = raw.search(/[EW東西]/i);
  const latHemi = raw.search(/[NS北南]/i);
  if (lngHemi >= 0 && latHemi >= 0) {
    // 半球字母可能在數字前（E119…）或後（119…E）：取兩字母之間較合理的切點
    const cut = lngHemi < latHemi
      ? (/^\s*[EW東西]/i.test(raw) ? latHemi : lngHemi + 1)
      : (/^\s*[NS北南]/i.test(raw) ? lngHemi : latHemi + 1);
    const a = raw.slice(0, cut), b = raw.slice(cut);
    return lngHemi < latHemi ? tryPair(a, b) : tryPair(b, a);
  }

  const tokens = raw.split(/\s+/).filter(Boolean);
  if (tokens.length === 2 || tokens.length === 4 || tokens.length === 6) {
    const half = tokens.length / 2;
    return tryOrdered(tokens.slice(0, half).join(" "), tokens.slice(half).join(" "));
  }
  return null;
}
