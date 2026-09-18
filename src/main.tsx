import React from "react";
import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { applyColorTheme } from "./themes/colorTheme";
import { applyTextSize } from "./themes/textSize";
import { applyUiFit } from "./lib/uiFit";
import { pinCityApiFromPageOrigin } from "./lib/api/config";

pinCityApiFromPageOrigin();
applyColorTheme();
applyTextSize();
applyUiFit();
if (typeof window !== "undefined") {
  window.setInterval(() => pinCityApiFromPageOrigin(), 1500);
}

applyColorTheme();
applyTextSize();
applyUiFit();

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
