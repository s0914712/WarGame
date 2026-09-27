/**
 * 戰報面板 — 滾動式 EngagementEvent log。
 *
 * 位置：左下角，可摺疊。
 * Auto-scroll：新事件出現時自動捲到底。
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Eye, Crosshair, Zap, MinusCircle, Skull, Shield, ScrollText, ChevronUp, ChevronDown } from "lucide-react";
import { scenarioStore } from "../wargame/scenarioStore";
import { viewStore } from "../wargame/viewStore";
import { formatTPlus } from "../wargame/clock";
import type { EngagementEvent, EngagementEventKind, UnitId } from "../wargame/types";

const MAX_RECENT = 50;

type LogFilter = "all" | "combat" | "detection";

const FILTERS: { id: LogFilter; label: string }[] = [
  { id: "all", label: "全部" },
  { id: "combat", label: "交戰" },
  { id: "detection", label: "偵測" },
];

function matchesFilter(e: EngagementEvent, f: LogFilter): boolean {
  if (f === "all") return true;
  return f === "detection" ? e.kind === "detection" : e.kind !== "detection";
}

/** 目前視角看得到的存活單位（己方 / 上帝視角 / 已偵測敵方）才可點選 */
function selectableUnit(id: UnitId | undefined): UnitId | null {
  if (!id) return null;
  const u = scenarioStore.getState().units[id];
  if (!u || u.hpCurrent <= 0) return null;
  const pov = viewStore.getActiveSideId();
  if (pov == null || u.sideId === pov) return id;
  return (u.detectedBy[pov] ?? "hidden") !== "hidden" ? id : null;
}

/** 事件點擊的目標單位：目標優先（多半是想看的那方），不可見再退回攻擊方 */
function focusUnitFor(e: EngagementEvent): UnitId | null {
  return selectableUnit(e.targetId) ?? selectableUnit(e.attackerId);
}

interface Snapshot {
  count: number;
  lastId: string;
  selectedId: string | null;
}

let cached: Snapshot = { count: 0, lastId: "", selectedId: null };

function getSnapshot(): Snapshot {
  const all = scenarioStore.getState().eventsAll;
  const next: Snapshot = {
    count: all.length,
    lastId: all.length > 0 ? all[all.length - 1]!.id : "",
    selectedId: scenarioStore.getSelectedUnitId(),
  };
  if (next.count !== cached.count || next.lastId !== cached.lastId || next.selectedId !== cached.selectedId) {
    cached = next;
  }
  return cached;
}

/**
 * embedded：行動版 sheet 內（高度交給 sheet）
 * fill：桌面底部控制台欄位內 — 填滿父容器高度，內部捲動
 */
