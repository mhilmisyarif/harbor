import { useCallback, useEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { api, CONFIG_EVENT, Config } from "./api";

/**
 * The shared dock/bar config. Every window loads it once and then follows the
 * backend's `config-changed` broadcast, so an edit in Settings (or a pin from
 * the dock) shows up everywhere without windows overwriting each other's
 * stale copies.
 */
export function useConfig() {
  const [config, setConfigState] = useState<Config | null>(null);
  const latest = useRef<Config | null>(null);
  const setConfig = (c: Config) => {
    latest.current = c;
    setConfigState(c);
  };

  useEffect(() => {
    let alive = true;
    api.loadConfig().then((c) => alive && setConfig(c));
    const off = listen<Config>(CONFIG_EVENT, (e) => setConfig(e.payload));
    return () => {
      alive = false;
      off.then((f) => f());
    };
  }, []);

  /** Applies `change` to the latest config and saves it (exactly once). */
  const update = useCallback((change: (c: Config) => Config) => {
    if (!latest.current) return;
    const next = change(latest.current);
    setConfig(next); // optimistic; the broadcast replaces it with the sanitized copy
    api.saveConfig(next).catch(console.error);
  }, []);

  return [config, update] as const;
}

/** Key used for `iconOverrides`. */
export const iconKey = (source: string) => source.toLowerCase();

/**
 * Resolves icons for a list of sources, trying each fallback in order
 * (e.g. a Store app's AppsFolder id, then its exe). Results are cached per
 * window for its lifetime; a miss is retried the next time the list changes.
 */
export function useIcons(candidates: string[][]) {
  const [icons, setIcons] = useState<Record<string, string | null>>({});
  const key = candidates.map((c) => c.join("|")).join("\n");

  useEffect(() => {
    let alive = true;
    for (const sources of candidates) {
      const k = sources.join("|").toLowerCase();
      if (icons[k]) continue;
      (async () => {
        for (const s of sources.filter(Boolean)) {
          const url = await api.icon(s).catch(() => null);
          if (url) {
            if (alive) setIcons((m) => ({ ...m, [k]: url }));
            return;
          }
        }
      })();
    }
    return () => {
      alive = false;
    };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  return (sources: string[]) => icons[sources.join("|").toLowerCase()] ?? null;
}
