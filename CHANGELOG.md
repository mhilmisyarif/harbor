# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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

[unreleased]: https://github.com/mhilmisyarif/harbor/compare/v0.0.1...HEAD
[0.0.1]: https://github.com/mhilmisyarif/harbor/releases/tag/v0.0.1
