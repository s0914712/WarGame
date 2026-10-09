/**
 * 行動版控制樹容器 — 由 WargameApp 在 isMobile 時掛載（取代整組桌面控制）。
 *
 * 結構：頂部精簡 HUD + 底部 dock（一排導航列 + 可展開面板）+ 規劃控制列。
 * 地圖與所有 modal 仍由 WargameApp 共用渲染。
 */
import { useState } from "react";
import { HexToolbar } from "./HexToolbar";
import type { Map as MapboxMap } from "mapbox-gl";
import { WargameMobileTopBar } from "./WargameMobileTopBar";
import { WargameMobileDock } from "./WargameMobileDock";
import { WargamePlanControls } from "./WargamePlanControls";
import { AssetPanel } from "./AssetPanel";
import { RulerControl } from "../RulerControl";
import { useLang } from "../../wargame/i18n/lang";

interface Props {
  map: MapboxMap | null;
  isLandscape: boolean;
  styleId: string;
  onStyleChange: (id: string) => void;
  onOpenLlm: () => void;
  onOpenBriefing: () => void;
  onOpenCheat: () => void;
}

export function WargameMobileLayout({
  map, isLandscape, styleId, onStyleChange, onOpenLlm, onOpenBriefing, onOpenCheat,
}: Props) {
  const [dockHeight, setDockHeight] = useState(56);
  const lang = useLang() === "en" ? "en" : "zh";

  return (
    <>
      <WargameMobileTopBar />
      <HexToolbar top={64} isMobile />
      {/* 資產（攻擊優序）與尺規：入口在「設定」分頁的動作鈕 */}
      <AssetPanel top={64} left={8} width="calc(100vw - 16px)" maxHeight={`calc(100dvh - ${64 + dockHeight + 16}px)`} />
      <RulerControl hideLauncher lang={lang} style={{ top: 64, left: 8 }} />
      <WargameMobileDock
        map={map}
        isLandscape={isLandscape}
        styleId={styleId}
        onStyleChange={onStyleChange}
        onOpenLlm={onOpenLlm}
        onOpenBriefing={onOpenBriefing}
        onOpenCheat={onOpenCheat}
        onHeightChange={setDockHeight}
      />
      <WargamePlanControls bottomOffset={dockHeight + 8} />
    </>
  );
}
