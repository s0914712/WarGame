/**
 * 場景簡報彈窗 — 載入新場景時自動跳出。
 *
 * 內容：
 *   - 場景標題 + 一段 briefing
 *   - 雙方初始兵力統計（含 us / japan）
 *   - 勝負條件列表（含 label）
 *   - 「開始」按鈕關閉 + （可選）重新打開教學
 *
 * 觸發：監聽 scenario.id 變化，每次 id 不同就跳出
 *      （初次載入也會）
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { Swords, X, Trophy, Users, FileText, GraduationCap } from "lucide-react";
import { scenarioStore } from "../wargame/scenarioStore";
import { wargameClock } from "../wargame/clock";
import { SIDE_COLORS } from "../wargame/symbology/sideColors";
import { UNIT_CATALOG } from "../wargame/catalog/units";
import { launchTutorial } from "./TutorialOverlay";
import type { SideId, VictoryCondition } from "../wargame/types";

function getScenarioId(): string {
  return scenarioStore.getState().scenario.id;
}

interface Props {
  /** 手動開關（給 help icon 用） */
  open?: boolean;
  onClose?: () => void;
}

export function ScenarioBriefingModal({ open: openOverride, onClose }: Props = {}) {
  const scenarioId = useSyncExternalStore(scenarioStore.subscribe, getScenarioId, getScenarioId);
  const [autoOpen, setAutoOpen] = useState(false);
  const lastSeenIdRef = useRef<string>("empty");   // 預設視為已看過 empty，避免初次跳出

  // 偵測 scenario 變化 → 自動跳出（empty 場景不算）
  useEffect(() => {
    if (scenarioId === "empty") return;
    if (scenarioId !== lastSeenIdRef.current) {
      lastSeenIdRef.current = scenarioId;
      setAutoOpen(true);
      wargameClock.pause();
    }
  }, [scenarioId]);

  // 手動開（help 按鈕）也要避開 empty
  const effectiveAuto = scenarioId === "empty" ? false : autoOpen;
  const isOpen = openOverride !== undefined ? openOverride : effectiveAuto;
  const close = () => {
    setAutoOpen(false);
    onClose?.();
  };

  // Esc 關閉
  useEffect(() => {
    if (!isOpen) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isOpen]);

  if (!isOpen) return null;

  const state = scenarioStore.getState();
  const scenario = state.scenario;

  // 雙方兵力按 kind 統計
  const sidesStats = scenario.sides
    .filter((s) => s.isHostileTo.length > 0 || s.isPlayer)
    .map((s) => {
      const units = Object.values(state.units).filter((u) => u.sideId === s.id);
      const byKind: Record<string, number> = {};
      for (const u of units) byKind[u.kind] = (byKind[u.kind] ?? 0) + 1;
      return { side: s, total: units.length, byKind };
    });

  return (
    <div
      onClick={close}
      style={{
        position: "fixed", inset: 0, zIndex: 140,
        background: "rgba(2, 6, 23, 0.78)",
        backdropFilter: "blur(6px)",
        display: "flex", alignItems: "center", justifyContent: "center",
      }}
    >
      <div
        className="wg-fade-in"
        onClick={(e) => e.stopPropagation()}
        style={{
          width: "min(640px, 92vw)",
          maxHeight: "88vh",
          background: "linear-gradient(160deg, rgba(30, 41, 59, 0.98), rgba(15, 23, 42, 0.98))",
          border: "1px solid rgba(59, 130, 246, 0.35)",
          borderRadius: 14,
          color: "#e2e8f0",
          fontFamily: "ui-sans-serif, system-ui, sans-serif",
          boxShadow: "0 20px 60px rgba(0,0,0,0.7), 0 0 0 1px rgba(59, 130, 246, 0.15)",
          display: "flex", flexDirection: "column",
          overflow: "hidden",
        }}
      >
        {/* Header */}
        <div style={{
          padding: "20px 26px 16px",
          background: "linear-gradient(135deg, rgba(59, 130, 246, 0.15), transparent)",
          borderBottom: "1px solid rgba(59, 130, 246, 0.25)",
          display: "flex", alignItems: "flex-start", justifyContent: "space-between",
        }}>
          <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
            <Swords size={32} color="#fbbf24" />
            <div>
              <div style={{ fontSize: 15, color: "#94a3b8", marginBottom: 2, letterSpacing: 1 }}>
                場景簡報
              </div>
              <div style={{ fontSize: 32, fontWeight: 700 }}>{scenario.displayName}</div>
            </div>
          </div>
          <button onClick={close} className="wg-btn" style={{
            background: "transparent", border: "none", color: "#94a3b8",
            cursor: "pointer", padding: 4,
          }}>
            <X size={20} />
          </button>
        </div>

        {/* Body — scrollable */}
        <div style={{ padding: "16px 26px", overflowY: "auto", flex: 1 }}>
          {/* 任務說明 */}
          <Section icon={<FileText size={14} />} title="任務說明">
            <p style={{ margin: 0, fontSize: 17, lineHeight: 1.7, color: "#cbd5e1" }}>
              {scenario.briefing}
            </p>
          </Section>

          {/* 兵力統計 */}
          <Section icon={<Users size={14} />} title="初始兵力">
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              {sidesStats.map(({ side, total, byKind }) => {
                const color = SIDE_COLORS[side.id as SideId].primary;
                return (
                  <div
                    key={side.id}
                    style={{
                      padding: "10px 12px",
                      background: "rgba(15, 23, 42, 0.5)",
                      borderLeft: `4px solid ${color}`,
                      borderRadius: 4,
                    }}
                  >
                    <div style={{
                      display: "flex", justifyContent: "space-between",
                      alignItems: "center", marginBottom: 6,
                    }}>
                      <span style={{ fontSize: 19, fontWeight: 600, color }}>
                        {side.displayName}
                      </span>
                      <span style={{
                        fontSize: 16, color: "#94a3b8",
                        fontFamily: "ui-monospace, monospace",
                      }}>
                        合計 {total} 單位
                      </span>
                    </div>
                    <div style={{
                      display: "flex", flexWrap: "wrap", gap: 6,
                      fontSize: 15,
                    }}>
                      {Object.entries(byKind).map(([kind, count]) => (
                        <span
                          key={kind}
                          style={{
                            padding: "2px 8px",
                            background: "rgba(148, 163, 184, 0.12)",
                            borderRadius: 3,
                            color: "#cbd5e1",
                          }}
                        >
                          {UNIT_CATALOG[kind as keyof typeof UNIT_CATALOG]?.displayName ?? kind} ×{count}
                        </span>
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </Section>

          {/* 勝負條件 */}
          {scenario.victoryConditions.length > 0 && (
            <Section icon={<Trophy size={14} />} title="勝負條件（優先序）">
              <ol style={{
                margin: 0, paddingLeft: 22,
                display: "flex", flexDirection: "column", gap: 6,
                fontSize: 17, color: "#cbd5e1", lineHeight: 1.6,
              }}>
                {scenario.victoryConditions.map((c, i) => (
                  <li key={i}>
                    {formatCondition(c, scenario)}
                  </li>
                ))}
              </ol>
            </Section>
          )}
        </div>

        {/* Footer 按鈕 */}
        <div style={{
          padding: "14px 26px",
          borderTop: "1px solid rgba(148, 163, 184, 0.15)",
          display: "flex", justifyContent: "space-between", alignItems: "center",
        }}>
          <button
            onClick={() => { close(); launchTutorial(); }}
            className="wg-btn"
            style={{
              padding: "8px 14px",
              background: "transparent",
              color: "#94a3b8",
              border: "1px solid rgba(148, 163, 184, 0.3)",
              borderRadius: 6,
              fontSize: 16, cursor: "pointer",
              fontFamily: "inherit",
              display: "flex", alignItems: "center", gap: 6,
            }}
          >
            <GraduationCap size={13} /> 看 UI 教學
          </button>
          <button
            onClick={close}
            className="wg-btn"
            style={{
              padding: "10px 24px",
              background: "#3b82f6",
              color: "#fff",
              border: "none",
              borderRadius: 6,
              fontSize: 19, fontWeight: 600, cursor: "pointer",
              fontFamily: "inherit",
            }}
          >
            開始 (Esc)
          </button>
        </div>
      </div>
    </div>
  );
}

function Section({ icon, title, children }: {
  icon: React.ReactNode; title: string; children: React.ReactNode;
}) {
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={{
        display: "flex", alignItems: "center", gap: 6,
        fontSize: 16, fontWeight: 600, color: "#60a5fa",
        letterSpacing: 1, marginBottom: 8,
      }}>
        {icon} {title}
      </div>
      {children}
    </div>
  );
}

function formatCondition(c: VictoryCondition, _scenario: unknown): string {
  if (c.label) return c.label;
  switch (c.kind) {
    case "preserve_unit":   return `${c.sideId} 方守住 ${c.unitId}`;
    case "destroy_unit":    return `${c.sideId} 方擊毀 ${c.unitId}`;
    case "eliminate_side":  return `${c.sideId} 方殲滅 ${c.targetSideId} 全部兵力`;
    case "hold_area":       return `${c.sideId} 方控制目標區 ${c.forSec} 秒`;
    case "time_limit":      return "時限結束 → 殘存戰力高者勝（差距 < 20% 為平手）";
  }
}
