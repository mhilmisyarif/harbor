import { ReactNode, useCallback, useEffect, useState } from "react";
import { emit } from "@tauri-apps/api/event";
import {
  api,
  CryptoTicker,
  GeoResult,
  poll,
  StockResult,
  SystemInfo,
  WeatherResponse,
  weatherLook,
  WIDGET_CONFIG_EVENT,
  WidgetConfig,
} from "../lib/api";

// ---------- helpers ----------

const fmtBytes = (n: number) => {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
};

const fmtPrice = (n: number) =>
  n.toLocaleString(undefined, { maximumFractionDigits: n >= 100 ? 2 : n >= 1 ? 3 : 6 });

const fmtUptime = (s: number) => {
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return d ? `${d}d ${h}h` : h ? `${h}h ${m}m` : `${m}m`;
};

const parseList = (text: string) =>
  text
    .split(/[\s,]+/)
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean);

function Change({ pct }: { pct: number }) {
  const cls = pct > 0 ? "up" : pct < 0 ? "down" : "";
  return (
    <span className={"w-change " + cls}>
      {pct > 0 ? "+" : ""}
      {pct.toFixed(2)}%
    </span>
  );
}

function Sparkline({ values }: { values: number[] }) {
  if (values.length < 2) return <svg className="w-spark" />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values
    .map((v, i) => `${(i / (values.length - 1)) * 60},${18 - ((v - min) / span) * 16}`)
    .join(" ");
  const up = values[values.length - 1] >= values[0];
  return (
    <svg className={"w-spark " + (up ? "up" : "down")} viewBox="0 0 60 20" preserveAspectRatio="none">
      <polyline points={pts} fill="none" strokeWidth="1.5" />
    </svg>
  );
}

interface CardProps {
  title: string;
  icon: string;
  children: ReactNode;
  editing?: boolean;
  onEdit?: () => void;
}

function Card({ title, icon, children, editing, onEdit }: CardProps) {
  return (
    <section className="w-card">
      <header className="w-card-head">
        <span>
          {icon} {title}
        </span>
        {onEdit && (
          <button className="w-link" onClick={onEdit}>
            {editing ? "Done" : "Edit"}
          </button>
        )}
      </header>
      {children}
    </section>
  );
}

/** Comma-separated symbol editor, committed on Enter or blur. */
function ListEditor({
  value,
  placeholder,
  onCommit,
}: {
  value: string[];
  placeholder: string;
  onCommit: (list: string[]) => void;
}) {
  const [text, setText] = useState(value.join(", "));
  const commit = () => onCommit(parseList(text));
  return (
    <input
      className="w-input"
      autoFocus
      value={text}
      placeholder={placeholder}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === "Enter" && commit()}
    />
  );
}

function ErrorLine({ error }: { error: string | null }) {
  return error ? <p className="w-error">{error}</p> : null;
}

// ---------- cards ----------

function WeatherCard({ config, update }: { config: WidgetConfig; update: (c: WidgetConfig) => void }) {
  const [data, setData] = useState<WeatherResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(!config.location);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<GeoResult[]>([]);
  const loc = config.location;

  useEffect(() => {
    if (!loc) return;
    setError(null);
    return poll(
      () => api.weather(loc.lat, loc.lon, config.imperial).catch((e) => Promise.reject(setError(String(e)))),
      15 * 60_000,
      setData,
    );
  }, [loc?.lat, loc?.lon, config.imperial]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!editing || query.trim().length < 2) {
      setResults([]);
      return;
    }
    const t = setTimeout(() => {
      api.geocode(query).then((r) => setResults(r.results ?? []), (e) => setError(String(e)));
    }, 300);
    return () => clearTimeout(t);
  }, [query, editing]);

  const choose = (name: string, lat: number, lon: number) => {
    update({ ...config, location: { name, lat, lon } });
    setEditing(false);
    setQuery("");
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

  const c = data?.current;
  const [icon, label] = c ? weatherLook(c.weather_code, c.is_day === 1) : ["", ""];
  const unit = config.imperial ? "°F" : "°C";

  return (
    <Card title={loc?.name ?? "Weather"} icon="🌍" editing={editing} onEdit={() => setEditing(!editing)}>
      {editing && (
        <div className="w-stack">
          <input
            className="w-input"
            autoFocus
            placeholder="Search a city…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {results.map((r) => (
            <button
              key={`${r.latitude},${r.longitude}`}
              className="w-row w-pick"
              onClick={() => choose(r.name, r.latitude, r.longitude)}
            >
              <span>{r.name}</span>
              <span className="w-muted">{[r.admin1, r.country].filter(Boolean).join(", ")}</span>
            </button>
          ))}
          <div className="w-row">
            <button className="w-link" onClick={detect} title="Uses ipinfo.io to estimate your city">
              Use my approximate location
            </button>
            <label className="w-muted">
              <input
                type="checkbox"
                checked={config.imperial}
                onChange={(e) => update({ ...config, imperial: e.target.checked })}
              />{" "}
              °F / mph
            </label>
          </div>
        </div>
      )}
      {!editing && !loc && <p className="w-muted">Pick a city to see the forecast.</p>}
      {!editing && c && data && (
        <>
          <div className="w-weather-now">
            <span className="w-weather-icon">{icon}</span>
            <div>
              <div className="w-big">
                {Math.round(c.temperature_2m)}
                {unit}
              </div>
              <div className="w-muted">
                {label} · feels {Math.round(c.apparent_temperature)}° · 💧{c.relative_humidity_2m}% · 💨
                {Math.round(c.wind_speed_10m)} {data.current_units.wind_speed_10m}
              </div>
            </div>
          </div>
          <div className="w-forecast">
            {data.daily.time.map((day, i) => (
              <div key={day} className="w-day">
                <span className="w-muted">
                  {i === 0 ? "Today" : new Date(day + "T12:00").toLocaleDateString(undefined, { weekday: "short" })}
                </span>
                <span>{weatherLook(data.daily.weather_code[i])[0]}</span>
                <span>
                  {Math.round(data.daily.temperature_2m_max[i])}°
                  <span className="w-muted"> {Math.round(data.daily.temperature_2m_min[i])}°</span>
                </span>
              </div>
            ))}
          </div>
        </>
      )}
      <ErrorLine error={error} />
    </Card>
  );
}

