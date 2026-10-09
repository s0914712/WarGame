/**
 * 開頭主選單 — 依設計稿（WarGame of Taiwan 簡報）：全幅台海暮色背景 + 左上標題 + 左側直式選單。
 *
 *   戰役      → 右側面板：選場景 + 陣營（含 823 戰史紀錄片快速入口）
 *   多人遊戲  → 右側面板：線上大廳
 *   自訂      → 直接進 Plan Mode（空白戰場自由放置）
 *   遊戲教學  → 直接跑 UI 教學
 *
 * 動畫：背景緩慢推鏡、標題 / 選單交錯滑入、hover 右移 + 橘色光條、點擊掃光 + 按壓、
 *       面板滑入、進入遊戲時整頁放大淡出。鍵盤 ↑↓ 選擇、Enter 確認、Esc 返回。
 *
 * 預設首次開頁顯示；遊戲內可從「返回主選單」按鈕重新打開。
 */
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { Map as MapboxMap } from "mapbox-gl";
import { useIsMobile } from "../hooks/useIsMobile";
import { Globe, ArrowLeft, Play, Clapperboard } from "lucide-react";
import type { Scenario } from "../wargame/types";
import { netStore } from "../wargame/net/netStore";
import { roomSession } from "../wargame/net/session";
import { MultiplayerLobby } from "./MultiplayerLobby";
import { uiStore } from "../wargame/uiStore";
import { scenarioStore } from "../wargame/scenarioStore";
import { viewStore, type ActiveView } from "../wargame/viewStore";
import { editorStore } from "../wargame/editor/editorStore";
import { wargameClock } from "../wargame/clock";
import { cinemaDirector } from "../wargame/cinema/director";
import { SCENARIO_REGISTRY } from "../wargame/scenarios/registry";
import { EMPTY_SCENARIO } from "../wargame/scenarios/empty";
import { SIDE_COLORS } from "../wargame/symbology/sideColors";
import { launchTutorial } from "./TutorialOverlay";
import { useLang, langStore } from "../wargame/i18n/lang";
import { LANDING_BG, LANDING_ART } from "./landingArt";

interface Props {
  map: MapboxMap | null;
}

type Pane = "main" | "campaign" | "multiplayer";
type MenuId = "campaign" | "multiplayer" | "custom" | "tutorial" | "search";

/** 設計稿主色（簡報 accent2） */
const ACCENT = "#E97132";
/** 進入遊戲的轉場時間（ms）— 與 .wg-ld-exit 動畫一致 */
const EXIT_MS = 520;

const MENU: { id: MenuId; zh: string; en: string; descZh: string; descEn: string }[] = [
  {
    id: "campaign", zh: "戰役", en: "Campaign",
    descZh: "挑選預設場景與扮演陣營（藍方 / 紅方 / 全局觀察）進入推演；含 823 砲戰戰史紀錄片。",
    descEn: "Pick a preset scenario and your side (Blue / Red / Spectator); includes the 823 Bombardment documentary.",
  },
  {
    id: "multiplayer", zh: "多人遊戲", en: "Multiplayer",
    descZh: "登入後建立房間或以房間碼加入，每位玩家指揮一個陣營；房主主持推演。",
    descEn: "Log in, create or join a room by code; each player commands one side. The host runs the sim.",
  },
  {
    id: "custom", zh: "自訂", en: "Custom",
    descZh: "從空白戰場開始，自由放置兵棋單位、設定屬性、規劃航線，可匯出為場景。",
    descEn: "Start from an empty battlefield: place units, tune attributes, plan routes, export as a scenario.",
  },
  {
    id: "tutorial", zh: "遊戲教學", en: "Tutorial",
    descZh: "逐步導覽所有介面：時鐘、戰報、指令卡、任務目標、六角格與 LLM 介接。",
    descEn: "Step-by-step tour of the whole UI: clock, log, command card, objectives, hex grid and LLM bridge.",
  },
  {
    id: "search", zh: "無人機搜索", en: "UAV Search Planner",
    descZh: "獨立的無人機海上搜索規劃器：繪製搜索區、IAMSAR 掃掠寬度與 POD、六大搜索圖形、蒙地卡羅、事前分布與突穿機率。",
    descEn: "Standalone UAV maritime search planner: draw the area, IAMSAR sweep width & POD, six search patterns, Monte Carlo, prior distribution and penetration probability.",
  },
];

