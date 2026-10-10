/**
 * 尺規工具控制列 — 開關、單位（海里 / 公里）、總距離、復原 / 清除。
 * 量測互動本身在 map/rulerTool.ts；此元件只訂閱 rulerStore。
 *
 * withDraw（兵推用）：同一面板多出繪圖模式 —— 線段 / 矩形 / 圓（map/drawTool.ts），
 * 與量測共用單位；模式列切換「量測 ↔ 繪圖工具」，兩者互斥（都要攔地圖點擊）。
 */
import { useState, useSyncExternalStore } from "react";
import { Ruler, Undo2, Trash2, Check, X, Spline, Square, Circle, Pentagon } from "lucide-react";
import { formatBearing, formatDistance, rulerStore, type RulerUnit } from "../map/rulerTool";
import { drawStore, describeShape, DRAW_COLORS, type DrawKind } from "../map/drawTool";
import { parseCoordList, formatDms } from "../map/parseDmsCoords";

const TEXT = {
  zh: {
    ruler: "尺規", nm: "海里", km: "公里", total: "總長", segments: "段", bearing: "最後方位",
    undo: "復原", clear: "清除", done: "結束", close: "關閉尺規",
    hint: "點地圖加點 · 雙擊結束 · 右鍵刪最後一點 · Esc 結束",
    hintDone: "已結束 —— 再點地圖開始新的量測",
    measure: "量測", line: "線段", rect: "矩形", circle: "圓", polygon: "多邊形",
    drawHint: {
      line: "點地圖加點，雙擊或 Enter 完成 · 右鍵退一點 · Esc 取消",
      rect: "點第一角，再點對角完成 · Esc 取消",
      circle: "點圓心，再點決定半徑 · Esc 取消",
      polygon: "點地圖加頂點，雙擊或 Enter 完成（≥ 3 點）· 右鍵退一點 · Esc 取消；或在下方輸入座標",
      none: "選擇線段 / 矩形 / 圓 / 多邊形後在地圖上畫",
    },
    clearAll: "全部清除", del: "刪除",
    coordTitle: "手動輸入座標（度分秒）",
    coordPh: "每行一點：經度, 緯度\n120°30'15\"E, 24°06'00\"N\n120 54 00, 24 06 00\n120°42'E 23°48'N",
    coordNote: "度分秒可用 ° ' \" 、空白或 - 分隔，可加 E/N（或東經 / 北緯）；分可帶小數（24°06.5'）；緯度在前也可；十進位亦可；至少 3 點",
    coordAdd: "建立多邊形", coordBad: "第 {n} 行無法解讀：", coordFew: "至少需要 3 個點", coordParsed: "已解讀 {n} 點",
  },
  en: {
    ruler: "Ruler", nm: "NM", km: "km", total: "Total", segments: "seg", bearing: "Last bearing",
    undo: "Undo", clear: "Clear", done: "Done", close: "Close ruler",
    hint: "Click to add points · double-click to finish · right-click removes last · Esc to finish",
    hintDone: "Finished — click the map to start a new measurement",
    measure: "Measure", line: "Line", rect: "Rect", circle: "Circle", polygon: "Polygon",
    drawHint: {
      line: "Click to add points, double-click or Enter to finish · right-click undo · Esc cancel",
      rect: "Click one corner, then the opposite corner · Esc cancel",
      circle: "Click the centre, then click to set the radius · Esc cancel",
      polygon: "Click to add vertices, double-click or Enter to finish (≥ 3) · right-click undo · Esc cancel; or type coordinates below",
      none: "Pick line / rectangle / circle / polygon, then draw on the map",
    },
    clearAll: "Clear all", del: "Delete",
    coordTitle: "Enter coordinates (deg / min / sec)",
    coordPh: "One point per line: lng, lat\n120°30'15\"E, 24°06'00\"N\n120 54 00, 24 06 00\n120°42'E 23°48'N",
    coordNote: "Separate D/M/S with ° ' \", spaces or -; add E/N if you like; decimal minutes OK (24°06.5'); lat-first OK; decimal degrees also work; at least 3 points",
    coordAdd: "Create polygon", coordBad: "Line {n} not understood: ", coordFew: "Need at least 3 points", coordParsed: "{n} points parsed",
  },
} as const;

/**
 * @param hideLauncher 開關入口放在別處（兵推頂部列）：未啟用且無量測時不渲染
 * @param withDraw 加上繪圖模式（線段 / 矩形 / 圓）；需在地圖上掛 attachDrawLayer
 */
