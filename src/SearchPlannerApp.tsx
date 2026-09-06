/**
 * 獨立搜索規劃 app — `?mode=search`。
 *
 * 與兵推模式共用同一份 src/wargame/search/* 引擎與 SearchPlannerPanel，
 * 但不載入場景、不跑模擬引擎、不掛戰鬥圖層 —— 純粹的搜索規劃工具：
 * 左側參數面板、右側地圖，中英切換。
 *
 * 沒有 Mapbox token 時仍可完整使用：改以經緯度數字輸入框定義搜索區。
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import "./wargame/styles.css";
import { Languages, Map as MapIcon, ChevronUp, ChevronDown, Radar } from "lucide-react";
import { SearchPlannerPanel } from "./components/SearchPlannerPanel";
import { attachWargameSearchLayer } from "./map/wargameSearchLayer";
import { searchPlannerStore } from "./wargame/search/searchPlannerStore";
import { searchStrings } from "./wargame/search/i18n";
import { langStore, useLang } from "./wargame/i18n/lang";
import { DEFAULT_STYLE_ID, getStyleById } from "./wargame/mapStyles";
import { MapStyleSwitcher } from "./components/MapStyleSwitcher";
import { useIsMobile } from "./hooks/useIsMobile";

/** 台灣海峽預設視野 */
const DEFAULT_CAMERA = { center: [120.0, 23.6] as [number, number], zoom: 7 };

