import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import WargameApp from "./WargameApp";
import SearchPlannerApp from "./SearchPlannerApp";
import { bootLoader } from "./lib/bootLoader";

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Root element not found");

// 預設 Wargame；?mode=civilian 看原視覺化版本；?mode=search 進獨立搜索規劃器
const mode = new URLSearchParams(window.location.search).get("mode");
const Root = mode === "civilian" ? App
  : mode === "search" ? SearchPlannerApp
  : WargameApp;

// 開機畫面：兵棋模式由 WargameApp 回報載入階段後收起；其他模式自有載入畫面，程式到位即收起
if (Root === WargameApp) bootLoader.stage(45, 55, "初始化地圖引擎…", "Starting map engine…");
else bootLoader.done();

createRoot(rootEl).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
