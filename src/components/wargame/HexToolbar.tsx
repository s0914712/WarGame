/**
 * 六角格勢力範圍工具列（格線開啟時顯示，地圖右上）。
 *
 *   [藍方 N 格] [紅方 N 格] [橡皮擦] [移動地圖]   [清除]
 *
 * 選陣營筆刷 → 左鍵按住拖曳連續塗格；Esc 收起筆刷。
 * 多人連線時只能塗自己陣營（且標記不同步，僅本機）。
 */
import { useEffect, useState, useSyncExternalStore } from "react";
import { Hexagon, Eraser, Hand, Trash2, X } from "lucide-react";
import { hexStore, type HexBrush } from "../../wargame/hex/hexStore";
import { HEX_AREA_KM2 } from "../../wargame/hex/hexGrid";
import { scenarioStore } from "../../wargame/scenarioStore";
import { netStore } from "../../wargame/net/netStore";

function getScenarioId() { return scenarioStore.getState().scenario.id; }

export function HexToolbar({ top, isMobile = false }: { top: number; isMobile?: boolean }) {
  useSyncExternalStore(hexStore.subscribe, hexStore.getVersion, hexStore.getVersion);
  useSyncExternalStore(scenarioStore.subscribe, getScenarioId, getScenarioId);
  const [confirmClear, setConfirmClear] = useState(false);
  const brush = hexStore.getBrush();

  useEffect(() => {
    if (!brush) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") hexStore.setBrush(null); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [brush]);

  // 「清除」兩段式確認：3 秒內再按一次才清
  useEffect(() => {
    if (!confirmClear) return;
    const t = setTimeout(() => setConfirmClear(false), 3000);
    return () => clearTimeout(t);
  }, [confirmClear]);

  if (!hexStore.isVisible()) return null;

  const sides = scenarioStore.getState().scenario.sides
    .filter((s) => s.isHostileTo.length > 0 || s.isPlayer)
    .filter((s) => netStore.canControlSide(s.id));
  const counts = hexStore.countBySide();
  const total = Object.values(counts).reduce((a, n) => a + (n ?? 0), 0);

  const toggle = (b: HexBrush) => hexStore.setBrush(brush === b ? null : b);

  return (
    <div className="wg-fade-in" style={{
      position: "absolute", top, right: isMobile ? 8 : 12, zIndex: 24,
      width: isMobile ? "min(300px, calc(100vw - 16px))" : 300,
      padding: "10px 12px", borderRadius: 10,
      background: "rgba(15, 23, 42, 0.94)", backdropFilter: "blur(6px)",
      border: "1px solid rgba(148, 163, 184, 0.3)", boxShadow: "0 10px 28px rgba(0,0,0,0.45)",
      color: "#e2e8f0", fontFamily: "ui-sans-serif, system-ui, sans-serif",
      display: "flex", flexDirection: "column", gap: 8,
    }}>
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <Hexagon size={15} color="#60a5fa" />
        <span style={{ fontSize: 14, fontWeight: 700 }}>六角格 · 勢力範圍</span>
        <span style={{ flex: 1 }} />
        <span style={{ fontSize: 11, color: "#64748b" }}>每格 ≈ {HEX_AREA_KM2} km²</span>
        <button className="wg-btn" title="關閉六角格" onClick={() => hexStore.setVisible(false)} style={iconBtn}>
          <X size={13} />
        </button>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
        {sides.map((s) => {
          const n = counts[s.id] ?? 0;
          const on = brush === s.id;
          return (
            <button key={s.id} className="wg-btn" onClick={() => toggle(s.id)} title={`以 ${s.displayName} 勢力塗格`}
              style={{
                ...rowBtn,
                border: `1px solid ${on ? s.colorPrimary : "rgba(148,163,184,0.22)"}`,
                background: on ? `${s.colorPrimary}33` : "rgba(30,41,59,0.6)",
              }}>
              <span style={{
                width: 14, height: 14, flexShrink: 0, background: s.colorPrimary, opacity: 0.85,
                clipPath: "polygon(25% 5%, 75% 5%, 100% 50%, 75% 95%, 25% 95%, 0 50%)",
              }} />
              <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
                {s.displayName}
              </span>
              <span style={{ fontFamily: "ui-monospace, monospace", fontSize: 12, color: "#94a3b8", whiteSpace: "nowrap" }}>
                {n} 格 · {(n * HEX_AREA_KM2).toLocaleString()} km²
              </span>
            </button>
          );
        })}
      </div>

      {/* 雙方比例條 */}
      {total > 0 && sides.length >= 2 && (
        <div style={{ display: "flex", height: 4, borderRadius: 2, overflow: "hidden", background: "rgba(148,163,184,0.15)" }}>
          {sides.map((s) => (
            <span key={s.id} style={{ width: `${((counts[s.id] ?? 0) / total) * 100}%`, background: s.colorPrimary, transition: "width 0.3s" }} />
          ))}
        </div>
      )}

      <div style={{ display: "flex", gap: 4 }}>
        <button className="wg-btn" onClick={() => toggle("erase")} title="橡皮擦：拖曳清除格子"
          style={{ ...toolBtn, ...(brush === "erase" ? toolOn : {}) }}>
          <Eraser size={14} /> 擦除
        </button>
        <button className="wg-btn" onClick={() => hexStore.setBrush(null)} title="結束塗色，恢復拖曳地圖 / 選單位（Esc）"
          style={{ ...toolBtn, ...(brush === null ? toolOn : {}) }}>
          <Hand size={14} /> 移動
        </button>
        <button className="wg-btn" disabled={total === 0}
          onClick={() => { if (confirmClear) { hexStore.clear(); setConfirmClear(false); } else setConfirmClear(true); }}
          title="清除本場景所有勢力標記"
          style={{ ...toolBtn, color: total === 0 ? "#475569" : confirmClear ? "#fecaca" : "#fca5a5",
            background: confirmClear ? "rgba(239,68,68,0.3)" : toolBtn.background, cursor: total === 0 ? "default" : "pointer" }}>
          <Trash2 size={14} /> {confirmClear ? "確認清除" : "清除"}
        </button>
      </div>

      <div style={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.5 }}>
        {brush
          ? <>左鍵<b style={{ color: "#e2e8f0" }}>按住拖曳</b>連續塗格 · <b style={{ color: "#e2e8f0" }}>Esc</b> 結束塗色</>
          : "選一個陣營開始標示勢力範圍"}
        {netStore.isMultiplayer() && <div style={{ color: "#64748b" }}>多人模式：標記僅存在本機，不會同步給其他玩家</div>}
      </div>
    </div>
  );
}

const iconBtn: React.CSSProperties = {
  width: 22, height: 22, borderRadius: 5, display: "flex", alignItems: "center", justifyContent: "center",
  border: "1px solid rgba(148,163,184,0.3)", background: "rgba(30,41,59,0.6)", color: "#cbd5e1", cursor: "pointer",
};

const rowBtn: React.CSSProperties = {
  display: "flex", alignItems: "center", gap: 8, width: "100%",
  padding: "6px 8px", borderRadius: 6, color: "#e2e8f0", fontSize: 13, fontFamily: "inherit",
  cursor: "pointer", textAlign: "left",
};

const toolBtn: React.CSSProperties = {
  flex: 1, display: "flex", alignItems: "center", justifyContent: "center", gap: 5,
  padding: "5px 6px", borderRadius: 6, fontSize: 12, fontFamily: "inherit",
  border: "1px solid rgba(148,163,184,0.25)", background: "rgba(30,41,59,0.6)", color: "#cbd5e1", cursor: "pointer",
};

const toolOn: React.CSSProperties = {
  border: "1px solid rgba(96,165,250,0.8)", background: "rgba(59,130,246,0.3)", color: "#e2e8f0",
};
