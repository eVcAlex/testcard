import React from "react";
import ReactDOM from "react-dom/client";
import { OverlayApp } from "./OverlayApp.js";
import "../styles/tokens.css";
import "../styles/base.css";
import "./overlay.css";

// The overlay always sits over black video — force the dark token set regardless of the
// app's theme choice.
document.documentElement.dataset["theme"] = "dark";

const root = document.getElementById("overlay-root");
if (root) {
  ReactDOM.createRoot(root).render(
    <React.StrictMode>
      <OverlayApp />
    </React.StrictMode>,
  );
}
