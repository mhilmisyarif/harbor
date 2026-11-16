import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { api, WIDGET_CONFIG_EVENT, WidgetConfig } from "./api";

/**
 * Widget settings (shared location, units, symbols and the panel layout).
 * Follows the backend's `widget-config-changed` broadcast like `useConfig`.
 */
export function useWidgetConfig() {
  const [config, setState] = useState<WidgetConfig | null>(null);
  const latest = useRef<WidgetConfig | null>(null);
  const set = (c: WidgetConfig) => {
    latest.current = c;
    setState(c);
  };
  useEffect(() => {
    let alive = true;
    api.loadWidgetConfig().then((c) => alive && set(c));
    const off = listen<WidgetConfig>(WIDGET_CONFIG_EVENT, (e) => set(e.payload));
    return () => {
      alive = false;
      off.then((f) => f());
    };
  }, []);
  const update = useCallback((change: (c: WidgetConfig) => WidgetConfig) => {
    if (!latest.current) return;
    const next = change(latest.current);
    set(next);
    api.saveWidgetConfig(next).catch(console.error);
  }, []);
  const updateShared = useCallback(
    (patch: Partial<WidgetConfig>) => update((c) => ({ ...c, ...patch })),
    [update],
  );
  return [config, update, updateShared] as const;
}
