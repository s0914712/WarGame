/**
 * 解析手動輸入的座標清單（尺規面板 · 多邊形）—— 以 60 進位（度分秒）為主，十進位也相容。
 *
 * 每行一點（也接受「；」或「|」分隔多點），一點 = 經度 + 緯度，順序不拘：
 *   120°30'15"E, 24°06'00"N      E120°30.5' N24°06'      東經120度30分 北緯24度6分
 *   120 30 15, 24 06 00          120-30-15 24-06-00     24°06'N 120°30'E（緯度在前）
 *   120.5042, 24.1               （十進位）
 * 判斷經緯：有 E/W/N/S（或東西南北）照字母；沒有就看大小（> 90 的是經度），否則視為「經度, 緯度」。
 * 分、秒必須 < 60；S / W 或前置負號為負值。
 */
export type LngLatPair = [number, number];

export interface ParsedCoords {
  pts: LngLatPair[];
  /** 第一個無法解讀的行號（1 起算）；全部成功為 null */
  badLine: number | null;
  badText: string;
}

interface Part { value: number; axis: "lng" | "lat" | null }

const HEMI: Record<string, { axis: "lng" | "lat"; sign: 1 | -1 }> = {
  E: { axis: "lng", sign: 1 }, W: { axis: "lng", sign: -1 },
  N: { axis: "lat", sign: 1 }, S: { axis: "lat", sign: -1 },
  東: { axis: "lng", sign: 1 }, 西: { axis: "lng", sign: -1 },
  北: { axis: "lat", sign: 1 }, 南: { axis: "lat", sign: -1 },
};

/** 一個座標分量：「120°30'15"E」「E120 30.5」「-120.5」→ 十進位值 + 軸（若有半球字母） */
function parsePart(raw: string): Part | null {
  let s = raw.trim().toUpperCase()
    .replace(/經|緯|度|分|秒/g, (m) => (m === "度" ? "°" : m === "分" ? "'" : m === "秒" ? '"' : " "));
  if (!s) return null;
  let hemi: { axis: "lng" | "lat"; sign: 1 | -1 } | null = null;
  s = s.replace(/[NSEW東西南北]/g, (m) => { hemi = HEMI[m] ?? hemi; return " "; });
  let sign = 1;
  if (/^\s*-/.test(s)) { sign = -1; s = s.replace(/^\s*-/, ""); }
  // 度分秒分隔：° ' " ′ ″ ： - 空白
  const nums = s.split(/[°º˚'’′"”″:：\-\s]+/).filter(Boolean);
  if (nums.length === 0 || nums.length > 3) return null;
  const v = nums.map(Number);
  if (v.some((n) => !Number.isFinite(n) || n < 0)) return null;
  const [d, m = 0, sec = 0] = v as [number, number?, number?];
  if (m >= 60 || sec >= 60) return null;
  if (nums.length > 1 && !Number.isInteger(d)) return null;          // 有分秒時度要是整數
  if (nums.length > 2 && !Number.isInteger(m)) return null;          // 有秒時分要是整數
  const h = hemi as { axis: "lng" | "lat"; sign: 1 | -1 } | null;
  return { value: (d + m / 60 + sec / 3600) * sign * (h?.sign ?? 1), axis: h?.axis ?? null };
}

/** 把一行切成經 / 緯兩段 */
function splitLine(line: string): [string, string] | null {
  // 1. 明確分隔：逗號 / 頓號 / 斜線 / Tab
  const bySep = line.split(/[,，、\/\t]+/).map((x) => x.trim()).filter(Boolean);
  if (bySep.length === 2) return [bySep[0]!, bySep[1]!];
  if (bySep.length > 2) return null;
  const s = line.trim();
  // 2. 半球字母：字母在後（120°30'E 24°06'N）或在前（E120 30 N24 06）
  const trailing = s.match(/^(.*?[NSEW東西南北])\s*(.+[NSEW東西南北])$/i);
  if (trailing && !/^[NSEW東西南北]/i.test(s)) return [trailing[1]!, trailing[2]!];
  const leading = s.match(/^([NSEW東西南北].*?)\s*([NSEW東西南北].*)$/i);
  if (leading) return [leading[1]!, leading[2]!];
  // 3. 度分秒符號：第二個「度」開始是第二個分量（120°30'15" 24°06'00"）
  const degs = [...s.matchAll(/[°º˚度]/g)];
  if (degs.length === 2) {
    const cut = s.slice(0, degs[1]!.index).search(/\S+\s*$/);
    if (cut > 0) return [s.slice(0, cut), s.slice(cut)];
  }
  // 4. 只有空白分隔的數字：偶數個就對半（d m | d m、d m s | d m s、十進位 a b）
  const tok = s.split(/[\s\-]+/).filter(Boolean);
  if (tok.length >= 2 && tok.length <= 6 && tok.length % 2 === 0) {
    const half = tok.length / 2;
    return [tok.slice(0, half).join(" "), tok.slice(half).join(" ")];
  }
  return null;
}

function parseLine(line: string): LngLatPair | null {
  const halves = splitLine(line);
  if (!halves) return null;
  const a = parsePart(halves[0]), b = parsePart(halves[1]);
  if (!a || !b) return null;
  let lng: number, lat: number;
  if (a.axis && b.axis) {
    if (a.axis === b.axis) return null;
    [lng, lat] = a.axis === "lng" ? [a.value, b.value] : [b.value, a.value];
  } else if (a.axis || b.axis) {
    const known = a.axis ? a : b, other = a.axis ? b : a;
    [lng, lat] = known.axis === "lng" ? [known.value, other.value] : [other.value, known.value];
  } else if (Math.abs(a.value) <= 90 && Math.abs(b.value) > 90) {
    [lng, lat] = [b.value, a.value];   // 緯度在前（數值判斷）
  } else {
    [lng, lat] = [a.value, b.value];
  }
  if (Math.abs(lng) > 180 || Math.abs(lat) > 90) return null;
  return [Math.round(lng * 1e6) / 1e6, Math.round(lat * 1e6) / 1e6];
}

export function parseCoordList(text: string): ParsedCoords {
  const pts: LngLatPair[] = [];
  const lines = text.split(/[\n;；|]+/);
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]!.trim();
    if (!raw) continue;
    const p = parseLine(raw);
    if (!p) return { pts, badLine: i + 1, badText: raw };
    pts.push(p);
  }
  return { pts, badLine: null, badText: "" };
}

/** 顯示用：十進位 → 120°30'15.0"E */
export function formatDms(value: number, axis: "lng" | "lat"): string {
  const hemi = axis === "lng" ? (value >= 0 ? "E" : "W") : (value >= 0 ? "N" : "S");
  let v = Math.abs(value);
  let d = Math.floor(v);
  v = (v - d) * 60;
  let m = Math.floor(v);
  let s = Math.round((v - m) * 60 * 10) / 10;
  if (s >= 60) { s = 0; m += 1; }
  if (m >= 60) { m = 0; d += 1; }
  return `${d}°${String(m).padStart(2, "0")}'${s.toFixed(1).padStart(4, "0")}"${hemi}`;
}