export function RulerControl({ lang = "zh", style, hideLauncher = false, withDraw = false }: {
  lang?: "zh" | "en"; style?: React.CSSProperties; hideLauncher?: boolean; withDraw?: boolean;
}) {
  useSyncExternalStore(rulerStore.subscribe, rulerStore.getVersion, rulerStore.getVersion);
  useSyncExternalStore(drawStore.subscribe, drawStore.getVersion, drawStore.getVersion);
  const t = TEXT[lang];
  const active = rulerStore.isActive();
  const drawing = withDraw && drawStore.isOpen() && !active;
  const unit = rulerStore.getUnit();
  const sum = rulerStore.getSummary();
  const hasPoints = rulerStore.getPoints().length > 0;

  const box: React.CSSProperties = {
    position: "absolute", zIndex: 25,
    background: "rgba(15,23,42,0.94)", backdropFilter: "blur(6px)",
    border: `1px solid ${active || drawing ? "rgba(244,114,182,0.6)" : "rgba(148,163,184,0.3)"}`,
    borderRadius: 8, color: "#e2e8f0",
    fontFamily: "ui-sans-serif, system-ui, sans-serif",
    boxShadow: "0 6px 20px rgba(0,0,0,0.4)",
    ...style,
  };

  if (!active && !drawing) {
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
  const closeAll = () => { rulerStore.setActive(false); drawStore.setOpen(false); };

  // 模式列：量測 | 線段 | 矩形 | 圓
  const tool = drawStore.getTool();
  const modeBtn = (id: "measure" | DrawKind, icon: React.ReactNode, label: string) => {
    const on = id === "measure" ? active : drawing && tool === id;
    return (
      <button key={id} className="wg-btn" data-testid={`ruler-mode-${id}`}
        onClick={() => {
          // 切回量測：收起繪圖（之後 Esc 結束量測就整個關閉，不會跳回繪圖頁）
          if (id === "measure") { drawStore.setOpen(false); rulerStore.setActive(true); }
          else drawStore.setTool(on ? null : id);
        }}
        style={{
          flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 3,
          padding: "5px 2px", fontSize: 13, borderRadius: 4, cursor: "pointer", fontFamily: "inherit",
          fontWeight: on ? 700 : 400,
          border: `1px solid ${on ? "#f472b6" : "rgba(148,163,184,0.3)"}`,
          background: on ? "rgba(244,114,182,0.2)" : "rgba(30,41,59,0.6)",
          color: on ? "#fce7f3" : "#cbd5e1",
        }}>{icon}{label}</button>
    );
  };

  return (
    <div data-testid="ruler-panel" style={{ ...box, width: withDraw ? 330 : 250, padding: "9px 11px", display: "flex", flexDirection: "column", gap: 7 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <Ruler size={15} color="#f472b6" />
        <span style={{ fontWeight: 700, fontSize: 15 }}>{t.ruler}</span>
        <span style={{ flex: 1 }} />
        <button className="wg-btn" onClick={closeAll} title={t.close}
          style={{ ...iconBtn, padding: "3px 5px" }}><X size={13} /></button>
      </div>
      {withDraw && (
        <div style={{ display: "flex", gap: 4 }}>
          {modeBtn("measure", <Ruler size={12} />, t.measure)}
          {modeBtn("line", <Spline size={12} />, t.line)}
          {modeBtn("rect", <Square size={12} />, t.rect)}
          {modeBtn("circle", <Circle size={12} />, t.circle)}
          {modeBtn("polygon", <Pentagon size={12} />, t.polygon)}
        </div>
      )}
      <div style={{ display: "flex", gap: 6 }}>
        {unitBtn("nm", t.nm)}
        {unitBtn("km", t.km)}
      </div>

      {drawing ? (
        <DrawSection t={t} iconBtn={iconBtn} />
      ) : (
        <>
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
        </>
      )}
      {/* 量測模式下也列出已畫的圖形，方便刪除 */}
      {withDraw && !drawing && drawStore.getShapes().length > 0 && <ShapeList t={t} iconBtn={iconBtn} />}
    </div>
  );
}

type T = (typeof TEXT)[keyof typeof TEXT];

function DrawSection({ t, iconBtn }: { t: T; iconBtn: React.CSSProperties }) {
  const tool = drawStore.getTool();
  const color = drawStore.getColor();
  const shapes = drawStore.getShapes();
  return (
    <>
      <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
        {DRAW_COLORS.map((c) => (
          <button key={c} aria-label={c} onClick={() => drawStore.setColor(c)}
            style={{
              width: 20, height: 20, borderRadius: "50%", cursor: "pointer", background: c, padding: 0,
              border: c === color ? "2px solid #f8fafc" : "2px solid rgba(15,23,42,0.9)",
              boxShadow: c === color ? `0 0 0 2px ${c}66` : "none",
            }} />
        ))}
      </div>
      <div style={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.45 }}>{t.drawHint[tool ?? "none"]}</div>
      {tool === "polygon" && <CoordPolygonInput t={t} iconBtn={iconBtn} />}
      {shapes.length > 0 && <ShapeList t={t} iconBtn={iconBtn} />}
      <div style={{ display: "flex", gap: 5 }}>
        <button className="wg-btn" style={iconBtn} onClick={() => drawStore.undoShape()} disabled={!shapes.length}>
          <Undo2 size={12} /> {t.undo}
        </button>
        <button className="wg-btn" style={iconBtn} data-testid="draw-clear" onClick={() => drawStore.clearAll()} disabled={!shapes.length}>
          <Trash2 size={12} /> {t.clearAll}
        </button>
      </div>
    </>
  );
}

function ShapeList({ t, iconBtn }: { t: T; iconBtn: React.CSSProperties }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 3, maxHeight: 160, overflow: "auto" }}>
      {drawStore.getShapes().map((s) => (
        <div key={s.id} data-testid="draw-shape-row" style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13 }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: s.color, flexShrink: 0 }} />
          <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
            {describeShape(s)}
          </span>
          <button className="wg-btn" title={t.del} onClick={() => drawStore.remove(s.id)}
            style={{ ...iconBtn, padding: "1px 5px", color: "#fca5a5" }}>
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  );
}

