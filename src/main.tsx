import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Bar } from "./bar/Bar";
import { Dock } from "./dock/Dock";
import { Widgets } from "./widgets/Widgets";
import { Settings } from "./settings/Settings";
import "./styles.css";
import "./widgets/widgets.css";
import "./settings/settings.css";

// One bundle serves every window; the window label picks the surface.
const label = getCurrentWindow().label;
document.body.dataset.surface = label;

const surfaces: Record<string, () => JSX.Element | null> = {
  bar: Bar,
  dock: Dock,
  widgets: Widgets,
  settings: Settings,
};
const Surface = surfaces[label] ?? Dock;

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Surface />
  </React.StrictMode>,
);