/** 獨立無人機搜索規劃器的網址（保留部署 base path，例：/WarGame/?mode=search） */
const SEARCH_PLANNER_URL = `${window.location.pathname}?mode=search`;

/** 從多人房間切回單人玩法前先離開房間 */
function leaveMultiplayerIfAny() {
  if (netStore.isMultiplayer()) void roomSession.leaveRoom();
}

function isOpen() { return uiStore.isLandingOpen(); }

export function LandingScreen({ map }: Props) {
  const open = useSyncExternalStore(uiStore.subscribe, isOpen, isOpen);
  const lang = useLang();
  const { isMobile } = useIsMobile();
  const [pane, setPane] = useState<Pane>("main");
  const [selectedScenarioId, setSelectedScenarioId] = useState<string | null>(null);
  const [selectedSide, setSelectedSide] = useState<ActiveView>("blue");
  const [focus, setFocus] = useState(0);
  const [leaving, setLeaving] = useState(false);
  // 點擊掃光：每個選單各自的點擊次數（只有被點的那顆換 key 重播動畫，其他不重掛）
  const [presses, setPresses] = useState<Partial<Record<MenuId, number>>>({});
  const leaveTimer = useRef<number | null>(null);

  // 預載四張預覽圖：hover / ↑↓ 切換時不閃白
  useEffect(() => {
    if (!open) return;
    for (const a of Object.values(LANDING_ART)) { const img = new Image(); img.src = a.src; }
  }, [open]);

  // 重新打開選單 → 重置轉場 / 面板狀態
  useEffect(() => {
    if (open) { setLeaving(false); setPane("main"); }
    return () => { if (leaveTimer.current) window.clearTimeout(leaveTimer.current); };
  }, [open]);

  /** 播放離場轉場後再執行（關閉選單 + 進遊戲） */
  const withExit = (fn: () => void) => {
    if (leaving) return;
    setLeaving(true);
    leaveTimer.current = window.setTimeout(fn, EXIT_MS);
  };

  // ── 多人：房間開打 → 關選單、飛鏡頭；host 設定聲學環境（client 由 snapshot 同步） ──
  const onMatchStart = (scenario: Scenario, isHost: boolean) => {
    withExit(() => {
      flyToScenario(map, scenario);
      uiStore.setLandingOpen(false);
      if (isHost && scenario.acousticModel) uiStore.setAcousticConfigOpen(true);
    });
  };

  // ── 進入戰役 ──
  const startCampaign = () => {
    const entry = SCENARIO_REGISTRY.find((e) => e.scenario.id === selectedScenarioId);
    if (!entry) return;
    withExit(() => {
      leaveMultiplayerIfAny();
      wargameClock.reset();
      scenarioStore.loadScenario(entry.scenario);
      viewStore.setActiveView(selectedSide);
      flyToScenario(map, entry.scenario);
      uiStore.setLandingOpen(false);
      // 反潛場景：開戰前先跳出聲學環境設定畫面
      if (entry.scenario.acousticModel) uiStore.setAcousticConfigOpen(true);
      // briefing modal 會自動跳出（因 scenario id 不是 "empty"）
    });
  };

  // ── 自訂（Plan Mode） ──
  const startPlanMode = () => withExit(() => {
    leaveMultiplayerIfAny();
    wargameClock.reset();
    scenarioStore.loadScenario(EMPTY_SCENARIO);
    viewStore.setActiveView("blue");
    uiStore.setLandingOpen(false);
    // 進放置模式（會自動暫停 clock）
    setTimeout(() => editorStore.enterPlaceMode(), 50);
  });

  // ── 遊戲教學 ──
  const startTutorial = () => withExit(() => {
    uiStore.setLandingOpen(false);
    setTimeout(() => launchTutorial(), 100);
  });

  // ── 戰史紀錄片直入（823 砲戰）：載場景 → 觀察視角 → 跳過 briefing → 自動運鏡 + 播放 ──
  const startDocumentary = () => {
    const entry = SCENARIO_REGISTRY.find((e) => e.scenario.id === "kinmen_823_1958");
    if (!entry) return;
    withExit(() => {
      leaveMultiplayerIfAny();
      uiStore.setSuppressBriefingOnce();
      wargameClock.reset();
      scenarioStore.loadScenario(entry.scenario);
      viewStore.setActiveView("spectator");
      uiStore.setLandingOpen(false);
      // 等場景套用 + 地圖就緒，啟動運鏡並自動播放（30x，旁白可讀）
      setTimeout(() => {
        cinemaDirector.start(map);
        wargameClock.setRate(30);
        wargameClock.resume();
      }, 250);
    });
  };

  const activate = (id: MenuId) => {
    setPresses((p) => ({ ...p, [id]: (p[id] ?? 0) + 1 }));
    setFocus(MENU.findIndex((m) => m.id === id));
    switch (id) {
      case "campaign": setPane("campaign"); break;
      case "multiplayer": setPane("multiplayer"); break;
      case "custom": startPlanMode(); break;
      case "tutorial": startTutorial(); break;
      case "search": withExit(() => { leaveMultiplayerIfAny(); window.location.assign(SEARCH_PLANNER_URL); }); break;
    }
  };

  // 鍵盤：↑↓ 選擇、Enter 確認、Esc 返回主選單
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "Escape" && pane !== "main") { setPane("main"); return; }
      if (pane !== "main") return;
      if (e.key === "ArrowDown") { e.preventDefault(); setFocus((f) => (f + 1) % MENU.length); }
      else if (e.key === "ArrowUp") { e.preventDefault(); setFocus((f) => (f - 1 + MENU.length) % MENU.length); }
      else if (e.key === "Enter") { e.preventDefault(); activate(MENU[focus]!.id); }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  if (!open) return null;

  const activeMenu: MenuId = pane === "main" ? MENU[focus]!.id : pane;
  const focusItem = MENU.find((m) => m.id === activeMenu)!;

  return (
    <div className={leaving ? "wg-ld-exit" : undefined} style={{
      position: "fixed", inset: 0, zIndex: 180, overflow: "hidden",
      background: "#020617", color: "#e2e8f0",
      fontFamily: "ui-sans-serif, system-ui, sans-serif",
    }}>
      {/* 背景：設計稿全幅圖 + 緩慢推鏡 */}
      <div className="wg-ld-bg" style={{
        position: "absolute", inset: "-4%",
        backgroundImage: `url(${LANDING_BG})`, backgroundSize: "cover", backgroundPosition: "62% 50%",
      }} />
      {/* 左側壓暗讓文字可讀；底部暈影 */}
      <div style={{
        position: "absolute", inset: 0, pointerEvents: "none",
        background: isMobile
          ? "linear-gradient(180deg, rgba(2,6,23,0.55) 0%, rgba(2,6,23,0.25) 30%, rgba(2,6,23,0.85) 70%, rgba(2,6,23,0.95) 100%)"
          : "linear-gradient(90deg, rgba(2,6,23,0.9) 0%, rgba(2,6,23,0.62) 28%, rgba(2,6,23,0.12) 58%, rgba(2,6,23,0) 75%), linear-gradient(0deg, rgba(2,6,23,0.7) 0%, rgba(2,6,23,0) 28%)",
      }} />

      {/* 語言切換（右上） */}
      <LangPicker isMobile={isMobile} />

      {/* 標題（左上）：WarGame / of Taiwan */}
      <div className="wg-ld-in" style={{
        position: "absolute",
        left: isMobile ? 20 : "7%", top: isMobile ? "calc(env(safe-area-inset-top, 0px) + 56px)" : "5%",
      }}>
        <div style={{
          fontSize: isMobile ? 44 : "clamp(52px, 5.6vw, 92px)", fontWeight: 900, lineHeight: 0.95,
          letterSpacing: isMobile ? 1 : 3, textShadow: "0 4px 24px rgba(0,0,0,0.6)",
        }}>
          WarGame
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 12, marginTop: 6 }}>
          <span style={{ height: 3, width: isMobile ? 28 : 56, background: ACCENT, borderRadius: 2, boxShadow: `0 0 12px ${ACCENT}` }} />
          <span style={{
            fontSize: isMobile ? 20 : "clamp(22px, 2.2vw, 36px)", fontWeight: 700, color: ACCENT,
            letterSpacing: isMobile ? 4 : 8, textTransform: "uppercase",
          }}>of Taiwan</span>
        </div>
        <div style={{ marginTop: 10, fontSize: isMobile ? 13 : 16, color: "#94a3b8", letterSpacing: 2 }}>
          {lang === "en" ? "Taiwan Strait Wargame Platform" : "台灣兵棋推演平台"}
        </div>
      </div>

      {/* 左側直式選單 */}
      <nav style={{
        position: "absolute",
        left: isMobile ? 16 : "7%", right: isMobile ? 16 : undefined,
        top: isMobile ? undefined : "calc(5% + clamp(150px, 15vw, 210px))",
        bottom: isMobile ? "calc(env(safe-area-inset-bottom, 0px) + 28px)" : undefined,
        display: "flex", flexDirection: "column", gap: isMobile ? 10 : 18,
        width: isMobile ? undefined : "clamp(260px, 22vw, 340px)",
      }}>
        {MENU.map((m, i) => (
          <MenuButton
            key={m.id}
            label={lang === "en" ? m.en : m.zh}
            testId={`landing-menu-${m.id}`}
            index={i}
            isMobile={isMobile}
            active={activeMenu === m.id}
            pressKey={presses[m.id] ?? 0}
            onHover={() => pane === "main" && setFocus(i)}
            onClick={() => activate(m.id)}
          />
        ))}
        {!isMobile && pane === "main" && (
          <div className="wg-ld-in" style={{ animationDelay: "0.55s", marginTop: 6, fontSize: 12, color: "#64748b", letterSpacing: 1 }}>
            ↑ ↓ {lang === "en" ? "select" : "選擇"} · Enter {lang === "en" ? "confirm" : "確認"}
          </div>
        )}
      </nav>

      {/* 主選單時：右側預覽卡（桌面） */}
      {!isMobile && pane === "main" && (
        <PreviewCard key={focusItem.id} id={focusItem.id} title={lang === "en" ? focusItem.en : focusItem.zh}
          desc={lang === "en" ? focusItem.descEn : focusItem.descZh} />
      )}

      {/* 子面板：戰役 / 多人 */}
      {pane !== "main" && (
        <div className="wg-ld-panel" key={pane} style={isMobile ? {
          position: "absolute", inset: 0, zIndex: 3, overflowY: "auto",
          padding: "calc(env(safe-area-inset-top, 0px) + 16px) 16px calc(env(safe-area-inset-bottom, 0px) + 16px)",
          background: "rgba(2, 6, 23, 0.96)",
        } : {
          position: "absolute", zIndex: 3,
          // 與選單同高起始，不蓋到左上標題
          left: "calc(7% + clamp(260px, 22vw, 340px) + 40px)", top: "calc(5% + clamp(150px, 15vw, 210px))", bottom: "5%",
          width: "min(660px, 46vw)", overflowY: "auto",
          padding: "28px 32px", borderRadius: 14,
          background: "rgba(8, 13, 30, 0.82)", backdropFilter: "blur(10px)",
          border: `1px solid ${ACCENT}55`, boxShadow: `0 30px 80px rgba(0,0,0,0.6), inset 0 1px 0 ${ACCENT}33`,
        }}>
          {pane === "multiplayer" && (
            <MultiplayerLobby isMobile={isMobile} onBack={() => setPane("main")} onMatchStart={onMatchStart} />
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
              onDocumentary={startDocumentary}
            />
          )}
        </div>
      )}

      {/* 版本列（左下） */}
      {!isMobile && (
        <div style={{ position: "absolute", left: "7%", bottom: 18, fontSize: 12, color: "#475569", letterSpacing: 1 }}>
          Mini Taiwan Pulse · Wargame Edition
        </div>
      )}
    </div>
  );
}

