import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { applyColorTheme } from "./themes/colorTheme";
import { applyTextSize } from "./themes/textSize";
import { applyUiFit } from "./lib/uiFit";

applyColorTheme();
applyTextSize();
applyUiFit();

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
