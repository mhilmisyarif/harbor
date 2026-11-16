// Clocks, dates and progress widgets.
import { useEffect, useRef, useState } from "react";
import { weatherLook } from "../lib/api";
import { useWeather } from "./data";
import { allTimeZones, AnalogFace, Tile, timeString, useNow, WidgetProps, zoneCity, zonedParts } from "./kit";

export interface ClockSettings {
  seconds: boolean;
  h24: boolean;
}

export function Clock({ settings }: WidgetProps<ClockSettings>) {
  const now = useNow();
  return (
    <Tile className="w-center">
      <div className="w-clock-big">{timeString(now, { seconds: settings.seconds, h24: settings.h24 })}</div>
      <div className="w-muted">{now.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}</div>
    </Tile>
  );
}

export function ClockSettingsForm({ settings, setSettings }: WidgetProps<ClockSettings>) {
  return (
    <div className="w-form">
      <label className="w-check">
        <input type="checkbox" checked={settings.seconds} onChange={(e) => setSettings({ seconds: e.target.checked })} />
        Show seconds
      </label>
      <label className="w-check">
        <input type="checkbox" checked={settings.h24} onChange={(e) => setSettings({ h24: e.target.checked })} />
        24-hour clock
      </label>
    </div>
  );
}

/** One split-flap card that flips when its digit changes. */
function Flap({ value }: { value: string }) {
  const [shown, setShown] = useState(value);
  const [flipping, setFlipping] = useState(false);
  const prev = useRef(value);
  useEffect(() => {
    if (value === prev.current) return;
    prev.current = value;
    setFlipping(true);
    const t = setTimeout(() => {
      setShown(value);
      setFlipping(false);
    }, 280);
    return () => clearTimeout(t);
  }, [value]);
  return <span className={"w-flap" + (flipping ? " flip" : "")}>{shown}</span>;
}

export function FlipClock({ settings }: WidgetProps<ClockSettings>) {
  const now = useNow();
  const { h, m, s } = zonedParts(now);
  const hh = settings.h24 ? h : ((h + 11) % 12) + 1;
  const digits = [String(hh).padStart(2, "0"), String(m).padStart(2, "0"), ...(settings.seconds ? [String(s).padStart(2, "0")] : [])];
  return (
    <Tile className="w-center">
      <div className="w-flip">
        {digits.map((pair, gi) => (
          <span key={gi} className="w-flip-group">
            <Flap value={pair[0]} />
            <Flap value={pair[1]} />
          </span>
        ))}
      </div>
      {!settings.h24 && <div className="w-muted w-small">{h < 12 ? "AM" : "PM"}</div>}
    </Tile>
  );
}

export function SegmentClock({ settings }: WidgetProps<ClockSettings>) {
  const now = useNow();
  const text = timeString(now, { seconds: settings.seconds, h24: true });
  return (
    <Tile className="w-center">
      <div className="w-segment">
        <span className="w-segment-ghost">{text.replace(/\d/g, "8")}</span>
        <span className="w-segment-on">{text}</span>
      </div>
      <div className="w-muted w-segment-date">
        {now.toLocaleDateString(undefined, { weekday: "short" }).toUpperCase()} ·{" "}
        {now.toLocaleDateString(undefined, { day: "2-digit", month: "2-digit" })}
      </div>
    </Tile>
  );
}

export function Analog() {
  const now = useNow();
  return (
    <Tile className="w-center">
      <AnalogFace date={now} size={112} />
    </Tile>
  );
}

export interface ZonesSettings {
  zones: string[];
}

/** Hours difference between a zone and local time, e.g. "+7h". */
function offsetLabel(zone: string, now: Date) {
  const there = zonedParts(now, zone);
  const here = zonedParts(now);
  let diff = (there.h * 60 + there.m - (here.h * 60 + here.m)) / 60;
  if (diff > 12) diff -= 24;
  if (diff < -12) diff += 24;
  if (diff === 0) return "same time";
  return `${diff > 0 ? "+" : ""}${Number.isInteger(diff) ? diff : diff.toFixed(1)}h`;
}

export function WorldClocks({ settings }: WidgetProps<ZonesSettings>) {
  const now = useNow();
  return (
    <Tile>
      <div className="w-world">
        {settings.zones.slice(0, 3).map((z) => (
          <div key={z} className="w-world-item">
            <AnalogFace date={now} timeZone={z} size={78} seconds={false} />
            <div className="w-world-city">{zoneCity(z)}</div>
            <div className="w-muted w-small">{offsetLabel(z, now)}</div>
          </div>
        ))}
      </div>
    </Tile>
  );
}

export function ZonesForm({ settings, setSettings }: WidgetProps<ZonesSettings>) {
  const zones = allTimeZones();
  const count = settings.zones.length || 1;
  const set = (i: number, z: string) => {
    const next = [...settings.zones];
    next[i] = z;
    setSettings({ zones: next.filter(Boolean) });
  };
  return (
    <div className="w-form">
      <datalist id="w-zones">
        {zones.map((z) => (
          <option key={z} value={z} />
        ))}
      </datalist>
      {Array.from({ length: Math.max(count, 1) }, (_, i) => (
        <input
          key={i}
          className="w-input"
          list="w-zones"
          defaultValue={settings.zones[i] ?? ""}
          placeholder="Time zone, e.g. Asia/Tokyo"
          onBlur={(e) => zones.includes(e.target.value) && set(i, e.target.value)}
        />
      ))}
    </div>
  );
}

