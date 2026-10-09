/**
 * 灰色地帶情資圖層 —— taiwan-grayzone-monitor 的 24h 航跡 / 高風險船 / SAR 暗船 / 海纜障礙，
 * 疊在兵推地圖底層（六角格之上、單位之下）。資料與開關見 grayzoneStore。
 *
 * 點擊圖徵 → popup（單位符號優先：點到單位時不跳 popup，交給 WargameApp 選取）。
 */
import mapboxgl from "mapbox-gl";
import type { Map as MapboxMap, MapMouseEvent } from "mapbox-gl";
import {
  grayzoneStore, type GrayzoneFeed, type GrayzoneLayerKey, type TrackPoint,
} from "../wargame/grayzone/grayzoneStore";
import { SYMBOL_LAYER_ID } from "./wargameSymbolLayer";
import { editorStore } from "../wargame/editor/editorStore";
import { hexStore } from "../wargame/hex/hexStore";
import { searchPlannerStore } from "../wargame/search/searchPlannerStore";
import { rulerStore } from "./rulerTool";

const SRC = {
  cables: "wg-gz-cables-src",
  tracks: "wg-gz-tracks-src",
  heads: "wg-gz-heads-src",
  highRisk: "wg-gz-highrisk-src",
  dark: "wg-gz-dark-src",
} as const;

/** 子圖層 key → 該組的 Mapbox layer id（由下往上加） */
const GROUPS: Record<GrayzoneLayerKey, string[]> = {
  cables: ["wg-gz-cables", "wg-gz-cables-fault"],
  dark: ["wg-gz-dark"],
  tracks: ["wg-gz-tracks", "wg-gz-heads"],
  highRisk: ["wg-gz-highrisk-halo", "wg-gz-highrisk"],
};
const ADD_ORDER: GrayzoneLayerKey[] = ["cables", "dark", "tracks", "highRisk"];
const CLICKABLE = ["wg-gz-highrisk", "wg-gz-heads", "wg-gz-dark", "wg-gz-cables-fault", "wg-gz-cables"];

const EMPTY: GeoJSON.FeatureCollection = { type: "FeatureCollection", features: [] };

/** 船種 → 航跡顏色（gov 類別來自 grayzone 的公務船判定） */
const TYPE_COLOR: unknown[] = [
  "match", ["get", "type"],
  "fishing", "#22d3ee",
  "cargo", "#a3e635",
  "tanker", "#fbbf24",
  ["coastguard", "coast_guard", "msa", "research", "navy", "gov"], "#f472b6",
  "#94a3b8",
];

interface Built {
  cables: GeoJSON.FeatureCollection;
  tracks: GeoJSON.FeatureCollection;
  heads: GeoJSON.FeatureCollection;
  highRisk: GeoJSON.FeatureCollection;
  dark: GeoJSON.FeatureCollection;
}

/** 相鄰兩點換算航速超過此值 → 視為 AIS 跳點（偽造 / 斷訊），斷線不連 */
const MAX_PLAUSIBLE_KN = 60;

/** 航跡依跳點切段；單點段丟掉（最後位置另由 heads 圖層畫） */
function splitJumps(pts: TrackPoint[]): [number, number][][] {
  const segs: [number, number][][] = [];
  let cur: [number, number][] = [];
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    const prev = pts[i - 1];
    if (prev) {
      const dLat = (p[1] - prev[1]) * 60;
      const dLon = (p[0] - prev[0]) * 60 * Math.cos(((p[1] + prev[1]) / 2) * Math.PI / 180);
      const nm = Math.hypot(dLat, dLon);
      const hours = Math.max((p[2] - prev[2]) / 3600, 1 / 60);
      if (nm / hours > MAX_PLAUSIBLE_KN) {
        if (cur.length >= 2) segs.push(cur);
        cur = [];
      }
    }
    cur.push([p[0], p[1]]);
  }
  if (cur.length >= 2) segs.push(cur);
  return segs;
}

let builtFor: GrayzoneFeed | null = null;
let built: Built | null = null;

