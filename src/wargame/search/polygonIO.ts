/**
 * 多邊形搜索區的頂點排序與匯入 / 匯出（CSV、GeoJSON、KML）。
 *
 * 純函式、零 browser 依賴；檔案讀寫（FileReader / 下載）由 UI 層負責。
 */
import type { LngLat } from "../types";
import { formatDms, parseLngLatLine, type CoordOrder } from "./dms";
import { MAX_POLYGON_VERTICES } from "./tracks";

/**
 * 依繞質心的方位角排序頂點 —— 任意點集排完都是不自相交的多邊形（星形多邊形）。
 * 用於使用者輸入順序錯亂（邊線交叉）時一鍵修正。
 *
 * 角度在局部平面（經度乘 cos 緯度）算，避免高緯度經度被拉長。
 * 排序為順時針（由北起算，與方位角同向），並把原本第一個頂點保持在第一位。
 * 注意：凹多邊形若本身不是以質心為中心的星形，排序後形狀會變 —— UI 應提醒使用者確認。
 */
export function sortVerticesByAngle(pts: LngLat[]): LngLat[] {
  if (pts.length < 3) return [...pts];
  const cLng = pts.reduce((s, p) => s + p[0], 0) / pts.length;
  const cLat = pts.reduce((s, p) => s + p[1], 0) / pts.length;
  const kx = Math.cos((cLat * Math.PI) / 180);
  const bearing = (p: LngLat) => {
    const a = Math.atan2((p[0] - cLng) * kx, p[1] - cLat);   // 0 = 北、順時針為正
    return a < 0 ? a + 2 * Math.PI : a;
  };
  const dist2 = (p: LngLat) => ((p[0] - cLng) * kx) ** 2 + (p[1] - cLat) ** 2;
  const sorted = pts
    .map((p, i) => ({ p, i, a: bearing(p), d: dist2(p) }))
    .sort((x, y) => (x.a - y.a) || (x.d - y.d));
  // 旋轉陣列，讓原本的第一點仍是第一點
  const start = sorted.findIndex((x) => x.i === 0);
  return [...sorted.slice(start), ...sorted.slice(0, start)].map((x) => x.p);
}

/** 頂點是否已依繞質心的角度順序排列（排序不會改變任何東西） */
export function isAngleSorted(pts: LngLat[]): boolean {
  const s = sortVerticesByAngle(pts);
  return s.every((p, i) => p === pts[i]);
}

// ── 匯出 ──────────────────────────────────────────────────
export type ExportFormat = "csv" | "geojson" | "kml";

export const EXPORT_MIME: Record<ExportFormat, string> = {
  csv: "text/csv;charset=utf-8",
  geojson: "application/geo+json",
  kml: "application/vnd.google-earth.kml+xml",
};

/**
 * CSV：序號、度分秒、十進位度兩組欄位，欄位順序依 order（經度在前 / 緯度在前）。
 * 開頭加 BOM 讓 Excel 正確辨識 UTF-8（度分秒符號才不會亂碼）。
 */
export function toCsv(pts: LngLat[], order: CoordOrder = "lnglat"): string {
  const header = order === "lnglat"
    ? "no,lng_dms,lat_dms,lng,lat"
    : "no,lat_dms,lng_dms,lat,lng";
  const lines = pts.map(([lng, lat], i) => {
    const lngDms = formatDms(lng, "lng"), latDms = formatDms(lat, "lat");
    const lngDec = lng.toFixed(6), latDec = lat.toFixed(6);
    return order === "lnglat"
      ? `${i + 1},${lngDms},${latDms},${lngDec},${latDec}`
      : `${i + 1},${latDms},${lngDms},${latDec},${lngDec}`;
  });
  return "﻿" + [header, ...lines].join("\r\n") + "\r\n";
}

/** GeoJSON Feature（Polygon，外環首尾閉合；GeoJSON 規定座標為 [經度, 緯度]） */
export function toGeoJson(pts: LngLat[], name = "Search area"): string {
  const first = pts[0];
  const ring = first ? [...pts, first] : [];
  return JSON.stringify({
    type: "Feature",
    properties: { name },
    geometry: { type: "Polygon", coordinates: [ring.map(([lng, lat]) => [round6(lng), round6(lat)])] },
  }, null, 2);
}

