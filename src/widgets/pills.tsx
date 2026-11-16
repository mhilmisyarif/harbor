// Compact "pill" versions of widgets for the dock strip. A pill is as tall as
// the dock's icons (var(--icon)) and as wide as its content.
import { FC, ReactNode, useState } from "react";
import { api, weatherLook } from "../lib/api";
import { useMicrophone, useNetworkHistory, useNowPlaying, useStats, useSystemInfo, useVolume, useWeather } from "./data";
import { Change, fmtBytes, fmtPrice, Ring, setShared, Spark, timeString, useNow, useShared, WidgetProps, zonedParts } from "./kit";
import { fmtStopwatch, PHASE_LABEL, PomodoroSettings, useCountdown, usePomodoro, useStopwatch } from "./timers";

type P = WidgetProps<any>; // eslint-disable-line @typescript-eslint/no-explicit-any

function Pill({ children, onClick, title, className = "" }: {
  children: ReactNode;
  onClick?: () => void;
  title?: string;
  className?: string;
}) {
  return (
    <div className={"pill " + className + (onClick ? " pill-click" : "")} onClick={onClick} title={title}>
      {children}
    </div>
  );
}

const Stack = ({ top, bottom }: { top: ReactNode; bottom: ReactNode }) => (
  <div className="pill-stack">
    <div className="pill-top">{top}</div>
    <div className="pill-sub">{bottom}</div>
  </div>
);

const RoundBtn = ({ onClick, label, children, accent }: { onClick: () => void; label: string; children: ReactNode; accent?: string }) => (
  <button
    className="pill-round"
    aria-label={label}
    style={accent ? { background: accent } : undefined}
    onClick={(e) => {
      e.stopPropagation();
      onClick();
    }}
  >
    {children}
  </button>
);

// ---------- clocks ----------