function build(feed: GrayzoneFeed | null): Built {
  if (!feed) return { cables: EMPTY, tracks: EMPTY, heads: EMPTY, highRisk: EMPTY, dark: EMPTY };
  if (builtFor === feed && built) return built;
  const tracks: GeoJSON.Feature[] = [];
  const heads: GeoJSON.Feature[] = [];
  for (const v of feed.tracks.vessels) {
    const props = { mmsi: v.mmsi, name: v.name, type: v.type, risk: v.risk ?? "" };
    const segs = splitJumps(v.pts);
    if (segs.length) {
      tracks.push({ type: "Feature", properties: props, geometry: { type: "MultiLineString", coordinates: segs } });
    }
    const last = v.pts[v.pts.length - 1];
    if (last) {
      heads.push({
        type: "Feature",
        properties: { ...props, t: last[2], speed: last[3] ?? -1, n: v.pts.length },
        geometry: { type: "Point", coordinates: [last[0], last[1]] },
      });
    }
  }
  built = {
    cables: feed.cables.geojson as GeoJSON.FeatureCollection,
    tracks: { type: "FeatureCollection", features: tracks },
    heads: { type: "FeatureCollection", features: heads },
    highRisk: {
      type: "FeatureCollection",
      features: feed.high_risk.vessels.map((v) => ({
        type: "Feature" as const,
        properties: {
          mmsi: v.mmsi, name: v.name, risk_level: v.risk_level, risk_score: v.risk_score ?? 0,
          vessel_type: v.vessel_type ?? "", last_seen: v.last_seen ?? "",
          flags: JSON.stringify(v.flags), cables: v.cables_nearby.join(", "), sanctioned: v.sanctioned,
        },
        geometry: { type: "Point" as const, coordinates: [v.lon, v.lat] },
      })),
    },
    dark: {
      type: "FeatureCollection",
      features: feed.dark.points.map(([lon, lat, date, n]) => ({
        type: "Feature" as const,
        properties: { date, n },
        geometry: { type: "Point" as const, coordinates: [lon, lat] },
      })),
    },
  };
  builtFor = feed;
  return built;
}

function addLayers(map: MapboxMap): void {
  const vis = (k: GrayzoneLayerKey) => (grayzoneStore.isOn(k) ? "visible" : "none");
  for (const k of ADD_ORDER) {
    if (k === "cables") {
      map.addLayer({
        id: "wg-gz-cables", type: "line", source: SRC.cables, filter: ["!", ["get", "fault"]],
        layout: { visibility: vis(k), "line-cap": "round", "line-join": "round" },
        paint: { "line-color": "#38bdf8", "line-width": 1.4, "line-opacity": 0.55 },
      });
      map.addLayer({
        id: "wg-gz-cables-fault", type: "line", source: SRC.cables, filter: ["get", "fault"],
        layout: { visibility: vis(k), "line-join": "round" },
        paint: { "line-color": "#ef4444", "line-width": 2.6, "line-opacity": 0.9, "line-dasharray": [2, 1.5] },
      });
    } else if (k === "dark") {
      map.addLayer({
        id: "wg-gz-dark", type: "circle", source: SRC.dark,
        layout: { visibility: vis(k) },
        paint: {
          "circle-color": "#a855f7",
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, ["min", ["+", 2, ["get", "n"]], 6], 9, ["min", ["+", 4, ["*", 2, ["get", "n"]]], 12]],
          "circle-opacity": 0.55,
          "circle-stroke-color": "#e9d5ff", "circle-stroke-width": 0.6, "circle-stroke-opacity": 0.7,
        },
      });
    } else if (k === "tracks") {
      map.addLayer({
        id: "wg-gz-tracks", type: "line", source: SRC.tracks,
        layout: { visibility: vis(k), "line-cap": "round", "line-join": "round" },
        paint: {
          "line-color": ["case", ["==", ["get", "risk"], "critical"], "#ef4444",
            ["==", ["get", "risk"], "high"], "#f97316", TYPE_COLOR] as unknown as string,
          "line-width": ["case", ["!=", ["get", "risk"], ""], 2, 1] as unknown as number,
          "line-opacity": 0.5,
        },
      });
      map.addLayer({
        id: "wg-gz-heads", type: "circle", source: SRC.heads,
        layout: { visibility: vis(k) },
        paint: {
          "circle-color": TYPE_COLOR as unknown as string,
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, 1.5, 9, 3.5],
          "circle-opacity": 0.85,
        },
      });
    } else {
      map.addLayer({
        id: "wg-gz-highrisk-halo", type: "circle", source: SRC.highRisk,
        layout: { visibility: vis(k) },
        paint: {
          "circle-color": ["match", ["get", "risk_level"], "critical", "#ef4444", "#f97316"] as unknown as string,
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, 8, 9, 14],
          "circle-opacity": 0.18, "circle-blur": 0.4,
        },
      });
      map.addLayer({
        id: "wg-gz-highrisk", type: "circle", source: SRC.highRisk,
        layout: { visibility: vis(k) },
        paint: {
          "circle-color": ["match", ["get", "risk_level"], "critical", "#ef4444", "#f97316"] as unknown as string,
          "circle-radius": ["interpolate", ["linear"], ["zoom"], 5, 3.5, 9, 6],
          "circle-stroke-color": "#fff", "circle-stroke-width": 1.2,
        },
      });
    }
  }
}

function esc(s: unknown): string {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]!));
}

