/**
 * 行動版控制樹容器 — 由 WargameApp 在 isMobile 時掛載（取代整組桌面控制）。
 *
 * 地圖與所有 modal（Landing / Victory / Briefing / Tutorial / LLM / CheatSheet）
 * 仍由 WargameApp 共用渲染；此元件只負責行動版的控制 UI。
 */
import { useState } from "react";
import type { Map as MapboxMap } from "mapbox-gl";
import { WargameMobileTopBar } from "./WargameMobileTopBar";
import { WargameMobileSheet } from "./WargameMobileSheet";
import { WargameMobileMenu } from "./WargameMobileMenu";
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
  const [menuOpen, setMenuOpen] = useState(false);
  const [sheetHeight, setSheetHeight] = useState(80);

  return (
    <>
      <WargameMobileTopBar onOpenMenu={() => setMenuOpen(true)} />
      <WargameMobileSheet isLandscape={isLandscape} onHeightChange={setSheetHeight} />
      <WargamePlanControls bottomOffset={sheetHeight + 8} />
      <WargameMobileMenu
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        map={map}
        styleId={styleId}
        onStyleChange={onStyleChange}
        onOpenLlm={onOpenLlm}
        onOpenBriefing={onOpenBriefing}
        onOpenCheat={onOpenCheat}
      />
    </>
  );
}
