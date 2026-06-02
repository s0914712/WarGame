/**
 * 開頭主選單 — 三選一：
 *   - 戰役模式：選場景 + 選陣營（藍 / 紅 / 觀察）→ 進遊戲
 *   - Plan Mode：載空場景 + 自動進入放置模式
 *   - 介紹：跑教學
 *
 * 預設首次開頁顯示；遊戲內可從「返回主選單」按鈕重新打開。
 */
import { useState, useSyncExternalStore } from "react";
import type { Map as MapboxMap } from "mapbox-gl";
import { useIsMobile } from "../hooks/useIsMobile";
import {
  Swords, ClipboardList, GraduationCap, ChevronRight, Globe,
  ArrowLeft, Play,
} from "lucide-react";
import { uiStore } from "../wargame/uiStore";
import { scenarioStore } from "../wargame/scenarioStore";
import { viewStore, type ActiveView } from "../wargame/viewStore";
import { editorStore } from "../wargame/editor/editorStore";
import { wargameClock } from "../wargame/clock";
import { SCENARIO_REGISTRY } from "../wargame/scenarios/registry";
import { EMPTY_SCENARIO } from "../wargame/scenarios/empty";
import { SIDE_COLORS } from "../wargame/symbology/sideColors";
import { launchTutorial } from "./TutorialOverlay";

interface Props {
  map: MapboxMap | null;
}

type Pane = "main" | "campaign";

function isOpen() { return uiStore.isLandingOpen(); }

export function LandingScreen({ map }: Props) {
  const open = useSyncExternalStore(uiStore.subscribe, isOpen, isOpen);
  const { isMobile } = useIsMobile();
  const [pane, setPane] = useState<Pane>("main");
  const [selectedScenarioId, setSelectedScenarioId] = useState<string | null>(null);
  const [selectedSide, setSelectedSide] = useState<ActiveView>("blue");

  if (!open) return null;

  // ── 進入戰役 ──
  const startCampaign = () => {
    const entry = SCENARIO_REGISTRY.find((e) => e.scenario.id === selectedScenarioId);
    if (!entry) return;
    wargameClock.reset();
    scenarioStore.loadScenario(entry.scenario);
    viewStore.setActiveView(selectedSide);
    flyToScenario(map, entry.scenario);
    uiStore.setLandingOpen(false);
    // briefing modal 會自動跳出（因 scenario id 不是 "empty"）
  };

  // ── 進入 Plan Mode ──
  const startPlanMode = () => {
    wargameClock.reset();
    scenarioStore.loadScenario(EMPTY_SCENARIO);
    viewStore.setActiveView("blue");
    uiStore.setLandingOpen(false);
    // 進放置模式（會自動暫停 clock）
    setTimeout(() => editorStore.enterPlaceMode(), 50);
  };

  // ── 看教學 ──
  const startTutorial = () => {
    uiStore.setLandingOpen(false);
    setTimeout(() => launchTutorial(), 100);
  };

  return (
    <div
      style={{
        position: "fixed", inset: 0, zIndex: 180,
        background: "radial-gradient(circle at 50% 30%, rgba(30, 41, 59, 0.97), rgba(2, 6, 23, 0.99))",
        display: "flex", alignItems: "center", justifyContent: "center",
        fontFamily: "ui-sans-serif, system-ui, sans-serif",
        color: "#e2e8f0",
      }}
    >
      <div
        className="wg-fade-in"
        style={isMobile ? {
          width: "100vw",
          height: "100dvh",
          background: "rgba(15, 23, 42, 0.96)",
          borderRadius: 0,
          padding: 0,
          overflow: "hidden",
          display: "flex", flexDirection: "column",
          paddingTop: "env(safe-area-inset-top, 0px)",
          paddingBottom: "env(safe-area-inset-bottom, 0px)",
        } : {
          width: "min(1280px, 88vw)",
          minWidth: "min(75vw, 1280px)",
          height: "min(820px, 86vh)",
          minHeight: "min(75vh, 820px)",
          background: "rgba(15, 23, 42, 0.96)",
          border: "1px solid rgba(59, 130, 246, 0.3)",
          borderRadius: 16,
          padding: 0,
          overflow: "hidden",
          boxShadow: "0 30px 80px rgba(0,0,0,0.7), 0 0 0 1px rgba(59, 130, 246, 0.15)",
          display: "flex", flexDirection: "column",
        }}
      >
        {/* Header */}
        <div style={{
          padding: isMobile ? "18px 18px 14px" : "40px 48px 28px",
          background: "linear-gradient(135deg, rgba(59, 130, 246, 0.18), transparent)",
          borderBottom: "1px solid rgba(148, 163, 184, 0.15)",
        }}>
          <div style={{ fontSize: isMobile ? 12 : 17, color: "#60a5fa", letterSpacing: isMobile ? 2 : 3, fontWeight: 600 }}>
            WARGAME PLATFORM
          </div>
          <div style={{ fontSize: isMobile ? 24 : 42, fontWeight: 800, marginTop: isMobile ? 4 : 8, letterSpacing: 1 }}>
            台灣兵棋推演平台
          </div>
          <div style={{ fontSize: isMobile ? 13 : 20, color: "#94a3b8", marginTop: isMobile ? 4 : 8 }}>
            Mini Taiwan Pulse · Wargame Edition
          </div>
        </div>

        {/* Body */}
        <div style={{ padding: isMobile ? "16px 16px" : "32px 48px", overflowY: "auto", flex: 1 }}>
          {pane === "main" && (
            <MainPane
              isMobile={isMobile}
              onCampaign={() => setPane("campaign")}
              onPlanMode={startPlanMode}
              onTutorial={startTutorial}
            />
          )}
          {pane === "campaign" && (
            <CampaignPane
              isMobile={isMobile}
              selectedScenarioId={selectedScenarioId}
              setSelectedScenarioId={setSelectedScenarioId}
              selectedSide={selectedSide}
              setSelectedSide={setSelectedSide}
              onBack={() => setPane("main")}
              onStart={startCampaign}
            />
          )}
        </div>
      </div>
    </div>
  );
}

