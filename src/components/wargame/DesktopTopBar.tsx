/**
 * 桌面頂部資訊列（一排到底）：
 *   [▶ T+ 速率] [雙方戰力]  ……  [場景▾] [視角▾] [FoW] [中/EN] [LLM] [☰]
 * ☰ 選單收納不常用功能：底圖、錄製/回放、Plan Mode、簡報、教學、快捷鍵、展示模式、主選單。
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Map as MapboxMap } from "mapbox-gl";
import {
  Menu, Eye, EyeOff, Languages, Bot, ClipboardList, Swords, GraduationCap, HelpCircle,
  Monitor, Home, Map as MapIcon, Film, Radar, Hexagon, Ruler, Crosshair,
} from "lucide-react";
import { hexStore } from "../../wargame/hex/hexStore";
import { WargameClockHUD } from "../WargameClockHUD";
import { BattleStatsHud } from "../BattleStatsHud";
import { ScenarioPicker } from "../ScenarioPicker";
import { MapStyleSwitcher } from "../MapStyleSwitcher";
import { ReplayPanel } from "../ReplayPanel";
import { launchTutorial } from "../TutorialOverlay";
import { scenarioStore } from "../../wargame/scenarioStore";
import { viewStore, type ActiveView } from "../../wargame/viewStore";
import { editorStore } from "../../wargame/editor/editorStore";
import { uiStore } from "../../wargame/uiStore";
import { netStore } from "../../wargame/net/netStore";
import { replayPlayer } from "../../wargame/replay/player";
import { langStore, useLang } from "../../wargame/i18n/lang";
import { searchPlannerStore } from "../../wargame/search/searchPlannerStore";
import { rulerStore } from "../../map/rulerTool";
import { assetPanelStore } from "./AssetPanel";

export const TOP_BAR_HEIGHT = 56;

interface Props {
  map: MapboxMap | null;
  styleId: string;
  onStyleChange: (id: string) => void;
  onOpenLlm: () => void;
  onOpenBriefing: () => void;
  onOpenCheat: () => void;
}

function getFow() { return scenarioStore.isFogOfWar(); }
function getReplayActive() { return replayPlayer.isActive(); }
function getSearchOpen() { return searchPlannerStore.isOpen(); }
function getRulerActive() { return rulerStore.isActive(); }
function getAssetOpen() { return assetPanelStore.isOpen(); }

export function DesktopTopBar({ map, styleId, onStyleChange, onOpenLlm, onOpenBriefing, onOpenCheat }: Props) {
  const lang = useLang();
  const fow = useSyncExternalStore(scenarioStore.subscribe, getFow, getFow);
  const net = useSyncExternalStore(netStore.subscribe, netStore.get, netStore.get);
  const view = useSyncExternalStore(viewStore.subscribe, viewStore.getActiveView, viewStore.getActiveView);
  const replayActive = useSyncExternalStore(replayPlayer.subscribe, getReplayActive, getReplayActive);
  const fowLocked = net.role !== "off" && view !== "spectator";
  const searchOpen = useSyncExternalStore(searchPlannerStore.subscribe, getSearchOpen, getSearchOpen);
  const rulerActive = useSyncExternalStore(rulerStore.subscribe, getRulerActive, getRulerActive);
  const assetOpen = useSyncExternalStore(assetPanelStore.subscribe, getAssetOpen, getAssetOpen);
  const width = useWindowWidth();
  // 窄螢幕：右側按鈕改純圖示（文字留在 tooltip），避免擠出畫面
  const iconOnly = width < 1600;
  const tight = width < 1320;

  return (
    <>
      <div style={{
        position: "absolute", top: 0, left: 0, right: 0, height: TOP_BAR_HEIGHT, zIndex: 30,
        display: "flex", alignItems: "center", gap: tight ? 8 : 12, padding: "0 12px",
        background: "linear-gradient(to bottom, rgba(8, 13, 26, 0.98), rgba(15, 23, 42, 0.95))",
        borderBottom: "1px solid rgba(96, 165, 250, 0.35)",
        boxShadow: "0 6px 20px rgba(0, 0, 0, 0.4)",
        color: "#e2e8f0", fontFamily: "ui-sans-serif, system-ui, sans-serif",
      }}>
        <WargameClockHUD embedded hidePausedBadge={tight} />
        <Divider />
        <BattleStatsHud embedded inBar hideNames={width < 1500} />
        <div style={{ flex: 1 }} />
        <ScenarioPicker map={map} inBar nameMaxWidth={iconOnly ? 150 : 220} />
        <PovSelect />
        <HexButton />
        <BarButton
          active={fow}
          accent="#22c55e"
          disabled={fowLocked}
          title={fowLocked ? "多人對戰中玩家強制 FoW" : fow ? "FoW 開：敵方未偵測 = 不顯示" : "FoW 關：敵方淡化顯示（除錯）"}
          onClick={() => scenarioStore.setFogOfWar(!fow)}
        >
          {fow ? <EyeOff size={15} /> : <Eye size={15} />}{!iconOnly && " FoW"}
        </BarButton>
        <BarButton title={lang === "zh" ? "Switch to English" : "切換為中文"} onClick={() => langStore.toggle()}>
          <Languages size={15} />{lang === "zh" ? " 中" : " EN"}
        </BarButton>
        <BarButton accent="#facc15" active={searchOpen}
          title="搜索規劃器（掃區時間 / POD / 建議架數與搜索圖形）"
          onClick={() => searchPlannerStore.setOpen(!searchOpen)}>
          <Radar size={15} />{!iconOnly && " 搜索"}
        </BarButton>
        <BarButton accent="#f97316" active={assetOpen}
          title={lang === "en" ? "Assets — target priority per category, recon plan" : "資產：各類目標攻擊優序、偵察計畫"}
          onClick={() => assetPanelStore.toggle()}>
          <Crosshair size={15} />{!iconOnly && (lang === "en" ? " Assets" : " 資產")}
        </BarButton>
        <BarButton accent="#f472b6" active={rulerActive}
          title={lang === "en" ? "Ruler — measure distance (NM / km) and bearing" : "尺規：量測距離（海里 / 公里）與方位"}
          onClick={() => rulerStore.setActive(!rulerActive)}>
          <Ruler size={15} />{!iconOnly && (lang === "en" ? " Ruler" : " 尺規")}
        </BarButton>
        <BarButton accent="#3b82f6" active title="LLM 介接（狀態匯出 / 指令匯入 / AI 對手）" onClick={onOpenLlm}>
          <Bot size={15} />{!iconOnly && " LLM"}
        </BarButton>
        <MainMenu
          styleId={styleId} onStyleChange={onStyleChange}
          onOpenBriefing={onOpenBriefing} onOpenCheat={onOpenCheat}
          multiplayer={net.role !== "off"}
        />
      </div>
      {/* 回放進行中：scrub bar 浮在頂部列下方 */}
      {replayActive && <ReplayPanel />}
    </>
  );
}

