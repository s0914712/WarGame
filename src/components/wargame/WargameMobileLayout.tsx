/**
 * 行動版控制樹容器 — 由 WargameApp 在 isMobile 時掛載（取代整組桌面控制）。
 *
 * 結構：頂部精簡 HUD + 底部 dock（一排導航列 + 可展開面板）+ 規劃控制列。
 * 地圖與所有 modal 仍由 WargameApp 共用渲染。
 */
import { useState } from "react";
import type { Map as MapboxMap } from "mapbox-gl";
import { WargameMobileTopBar } from "./WargameMobileTopBar";
import { WargameMobileDock } from "./WargameMobileDock";
import { WargamePlanControls } from "./WargamePlanControls";

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

  return (
    <>
      <WargameMobileTopBar />
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
