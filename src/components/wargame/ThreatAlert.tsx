/**
 * 來襲警示（頂部置中，頂部列下方）：目前視角己方單位有攻擊彈正飛向它時出現。
 *
 *   ⚠ 來襲 3 發 → 臺生、中海        點擊 = 依序選取受威脅單位（相機跟隨）
 *
 * 給玩家反應窗口：轉向 / 規避 / 改 ROE。上帝視角不顯示（無「己方」）。
 */
import { useRef, useSyncExternalStore } from "react";
import { AlertTriangle } from "lucide-react";
import { scenarioStore } from "../../wargame/scenarioStore";
import { viewStore } from "../../wargame/viewStore";

interface Threat { count: number; targets: { id: string; callsign: string; n: number }[] }

function compute(): Threat {
  const pov = viewStore.getActiveSideId();
  const state = scenarioStore.getState();
  if (!pov) return { count: 0, targets: [] };
  const byTarget = new Map<string, number>();
  for (const m of state.missiles) {
    if (m.role === "interceptor") continue;
    const t = state.units[m.targetId];
    if (t && t.sideId === pov && t.hpCurrent > 0) byTarget.set(t.id, (byTarget.get(t.id) ?? 0) + 1);
  }
  let count = 0;
  const targets = [...byTarget].map(([id, n]) => { count += n; return { id, callsign: state.units[id]!.callsign, n }; });
  targets.sort((a, b) => b.n - a.n || a.callsign.localeCompare(b.callsign));
  return { count, targets };
}

function sig(): string {
  const t = compute();
  return t.targets.map((x) => `${x.id}:${x.n}`).join(",");
}

function subscribe(cb: () => void): () => void {
  const a = scenarioStore.subscribe(cb);
  const b = viewStore.subscribe(cb);
  return () => { a(); b(); };
}

export function ThreatAlert({ top }: { top: number }) {
  useSyncExternalStore(subscribe, sig, sig);
  const cursor = useRef(0);
  const threat = compute();
  if (threat.count === 0) return null;

  const names = threat.targets.slice(0, 3).map((t) => (t.n > 1 ? `${t.callsign}×${t.n}` : t.callsign)).join("、")
    + (threat.targets.length > 3 ? ` 等 ${threat.targets.length} 單位` : "");

  const selectNext = () => {
    const t = threat.targets[cursor.current % threat.targets.length];
    cursor.current++;
    if (t) scenarioStore.setSelectedUnitId(t.id);
  };

  // 外層負責置中定位（wg-btn 的 :active scale 會覆蓋 transform，不能放同一元素）
  return (
    <div style={{ position: "absolute", top, left: "50%", transform: "translateX(-50%)", zIndex: 27 }}>
    <button onClick={selectNext} className="wg-btn wg-glow-critical" title="點擊依序選取受威脅單位"
      style={{
        display: "flex", alignItems: "center", gap: 8, padding: "6px 14px",
        borderRadius: 8, border: "1px solid rgba(239, 68, 68, 0.7)",
        background: "rgba(69, 10, 10, 0.92)", color: "#fecaca",
        fontFamily: "ui-sans-serif, system-ui, sans-serif", fontSize: 14, fontWeight: 600,
        cursor: "pointer", whiteSpace: "nowrap", maxWidth: "min(560px, 90vw)", overflow: "hidden",
      }}>
      <AlertTriangle size={16} color="#f87171" className="wg-blink" style={{ flexShrink: 0 }} />
      <span style={{ color: "#fca5a5" }}>來襲 {threat.count} 發</span>
      <span style={{ color: "#fecaca", overflow: "hidden", textOverflow: "ellipsis" }}>→ {names}</span>
    </button>
    </div>
  );
}