// ── 主選單 ──
function MainPane({ isMobile, onCampaign, onPlanMode, onTutorial }: {
  isMobile: boolean; onCampaign: () => void; onPlanMode: () => void; onTutorial: () => void;
}) {
  const iconSize = isMobile ? 28 : 56;
  return (
    <div style={{
      display: "flex", flexDirection: "column", gap: isMobile ? 12 : 20,
      height: "100%", justifyContent: "center",
    }}>
      <BigChoice
        isMobile={isMobile}
        icon={<Swords size={iconSize} color="#fbbf24" />}
        title="戰役模式"
        desc="挑選 5 個預設場景之一，選擇扮演的陣營（藍方 ROC / 紅方 PLA / 全局觀察），進入推演。"
        accent="#fbbf24"
        onClick={onCampaign}
      />
      <BigChoice
        isMobile={isMobile}
        icon={<ClipboardList size={iconSize} color="#fb923c" />}
        title="Plan Mode（自由建立）"
        desc="從空白戰場開始，自由放置 9 種兵棋單位、設定屬性、規劃航線。可匯出為 JSON 場景。"
        accent="#fb923c"
        onClick={onPlanMode}
      />
      <BigChoice
        isMobile={isMobile}
        icon={<GraduationCap size={iconSize} color="#60a5fa" />}
        title="介紹 / 教學"
        desc="8 步 walkthrough 帶你看完所有 UI 元素：時鐘 / 戰況 / Plan Mode / LLM 介接 等。"
        accent="#60a5fa"
        onClick={onTutorial}
      />
    </div>
  );
}

function BigChoice({ isMobile, icon, title, desc, accent, onClick }: {
  isMobile: boolean; icon: React.ReactNode; title: string; desc: string; accent: string; onClick: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className="wg-btn"
      style={{
        display: "flex", alignItems: "center", gap: isMobile ? 12 : 28,
        padding: isMobile ? "14px 14px" : "28px 32px",
        background: "rgba(30, 41, 59, 0.6)",
        border: `1px solid ${accent}40`,
        borderLeft: `${isMobile ? 4 : 6}px solid ${accent}`,
        borderRadius: 10,
        color: "#e2e8f0",
        cursor: "pointer",
        fontFamily: "inherit",
        textAlign: "left",
        transition: "transform 0.15s, background 0.15s, border-color 0.15s",
      }}
    >
      <div style={{ flexShrink: 0 }}>{icon}</div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ fontSize: isMobile ? 16 : 36, fontWeight: 700, color: accent, marginBottom: isMobile ? 3 : 8 }}>
          {title}
        </div>
        <div style={{ fontSize: isMobile ? 12 : 20, color: "#cbd5e1", lineHeight: isMobile ? 1.5 : 1.7 }}>
          {desc}
        </div>
      </div>
      <ChevronRight size={isMobile ? 18 : 28} color="#64748b" style={{ flexShrink: 0 }} />
    </button>
  );
}