// ── 視角選擇（多人陣營玩家鎖定己方） ──
function PovSelect() {
  const view = useSyncExternalStore(viewStore.subscribe, viewStore.getActiveView, viewStore.getActiveView);
  const net = useSyncExternalStore(netStore.subscribe, netStore.get, netStore.get);
  useSyncExternalStore(scenarioStore.subscribe, getSidesSig, getSidesSig);
  const sides = scenarioStore.getState().scenario.sides;
  const locked = net.role !== "off" && !!net.mySideId;
  const color = view === "spectator" ? "#94a3b8" : sides.find((s) => s.id === view)?.colorPrimary ?? "#94a3b8";
  return (
    <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 13, color: "#94a3b8", minWidth: 0, flexShrink: 1 }} title="視角（POV）">
      <span style={{ width: 10, height: 10, borderRadius: "50%", background: color, boxShadow: `0 0 6px ${color}` }} />
      <select
        value={view}
        disabled={locked}
        onChange={(e) => viewStore.setActiveView(e.target.value as ActiveView)}
        style={{
          padding: "6px 8px", fontSize: 15, borderRadius: 6, maxWidth: 190, minWidth: 90,
          background: "rgba(30, 41, 59, 0.6)", color: "#e2e8f0",
          border: "1px solid rgba(148, 163, 184, 0.3)", cursor: locked ? "not-allowed" : "pointer",
          fontFamily: "inherit",
        }}
      >
        {sides.map((s) => <option key={s.id} value={s.id}>{s.displayName}</option>)}
        <option value="spectator">全局觀察</option>
      </select>
    </label>
  );
}

function getSidesSig() { return scenarioStore.getState().scenario.sides.map((s) => s.id).join("|"); }

// ── 六角格開關 ──
function HexButton() {
  useSyncExternalStore(hexStore.subscribe, hexStore.getVersion, hexStore.getVersion);
  const on = hexStore.isVisible();
  return (
    <BarButton active={on} accent="#a78bfa" title={on ? "關閉六角格 / 勢力範圍" : "六角格 / 勢力範圍（每格 ≈ 100 km²）"}
      onClick={() => hexStore.setVisible(!on)}>
      <Hexagon size={15} />
    </BarButton>
  );
}

