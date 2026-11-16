// The card that slides out of the dock when you click a widget pill: the full
// widget (or a group of related ones), its settings, or the widget picker.
import { FC, useEffect, useLayoutEffect, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import { api, CardOpen, DockEntry } from "../lib/api";
import { Backdrop } from "../lib/Backdrop";
import { useConfig } from "../lib/config";
import { useWidgetConfig } from "../lib/widgetConfig";
import { WidgetProps } from "../widgets/kit";
import * as Cal from "../widgets/calendar";
import * as Ctl from "../widgets/controls";
import * as Me from "../widgets/media";
import { PILL_KINDS } from "../widgets/pills";
import * as P from "../widgets/productivity";
import { widgetByKind, WidgetDef } from "../widgets/registry";
import * as S from "../widgets/system";
import * as T from "../widgets/time";
import * as W from "../widgets/weather";
import { Gallery } from "../widgets/Widgets";

type Part = { C: FC<WidgetProps<any>>; wide?: boolean }; // eslint-disable-line @typescript-eslint/no-explicit-any

/** Related widgets open one richer card, like the clock opening the calendar. */
const GROUPS: { title: string; kinds: string[]; parts: Part[] }[] = [
  {
    title: "Calendar",
    kinds: ["clock", "flip-clock", "segment-clock", "date", "day-number", "clock-weather", "world-time", "analog", "day-progress", "agenda", "next-event"],
    parts: [{ C: T.Clock, wide: true }, { C: Cal.Agenda, wide: true }, { C: P.Calendar, wide: true }],
  },
  {
    title: "Weather",
    kinds: ["weather", "forecast", "weather-details", "weather-status", "hourly", "sun", "week-strip", "today"],
    parts: [{ C: W.Weather }, { C: W.WeatherDetails }, { C: W.Hourly, wide: true }, { C: W.Forecast, wide: true }, { C: W.Sun, wide: true }],
  },
  {
    title: "Sound",
    kinds: ["audio-output", "microphone", "app-mixer"],
    parts: [{ C: Me.AudioOutput, wide: true }, { C: Ctl.AppMixer, wide: true }, { C: Me.Microphone, wide: true }, { C: Me.NowPlayingCompact, wide: true }],
  },
  {
    title: "Controls",
    kinds: ["quick-toggles", "brightness", "theme-toggle"],
    parts: [{ C: Ctl.QuickToggles, wide: true }, { C: Ctl.Brightness, wide: true }, { C: S.ThemeToggle }, { C: S.Language }],
  },
  { title: "Now playing", kinds: ["now-playing", "now-playing-compact", "now-playing-bar", "now-playing-mini"], parts: [{ C: Me.NowPlaying, wide: true }] },
  {
    title: "System",
    kinds: ["cpu-ring", "ram-ring", "top-cpu", "top-ram"],
    parts: [{ C: S.CpuRing }, { C: S.RamRing }, { C: S.TopCpu }, { C: S.TopRam }],
  },
  { title: "Network", kinds: ["network"], parts: [{ C: S.Network, wide: true }, { C: S.Storage, wide: true }] },
  {
    title: "Battery",
    kinds: ["battery", "battery-ring", "battery-dots", "battery-core", "battery-gauge"],
    parts: [{ C: S.BatteryRing }, { C: S.BatteryGauge }, { C: S.Battery, wide: true }],
  },
];

function useCardRequest() {
  const [req, setReq] = useState<(CardOpen & { n: number }) | null>(null);
  useEffect(() => {
    let n = 0;
    const off = listen<CardOpen>("card-open", (e) => setReq({ ...e.payload, n: ++n }));
    return () => {
      off.then((f) => f());
    };
  }, []);
  return req;
}

export function Card() {
  const req = useCardRequest();
  const [config, update] = useConfig();
  const [shared, , updateShared] = useWidgetConfig();
  const [configuring, setConfiguring] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => setConfiguring(false), [req?.n]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && api.closeCard();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Tell the backend our size so it can place the card over its pill and show it.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !req) return;
    let last = "";
    const report = () => {
      const r = el.getBoundingClientRect();
      const key = `${Math.ceil(r.width)}x${Math.ceil(r.height)}`;
      if (key === last) return;
      last = key;
      api.placeCard(Math.ceil(r.width), Math.ceil(r.height)).catch(console.error);
    };
    report();
    const ro = new ResizeObserver(report);
    ro.observe(el);
    return () => ro.disconnect();
  }, [req?.n, !!config, !!shared]);

  if (!req || !config || !shared) return null;

  const entry: DockEntry | undefined = config.dock.items.find((e) => e.id === req.entryId);
  const setEntrySettings = (patch: Record<string, unknown>) =>
    update((c) => ({
      ...c,
      dock: { ...c.dock, items: c.dock.items.map((e) => (e.id === req.entryId ? { ...e, settings: { ...e.settings, ...patch } } : e)) },
    }));

  let title: string;
  let body: JSX.Element;
  let def: WidgetDef | undefined;

  if (req.kind === "picker") {
    title = "Add to dock";
    body = (
      <div className="card-picker">
        <Gallery
          only={PILL_KINDS}
          onClose={() => api.closeCard()}
          onAdd={(d) => {
            const id = "d" + Math.random().toString(36).slice(2, 10);
            update((c) => ({ ...c, dock: { ...c.dock, items: [...c.dock.items, { id, kind: `widget:${d.kind}`, settings: { ...d.defaults } }] } }));
          }}
        />
      </div>
    );
  } else {
    def = widgetByKind.get(req.kind);
    const settings = { ...(def?.defaults ?? {}), ...(entry?.settings ?? {}) };
    const props = { id: req.entryId, settings, setSettings: setEntrySettings, shared, updateShared };
    const group = GROUPS.find((g) => g.kinds.includes(req.kind));
    title = group?.title ?? def?.name ?? "Widget";
    if (configuring && def?.Settings) {
      body = (
        <div className="w-tile">
          <def.Settings {...props} />
        </div>
      );
    } else if (group) {
      body = (
        <div className="w-grid">
          {group.parts.map(({ C, wide }, i) => (
            <div key={i} className={`w-cell w-${wide ? "wide" : "small"}`}>
              <C {...props} />
            </div>
          ))}
        </div>
      );
    } else if (def) {
      body = <def.Component {...props} />;
    } else {
      body = <p className="w-muted">This widget isn't available.</p>;
    }
  }

  return (
    <div key={req.n} ref={ref} className={`card has-backdrop ${req.up ? "card-up" : "card-down"} ${req.kind === "picker" ? "card-wide" : ""}`}>
      <Backdrop />
      <header className="card-head">
        <b>{title}</b>
        <div className="w-row w-gap">
          {def?.Settings && entry && (
            <button className={"w-x" + (configuring ? " on" : "")} title="Settings" onClick={() => setConfiguring(!configuring)}>
              ⚙
            </button>
          )}
          <button className="w-x" title="Close" onClick={() => api.closeCard()}>
            ✕
          </button>
        </div>
      </header>
      <div className="card-body">{body}</div>
    </div>
  );
}