// ── 選單按鈕 ──
function MenuButton({ label, testId, index, isMobile, active, pressKey, onHover, onClick }: {
  label: string; testId?: string; index: number; isMobile: boolean; active: boolean; pressKey: number;
  onHover: () => void; onClick: () => void;
}) {
  return (
    <button
      // pressKey 變動 → 重掛元素重播點擊掃光
      key={pressKey}
      onMouseEnter={onHover}
      onFocus={onHover}
      onClick={onClick}
      data-testid={testId}
      className={`wg-ld-menu wg-ld-menu-in${active ? " is-active" : ""}${pressKey ? " is-pressed" : ""}`}
      style={{
        animationDelay: `${0.15 + index * 0.08}s`,
        fontSize: isMobile ? 22 : "clamp(26px, 2.2vw, 34px)",
        padding: isMobile ? "12px 18px" : "14px 26px",
      }}
    >
      <span className="wg-ld-menu-label">{label}</span>
      <span className="wg-ld-menu-arrow">›</span>
    </button>
  );
}

// ── 主選單預覽卡（hover / ↑↓ 切換時淡入） ──
function PreviewCard({ id, title, desc }: { id: MenuId; title: string; desc: string }) {
  const art = LANDING_ART[id];
  return (
    <div className="wg-ld-panel" style={{
      position: "absolute", zIndex: 2,
      left: "calc(7% + clamp(260px, 22vw, 340px) + 40px)",
      top: "calc(5% + clamp(150px, 15vw, 210px))",
      width: "min(440px, 32vw)",
      borderRadius: 12, overflow: "hidden",
      background: "rgba(8, 13, 30, 0.78)", backdropFilter: "blur(8px)",
      border: `1px solid ${ACCENT}55`, boxShadow: "0 24px 60px rgba(0,0,0,0.55)",
    }}>
      <div style={{
        height: "min(230px, 17vw)",
        backgroundImage: `url(${art.src})`, backgroundSize: "cover", backgroundPosition: art.position,
        borderBottom: `2px solid ${ACCENT}`,
      }} className="wg-ld-art" />
      <div style={{ padding: "16px 20px 18px" }}>
        <div style={{ fontSize: 22, fontWeight: 800, color: ACCENT, letterSpacing: 2 }}>{title}</div>
        <div style={{ marginTop: 6, fontSize: 15, color: "#cbd5e1", lineHeight: 1.7 }}>{desc}</div>
      </div>
    </div>
  );
}