// ── ☰ 選單 ──
function MainMenu({ styleId, onStyleChange, onOpenBriefing, onOpenCheat, multiplayer }: {
  styleId: string; onStyleChange: (id: string) => void;
  onOpenBriefing: () => void; onOpenCheat: () => void; multiplayer: boolean;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") setOpen(false); };
    window.addEventListener("mousedown", onDown);
    window.addEventListener("keydown", onKey);
    return () => { window.removeEventListener("mousedown", onDown); window.removeEventListener("keydown", onKey); };
  }, [open]);

  const act = (fn: () => void) => () => { setOpen(false); fn(); };

  return (
    <div ref={ref} style={{ position: "relative", flexShrink: 0 }}>
      <BarButton active={open} title="選單" onClick={() => setOpen((o) => !o)}>
        <Menu size={16} />
      </BarButton>
      {open && (
        <div className="wg-fade-in" style={{
          position: "absolute", top: "calc(100% + 8px)", right: 0, width: 320, zIndex: 40,
          padding: 8, borderRadius: 10,
          background: "rgba(15, 23, 42, 0.98)", border: "1px solid rgba(148, 163, 184, 0.3)",
          boxShadow: "0 12px 32px rgba(0,0,0,0.55)",
          display: "flex", flexDirection: "column", gap: 2,
        }}>
          <MenuLabel icon={<MapIcon size={13} />}>底圖</MenuLabel>
          <div style={{ padding: "2px 6px 8px" }}>
            <MapStyleSwitcher selectedId={styleId} onChange={onStyleChange} embedded />
          </div>
          {!multiplayer && (
            <>
              <MenuLabel icon={<Film size={13} />}>錄製 / 回放</MenuLabel>
              <div style={{ padding: "2px 6px 8px" }}><ReplayPanel embedded /></div>
              <MenuItem icon={<ClipboardList size={16} />} onClick={act(() => editorStore.enterPlaceMode())}>
                Plan Mode（放置單位）
              </MenuItem>
            </>
          )}
          <MenuItem icon={<Swords size={16} />} onClick={act(onOpenBriefing)}>場景簡報</MenuItem>
          <MenuItem icon={<GraduationCap size={16} />} onClick={act(launchTutorial)}>UI 教學導覽</MenuItem>
          <MenuItem icon={<HelpCircle size={16} />} onClick={act(onOpenCheat)}>快捷鍵 / 介面說明</MenuItem>
          <MenuItem icon={<Monitor size={16} />} onClick={act(() => uiStore.setDemoMode(true))}>展示模式（隱藏介面，Esc 退出）</MenuItem>
          <div style={{ height: 1, background: "rgba(148, 163, 184, 0.2)", margin: "4px 0" }} />
          <MenuItem icon={<Home size={16} />} onClick={act(() => uiStore.setLandingOpen(true))}>返回主選單</MenuItem>
        </div>
      )}
    </div>
  );
}

function MenuLabel({ icon, children }: { icon: React.ReactNode; children: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 8px 2px", fontSize: 12, letterSpacing: 1, color: "#60a5fa", fontWeight: 700 }}>
      {icon}{children}
    </div>
  );
}

function MenuItem({ icon, onClick, children }: { icon: React.ReactNode; onClick: () => void; children: React.ReactNode }) {
  return (
    <button onClick={onClick} className="wg-btn" style={{
      display: "flex", alignItems: "center", gap: 10, width: "100%",
      padding: "9px 10px", borderRadius: 6, border: "none",
      background: "transparent", color: "#e2e8f0", fontSize: 15, textAlign: "left",
      cursor: "pointer", fontFamily: "inherit",
    }}>
      <span style={{ color: "#94a3b8", display: "flex" }}>{icon}</span>{children}
    </button>
  );
}

function BarButton({ children, onClick, title, active = false, accent = "#3b82f6", disabled = false }: {
  children: React.ReactNode; onClick: () => void; title?: string; active?: boolean; accent?: string; disabled?: boolean;
}) {
  return (
    <button onClick={disabled ? undefined : onClick} title={title} className="wg-btn" disabled={disabled} style={{
      height: 36, padding: "0 10px", borderRadius: 6, flexShrink: 0,
      display: "flex", alignItems: "center", gap: 6, whiteSpace: "nowrap",
      border: `1px solid ${active ? accent : "rgba(148, 163, 184, 0.3)"}`,
      background: active ? `${accent}40` : "rgba(30, 41, 59, 0.6)",
      color: disabled ? "#64748b" : "#e2e8f0",
      fontSize: 15, fontWeight: 600, fontFamily: "inherit",
      cursor: disabled ? "not-allowed" : "pointer",
    }}>
      {children}
    </button>
  );
}

function useWindowWidth(): number {
  const [w, setW] = useState(() => window.innerWidth);
  useEffect(() => {
    const onResize = () => setW(window.innerWidth);
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);
  return w;
}

function Divider() {
  return <div style={{ width: 1, height: 30, background: "rgba(148, 163, 184, 0.25)" }} />;
}
