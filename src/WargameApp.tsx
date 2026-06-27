import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import "./wargame/styles.css";
import { Bot, GraduationCap, Swords } from "lucide-react";
import { WargameClockHUD } from "./components/WargameClockHUD";
import { UnitEditorPanel } from "./components/UnitEditorPanel";
import { LLMPanel } from "./components/LLMPanel";
import { EngagementLog } from "./components/EngagementLog";
import { PovSwitcher } from "./components/PovSwitcher";
import { ReplayPanel } from "./components/ReplayPanel";
import { CinemaControls } from "./components/CinemaControls";
import { BattleStatsHud } from "./components/BattleStatsHud";
import { UnitPalette } from "./components/UnitPalette";
import { MapStyleSwitcher } from "./components/MapStyleSwitcher";
import { ScenarioPicker } from "./components/ScenarioPicker";
import { DemoModeToggle } from "./components/DemoModeToggle";
import { TutorialOverlay, launchTutorial } from "./components/TutorialOverlay";
import { VictoryModal } from "./components/VictoryModal";
import { ScenarioBriefingModal } from "./components/ScenarioBriefingModal";
import { AcousticEnvironmentConfigModal } from "./components/AcousticEnvironmentConfigModal";
import { UICheatSheet } from "./components/UICheatSheet";
import { LandingScreen } from "./components/LandingScreen";
import { HelpCircle, Menu } from "lucide-react";
import { uiStore } from "./wargame/uiStore";
import { attachWargameCombatLayer } from "./map/wargameCombatLayer";
import { attachWargameRadarLayer } from "./map/wargameRadarLayer";
import { attachWargameWrecksLayer } from "./map/wargameWrecksLayer";
import { attachWargameSelectionLayer } from "./map/wargameSelectionLayer";
import { useCameraFollow } from "./hooks/useCameraFollow";
import { scenarioStore } from "./wargame/scenarioStore";
import { editorStore } from "./wargame/editor/editorStore";
import { attachWargameRangeRings } from "./map/wargameRangeRings";
import { attachWargameSymbolLayer, SYMBOL_LAYER_ID } from "./map/wargameSymbolLayer";
import { attachWargameRouteLayer } from "./map/wargameRouteLayer";
import { attachWargameSonobuoyLayer } from "./map/wargameSonobuoyLayer";
import { attachWargameBearingLayer } from "./map/wargameBearingLayer";
import { loadWargameSymbols } from "./wargame/symbology/loadSymbols";
import { registerFlagMarkers } from "./wargame/symbology/flagMarkers";
import { useSimLoop } from "./hooks/useSimLoop";
import { useAiSideLoop } from "./hooks/useAiSideLoop";
import { DEFAULT_STYLE_ID, getStyleById } from "./wargame/mapStyles";
import { useIsMobile } from "./hooks/useIsMobile";
import { WargameMobileLayout } from "./components/wargame/WargameMobileLayout";

/**
 * 兵推模式頂層 app。
 *
 * 結構：
 *   - useEffect 初始化 mapbox map
 *   - mountAllLayers() 包成函式，可在 setStyle 後重新呼叫
 *   - style 切換：先 detach → setStyle → on style.load → mount 重新掛
 */
function isDemo() { return uiStore.isDemoMode(); }

