import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { HashRouter } from "react-router-dom";
import "@assent/ui/styles.css"; // reserved-hue design tokens + the citation highlight
import "./app.css";
import { App } from "./App";

// HashRouter: the built bundle loads from `file://` inside the Tauri webview,
// where only hash-based routing survives without a server rewriting paths.
const el = document.getElementById("root");
if (!el) throw new Error("#root not found");

createRoot(el).render(
  <StrictMode>
    <HashRouter>
      <App />
    </HashRouter>
  </StrictMode>,
);
