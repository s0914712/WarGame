/**
 * 任務目標追蹤 HUD（桌面：地圖左下、控制台上方）。
 *
 * 每條勝負條件一列：圖示 + 名稱 + 進度條 + 狀態文字；己方目標在上、敵方目標（威脅）在下。
 * 點有定位的目標 → 鏡頭飛過去。可摺疊（記在 localStorage）。
 */
import { useState, useSyncExternalStore } from "react";
import type { Map as MapboxMap } from "mapbox-gl";
import type { LucideIcon } from "lucide-react";
import { Flag, Target, ShieldCheck, MapPin, Skull, Clock, ChevronDown, ChevronUp, CheckCircle2, XCircle, Swords } from "lucide-react";
import { scenarioStore } from "../../wargame/scenarioStore";
import { viewStore } from "../../wargame/viewStore";
import { wargameClock } from "../../wargame/clock";
import { computeObjectives, type ObjectiveStatus } from "../../wargame/objectives";

const COLLAPSE_KEY = "wargame.objectives.collapsed.v1";

const ICON: Record<ObjectiveStatus["kind"], LucideIcon> = {
  preserve_unit: ShieldCheck,
  destroy_unit: Target,
  eliminate_side: Skull,
  hold_area: MapPin,
  time_limit: Clock,
};

function current(): ObjectiveStatus[] {
  return computeObjectives(scenarioStore.getState(), wargameClock.getSimTime(), viewStore.getActiveSideId());
}

/** primitive 簽名 → useSyncExternalStore 快照穩定 */
function sig(): string {
  return current().map((o) => `${o.state}|${o.detail}|${Math.round((o.progress ?? -1) * 100)}|${o.contested ? 1 : 0}|${o.focus ? 1 : 0}`).join(";")
    + `#${viewStore.getActiveView()}`;
}

function subscribe(cb: () => void): () => void {
  const a = scenarioStore.subscribe(cb);
  const b = viewStore.subscribe(cb);
  return () => { a(); b(); };
}

export function ObjectivesHud({ map, bottom }: { map: MapboxMap | null; bottom: number }) {
  useSyncExternalStore(subscribe, sig, sig);
  const [collapsed, setCollapsed] = useState(() => {
    try { return localStorage.getItem(COLLAPSE_KEY) === "1"; } catch { return false; }
  });
  const objs = current();
  if (objs.length === 0) return null;

  const pov = viewStore.getActiveSideId();
  const sides = scenarioStore.getState().scenario.sides;
  const colorOf = (id: string | null) => (id && sides.find((s) => s.id === id)?.colorPrimary) || "#94a3b8";
  const mine = objs.filter((o) => o.sideId != null && (pov == null || o.sideId === pov));
  const theirs = objs.filter((o) => o.sideId != null && pov != null && o.sideId !== pov);
  const neutral = objs.filter((o) => o.sideId == null);
  const doneCount = mine.filter((o) => o.state === "done").length;

  const toggle = () => {
    const next = !collapsed;
    setCollapsed(next);
    try { localStorage.setItem(COLLAPSE_KEY, next ? "1" : "0"); } catch { /* ignore */ }
  };

  const fly = (o: ObjectiveStatus) => {
    if (!map || !o.focus) return;
    map.flyTo({ center: o.focus, zoom: Math.max(map.getZoom(), o.radiusKm ? 9 : 10), duration: 900 });
  };

  return (
    <div style={{
      position: "absolute", left: 12, bottom, zIndex: 23, width: 300,
      background: "rgba(15, 23, 42, 0.9)", backdropFilter: "blur(6px)",
      border: "1px solid rgba(148, 163, 184, 0.28)", borderRadius: 10,
      color: "#e2e8f0", fontFamily: "ui-sans-serif, system-ui, sans-serif",
      boxShadow: "0 8px 24px rgba(0,0,0,0.4)", overflow: "hidden",
    }}>
      <button onClick={toggle} className="wg-btn" style={{
        width: "100%", display: "flex", alignItems: "center", gap: 8, padding: "8px 12px",
        background: "transparent", border: "none", color: "inherit", cursor: "pointer", fontFamily: "inherit",
      }}>
        <Flag size={14} color="#fbbf24" />
        <span style={{ fontSize: 13, fontWeight: 700, letterSpacing: 1 }}>任務目標</span>
        {mine.length > 0 && (
          <span style={{ fontSize: 12, color: "#94a3b8", fontFamily: "ui-monospace, monospace" }}>{doneCount}/{mine.length}</span>
        )}
        <span style={{ flex: 1 }} />
        {neutral[0] && <span style={{ fontSize: 12, color: "#cbd5e1", fontFamily: "ui-monospace, monospace" }}>{neutral[0].detail}</span>}
        {collapsed ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </button>

      {!collapsed && (
        <div style={{ padding: "0 10px 10px", display: "flex", flexDirection: "column", gap: 6, maxHeight: 280, overflowY: "auto" }}>
          {mine.map((o) => <Row key={o.idx} o={o} color={colorOf(o.sideId)} onFly={fly} />)}
          {theirs.length > 0 && (
            <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 11, color: "#f87171", letterSpacing: 1, marginTop: 2 }}>
              <Swords size={11} /> 敵方目標（阻止）
            </div>
          )}
          {theirs.map((o) => <Row key={o.idx} o={o} color={colorOf(o.sideId)} onFly={fly} enemy />)}
        </div>
      )}
    </div>
  );
}

function Row({ o, color, onFly, enemy = false }: { o: ObjectiveStatus; color: string; onFly: (o: ObjectiveStatus) => void; enemy?: boolean }) {
  const Icon = ICON[o.kind];
  const clickable = !!o.focus;
  const stateColor = o.state === "done" ? (enemy ? "#f87171" : "#4ade80") : o.state === "failed" ? (enemy ? "#4ade80" : "#f87171") : "#e2e8f0";
  return (
    <div onClick={clickable ? () => onFly(o) : undefined}
      className={clickable ? "wg-log-clickable" : undefined}
      title={clickable ? "點擊飛到目標位置" : undefined}
      style={{
        padding: "6px 8px", borderRadius: 6,
        background: enemy ? "rgba(127, 29, 29, 0.18)" : "rgba(30, 41, 59, 0.6)",
        border: `1px solid ${o.contested ? "rgba(248,113,113,0.6)" : "rgba(148,163,184,0.15)"}`,
        opacity: o.state === "failed" && !enemy ? 0.7 : 1,
      }}>
      <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 13 }}>
        <Icon size={14} color={color} style={{ flexShrink: 0 }} />
        <span style={{ flex: 1, minWidth: 0, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap", color: stateColor }}>
          {o.label}
        </span>
        {o.state === "done" && <CheckCircle2 size={14} color={stateColor} />}
        {o.state === "failed" && <XCircle size={14} color={stateColor} />}
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 4 }}>
        <span style={{ flex: 1, height: 4, borderRadius: 2, background: "rgba(148,163,184,0.15)", overflow: "hidden" }}>
          <span style={{
            display: "block", height: "100%", width: `${(o.progress ?? 0) * 100}%`,
            background: o.state === "failed" ? "#64748b" : color, transition: "width 0.4s",
          }} />
        </span>
        <span style={{ fontSize: 11, color: o.contested ? "#fca5a5" : "#94a3b8", fontFamily: "ui-monospace, monospace", whiteSpace: "nowrap" }}>
          {o.contested ? "⚔ 爭奪中 · " : ""}{o.detail}
        </span>
      </div>
    </div>
  );
}