function CoordPolygonInput({ t, iconBtn }: { t: T; iconBtn: React.CSSProperties }) {
  const [text, setText] = useState("");
  const [err, setErr] = useState("");
  // 即時預覽：已解讀幾點、最後兩點換回度分秒顯示（確認沒打錯）
  const preview = text.trim() ? parseCoordList(text) : null;
  const create = () => {
    const r = parseCoordList(text);
    if (r.badLine !== null) { setErr(`${t.coordBad.replace("{n}", String(r.badLine))}${r.badText}`); return; }
    if (!drawStore.addPolygon(r.pts)) { setErr(t.coordFew); return; }
    setErr(""); setText("");
  };
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 5, padding: "7px 8px", borderRadius: 5,
      background: "rgba(30,41,59,0.5)", border: "1px solid rgba(148,163,184,0.2)" }}>
      <div style={{ fontSize: 13, fontWeight: 600, color: "#e2e8f0" }}>{t.coordTitle}</div>
      <textarea data-testid="draw-coords" value={text} rows={5} placeholder={t.coordPh}
        onChange={(e) => { setText(e.target.value); setErr(""); }}
        onKeyDown={(e) => { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) create(); }}
        style={{ resize: "vertical", fontFamily: "ui-monospace, monospace", fontSize: 13, padding: "5px 7px",
          background: "#020617", color: "#e2e8f0", border: "1px solid rgba(148,163,184,0.3)", borderRadius: 4 }} />
      <div style={{ fontSize: 11, color: "#64748b", lineHeight: 1.4 }}>{t.coordNote}</div>
      {!err && preview && preview.pts.length > 0 && (
        <div style={{ fontSize: 12, color: preview.badLine === null ? "#86efac" : "#fcd34d", fontFamily: "ui-monospace, monospace", lineHeight: 1.45 }}>
          {t.coordParsed.replace("{n}", String(preview.pts.length))}
          {preview.pts.slice(-2).map((p, i) => <div key={i}>{formatDms(p[0], "lng")} {formatDms(p[1], "lat")}</div>)}
        </div>
      )}
      {err && <div style={{ fontSize: 12, color: "#fca5a5" }}>{err}</div>}
      <button className="wg-btn" data-testid="draw-coords-add" style={{ ...iconBtn, alignSelf: "flex-start", color: "#fef9c3" }}
        onClick={create} disabled={!text.trim()}>
        <Pentagon size={12} /> {t.coordAdd}
      </button>
    </div>
  );
}
