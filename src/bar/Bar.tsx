import { useEffect, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { Menu } from "@tauri-apps/api/menu";
import { api, poll, Stats, Volume, WeatherResponse, weatherLook, WIDGET_CONFIG_EVENT, WidgetConfig } from "../lib/api";
import { useConfig } from "../lib/config";
import { Backdrop } from "../lib/Backdrop";

/** Compact current-weather readout; opens the widget panel on click. */
function WeatherChip() {
  const [config, setConfig] = useState<WidgetConfig | null>(null);
  const [data, setData] = useState<WeatherResponse | null>(null);

  useEffect(() => {
    api.loadWidgetConfig().then(setConfig);
    const off = listen(WIDGET_CONFIG_EVENT, () => api.loadWidgetConfig().then(setConfig));
    return () => {
      off.then((f) => f());
    };
  }, []);

  const loc = config?.location;
  useEffect(() => {
    if (!loc || !config) return;
    return poll(() => api.weather(loc.lat, loc.lon, config.imperial), 15 * 60_000, setData);
  }, [loc?.lat, loc?.lon, config?.imperial]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!loc || !data) return null;
  const [icon, label] = weatherLook(data.current.weather_code, data.current.is_day === 1);
  return (
    <button className="bar-item" title={`${loc.name}: ${label}`} onClick={() => api.toggleWidgets()}>
      {icon} {Math.round(data.current.temperature_2m)}°
    </button>
  );
}

function useClock() {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(id);
  }, []);
  return now;
}

const fmtGB = (bytes: number) => (bytes / 1024 ** 3).toFixed(1);

function VolumeControl() {
  const [vol, setVol] = useState<Volume | null>(null);
  useEffect(() => poll(api.volume, 3000, setVol), []);
  if (!vol) return null;

  const pct = Math.round(vol.level * 100);
  const icon = vol.muted || pct === 0 ? "🔇" : pct < 40 ? "🔈" : pct < 75 ? "🔉" : "🔊";
  const onWheel = (e: React.WheelEvent) => {
    const step = e.deltaY < 0 ? 0.05 : -0.05;
    api.setVolume(Math.min(1, Math.max(0, vol.level + step))).then(setVol);
  };
  return (
    <button
      className="bar-item"
      title="Click to mute, scroll to change volume"
      onClick={() => api.toggleMute().then(setVol)}
      onWheel={onWheel}
    >
      {icon} {vol.muted ? "Muted" : `${pct}%`}
    </button>
  );
}

const onBarMenu = async (e: React.MouseEvent) => {
  e.preventDefault();
  const menu = await Menu.new({ items: [{ text: "Settings…", action: () => api.openSettings() }] });
  await menu.popup();
};

export function Bar() {
  const now = useClock();
  const [config] = useConfig();
  const [stats, setStats] = useState<Stats | null>(null);
  const [title, setTitle] = useState("");

  useEffect(() => poll(api.stats, 2000, setStats), []);
  useEffect(() => poll(api.foregroundTitle, 700, setTitle), []);

  if (!config) return null;
  const s = config.bar;
  return (
    <div className="bar has-backdrop" onContextMenu={onBarMenu}>
      <Backdrop />
      <div className="bar-left">
        <span className="bar-logo">⚓</span>
        <span className="bar-title" title={title}>
          {title || "Desktop"}
        </span>
      </div>

      <div className="bar-right">
        {stats && (
          <>
            {s.showCpu && (
              <span className="bar-item" title="CPU usage">
                CPU {Math.round(stats.cpu)}%
              </span>
            )}
            {s.showRam && (
              <span className="bar-item" title="Memory in use">
                RAM {fmtGB(stats.memUsed)}/{fmtGB(stats.memTotal)} GB
              </span>
            )}
            {s.showBattery && stats.battery !== null && (
              <span className="bar-item" title={stats.charging ? "Charging" : "On battery"}>
                {stats.charging ? "⚡" : "🔋"} {stats.battery}%
              </span>
            )}
          </>
        )}
        {s.showVolume && <VolumeControl />}
        {s.showWeather && <WeatherChip />}
        <button className="bar-item" title="Widgets" onClick={() => api.toggleWidgets()}>
          ▦
        </button>
        <span className="bar-item bar-clock">
          {now.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}{" "}
          {now.toLocaleTimeString(undefined, {
            hour: "2-digit",
            minute: "2-digit",
            second: s.showSeconds ? "2-digit" : undefined,
            hour12: !s.clock24h,
          })}
        </span>
      </div>
    </div>
  );
}
