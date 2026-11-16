# Harbor

A dock and menu bar for Windows. It is an original re-implementation of the
architecture found in `lumabar-1.2.19-64-bit.msi`. No code, assets or branding
from that product are used.

## What the original is built with (REA findings)

How each fact was found: REA `inspect_rust_binary`, `inspect_pe_imports` and
`inspect_desktop_application`, plus a string scan of `lumabar.exe`. REA can't open
the MSI directly, so it was first unpacked with `msiexec /a`.

| Layer | Observed |
|---|---|
| Installer | WiX MSI built by the Tauri bundler. It installs `lumabar.exe` (25 MB) and `WebView2Loader.dll`. |
| Shell | **Tauri 2.11** (`tauri-2.11.6`, `wry-0.55`, `tao-0.35`, `tray-icon-0.24`, `muda-0.19`). Identifier `com.lumabar.dock`. |
| Backend | **Rust**: `tokio`, `reqwest`/`ureq`/`hyper` + `rustls`, `serde_json`, `rusqlite`, `image`, `cpal` (audio), `windows-rs` 0.61/0.62, `notify-rust`. |
| Plugins | `tauri-plugin-updater` (minisign-signed updates), `-notification`, `-log`. |
| Frontend | **React + TypeScript + Vite**. The embedded string reads "Tauri v2 + React + TypeScript", and the bundle has hashed `/assets/index-*.js` and `index-*.css` files. |
| Win32 surface | `SHAppBarMessage` (reserves screen space like the taskbar), `Shell_NotifyIcon`, `RegisterHotKey`, a WinEvent hook, DWM thumbnails, Core Audio, monitor brightness (DDC), PDH counters, IP/TCP tables, the Recycle Bin, `SetSuspendState`, and DXGI desktop duplication. |
| Features (from the `commands::*` modules) | dock, appmenu, windows, peek, popover, taskbar_keys, tray, audio, bluetooth, wifi, ethernet, brightness, displays, memory, storage, temps, screen_time, screenshots, ocr, voice, wallpaper/unsplash, weather, stocks, crypto, currency, gmail/google_oauth, github, social, revenue/datafast, search_console, ai_usage/claude/opencode, leetcode, license, updater. |

## What Harbor implements

- **Top bar.** It is registered as a real appbar, so maximized windows stop below it. It shows the
  foreground window title, CPU, RAM, battery, volume (click to mute, scroll to change) and a clock.
- **Bottom dock.** It shows pinned apps plus running windows grouped by executable, with real shell
  icons. Clicking launches, focuses, cycles or minimizes. Hovering magnifies icons, and dots
  mark running apps.
  Right-click opens a window list with pin, unpin and close. Drop an `.exe` or `.lnk` on the dock to pin it.
- **System integration.** Tray menu, the `Alt+D` hotkey to toggle the dock, a single-instance guard, and a
  "Start with Windows" option (right-click empty dock space).
- **Widget panel.** Open it with the ▦ button or the weather readout in the bar.
  - Weather comes from Open-Meteo. Pick a city by search, or opt in to an approximate
    location lookup via ipinfo.io.
  - Market data covers stocks (Yahoo Finance, with sparklines), crypto (Binance) and
    a currency converter (Frankfurter/ECB).
  - A system card shows network speed, disk usage and uptime, and a calendar card shows the month.
  - None of these need an API key.
- **Config.** Saved to `%APPDATA%\dev.harbor.shell\config.json` (dock) and `widgets.json` (widgets).

```
src/                     React + TS frontend (one bundle; window label picks the surface)
  bar/ dock/ widgets/    one folder per window
  lib/api.ts             typed wrappers for every Rust command
src-tauri/src/commands/  appbar, layout, windows_list, icons, apps, audio, stats, widgets
scripts/release-check.mjs      version + CHANGELOG consistency (local and CI)
scripts/attribution-check.mjs  rejects AI attribution (hook, local and CI)
```

## Development

Requires Node 20+, Rust 1.88+ (`winget install Rustlang.Rustup`) and the MSVC build tools.

```
npm install
npm run tauri dev      # run
npm run check          # frontend + backend + release checks (same as CI)
npm run tauri build    # MSI + NSIS installers in src-tauri/target/release/bundle
```

Every change is verified on both the frontend and the backend. User-visible changes
get a `CHANGELOG.md` entry ([Keep a Changelog](https://keepachangelog.com/en/1.1.0/)).
See [CLAUDE.md](CLAUDE.md) for the full rules and the release process.

## CI/CD

- **CI** (`.github/workflows/ci.yml`) runs on every PR and push to `main`:
  - frontend typecheck and build;
  - backend fmt, clippy and tests on Windows;
  - a no-AI-attribution scan of files, commits and PR text (also a local `commit-msg` hook);
  - a changelog-entry check on PRs;
  - on `main` pushes, an installer build uploaded as an artifact.
- **Release** (`.github/workflows/release.yml`) runs when you push a `vX.Y.Z` tag. It re-runs all
  checks, builds the MSI and NSIS installers, and drafts a GitHub release with that
  version's changelog section as the notes.
