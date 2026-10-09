/**
 * 海流 / 風場向量開關 + 色階圖例 + 顯示時刻。
 * 用在：桌面「情資」下拉、行動版設定面板、搜索規劃器落水（MOB）區（compact）。
 */
import { useSyncExternalStore } from "react";
import { seaVectorStore, type SeaVectorKind } from "../../wargame/search/drift/seaVectorStore";
import { CURRENT_STOPS, WIND_STOPS } from "../../map/wargameSeaVectorLayer";
import { useLang } from "../../wargame/i18n/lang";

const TEXT = {
  zh: {
    title: "海象（seacurrent 預報）",
    current: "海流向量", wind: "10 m 風向量",
    unitCurrent: "m/s（流向）", unitWind: "m/s（吹向）",
    loading: "載入預報…", failed: "載入失敗",
    atDrift: "跟隨落水漂流時間軸", atNow: "現在",
    outOfRange: "超出預報範圍，顯示端點那張",
  },
  en: {
    title: "Sea state (seacurrent forecast)",
    current: "Current vectors", wind: "10 m wind vectors",
    unitCurrent: "m/s (toward)", unitWind: "m/s (blowing toward)",
    loading: "Loading forecast…", failed: "Load failed",
    atDrift: "following MOB drift timeline", atNow: "now",
    outOfRange: "Outside forecast range; showing the end-point frame",
  },
} as const;

function fmtTaipei(ms: number, lang: "zh" | "en"): string {
  return new Date(ms).toLocaleString(lang === "en" ? "en-GB" : "zh-TW", {
    timeZone: "Asia/Taipei", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hour12: false,
  });
}

function Legend({ stops, unit }: { stops: [number, string][]; unit: string }) {
  const grad = stops.map(([, c], i) => `${c} ${(i / (stops.length - 1)) * 100}%`).join(", ");
  return (
    <div style={{ padding: "0 6px 4px 31px", fontSize: 11, color: "#94a3b8" }}>
      <div style={{ height: 6, borderRadius: 3, background: `linear-gradient(90deg, ${grad})` }} />
      <div style={{ display: "flex", justifyContent: "space-between", marginTop: 2 }}>
        <span>{stops[0]![0]}</span><span>{unit}</span><span>{stops[stops.length - 1]![0]}+</span>
      </div>
    </div>
  );
}

export function SeaVectorControls({ compact = false }: { compact?: boolean }) {
  useSyncExternalStore(seaVectorStore.subscribe, seaVectorStore.getVersion, seaVectorStore.getVersion);
  const lang = useLang() === "en" ? "en" : "zh";
  const s = TEXT[lang];
  const status = seaVectorStore.getStatus();
  const t = seaVectorStore.getTimeMs();

  const row = (k: SeaVectorKind, label: string, color: string) => (
    <label style={{
      display: "flex", alignItems: "center", gap: 8, padding: compact ? "3px 0" : "6px 6px",
      cursor: "pointer", fontSize: 14, color: "#e2e8f0",
    }}>
      <input type="checkbox" checked={seaVectorStore.isOn(k)} data-testid={`seavec-${k}`}
        onChange={(e) => seaVectorStore.setOn(k, e.target.checked)}
        style={{ accentColor: color, width: 15, height: 15 }} />
      <span style={{ color, fontWeight: 700, width: 10, textAlign: "center" }}>{k === "current" ? "➜" : "↗"}</span>
      <span style={{ flex: 1 }}>{label}</span>
    </label>
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: compact ? 0 : 2 }}>
      {!compact && (
        <div style={{ padding: "6px 6px 2px", fontSize: 12, letterSpacing: 1, color: "#60a5fa", fontWeight: 700 }}>{s.title}</div>
      )}
      {row("current", s.current, "#22d3ee")}
      {seaVectorStore.isOn("current") && !compact && <Legend stops={CURRENT_STOPS} unit={s.unitCurrent} />}
      {row("wind", s.wind, "#c084fc")}
      {seaVectorStore.isOn("wind") && !compact && <Legend stops={WIND_STOPS} unit={s.unitWind} />}
      {seaVectorStore.anyOn() && (
        <div style={{ padding: compact ? "2px 0" : "2px 6px", fontSize: 12, color: "#94a3b8", lineHeight: 1.5 }}>
          {status === "loading" && <span style={{ color: "#facc15" }}>{s.loading}</span>}
          {status === "error" && <span style={{ color: "#f87171" }}>{s.failed}: {seaVectorStore.getError()}</span>}
          {status === "ready" && t > 0 && (
            <span>
              {fmtTaipei(t, lang)} · {seaVectorStore.followsDrift() ? s.atDrift : s.atNow}
            </span>
          )}
          {status === "ready" && seaVectorStore.outOfRange() && (
            <div style={{ color: "#fdba74" }}>{s.outOfRange}</div>
          )}
        </div>
      )}
    </div>
  );
}
