import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import mapboxgl from "mapbox-gl";
import "mapbox-gl/dist/mapbox-gl.css";
import "./wargame/styles.css";
import { LLMPanel } from "./components/LLMPanel";
import { CinemaControls } from "./components/CinemaControls";
import { BattleStatsHud } from "./components/BattleStatsHud";
import { UnitPalette } from "./components/UnitPalette";
import { SearchPlannerPanel } from "./components/SearchPlannerPanel";
import { attachRulerLayer, rulerStore } from "./map/rulerTool";
import { attachWargameReconLayer } from "./map/wargameReconLayer";
import { RulerControl } from "./components/RulerControl";
import { AssetPanel, ASSET_PANEL_WIDTH, assetPanelStore } from "./components/wargame/AssetPanel";
import { useLang } from "./wargame/i18n/lang";
import { DemoModeToggle } from "./components/DemoModeToggle";
import { TutorialOverlay } from "./components/TutorialOverlay";
import { VictoryModal } from "./components/VictoryModal";
import { ScenarioBriefingModal } from "./components/ScenarioBriefingModal";
import { AcousticEnvironmentConfigModal } from "./components/AcousticEnvironmentConfigModal";
import { UICheatSheet } from "./components/UICheatSheet";
import { LandingScreen } from "./components/LandingScreen";
import { PlayerRosterHUD } from "./components/PlayerRosterHUD";
import { uiStore } from "./wargame/uiStore";
import { attachWargameCombatLayer } from "./map/wargameCombatLayer";
import { attachWargameSearchLayer } from "./map/wargameSearchLayer";
import { searchPlannerStore } from "./wargame/search/searchPlannerStore";
import { attachWargameHexLayer } from "./map/wargameHexLayer";
import { attachWargameObjectiveLayer } from "./map/wargameObjectiveLayer";
import { attachWargameFxLayer } from "./map/wargameFxLayer";
import { attachWargameCommandPingLayer } from "./map/wargameCommandPingLayer";
import { ObjectivesHud } from "./components/wargame/ObjectivesHud";
import { ThreatAlert } from "./components/wargame/ThreatAlert";
import { hexStore } from "./wargame/hex/hexStore";
import { HexToolbar } from "./components/wargame/HexToolbar";
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
import { DesktopTopBar, TOP_BAR_HEIGHT } from "./components/wargame/DesktopTopBar";
import { CommandConsole, CONSOLE_HEIGHT } from "./components/wargame/CommandConsole";

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
  const uiLang = useLang() === "en" ? "en" : "zh";
  const assetOpen = useSyncExternalStore(assetPanelStore.subscribe, assetPanelStore.isOpen, assetPanelStore.isOpen);

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
      attachWargameHexLayer(map),   // 最底：六角格 / 勢力範圍壓在所有兵棋圖層下
      attachWargameObjectiveLayer(map),
      attachWargameRadarLayer(map),
      attachWargameSelectionLayer(map),
      attachWargameSymbolLayer(map),
      attachWargameRangeRings(map),
      attachWargameRouteLayer(map),
      attachWargameWrecksLayer(map),
      attachWargameSonobuoyLayer(map),
      attachWargameSearchLayer(map),
      attachWargameReconLayer(map),   // 偵察盲區（資產面板 · 偵察計畫分頁）
      attachWargameBearingLayer(map),
      attachWargameCombatLayer(map),
      attachWargameCommandPingLayer(map),   // 右鍵 / 指令卡下令 → 攻擊準星 / 移動標記
      attachWargameFxLayer(map),    // 最上：浮動戰鬥文字 / 來襲警示環
      attachRulerLayer(map),   // 尺規量測（壓在最上，點擊優先）
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
        if (rulerStore.isActive()) return;  // 尺規量測中：點擊由 rulerTool 處理
        if (hexStore.getBrush()) return;   // 六角格塗色中：點擊由 hex layer 處理
        // 搜索規劃器繪製搜索區（點擊由 searchAreaDraw 處理；這裡只攔下，避免選到單位）
        if (searchPlannerStore.isPicking()) return;
        if (searchPlannerStore.isLoggingContact()) {
          searchPlannerStore.addContactAt(e.lngLat.lng, e.lngLat.lat);
          return;
        }
        if (searchPlannerStore.isPickingLkp()) {
          searchPlannerStore.setLkpAt(e.lngLat.lng, e.lngLat.lat);
          return;
        }
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
        if (rulerStore.isActive()) return;              // 尺規：右鍵 = 刪最後一點
        if (editorStore.getMode() !== "view") return;   // 規劃 / 放置模式不攔右鍵
        if (searchPlannerStore.isMapClickMode()) return;
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
        if (hexStore.getBrush()) { canvas.style.cursor = "crosshair"; return; }
        const picking = searchPlannerStore.isMapClickMode();
        canvas.style.cursor = (picking || mode === "planRoute" || mode === "placeUnit" || mode === "defineSonobuoyArea") ? "crosshair" : "";
      };
      editorStore.subscribe(updateCursor);
      searchPlannerStore.subscribe(updateCursor);
      map.on("mouseenter", SYMBOL_LAYER_ID, () => {
        if (editorStore.getMode() === "view" && !hexStore.getBrush()) map.getCanvas().style.cursor = "pointer";
      });
      map.on("mouseleave", SYMBOL_LAYER_ID, () => {
        if (editorStore.getMode() === "view" && !hexStore.getBrush()) map.getCanvas().style.cursor = "";
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

  // 桌面頂部列 + 底部控制台會蓋住地圖上下緣 → 鏡頭 padding 讓 flyTo / 置中落在可視區
  const desktopChrome = !isMobile && !demoMode;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    map.setPadding(desktopChrome
      ? { top: TOP_BAR_HEIGHT, bottom: CONSOLE_HEIGHT, left: 0, right: 0 }
      : { top: 0, bottom: 0, left: 0, right: 0 });
  }, [desktopChrome, mapReady]);

  // 處理底圖切換：detach → setStyle → 等 load 事件 → re-mount。
  // 以「已套用的底圖 id」判斷是否真的要換：mapReady 首次變 true 也會觸發此 effect，
  // 若此時 detach 再 setStyle(同一個 url)，Mapbox diff 出無變更而不發 style.load，
  // 所有兵棋圖層就掛不回來（原本以 sprite url 比對，遇到無 sprite 的樣式會失效）。
  const appliedStyleRef = useRef(DEFAULT_STYLE_ID);
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !mapReady) return;
    if (appliedStyleRef.current === styleId) return;
    appliedStyleRef.current = styleId;
    const target = getStyleById(styleId);

    for (const d of detachersRef.current) d();
    detachersRef.current = [];

    map.setStyle(target.url);
    map.once("style.load", () => {
      // setStyle 完成 → 重新掛 wargame layer 集合
      mountAllLayers(map);
    });
  }, [styleId, mapReady]);

  return (
    <div
      className={desktopChrome ? "wg-desktop-chrome" : undefined}
      style={{ position: "relative", width: "100vw", height: "100vh", background: "#020617" }}
    >
      <div ref={mapContainerRef} style={{ position: "absolute", inset: 0 }} />

      {/* Demo Mode 永遠保留：戰況 + Demo 退出鈕。
          行動版正常模式時戰況改由頂部列渲染，故這裡只在桌面或 demo 時掛 */}
      {demoMode && <BattleStatsHud isMobile={isMobile} />}
      {/* 非 demo 時入口在頂部列 ☰ 選單（桌面）/ 選單抽屜（行動），這裡只負責退出鈕 */}
      <DemoModeToggle isMobile={isMobile} hideEntry />
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
      <PlayerRosterHUD isMobile={isMobile} top={isMobile ? undefined : TOP_BAR_HEIGHT + 12} />
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
          {/* 桌面：頂部資訊列 + 星海式底部控制台（戰報 | 單位 | 指令卡），地圖中央淨空 */}
          <DesktopTopBar
            map={mapRef.current}
            styleId={styleId}
            onStyleChange={setStyleId}
            onOpenLlm={() => setLlmOpen(true)}
            onOpenBriefing={() => setBriefingOpen(true)}
            onOpenCheat={() => setCheatOpen(true)}
          />
          <HexToolbar top={TOP_BAR_HEIGHT + 12} />
          {/* 資產面板（攻擊優序）：入口在頂部列「資產」鈕 */}
          <AssetPanel top={TOP_BAR_HEIGHT + 12} />
          {/* 入口在頂部列「尺規」鈕；這裡只在量測中顯示控制面板（資產面板開著時讓到右側） */}
          <RulerControl hideLauncher lang={uiLang}
            style={{ top: TOP_BAR_HEIGHT + 12, left: assetOpen ? 16 + ASSET_PANEL_WIDTH + 12 : 16 }} />
          <ThreatAlert top={TOP_BAR_HEIGHT + 10} />
          <ObjectivesHud map={mapRef.current} bottom={CONSOLE_HEIGHT + 34} />
          <UnitPalette hideLauncher />
          <CommandConsole />
          {/* 搜索規劃器側欄：夾在頂部列與底部控制台之間；入口在頂部列「搜索」鈕 */}
          <SearchPlannerPanel insetTop={TOP_BAR_HEIGHT} insetBottom={CONSOLE_HEIGHT} />
          <CinemaControls map={mapRef.current} bottomOffset={CONSOLE_HEIGHT} />
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