/** 右上角語言切換 — 「中文 | English」 */
function LangPicker({ isMobile }: { isMobile: boolean }) {
  const lang = useLang();
  const btn = (on: boolean): React.CSSProperties => ({
    padding: isMobile ? "4px 10px" : "6px 14px", borderRadius: 6,
    fontSize: isMobile ? 13 : 15, fontWeight: 600, cursor: "pointer", fontFamily: "inherit",
    border: `1px solid ${on ? ACCENT : "rgba(148, 163, 184, 0.4)"}`,
    background: on ? `${ACCENT}cc` : "rgba(15, 23, 42, 0.6)",
    color: on ? "#fff" : "#cbd5e1",
  });
  return (
    <div className="wg-ld-in" style={{
      position: "absolute", zIndex: 4,
      top: isMobile ? "calc(env(safe-area-inset-top, 0px) + 12px)" : 20, right: isMobile ? 12 : 24,
      display: "flex", gap: 6, alignItems: "center",
    }}>
      {!isMobile && <span style={{ fontSize: 13, color: "#e2e8f0", marginRight: 4, textShadow: "0 1px 6px rgba(0,0,0,0.9)" }}>語言 / Language</span>}
      <button className="wg-btn" onClick={() => langStore.set("zh")} style={btn(lang === "zh")}>中文</button>
      <button className="wg-btn" onClick={() => langStore.set("en")} style={btn(lang === "en")}>English</button>
    </div>
  );
}

