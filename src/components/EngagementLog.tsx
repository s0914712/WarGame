/**
 * 戰報面板 — 滾動式 EngagementEvent log。
 *
 * 位置：左下角，可摺疊。
 * Auto-scroll：新事件出現時自動捲到底。
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Eye, Crosshair, Zap, MinusCircle, Skull, ScrollText, ChevronUp, ChevronDown } from "lucide-react";
import { scenarioStore } from "../wargame/scenarioStore";
import { wargameClock, formatTPlus } from "../wargame/clock";
import type { EngagementEvent, EngagementEventKind } from "../wargame/types";

const MAX_RECENT = 50;

interface Snapshot {
  count: number;
  lastId: string;
}

let cached: Snapshot = { count: 0, lastId: "" };

function getSnapshot(): Snapshot {
  const all = scenarioStore.getState().eventsAll;
  const next: Snapshot = {
    count: all.length,
    lastId: all.length > 0 ? all[all.length - 1]!.id : "",
  };
  if (next.count !== cached.count || next.lastId !== cached.lastId) {
    cached = next;
  }
  return cached;
}

export function EngagementLog({ embedded = false }: { embedded?: boolean } = {}) {
  useSyncExternalStore(scenarioStore.subscribe, getSnapshot, getSnapshot);
  const [collapsed, setCollapsed] = useState(false);
  const bodyRef = useRef<HTMLDivElement>(null);

  const events = scenarioStore.getState().eventsAll;
  const recent = events.slice(-MAX_RECENT);

  // embedded（行動版 sheet 內）永遠展開，高度交給 sheet
  const isCollapsed = embedded ? false : collapsed;

  useEffect(() => {
    if (!isCollapsed && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [events.length, isCollapsed]);

  return (
    <div
      style={embedded ? {
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
      {!embedded && (
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

      {!isCollapsed && (
        <div
          ref={bodyRef}
          style={{
            maxHeight: embedded ? "none" : 296,
            overflowY: "auto",
            padding: "8px 12px",
            fontSize: 17,
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
  return (
    <div
      className={animate ? "wg-fade-in" : ""}
      style={{
        display: "flex", gap: 8, paddingBottom: 3,
        alignItems: "center",
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
  }
}

function iconFor(k: EngagementEventKind) {
  switch (k) {
    case "detection": return Eye;
    case "weapon_release": return Crosshair;
    case "hit": return Zap;
    case "miss": return MinusCircle;
    case "destroyed": return Skull;
  }
}

// 避免 unused import warning
void wargameClock;
