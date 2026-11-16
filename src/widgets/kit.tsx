// Shared building blocks for widgets: data hooks that de-duplicate polling,
// formatting helpers and small visual primitives (ring, sparkline, analog face).
import { ReactNode, useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { WidgetConfig } from "../lib/api";

// ---------- shared polling ----------

interface Entry {
  fetcher?: () => Promise<unknown>;
  data?: unknown;
  error?: string;
  listeners: Set<() => void>;
  timer?: ReturnType<typeof setInterval>;
  snapshot: { data?: unknown; error?: string };
}
const store = new Map<string, Entry>();

function entry(key: string): Entry {
  let e = store.get(key);
  if (!e) {
    e = { listeners: new Set(), snapshot: {} };
    store.set(key, e);
  }
  return e;
}

function publish(e: Entry, patch: { data?: unknown; error?: string }) {
  e.data = "data" in patch ? patch.data : e.data;
  e.error = patch.error;
  e.snapshot = { data: e.data, error: e.error };
  e.listeners.forEach((l) => l());
}

/**
 * Polls `fetcher` every `ms` while at least one widget uses `key`. Several
 * widgets showing the same data (say, four weather tiles) share one request.
 * Pass `key = null` to disable (e.g. until a city is chosen).
 */
export function useShared<T>(key: string | null, fetcher: () => Promise<T>, ms: number): { data?: T; error?: string } {
  // Always call the newest fetcher (it may close over fresh settings).
  if (key) entry(key).fetcher = fetcher;
  // Stable per key: a new subscribe function would re-subscribe (and refetch) on every render.
  const subscribe = useCallback(
    (notify: () => void) => {
      if (!key) return () => {};
      const e = entry(key);
      e.listeners.add(notify);
      if (!e.timer) {
        let busy = false;
        const tick = async () => {
          if (busy) return;
          busy = true;
          try {
            publish(e, { data: await e.fetcher!() });
          } catch (err) {
            publish(e, { error: String(err) });
          } finally {
            busy = false;
          }
        };
        tick();
        e.timer = setInterval(tick, ms);
      }
      return () => {
        e.listeners.delete(notify);
        if (e.listeners.size === 0 && e.timer) {
          clearInterval(e.timer);
          e.timer = undefined;
        }
      };
    },
    [key, ms],
  );
  const snap = useSyncExternalStore(subscribe, () => (key ? entry(key).snapshot : EMPTY));
  return snap as { data?: T; error?: string };
}
const EMPTY = {};

/** Forces a refetch for a key (after a user action changes the data). */
export function setShared<T>(key: string, data: T) {
  publish(entry(key), { data });
}

/** Re-renders every `ms` with the current time. */
export function useNow(ms = 1000) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

// ---------- props every widget receives ----------

export interface WidgetProps<S> {
  id: string;
  settings: S;
  setSettings: (patch: Partial<S>) => void;
  shared: WidgetConfig;
  updateShared: (patch: Partial<WidgetConfig>) => void;
}

// ---------- formatting ----------

export const fmtBytes = (n: number) => {
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024;
    i++;
  }
  return `${n.toFixed(n >= 100 || i === 0 ? 0 : 1)} ${units[i]}`;
};

export const fmtPrice = (n: number) =>
  n.toLocaleString(undefined, { maximumFractionDigits: n >= 100 ? 2 : n >= 1 ? 3 : 6 });

export const fmtDuration = (secs: number) => {
  const s = Math.max(0, Math.round(secs));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const mm = String(m).padStart(h ? 2 : 1, "0");
  return h ? `${h}:${mm}:${String(r).padStart(2, "0")}` : `${mm}:${String(r).padStart(2, "0")}`;
};

export const pct = (n: number) => `${Math.round(n)}%`;

/** Time parts in a given IANA zone (or local when undefined). */
export function zonedParts(date: Date, timeZone?: string) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    hourCycle: "h23",
  }).formatToParts(date);
  const get = (t: string) => Number(parts.find((p) => p.type === t)?.value ?? 0);
  return { h: get("hour"), m: get("minute"), s: get("second") };
}

export const timeString = (d: Date, opts: { seconds?: boolean; h24?: boolean; timeZone?: string } = {}) =>
  d.toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
    second: opts.seconds ? "2-digit" : undefined,
    hour12: !opts.h24,
    timeZone: opts.timeZone,
  });

/** "Tokyo" from "Asia/Tokyo". */
export const zoneCity = (zone: string) => zone.split("/").pop()!.replace(/_/g, " ");

export const allTimeZones = (): string[] => {
  try {
    return (Intl as unknown as { supportedValuesOf(k: string): string[] }).supportedValuesOf("timeZone");
  } catch {
    return ["UTC", "Europe/London", "America/New_York", "Asia/Tokyo"];
  }
};

// ---------- primitives ----------

export function Tile({ title, children, onClick, className = "" }: {
  title?: ReactNode;
  children: ReactNode;
  onClick?: () => void;
  className?: string;
}) {
  return (
    <div className={"w-tile " + className + (onClick ? " w-clickable" : "")} onClick={onClick}>
      {title && <div className="w-tile-title">{title}</div>}
      {children}
    </div>
  );
}

