/**
 * 戰況統計 HUD — 頂部置中。
 *
 * 顯示：藍方存活 / 擊毀，紅方存活 / 擊毀，戰役時長
 * Auto-update：訂閱 scenarioStore + 用 interval 補時間刷新
 */
import { useSyncExternalStore, useEffect, useRef, useState } from "react";
import { Shield, Skull, Clock } from "lucide-react";
import { scenarioStore } from "../wargame/scenarioStore";
import { wargameClock } from "../wargame/clock";
import type { SideId } from "../wargame/types";

interface SideStats {
  alive: number;
  killed: number;
  color: string;
  displayName: string;
}

interface Snapshot {
  sides: { id: SideId; stats: SideStats }[];
  tPlus: string;
  unitSig: number;       // 用 units count + events count 作 signature
}

let cached: Snapshot = build();

function build(): Snapshot {
  const state = scenarioStore.getState();
  const alive: Partial<Record<SideId, number>> = {};
  for (const u of Object.values(state.units)) {
    if (u.hpCurrent > 0) alive[u.sideId] = (alive[u.sideId] ?? 0) + 1;
  }
  const killed: Partial<Record<SideId, number>> = {};
  for (const e of state.eventsAll) {
    if (e.kind === "destroyed" && e.targetSideId) {
      killed[e.targetSideId] = (killed[e.targetSideId] ?? 0) + 1;
    }
  }
  const sides = state.scenario.sides
    .filter((s) => s.isHostileTo.length > 0 || s.isPlayer)    // 只顯示參戰陣營
    .map((s) => ({
      id: s.id,
      stats: {
        alive: alive[s.id] ?? 0,
        killed: killed[s.id] ?? 0,
        color: s.colorPrimary,
        displayName: s.displayName,
      },
    }));
  return {
    sides,
    tPlus: wargameClock.getTPlus(),
    unitSig: Object.keys(state.units).length * 1000 + state.eventsAll.length,
  };
}

function getSnapshot(): Snapshot {
  const next = build();
  if (next.unitSig !== cached.unitSig || next.tPlus !== cached.tPlus) {
    cached = next;
  }
  return cached;
}

function subscribe(cb: () => void): () => void {
  const u1 = scenarioStore.subscribe(cb);
  const t = window.setInterval(cb, 500);    // 補 tPlus 變化
  return () => { u1(); window.clearInterval(t); };
}

export function BattleStatsHud() {
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const s = getSnapshot();

  return (
    <div
      style={{
        position: "absolute",
        top: 88,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 22,
        padding: "10px 18px",
        background: "rgba(15, 23, 42, 0.92)",
        backdropFilter: "blur(6px)",
        border: "1px solid rgba(148, 163, 184, 0.3)",
        borderRadius: 8,
        color: "#e2e8f0",
        fontFamily: "ui-sans-serif, system-ui, sans-serif",
        display: "flex",
        alignItems: "center",
        gap: 22,
      }}
    >
      {s.sides.map((side, i) => (
        <div key={side.id} style={{ display: "flex", alignItems: "center", gap: 10 }}>
          {i > 0 && (
            <span style={{ color: "#475569", fontSize: 17, marginRight: 10, fontWeight: 700 }}>VS</span>
          )}
          <Shield size={20} color={side.stats.color} fill={side.stats.color} fillOpacity={0.2} />
          <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.2 }}>
            <span style={{ fontSize: 15, color: "#94a3b8" }}>{side.stats.displayName}</span>
            <span style={{ fontSize: 22, fontWeight: 600, fontFamily: "ui-monospace, monospace", display: "flex", alignItems: "center", gap: 8 }}>
              <PopNumber value={side.stats.alive} color={side.stats.color} />
              <span style={{ color: "#64748b", fontSize: 17, display: "flex", alignItems: "center", gap: 3 }}>
                <Skull size={12} />
                <PopNumber value={side.stats.killed} color="#94a3b8" />
              </span>
            </span>
          </div>
        </div>
      ))}

      <div
        style={{
          paddingLeft: 18,
          borderLeft: "1px solid rgba(148, 163, 184, 0.25)",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <Clock size={16} color="#94a3b8" />
        <div style={{ display: "flex", flexDirection: "column", lineHeight: 1.2 }}>
          <span style={{ fontSize: 15, color: "#94a3b8" }}>戰役時長</span>
          <span style={{ fontSize: 22, fontWeight: 600, fontFamily: "ui-monospace, monospace" }}>
            {s.tPlus}
          </span>
        </div>
      </div>
    </div>
  );
}

/** 數字變化時加 pop 動畫 */
function PopNumber({ value, color }: { value: number; color: string }) {
  const prev = useRef(value);
  const [popping, setPopping] = useState(false);
  useEffect(() => {
    if (value !== prev.current) {
      prev.current = value;
      setPopping(true);
      const t = setTimeout(() => setPopping(false), 400);
      return () => clearTimeout(t);
    }
  }, [value]);
  return (
    <span
      className={popping ? "wg-pop" : ""}
      style={{
        color,
        display: "inline-block",
        transformOrigin: "center",
        minWidth: "1em",
      }}
    >
      {value}
    </span>
  );
}
