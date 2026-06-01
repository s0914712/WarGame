/**
 * Plan Mode 單位調色盤 — 左側面板。
 *
 * - 按 [📋 Plan Mode] 進入；clock 自動暫停
 * - 選陣營（3 顆藥丸）+ 選單位種類（6 種卡片）
 * - 點地圖任意位置 → 放單位
 * - 場景中既有單位：點選後可在 UnitEditorPanel 按「刪除」（Plan Mode 才出現）
 * - [💾 Export]：當前場景下載為 JSON
 */
import { useSyncExternalStore } from "react";
import { ClipboardList, Rocket, Plane, Ship, Anchor, PlaneTakeoff, Radio, Download, X, Shield, ShieldCheck, Radar, Truck, Building2 } from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { editorStore } from "../wargame/editor/editorStore";
import { scenarioStore } from "../wargame/scenarioStore";
import { UNIT_CATALOG } from "../wargame/catalog/units";
import type { SideId, UnitKind } from "../wargame/types";

interface Snapshot {
  mode: string;
  placingKind: UnitKind;
  placingSide: SideId;
  unitCount: number;
  sidesSig: string;
}

let cached: Snapshot = build();

function build(): Snapshot {
  const sides = scenarioStore.getState().scenario.sides;
  return {
    mode: editorStore.getMode(),
    placingKind: editorStore.getPlacingKind(),
    placingSide: editorStore.getPlacingSide(),
    unitCount: Object.keys(scenarioStore.getState().units).length,
    sidesSig: sides.map(s => s.id).join("|"),
  };
}

function getSnapshot(): Snapshot {
  const next = build();
  if (
    next.mode !== cached.mode ||
    next.placingKind !== cached.placingKind ||
    next.placingSide !== cached.placingSide ||
    next.unitCount !== cached.unitCount ||
    next.sidesSig !== cached.sidesSig
  ) {
    cached = next;
  }
  return cached;
}

function subscribe(cb: () => void): () => void {
  const u1 = editorStore.subscribe(cb);
  const u2 = scenarioStore.subscribe(cb);
  return () => { u1(); u2(); };
}

const KIND_OPTIONS: { kind: UnitKind; Icon: LucideIcon }[] = [
  { kind: "missile_launcher", Icon: Rocket },
  { kind: "drone",            Icon: Plane },
  { kind: "ship_surface",     Icon: Ship },
  { kind: "submarine",        Icon: Anchor },
  { kind: "fighter",          Icon: PlaneTakeoff },
  { kind: "radar_station",    Icon: Radio },
  { kind: "sam_coastal",      Icon: Shield },
  { kind: "mobile_radar",     Icon: Radar },
  { kind: "sam_patriot",      Icon: ShieldCheck },
  { kind: "supply_ship",      Icon: Truck },
  { kind: "airbase",          Icon: Building2 },
];

