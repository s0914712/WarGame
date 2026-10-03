/**
 * 尺規工具控制列 — 開關、單位（海里 / 公里）、總距離、復原 / 清除。
 * 量測互動本身在 map/rulerTool.ts；此元件只訂閱 rulerStore。
 */
import { useSyncExternalStore } from "react";
import { Ruler, Undo2, Trash2, Check, X } from "lucide-react";
import { formatBearing, formatDistance, rulerStore, type RulerUnit } from "../map/rulerTool";

const TEXT = {
  zh: {
    ruler: "尺規", nm: "海里", km: "公里", total: "總長", segments: "段", bearing: "最後方位",
    undo: "復原", clear: "清除", done: "結束", close: "關閉尺規",
    hint: "點地圖加點 · 雙擊結束 · 右鍵刪最後一點 · Esc 結束",
    hintDone: "已結束 —— 再點地圖開始新的量測",
  },
  en: {
    ruler: "Ruler", nm: "NM", km: "km", total: "Total", segments: "seg", bearing: "Last bearing",
    undo: "Undo", clear: "Clear", done: "Done", close: "Close ruler",
    hint: "Click to add points · double-click to finish · right-click removes last · Esc to finish",
    hintDone: "Finished — click the map to start a new measurement",
  },
} as const;

/**
 * @param hideLauncher 開關入口放在別處（兵推頂部列）：未啟用且無量測時不渲染
 */
export function RulerControl({ lang = "zh", style, hideLauncher = false }: {
  lang?: "zh" | "en"; style?: React.CSSProperties; hideLauncher?: boolean;
}) {
  useSyncExternalStore(rulerStore.subscribe, rulerStore.getVersion, rulerStore.getVersion);
  const t = TEXT[lang];
  const active = rulerStore.isActive();
  const unit = rulerStore.getUnit();
  const sum = rulerStore.getSummary();
  const hasPoints = rulerStore.getPoints().length > 0;

  const box: React.CSSProperties = {
    position: "absolute", zIndex: 25,
    background: "rgba(15,23,42,0.94)", backdropFilter: "blur(6px)",
    border: `1px solid ${active ? "rgba(244,114,182,0.6)" : "rgba(148,163,184,0.3)"}`,
    borderRadius: 8, color: "#e2e8f0",
    fontFamily: "ui-sans-serif, system-ui, sans-serif",
    boxShadow: "0 6px 20px rgba(0,0,0,0.4)",
    ...style,
  };

  if (!active) {
    if (hideLauncher) return null;
    return (
      <button className="wg-btn" onClick={() => rulerStore.setActive(true)} title={t.ruler}
        style={{ ...box, display: "flex", alignItems: "center", gap: 6, padding: "7px 11px", cursor: "pointer", fontSize: 15, fontWeight: 600 }}>
        <Ruler size={15} color="#f472b6" /> {t.ruler}
        {hasPoints && (
          <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 13, color: "#fbcfe8" }}>
            {formatDistance(sum.totalKm, unit)}
          </span>
        )}
      </button>
    );
  }

  const unitBtn = (u: RulerUnit, label: string) => (
    <button className="wg-btn" onClick={() => rulerStore.setUnit(u)} style={{
      flex: 1, padding: "4px 8px", fontSize: 14, cursor: "pointer", fontFamily: "inherit",
      borderRadius: 4, fontWeight: unit === u ? 700 : 400,
      border: `1px solid ${unit === u ? "#f472b6" : "rgba(148,163,184,0.3)"}`,
      background: unit === u ? "rgba(244,114,182,0.2)" : "rgba(30,41,59,0.6)",
      color: unit === u ? "#fce7f3" : "#cbd5e1",
    }}>{label}</button>
  );
  const iconBtn: React.CSSProperties = {
    display: "flex", alignItems: "center", gap: 4, padding: "4px 8px", fontSize: 13,
    borderRadius: 4, cursor: "pointer", fontFamily: "inherit",
    background: "rgba(30,41,59,0.8)", color: "#cbd5e1", border: "1px solid rgba(148,163,184,0.3)",
  };

  return (
    <div style={{ ...box, width: 250, padding: "9px 11px", display: "flex", flexDirection: "column", gap: 7 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <Ruler size={15} color="#f472b6" />
        <span style={{ fontWeight: 700, fontSize: 15 }}>{t.ruler}</span>
        <span style={{ flex: 1 }} />
        <button className="wg-btn" onClick={() => rulerStore.setActive(false)} title={t.close}
          style={{ ...iconBtn, padding: "3px 5px" }}><X size={13} /></button>
      </div>
      <div style={{ display: "flex", gap: 6 }}>
        {unitBtn("nm", t.nm)}
        {unitBtn("km", t.km)}
      </div>
      <div style={{ fontFamily: "ui-monospace, monospace", lineHeight: 1.5 }}>
        <div style={{ fontSize: 20, fontWeight: 700, color: "#fce7f3" }}>
          {t.total} {formatDistance(sum.totalKm, unit)}
        </div>
        <div style={{ fontSize: 13, color: "#94a3b8" }}>
          {sum.segments} {t.segments}
          {sum.lastBearing !== null && <> · {t.bearing} {formatBearing(sum.lastBearing)}</>}
          {" · "}{formatDistance(sum.totalKm, unit === "nm" ? "km" : "nm")}
        </div>
      </div>
      <div style={{ display: "flex", gap: 5 }}>
        <button className="wg-btn" style={iconBtn} onClick={() => rulerStore.undo()} disabled={!hasPoints}>
          <Undo2 size={12} /> {t.undo}
        </button>
        <button className="wg-btn" style={iconBtn} onClick={() => rulerStore.clear()} disabled={!hasPoints}>
          <Trash2 size={12} /> {t.clear}
        </button>
        <button className="wg-btn" style={iconBtn} onClick={() => rulerStore.finish()} disabled={!hasPoints || rulerStore.isFinished()}>
          <Check size={12} /> {t.done}
        </button>
      </div>
      <div style={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.45 }}>
        {rulerStore.isFinished() ? t.hintDone : t.hint}
      </div>
    </div>
  );
}
