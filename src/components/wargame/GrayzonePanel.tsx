/**
 * 灰色地帶情資開關 —— 四個子圖層勾選 + 航跡圖例 + 載入狀態 / 資料時間。
 * 桌面：頂部列「情資」按鈕的下拉面板；行動：設定面板的一個 Section。
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { RefreshCw, Ship } from "lucide-react";
import {
  grayzoneStore, GRAYZONE_LAYER_KEYS, type GrayzoneLayerKey,
} from "../../wargame/grayzone/grayzoneStore";
import { useLang } from "../../wargame/i18n/lang";
import { TRACK_TYPE_LEGEND } from "../../map/wargameGrayzoneLayer";

const TEXT = {
  zh: {
    title: "灰色地帶情資", button: "情資",
    layers: {
      tracks: { name: "近 24h 航跡", hint: "中國漁船與可疑船的 AIS 航跡（高風險船以紅 / 橘標出）" },
      highRisk: { name: "高風險船", hint: "海纜威脅評分 critical / high、且 24h 內有訊號的最後位置" },
      dark: { name: "SAR 暗船", hint: "衛星雷達有、AIS 沒有的船（GFW 資料延遲數天，顯示最近 7 天）" },
      cables: { name: "海底電纜", hint: "台灣周邊海纜；紅色虛線 = 數位部公告障礙中" },
    },
    vessels: "艘", points: "點", faults: "障礙",
    idle: "勾選任一項即載入（約 200 KB）", loading: "載入中…", failed: "載入失敗",
    tracks: "航跡", dark: "暗船", generated: "資料產生", source: "來源：taiwan-grayzone-monitor", reload: "重新載入",
    legend: { fishing: "漁船", cargo: "貨輪", tanker: "油輪", gov: "公務 / 海警", other: "其他", critical: "極高風險", high: "高風險" },
  },
  en: {
    title: "Gray-zone intel", button: "Intel",
    layers: {
      tracks: { name: "24h tracks", hint: "AIS tracks of PRC fishing and suspicious vessels (high-risk in red / orange)" },
      highRisk: { name: "High-risk vessels", hint: "Cable-threat score critical / high, last position within 24h" },
      dark: { name: "SAR dark vessels", hint: "Seen by satellite radar with no AIS match (GFW lags a few days; last 7 days)" },
      cables: { name: "Submarine cables", hint: "Cables around Taiwan; red dashed = fault reported by MODA" },
    },
    vessels: "", points: "pts", faults: "faults",
    idle: "Loads on first tick (~200 KB)", loading: "Loading…", failed: "Load failed",
    tracks: "Tracks", dark: "Dark", generated: "Generated", source: "Source: taiwan-grayzone-monitor", reload: "Reload",
    legend: { fishing: "Fishing", cargo: "Cargo", tanker: "Tanker", gov: "Gov / CG", other: "Other", critical: "Critical", high: "High" },
  },
} as const;

const DOT: Record<GrayzoneLayerKey, string> = {
  tracks: "#22d3ee", highRisk: "#ef4444", dark: "#a855f7", cables: "#38bdf8",
};

function fmt(iso: string | null | undefined, lang: "zh" | "en"): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(lang === "en" ? "en-GB" : "zh-TW", {
    timeZone: "Asia/Taipei", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

export function GrayzoneControls() {
  useSyncExternalStore(grayzoneStore.subscribe, grayzoneStore.getVersion, grayzoneStore.getVersion);
  const lang = useLang() === "en" ? "en" : "zh";
  const s = TEXT[lang];
  const status = grayzoneStore.getStatus();
  const feed = grayzoneStore.getFeed();

  const counts: Record<GrayzoneLayerKey, string> = {
    tracks: feed ? `${feed.tracks.vessels.length} ${s.vessels}` : "",
    highRisk: feed ? `${feed.high_risk.vessels.length} ${s.vessels}` : "",
    dark: feed ? `${feed.dark.points.length} ${s.points}` : "",
    cables: feed ? `${s.faults} ${feed.cables.fault_count}` : "",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {GRAYZONE_LAYER_KEYS.map((k) => (
        <div key={k}>
          <label title={s.layers[k].hint} style={{
            display: "flex", alignItems: "center", gap: 8, padding: "6px 6px", borderRadius: 6,
            cursor: "pointer", fontSize: 14, color: "#e2e8f0",
          }}>
            <input type="checkbox" checked={grayzoneStore.isOn(k)}
              onChange={(e) => grayzoneStore.setOn(k, e.target.checked)}
              style={{ accentColor: DOT[k], width: 15, height: 15 }} />
            <span style={{ width: 10, height: 10, borderRadius: "50%", background: DOT[k], flexShrink: 0 }} />
            <span style={{ flex: 1 }}>{s.layers[k].name}</span>
            <span style={{ fontSize: 12, color: "#94a3b8" }}>{counts[k].trim()}</span>
          </label>
          {/* 航跡開著才顯示船種圖例 */}
          {k === "tracks" && grayzoneStore.isOn("tracks") && (
            <div style={{ display: "flex", flexWrap: "wrap", gap: "2px 10px", padding: "0 6px 4px 31px", fontSize: 11, color: "#94a3b8" }}>
              {TRACK_TYPE_LEGEND.map((l) => (
                <span key={l.key} style={{ display: "flex", alignItems: "center", gap: 4 }}>
                  <span style={{ width: 12, height: l.key === "critical" || l.key === "high" ? 3 : 2, background: l.color, borderRadius: 1 }} />
                  {s.legend[l.key]}
                </span>
              ))}
            </div>
          )}
        </div>
      ))}

      <div style={{
        marginTop: 4, padding: "6px 6px 0", borderTop: "1px solid rgba(148,163,184,0.2)",
        fontSize: 12, color: "#94a3b8", display: "flex", flexDirection: "column", gap: 2,
      }}>
        {status === "idle" && <span>{s.idle}</span>}
        {status === "loading" && <span style={{ color: "#facc15" }}>{s.loading}</span>}
        {status === "error" && <span style={{ color: "#f87171" }}>{s.failed}: {grayzoneStore.getError()}</span>}
        {feed && (
          <>
            <span>{s.tracks} {fmt(feed.tracks.start, lang)} – {fmt(feed.tracks.end, lang)}</span>
            {feed.dark.start && <span>{s.dark} {feed.dark.start} – {feed.dark.end}</span>}
            <span>{s.generated} {fmt(feed.generated_at, lang)}</span>
          </>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 2 }}>
          <a href="https://s0914712.github.io/taiwan-grayzone-monitor/" target="_blank" rel="noreferrer"
            style={{ color: "#60a5fa", flex: 1 }}>{s.source}</a>
          {(status === "ready" || status === "error") && (
            <button className="wg-btn" onClick={() => grayzoneStore.reload()} title={s.reload}
              style={{
                display: "flex", alignItems: "center", gap: 4, padding: "3px 8px", borderRadius: 5,
                border: "1px solid rgba(148,163,184,0.3)", background: "rgba(30,41,59,0.6)",
                color: "#e2e8f0", fontSize: 12, cursor: "pointer", fontFamily: "inherit",
              }}>
              <RefreshCw size={12} /> {s.reload}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

/** 桌面頂部列按鈕 + 下拉面板 */
export function GrayzoneBarButton({ iconOnly, renderButton }: {
  iconOnly: boolean;
  renderButton: (props: { active: boolean; onClick: () => void; title: string; children: React.ReactNode }) => React.ReactNode;
}) {
  useSyncExternalStore(grayzoneStore.subscribe, grayzoneStore.getVersion, grayzoneStore.getVersion);
  const lang = useLang() === "en" ? "en" : "zh";
  const s = TEXT[lang];
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("mousedown", onDown); window.removeEventListener("keydown", onKey); };
  }, [open]);

  return (
    <div ref={ref} style={{ position: "relative", flexShrink: 0 }}>
      {renderButton({
        active: open || grayzoneStore.anyOn(),
        onClick: () => setOpen((o) => !o),
        title: `${s.title}: ${GRAYZONE_LAYER_KEYS.map((k) => s.layers[k].name).join(" / ")}`,
        children: <><Ship size={15} />{!iconOnly && ` ${s.button}`}</>,
      })}
      {open && (
        <div className="wg-fade-in" style={{
          position: "absolute", top: "calc(100% + 8px)", right: 0, width: 300, zIndex: 40,
          padding: 8, borderRadius: 10,
          background: "rgba(15, 23, 42, 0.98)", border: "1px solid rgba(148, 163, 184, 0.3)",
          boxShadow: "0 12px 32px rgba(0,0,0,0.55)",
        }}>
          <div style={{ padding: "4px 6px 6px", fontSize: 12, letterSpacing: 1, color: "#60a5fa", fontWeight: 700 }}>
            {s.title}
          </div>
          <GrayzoneControls />
        </div>
      )}
    </div>
  );
}