export function Ring({ value, size = 76, stroke = 8, color = "var(--accent)", children }: {
  value: number; // 0..1
  size?: number;
  stroke?: number;
  color?: string;
  children?: ReactNode;
}) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const v = Math.min(1, Math.max(0, value));
  return (
    <div className="w-ring" style={{ width: size, height: size }}>
      <svg width={size} height={size}>
        <circle cx={size / 2} cy={size / 2} r={r} style={{ stroke: "rgba(var(--ink), .12)" }} strokeWidth={stroke} fill="none" />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          stroke={color}
          strokeWidth={stroke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${c * v} ${c}`}
          transform={`rotate(-90 ${size / 2} ${size / 2})`}
          style={{ transition: "stroke-dasharray 400ms ease" }}
        />
      </svg>
      <div className="w-ring-label">{children}</div>
    </div>
  );
}

export function Spark({ values, height = 36, fill = true, trend }: {
  values: number[];
  height?: number;
  fill?: boolean;
  /** Colour by this change instead of first-vs-last point (e.g. vs previous close). */
  trend?: number;
}) {
  if (values.length < 2) return <svg className="w-spark-big" style={{ height }} />;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const pts = values.map((v, i) => [(i / (values.length - 1)) * 100, 2 + (1 - (v - min) / span) * 96]);
  const line = pts.map(([x, y]) => `${x},${y}`).join(" ");
  const up = trend !== undefined ? trend >= 0 : values[values.length - 1] >= values[0];
  return (
    <svg className={"w-spark-big " + (up ? "up" : "down")} viewBox="0 0 100 100" preserveAspectRatio="none" style={{ height }}>
      {fill && <polygon points={`0,100 ${line} 100,100`} className="w-spark-fill" />}
      <polyline points={line} fill="none" vectorEffect="non-scaling-stroke" strokeWidth="1.6" />
    </svg>
  );
}

export function Change({ pct }: { pct: number }) {
  const cls = pct > 0 ? "up" : pct < 0 ? "down" : "";
  return (
    <span className={"w-change " + cls}>
      {pct > 0 ? "+" : ""}
      {pct.toFixed(2)}%
    </span>
  );
}

export function AnalogFace({ date, timeZone, size = 96, seconds = true }: {
  date: Date;
  timeZone?: string;
  size?: number;
  seconds?: boolean;
}) {
  const { h, m, s } = zonedParts(date, timeZone);
  const hand = (deg: number, len: number, width: number, cls: string) => (
    <line
      x1="50"
      y1="50"
      x2={50 + len * Math.sin((deg * Math.PI) / 180)}
      y2={50 - len * Math.cos((deg * Math.PI) / 180)}
      strokeWidth={width}
      strokeLinecap="round"
      className={cls}
    />
  );
  return (
    <svg className="w-analog" width={size} height={size} viewBox="0 0 100 100">
      <circle cx="50" cy="50" r="47" className="w-analog-face" />
      {Array.from({ length: 12 }, (_, i) => {
        const a = (i * 30 * Math.PI) / 180;
        return (
          <line
            key={i}
            x1={50 + 40 * Math.sin(a)}
            y1={50 - 40 * Math.cos(a)}
            x2={50 + 44 * Math.sin(a)}
            y2={50 - 44 * Math.cos(a)}
            strokeWidth={i % 3 === 0 ? 2.4 : 1.2}
            className="w-analog-tick"
          />
        );
      })}
      {hand((h % 12) * 30 + m * 0.5, 24, 4, "w-analog-hand")}
      {hand(m * 6 + s * 0.1, 34, 2.6, "w-analog-hand")}
      {seconds && hand(s * 6, 38, 1.2, "w-analog-sec")}
      <circle cx="50" cy="50" r="2.6" className="w-analog-sec-dot" />
    </svg>
  );
}

/** A short beep through Web Audio, for timers (no audio files to ship). */
export function beep(times = 3) {
  try {
    const ctx = new AudioContext();
    for (let i = 0; i < times; i++) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.frequency.value = 880;
      gain.gain.setValueAtTime(0.0001, ctx.currentTime + i * 0.35);
      gain.gain.exponentialRampToValueAtTime(0.25, ctx.currentTime + i * 0.35 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + i * 0.35 + 0.25);
      osc.connect(gain).connect(ctx.destination);
      osc.start(ctx.currentTime + i * 0.35);
      osc.stop(ctx.currentTime + i * 0.35 + 0.3);
    }
    setTimeout(() => ctx.close(), times * 400 + 200);
  } catch {
    // Audio unavailable; the notification still shows.
  }
}

/** System notification when a timer or Pomodoro phase finishes. */
export async function notify(title: string, body: string) {
  beep();
  try {
    const n = await import("@tauri-apps/plugin-notification");
    let granted = await n.isPermissionGranted();
    if (!granted) granted = (await n.requestPermission()) === "granted";
    if (granted) n.sendNotification({ title, body });
  } catch (e) {
    console.warn(e);
  }
}