export function WorldTime({ settings }: WidgetProps<ZonesSettings>) {
  const now = useNow();
  const zone = settings.zones[0] ?? "UTC";
  return (
    <Tile className="w-center">
      <div className="w-muted">{zoneCity(zone)}</div>
      <div className="w-clock-big">{timeString(now, { timeZone: zone })}</div>
      <div className="w-muted w-small">
        {now.toLocaleDateString(undefined, { weekday: "short", timeZone: zone })} · {offsetLabel(zone, now)}
      </div>
    </Tile>
  );
}

export function DateWidget() {
  const now = useNow(60_000);
  return (
    <Tile className="w-center">
      <div className="w-date-weekday">{now.toLocaleDateString(undefined, { weekday: "long" })}</div>
      <div className="w-date-big">{now.toLocaleDateString(undefined, { day: "numeric", month: "long" })}</div>
      <div className="w-muted">{now.getFullYear()}</div>
    </Tile>
  );
}

export function DayNumber() {
  const now = useNow(60_000);
  return (
    <Tile className="w-center">
      <div className="w-page">
        <div className="w-page-month">{now.toLocaleDateString(undefined, { month: "short" }).toUpperCase()}</div>
        <div className="w-page-day">{now.getDate()}</div>
        <div className="w-page-weekday">{now.toLocaleDateString(undefined, { weekday: "long" })}</div>
      </div>
    </Tile>
  );
}

export function Today({ shared }: WidgetProps<Record<string, never>>) {
  const now = useNow();
  const { data } = useWeather(shared);
  const look = data ? weatherLook(data.current.weather_code, data.current.is_day === 1) : null;
  return (
    <Tile>
      <div className="w-row">
        <div>
          <div className="w-date-weekday">{now.toLocaleDateString(undefined, { weekday: "long" })}</div>
          <div className="w-muted">{now.toLocaleDateString(undefined, { day: "numeric", month: "long", year: "numeric" })}</div>
        </div>
        <div className="w-clock-mid">{timeString(now)}</div>
      </div>
      {data && look && (
        <div className="w-row w-muted">
          <span>
            {look[0]} {look[1]}
          </span>
          <span>
            {Math.round(data.current.temperature_2m)}° · H {Math.round(data.daily.temperature_2m_max[0])}° L{" "}
            {Math.round(data.daily.temperature_2m_min[0])}°
          </span>
        </div>
      )}
    </Tile>
  );
}

export function ClockWeather({ shared }: WidgetProps<Record<string, never>>) {
  const now = useNow();
  const { data } = useWeather(shared);
  return (
    <Tile className="w-center">
      <div className="w-clock-mid">{timeString(now)}</div>
      <div className="w-muted">{now.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}</div>
      {data && (
        <div className="w-big-temp">
          {weatherLook(data.current.weather_code, data.current.is_day === 1)[0]} {Math.round(data.current.temperature_2m)}°
        </div>
      )}
    </Tile>
  );
}

export function WeekStrip({ shared }: WidgetProps<Record<string, never>>) {
  const { data } = useWeather(shared);
  const today = new Date();
  const days = Array.from({ length: 7 }, (_, i) => new Date(today.getFullYear(), today.getMonth(), today.getDate() + i));
  return (
    <Tile>
      <div className="w-week">
        {days.map((d, i) => (
          <div key={i} className={"w-week-day" + (i === 0 ? " today" : "")}>
            <span className="w-small">{d.toLocaleDateString(undefined, { weekday: "narrow" })}</span>
            <b>{d.getDate()}</b>
            {data && (
              <span className="w-small">
                {weatherLook(data.daily.weather_code[i])[0]} {Math.round(data.daily.temperature_2m_max[i])}°
              </span>
            )}
          </div>
        ))}
      </div>
    </Tile>
  );
}

// ---------- progress ----------

function progressOf(kind: "day" | "month" | "year", now: Date) {
  const y = now.getFullYear();
  const m = now.getMonth();
  const [start, end] =
    kind === "day"
      ? [new Date(y, m, now.getDate()), new Date(y, m, now.getDate() + 1)]
      : kind === "month"
        ? [new Date(y, m, 1), new Date(y, m + 1, 1)]
        : [new Date(y, 0, 1), new Date(y + 1, 0, 1)];
  return (now.getTime() - start.getTime()) / (end.getTime() - start.getTime());
}

function ProgressBar({ kind, label }: { kind: "day" | "month"; label: (d: Date) => string }) {
  const now = useNow(30_000);
  const p = progressOf(kind, now);
  return (
    <Tile title={label(now)}>
      <div className="w-big-pct">{(p * 100).toFixed(1)}%</div>
      <div className="w-meter">
        <div className="w-meter-fill" style={{ width: `${p * 100}%` }} />
      </div>
    </Tile>
  );
}

export const DayProgress = () => <ProgressBar kind="day" label={() => "Today"} />;
export const MonthProgress = () => (
  <ProgressBar kind="month" label={(d) => d.toLocaleDateString(undefined, { month: "long" })} />
);

export function YearProgress() {
  const now = useNow(60_000);
  const y = now.getFullYear();
  const total = (new Date(y + 1, 0, 1).getTime() - new Date(y, 0, 1).getTime()) / 86_400_000;
  const day = Math.floor((now.getTime() - new Date(y, 0, 1).getTime()) / 86_400_000);
  return (
    <Tile title={`${y} · ${(progressOf("year", now) * 100).toFixed(1)}%`}>
      <div className="w-dots">
        {Array.from({ length: total }, (_, i) => (
          <span key={i} className={i < day ? "past" : i === day ? "now" : ""} />
        ))}
      </div>
      <div className="w-muted w-small">{total - day - 1} days left</div>
    </Tile>
  );
}