function StocksCard({ config, update }: { config: WidgetConfig; update: (c: WidgetConfig) => void }) {
  const [rows, setRows] = useState<StockResult[]>([]);
  const [editing, setEditing] = useState(false);
  useEffect(() => poll(() => api.stocks(config.stocks), 60_000, setRows), [config.stocks.join()]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Card title="Stocks" icon="📈" editing={editing} onEdit={() => setEditing(!editing)}>
      {editing ? (
        <ListEditor
          value={config.stocks}
          placeholder="AAPL, MSFT, ^GSPC"
          onCommit={(stocks) => {
            update({ ...config, stocks });
            setEditing(false);
          }}
        />
      ) : (
        rows.map((r) => {
          const res = r.data?.chart.result?.[0];
          if (!res) {
            return (
              <div key={r.symbol} className="w-row">
                <b>{r.symbol}</b>
                <span className="w-muted">{r.error ?? "no data"}</span>
              </div>
            );
          }
          const price = res.meta.regularMarketPrice;
          const prev = res.meta.chartPreviousClose;
          const closes = (res.indicators.quote[0]?.close ?? []).filter((v): v is number => v !== null);
          return (
            <div key={r.symbol} className="w-row">
              <b className="w-sym">{r.symbol}</b>
              <Sparkline values={closes} />
              <span className="w-num">{fmtPrice(price)}</span>
              <Change pct={prev ? ((price - prev) / prev) * 100 : 0} />
            </div>
          );
        })
      )}
    </Card>
  );
}