export function UnitPalette({ embedded = false }: { embedded?: boolean } = {}) {
  useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
  const s = getSnapshot();
  const isPlanning = s.mode === "placeUnit";
  const sides = scenarioStore.getState().scenario.sides;

  const handleExport = () => {
    const json = scenarioStore.exportScenarioJson();
    const blob = new Blob([json], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `wargame-scenario-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (!embedded && !isPlanning) {
    // 摺疊狀態：只顯示一顆「進 Plan Mode」按鈕
    return (
      <div style={containerCollapsed}>
        <button onClick={() => editorStore.enterPlaceMode()} className="wg-btn" style={primaryBtn}>
          <ClipboardList size={16} /> Plan Mode
        </button>
      </div>
    );
  }

  return (
    <div style={embedded ? embeddedRoot : containerExpanded}>
      {/* 標題 + Exit（embedded 時 tab 自身即入口，免標題列） */}
      {!embedded && (
      <div style={{
        display: "flex", justifyContent: "space-between", alignItems: "center",
        padding: "10px 14px",
        borderBottom: "1px solid rgba(251, 146, 60, 0.3)",
        background: "rgba(251, 146, 60, 0.15)",
      }}>
        <div style={{ fontWeight: 700, fontSize: 19, color: "#fed7aa", display: "flex", alignItems: "center", gap: 6 }}>
          <ClipboardList size={16} /> Plan Mode
        </div>
        <button onClick={() => editorStore.exitPlaceMode()} className="wg-btn" style={exitBtn}>
          <X size={11} /> 退出
        </button>
      </div>
      )}

      <div style={{ padding: embedded ? "4px 0 12px" : 12, display: "flex", flexDirection: "column", gap: 12 }}>
        {/* 陣營選擇 */}
        <div>
          <div style={labelStyle}>陣營</div>
          <div style={{ display: "flex", gap: 6, marginTop: 6 }}>
            {sides.map((side) => {
              const active = side.id === s.placingSide;
              return (
                <button
                  key={side.id}
                  onClick={() => editorStore.setPlacingSide(side.id)}
                  style={{
                    flex: 1,
                    padding: "6px 8px",
                    borderRadius: 4,
                    border: `1px solid ${active ? side.colorPrimary : "rgba(148, 163, 184, 0.3)"}`,
                    background: active ? side.colorPrimary : "rgba(30, 41, 59, 0.4)",
                    color: active ? "#fff" : "#cbd5e1",
                    fontSize: 16, fontWeight: active ? 600 : 400,
                    cursor: "pointer", fontFamily: "inherit",
                  }}
                >
                  {side.displayName.slice(0, 4)}
                </button>
              );
            })}
          </div>
        </div>

        {/* 單位種類 */}
        <div>
          <div style={labelStyle}>單位種類</div>
          <div style={{
            display: "grid", gridTemplateColumns: "1fr 1fr",
            gap: 6, marginTop: 6,
          }}>
            {KIND_OPTIONS.map(({ kind, Icon }) => {
              const active = kind === s.placingKind;
              const cat = UNIT_CATALOG[kind];
              return (
                <button
                  key={kind}
                  onClick={() => editorStore.setPlacingKind(kind)}
                  className="wg-btn"
                  style={{
                    padding: "10px 8px",
                    borderRadius: 4,
                    border: `1px solid ${active ? "#fb923c" : "rgba(148, 163, 184, 0.25)"}`,
                    background: active ? "rgba(251, 146, 60, 0.25)" : "rgba(30, 41, 59, 0.4)",
                    color: active ? "#fed7aa" : "#cbd5e1",
                    fontSize: 16,
                    cursor: "pointer",
                    fontFamily: "inherit",
                    display: "flex", alignItems: "center", gap: 8,
                  }}
                >
                  <Icon size={16} />
                  {cat.displayName}
                </button>
              );
            })}
          </div>
        </div>

        {/* 操作指示 */}
        <div style={{
          padding: "8px 10px",
          background: "rgba(15, 23, 42, 0.6)",
          border: "1px solid rgba(148, 163, 184, 0.2)",
          borderRadius: 4,
          fontSize: 16, color: "#94a3b8", lineHeight: 1.5,
        }}>
          點地圖任意位置 → 放單位<br/>
          點現有單位 → 編輯屬性<br/>
          點選後在右側 Editor 可刪除
        </div>

        {/* 統計 + Export */}
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div style={{ fontSize: 16, color: "#94a3b8" }}>
            目前場景：{s.unitCount} 個單位
          </div>
          <button onClick={handleExport} className="wg-btn" style={secondaryBtn}>
            <Download size={12} /> 匯出場景 JSON
          </button>
        </div>
      </div>
    </div>
  );
}

const embeddedRoot: React.CSSProperties = {
  width: "100%",
  color: "#e2e8f0",
  fontFamily: "ui-sans-serif, system-ui, sans-serif",
};

const containerCollapsed: React.CSSProperties = {
  position: "absolute",
  top: 220,
  left: 16,
  zIndex: 22,
};

const containerExpanded: React.CSSProperties = {
  position: "absolute",
  top: 220,
  left: 16,
  zIndex: 22,
  width: 260,
  background: "rgba(15, 23, 42, 0.94)",
  backdropFilter: "blur(8px)",
  border: "2px solid #fb923c",
  borderRadius: 8,
  color: "#e2e8f0",
  fontFamily: "ui-sans-serif, system-ui, sans-serif",
  boxShadow: "0 10px 30px rgba(0,0,0,0.4)",
};

const primaryBtn: React.CSSProperties = {
  padding: "10px 16px",
  background: "rgba(15, 23, 42, 0.92)",
  color: "#fed7aa",
  border: "1px solid rgba(251, 146, 60, 0.5)",
  borderRadius: 8,
  fontSize: 17, fontWeight: 600,
  cursor: "pointer",
  fontFamily: "ui-sans-serif, system-ui, sans-serif",
  boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
};

const secondaryBtn: React.CSSProperties = {
  padding: "8px 12px",
  background: "rgba(148, 163, 184, 0.15)",
  color: "#cbd5e1",
  border: "1px solid rgba(148, 163, 184, 0.3)",
  borderRadius: 4,
  fontSize: 16, cursor: "pointer",
  fontFamily: "inherit",
  display: "flex", alignItems: "center", gap: 6, justifyContent: "center",
};

const exitBtn: React.CSSProperties = {
  padding: "4px 10px",
  background: "transparent",
  color: "#94a3b8",
  border: "1px solid rgba(148, 163, 184, 0.3)",
  borderRadius: 4,
  fontSize: 15, cursor: "pointer", fontFamily: "inherit",
  display: "flex", alignItems: "center", gap: 4,
};

const labelStyle: React.CSSProperties = {
  fontSize: 15, color: "#94a3b8", fontWeight: 600,
};
