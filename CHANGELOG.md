# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Added

- The dock and bar hide while a game, video or presentation is fullscreen, and
  come back when you leave it.
- Drop files on the dock's Recycle Bin to recycle them (undoable from the bin).
- Volume mixer: each app's own volume and mute, also in the Sound card.
- Quick toggles: switch Wi-Fi and Bluetooth on or off; shortcuts for mobile
  hotspot, airplane mode, Focus and display settings.
- Brightness slider for external monitors (DDC/CI) and laptop screens.
- Downloads, Screenshots and Recently opened widgets: open a file or show it in
  its folder.
- Screen Time: today's time by app and the last 7 days, counted only on this PC
  (idle time is skipped).

## [0.0.3] - 2026-11-17

### Added

- Widget cards: click any widget on the dock and its card slides out right
  over it (downward when the dock is at the top). Related widgets open richer
  cards: the clock opens a calendar, weather opens the next hours, the
  forecast and sunrise & sunset, volume opens sound and microphone controls,
  and CPU/RAM open top apps. A card's ⚙ edits that widget's settings.
- Appearance styles in **Settings → Appearance**: Liquid Glass, iOS Glass,
  Midnight, Black and White. They apply to the dock, bar, widget panel and
  cards. The glass styles show your actual wallpaper, blurred, behind each
  surface.
- Dock spacing setting.
- Edit the dock in place: right-click → **Edit dock** to drag items into a new
  order, remove them with the − badge, or add widgets with ＋.
- Drag the dock by an empty spot to the top or bottom half of the screen to
  snap it there.
- An **Update** button appears on the dock when a new version is available.

## [0.0.2] - 2026-11-16

### Added

- Settings window, opened from the tray, the dock's or bar's right-click menu, or
  the widget panel:
  - Dock: icon size, magnification on hover (and how much), and whether to show
    running apps that aren't pinned.
  - Pinned apps: rename, reorder, remove, add with a file picker, and set a
    custom icon from an image, `.ico`, `.exe` or `.lnk`.
  - Menu bar: choose which readouts to show (CPU, memory, battery, volume,
    weather), seconds in the clock and a 24-hour clock.
  - Start with Windows.
- "Change icon…" and "Reset icon" in the dock's right-click menu, for pinned and
  running apps.
- Store apps (such as Windows Terminal, WhatsApp or Spotify) are recognised by
  their app ID, so they get their real logo and pinning them launches the app.
- Customizable widget panel: click **Edit** to add widgets from a searchable
  gallery, reorder them, configure each one with ⚙, or remove them. The same
  widget can be added more than once (for example, two stock charts).
- 56 widgets that need no account or API key:
  - Clocks: clock, flip clock, segment clock, analog, world clocks, world time,
    date, day number, today, clock & weather, 7 days, and day, month and year
    progress.
  - Productivity: Pomodoro and timer (with a notification when they finish),
    stopwatch with laps, todos, notes, calendar and currency.
  - Weather: current, details (wind, rain, UV), today & forecast, conditions in
    words, hourly, and sunrise & sunset.
  - Markets: stock chart, stock watchlist, and crypto with a 24-hour line.
  - System: CPU and RAM rings, top CPU and memory apps, network with a live
    chart, storage, five battery styles, light/dark theme toggle, keyboard
    layout switcher, show desktop, notifications and on-screen keyboard.
  - Media: Now Playing in four layouts (with album art and controls for any app
    that reports to Windows), output volume, and microphone mute.
  - Apps & files: Recycle Bin, search (web search or open a typed folder path),
    screenshot, and LeetCode stats from a public profile.
- Several widgets showing the same data share one request.
- The dock is now a customizable strip. Mix your apps with widget pills,
  separators, flexible space and a widgets button, in any order.
- About 40 widgets have a compact dock pill, including clocks, Pomodoro, timer,
  stopwatch, weather and forecast, now playing, volume, CPU and RAM,
  network, battery, todos, currency, crypto, stocks, theme, keyboard layout,
  search, Recycle Bin, screenshot and LeetCode.
- Dock position (bottom or top) and style (floating or full width). A
  full-width dock can reserve screen space like the taskbar.
- Option to hide the Windows taskbar while Harbor runs. It is restored when you
  quit, when you turn the option off, and on the next launch if Harbor was
  closed unexpectedly.
- Option to turn off the top menu bar.
- Dock presets: Floating dock, Taskbar replacement, Widget dock and Top strip.
- In-app updates. Harbor checks for a new version at startup and every 6 hours,
  and notifies you when one is available. **Settings → Updates** installs it and
  restarts Harbor, with no manual reinstall. You can turn on automatic installs,
  or check any time from the tray menu. Updates are signed, and Harbor only
  installs builds signed with the project's key.

### Changed

- Releases are built and published from a local script (`npm run release:local`)
  instead of GitHub Actions, and CI skips docs-only changes and runs the
  installer build only on demand, to stay within Actions minutes.
- Dock icons are extracted at 128 px, so they stay sharp on high-DPI displays.
- Changes made in Settings apply to the bar and dock immediately.

### Fixed

- Some dock icons (for example Notepad and Task Manager) showed only a letter.
  Icons are now extracted one at a time on a dedicated thread, and a failed
  lookup is retried instead of being remembered until restart.
- The dock no longer reappears on its own after being hidden with `Alt+D`
  when apps open or close.

## [0.0.1] - 2026-11-16

First public build.

### Added

- Top bar registered as a Windows appbar, so maximized windows stop below it.
  It shows the foreground window title, CPU, RAM, battery, volume (click to
  mute, scroll to adjust) and the date and time.
- Bottom dock with pinned apps and running windows grouped by executable,
  real shell icons, hover magnification and running indicators.
- Dock actions: click to launch, focus, cycle or minimize; right-click for
  window list, pin/unpin and close; drop `.exe`/`.lnk` files to pin.
- Tray menu, `Alt+D` hotkey to toggle the dock, single-instance guard and
  "Start with Windows".
- Widget panel, opened from the bar (▦ button or the weather readout), with
  cards for weather, stocks, crypto, currency, system (network throughput,
  disk usage, uptime) and a month calendar.
- Weather uses Open-Meteo, with city search or an opt-in approximate location
  lookup via ipinfo.io; supports °C/km/h and °F/mph.
- Stocks via Yahoo Finance with intraday sparklines, crypto via Binance public
  market data, and currency conversion via Frankfurter (ECB reference rates).
  None of these need an API key.
- Current weather readout in the bar.

[unreleased]: https://github.com/mhilmisyarif/harbor/compare/v0.0.3...HEAD
[0.0.3]: https://github.com/mhilmisyarif/harbor/compare/v0.0.2...v0.0.3
[0.0.2]: https://github.com/mhilmisyarif/harbor/compare/v0.0.1...v0.0.2
[0.0.1]: https://github.com/mhilmisyarif/harbor/releases/tag/v0.0.1