// ── 戰役面板 ──
function CampaignPane({
  isMobile,
  selectedScenarioId, setSelectedScenarioId,
  selectedSide, setSelectedSide,
  onBack, onStart, onDocumentary,
}: {
  isMobile: boolean;
  selectedScenarioId: string | null;
  setSelectedScenarioId: (id: string) => void;
  selectedSide: ActiveView;
  setSelectedSide: (s: ActiveView) => void;
  onBack: () => void;
  onStart: () => void;
  onDocumentary: () => void;
}) {
  const lang = useLang();
  const stepTwoRef = useRef<HTMLDivElement>(null);
  const selectedEntry = SCENARIO_REGISTRY.find((e) => e.scenario.id === selectedScenarioId);
  // 選了場景 → 把「扮演陣營 + 進入戰役」捲進視野
  useEffect(() => {
    if (selectedScenarioId) stepTwoRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }, [selectedScenarioId]);
  const availableSides = selectedEntry
    ? selectedEntry.scenario.sides.filter((s) => s.isHostileTo.length > 0 || s.isPlayer)
    : [];

  return (
    <div>
      <button onClick={onBack} className="wg-btn" style={{
        background: "transparent", border: "none", color: "#94a3b8", fontSize: 15, cursor: "pointer",
        display: "flex", alignItems: "center", gap: 4, marginBottom: 12, padding: 0, fontFamily: "inherit",
      }}>
        <ArrowLeft size={14} /> {lang === "en" ? "Back (Esc)" : "回主選單（Esc）"}
      </button>

      <div style={{ fontSize: 26, fontWeight: 800, color: ACCENT, letterSpacing: 3, marginBottom: 14 }}>
        {lang === "en" ? "Campaign" : "戰役"}
      </div>

      {/* 戰史紀錄片快速入口 */}
      <button onClick={onDocumentary} className="wg-btn wg-ld-feature" style={{
        width: "100%", display: "flex", alignItems: "center", gap: 14, padding: "12px 16px", marginBottom: 18,
        borderRadius: 8, border: `1px solid ${ACCENT}88`, cursor: "pointer", fontFamily: "inherit", textAlign: "left",
        background: `linear-gradient(90deg, ${ACCENT}33, rgba(15,23,42,0.4))`, color: "#e2e8f0",
      }}>
        <Clapperboard size={26} color={ACCENT} style={{ flexShrink: 0 }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 17, fontWeight: 700 }}>
            {lang === "en" ? "War History Documentary · 823 Bombardment" : "戰史紀錄片 · 823 砲戰"}
          </div>
          <div style={{ fontSize: 13, color: "#cbd5e1", marginTop: 2 }}>
            {lang === "en" ? "Auto cinematic camera + bilingual narration. Space to pause." : "自動運鏡 + 雙語旁白重現 1958 金門砲戰。Space 暫停。"}
          </div>
        </div>
        <Play size={18} fill="currentColor" color={ACCENT} />
      </button>

      <StepLabel>{lang === "en" ? "Step 1 · Scenario" : "第一步 · 選擇場景"}</StepLabel>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 20 }}>
        {SCENARIO_REGISTRY.map((entry) => {
          const active = entry.scenario.id === selectedScenarioId;
          return (
            <button
              key={entry.scenario.id}
              data-testid={`landing-scenario-${entry.scenario.id}`}
              onClick={() => setSelectedScenarioId(entry.scenario.id)}
              className="wg-btn"
              style={{
                padding: "11px 14px",
                background: active ? `${ACCENT}2e` : "rgba(30, 41, 59, 0.5)",
                border: `1px solid ${active ? ACCENT : "rgba(148, 163, 184, 0.2)"}`,
                borderLeft: `3px solid ${active ? ACCENT : "transparent"}`,
                borderRadius: 6, color: "#e2e8f0", cursor: "pointer", fontFamily: "inherit", textAlign: "left",
              }}
            >
              <div style={{
                fontSize: isMobile ? 15 : 17, fontWeight: 600, color: active ? "#fdba74" : "#e2e8f0",
                display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap",
              }}>
                {entry.scenario.displayName}
                {entry.tags?.map((t) => (
                  <span key={t} style={{
                    fontSize: 12, padding: "1px 6px", background: "rgba(59, 130, 246, 0.15)", color: "#93c5fd",
                    borderRadius: 3, fontFamily: "ui-monospace, monospace",
                  }}>{t}</span>
                ))}
              </div>
              <div style={{ fontSize: 14, color: "#94a3b8", marginTop: 3 }}>{entry.shortDescription}</div>
            </button>
          );
        })}
      </div>

      {selectedEntry && (
        <div className="wg-ld-in" ref={stepTwoRef}>
          <StepLabel>{lang === "en" ? "Step 2 · Side" : "第二步 · 扮演陣營"}</StepLabel>
          <div style={{ display: "flex", gap: 8, marginBottom: 20, flexWrap: isMobile ? "wrap" : undefined }}>
            {availableSides.map((s) => {
              const c = SIDE_COLORS[s.id].primary;
              const active = s.id === selectedSide;
              return (
                <button key={s.id} onClick={() => setSelectedSide(s.id)} className="wg-btn" style={sideBtn(active, c, isMobile)}>
                  <span style={{ width: 10, height: 10, borderRadius: "50%", background: c, boxShadow: active ? `0 0 8px ${c}` : "none" }} />
                  {s.displayName}
                </button>
              );
            })}
            <button onClick={() => setSelectedSide("spectator")} className="wg-btn"
              style={sideBtn(selectedSide === "spectator", "#475569", isMobile)}>
              <Globe size={14} />
              {lang === "en" ? "Spectator" : "全局觀察"}
            </button>
          </div>

          <button onClick={onStart} data-testid="landing-start" className="wg-btn wg-ld-start" style={{
            width: "100%", padding: isMobile ? "12px 20px" : "14px 24px",
            background: `linear-gradient(90deg, ${ACCENT}, #f59e0b)`, color: "#fff", border: "none", borderRadius: 8,
            fontSize: isMobile ? 16 : 20, fontWeight: 800, letterSpacing: 2, cursor: "pointer", fontFamily: "inherit",
            display: "flex", alignItems: "center", justifyContent: "center", gap: 8,
            boxShadow: `0 8px 24px ${ACCENT}55`,
          }}>
            <Play size={16} fill="currentColor" /> {lang === "en" ? "Deploy" : "進入戰役"}
          </button>
        </div>
      )}
    </div>
  );
}

function StepLabel({ children }: { children: React.ReactNode }) {
  return <div style={{ fontSize: 14, color: "#fdba74", letterSpacing: 1, fontWeight: 700, marginBottom: 8 }}>{children}</div>;
}

function sideBtn(active: boolean, c: string, isMobile: boolean): React.CSSProperties {
  return {
    flex: 1, minWidth: isMobile ? "45%" : undefined, padding: "11px 10px",
    background: active ? c : "rgba(30, 41, 59, 0.5)",
    border: `1px solid ${active ? c : "rgba(148, 163, 184, 0.3)"}`,
    borderRadius: 6, color: active ? "#fff" : "#cbd5e1", cursor: "pointer", fontFamily: "inherit",
    fontSize: isMobile ? 14 : 16, fontWeight: active ? 700 : 500,
    display: "flex", alignItems: "center", gap: 8, justifyContent: "center",
  };
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
