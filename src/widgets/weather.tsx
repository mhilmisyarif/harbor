// Weather widgets. They share one Open-Meteo request per location and units.
import { useEffect, useState } from "react";
import { api, GeoResult, WeatherResponse, weatherLook, WidgetConfig } from "../lib/api";
import { compass, currentHourIndex, minutesOf, useWeather } from "./data";
import { Tile, useNow, WidgetProps } from "./kit";

type Props = WidgetProps<Record<string, never>>;

/** City search (Open-Meteo geocoding) or opt-in approximate IP location. */
export function LocationPicker({ shared, updateShared, onDone }: {
  shared: WidgetConfig;
  updateShared: (p: Partial<WidgetConfig>) => void;
  onDone?: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeoResult[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (query.trim().length < 2) {
      setResults([]);
      return;
    }
    const t = setTimeout(() => {
      api.geocode(query).then((r) => setResults(r.results ?? []), (e) => setError(String(e)));
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  const choose = (name: string, lat: number, lon: number) => {
    updateShared({ location: { name, lat, lon } });
    setQuery("");
    onDone?.();
  };

  const detect = async () => {
    try {
      const r = await api.locateByIp();
      const [lat, lon] = (r.loc ?? "").split(",").map(Number);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) throw new Error("location unavailable");
      choose(r.city ?? "My location", lat, lon);
    } catch (e) {
      setError(String(e));
    }
  };

  return (
    <div className="w-form">
      <input className="w-input" autoFocus placeholder="Search a city…" value={query} onChange={(e) => setQuery(e.target.value)} />
      {results.map((r) => (
        <button key={`${r.latitude},${r.longitude}`} className="w-pick" onClick={() => choose(r.name, r.latitude, r.longitude)}>
          <span>{r.name}</span>
          <span className="w-muted">{[r.admin1, r.country].filter(Boolean).join(", ")}</span>
        </button>
      ))}
      <div className="w-row">
        <button className="w-link" onClick={detect} title="Uses ipinfo.io to estimate your city">
          Use my approximate location
        </button>
        <label className="w-check">
          <input type="checkbox" checked={shared.imperial} onChange={(e) => updateShared({ imperial: e.target.checked })} />
          °F / mph
        </label>
      </div>
      {error && <p className="w-error">{error}</p>}
    </div>
  );
}

/** Location settings form, shared by every weather widget's ⚙. */
export const WeatherForm = ({ shared, updateShared }: Props) => <LocationPicker shared={shared} updateShared={updateShared} />;

/** Renders `body` once weather has loaded, or a city prompt / status. */
function WithWeather({ shared, updateShared, title, body }: Props & {
  title?: string;
  body: (w: WeatherResponse) => React.ReactNode;
}) {
  const { data, error } = useWeather(shared);
  if (!shared.location) {
    return (
      <Tile title={title ?? "Weather"}>
        <p className="w-muted w-small">Pick a city to see the weather.</p>
        <LocationPicker shared={shared} updateShared={updateShared} />
      </Tile>
    );
  }
  return (
    <Tile title={title}>
      {data ? body(data) : <p className="w-muted">{error ?? "Loading…"}</p>}
    </Tile>
  );
}

const day = (iso: string, i: number) =>
  i === 0 ? "Today" : new Date(iso + "T12:00").toLocaleDateString(undefined, { weekday: "short" });

export const Weather = (p: Props) => (
  <WithWeather
    {...p}
    title={p.shared.location?.name}
    body={(w) => {
      const [icon, label] = weatherLook(w.current.weather_code, w.current.is_day === 1);
      return (
        <div className="w-row">
          <span className="w-weather-icon">{icon}</span>
          <div className="w-right">
            <div className="w-big">{Math.round(w.current.temperature_2m)}°</div>
            <div className="w-muted w-small">{label}</div>
            <div className="w-small">
              H {Math.round(w.daily.temperature_2m_max[0])}° · L {Math.round(w.daily.temperature_2m_min[0])}°
            </div>
          </div>
        </div>
      );
    }}
  />
);

export const WeatherDetails = (p: Props) => (
  <WithWeather
    {...p}
    title="Details"
    body={(w) => (
      <div className="w-stats">
        <div>
          <span className="w-muted">Wind</span>
          <b>
            {Math.round(w.current.wind_speed_10m)} {w.current_units.wind_speed_10m} {compass(w.current.wind_direction_10m)}
          </b>
        </div>
        <div>
          <span className="w-muted">Rain today</span>
          <b>
            {w.daily.precipitation_sum[0]} {w.current_units.precipitation} · {w.daily.precipitation_probability_max[0]}%
          </b>
        </div>
        <div>
          <span className="w-muted">Range</span>
          <b>
            {Math.round(w.daily.temperature_2m_min[0])}° – {Math.round(w.daily.temperature_2m_max[0])}°
          </b>
        </div>
        <div>
          <span className="w-muted">Humidity · UV</span>
          <b>
            {w.current.relative_humidity_2m}% · {Math.round(w.daily.uv_index_max[0])}
          </b>
        </div>
      </div>
    )}
  />
);

export const Forecast = (p: Props) => (
  <WithWeather
    {...p}
    title={p.shared.location?.name}
    body={(w) => (
      <div className="w-forecast">
        {w.daily.time.slice(0, 4).map((d, i) => (
          <div key={d} className="w-day">
            <span className="w-muted">{day(d, i)}</span>
            <span className="w-day-icon">{weatherLook(w.daily.weather_code[i])[0]}</span>
            <span>
              {Math.round(w.daily.temperature_2m_max[i])}°<span className="w-muted"> {Math.round(w.daily.temperature_2m_min[i])}°</span>
            </span>
          </div>
        ))}
      </div>
    )}
  />
);

/** "Light rain, 14°. Feels like 12°. Rain likely later today (80%)." */
function describe(w: WeatherResponse) {
  const [, label] = weatherLook(w.current.weather_code, w.current.is_day === 1);
  const t = Math.round(w.current.temperature_2m);
  const feels = Math.round(w.current.apparent_temperature);
  const parts = [`${label}, ${t}°.`];
  if (Math.abs(feels - t) >= 2) parts.push(`Feels like ${feels}°.`);
  const i = currentHourIndex(w.hourly.time, w.current.time);
  const nextRain = w.hourly.precipitation_probability.slice(i + 1, i + 7);
  const peak = Math.max(0, ...nextRain);
  if (peak >= 60) parts.push(`Rain likely in the next hours (${peak}%).`);
  else if (peak >= 30) parts.push(`A chance of rain later (${peak}%).`);
  else parts.push("Dry for the next few hours.");
  if (w.current.wind_speed_10m >= (w.current_units.wind_speed_10m === "mph" ? 20 : 30)) parts.push("Windy.");
  return parts.join(" ");
}

export const WeatherStatus = (p: Props) => (
  <WithWeather {...p} title={p.shared.location?.name} body={(w) => <p className="w-status">{describe(w)}</p>} />
);

export const Hourly = (p: Props) => (
  <WithWeather
    {...p}
    title="Next hours"
    body={(w) => {
      const i = currentHourIndex(w.hourly.time, w.current.time);
      return (
        <div className="w-hours">
          {w.hourly.time.slice(i, i + 6).map((t, k) => (
            <div key={t} className="w-day">
              <span className="w-muted">{k === 0 ? "Now" : t.slice(11, 16)}</span>
              <span className="w-day-icon">{weatherLook(w.hourly.weather_code[i + k], w.hourly.is_day[i + k] === 1)[0]}</span>
              <span>{Math.round(w.hourly.temperature_2m[i + k])}°</span>
              <span className="w-small w-rain">{w.hourly.precipitation_probability[i + k]}%</span>
            </div>
          ))}
        </div>
      );
    }}
  />
);

/** The sun's place on its arc between today's sunrise and sunset (in the city's time). */
function SunArc({ w }: { w: WeatherResponse }) {
  useNow(60_000);
  const rise = minutesOf(w.daily.sunrise[0]);
  const set = minutesOf(w.daily.sunset[0]);
  // Minutes past midnight in the city's own time zone.
  const now = Math.floor((Date.now() / 60_000 + w.utc_offset_seconds / 60) % 1440);
  const t = Math.min(1, Math.max(0, (now - rise) / (set - rise)));
  const up = now >= rise && now <= set;
  const x = 10 + 80 * t;
  const y = 50 - 38 * Math.sin(Math.PI * t);
  const len = set - rise;
  return (
    <>
      <svg viewBox="0 0 100 56" className="w-sun">
        <path d="M10 50 Q50 -26 90 50" className="w-sun-path" />
        <line x1="4" y1="50" x2="96" y2="50" className="w-sun-horizon" />
        {up && <circle cx={x} cy={y} r="5" className="w-sun-dot" />}
      </svg>
      <div className="w-row w-small">
        <span>🌅 {w.daily.sunrise[0].slice(11, 16)}</span>
        <span className="w-muted">
          {Math.floor(len / 60)}h {len % 60}m of light
        </span>
        <span>🌇 {w.daily.sunset[0].slice(11, 16)}</span>
      </div>
    </>
  );
}

export const Sun = (p: Props) => <WithWeather {...p} title="Sunrise & sunset" body={(w) => <SunArc w={w} />} />;
