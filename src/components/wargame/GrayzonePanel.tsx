/**
 * 灰色地帶情資開關 —— 四個子圖層勾選 + 載入狀態 / 資料時間。
 * 桌面：頂部列「情資」按鈕的下拉面板；行動：設定面板的一個 Section。
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { RefreshCw, Ship } from "lucide-react";
import {
  grayzoneStore, GRAYZONE_LAYER_KEYS, type GrayzoneLayerKey,
} from "../../wargame/grayzone/grayzoneStore";

const LABELS: Record<GrayzoneLayerKey, { name: string; color: string; hint: string }> = {
  tracks: { name: "近 24h 航跡", color: "#22d3ee", hint: "中國漁船與可疑船的 AIS 航跡（高風險船以紅 / 橘標出）" },
  highRisk: { name: "高風險船", color: "#ef4444", hint: "海纜威脅評分 critical / high 的最後位置" },
  dark: { name: "SAR 暗船", color: "#a855f7", hint: "衛星雷達有、AIS 沒有的船（GFW 資料延遲數天，顯示最近 7 天）" },
  cables: { name: "海底電纜", color: "#38bdf8", hint: "台灣周邊海纜；紅色虛線 = 數位部公告障礙中" },
};

function fmt(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("zh-TW", { timeZone: "Asia/Taipei", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false });
}

export function GrayzoneControls() {
  useSyncExternalStore(grayzoneStore.subscribe, grayzoneStore.getVersion, grayzoneStore.getVersion);
  const status = grayzoneStore.getStatus();
  const feed = grayzoneStore.getFeed();

  const counts: Record<GrayzoneLayerKey, string> = {
    tracks: feed ? `${feed.tracks.vessels.length} 艘` : "",
    highRisk: feed ? `${feed.high_risk.vessels.length} 艘` : "",
    dark: feed ? `${feed.dark.points.length} 點` : "",
    cables: feed ? `障礙 ${feed.cables.fault_count}` : "",
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      {GRAYZONE_LAYER_KEYS.map((k) => (
        <label key={k} title={LABELS[k].hint} style={{
          display: "flex", alignItems: "center", gap: 8, padding: "6px 6px", borderRadius: 6,
          cursor: "pointer", fontSize: 14, color: "#e2e8f0",
        }}>
          <input type="checkbox" checked={grayzoneStore.isOn(k)}
            onChange={(e) => grayzoneStore.setOn(k, e.target.checked)}
            style={{ accentColor: LABELS[k].color, width: 15, height: 15 }} />
          <span style={{ width: 10, height: 10, borderRadius: "50%", background: LABELS[k].color, flexShrink: 0 }} />
          <span style={{ flex: 1 }}>{LABELS[k].name}</span>
          <span style={{ fontSize: 12, color: "#94a3b8" }}>{counts[k]}</span>
        </label>
      ))}

      <div style={{
        marginTop: 4, padding: "6px 6px 0", borderTop: "1px solid rgba(148,163,184,0.2)",
        fontSize: 12, color: "#94a3b8", display: "flex", flexDirection: "column", gap: 2,
      }}>
        {status === "idle" && <span>勾選任一項即載入（約 200 KB）</span>}
        {status === "loading" && <span style={{ color: "#facc15" }}>載入中…</span>}
        {status === "error" && <span style={{ color: "#f87171" }}>載入失敗：{grayzoneStore.getError()}</span>}
        {feed && (
          <>
            <span>航跡 {fmt(feed.tracks.start)} ～ {fmt(feed.tracks.end)}</span>
            {feed.dark.start && <span>暗船 {feed.dark.start} ～ {feed.dark.end}</span>}
            <span>資料產生 {fmt(feed.generated_at)}</span>
          </>
        )}
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 2 }}>
          <a href="https://s0914712.github.io/taiwan-grayzone-monitor/" target="_blank" rel="noreferrer"
            style={{ color: "#60a5fa", flex: 1 }}>來源：taiwan-grayzone-monitor</a>
          {(status === "ready" || status === "error") && (
            <button className="wg-btn" onClick={() => grayzoneStore.reload()} title="重新載入"
              style={{
                display: "flex", alignItems: "center", gap: 4, padding: "3px 8px", borderRadius: 5,
                border: "1px solid rgba(148,163,184,0.3)", background: "rgba(30,41,59,0.6)",
                color: "#e2e8f0", fontSize: 12, cursor: "pointer", fontFamily: "inherit",
              }}>
              <RefreshCw size={12} /> 重新載入
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
  renderButton: (props: { active: boolean; onClick: () => void; children: React.ReactNode }) => React.ReactNode;
}) {
  useSyncExternalStore(grayzoneStore.subscribe, grayzoneStore.getVersion, grayzoneStore.getVersion);
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
        children: <><Ship size={15} />{!iconOnly && " 情資"}</>,
      })}
      {open && (
        <div className="wg-fade-in" style={{
          position: "absolute", top: "calc(100% + 8px)", right: 0, width: 290, zIndex: 40,
          padding: 8, borderRadius: 10,
          background: "rgba(15, 23, 42, 0.98)", border: "1px solid rgba(148, 163, 184, 0.3)",
          boxShadow: "0 12px 32px rgba(0,0,0,0.55)",
        }}>
          <div style={{ padding: "4px 6px 6px", fontSize: 12, letterSpacing: 1, color: "#60a5fa", fontWeight: 700 }}>
            灰色地帶情資
          </div>
          <GrayzoneControls />
        </div>
      )}
    </div>
  );
}