function fmtTime(iso: string | number): string {
  const d = typeof iso === "number" ? new Date(iso * 1000) : new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleString("zh-TW", { timeZone: "Asia/Taipei", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
}

function popupHtml(layerId: string, p: Record<string, unknown>): string {
  const row = (k: string, v: string) => `<div><span style="color:#64748b">${k}</span> ${v}</div>`;
  if (layerId === "wg-gz-highrisk") {
    let flags: string[] = [];
    try { flags = JSON.parse(String(p.flags ?? "[]")) as string[]; } catch { /* ignore */ }
    const lvl = p.risk_level === "critical" ? "極高風險" : "高風險";
    return `<b>${esc(p.name) || "（無船名）"}</b> <span style="color:${p.risk_level === "critical" ? "#ef4444" : "#f97316"}">${lvl} · ${esc(p.risk_score)} 分</span>`
      + row("MMSI", esc(p.mmsi)) + row("船種", esc(p.vessel_type))
      + row("最後位置", fmtTime(String(p.last_seen)))
      + (p.cables ? row("鄰近海纜", esc(p.cables)) : "")
      + (p.sanctioned === true || p.sanctioned === "true" ? row("制裁", '<span style="color:#ef4444">名單命中</span>') : "")
      + (flags.length ? `<ul style="margin:4px 0 0 16px;padding:0">${flags.map((f) => `<li>${esc(f)}</li>`).join("")}</ul>` : "");
  }
  if (layerId === "wg-gz-heads") {
    const spd = Number(p.speed);
    return `<b>${esc(p.name) || "（無船名）"}</b>`
      + row("MMSI", esc(p.mmsi)) + row("船種", esc(p.type))
      + row("最後訊號", fmtTime(Number(p.t)))
      + row("航速", spd >= 0 ? `${spd} kn` : "—")
      + row("24h 點數", esc(p.n));
  }
  if (layerId === "wg-gz-dark") {
    return `<b>SAR 暗船偵測</b>` + row("日期", esc(p.date)) + row("偵測次數", esc(p.n))
      + `<div style="color:#64748b;margin-top:4px">衛星雷達看得到、AIS 沒有對應訊號的船</div>`;
  }
  let faults: { segment?: string; fault_date?: string; estimated_repair?: string; location_zh?: string }[] = [];
  try { faults = JSON.parse(String(p.faults ?? "[]")); } catch { /* ignore */ }
  return `<b>${esc(p.name)}</b>` + (p.cable_type ? row("類型", esc(p.cable_type)) : "")
    + (faults.length
      ? faults.map((f) => `<div style="margin-top:4px;color:#b91c1c">障礙 ${esc(f.segment)}：${esc(f.fault_date)} 起`
        + (f.estimated_repair ? `，預計 ${esc(f.estimated_repair)} 修復` : "")
        + (f.location_zh ? `<br/><span style="color:#64748b">${esc(f.location_zh)}</span>` : "") + `</div>`).join("")
      : row("狀態", "正常"));
}

function interactive(): boolean {
  return editorStore.getMode() === "view" && !rulerStore.isActive() && !hexStore.getBrush()
    && !searchPlannerStore.isMapClickMode();
}

export function attachWargameGrayzoneLayer(map: MapboxMap): () => void {
  removeAll(map);
  const data = build(grayzoneStore.getFeed());
  for (const [k, id] of Object.entries(SRC) as [keyof Built, string][]) {
    map.addSource(id, { type: "geojson", data: data[k] });
  }
  addLayers(map);

  let shownFor: GrayzoneFeed | null = grayzoneStore.getFeed();
  const sync = () => {
    const feed = grayzoneStore.getFeed();
    if (feed !== shownFor) {
      shownFor = feed;
      const d = build(feed);
      for (const [k, id] of Object.entries(SRC) as [keyof Built, string][]) {
        (map.getSource(id) as mapboxgl.GeoJSONSource | undefined)?.setData(d[k]);
      }
    }
    for (const k of ADD_ORDER) {
      const v = grayzoneStore.isOn(k) ? "visible" : "none";
      for (const id of GROUPS[k]) if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", v);
    }
  };
  const unsub = grayzoneStore.subscribe(sync);
  grayzoneStore.ensureLoaded();

  const popup = new mapboxgl.Popup({ closeButton: true, maxWidth: "300px", className: "wg-gz-popup" });
  const onClick = (e: MapMouseEvent) => {
    if (!interactive()) return;
    if (map.getLayer(SYMBOL_LAYER_ID) && map.queryRenderedFeatures(e.point, { layers: [SYMBOL_LAYER_ID] }).length) return;
    const layers = CLICKABLE.filter((id) => map.getLayer(id) && map.getLayoutProperty(id, "visibility") !== "none");
    if (!layers.length) return;
    const pad = 4;
    const f = map.queryRenderedFeatures(
      [[e.point.x - pad, e.point.y - pad], [e.point.x + pad, e.point.y + pad]], { layers },
    )[0];
    if (!f) return;
    const props = { ...(f.properties ?? {}) } as Record<string, unknown>;
    popup.setLngLat(e.lngLat)
      .setHTML(`<div style="font-size:12px;line-height:1.5;color:#0f172a">${popupHtml(f.layer!.id, props)}</div>`)
      .addTo(map);
  };
  map.on("click", onClick);

  return () => {
    unsub();
    map.off("click", onClick);
    popup.remove();
    removeAll(map);
  };
}

function removeAll(map: MapboxMap): void {
  for (const id of Object.values(GROUPS).flat()) if (map.getLayer(id)) map.removeLayer(id);
  for (const id of Object.values(SRC)) if (map.getSource(id)) map.removeSource(id);
}