function CryptoCard({ config, update }: { config: WidgetConfig; update: (c: WidgetConfig) => void }) {
  const [rows, setRows] = useState<CryptoTicker[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  useEffect(
    () =>
      poll(
        () => api.crypto(config.crypto).then((r) => (setError(null), r), (e) => Promise.reject(setError(String(e)))),
        30_000,
        setRows,
      ),
    [config.crypto.join()], // eslint-disable-line react-hooks/exhaustive-deps
  );

  return (
    <Card title="Crypto" icon="🪙" editing={editing} onEdit={() => setEditing(!editing)}>
      {editing ? (
        <ListEditor
          value={config.crypto}
          placeholder="BTCUSDT, ETHUSDT"
          onCommit={(crypto) => {
            update({ ...config, crypto });
            setEditing(false);
          }}
        />
      ) : (
        rows.map((t) => (
          <div key={t.symbol} className="w-row">
            <b className="w-sym">{t.symbol.replace(/(USDT|USDC|BUSD|USD)$/, "")}</b>
            <span className="w-num">{fmtPrice(Number(t.lastPrice))}</span>
            <Change pct={Number(t.priceChangePercent)} />
          </div>
        ))
      )}
      <ErrorLine error={error} />
    </Card>
  );
}

function CurrencyCard({ config, update }: { config: WidgetConfig; update: (c: WidgetConfig) => void }) {
  const [rates, setRates] = useState<Record<string, number>>({});
  const [date, setDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [amount, setAmount] = useState(1);

  useEffect(() => {
    setError(null);
    return poll(
      () => api.fx(config.fxBase, config.fxQuotes).catch((e) => Promise.reject(setError(String(e)))),
      60 * 60_000,
      (r) => {
        setRates(r.rates);
        setDate(r.date);
      },
    );
  }, [config.fxBase, config.fxQuotes.join()]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Card title="Currency" icon="💱" editing={editing} onEdit={() => setEditing(!editing)}>
      {editing ? (
        <ListEditor
          value={[config.fxBase, ...config.fxQuotes]}
          placeholder="USD, EUR, JPY (first one is the base)"
          onCommit={([base, ...quotes]) => {
            if (base) update({ ...config, fxBase: base, fxQuotes: quotes });
            setEditing(false);
          }}
        />
      ) : (
        <>
          <div className="w-row">
            <input
              className="w-input w-amount"
              type="number"
              min={0}
              value={amount}
              onChange={(e) => setAmount(Math.max(0, Number(e.target.value)))}
            />
            <b>{config.fxBase}</b>
          </div>
          {Object.entries(rates).map(([code, rate]) => (
            <div key={code} className="w-row">
              <span className="w-sym">{code}</span>
              <span className="w-num">{fmtPrice(rate * amount)}</span>
            </div>
          ))}
          {date && <p className="w-muted w-small">ECB reference rates, {date}</p>}
        </>
      )}
      <ErrorLine error={error} />
    </Card>
  );
}

function SystemCard() {
  const [info, setInfo] = useState<SystemInfo | null>(null);
  useEffect(() => poll(api.systemWidgets, 2000, setInfo), []);
  if (!info) return null;
  return (
    <Card title="System" icon="🖥️">
      <div className="w-row">
        <span>↓ {fmtBytes(info.rxPerSec)}/s</span>
        <span>↑ {fmtBytes(info.txPerSec)}/s</span>
        <span className="w-muted">up {fmtUptime(info.uptimeSecs)}</span>
      </div>
      {info.disks.map((d) => {
        const used = d.total - d.available;
        const pct = (used / d.total) * 100;
        return (
          <div key={d.mount} className="w-disk">
            <div className="w-row">
              <span>{d.mount}</span>
              <span className="w-muted">
                {fmtBytes(d.available)} free of {fmtBytes(d.total)}
              </span>
            </div>
            <div className="w-meter">
              <div className={"w-meter-fill" + (pct > 90 ? " warn" : "")} style={{ width: `${pct}%` }} />
            </div>
          </div>
        );
      })}
    </Card>
  );
}

function CalendarCard() {
  const [month, setMonth] = useState(() => {
    const d = new Date();
    return new Date(d.getFullYear(), d.getMonth(), 1);
  });
  const today = new Date();
  const firstWeekday = (month.getDay() + 6) % 7; // Monday first
  const days = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells = [...Array(firstWeekday).fill(null), ...Array.from({ length: days }, (_, i) => i + 1)];
  const isToday = (d: number) =>
    d === today.getDate() && month.getMonth() === today.getMonth() && month.getFullYear() === today.getFullYear();
  const shift = (n: number) => setMonth(new Date(month.getFullYear(), month.getMonth() + n, 1));

  return (
    <Card title={month.toLocaleDateString(undefined, { month: "long", year: "numeric" })} icon="📅">
      <div className="w-row">
        <button className="w-link" onClick={() => shift(-1)}>
          ‹ Prev
        </button>
        <button className="w-link" onClick={() => setMonth(new Date(today.getFullYear(), today.getMonth(), 1))}>
          Today
        </button>
        <button className="w-link" onClick={() => shift(1)}>
          Next ›
        </button>
      </div>
      <div className="w-cal">
        {["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"].map((d) => (
          <span key={d} className="w-muted">
            {d}
          </span>
        ))}
        {cells.map((d, i) => (
          <span key={i} className={d && isToday(d) ? "w-today" : ""}>
            {d ?? ""}
          </span>
        ))}
      </div>
    </Card>
  );
}

// ---------- panel ----------

export function Widgets() {
  const [config, setConfig] = useState<WidgetConfig | null>(null);
  useEffect(() => {
    api.loadWidgetConfig().then(setConfig);
  }, []);

  const update = useCallback((next: WidgetConfig) => {
    setConfig(next);
    api
      .saveWidgetConfig(next)
      .then(() => emit(WIDGET_CONFIG_EVENT))
      .catch(console.error);
  }, []);

  if (!config) return null;
  return (
    <div className="w-panel">
      <WeatherCard config={config} update={update} />
      <StocksCard config={config} update={update} />
      <CryptoCard config={config} update={update} />
      <CurrencyCard config={config} update={update} />
      <SystemCard />
      <CalendarCard />
      <button className="w-link w-settings" onClick={() => api.openSettings()}>
        ⚙ Settings
      </button>
    </div>
  );
}
