/**
 * 主選單美術素材。背景取自設計稿（WarGame of Taiwan 簡報）；
 * 四張選單預覽插圖依背景風格生成（台海暮色 + 全息戰術格線，無文字 / 旗幟）。
 * 經 Vite import → 自動加 hash 與 GitHub Pages base path。
 */
import bg from "../assets/landing/bg.webp";
import campaign from "../assets/landing/campaign.webp";
import multiplayer from "../assets/landing/multiplayer.webp";
import custom from "../assets/landing/custom.webp";
import tutorial from "../assets/landing/tutorial.webp";

export const LANDING_BG = bg;

export interface LandingArt { src: string; position: string }

export const LANDING_ART: Record<"campaign" | "multiplayer" | "custom" | "tutorial", LandingArt> = {
  campaign: { src: campaign, position: "50% 45%" },
  multiplayer: { src: multiplayer, position: "50% 50%" },
  custom: { src: custom, position: "50% 55%" },
  tutorial: { src: tutorial, position: "55% 60%" },
};