/** KML（Google Earth 可直接開）；KML 座標為「經度,緯度,高度」 */
export function toKml(pts: LngLat[], name = "Search area"): string {
  const first = pts[0];
  const ring = first ? [...pts, first] : [];
  const coords = ring.map(([lng, lat]) => `${round6(lng)},${round6(lat)},0`).join(" ");
  const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  return `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>${esc(name)}</name>
    <Placemark>
      <name>${esc(name)}</name>
      <Style><LineStyle><color>ff15ccfa</color><width>2</width></LineStyle><PolyStyle><color>3315ccfa</color></PolyStyle></Style>
      <Polygon><outerBoundaryIs><LinearRing><coordinates>${coords}</coordinates></LinearRing></outerBoundaryIs></Polygon>
    </Placemark>
  </Document>
</kml>
`;
}

export function exportPolygon(pts: LngLat[], format: ExportFormat, order: CoordOrder, name?: string): string {
  switch (format) {
    case "csv": return toCsv(pts, order);
    case "geojson": return toGeoJson(pts, name);
    case "kml": return toKml(pts, name);
  }
}

function round6(v: number): number {
  return Math.round(v * 1e6) / 1e6;
}

// ── 匯入 ──────────────────────────────────────────────────
export type ImportIssue = "parse_failed" | "too_many" | "too_few" | "no_polygon";

export interface ImportResult {
  points: LngLat[];
  /** 偵測到的格式 */
  format: ExportFormat | "text";
}

/**
 * 解析匯入的檔案文字。依內容判斷格式（副檔名只當提示）：
 *   - JSON → GeoJSON（Feature / FeatureCollection / Polygon / MultiPolygon / LineString / MultiPoint，
 *     或純座標陣列 [[lng,lat], …]），取第一個多邊形的外環
 *   - 含 <coordinates> → KML，取第一組
 *   - 其他 → CSV / 純文字，每行一點（度分秒或十進位度，見 parseLngLatLine）；
 *     有表頭時依欄名（lng/lon/經、lat/緯）找出十進位或度分秒欄位
 * 首尾重複的閉合點會去掉。點數須 3–10。
 */
export function importPolygon(text: string, order: CoordOrder = "lnglat"): ImportResult | ImportIssue {
  const body = text.replace(/^﻿/, "").trim();
  if (!body) return "parse_failed";

  let points: LngLat[] | null = null;
  let format: ImportResult["format"] = "text";

  if (body.startsWith("{") || body.startsWith("[")) {
    try {
      points = coordsFromGeoJson(JSON.parse(body));
      format = "geojson";
    } catch {
      return "parse_failed";
    }
    if (!points) return "no_polygon";
  } else if (/<coordinates[\s>]/i.test(body)) {
    const m = body.match(/<coordinates[^>]*>([\s\S]*?)<\/coordinates>/i);
    if (!m?.[1]) return "no_polygon";
    points = [];
    for (const tuple of m[1].trim().split(/\s+/)) {
      const [x, y] = tuple.split(",").map(Number);
      if (!Number.isFinite(x) || !Number.isFinite(y)) return "parse_failed";
      points.push([x as number, y as number]);
    }
    format = "kml";
  } else {
    const r = coordsFromTable(body, order);
    if (!r) return "parse_failed";
    points = r;
    format = /,/.test(body) ? "csv" : "text";
  }

  points = dropClosingPoint(points);
  if (points.some(([lng, lat]) => !Number.isFinite(lng) || !Number.isFinite(lat) || Math.abs(lng) > 180 || Math.abs(lat) > 90)) {
    return "parse_failed";
  }
  if (points.length > MAX_POLYGON_VERTICES) return "too_many";
  if (points.length < 3) return "too_few";
  return { points, format };
}

