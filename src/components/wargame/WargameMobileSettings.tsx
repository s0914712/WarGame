/**
 * 行動版「設定」面板內容 — 原右側抽屜的次要控制，改為底部 dock 內的流式內容。
 * 場景 / 底圖 / 視角 POV / 錄製回放 + 動作鈕（LLM・簡報・教學・說明・Demo・返回主選單）。
 */
import type { Map as MapboxMap } from "mapbox-gl";
import { Bot, Swords, GraduationCap, HelpCircle, Monitor, Menu } from "lucide-react";
import { ScenarioPicker } from "../ScenarioPicker";
import { MapStyleSwitcher } from "../MapStyleSwitcher";
import { PovSwitcher } from "../PovSwitcher";
import { ReplayPanel } from "../ReplayPanel";
import { uiStore } from "../../wargame/uiStore";
import { launchTutorial } from "../TutorialOverlay";

interface Props {
  map: MapboxMap | null;
  styleId: string;
  onStyleChange: (id: string) => void;
  onOpenLlm: () => void;
  onOpenBriefing: () => void;
  onOpenCheat: () => void;
}

export function WargameMobileSettings({
  map, styleId, onStyleChange, onOpenLlm, onOpenBriefing, onOpenCheat,
}: Props) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 14, paddingBottom: 4 }}>
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
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <ActionBtn Icon={Bot} label="LLM 介接" onClick={onOpenLlm} primary />
          <ActionBtn Icon={Swords} label="場景簡報" onClick={onOpenBriefing} />
          <ActionBtn Icon={GraduationCap} label="教學導覽" onClick={launchTutorial} />
          <ActionBtn Icon={HelpCircle} label="介面說明" onClick={onOpenCheat} />
          <ActionBtn Icon={Monitor} label="Demo Mode" onClick={() => uiStore.setDemoMode(true)} />
          <ActionBtn Icon={Menu} label="返回主選單" onClick={() => uiStore.setLandingOpen(true)} />
        </div>
      </Section>
    </div>
  );
}

function Section({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <div style={{ fontSize: 12, fontWeight: 600, color: "#94a3b8", letterSpacing: 0.5 }}>{label}</div>
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
        minHeight: 40,
        width: "100%",
        borderRadius: 8,
        border: primary ? "1px solid rgba(147,197,253,0.5)" : "1px solid rgba(148,163,184,0.3)",
        background: primary ? "rgba(59,130,246,0.9)" : "rgba(30,41,59,0.5)",
        color: primary ? "#fff" : "#cbd5e1",
        fontSize: 13,
        fontWeight: 600,
        cursor: "pointer",
        fontFamily: "ui-sans-serif, system-ui, sans-serif",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        padding: "0 8px",
      }}
    >
      <Icon size={15} /> {label}
    </button>
  );
}
