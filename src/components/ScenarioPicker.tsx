/**
 * 場景選單 — 取代右上角原本的「WARGAME · 場景名」靜態顯示。
 *
 * 切換時：
 *   - 暫停 clock
 *   - 重設 scenarioStore（會清空所有單位 / 殘骸 / 事件）
 *   - 飛機跳到該場景的相機預設位置
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Map as MapboxMap } from "mapbox-gl";
import { ChevronDown, Swords } from "lucide-react";
import { scenarioStore } from "../wargame/scenarioStore";
import { wargameClock } from "../wargame/clock";
import { SCENARIO_REGISTRY, findScenario } from "../wargame/scenarios/registry";
import { t, useLang } from "../wargame/i18n/lang";

interface Props {
  map: MapboxMap | null;
  isMobile?: boolean;
  embedded?: boolean;
}

function getScenarioName(): string {
  return scenarioStore.getState().scenario.displayName;
}

export function ScenarioPicker({ map, isMobile = false, embedded = false }: Props) {
  useSyncExternalStore(scenarioStore.subscribe, getScenarioName, getScenarioName);
  const lang = useLang();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  const currentId = scenarioStore.getState().scenario.id;

  // 點外面關閉
  useEffect(() => {
    if (!open) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("mousedown", handler);
    return () => window.removeEventListener("mousedown", handler);
  }, [open]);

  const loadScenario = (id: string) => {
    const s = findScenario(id);
    if (!s) return;
    wargameClock.pause();
    wargameClock.reset();
    scenarioStore.loadScenario(s);
    if (map) {
      map.flyTo({
        center: s.camera.center,
        zoom: s.camera.zoom,
        pitch: s.camera.pitch,
        bearing: s.camera.bearing,
        duration: 1200,
      });
    }
    setOpen(false);
  };

  return (
    <div
      ref={ref}
      style={embedded ? {
        position: "relative",
        width: "100%",
      } : {
        position: "absolute",
        top: 16,
        right: 16,
        zIndex: 22,
      }}
    >
      <button
        onClick={() => setOpen((v) => !v)}
        className="wg-btn"
        style={{
          padding: "8px 14px",
          background: "rgba(15, 23, 42, 0.92)",
          backdropFilter: "blur(6px)",
          border: "1px solid rgba(148, 163, 184, 0.3)",
          borderRadius: 8,
          color: "#e2e8f0",
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
          fontSize: 17,
          cursor: "pointer",
          display: "flex", alignItems: "center", gap: 8,
          width: embedded ? "100%" : undefined,
        }}
      >
        <Swords size={14} color="#fbbf24" />
        <span style={{ color: "#94a3b8", fontSize: 15 }}>{t("Scenario")}</span>
        <span style={{ fontWeight: 600 }}>{getScenarioName()}</span>
        <ChevronDown size={14} style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s" }} />
      </button>

      {open && (
        <div
          className="wg-fade-in"
          style={{
            marginTop: 6,
            width: isMobile ? "min(320px, 80vw)" : 320,
            maxHeight: isMobile ? "60vh" : undefined,
            overflowY: isMobile ? "auto" : undefined,
            background: "rgba(15, 23, 42, 0.98)",
            backdropFilter: "blur(8px)",
            border: "1px solid rgba(148, 163, 184, 0.3)",
            borderRadius: 8,
            overflow: "hidden",
            boxShadow: "0 10px 30px rgba(0,0,0,0.5)",
          }}
        >
          {SCENARIO_REGISTRY.map((entry) => {
            const isCurrent = entry.scenario.id === currentId;
            return (
              <button
                key={entry.scenario.id}
                onClick={() => loadScenario(entry.scenario.id)}
                className="wg-btn"
                style={{
                  display: "block",
                  width: "100%",
                  padding: "10px 14px",
                  background: isCurrent ? "rgba(59, 130, 246, 0.15)" : "transparent",
                  border: "none",
                  borderBottom: "1px solid rgba(148, 163, 184, 0.12)",
                  color: "#e2e8f0",
                  textAlign: "left",
                  cursor: "pointer",
                  fontFamily: "inherit",
                }}
              >
                <div style={{
                  fontWeight: 600, fontSize: 19,
                  color: isCurrent ? "#60a5fa" : "#e2e8f0",
                }}>
                  {entry.scenario.displayName}
                  {isCurrent && <span style={{ marginLeft: 8, fontSize: 14, color: "#60a5fa" }}>● 進行中</span>}
                </div>
                <div style={{ fontSize: 15, color: "#94a3b8", marginTop: 3, display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center" }}>
                  <span>{entry.shortDescription}</span>
                  {entry.tags?.map((tag) => (
                    <span key={tag} style={{
                      fontSize: 13, padding: "1px 6px",
                      background: "rgba(59, 130, 246, 0.15)",
                      color: "#93c5fd",
                      border: "1px solid rgba(59, 130, 246, 0.3)",
                      borderRadius: 3,
                      fontFamily: "ui-monospace, monospace",
                    }}>
                      {tag}
                    </span>
                  ))}
                </div>
                <div style={{ fontSize: 15, color: "#64748b", marginTop: 4, lineHeight: 1.45,
                              display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical",
                              overflow: "hidden" }}>
                  {typeof entry.scenario.briefing === "string"
                    ? entry.scenario.briefing
                    : entry.scenario.briefing[lang]}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