function dropClosingPoint(pts: LngLat[]): LngLat[] {
  const a = pts[0], b = pts[pts.length - 1];
  if (pts.length > 1 && a && b && Math.abs(a[0] - b[0]) < 1e-9 && Math.abs(a[1] - b[1]) < 1e-9) {
    return pts.slice(0, -1);
  }
  return pts;
}

/** 從任意 GeoJSON 取第一組可用的頂點；找不到回 null */
function coordsFromGeoJson(g: unknown): LngLat[] | null {
  const pair = (c: unknown): LngLat | null =>
    Array.isArray(c) && typeof c[0] === "number" && typeof c[1] === "number" ? [c[0], c[1]] : null;
  const list = (cs: unknown): LngLat[] | null => {
    if (!Array.isArray(cs)) return null;
    const out: LngLat[] = [];
    for (const c of cs) { const p = pair(c); if (!p) return null; out.push(p); }
    return out;
  };
  if (Array.isArray(g)) {
    // 純座標陣列，或包了一層的外環
    return list(g) ?? (Array.isArray(g[0]) ? list(g[0]) : null);
  }
  if (!g || typeof g !== "object") return null;
  const o = g as { type?: string; coordinates?: unknown; geometry?: unknown; features?: unknown[]; geometries?: unknown[] };
  switch (o.type) {
    case "FeatureCollection":
      for (const f of o.features ?? []) { const r = coordsFromGeoJson(f); if (r) return r; }
      return null;
    case "GeometryCollection":
      for (const f of o.geometries ?? []) { const r = coordsFromGeoJson(f); if (r) return r; }
      return null;
    case "Feature":
      return coordsFromGeoJson(o.geometry);
    case "Polygon":
      return Array.isArray(o.coordinates) ? list(o.coordinates[0]) : null;
    case "MultiPolygon":
      return Array.isArray(o.coordinates) && Array.isArray(o.coordinates[0]) ? list(o.coordinates[0][0]) : null;
    case "LineString":
    case "MultiPoint":
      return list(o.coordinates);
    default:
      return null;
  }
}

/**
 * CSV / 純文字。若第一行是表頭（含 lng/lon/經 或 lat/緯 且不能解析成座標），
 * 依欄名找欄位：優先十進位欄（lng、lat），否則度分秒欄（lng_dms…）。
 * 本工具匯出的 CSV 有「序號、度分秒、十進位」五欄，即走這條路。
 */
function coordsFromTable(body: string, order: CoordOrder): LngLat[] | null {
  const lines = body.split(/\r?\n/).map((l) => l.trim()).filter((l) => l && !l.startsWith("#"));
  if (lines.length === 0) return null;

  const head = lines[0] ?? "";
  const cols = head.split(/[,;\t]/).map((c) => c.trim().toLowerCase());
  const isLngCol = (c: string) => /^(lng|lon|long|longitude|x|經度|經)(_dec)?$/.test(c);
  const isLatCol = (c: string) => /^(lat|latitude|y|緯度|緯)(_dec)?$/.test(c);
  const isLngDms = (c: string) => /^(lng|lon|long|longitude|經度|經)_?dms$/.test(c);
  const isLatDms = (c: string) => /^(lat|latitude|緯度|緯)_?dms$/.test(c);
  const looksHeader = cols.some((c) => isLngCol(c) || isLatCol(c) || isLngDms(c) || isLatDms(c))
    && !parseLngLatLine(head, order);

  if (looksHeader) {
    let li = cols.findIndex(isLngCol), ai = cols.findIndex(isLatCol);
    if (li < 0 || ai < 0) { li = cols.findIndex(isLngDms); ai = cols.findIndex(isLatDms); }
    if (li < 0 || ai < 0) return null;
    const out: LngLat[] = [];
    for (const line of lines.slice(1)) {
      const cells = line.split(/[,;\t]/).map((c) => c.trim());
      const p = parseLngLatLine(`${cells[li] ?? ""}, ${cells[ai] ?? ""}`, "lnglat");
      if (!p) return null;
      out.push(p);
    }
    return out;
  }

  const out: LngLat[] = [];
  for (const line of lines) {
    const p = parseLngLatLine(line, order);
    if (!p) return null;
    out.push(p);
  }
  return out;
}
