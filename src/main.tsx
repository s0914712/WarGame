import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import WargameApp from "./WargameApp";
import SearchPlannerApp from "./SearchPlannerApp";

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Root element not found");

// 預設 Wargame；?mode=civilian 看原視覺化版本；?mode=search 進獨立搜索規劃器
const mode = new URLSearchParams(window.location.search).get("mode");
const Root = mode === "civilian" ? App
  : mode === "search" ? SearchPlannerApp
  : WargameApp;

createRoot(rootEl).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
