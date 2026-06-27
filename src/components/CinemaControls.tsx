/**
 * 紀錄片模式控制 — 借鏡 battle-of-hong-kong-1941 的 director HUD。
 *
 * 兩塊：
 *   1. 右下角開關鈕（只在目前場景有 storyboard 時出現，例如 823 砲戰）
 *   2. 啟用後畫面下方的 lower-third 雙語字幕（日期 / 標題 / 旁白 / 雙方殘存）
 *
 * 純 opt-in：不啟用就跟沒這功能一樣，不影響即時兵棋玩法。
 */
import { useSyncExternalStore } from "react";
import type { Map as MapboxMap } from "mapbox-gl";
import { Clapperboard, Languages, Crosshair, X } from "lucide-react";
import { cinemaDirector, type CinemaCaption } from "../wargame/cinema/director";
import { scenarioStore } from "../wargame/scenarioStore";

interface CinemaSnapshot {
  active: boolean;
  hasStoryboard: boolean;
  caption: CinemaCaption | null;
}

let cached: CinemaSnapshot = build();

function build(): CinemaSnapshot {
  return {
    active: cinemaDirector.isActive(),
    hasStoryboard: cinemaDirector.hasStoryboardForCurrentScenario(),
    caption: cinemaDirector.getCaption(),
  };
}

function getSnapshot(): CinemaSnapshot {
  const next = build();
  // 任一欄位變了才換參考（caption 是 director 內部 cache，內容沒變即同參考）
  if (
    next.active !== cached.active ||
    next.hasStoryboard !== cached.hasStoryboard ||
    next.caption !== cached.caption
  ) {
    cached = next;
  }
  return cached;
}

function subscribe(cb: () => void): () => void {
  // director 變動 + scenarioStore 換場景都要重算（hasStoryboard 會變）
  const unsubA = cinemaDirector.subscribe(cb);
  const unsubB = scenarioStore.subscribe(cb);
  return () => { unsubA(); unsubB(); };
}

export function CinemaControls({ map }: { map: MapboxMap | null }) {
  const snap = useSyncExternalStore(subscribe, getSnapshot);

  if (!snap.active && !snap.hasStoryboard) return null;

  return (
    <>
      {/* 開關鈕：在 LLM 鈕上方 */}
      <button
        onClick={() => (snap.active ? cinemaDirector.stop() : cinemaDirector.start(map))}
        className="wg-btn"
        title={snap.active ? "退出紀錄片模式" : "紀錄片模式（自走運鏡 + 旁白）"}
        style={{
          position: "absolute", bottom: 120, right: 16, zIndex: 25,
          padding: "10px 16px",
          background: snap.active ? "rgba(217, 119, 87, 0.95)" : "rgba(15, 23, 42, 0.85)",
          color: snap.active ? "#fff" : "#cbd5e1",
          border: "1px solid rgba(148, 163, 184, 0.4)", borderRadius: 8,
          fontSize: 15, fontWeight: 600, cursor: "pointer",
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
          boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
          display: "flex", alignItems: "center", gap: 6,
        }}
      >
        <Clapperboard size={16} /> {snap.active ? "退出紀錄片" : "紀錄片"}
      </button>

      {snap.active && snap.caption && (
        <CaptionHUD caption={snap.caption} />
      )}
    </>
  );
}

function CaptionHUD({ caption }: { caption: CinemaCaption }) {
  const { lang } = caption;
  const showZh = lang === "both" || lang === "zh";
  const showEn = lang === "both" || lang === "en";
  const langBtnLabel = lang === "both" ? "中／EN" : lang === "zh" ? "中文" : "EN";

  return (
    <div
      style={{
        position: "absolute", left: "50%", bottom: 110,
        transform: "translateX(-50%)",
        width: "min(880px, 92vw)", zIndex: 24,
        background: "linear-gradient(to top, rgba(2,6,23,0.92), rgba(2,6,23,0.72))",
        borderLeft: "3px solid #d97757",
        borderRadius: 8,
        padding: "14px 20px",
        color: "#e2e8f0",
        fontFamily: "ui-sans-serif, system-ui, sans-serif",
        boxShadow: "0 8px 24px rgba(0,0,0,0.45)",
        pointerEvents: "auto",
      }}
    >
      {/* 頂行：日期 + 雙方殘存 + 控制 */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 6 }}>
        <span style={{ fontSize: 13, letterSpacing: 1, color: "#d97757", fontWeight: 700 }}>
          {caption.dateLabel}
        </span>
        <span style={{ flex: 1 }} />
        <StrengthBadge label="守軍" color="#3B82F6" value={caption.blueAlive} />
        <StrengthBadge label="共軍" color="#EF4444" value={caption.redAlive} />
        <button onClick={() => cinemaDirector.cycleLang()} title="字幕語言"
          style={iconMini}><Languages size={14} /> <span style={{ fontSize: 12 }}>{langBtnLabel}</span></button>
        <button onClick={() => cinemaDirector.recenter()} title="重新框住分鏡鏡頭"
          style={iconMini}><Crosshair size={14} /></button>
        <button onClick={() => cinemaDirector.stop()} title="退出紀錄片模式"
          style={iconMini}><X size={14} /></button>
      </div>

      {/* 標題 */}
      <div style={{ display: "flex", alignItems: "baseline", gap: 10, marginBottom: 4 }}>
        {showZh && <span style={{ fontSize: 24, fontWeight: 800 }}>{caption.titleZh}</span>}
        {showEn && <span style={{ fontSize: 15, color: "#94a3b8", fontWeight: 600 }}>{caption.titleEn}</span>}
      </div>

      {/* 旁白 */}
      {showZh && <p style={{ margin: "2px 0", fontSize: 15, lineHeight: 1.6 }}>{caption.narrZh}</p>}
      {showEn && <p style={{ margin: "2px 0", fontSize: 13, lineHeight: 1.55, color: "#cbd5e1" }}>{caption.narrEn}</p>}
    </div>
  );
}

function StrengthBadge({ label, color, value }: { label: string; color: string; value: number }) {
  return (
    <span style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      fontSize: 12, color: "#cbd5e1",
    }}>
      <span style={{ width: 8, height: 8, borderRadius: "50%", background: color, display: "inline-block" }} />
      {label} <b style={{ color: "#fff" }}>{value}</b>
    </span>
  );
}

const iconMini: React.CSSProperties = {
  display: "inline-flex", alignItems: "center", gap: 4,
  background: "rgba(148,163,184,0.12)",
  color: "#cbd5e1",
  border: "1px solid rgba(148,163,184,0.25)",
  borderRadius: 6, padding: "4px 8px", cursor: "pointer",
  fontFamily: "ui-sans-serif, system-ui, sans-serif",
};
