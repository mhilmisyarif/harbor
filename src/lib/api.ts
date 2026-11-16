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

export type DockPosition = "bottom" | "top";
export type DockStyle = "floating" | "full";

/** One slot in the dock strip. `kind` is `apps`, `separator`, `spacer` or `widget:<kind>`. */
export interface DockEntry {
  id: string;
  kind: string;
  settings: Record<string, unknown>;
}

export interface DockSettings {
  iconSize: number;
  magnify: boolean;
  magnifyScale: number;
  showRunning: boolean;
  position: DockPosition;
  style: DockStyle;
  reserveSpace: boolean;
  hideTaskbar: boolean;
  items: DockEntry[];
}

export interface DockGeometry {
  width: number;
  height: number;
  strip: number;
  position: DockPosition;
  style: DockStyle;
  reserveSpace: boolean;
}

export interface BarSettings {
  enabled: boolean;
  showCpu: boolean;
  showRam: boolean;
  showBattery: boolean;
  showVolume: boolean;
  showWeather: boolean;
  showSeconds: boolean;
  clock24h: boolean;
}

export interface UpdateSettings {
  autoCheck: boolean;
  autoInstall: boolean;
}

export interface Config {
  pinned: PinnedApp[];
  dock: DockSettings;
  bar: BarSettings;
  updates: UpdateSettings;
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
  layoutDock: (geometry: DockGeometry) => invoke<void>("layout_dock", { geometry }),
  setBarEnabled: (enabled: boolean) => invoke<void>("set_bar_enabled", { enabled }),
  setTaskbarHidden: (hidden: boolean) => invoke<void>("set_taskbar_hidden", { hidden }),
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
  saveWidgetConfig: (config: WidgetConfig) => invoke<WidgetConfig>("save_widget_config", { config }),
  loadWidgetData: <T>(key: string) => invoke<T | null>("load_widget_data", { key }),
  saveWidgetData: (key: string, value: unknown) => invoke<void>("save_widget_data", { key, value }),
  cryptoChart: (symbol: string) => invoke<number[]>("crypto_chart", { symbol }),
  leetcode: (username: string) => invoke<LeetCodeResponse>("leetcode", { username }),

  // Local PC
  topProcesses: (by: "cpu" | "ram", limit: number) => invoke<ProcessUsage[]>("top_processes", { by, limit }),
  getDarkMode: () => invoke<boolean>("get_dark_mode"),
  setDarkMode: (dark: boolean) => invoke<boolean>("set_dark_mode", { dark }),
  shellAction: (action: ShellAction) => invoke<void>("shell_action", { action }),
  searchOrOpen: (query: string) => invoke<void>("search_or_open", { query }),
  recycleBin: () => invoke<{ items: number; bytes: number }>("recycle_bin_info"),
  emptyRecycleBin: () => invoke<void>("empty_recycle_bin"),
  inputLanguage: () => invoke<InputLanguage>("input_language"),
  nextInputLanguage: () => invoke<InputLanguage>("next_input_language"),
  microphone: () => invoke<Volume>("get_microphone"),
  toggleMicrophone: () => invoke<Volume>("toggle_microphone_mute"),
  nowPlaying: () => invoke<NowPlaying | null>("now_playing"),
  mediaControl: (action: "toggle" | "next" | "previous") => invoke<void>("media_control", { action }),
};

export type ShellAction =
  | "show-desktop"
  | "notifications"
  | "keyboard"
  | "screenshot"
  | "task-manager"
  | "sound-settings"
  | "language-settings"
  | "storage-settings"
  | "recycle-bin";

export interface ProcessUsage {
  name: string;
  cpu: number;
  memory: number;
  count: number;
}

export interface InputLanguage {
  short: string;
  name: string;
  available: number;
}

export interface NowPlaying {
  title: string;
  artist: string;
  album: string;
  app: string;
  playing: boolean;
  positionSecs: number;
  durationSecs: number;
  art: string | null;
}

export interface LeetCodeResponse {
  data?: {
    matchedUser: {
      username: string;
      submitStatsGlobal: { acSubmissionNum: { difficulty: string; count: number }[] };
      userCalendar: { streak: number; totalActiveDays: number } | null;
    } | null;
    allQuestionsCount: { difficulty: string; count: number }[];
  };
  errors?: { message: string }[];
}

export interface WidgetInstance {
  id: string;
  kind: string;
  settings: Record<string, unknown>;
}

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
  layout: WidgetInstance[];
}

export interface WeatherResponse {
  current: {
    time: string;
    temperature_2m: number;
    apparent_temperature: number;
    relative_humidity_2m: number;
    weather_code: number;
    wind_speed_10m: number;
    wind_direction_10m: number;
    precipitation: number;
    is_day: number;
  };
  current_units: { temperature_2m: string; wind_speed_10m: string; precipitation: string };
  utc_offset_seconds: number;
  hourly: {
    time: string[];
    temperature_2m: number[];
    weather_code: number[];
    precipitation_probability: number[];
    is_day: number[];
  };
  daily: {
    time: string[];
    weather_code: number[];
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    sunrise: string[];
    sunset: string[];
    precipitation_sum: number[];
    precipitation_probability_max: number[];
    wind_speed_10m_max: number[];
    uv_index_max: number[];
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
