// The notch: a black island pinned to the top centre of the screen. Closed, it
// shows what's playing (or the time) and the weather or next prayer. Hover to
// open it: media controls, today's prayer times and the clipboard history.
// It also opens briefly by itself when the track changes or a prayer is due.
//
// The window is sized to the island. Growing resizes the window first and
// lets CSS animate the island into it; shrinking animates first and resizes
// the window afterwards, so the animation is never clipped.
import { CSSProperties, useEffect, useLayoutEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { openWeatherCard } from "../bar/Bar";
import { api, ClipItem, CLIPBOARD_EVENT, NotchSettings, weatherLook, WidgetConfig } from "../lib/api";
import { useConfig } from "../lib/config";
import { useWidgetConfig } from "../lib/widgetConfig";
import { useNowPlaying, usePrayer, useWeather } from "../widgets/data";
import { fmtDuration, setShared, timeString, useNow } from "../widgets/kit";
import { countdown, hhmm, nextPrayer, PrayerList } from "../widgets/prayer";

const OPEN_W = 440;
/** Matches the CSS transition, plus a little slack. */
const SHRINK_MS = 340;

export function Notch() {
  const [config] = useConfig();
  const [shared] = useWidgetConfig();
  if (!config || !shared) return null;
  if (!config.notch.enabled) return <Hidden />;
  return <Island notch={config.notch} shared={shared} h24={config.bar.clock24h} />;
}

function Hidden() {
  useEffect(() => {
    getCurrentWindow().hide().catch(console.error);
  }, []);
  return null;
}

async function control(action: "toggle" | "next" | "previous") {
  try {
    await api.mediaControl(action);
    setShared("now-playing", await api.nowPlaying());
  } catch (e) {
    console.warn(e);
  }
}

/** Keeps the window the size of the island (see the comment at the top). */
function useWindowSize(size: { w: number; h: number }) {
  const win = useRef({ w: 0, h: 0 });
  const timer = useRef<number>();
  useEffect(() => {
    window.clearTimeout(timer.current);
    const apply = (s: { w: number; h: number }) => {
      win.current = s;
      api.placeNotch(s.w, s.h).catch(console.error);
    };
    const grown = { w: Math.max(win.current.w, size.w), h: Math.max(win.current.h, size.h) };
    if (grown.w !== win.current.w || grown.h !== win.current.h) apply(grown);
    if (grown.w !== size.w || grown.h !== size.h) timer.current = window.setTimeout(() => apply(size), SHRINK_MS);
  }, [size.w, size.h]);
}

function Island({ notch, shared, h24 }: { notch: NotchSettings; shared: WidgetConfig; h24: boolean }) {
  const now = useNow(1000);
  const { data: np } = useNowPlaying();
  const { data: wx } = useWeather(shared);
  const { data: prayers } = usePrayer(notch.prayer ? shared : { ...shared, location: null });
  const next = prayers ? nextPrayer(prayers, now.getTime()) : null;

  const [hover, setHover] = useState(false);
  const [peek, setPeek] = useState<string | null>(null); // why it opened by itself
  const [tab, setTab] = useState<"now" | "clipboard">("now");
  const open = hover || peek !== null;

  // ---------- opening by itself ----------
  const peekTimer = useRef<number>();
  const flash = (why: string, ms: number) => {
    setPeek(why);
    window.clearTimeout(peekTimer.current);
    peekTimer.current = window.setTimeout(() => setPeek(null), ms);
  };

  const track = np === undefined ? undefined : np ? `${np.title}\n${np.artist}` : "";
  const seenTrack = useRef<string>();
  useEffect(() => {
    if (track === undefined) return;
    if (seenTrack.current !== undefined && track && track !== seenTrack.current) flash("track", 4000);
    seenTrack.current = track;
  }, [track]); // eslint-disable-line react-hooks/exhaustive-deps

  const lastNext = useRef<{ name: string; at: number }>();
  useEffect(() => {
    const prev = lastNext.current;
    if (prev && next && prev.at !== next.at && now.getTime() >= prev.at) {
      setTab("now");
      flash(`It's time for ${prev.name}`, 12_000);
    }
    lastNext.current = next ?? undefined;
  }, [next?.at]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- hover, with a short grace period so passing the edge doesn't flicker ----------
  const leaveTimer = useRef<number>();
  const enter = () => {
    window.clearTimeout(leaveTimer.current);
    setHover(true);
  };
  const leave = () => {
    leaveTimer.current = window.setTimeout(() => {
      setHover(false);
      setTab("now");
    }, 220);
  };

  // ---------- size ----------
  const inner = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 200, h: 32 });
  useLayoutEffect(() => {
    const el = inner.current;
    if (!el) return;
    const measure = () => setSize({ w: Math.ceil(el.offsetWidth), h: Math.ceil(el.offsetHeight) });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  useWindowSize(size);

  // ---------- closed ----------
  const right =
    notch.prayer && next ? (
      <span className="n-chip" title={`${next.name} at ${hhmm(next.at)}`}>
        🕌 {next.name} <span className="n-dim">{countdown(next.at - now.getTime())}</span>
      </span>
    ) : wx ? (
      <span className="n-chip">
        {weatherLook(wx.current.weather_code, wx.current.is_day === 1)[0]} {Math.round(wx.current.temperature_2m)}°
      </span>
    ) : (
      <span className="n-chip n-dim">{now.toLocaleDateString(undefined, { weekday: "short", day: "numeric" })}</span>
    );
  const closed = (
    <div className="n-closed">
      {np ? (
        <>
          <Art src={np.art} size={20} />
          <span className="n-track">{np.title}</span>
          {np.playing && <Bars />}
        </>
      ) : (
        <span className="n-time">{timeString(now, { h24 })}</span>
      )}
      <span className="n-spacer" />
      {right}
    </div>
  );

  // ---------- open ----------
  const opened = (
    <div className="n-open" style={{ width: OPEN_W }}>
      <header className="n-head">
        <div>
          <div className="n-big">{timeString(now, { h24 })}</div>
          <div className="n-dim">{now.toLocaleDateString(undefined, { weekday: "long", day: "numeric", month: "long" })}</div>
        </div>
        <div className="n-head-right">
          {wx && shared.location && (
            <button
              className="n-weather"
              title={`${shared.location.name}: forecast and details`}
              onClick={(e) => openWeatherCard(e.currentTarget, "notch-weather")}
            >
              <span className="n-weather-icon">{weatherLook(wx.current.weather_code, wx.current.is_day === 1)[0]}</span>
              <div>
                <b>{Math.round(wx.current.temperature_2m)}°</b>
                <div className="n-dim n-ellipsis">{shared.location.name}</div>
              </div>
            </button>
          )}
          <div className="n-tabs" role="tablist">
            <button role="tab" aria-selected={tab === "now"} className={tab === "now" ? "on" : ""} onClick={() => setTab("now")}>
              Now
            </button>
            <button role="tab" aria-selected={tab === "clipboard"} className={tab === "clipboard" ? "on" : ""} onClick={() => setTab("clipboard")}>
              Clipboard
            </button>
          </div>
        </div>
      </header>

      {peek && peek !== "track" && <div className="n-alert">🕌 {peek}</div>}

      {tab === "now" ? (
        <>
          {np ? <Media /> : <p className="n-dim n-empty">Nothing playing</p>}
          {notch.prayer && prayers && (
            <section className="n-section">
              <div className="n-row">
                <b>Prayer times</b>
                {next && (
                  <span className="n-dim">
                    {next.name} in {countdown(next.at - now.getTime())}
                  </span>
                )}
              </div>
              <PrayerList day={prayers} now={now.getTime()} />
            </section>
          )}
        </>
      ) : (
        <Clipboard on={notch.clipboard} />
      )}
    </div>
  );

  return (
    <div className="n-stage">
      <div
        className={"notch" + (open ? " open" : "")}
        style={{ width: size.w, height: size.h } as CSSProperties}
        onMouseEnter={enter}
        onMouseLeave={leave}
      >
        <div ref={inner} className="n-inner">
          {open ? opened : closed}
        </div>
      </div>
    </div>
  );
}

const Art = ({ src, size }: { src: string | null; size: number }) =>
  src ? (
    <img className="n-art" src={src} alt="" style={{ width: size, height: size }} />
  ) : (
    <span className="n-art n-art-empty" style={{ width: size, height: size }}>
      ♪
    </span>
  );

/** Animated equalizer bars while music plays. */
const Bars = () => (
  <span className="n-bars" aria-hidden>
    <i />
    <i />
    <i />
    <i />
  </span>
);

function Media() {
  const { data: np } = useNowPlaying();
  if (!np) return null;
  const pos = Math.min(np.positionSecs, np.durationSecs || np.positionSecs);
  return (
    <section className="n-media">
      <Art src={np.art} size={64} />
      <div className="n-media-body">
        <div className="n-ellipsis n-title">{np.title}</div>
        <div className="n-ellipsis n-dim">{np.artist || np.app}</div>
        {np.durationSecs > 0 && (
          <div className="n-progress-row">
            <span>{fmtDuration(pos)}</span>
            <div className="n-progress">
              <div style={{ width: `${(pos / np.durationSecs) * 100}%` }} />
            </div>
            <span>{fmtDuration(np.durationSecs)}</span>
          </div>
        )}
      </div>
      <div className="n-controls">
        <button aria-label="Previous" onClick={() => control("previous")}>
          ⏮
        </button>
        <button aria-label={np.playing ? "Pause" : "Play"} className="n-play" onClick={() => control("toggle")}>
          {np.playing ? "⏸" : "▶"}
        </button>
        <button aria-label="Next" onClick={() => control("next")}>
          ⏭
        </button>
      </div>
    </section>
  );
}

function useClipboardHistory() {
  const [items, setItems] = useState<ClipItem[]>([]);
  useEffect(() => {
    const load = () => api.clipboardHistory().then(setItems, console.error);
    load();
    const off = listen(CLIPBOARD_EVENT, load);
    return () => {
      off.then((f) => f());
    };
  }, []);
  return items;
}

function Clipboard({ on }: { on: boolean }) {
  const items = useClipboardHistory();
  const [copied, setCopied] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  const fail = (e: unknown) => setError(String(e));

  if (!on && items.length === 0) return <p className="n-dim n-empty">Clipboard history is off. Turn it on in Settings → Notch.</p>;
  if (items.length === 0) return <p className="n-dim n-empty">Copy some text or an image and it shows up here.</p>;

  const copy = (id: number) =>
    api.clipboardCopy(id).then(() => {
      setError(null);
      setCopied(id);
      window.setTimeout(() => setCopied((c) => (c === id ? null : c)), 1200);
    }, fail);

  return (
    <section className="n-clips">
      <div className="n-clip-list">
        {items.map((it) => (
          <div key={it.id} className={"n-clip" + (it.pinned ? " pinned" : "")}>
            <button className="n-clip-main" title="Copy again" onClick={() => copy(it.id)}>
              {it.kind === "image" && it.thumb ? (
                <>
                  <img src={it.thumb} alt="Copied image" />
                  <span className="n-dim">
                    {it.width}×{it.height}
                  </span>
                </>
              ) : (
                <span className="n-clip-text">{it.text}</span>
              )}
            </button>
            {copied === it.id ? (
              <span className="n-copied">Copied</span>
            ) : (
              <>
                <button
                  className={"n-icon" + (it.pinned ? " on" : "")}
                  aria-label={it.pinned ? "Unpin" : "Pin"}
                  title={it.pinned ? "Unpin" : "Pin (kept after restart)"}
                  onClick={() => api.clipboardPin(it.id, !it.pinned).catch(fail)}
                >
                  📌
                </button>
                <button className="n-icon" aria-label="Remove" title="Remove" onClick={() => api.clipboardDelete(it.id).catch(fail)}>
                  ✕
                </button>
              </>
            )}
          </div>
        ))}
      </div>
      <div className="n-row">
        {error ? <span className="n-error">{error}</span> : <span className="n-dim">Click an item to copy it again.</span>}
        <button className="n-link" onClick={() => api.clipboardClear().catch(fail)}>
          Clear unpinned
        </button>
      </div>
    </section>
  );
}
