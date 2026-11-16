// Every widget the panel can show. Adding one = a component + an entry here.
import { FC } from "react";
import { WidgetProps } from "./kit";
import * as Cal from "./calendar";
import * as C from "./controls";
import * as F from "./files";
import * as M from "./markets";
import * as Me from "./media";
import * as P from "./productivity";
import * as S from "./system";
import * as T from "./time";
import * as W from "./weather";

export type Category =
  | "Clocks"
  | "Productivity"
  | "Weather"
  | "Markets"
  | "System"
  | "Media"
  | "Apps & files"
  | "Online";

export const CATEGORIES: Category[] = ["Clocks", "Productivity", "Weather", "Markets", "System", "Media", "Apps & files", "Online"];

export interface WidgetDef {
  kind: string;
  name: string;
  category: Category;
  description: string;
  /** small = one column, wide = full panel width. */
  size: "small" | "wide";
  defaults: Record<string, unknown>;
  // Each component narrows its own settings type; the registry stores them loosely.
  Component: FC<WidgetProps<any>>; // eslint-disable-line @typescript-eslint/no-explicit-any
  Settings?: FC<WidgetProps<any>>; // eslint-disable-line @typescript-eslint/no-explicit-any
}

const clock = { seconds: false, h24: false };

export const WIDGETS: WidgetDef[] = [
  // Clocks
  { kind: "clock", name: "Clock", category: "Clocks", size: "small", description: "Large time and date, 12 or 24-hour.", defaults: { ...clock, seconds: true }, Component: T.Clock, Settings: T.ClockSettingsForm },
  { kind: "flip-clock", name: "Flip clock", category: "Clocks", size: "small", description: "Split-flap digits that flip as time passes.", defaults: clock, Component: T.FlipClock, Settings: T.ClockSettingsForm },
  { kind: "segment-clock", name: "Segment clock", category: "Clocks", size: "small", description: "Seven-segment time with weekday and date.", defaults: { seconds: true }, Component: T.SegmentClock, Settings: T.ClockSettingsForm },
  { kind: "analog", name: "Analog", category: "Clocks", size: "small", description: "A minimal analog clock face.", defaults: {}, Component: T.Analog },
  { kind: "world-clocks", name: "World clocks", category: "Clocks", size: "wide", description: "Three analog faces for cities you choose.", defaults: { zones: ["America/New_York", "Europe/London", "Asia/Tokyo"] }, Component: T.WorldClocks, Settings: T.ZonesForm },
  { kind: "world-time", name: "World time", category: "Clocks", size: "small", description: "One city in large digits, with its offset.", defaults: { zones: ["Asia/Tokyo"] }, Component: T.WorldTime, Settings: T.ZonesForm },
  { kind: "date", name: "Date", category: "Clocks", size: "small", description: "The full date, large.", defaults: {}, Component: T.DateWidget },
  { kind: "day-number", name: "Day number", category: "Clocks", size: "small", description: "Today as a tear-off calendar page.", defaults: {}, Component: T.DayNumber },
  { kind: "today", name: "Today", category: "Clocks", size: "wide", description: "Weekday, date, time and weather together.", defaults: {}, Component: T.Today, Settings: W.WeatherForm },
  { kind: "clock-weather", name: "Clock & weather", category: "Clocks", size: "small", description: "Time, date and temperature in one tile.", defaults: {}, Component: T.ClockWeather, Settings: W.WeatherForm },
  { kind: "week-strip", name: "7 days", category: "Clocks", size: "wide", description: "This week as a strip, with each day's high.", defaults: {}, Component: T.WeekStrip, Settings: W.WeatherForm },
  { kind: "day-progress", name: "Day progress", category: "Clocks", size: "small", description: "How much of today has passed.", defaults: {}, Component: T.DayProgress },
  { kind: "month-progress", name: "Month progress", category: "Clocks", size: "small", description: "How much of the month has passed.", defaults: {}, Component: T.MonthProgress },
  { kind: "year-progress", name: "Year progress", category: "Clocks", size: "wide", description: "The year as a grid of dots filling up.", defaults: {}, Component: T.YearProgress },

  // Productivity
  { kind: "pomodoro", name: "Pomodoro", category: "Productivity", size: "wide", description: "Focus rounds and breaks, with a notification when each ends.", defaults: { focus: 25, shortBreak: 5, longBreak: 15, rounds: 4 }, Component: P.Pomodoro, Settings: P.PomodoroForm },
  { kind: "timer", name: "Timer", category: "Productivity", size: "wide", description: "Countdown from a preset or any number of minutes.", defaults: {}, Component: P.Timer },
  { kind: "stopwatch", name: "Stopwatch", category: "Productivity", size: "wide", description: "Elapsed time with laps.", defaults: {}, Component: P.Stopwatch },
  { kind: "todos", name: "Todos", category: "Productivity", size: "wide", description: "Your next task and a checklist with progress.", defaults: {}, Component: P.Todos },
  { kind: "notes", name: "Notes", category: "Productivity", size: "wide", description: "A note that saves as you type.", defaults: {}, Component: P.Notes },
  { kind: "agenda", name: "Up next", category: "Productivity", size: "wide", description: "Your next events from Google, Outlook or iCloud (add calendars in Settings).", defaults: {}, Component: Cal.Agenda },
  { kind: "calendar", name: "Calendar", category: "Productivity", size: "wide", description: "Month view.", defaults: {}, Component: P.Calendar },
  { kind: "currency", name: "Currency", category: "Productivity", size: "wide", description: "Convert amounts at ECB reference rates.", defaults: {}, Component: P.Currency },

  // Weather
  { kind: "weather", name: "Weather", category: "Weather", size: "small", description: "Current temperature with today's high and low.", defaults: {}, Component: W.Weather, Settings: W.WeatherForm },
  { kind: "weather-details", name: "Weather details", category: "Weather", size: "small", description: "Wind, rain, the day's range, humidity and UV.", defaults: {}, Component: W.WeatherDetails, Settings: W.WeatherForm },
  { kind: "forecast", name: "Today & forecast", category: "Weather", size: "wide", description: "Today plus the next three days.", defaults: {}, Component: W.Forecast, Settings: W.WeatherForm },
  { kind: "weather-status", name: "Weather status", category: "Weather", size: "wide", description: "Conditions in plain words.", defaults: {}, Component: W.WeatherStatus, Settings: W.WeatherForm },
  { kind: "hourly", name: "Hourly", category: "Weather", size: "wide", description: "The next six hours.", defaults: {}, Component: W.Hourly, Settings: W.WeatherForm },
  { kind: "sun", name: "Sunrise & sunset", category: "Weather", size: "wide", description: "Where the sun is between sunrise and sunset.", defaults: {}, Component: W.Sun, Settings: W.WeatherForm },

  // Markets
  { kind: "stock-chart", name: "Stock chart", category: "Markets", size: "wide", description: "One ticker with its intraday line.", defaults: { symbol: "AAPL" }, Component: M.StockChart, Settings: M.StockSymbolForm },
  { kind: "stock-watchlist", name: "Stock watchlist", category: "Markets", size: "wide", description: "Several tickers at a glance.", defaults: { symbols: ["AAPL", "MSFT", "NVDA"] }, Component: M.StockWatchlist, Settings: M.WatchlistForm },
  { kind: "crypto", name: "Crypto", category: "Markets", size: "small", description: "Coin price, 24-hour change and line.", defaults: { symbol: "BTCUSDT" }, Component: M.Crypto, Settings: M.CryptoForm },

  // System
  { kind: "cpu-ring", name: "CPU", category: "System", size: "small", description: "Processor load as a ring.", defaults: {}, Component: S.CpuRing },
  { kind: "ram-ring", name: "RAM", category: "System", size: "small", description: "Memory in use as a ring.", defaults: {}, Component: S.RamRing },
  { kind: "top-cpu", name: "Top CPU", category: "System", size: "small", description: "The three apps using the most CPU. Click for Task Manager.", defaults: {}, Component: S.TopCpu },
  { kind: "top-ram", name: "Top RAM", category: "System", size: "small", description: "The three apps using the most memory.", defaults: {}, Component: S.TopRam },
  { kind: "network", name: "Network", category: "System", size: "wide", description: "Download and upload speed with a live chart.", defaults: {}, Component: S.Network },
  { kind: "storage", name: "Storage", category: "System", size: "wide", description: "Free space on each drive.", defaults: {}, Component: S.Storage },
  { kind: "battery", name: "Battery", category: "System", size: "small", description: "Charge level and charging state.", defaults: {}, Component: S.Battery },
  { kind: "battery-ring", name: "Battery ring", category: "System", size: "small", description: "Charge as a ring that pulses while plugged in.", defaults: {}, Component: S.BatteryRing },
  { kind: "battery-core", name: "Battery core", category: "System", size: "small", description: "Twelve cells lit to the charge level.", defaults: {}, Component: S.BatteryCore },
  { kind: "battery-dots", name: "Battery dots", category: "System", size: "small", description: "Dot-matrix charge readout.", defaults: {}, Component: S.BatteryDots },
  { kind: "battery-gauge", name: "Battery gauge", category: "System", size: "small", description: "A fuel gauge from E to F.", defaults: {}, Component: S.BatteryGauge },
  { kind: "theme-toggle", name: "Theme toggle", category: "System", size: "small", description: "Switch Windows between light and dark.", defaults: {}, Component: S.ThemeToggle },
  { kind: "language", name: "Keyboard layout", category: "System", size: "small", description: "Current layout; click to switch, right-click for settings.", defaults: {}, Component: S.Language },
  { kind: "show-desktop", name: "Show desktop", category: "System", size: "small", description: "Hide all windows, click again to restore.", defaults: {}, Component: S.ShowDesktop },
  { kind: "notifications", name: "Notifications", category: "System", size: "small", description: "Open the notification center.", defaults: {}, Component: S.NotificationsTile },
  { kind: "quick-toggles", name: "Quick toggles", category: "System", size: "wide", description: "Wi-Fi and Bluetooth switches, plus hotspot, airplane mode and Focus shortcuts.", defaults: {}, Component: C.QuickToggles },
  { kind: "brightness", name: "Brightness", category: "System", size: "wide", description: "Display brightness: external monitors (DDC/CI) or the laptop screen.", defaults: {}, Component: C.Brightness },
  { kind: "screen-time", name: "Screen Time", category: "System", size: "wide", description: "Where today went, by app, with the last 7 days. Counted on this PC only.", defaults: {}, Component: C.ScreenTime },
  { kind: "keyboard", name: "On-screen keyboard", category: "System", size: "small", description: "Open the on-screen keyboard.", defaults: {}, Component: S.KeyboardTile },

  // Media
  { kind: "now-playing", name: "Now playing", category: "Media", size: "wide", description: "Cover, track and full controls for any app that reports to Windows.", defaults: {}, Component: Me.NowPlaying },
  { kind: "now-playing-compact", name: "Now playing (compact)", category: "Media", size: "wide", description: "Title, artist and play/pause.", defaults: {}, Component: Me.NowPlayingCompact },
  { kind: "now-playing-mini", name: "Now playing mini", category: "Media", size: "small", description: "A round play button with progress.", defaults: {}, Component: Me.NowPlayingMini },
  { kind: "now-playing-bar", name: "Now playing bar", category: "Media", size: "wide", description: "Track, progress bar and skip.", defaults: {}, Component: Me.NowPlayingBar },
  { kind: "audio-output", name: "Sound", category: "Media", size: "wide", description: "Output volume and mute; its card has a per-app mixer.", defaults: {}, Component: Me.AudioOutput },
  { kind: "app-mixer", name: "Volume mixer", category: "Media", size: "wide", description: "Each app's own volume, like Windows' volume mixer.", defaults: {}, Component: C.AppMixer },
  { kind: "microphone", name: "Mute", category: "Media", size: "wide", description: "Mute the microphone or all sound.", defaults: {}, Component: Me.Microphone },

  // Apps & files
  { kind: "recycle-bin", name: "Recycle Bin", category: "Apps & files", size: "small", description: "What's in the bin; empty it in one click.", defaults: {}, Component: F.RecycleBin },
  { kind: "search", name: "Search", category: "Apps & files", size: "wide", description: "Search the web, or open a folder path you type.", defaults: {}, Component: F.Search },
  { kind: "downloads", name: "Downloads", category: "Apps & files", size: "wide", description: "Your newest downloads; open them or show them in their folder.", defaults: {}, Component: C.Downloads },
  { kind: "screenshots", name: "Screenshots", category: "Apps & files", size: "wide", description: "Your latest screenshots.", defaults: {}, Component: C.Screenshots },
  { kind: "recent-files", name: "Recently opened", category: "Apps & files", size: "wide", description: "Files and folders you opened recently.", defaults: {}, Component: C.RecentFiles },
  { kind: "screenshot", name: "Screenshot", category: "Apps & files", size: "small", description: "Capture the screen, a window or a region.", defaults: {}, Component: S.Screenshot },

  // Online
  { kind: "leetcode", name: "LeetCode stats", category: "Online", size: "wide", description: "Problems solved by difficulty, and your streak.", defaults: { username: "" }, Component: F.LeetCode, Settings: F.LeetCodeForm },
];

export const widgetByKind = new Map(WIDGETS.map((w) => [w.kind, w]));
