/**
 * 行動版底部 dock — 統一的底部結構，取代右側抽屜。
 *
 *   ┌───────────────────────────┐
 *   │  面板內容（可展開 / 收合）   │  ← 選中導航項時由下往上展開
 *   ├───────────────────────────┤
 *   │ 單位 │ 戰報 │ 佈署 │ 設定  │  ← 下方一排導航列（常駐）
 *   └───────────────────────────┘
 *
 * - 點導航項展開對應面板；再點同一項收合。
 * - 地圖點選單位 → 自動展開「單位」。planRoute → 自動「單位」。
 * - 「佈署」= 進 placeUnit 模式；離開 → 退出。
 * - 內容區套 zoom 縮小（字型 / 間距整體縮，與電腦版區隔）。
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Map as MapboxMap } from "mapbox-gl";
import { ScrollText, SlidersHorizontal, ClipboardList, Settings, Radar } from "lucide-react";
import { scenarioStore } from "../../wargame/scenarioStore";
import { editorStore } from "../../wargame/editor/editorStore";
import { UnitEditorPanel } from "../UnitEditorPanel";
import { EngagementLog } from "../EngagementLog";
import { UnitPalette } from "../UnitPalette";
import { SearchPlannerPanel } from "../SearchPlannerPanel";
import { searchPlannerStore } from "../../wargame/search/searchPlannerStore";
import { WargameMobileSettings } from "./WargameMobileSettings";

type Tab = "unit" | "log" | "plan" | "search" | "settings";

const NAV_HEIGHT = 56;

function contentHeight(isLandscape: boolean): number {
  return isLandscape
    ? Math.min(240, Math.round(window.innerHeight * 0.55))
    : Math.min(360, Math.round(window.innerHeight * 0.46));
}

function selSnap(): string | null { return scenarioStore.getSelectedUnitId(); }
function modeSnap(): string { return editorStore.getMode(); }
function pickSnap(): boolean { return searchPlannerStore.isPicking(); }

interface Props {
  map: MapboxMap | null;
  isLandscape: boolean;
  styleId: string;
  onStyleChange: (id: string) => void;
  onOpenLlm: () => void;
  onOpenBriefing: () => void;
  onOpenCheat: () => void;
  onHeightChange?: (heightPx: number) => void;
}

export function WargameMobileDock({
  map, isLandscape, styleId, onStyleChange, onOpenLlm, onOpenBriefing, onOpenCheat, onHeightChange,
}: Props) {
  const selectedId = useSyncExternalStore(scenarioStore.subscribe, selSnap, selSnap);
  const mode = useSyncExternalStore(editorStore.subscribe, modeSnap, modeSnap);
  const picking = useSyncExternalStore(searchPlannerStore.subscribe, pickSnap, pickSnap);
  const [active, setActive] = useState<Tab | null>(null);

  // 選到新單位 → 展開「單位」
  const prevSel = useRef<string | null>(null);
  useEffect(() => {
    if (selectedId && selectedId !== prevSel.current) setActive("unit");
    prevSel.current = selectedId;
  }, [selectedId]);

  // 進入規劃航線 → 展開「單位」
  useEffect(() => {
    if (mode === "planRoute") setActive("unit");
  }, [mode]);

  // 開始在地圖上框選搜索區 → 收起 dock，把整個畫面讓給地圖
  useEffect(() => {
    if (picking) setActive(null);
  }, [picking]);

  const cH = contentHeight(isLandscape);
  const open = active !== null;
  useEffect(() => {
    onHeightChange?.(NAV_HEIGHT + (open ? cH : 0));
  }, [open, cH, onHeightChange]);

  const selectTab = (t: Tab) => {
    setActive((cur) => {
      const next = cur === t ? null : t;
      if (next === "plan") editorStore.enterPlaceMode();
      else if (editorStore.getMode() === "placeUnit") editorStore.exitPlaceMode();
      if (next === "search") searchPlannerStore.setOpen(true);
      return next;
    });
  };

  return (
    <div
      style={{
        position: "fixed",
        bottom: 0,
        left: 0,
        right: 0,
        zIndex: 32,
        display: "flex",
        flexDirection: "column",
        background: "rgba(2, 6, 23, 0.92)",
        backdropFilter: "blur(16px)",
        WebkitBackdropFilter: "blur(16px)",
        borderTop: "1px solid rgba(148, 163, 184, 0.2)",
        borderRadius: open ? "16px 16px 0 0" : 0,
        paddingBottom: "env(safe-area-inset-bottom, 0px)",
      }}
    >
      {/* 內容區（可展開），套 zoom 整體縮小 */}
      <div
        style={{
          height: open ? cH : 0,
          overflow: "hidden",
          transition: "height 0.28s cubic-bezier(0.4, 0, 0.2, 1)",
        }}
      >
        <div
          style={{
            // zoom：整體縮小內嵌面板（字型 / 間距），與電腦版區隔；行動瀏覽器支援
            zoom: 0.85,
            height: "100%",
            overflowY: "auto",
            overflowX: "hidden",
            padding: "12px 14px",
            boxSizing: "border-box",
          }}
        >
          {active === "unit" && <UnitEditorPanel embedded />}
          {active === "unit" && !scenarioStore.getSelectedUnit() && (
            <div style={{ color: "#64748b", fontStyle: "italic", padding: "8px 0", fontFamily: "ui-sans-serif, system-ui, sans-serif", fontSize: 15 }}>
              點地圖上的單位以檢視 / 編輯屬性
            </div>
          )}
          {active === "log" && <EngagementLog embedded />}
          {active === "search" && <SearchPlannerPanel embedded />}
          {active === "plan" && <UnitPalette embedded />}
          {active === "settings" && (
            <WargameMobileSettings
              map={map}
              styleId={styleId}
              onStyleChange={onStyleChange}
              onOpenLlm={onOpenLlm}
              onOpenBriefing={onOpenBriefing}
              onOpenCheat={onOpenCheat}
            />
          )}
        </div>
      </div>

      {/* 下方一排導航列 */}
      <div style={{ display: "flex", height: NAV_HEIGHT, borderTop: open ? "1px solid rgba(148,163,184,0.15)" : "none" }}>
        <NavItem active={active === "unit"} onClick={() => selectTab("unit")} Icon={SlidersHorizontal} label="單位" />
        <NavItem active={active === "log"} onClick={() => selectTab("log")} Icon={ScrollText} label="戰報" />
        <NavItem active={active === "plan"} onClick={() => selectTab("plan")} Icon={ClipboardList} label="佈署" />
        <NavItem active={active === "search"} onClick={() => selectTab("search")} Icon={Radar} label="搜索" />
        <NavItem active={active === "settings"} onClick={() => selectTab("settings")} Icon={Settings} label="設定" />
      </div>
    </div>
  );
}

function NavItem({ active, onClick, Icon, label }: {
  active: boolean; onClick: () => void; Icon: typeof ScrollText; label: string;
}) {
  return (
    <button
      onClick={onClick}
      aria-label={label}
      style={{
        flex: 1,
        border: "none",
        background: "transparent",
        color: active ? "#60a5fa" : "#94a3b8",
        cursor: "pointer",
        fontFamily: "ui-sans-serif, system-ui, sans-serif",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 3,
        position: "relative",
      }}
    >
      {active && (
        <span style={{ position: "absolute", top: 0, left: "30%", right: "30%", height: 2, borderRadius: 2, background: "#60a5fa" }} />
      )}
      <Icon size={20} />
      <span style={{ fontSize: 11, fontWeight: active ? 600 : 500 }}>{label}</span>
    </button>
  );
}