const ClockPill = ({ settings }: P) => {
  const now = useNow();
  return (
    <Pill>
      <Stack
        top={<span className="pill-time">{timeString(now, { seconds: settings.seconds, h24: settings.h24 })}</span>}
        bottom={now.toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" })}
      />
    </Pill>
  );
};

const FlipPill = ({ settings }: P) => {
  const now = useNow();
  const { h, m } = zonedParts(now);
  const hh = settings.h24 ? h : ((h + 11) % 12) + 1;
  const digits = String(hh).padStart(2, "0") + String(m).padStart(2, "0");
  return (
    <Pill className="pill-flip">
      {digits.split("").map((d, i) => (
        <span key={i} className={"pill-flap" + (i === 2 ? " gap" : "")}>
          {d}
        </span>
      ))}
      {!settings.h24 && <span className="pill-sub">{h < 12 ? "AM" : "PM"}</span>}
    </Pill>
  );
};

const SegmentPill = ({ settings }: P) => {
  const now = useNow();
  const text = timeString(now, { seconds: settings.seconds, h24: true });
  return (
    <Pill>
      <span className="w-segment pill-segment">
        <span className="w-segment-ghost">{text.replace(/\d/g, "8")}</span>
        <span className="w-segment-on">{text}</span>
      </span>
    </Pill>
  );
};

const DatePill = () => {
  const now = useNow(60_000);
  return (
    <Pill>
      <div className="pill-page">
        <span className="pill-page-month">{now.toLocaleDateString(undefined, { month: "short" }).toUpperCase()}</span>
        <span className="pill-page-day">{now.getDate()}</span>
      </div>
      <Stack top={now.toLocaleDateString(undefined, { weekday: "long" })} bottom={now.getFullYear()} />
    </Pill>
  );
};

const WorldTimePill = ({ settings }: P) => {
  const now = useNow();
  const zone: string = settings.zones?.[0] ?? "UTC";
  return (
    <Pill>
      <Stack top={<span className="pill-time">{timeString(now, { timeZone: zone })}</span>} bottom={zone.split("/").pop()!.replace(/_/g, " ")} />
    </Pill>
  );
};

const DayProgressPill = () => {
  const now = useNow(30_000);
  const p = (now.getHours() * 60 + now.getMinutes()) / 1440;
  return (
    <Pill>
      <Ring value={p} size={36} stroke={4}>
        <span className="pill-tiny">{Math.round(p * 100)}</span>
      </Ring>
      <Stack top="Today" bottom={`${Math.round(p * 100)}% done`} />
    </Pill>
  );
};

// ---------- productivity ----------

const PomodoroPill = ({ settings }: WidgetProps<PomodoroSettings>) => {
  const p = usePomodoro(settings);
  const color = p.phase === "focus" ? "#f87171" : "#4ade80";
  return (
    <Pill className={p.running ? "pill-active" : ""}>
      <Stack top={<span className="pill-time">{p.label}</span>} bottom={<span style={{ color }}>{PHASE_LABEL[p.phase]} {p.round}/{settings.rounds}</span>} />
      <RoundBtn label="Skip" onClick={p.skip}>⏭</RoundBtn>
      <RoundBtn label={p.running ? "Pause" : "Start"} onClick={p.toggle} accent={color}>
        {p.running ? "⏸" : "▶"}
      </RoundBtn>
    </Pill>
  );
};

const TimerPill = () => {
  const t = useCountdown();
  const [menu, setMenu] = useState(false);
  return (
    <Pill className={t.running ? "pill-active" : ""}>
      <Stack
        top={<span className="pill-time">{t.label}</span>}
        bottom={
          menu ? (
            <span className="pill-presets">
              {[1, 5, 10, 25].map((m) => (
                <button key={m} onClick={() => (t.start(m * 60_000), setMenu(false))}>
                  {m}m
                </button>
              ))}
            </span>
          ) : (
            <button className="pill-link" onClick={() => setMenu(true)}>
              Timer ▾
            </button>
          )
        }
      />
      <RoundBtn label={t.running ? "Pause" : "Start"} onClick={() => (t.running || t.paused ? t.toggle() : t.start(t.duration))} accent="#3b82f6">
        {t.running ? "⏸" : "▶"}
      </RoundBtn>
    </Pill>
  );
};

const StopwatchPill = () => {
  const s = useStopwatch();
  return (
    <Pill className={s.running ? "pill-active" : ""}>
      <Stack top={<span className="pill-time">{fmtStopwatch(s.elapsed)}</span>} bottom={s.running ? "Running" : s.elapsed ? "Paused" : "Stopwatch"} />
      {s.elapsed > 0 && !s.running && (
        <RoundBtn label="Reset" onClick={s.reset}>
          ↺
        </RoundBtn>
      )}
      <RoundBtn label={s.running ? "Pause" : "Start"} onClick={s.toggle} accent="#f59e0b">
        {s.running ? "⏸" : "▶"}
      </RoundBtn>
    </Pill>
  );
};

const TodosPill = ({ id }: P) => {
  const { data } = useShared(`todos-${id}`, () => api.loadWidgetData<{ text: string; done: boolean }[]>(`todos-${id}`), 5000);
  const todos = data ?? [];
  const done = todos.filter((t) => t.done).length;
  const open = todos.filter((t) => !t.done).slice(0, 2);
  return (
    <Pill onClick={() => api.toggleWidgets()} title="Edit todos in the widget panel">
      <Ring value={todos.length ? done / todos.length : 0} size={36} stroke={4} color="#4ade80">
        <span className="pill-tiny">{todos.length - done}</span>
      </Ring>
      <div className="pill-stack pill-todos">
        {open.length ? open.map((t, i) => <div key={i} className="w-ellipsis">○ {t.text}</div>) : <div className="pill-sub">All done</div>}
      </div>
    </Pill>
  );
};

const CurrencyPill = ({ shared }: P) => {
  const quote = shared.fxQuotes[0];
  const { data } = useShared(`fx:${shared.fxBase}:${shared.fxQuotes.join(",")}`, () => api.fx(shared.fxBase, shared.fxQuotes), 60 * 60_000);
  const rate = quote ? data?.rates[quote] : undefined;
  return (
    <Pill>
      <Stack top={<b>{rate ? fmtPrice(rate * 100) : "…"}</b>} bottom={`100 ${shared.fxBase} → ${quote ?? "?"}`} />
    </Pill>
  );
};

// ---------- weather ----------

const WeatherPill = ({ shared }: P) => {
  const { data } = useWeather(shared);
  if (!shared.location) return <Pill onClick={() => api.toggleWidgets()}>🌤️ <span className="pill-sub">Set city</span></Pill>;
  if (!data) return <Pill>…</Pill>;
  const [icon, label] = weatherLook(data.current.weather_code, data.current.is_day === 1);
  return (
    <Pill title={`${shared.location.name}: ${label}`}>
      <span className="pill-icon">{icon}</span>
      <Stack top={<b className="pill-temp">{Math.round(data.current.temperature_2m)}°</b>} bottom={label} />
    </Pill>
  );
};

const ForecastPill = ({ shared }: P) => {
  const { data } = useWeather(shared);
  if (!data) return <WeatherPill shared={shared} id="" settings={{}} setSettings={() => {}} updateShared={() => {}} />;
  return (
    <Pill>
      <span className="pill-icon">{weatherLook(data.current.weather_code, data.current.is_day === 1)[0]}</span>
      <Stack top={<b className="pill-temp">{Math.round(data.current.temperature_2m)}°</b>} bottom="Today" />
      {data.daily.time.slice(1, 4).map((d, i) => (
        <div key={d} className="pill-day">
          <span className="pill-sub">{new Date(d + "T12:00").toLocaleDateString(undefined, { weekday: "short" })}</span>
          <span>{weatherLook(data.daily.weather_code[i + 1])[0]}</span>
          <span className="pill-sub">
            {Math.round(data.daily.temperature_2m_max[i + 1])}° {Math.round(data.daily.temperature_2m_min[i + 1])}°
          </span>
        </div>
      ))}
    </Pill>
  );
};

// ---------- markets ----------

const CryptoPill = ({ settings }: P) => {
  const sym: string = settings.symbol ?? "BTCUSDT";
  const { data } = useShared(`crypto:${sym}`, () => api.crypto([sym]), 30_000);
  const t = data?.[0];
  return (
    <Pill>
      <Stack top={<b>{t ? fmtPrice(Number(t.lastPrice)) : "…"}</b>} bottom={sym.replace(/(USDT|USDC|BUSD|USD)$/, "")} />
      {t && <Change pct={Number(t.priceChangePercent)} />}
    </Pill>
  );
};

const StockPill = ({ settings }: P) => {
  const sym: string = settings.symbol ?? "AAPL";
  const { data } = useShared(`stocks:${sym}`, () => api.stocks([sym]), 60_000);
  const res = data?.[0]?.data?.chart.result?.[0];
  const price = res?.meta.regularMarketPrice;
  const prev = res?.meta.chartPreviousClose;
  const closes = (res?.indicators.quote[0]?.close ?? []).filter((v): v is number => v !== null);
  const change = price && prev ? ((price - prev) / prev) * 100 : 0;
  return (
    <Pill>
      <Stack top={<b>{price ? fmtPrice(price) : "…"}</b>} bottom={sym} />
      <span className="pill-spark">
        <Spark values={closes} height={26} fill={false} trend={change} />
      </span>
      {price && <Change pct={change} />}
    </Pill>
  );
};

// ---------- system ----------

const CpuRamPill = () => {
  const { data } = useStats();
  const ram = data ? (data.memUsed / data.memTotal) * 100 : 0;
  return (
    <Pill onClick={() => api.shellAction("task-manager")} title="Open Task Manager">
      <Ring value={(data?.cpu ?? 0) / 100} size={36} stroke={4}>
        <span className="pill-tiny">{data ? Math.round(data.cpu) : "–"}</span>
      </Ring>
      <Ring value={ram / 100} size={36} stroke={4} color="#a78bfa">
        <span className="pill-tiny">{data ? Math.round(ram) : "–"}</span>
      </Ring>
      <Stack top="CPU" bottom="RAM" />
    </Pill>
  );
};

const CpuPill = () => {
  const { data } = useStats();
  return (
    <Pill onClick={() => api.shellAction("task-manager")}>
      <Ring value={(data?.cpu ?? 0) / 100} size={38} stroke={4}>
        <span className="pill-tiny">{data ? Math.round(data.cpu) : "–"}</span>
      </Ring>
      <span className="pill-sub">CPU</span>
    </Pill>
  );
};

const RamPill = () => {
  const { data } = useStats();
  const used = data ? data.memUsed / data.memTotal : 0;
  return (
    <Pill onClick={() => api.shellAction("task-manager")}>
      <Ring value={used} size={38} stroke={4} color="#a78bfa">
        <span className="pill-tiny">{data ? Math.round(used * 100) : "–"}</span>
      </Ring>
      <span className="pill-sub">RAM</span>
    </Pill>
  );
};

const NetworkPill = () => {
  const { data } = useSystemInfo();
  const { rx } = useNetworkHistory();
  return (
    <Pill>
      <Stack top={<span className="w-net-down">↓ {fmtBytes(data?.rxPerSec ?? 0)}/s</span>} bottom={<span className="w-net-up">↑ {fmtBytes(data?.txPerSec ?? 0)}/s</span>} />
      <span className="pill-spark">
        <Spark values={rx} height={26} fill={false} />
      </span>
    </Pill>
  );
};

const BatteryPill = () => {
  const { data } = useStats();
  if (data && data.battery === null) return <Pill><span className="pill-sub">No battery</span></Pill>;
  const level = data?.battery ?? 0;
  return (
    <Pill className={data?.charging ? "w-charging" : ""}>
      <Ring value={level / 100} size={36} stroke={4} color={data?.charging ? "#4ade80" : level <= 20 ? "#f87171" : "var(--accent)"}>
        <span className="pill-tiny">{level}</span>
      </Ring>
      <span className="pill-sub">{data?.charging ? "⚡" : "🔋"}</span>
    </Pill>
  );
};

const BatteryDotsPill = () => {
  const { data } = useStats();
  if (data && data.battery === null) return <Pill><span className="pill-sub">No battery</span></Pill>;
  const level = data?.battery ?? 0;
  return (
    <Pill>
      <div className="pill-dotgrid">
        {Array.from({ length: 24 }, (_, i) => (
          <span key={i} className={i < Math.round((level / 100) * 24) ? "on" : ""} />
        ))}
      </div>
      <Stack top={<b>{level}%</b>} bottom={data?.charging ? "Charging" : "Battery"} />
    </Pill>
  );
};

const ThemePill = () => {
  const { data: dark } = useShared("dark-mode", api.getDarkMode, 10_000);
  return (
    <Pill onClick={async () => setShared("dark-mode", await api.setDarkMode(!dark))} title="Switch light / dark">
      <span className="pill-icon">{dark ? "🌙" : "☀️"}</span>
    </Pill>
  );
};

const LanguagePill = () => {
  const { data } = useShared("input-language", api.inputLanguage, 2000);
  return (
    <Pill onClick={() => api.nextInputLanguage().catch(console.warn)} title={data?.name}>
      <b className="pill-lang">{data?.short ?? "–"}</b>
    </Pill>
  );
};

const action = (a: Parameters<typeof api.shellAction>[0], icon: string, title: string): FC<P> =>
  function ActionPill() {
    return (
      <Pill onClick={() => api.shellAction(a)} title={title}>
        <span className="pill-icon">{icon}</span>
      </Pill>
    );
  };

// ---------- media ----------

/** Playback position (the now-playing poll refreshes it every 1.5 s). */
const posOf = (np: { positionSecs: number; durationSecs: number } | null | undefined) =>
  np ? Math.min(np.positionSecs, np.durationSecs || np.positionSecs) : 0;

async function control(a: "toggle" | "next" | "previous") {
  try {
    await api.mediaControl(a);
    setShared("now-playing", await api.nowPlaying());
  } catch (e) {
    console.warn(e);
  }
}

const NowPlayingPill = ({ compact }: { compact?: boolean }) => {
  const { data: np } = useNowPlaying();
  const pos = posOf(np);
  if (!np) return <Pill><span className="pill-sub">♪ Nothing playing</span></Pill>;
  return (
    <Pill className="pill-media">
      {np.art ? <img className="pill-art" src={np.art} alt="" /> : <span className="pill-art pill-art-empty">♪</span>}
      <div className="pill-stack pill-track">
        <div className="pill-top w-ellipsis">{np.title}</div>
        <div className="pill-sub w-ellipsis">{np.artist}</div>
        {np.durationSecs > 0 && (
          <div className="pill-progress">
            <div style={{ width: `${(pos / np.durationSecs) * 100}%` }} />
          </div>
        )}
      </div>
      {!compact && <RoundBtn label="Previous" onClick={() => control("previous")}>⏮</RoundBtn>}
      <RoundBtn label={np.playing ? "Pause" : "Play"} onClick={() => control("toggle")} accent="#3b82f6">
        {np.playing ? "⏸" : "▶"}
      </RoundBtn>
      <RoundBtn label="Next" onClick={() => control("next")}>⏭</RoundBtn>
    </Pill>
  );
};

const NowPlayingMiniPill = () => {
  const { data: np } = useNowPlaying();
  return (
    <Pill onClick={() => control("toggle")} title={np ? `${np.title} — ${np.artist}` : "Nothing playing"}>
      <Ring value={np?.durationSecs ? np.positionSecs / np.durationSecs : 0} size={38} stroke={3}>
        <span className="pill-mini-play" style={np?.art ? { backgroundImage: `url(${np.art})` } : undefined}>
          {np?.playing ? "⏸" : "▶"}
        </span>
      </Ring>
    </Pill>
  );
};

const VolumePill = () => {
  const { data: vol } = useVolume();
  const [local, setLocal] = useState<number | null>(null);
  const level = local ?? (vol ? Math.round(vol.level * 100) : 0);
  const commit = async () => {
    if (local === null) return;
    setShared("volume", await api.setVolume(local / 100));
    setLocal(null);
  };
  return (
    <Pill className="pill-slider">
      <button className="pill-round" aria-label="Mute" onClick={async () => setShared("volume", await api.toggleMute())}>
        {vol?.muted || level === 0 ? "🔇" : "🔊"}
      </button>
      <div className="pill-stack">
        <div className="pill-row">
          <span className="pill-sub">Volume</span>
          <span className="pill-sub">{vol?.muted ? "Muted" : `${level}%`}</span>
        </div>
        <input
          type="range"
          className="w-range"
          aria-label="Volume"
          min={0}
          max={100}
          value={level}
          onChange={(e) => setLocal(Number(e.target.value))}
          onPointerUp={commit}
          onKeyUp={commit}
        />
      </div>
    </Pill>
  );
};

const MicPill = () => {
  const { data: mic } = useMicrophone();
  return (
    <Pill onClick={async () => setShared("microphone", await api.toggleMicrophone())} title={mic?.muted ? "Microphone muted" : "Microphone on"} className={mic?.muted ? "pill-alert" : ""}>
      <span className="pill-icon">{mic?.muted ? "🎙️" : "🎙️"}</span>
      <span className="pill-sub">{mic ? (mic.muted ? "Muted" : "On") : "No mic"}</span>
    </Pill>
  );
};

// ---------- apps & files ----------

const RecyclePill = () => {
  const { data } = useShared("recycle-bin", api.recycleBin, 5000);
  return (
    <Pill onClick={() => api.shellAction("recycle-bin")} title={data ? `${data.items} items, ${fmtBytes(data.bytes)}` : "Recycle Bin"}>
      <span className="pill-icon">🗑️</span>
      {data && data.items > 0 && <span className="pill-badge">{data.items > 99 ? "99+" : data.items}</span>}
    </Pill>
  );
};

const SearchPill = () => {
  const [q, setQ] = useState("");
  return (
    <Pill className="pill-search">
      <span className="pill-sub">›</span>
      <input
        className="pill-input"
        placeholder="search or C:\path"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        onKeyDown={(e) => e.key === "Enter" && api.searchOrOpen(q).then(() => setQ(""))}
      />
    </Pill>
  );
};

const LeetCodePill = ({ settings }: P) => {
  const user: string = (settings.username ?? "").trim();
  const { data } = useShared(user ? `leetcode:${user.toLowerCase()}` : null, () => api.leetcode(user), 30 * 60_000);
  const u = data?.data?.matchedUser;
  const solved = u?.submitStatsGlobal.acSubmissionNum.find((x) => x.difficulty === "All")?.count;
  return (
    <Pill title={user ? `LeetCode · ${user}` : "Set a username"}>
      <span className="pill-icon">🧩</span>
      <Stack top={<b>{solved ?? "–"}</b>} bottom={u ? `🔥 ${u.userCalendar?.streak ?? 0}d` : "LeetCode"} />
    </Pill>
  );
};

const PanelPill = () => (
  <Pill onClick={() => api.toggleWidgets()} title="Widgets">
    <span className="pill-icon">▦</span>
  </Pill>
);

/** Widget kind → dock pill. Widgets not listed here are panel-only. */
export const PILLS: Record<string, FC<P>> = {
  clock: ClockPill,
  "flip-clock": FlipPill,
  "segment-clock": SegmentPill,
  date: DatePill,
  "day-number": DatePill,
  "world-time": WorldTimePill,
  "clock-weather": ClockPill,
  "day-progress": DayProgressPill,
  pomodoro: PomodoroPill as FC<P>,
  timer: TimerPill,
  stopwatch: StopwatchPill,
  todos: TodosPill,
  currency: CurrencyPill,
  weather: WeatherPill,
  forecast: ForecastPill,
  "stock-chart": StockPill,
  crypto: CryptoPill,
  "cpu-ring": CpuPill,
  "ram-ring": RamPill,
  "top-cpu": CpuRamPill,
  network: NetworkPill,
  battery: BatteryPill,
  "battery-ring": BatteryPill,
  "battery-dots": BatteryDotsPill,
  "theme-toggle": ThemePill,
  language: LanguagePill,
  "show-desktop": action("show-desktop", "🖥️", "Show desktop"),
  notifications: action("notifications", "🔔", "Notifications"),
  keyboard: action("keyboard", "⌨️", "On-screen keyboard"),
  screenshot: action("screenshot", "✂️", "Screenshot"),
  "now-playing": () => <NowPlayingPill />,
  "now-playing-compact": () => <NowPlayingPill compact />,
  "now-playing-bar": () => <NowPlayingPill compact />,
  "now-playing-mini": NowPlayingMiniPill,
  "audio-output": VolumePill,
  microphone: MicPill,
  "recycle-bin": RecyclePill,
  search: SearchPill,
  leetcode: LeetCodePill,
};

export const PanelButtonPill = PanelPill;
export const PILL_KINDS = new Set(Object.keys(PILLS));