export default function SearchPlannerApp() {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const detachRef = useRef<(() => void) | null>(null);
  const [styleId, setStyleId] = useState(DEFAULT_STYLE_ID);
  const [mapReady, setMapReady] = useState(false);
  const [mapFailed, setMapFailed] = useState(false);
  const langRaw = useLang();
  const lang: "zh" | "en" = langRaw === "en" ? "en" : "zh";
  const t = searchStrings(lang);
  const { isMobile } = useIsMobile();
  /** 手機版：面板做成底部抽屜，可收合把畫面讓給地圖 */
  const [sheetOpen, setSheetOpen] = useState(true);

  useSyncExternalStore(searchPlannerStore.subscribe, searchPlannerStore.getVersion, searchPlannerStore.getVersion);
  const picking = searchPlannerStore.isPicking();

  useEffect(() => {
    document.title = `${t.title} · ${t.subtitle}`;
  }, [t]);

  // standalone 模式面板恆開（沒有兵推的收合入口）
  useEffect(() => { searchPlannerStore.setOpen(true); }, []);

  // 手機版開始框選 → 收起抽屜，整個畫面讓給地圖
  useEffect(() => { if (isMobile && picking) setSheetOpen(false); }, [isMobile, picking]);

  // 地圖容器尺寸隨抽屜開合改變 → 通知 mapbox 重算
  useEffect(() => {
    const m = mapRef.current;
    if (!m) return;
    const id = setTimeout(() => m.resize(), 320);
    return () => clearTimeout(id);
  }, [sheetOpen, isMobile]);

  useEffect(() => {
    if (!mapContainerRef.current) return;
    const token = import.meta.env.VITE_MAPBOX_TOKEN;
    if (!token) { setMapFailed(true); return; }
    mapboxgl.accessToken = token;

    let map: mapboxgl.Map;
    try {
      map = new mapboxgl.Map({
        container: mapContainerRef.current,
        style: getStyleById(DEFAULT_STYLE_ID).url,
        center: DEFAULT_CAMERA.center,
        zoom: DEFAULT_CAMERA.zoom,
      });
    } catch {
      setMapFailed(true);
      return;
    }
    mapRef.current = map;
    map.on("error", (e) => { if (e?.error) setMapFailed(true); });

    map.on("load", () => {
      detachRef.current = attachWargameSearchLayer(map);
      map.on("click", (e) => {
        if (searchPlannerStore.isPicking()) {
          searchPlannerStore.setCorner(e.lngLat.lng, e.lngLat.lat);
        }
      });
      const cursor = () => {
        map.getCanvas().style.cursor = searchPlannerStore.isPicking() ? "crosshair" : "";
      };
      searchPlannerStore.subscribe(cursor);
      setMapReady(true);
    });

    return () => {
      detachRef.current?.();
      detachRef.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // 底圖切換
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    detachRef.current?.();
    detachRef.current = null;
    map.setStyle(getStyleById(styleId).url);
    map.once("style.load", () => { detachRef.current = attachWargameSearchLayer(map); });
  }, [styleId, mapReady]);

  const langButton = (
    <button
      className="wg-btn"
      onClick={() => langStore.toggle()}
      title={lang === "zh" ? "Switch to English" : "切換為中文"}
      style={{
        position: "absolute", top: 12, right: 12, zIndex: 30,
        display: "flex", alignItems: "center", gap: 6,
        padding: "7px 12px", borderRadius: 6, cursor: "pointer",
        background: "rgba(15,23,42,0.92)", color: "#e2e8f0",
        border: "1px solid rgba(148,163,184,0.35)",
        fontFamily: "ui-sans-serif, system-ui, sans-serif", fontSize: 15, fontWeight: 600,
      }}
    >
      <Languages size={15} /> {lang === "zh" ? "EN" : "中文"}
    </button>
  );

  const pickHintEl = picking && !mapFailed && (
    <div style={pickHint}>
      {searchPlannerStore.getCorners().a ? t.pickSecondCorner : t.pickFirstCorner}
    </div>
  );

  // ── 手機版：地圖滿版 + 底部抽屜 ──────────────────────────
  if (isMobile) {
    const sheetH = "min(62vh, 560px)";
    return (
      <div style={{ position: "relative", width: "100vw", height: "100dvh", background: "#020617", overflow: "hidden" }}>
        <div ref={mapContainerRef} style={{ position: "absolute", inset: 0 }} />
        {mapFailed && <NoMapFallback lang={lang} compact />}
        {pickHintEl}
        {langButton}

        {/* 底部抽屜 */}
        <div style={{
          position: "fixed", left: 0, right: 0, bottom: 0, zIndex: 40,
          display: "flex", flexDirection: "column",
          height: sheetOpen ? sheetH : "auto",
          maxHeight: sheetH,
          background: "rgba(2, 6, 23, 0.96)",
          backdropFilter: "blur(16px)", WebkitBackdropFilter: "blur(16px)",
          borderTop: "1px solid rgba(250, 204, 21, 0.35)",
          borderRadius: sheetOpen ? "16px 16px 0 0" : "16px 16px 0 0",
          paddingBottom: "env(safe-area-inset-bottom, 0px)",
          transition: "height 0.28s cubic-bezier(0.4, 0, 0.2, 1)",
        }}>
          <button
            onClick={() => setSheetOpen((v) => !v)}
            className="wg-btn"
            style={{
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
              padding: "10px 14px", cursor: "pointer", flexShrink: 0,
              background: "transparent", border: "none",
              color: "#fef9c3", fontSize: 17, fontWeight: 700,
              fontFamily: "ui-sans-serif, system-ui, sans-serif",
            }}
          >
            <Radar size={16} /> {t.title}
            {sheetOpen ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
          </button>
          {sheetOpen && (
            <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden", padding: "0 12px 12px", zoom: 0.9 }}>
              <SearchPlannerPanel embedded />
            </div>
          )}
        </div>
      </div>
    );
  }

  // ── 桌面版：左面板 + 右地圖 ─────────────────────────────
  return (
    <div style={{ display: "flex", width: "100vw", height: "100vh", background: "#020617" }}>
      <div style={{ width: 470, flexShrink: 0, height: "100%" }}>
        <SearchPlannerPanel standalone />
      </div>
      <div style={{ flex: 1, position: "relative", minWidth: 0 }}>
        <div ref={mapContainerRef} style={{ position: "absolute", inset: 0 }} />
        {mapFailed && <NoMapFallback lang={lang} />}
        {pickHintEl}
        {langButton}
        {!mapFailed && <MapStyleSwitcher selectedId={styleId} onChange={setStyleId} />}
      </div>
    </div>
  );
}

/**
 * 無 Mapbox token 時的替代輸入 —— 直接打經緯度定義搜索區，
 * 讓規劃器在沒有底圖的環境（離線 / 未設 token）仍完全可用。
 */
/**
 * @param compact 手機版：靠上排版並縮小，避免被底部抽屜蓋住而點不到
 */
function NoMapFallback({ lang, compact = false }: { lang: "zh" | "en"; compact?: boolean }) {
  const { a, b } = searchPlannerStore.getCorners();
  const [aLng, setALng] = useState(a?.[0] ?? 119.3);
  const [aLat, setALat] = useState(a?.[1] ?? 23.2);
  const [bLng, setBLng] = useState(b?.[0] ?? 120.3);
  const [bLat, setBLat] = useState(b?.[1] ?? 24.0);

  const apply = () => {
    searchPlannerStore.startPickArea();
    searchPlannerStore.setCorner(aLng, aLat);
    searchPlannerStore.setCorner(bLng, bLat);
  };

  const txt = lang === "en" ? {
    title: "Map unavailable",
    body: "No Mapbox token is configured (VITE_MAPBOX_TOKEN), so the basemap cannot load. The planner still works — enter the search area corners directly.",
    cornerA: "Corner A (lng, lat)", cornerB: "Corner B (lng, lat)", apply: "Set search area",
  } : {
    title: "地圖無法載入",
    body: "未設定 Mapbox token（VITE_MAPBOX_TOKEN），底圖無法顯示。規劃器仍可完整使用 —— 直接輸入搜索區兩個對角的經緯度即可。",
    cornerA: "角 A（經度, 緯度）", cornerB: "角 B（經度, 緯度）", apply: "設定搜索區",
  };

  const inp: React.CSSProperties = {
    width: 96, padding: "5px 7px", fontSize: 15, borderRadius: 4,
    background: "rgba(30,41,59,0.9)", color: "#e2e8f0",
    border: "1px solid rgba(148,163,184,0.3)", fontFamily: "ui-monospace, monospace",
  };

  return (
    <div style={{
      position: "absolute", inset: 0, display: "flex",
      alignItems: compact ? "flex-start" : "center",
      justifyContent: "center",
      padding: compact ? "56px 12px 0" : 32,
      pointerEvents: "none",
      fontFamily: "ui-sans-serif, system-ui, sans-serif",
    }}>
      <div style={{
        maxWidth: 440, padding: compact ? 12 : 20, borderRadius: 8,
        pointerEvents: "auto",
        background: "rgba(15,23,42,0.95)", border: "1px solid rgba(148,163,184,0.25)",
      }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, color: "#fed7aa", fontWeight: 700, fontSize: 18 }}>
          <MapIcon size={18} /> {txt.title}
        </div>
        {!compact && (
          <p style={{ color: "#cbd5e1", fontSize: 15, lineHeight: 1.6, marginTop: 8 }}>{txt.body}</p>
        )}
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: compact ? 8 : 12 }}>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, color: "#94a3b8" }}>
            <span style={{ width: compact ? 74 : 140 }}>{txt.cornerA}</span>
            <input style={inp} type="number" step={0.01} value={aLng} onChange={(e) => setALng(Number(e.target.value))} />
            <input style={inp} type="number" step={0.01} value={aLat} onChange={(e) => setALat(Number(e.target.value))} />
          </label>
          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 14, color: "#94a3b8" }}>
            <span style={{ width: compact ? 74 : 140 }}>{txt.cornerB}</span>
            <input style={inp} type="number" step={0.01} value={bLng} onChange={(e) => setBLng(Number(e.target.value))} />
            <input style={inp} type="number" step={0.01} value={bLat} onChange={(e) => setBLat(Number(e.target.value))} />
          </label>
          <button className="wg-btn" onClick={apply} style={{
            marginTop: 4, padding: "8px 12px", fontSize: 16, fontWeight: 600, borderRadius: 5,
            background: "rgba(250,204,21,0.2)", color: "#fef9c3", cursor: "pointer",
            border: "1px solid rgba(250,204,21,0.5)", fontFamily: "inherit",
          }}>{txt.apply}</button>
        </div>
      </div>
    </div>
  );
}

const pickHint: React.CSSProperties = {
  position: "absolute", top: 12, left: "50%", transform: "translateX(-50%)", zIndex: 30,
  padding: "8px 14px", borderRadius: 8,
  background: "rgba(15,23,42,0.95)", border: "1px solid rgba(250,204,21,0.5)",
  color: "#fef9c3", fontSize: 16, fontWeight: 600,
  fontFamily: "ui-sans-serif, system-ui, sans-serif",
};
