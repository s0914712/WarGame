import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import WargameApp from "./WargameApp";

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Root element not found");

// 預設 Wargame；要看原 civilian 版本加 ?mode=civilian
const mode = new URLSearchParams(window.location.search).get("mode");
const Root = mode === "civilian" ? App : WargameApp;

createRoot(rootEl).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
