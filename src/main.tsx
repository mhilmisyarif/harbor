import React, { ReactNode } from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Bar } from "./bar/Bar";
import { Card } from "./card/Card";
import { Dock } from "./dock/Dock";
import { Notch } from "./notch/Notch";
import { useConfig } from "./lib/config";
import { Preview } from "./preview/Preview";
import { Settings } from "./settings/Settings";
import { Widgets } from "./widgets/Widgets";
import "./themes.css";
import "./styles.css";
import "./widgets/widgets.css";
import "./card/card.css";
import "./settings/settings.css";
import "./preview/preview.css";
import "./notch/notch.css";

// One bundle serves every window; the window label picks the surface.
const label = getCurrentWindow().label;
document.body.dataset.surface = label;

const surfaces: Record<string, () => JSX.Element | null> = {
  bar: Bar,
  dock: Dock,
  widgets: Widgets,
  settings: Settings,
  card: Card,
  preview: Preview,
  notch: Notch,
};
const Surface = surfaces[label] ?? Dock;

/** Applies Settings → Appearance to this window (the settings window keeps its own look). */
function Themed({ children }: { children: ReactNode }) {
  const [config] = useConfig();
  const style = config?.appearance.style ?? "glass";
  // Set during render so children (e.g. Backdrop) see the new style immediately.
  if (label !== "settings" && document.body.dataset.style !== style) document.body.dataset.style = style;
  return <>{children}</>;
}

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <Themed>
      <Surface />
    </Themed>
  </React.StrictMode>,
);
