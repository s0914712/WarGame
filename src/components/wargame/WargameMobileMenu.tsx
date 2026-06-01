/**
 * 行動版選單抽屜 — 折入桌面版散落的次要控制。
 *
 * 場景 / 底圖 / 視角 POV / 錄製回放 + 動作鈕（LLM・簡報・教學・說明・Demo・返回主選單）。
 * 由頂部列 ☰ 開啟；點 backdrop 或選任一動作後關閉。
 */
import type { Map as MapboxMap } from "mapbox-gl";
import { Bot, Swords, GraduationCap, HelpCircle, Monitor, Menu, X } from "lucide-react";
import { ScenarioPicker } from "../ScenarioPicker";
import { MapStyleSwitcher } from "../MapStyleSwitcher";
import { PovSwitcher } from "../PovSwitcher";
import { ReplayPanel } from "../ReplayPanel";
import { uiStore } from "../../wargame/uiStore";
import { launchTutorial } from "../TutorialOverlay";

interface Props {
  open: boolean;
  onClose: () => void;
  map: MapboxMap | null;
  styleId: string;
  onStyleChange: (id: string) => void;
  onOpenLlm: () => void;
  onOpenBriefing: () => void;
  onOpenCheat: () => void;
}

export function WargameMobileMenu({
  open, onClose, map, styleId, onStyleChange, onOpenLlm, onOpenBriefing, onOpenCheat,
}: Props) {
  if (!open) return null;

  const act = (fn: () => void) => () => { onClose(); fn(); };

  return (
    <>
      {/* backdrop */}
      <div
        onClick={onClose}
        style={{ position: "fixed", inset: 0, zIndex: 34, background: "rgba(0,0,0,0.5)" }}
      />
      {/* drawer */}
      <div
        className="wg-fade-in"
        style={{
          position: "fixed",
          top: 0,
          right: 0,
          bottom: 0,
          zIndex: 35,
          width: "min(340px, 86vw)",
          background: "rgba(2, 6, 23, 0.97)",
          backdropFilter: "blur(16px)",
          WebkitBackdropFilter: "blur(16px)",
          borderLeft: "1px solid rgba(148, 163, 184, 0.2)",
          boxShadow: "-8px 0 30px rgba(0,0,0,0.5)",
          color: "#e2e8f0",
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
          display: "flex",
          flexDirection: "column",
          paddingTop: "env(safe-area-inset-top, 0px)",
          overflowY: "auto",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "12px 16px", borderBottom: "1px solid rgba(148,163,184,0.15)" }}>
          <span style={{ fontWeight: 700, fontSize: 18, display: "flex", alignItems: "center", gap: 8 }}>
            <Menu size={16} /> 控制選單
          </span>
          <button onClick={onClose} className="wg-btn" aria-label="關閉" style={{ width: 36, height: 36, borderRadius: 8, background: "transparent", border: "none", color: "#94a3b8", cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>
            <X size={20} />
          </button>
        </div>

        <div style={{ padding: 16, display: "flex", flexDirection: "column", gap: 18 }}>
          <Section label="場景">
            <ScenarioPicker map={map} isMobile embedded />
          </Section>

          <Section label="底圖">
            <MapStyleSwitcher selectedId={styleId} onChange={onStyleChange} embedded />
          </Section>

          <Section label="視角 POV">
            <PovSwitcher embedded />
          </Section>

          <Section label="錄製 / 回放">
            <ReplayPanel embedded />
          </Section>

          <Section label="動作">
            <ActionBtn Icon={Bot} label="LLM 介接" onClick={act(onOpenLlm)} primary />
            <ActionBtn Icon={Swords} label="場景簡報" onClick={act(onOpenBriefing)} />
            <ActionBtn Icon={GraduationCap} label="UI 教學導覽" onClick={act(launchTutorial)} />
            <ActionBtn Icon={HelpCircle} label="介面說明" onClick={act(onOpenCheat)} />
            <ActionBtn Icon={Monitor} label="Demo Mode" onClick={act(() => uiStore.setDemoMode(true))} />
            <ActionBtn Icon={Menu} label="返回主選單" onClick={act(() => uiStore.setLandingOpen(true))} />
          </Section>
        </div>
      </div>
    </>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      <div style={{ fontSize: 14, fontWeight: 600, color: "#94a3b8", letterSpacing: 0.5 }}>{label}</div>
      {children}
    </div>
  );
}

function ActionBtn({ Icon, label, onClick, primary = false }: {
  Icon: typeof Bot; label: string; onClick: () => void; primary?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className="wg-btn"
      style={{
        minHeight: 46,
        width: "100%",
        borderRadius: 8,
        border: primary ? "1px solid rgba(147,197,253,0.5)" : "1px solid rgba(148,163,184,0.3)",
        background: primary ? "rgba(59,130,246,0.9)" : "rgba(30,41,59,0.5)",
        color: primary ? "#fff" : "#cbd5e1",
        fontSize: 17,
        fontWeight: 600,
        cursor: "pointer",
        fontFamily: "inherit",
        display: "flex",
        alignItems: "center",
        gap: 10,
        padding: "0 14px",
      }}
    >
      <Icon size={17} /> {label}
    </button>
  );
}