export function EngagementLog({ embedded = false, fill = false }: { embedded?: boolean; fill?: boolean } = {}) {
  useSyncExternalStore(scenarioStore.subscribe, getSnapshot, getSnapshot);
  const [collapsed, setCollapsed] = useState(false);
  const [filter, setFilter] = useState<LogFilter>("all");
  const bodyRef = useRef<HTMLDivElement>(null);

  const events = scenarioStore.getState().eventsAll;
  // 篩選只在桌面控制台（fill）提供；其他版面維持全部
  const activeFilter: LogFilter = fill ? filter : "all";
  const recent = (activeFilter === "all" ? events : events.filter((e) => matchesFilter(e, activeFilter))).slice(-MAX_RECENT);

  // embedded（行動版 sheet 內）永遠展開，高度交給 sheet
  const isCollapsed = embedded || fill ? false : collapsed;

  useEffect(() => {
    if (!isCollapsed && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [events.length, isCollapsed, activeFilter]);

  return (
    <div
      style={fill ? {
        height: "100%",
        display: "flex",
        flexDirection: "column",
        color: "#e2e8f0",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      } : embedded ? {
        width: "100%",
        color: "#e2e8f0",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
      } : {
        position: "absolute",
        bottom: 64,
        left: 16,
        zIndex: 25,
        width: 420,
        maxHeight: isCollapsed ? 40 : 340,
        background: "rgba(15, 23, 42, 0.92)",
        backdropFilter: "blur(6px)",
        border: "1px solid rgba(148, 163, 184, 0.3)",
        borderRadius: 8,
        color: "#e2e8f0",
        fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
        overflow: "hidden",
        transition: "max-height 0.2s",
      }}
    >
      {!embedded && !fill && (
      <div
        onClick={() => setCollapsed((v) => !v)}
        style={{
          padding: "10px 14px",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          cursor: "pointer",
          borderBottom: isCollapsed ? "none" : "1px solid rgba(148, 163, 184, 0.15)",
          fontSize: 19,
          fontWeight: 600,
        }}
      >
        <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
          <ScrollText size={16} />
          戰報 ({events.length})
        </span>
        {isCollapsed ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
      </div>
      )}

      {fill && (
        <div style={{ display: "flex", gap: 4, padding: "0 12px 4px", fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
          {FILTERS.map((f) => {
            const n = f.id === "all" ? events.length : events.reduce((acc, e) => acc + (matchesFilter(e, f.id) ? 1 : 0), 0);
            const on = filter === f.id;
            return (
              <button key={f.id} className="wg-btn" onClick={() => setFilter(f.id)}
                style={{
                  padding: "1px 8px", fontSize: 12, borderRadius: 10, cursor: "pointer",
                  border: `1px solid ${on ? "rgba(96,165,250,0.7)" : "rgba(148,163,184,0.25)"}`,
                  background: on ? "rgba(59,130,246,0.25)" : "transparent",
                  color: on ? "#e2e8f0" : "#94a3b8",
                }}>
                {f.label} <span style={{ fontFamily: "ui-monospace, monospace", opacity: 0.75 }}>{n}</span>
              </button>
            );
          })}
        </div>
      )}

      {!isCollapsed && (
        <div
          ref={bodyRef}
          style={{
            maxHeight: embedded || fill ? "none" : 296,
            ...(fill ? { flex: 1, minHeight: 0 } : {}),
            overflowY: "auto",
            padding: fill ? "4px 12px 8px" : "8px 12px",
            fontSize: fill ? 14 : 17,
            lineHeight: 1.6,
          }}
        >
          {recent.length === 0 && (
            <div style={{ color: "#64748b", fontStyle: "italic", padding: "6px 0" }}>
              還沒有戰鬥事件
            </div>
          )}
          {recent.map((e, i) => (
            // 只對「新」事件 (列表尾端 3 筆) 套 slide-in，避免捲動時所有舊事件亂動
            <EventLine key={e.id} ev={e} animate={i >= recent.length - 3} />
          ))}
        </div>
      )}
    </div>
  );
}

function EventLine({ ev, animate }: { ev: EngagementEvent; animate: boolean }) {
  const color = colorFor(ev.kind);
  const Icon = iconFor(ev.kind);
  const focusId = focusUnitFor(ev);
  const selected = focusId != null && focusId === scenarioStore.getSelectedUnitId();
  const kill = ev.kind === "destroyed";
  return (
    <div
      className={`wg-log-line${animate ? " wg-fade-in" : ""}${focusId ? " wg-log-clickable" : ""}`}
      onClick={focusId ? () => scenarioStore.setSelectedUnitId(focusId) : undefined}
      title={focusId ? "點擊選取並跟隨此單位" : undefined}
      style={{
        display: "flex", gap: 8, padding: "0 4px 3px",
        alignItems: "center",
        borderRadius: 3,
        borderLeft: `2px solid ${selected ? "#60a5fa" : kill ? "rgba(248,113,113,0.7)" : "transparent"}`,
        background: kill ? "rgba(248,113,113,0.08)" : undefined,
        fontWeight: kill ? 700 : undefined,
      }}
    >
      <span style={{ color: "#64748b", flexShrink: 0, minWidth: 92 }}>
        {formatTPlus(ev.simAtSec)}
      </span>
      <Icon size={13} color={color} style={{ flexShrink: 0 }} />
      <span style={{ color: "#cbd5e1", flex: 1 }}>{ev.message}</span>
    </div>
  );
}

function colorFor(k: EngagementEventKind): string {
  switch (k) {
    case "detection": return "#facc15";
    case "weapon_release": return "#fb923c";
    case "hit": return "#86efac";
    case "miss": return "#94a3b8";
    case "destroyed": return "#fca5a5";
    case "intercept": return "#38bdf8";
  }
}

function iconFor(k: EngagementEventKind) {
  switch (k) {
    case "detection": return Eye;
    case "weapon_release": return Crosshair;
    case "hit": return Zap;
    case "miss": return MinusCircle;
    case "destroyed": return Skull;
    case "intercept": return Shield;
  }
}
