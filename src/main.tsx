import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import WargameApp from "./WargameApp";

const rootEl = document.getElementById("root");
if (!rootEl) throw new Error("Root element not found");

const mode = new URLSearchParams(window.location.search).get("mode");
const Root = mode === "wargame" ? WargameApp : App;

createRoot(rootEl).render(
  <StrictMode>
    <Root />
  </StrictMode>,
);