export default function WargameApp() {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<mapboxgl.Map | null>(null);
  const detachersRef = useRef<(() => void)[]>([]);
  const [mapReady, setMapReady] = useState(false);
  const [llmOpen, setLlmOpen] = useState(false);
  const [styleId, setStyleId] = useState(DEFAULT_STYLE_ID);
  const [briefingOpen, setBriefingOpen] = useState(false);
  const [cheatOpen, setCheatOpen] = useState(false);
  const demoMode = useSyncExternalStore(uiStore.subscribe, isDemo, isDemo);
  const { isMobile, isLandscape } = useIsMobile();

  useSimLoop();
  useAiSideLoop();
  useCameraFollow(mapRef.current);

  function mountAllLayers(map: mapboxgl.Map) {
    // 清掉先前的（safety — 不該有，但保險）
    for (const d of detachersRef.current) d();
    detachersRef.current = [];

    loadWargameSymbols(map);
    registerFlagMarkers(map);
    detachersRef.current.push(
      attachWargameRadarLayer(map),
      attachWargameSelectionLayer(map),
      attachWargameSymbolLayer(map),
      attachWargameRangeRings(map),
      attachWargameRouteLayer(map),
      attachWargameWrecksLayer(map),
      attachWargameSonobuoyLayer(map),
      attachWargameBearingLayer(map),
      attachWargameCombatLayer(map),
    );
  }

  useEffect(() => {
    if (!mapContainerRef.current) return;

    mapboxgl.accessToken = import.meta.env.VITE_MAPBOX_TOKEN;
    // 預設用 empty 場景的相機（台海中線）；LandingScreen 選完場景才會 loadScenario + flyTo
    const scenario = scenarioStore.getState().scenario;

    const map = new mapboxgl.Map({
      container: mapContainerRef.current,
      style: getStyleById(DEFAULT_STYLE_ID).url,
      center: scenario.camera.center,
      zoom: scenario.camera.zoom,
      pitch: scenario.camera.pitch,
      bearing: scenario.camera.bearing,
      antialias: true,
    });
    mapRef.current = map;

    map.on("load", () => {
      mountAllLayers(map);

      // Click：三種模式（view / planRoute / placeUnit）
      map.on("click", (e) => {
        const mode = editorStore.getMode();
        if (mode === "planRoute") {
          editorStore.appendWaypoint(e.lngLat.lng, e.lngLat.lat);
          return;
        }
        if (mode === "defineSonobuoyArea") {
          editorStore.setSonobuoyCorner(e.lngLat.lng, e.lngLat.lat);
          return;
        }
        if (mode === "placeUnit") {
          const features = map.queryRenderedFeatures(e.point, { layers: [SYMBOL_LAYER_ID] });
          if (features.length > 0) {
            const unitId = features[0]?.properties?.unitId as string | undefined;
            if (unitId) { scenarioStore.setSelectedUnitId(unitId); return; }
          }
          editorStore.placeUnitAt(e.lngLat.lng, e.lngLat.lat);
          return;
        }
        const features = map.queryRenderedFeatures(e.point, { layers: [SYMBOL_LAYER_ID] });
        if (features.length > 0) {
          const unitId = features[0]?.properties?.unitId as string | undefined;
          if (unitId) { scenarioStore.setSelectedUnitId(unitId); return; }
        }
        scenarioStore.setSelectedUnitId(null);
      });

      // 右鍵：RTS 式指令（已選單位）。
      //   右鍵點到敵方單位 → 下達「接戰」攻擊計畫
      //   右鍵點空白海面 → 移動（Shift = 接續排隊航點）
      map.on("contextmenu", (e) => {
        if (editorStore.getMode() !== "view") return;   // 規劃 / 放置模式不攔右鍵
        const unitId = scenarioStore.getSelectedUnitId();
        if (!unitId) return;
        e.preventDefault();
        // 先判斷右鍵是否點在某個單位上
        const feats = map.queryRenderedFeatures(e.point, { layers: [SYMBOL_LAYER_ID] });
        const targetId = feats.length > 0 ? (feats[0]?.properties?.unitId as string | undefined) : undefined;
        if (targetId && editorStore.quickEngage(unitId, targetId)) return;   // 攻擊敵方單位
        const additive = (e.originalEvent as MouseEvent).shiftKey;
        editorStore.quickMove(unitId, e.lngLat.lng, e.lngLat.lat, additive);
      });

      // cursor
      const updateCursor = () => {
        const canvas = map.getCanvas();
        const mode = editorStore.getMode();
        canvas.style.cursor = (mode === "planRoute" || mode === "placeUnit" || mode === "defineSonobuoyArea") ? "crosshair" : "";
      };
      editorStore.subscribe(updateCursor);
      map.on("mouseenter", SYMBOL_LAYER_ID, () => {
        if (editorStore.getMode() === "view") map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", SYMBOL_LAYER_ID, () => {
        if (editorStore.getMode() === "view") map.getCanvas().style.cursor = "";
      });

      setMapReady(true);
    });

    return () => {
      for (const d of detachersRef.current) d();
      detachersRef.current = [];
      map.remove();
      mapRef.current = null;
    };
  }, []);

  // 處理底圖切換：detach → setStyle → 等 load 事件 → re-mount
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    const target = getStyleById(styleId);
    const current = map.getStyle();
    if (current?.sprite?.toString().includes(target.id)) return;  // 簡單避免重複

    for (const d of detachersRef.current) d();
    detachersRef.current = [];

    map.setStyle(target.url);
    map.once("style.load", () => {
      // setStyle 完成 → 重新掛 wargame layer 集合
      mountAllLayers(map);
    });
  }, [styleId, mapReady]);

  return (
    <div style={{ position: "relative", width: "100vw", height: "100vh", background: "#020617" }}>
      <div ref={mapContainerRef} style={{ position: "absolute", inset: 0 }} />

      {/* Demo Mode 永遠保留：戰況 + Demo 退出鈕。
          行動版正常模式時戰況改由頂部列渲染，故這裡只在桌面或 demo 時掛 */}
      {(!isMobile || demoMode) && <BattleStatsHud isMobile={isMobile} />}
      <DemoModeToggle isMobile={isMobile} />
      <TutorialOverlay />
      <VictoryModal />
      {/* 場景 briefing 等地圖載完才掛，避免首次 race 顯示空場景 */}
      {mapReady && (
        briefingOpen
          ? <ScenarioBriefingModal open onClose={() => setBriefingOpen(false)} />
          : <ScenarioBriefingModal />
      )}
      <UICheatSheet open={cheatOpen} onClose={() => setCheatOpen(false)} />
      <AcousticEnvironmentConfigModal />
      <LandingScreen map={mapRef.current} />
      {/* LLM 面板：桌面 / 行動版共用（行動版由選單抽屜開啟），故移出 !demoMode 分支 */}
      <LLMPanel open={llmOpen} onClose={() => setLlmOpen(false)} />

      {/* Demo Mode 隱藏所有其他控制 */}
      {!demoMode && (
        isMobile ? (
          <WargameMobileLayout
            map={mapRef.current}
            isLandscape={isLandscape}
            styleId={styleId}
            onStyleChange={setStyleId}
            onOpenLlm={() => setLlmOpen(true)}
            onOpenBriefing={() => setBriefingOpen(true)}
            onOpenCheat={() => setCheatOpen(true)}
          />
        ) : (
        <>
          <WargameClockHUD />
          <MapStyleSwitcher selectedId={styleId} onChange={setStyleId} />
          <ScenarioPicker map={mapRef.current} />
          <PovSwitcher />
          <UnitPalette />
          <UnitEditorPanel />
          <EngagementLog />
          <ReplayPanel />
          <CinemaControls map={mapRef.current} />

          <button
            onClick={() => setLlmOpen(true)}
            className="wg-btn"
            style={{
              position: "absolute", bottom: 16, right: 16, zIndex: 25,
              padding: "10px 16px",
              background: "rgba(59, 130, 246, 0.9)", color: "#fff",
              border: "1px solid rgba(147, 197, 253, 0.5)", borderRadius: 8,
              fontSize: 19, fontWeight: 600, cursor: "pointer",
              fontFamily: "ui-sans-serif, system-ui, sans-serif",
              boxShadow: "0 4px 12px rgba(0,0,0,0.3)",
              display: "flex", alignItems: "center", gap: 6,
            }}
          >
            <Bot size={16} /> LLM 介接
          </button>

          {/* 返回主選單 + 場景簡報 / 教學 / 介面說明 — 在 LLM 鈕左邊 */}
          <div style={{
            position: "absolute", bottom: 16, right: 156, zIndex: 25,
            display: "flex", gap: 6,
          }}>
            <button
              onClick={() => uiStore.setLandingOpen(true)}
              title="返回主選單"
              className="wg-btn"
              style={iconBtn}
            >
              <Menu size={16} />
            </button>
            <button
              onClick={() => setBriefingOpen(true)}
              title="場景簡報（briefing + 兵力 + 勝負條件）"
              className="wg-btn"
              style={iconBtn}
            >
              <Swords size={16} />
            </button>
            <button
              onClick={launchTutorial}
              title="UI 教學導覽（8 步 walkthrough）"
              className="wg-btn"
              style={iconBtn}
            >
              <GraduationCap size={16} />
            </button>
            <button
              onClick={() => setCheatOpen(true)}
              title="介面說明速查表"
              className="wg-btn"
              style={iconBtn}
            >
              <HelpCircle size={16} />
            </button>
          </div>

          <div
            style={{
              position: "absolute",
              bottom: 16,
              left: "50%",
              transform: "translateX(-50%)",
              zIndex: 20,
              padding: "6px 12px",
              background: "rgba(15, 23, 42, 0.7)",
              border: "1px solid rgba(148, 163, 184, 0.2)",
              borderRadius: 6,
              color: "#94a3b8",
              fontSize: 15,
              fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
            }}
          >
            Space: 暫停/繼續 · 1/2/3/4: 速率 · 點符號編輯 · Enter 套用航線
          </div>
        </>
        )
      )}

      {!mapReady && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: "#94a3b8",
            background: "#020617",
            zIndex: 10,
          }}
        >
          Loading…
        </div>
      )}
    </div>
  );
}

const iconBtn: React.CSSProperties = {
  width: 38, height: 38,
  borderRadius: 8,
  background: "rgba(15, 23, 42, 0.85)",
  color: "#cbd5e1",
  border: "1px solid rgba(148, 163, 184, 0.3)",
  cursor: "pointer",
  display: "flex", alignItems: "center", justifyContent: "center",
};