// ── 戰役選單 ──
function CampaignPane({
  isMobile,
  selectedScenarioId, setSelectedScenarioId,
  selectedSide, setSelectedSide,
  onBack, onStart,
}: {
  isMobile: boolean;
  selectedScenarioId: string | null;
  setSelectedScenarioId: (id: string) => void;
  selectedSide: ActiveView;
  setSelectedSide: (s: ActiveView) => void;
  onBack: () => void;
  onStart: () => void;
}) {
  const selectedEntry = SCENARIO_REGISTRY.find((e) => e.scenario.id === selectedScenarioId);
  const availableSides = selectedEntry
    ? selectedEntry.scenario.sides.filter((s) => s.isHostileTo.length > 0 || s.isPlayer)
    : [];

  return (
    <div>
      <button
        onClick={onBack}
        className="wg-btn"
        style={{
          background: "transparent", border: "none",
          color: "#94a3b8", fontSize: 16, cursor: "pointer",
          display: "flex", alignItems: "center", gap: 4,
          marginBottom: 14,
        }}
      >
        <ArrowLeft size={14} /> 回主選單
      </button>

      <div style={{
        fontSize: 15, color: "#60a5fa", letterSpacing: 1, fontWeight: 600,
        marginBottom: 8,
      }}>
        第一步 · 選擇場景
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
        {SCENARIO_REGISTRY.map((entry) => {
          const active = entry.scenario.id === selectedScenarioId;
          return (
            <button
              key={entry.scenario.id}
              onClick={() => setSelectedScenarioId(entry.scenario.id)}
              className="wg-btn"
              style={{
                padding: "12px 16px",
                background: active ? "rgba(59, 130, 246, 0.2)" : "rgba(30, 41, 59, 0.5)",
                border: `1px solid ${active ? "#3b82f6" : "rgba(148, 163, 184, 0.2)"}`,
                borderRadius: 6,
                color: "#e2e8f0",
                cursor: "pointer",
                fontFamily: "inherit",
                textAlign: "left",
              }}
            >
              <div style={{
                fontSize: isMobile ? 15 : 19, fontWeight: 600,
                color: active ? "#60a5fa" : "#e2e8f0",
                display: "flex", alignItems: "center", gap: 8,
              }}>
                {entry.scenario.displayName}
                {entry.tags?.map((t) => (
                  <span key={t} style={{
                    fontSize: 13, padding: "1px 6px",
                    background: "rgba(59, 130, 246, 0.15)",
                    color: "#93c5fd",
                    borderRadius: 3,
                    fontFamily: "ui-monospace, monospace",
                  }}>{t}</span>
                ))}
              </div>
              <div style={{ fontSize: 15, color: "#94a3b8", marginTop: 4 }}>
                {entry.shortDescription}
              </div>
            </button>
          );
        })}
      </div>

      {selectedEntry && (
        <>
          <div style={{
            fontSize: 15, color: "#60a5fa", letterSpacing: 1, fontWeight: 600,
            marginBottom: 8,
          }}>
            第二步 · 扮演陣營
          </div>
          <div style={{ display: "flex", gap: 8, marginBottom: 20 }}>
            {availableSides.map((s) => {
              const c = SIDE_COLORS[s.id].primary;
              const active = s.id === selectedSide;
              return (
                <button
                  key={s.id}
                  onClick={() => setSelectedSide(s.id)}
                  className="wg-btn"
                  style={{
                    flex: 1,
                    padding: "12px 10px",
                    background: active ? c : "rgba(30, 41, 59, 0.5)",
                    border: `1px solid ${active ? c : "rgba(148, 163, 184, 0.3)"}`,
                    borderRadius: 6,
                    color: active ? "#fff" : "#cbd5e1",
                    cursor: "pointer",
                    fontFamily: "inherit",
                    fontSize: isMobile ? 14 : 17, fontWeight: active ? 700 : 500,
                    display: "flex", alignItems: "center", gap: 8, justifyContent: "center",
                  }}
                >
                  <span style={{
                    width: 10, height: 10, borderRadius: "50%",
                    background: c,
                    boxShadow: active ? `0 0 8px ${c}` : "none",
                  }} />
                  {s.displayName}
                </button>
              );
            })}
            <button
              onClick={() => setSelectedSide("spectator")}
              className="wg-btn"
              style={{
                flex: 1,
                padding: "12px 10px",
                background: selectedSide === "spectator" ? "#475569" : "rgba(30, 41, 59, 0.5)",
                border: `1px solid ${selectedSide === "spectator" ? "#94a3b8" : "rgba(148, 163, 184, 0.3)"}`,
                borderRadius: 6,
                color: selectedSide === "spectator" ? "#fff" : "#cbd5e1",
                cursor: "pointer",
                fontFamily: "inherit",
                fontSize: isMobile ? 14 : 17, fontWeight: selectedSide === "spectator" ? 700 : 500,
                display: "flex", alignItems: "center", gap: 8, justifyContent: "center",
              }}
            >
              <Globe size={14} />
              全局觀察
            </button>
          </div>

          <button
            onClick={onStart}
            className="wg-btn"
            style={{
              width: "100%",
              padding: isMobile ? "12px 20px" : "14px 24px",
              background: "#3b82f6",
              color: "#fff",
              border: "none",
              borderRadius: 8,
              fontSize: isMobile ? 16 : 20, fontWeight: 700,
              cursor: "pointer",
              fontFamily: "inherit",
              display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            }}
          >
            <Play size={16} fill="currentColor" /> 進入戰役
          </button>
        </>
      )}
    </div>
  );
}

function flyToScenario(map: MapboxMap | null, scenario: { camera: { center: [number, number]; zoom: number; pitch: number; bearing: number } }) {
  if (!map) return;
  map.flyTo({
    center: scenario.camera.center,
    zoom: scenario.camera.zoom,
    pitch: scenario.camera.pitch,
    bearing: scenario.camera.bearing,
    duration: 1500,
  });
}
