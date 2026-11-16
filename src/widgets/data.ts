// Shared data sources. Each key is polled once no matter how many widgets use it.
import { useSyncExternalStore } from "react";
import { api, NowPlaying, SystemInfo, WidgetConfig } from "../lib/api";
import { useShared } from "./kit";

export const useStats = () => useShared("stats", api.stats, 2000);

export const useSystemInfo = () => useShared("system", trackNetwork, 2000);

export function useWeather(shared: WidgetConfig) {
  const loc = shared.location;
  const key = loc ? `weather:${loc.lat.toFixed(3)},${loc.lon.toFixed(3)}:${shared.imperial}` : null;
  return useShared(key, () => api.weather(loc!.lat, loc!.lon, shared.imperial), 15 * 60_000);
}

export const useNowPlaying = () => useShared<NowPlaying | null>("now-playing", api.nowPlaying, 1500);

export const useVolume = () => useShared("volume", api.volume, 2500);

export const useMicrophone = () => useShared("microphone", api.microphone, 2500);

export const useTopProcesses = (by: "cpu" | "ram") =>
  useShared(`top-${by}`, () => api.topProcesses(by, 3), 3000);

// ---------- network history for the live chart ----------

const HISTORY = 60;
const rx: number[] = [];
const tx: number[] = [];
const historyListeners = new Set<() => void>();
let historySnapshot = { rx: [] as number[], tx: [] as number[] };

async function trackNetwork(): Promise<SystemInfo> {
  const info = await api.systemWidgets();
  rx.push(info.rxPerSec);
  tx.push(info.txPerSec);
  if (rx.length > HISTORY) rx.shift();
  if (tx.length > HISTORY) tx.shift();
  historySnapshot = { rx: [...rx], tx: [...tx] };
  historyListeners.forEach((l) => l());
  return info;
}

export function useNetworkHistory() {
  useSystemInfo(); // keeps the poll running
  return useSyncExternalStore(
    (l) => {
      historyListeners.add(l);
      return () => historyListeners.delete(l);
    },
    () => historySnapshot,
  );
}

// ---------- weather helpers ----------

/** Index of the current hour in an hourly series (series is in the location's local time). */
export function currentHourIndex(times: string[], currentTime: string) {
  const hour = currentTime.slice(0, 13); // "2026-11-16T14"
  const i = times.findIndex((t) => t.startsWith(hour));
  return i < 0 ? 0 : i;
}

/** Minutes since local midnight for an ISO "YYYY-MM-DDTHH:MM" string. */
export const minutesOf = (iso: string) => {
  const [h, m] = iso.slice(11, 16).split(":").map(Number);
  return h * 60 + m;
};

export const compass = (deg: number) => ["N", "NE", "E", "SE", "S", "SW", "W", "NW"][Math.round(deg / 45) % 8];
