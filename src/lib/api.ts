import { invoke } from "@tauri-apps/api/core";

export interface Stats {
  cpu: number;
  memUsed: number;
  memTotal: number;
  battery: number | null;
  charging: boolean;
}

export interface WindowInfo {
  id: number;
  title: string;
  exe: string;
  /** Exe path, or `shell:AppsFolder\<AppUserModelID>` for packaged apps. */
  iconSource: string;
  focused: boolean;
  minimized: boolean;
}

export interface PinnedApp {
  name: string;
  path: string;
}

export interface DockSettings {
  iconSize: number;
  magnify: boolean;
  magnifyScale: number;
  showRunning: boolean;
}

export interface BarSettings {
  showCpu: boolean;
  showRam: boolean;
  showBattery: boolean;
  showVolume: boolean;
  showWeather: boolean;
  showSeconds: boolean;
  clock24h: boolean;
}

export interface Config {
  pinned: PinnedApp[];
  dock: DockSettings;
  bar: BarSettings;
  /** Custom PNG data-URL icons keyed by lower-cased icon source. */
  iconOverrides: Record<string, string>;
}

/** Emitted by the backend after every save, with the saved Config. */
export const CONFIG_EVENT = "config-changed";

export interface Volume {
  level: number;
  muted: boolean;
}

export const api = {
  stats: () => invoke<Stats>("get_stats"),
  windows: () => invoke<WindowInfo[]>("list_windows"),
  activate: (id: number) => invoke<void>("activate_window", { id }),
  close: (id: number) => invoke<void>("close_window", { id }),
  foregroundTitle: () => invoke<string>("foreground_title"),
  loadConfig: () => invoke<Config>("load_config"),
  saveConfig: (config: Config) => invoke<Config>("save_config", { config }),
  launch: (path: string) => invoke<void>("launch_app", { path }),
  icon: (source: string) => invoke<string | null>("app_icon", { source }),
  loadCustomIcon: (path: string) => invoke<string>("load_custom_icon", { path }),
  openSettings: () => invoke<void>("open_settings"),
  volume: () => invoke<Volume>("get_volume"),
  setVolume: (level: number) => invoke<Volume>("set_volume", { level }),
  toggleMute: () => invoke<Volume>("toggle_mute"),
  layoutDock: (width: number, height: number) => invoke<void>("layout_dock", { width, height }),
  toggleWidgets: () => invoke<void>("toggle_widgets"),

  // Widgets
  weather: (lat: number, lon: number, imperial: boolean) =>
    invoke<WeatherResponse>("weather", { lat, lon, imperial }),
  geocode: (query: string) => invoke<{ results?: GeoResult[] }>("geocode", { query }),
  locateByIp: () => invoke<{ city?: string; region?: string; country?: string; loc?: string }>("locate_by_ip"),
  stocks: (symbols: string[]) => invoke<StockResult[]>("stocks", { symbols }),
  crypto: (symbols: string[]) => invoke<CryptoTicker[]>("crypto", { symbols }),
  fx: (base: string, quotes: string[]) =>
    invoke<{ base: string; date: string; rates: Record<string, number> }>("fx", { base, quotes }),
  systemWidgets: () => invoke<SystemInfo>("system_widgets"),
  loadWidgetConfig: () => invoke<WidgetConfig>("load_widget_config"),
  saveWidgetConfig: (config: WidgetConfig) => invoke<void>("save_widget_config", { config }),
};

export interface Location {
  name: string;
  lat: number;
  lon: number;
}

export interface WidgetConfig {
  location: Location | null;
  imperial: boolean;
  stocks: string[];
  crypto: string[];
  fxBase: string;
  fxQuotes: string[];
}

export interface WeatherResponse {
  current: {
    temperature_2m: number;
    apparent_temperature: number;
    relative_humidity_2m: number;
    weather_code: number;
    wind_speed_10m: number;
    is_day: number;
  };
  current_units: { temperature_2m: string; wind_speed_10m: string };
  daily: {
    time: string[];
    weather_code: number[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
  };
}

export interface GeoResult {
  name: string;
  country?: string;
  admin1?: string;
  latitude: number;
  longitude: number;
}

export interface StockResult {
  symbol: string;
  error?: string;
  data?: {
    chart: {
      result?: {
        meta: { regularMarketPrice: number; chartPreviousClose: number; currency: string };
        indicators: { quote: { close: (number | null)[] }[] };
      }[];
    };
  };
}

export interface CryptoTicker {
  symbol: string;
  lastPrice: string;
  priceChangePercent: string;
}

export interface SystemInfo {
  disks: { name: string; mount: string; total: number; available: number }[];
  rxPerSec: number;
  txPerSec: number;
  uptimeSecs: number;
}

/** Broadcast so the bar refreshes when the panel's settings change. */
export const WIDGET_CONFIG_EVENT = "widget-config-changed";

const WMO: [number[], string, string][] = [
  [[0], "☀️", "Clear"],
  [[1], "🌤️", "Mostly clear"],
  [[2], "⛅", "Partly cloudy"],
  [[3], "☁️", "Overcast"],
  [[45, 48], "🌫️", "Fog"],
  [[51, 53, 55, 56, 57], "🌦️", "Drizzle"],
  [[61, 63, 65, 66, 67], "🌧️", "Rain"],
  [[71, 73, 75, 77], "🌨️", "Snow"],
  [[80, 81, 82], "🌧️", "Showers"],
  [[85, 86], "🌨️", "Snow showers"],
  [[95, 96, 99], "⛈️", "Thunderstorm"],
];

/** WMO weather code → [emoji, label]. Night swaps the sun for a moon. */
export function weatherLook(code: number, isDay = true): [string, string] {
  const hit = WMO.find(([codes]) => codes.includes(code));
  const [, icon, label] = hit ?? [[], "🌡️", "Unknown"];
  if (!isDay && code <= 1) return ["🌙", label];
  return [icon, label];
}

/** Calls `fn` now and every `ms`, ignoring overlapping/failed ticks. */
export function poll<T>(fn: () => Promise<T>, ms: number, onValue: (v: T) => void) {
  let busy = false;
  let alive = true;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      const v = await fn();
      if (alive) onValue(v);
    } catch (e) {
      console.warn(e);
    } finally {
      busy = false;
    }
  };
  tick();
  const id = setInterval(tick, ms);
  return () => {
    alive = false;
    clearInterval(id);
  };
}

export const exeName = (path: string) =>
  path.split(/[\\/]/).pop()?.replace(/\.(exe|lnk)$/i, "") ?? path;

export const samePath = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();
