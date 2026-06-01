/**
 * 行動版分頁底部 sheet — 複製 MobileBottomSheet 的視覺殼，加上分頁列。
 *
 * 三個分頁：單位（UnitEditorPanel）/ 戰報（EngagementLog）/ 佈署（UnitPalette）。
 * - 地圖點選單位 → 自動切到「單位」並從 collapsed 升到 half。
 * - planRoute 模式 → 自動切到「單位」。
 * - 進「佈署」= 進 placeUnit 模式；離開 → 退出 placeUnit。
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { ScrollText, SlidersHorizontal, ClipboardList } from "lucide-react";
import { scenarioStore } from "../../wargame/scenarioStore";
import { editorStore } from "../../wargame/editor/editorStore";
import { UnitEditorPanel } from "../UnitEditorPanel";
import { EngagementLog } from "../EngagementLog";
import { UnitPalette } from "../UnitPalette";

type Tab = "unit" | "log" | "plan";
type Level = "collapsed" | "half" | "full";
const LEVELS: Level[] = ["collapsed", "half", "full"];

function getHeight(level: Level, isLandscape: boolean): number {
  if (isLandscape) {
    switch (level) {
      case "collapsed": return 80;
      case "half": return Math.min(220, window.innerHeight * 0.5);
      case "full": return Math.min(340, window.innerHeight * 0.6);
    }
  }
  switch (level) {
    case "collapsed": return 80;
    case "half": return 260;
    case "full": return Math.min(520, window.innerHeight * 0.7);
  }
}

function selSnap(): string | null { return scenarioStore.getSelectedUnitId(); }
function modeSnap(): string { return editorStore.getMode(); }

interface Props {
  isLandscape: boolean;
  onHeightChange?: (heightPx: number) => void;
}

export function WargameMobileSheet({ isLandscape, onHeightChange }: Props) {
  const selectedId = useSyncExternalStore(scenarioStore.subscribe, selSnap, selSnap);
  const mode = useSyncExternalStore(editorStore.subscribe, modeSnap, modeSnap);
  const [level, setLevel] = useState<Level>("collapsed");
  const [tab, setTab] = useState<Tab>("log");

  // 選到新單位 → 單位分頁 + 升起
  const prevSel = useRef<string | null>(null);
  useEffect(() => {
    if (selectedId && selectedId !== prevSel.current) {
      setTab("unit");
      setLevel((l) => (l === "collapsed" ? "half" : l));
    }
    prevSel.current = selectedId;
  }, [selectedId]);

  // 進入規劃航線 → 單位分頁
  useEffect(() => {
    if (mode === "planRoute") {
      setTab("unit");
      setLevel((l) => (l === "collapsed" ? "half" : l));
    }
  }, [mode]);

  const height = getHeight(level, isLandscape);
  useEffect(() => {
    onHeightChange?.(height);
  }, [height, onHeightChange]);

  const cycleLevel = () =>
    setLevel((p) => LEVELS[(LEVELS.indexOf(p) + 1) % LEVELS.length]!);

  const selectTab = (t: Tab) => {
    // 「佈署」分頁 = placeUnit 模式入口
    if (t === "plan") {
      editorStore.enterPlaceMode();
    } else if (editorStore.getMode() === "placeUnit") {
      editorStore.exitPlaceMode();
    }
    setTab(t);
    setLevel((l) => (l === "collapsed" ? "half" : l));
  };

  return (
    <div
      style={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        height,
        zIndex: 30,
        background: "rgba(2, 6, 23, 0.82)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        borderTop: "1px solid rgba(148, 163, 184, 0.2)",
        borderRadius: "16px 16px 0 0",
        transition: "height 0.3s cubic-bezier(0.4, 0, 0.2, 1)",
        display: "flex",
        flexDirection: "column",
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
        overflow: "hidden",
      }}
    >
      {/* drag handle */}
      <div
        onClick={cycleLevel}
        style={{
          display: "flex",
          justifyContent: "center",
          alignItems: "center",
          padding: "8px 0 4px",
          cursor: "pointer",
          flexShrink: 0,
        }}
      >
        <div style={{ width: 36, height: 4, borderRadius: 2, background: "rgba(255,255,255,0.3)" }} />
      </div>

      {/* tab strip */}
      <div style={{ display: "flex", gap: 6, padding: "0 12px 8px", flexShrink: 0 }}>
        <TabBtn active={tab === "unit"} onClick={() => selectTab("unit")} Icon={SlidersHorizontal} label="單位" />
        <TabBtn active={tab === "log"} onClick={() => selectTab("log")} Icon={ScrollText} label="戰報" />
        <TabBtn active={tab === "plan"} onClick={() => selectTab("plan")} Icon={ClipboardList} label="佈署" />
      </div>

      {/* content */}
      <div style={{ flex: 1, overflowY: "auto", overflowX: "hidden", padding: "0 14px 8px" }}>
        {tab === "unit" && <UnitEditorPanel embedded />}
        {tab === "log" && <EngagementLog embedded />}
        {tab === "plan" && <UnitPalette embedded />}
        {tab === "unit" && !scenarioStore.getSelectedUnit() && (
          <div style={{ color: "#64748b", fontStyle: "italic", padding: "12px 0", fontFamily: "ui-sans-serif, system-ui, sans-serif" }}>
            點地圖上的單位以檢視 / 編輯屬性
          </div>
        )}
      </div>
    </div>
  );
}

function TabBtn({ active, onClick, Icon, label }: {
  active: boolean; onClick: () => void; Icon: typeof ScrollText; label: string;
}) {
  return (
    <button
      onClick={onClick}
      className="wg-btn"
      style={{
        flex: 1,
        minHeight: 40,
        borderRadius: 8,
        border: `1px solid ${active ? "rgba(59,130,246,0.6)" : "rgba(148,163,184,0.25)"}`,
        background: active ? "rgba(59,130,246,0.22)" : "rgba(30,41,59,0.4)",
        color: active ? "#bfdbfe" : "#cbd5e1",
        fontSize: 16,
        fontWeight: active ? 600 : 500,
        cursor: "pointer",
        fontFamily: "ui-sans-serif, system-ui, sans-serif",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
      }}
    >
      <Icon size={15} /> {label}
    </button>
  );
}
