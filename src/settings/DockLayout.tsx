// "Dock layout" settings: where the dock sits, how it looks, whether it
// replaces the Windows taskbar, and which apps/widgets it contains.
import { ReactNode, useState } from "react";
import { api, Config, DockEntry, DockSettings } from "../lib/api";
import { useWidgetConfig } from "../lib/widgetConfig";
import { PILL_KINDS } from "../widgets/pills";
import { widgetByKind } from "../widgets/registry";
import { Gallery } from "../widgets/Widgets";

type Update = (change: (c: Config) => Config) => void;

const newId = () => "d" + Math.random().toString(36).slice(2, 10);
const entry = (kind: string, settings: Record<string, unknown> = {}): DockEntry => ({ id: newId(), kind, settings });
const widget = (kind: string) => entry(`widget:${kind}`, { ...(widgetByKind.get(kind)?.defaults ?? {}) });

/** One-click starting points, like the setups in the showcase. */
const PRESETS: { name: string; hint: string; dock: Partial<DockSettings>; bar: boolean; items: () => DockEntry[] }[] = [
  {
    name: "Floating dock",
    hint: "Apps only, centered, macOS style",
    dock: { position: "bottom", style: "floating", hideTaskbar: false },
    bar: true,
    items: () => [{ id: "apps", kind: "apps", settings: {} }],
  },
  {
    name: "Taskbar replacement",
    hint: "Full width at the bottom with widgets; hides the Windows taskbar",
    dock: { position: "bottom", style: "full", reserveSpace: true, hideTaskbar: true },
    bar: false,
    items: () => [
      { id: "apps", kind: "apps", settings: {} },
      entry("spacer"),
      widget("now-playing"),
      widget("weather"),
      widget("top-cpu"),
      widget("audio-output"),
      widget("clock"),
      entry("panel"),
    ],
  },
  {
    name: "Widget dock",
    hint: "Floating, packed with widgets around your apps",
    dock: { position: "bottom", style: "floating", hideTaskbar: true },
    bar: false,
    items: () => [
      widget("pomodoro"),
      widget("forecast"),
      entry("separator"),
      { id: "apps", kind: "apps", settings: {} },
      entry("separator"),
      widget("now-playing"),
      widget("cpu-ring"),
      widget("ram-ring"),
      widget("flip-clock"),
    ],
  },
  {
    name: "Top strip",
    hint: "Everything along the top edge; hides the Windows taskbar",
    dock: { position: "top", style: "full", reserveSpace: true, hideTaskbar: true },
    bar: false,
    items: () => [
      widget("search"),
      widget("flip-clock"),
      { id: "apps", kind: "apps", settings: {} },
      entry("spacer"),
      widget("now-playing"),
      widget("network"),
      widget("battery-dots"),
      entry("panel"),
    ],
  },
];

function entryLabel(e: DockEntry) {
  switch (e.kind) {
    case "apps":
      return "📱 Apps (pinned and running)";
    case "separator":
      return "│ Separator";
    case "spacer":
      return "↔ Flexible space";
    case "panel":
      return "▦ Widgets button";
    default: {
      const def = widgetByKind.get(e.kind.slice(7));
      return def ? `🧩 ${def.name}` : e.kind;
    }
  }
}

function Choice<T extends string>({ value, options, onChange }: { value: T; options: [T, string][]; onChange: (v: T) => void }) {
  return (
    <div className="s-segmented" role="radiogroup">
      {options.map(([v, label]) => (
        <button key={v} role="radio" aria-checked={value === v} className={value === v ? "on" : ""} onClick={() => onChange(v)}>
          {label}
        </button>
      ))}
    </div>
  );
}

export function DockLayoutSection({ config, update, Row, Toggle }: {
  config: Config;
  update: Update;
  Row: (p: { label: string; hint?: string; children: ReactNode }) => JSX.Element;
  Toggle: (p: { checked: boolean; onChange: (v: boolean) => void; label: string }) => JSX.Element;
}) {
  const [shared, , updateShared] = useWidgetConfig();
  const [gallery, setGallery] = useState(false);
  const [configuring, setConfiguring] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const d = config.dock;

  const setDock = (patch: Partial<DockSettings>) => update((c) => ({ ...c, dock: { ...c.dock, ...patch } }));
  const setItems = (fn: (items: DockEntry[]) => DockEntry[]) => update((c) => ({ ...c, dock: { ...c.dock, items: fn(c.dock.items) } }));

  const setHideTaskbar = async (hide: boolean) => {
    setError(null);
    try {
      await api.setTaskbarHidden(hide);
      setDock({ hideTaskbar: hide });
    } catch (e) {
      setError(String(e));
    }
  };
  const setBar = (enabled: boolean) => {
    update((c) => ({ ...c, bar: { ...c.bar, enabled } }));
    api.setBarEnabled(enabled).catch((e) => setError(String(e)));
  };
  const applyPreset = (p: (typeof PRESETS)[number]) => {
    update((c) => ({ ...c, dock: { ...c.dock, ...p.dock, items: p.items() }, bar: { ...c.bar, enabled: p.bar } }));
    api.setBarEnabled(p.bar).catch(console.error);
    api.setTaskbarHidden(!!p.dock.hideTaskbar).catch((e) => setError(String(e)));
  };
  const move = (i: number, by: number) =>
    setItems((list) => {
      const j = i + by;
      if (j < 0 || j >= list.length) return list;
      const next = [...list];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });

  return (
    <>
      <section className="s-section">
        <h2>Dock layout</h2>
        <div className="s-card">
          <Row label="Presets" hint="Start from a ready-made setup, then adjust it below.">
            <span />
          </Row>
          <div className="s-presets">
            {PRESETS.map((p) => (
              <button key={p.name} className="s-preset" onClick={() => applyPreset(p)}>
                <b>{p.name}</b>
                <span className="s-hint">{p.hint}</span>
              </button>
            ))}
          </div>
          <Row label="Position">
            <Choice value={d.position} options={[["bottom", "Bottom"], ["top", "Top"]]} onChange={(position) => setDock({ position })} />
          </Row>
          <Row label="Style">
            <Choice value={d.style} options={[["floating", "Floating"], ["full", "Full width"]]} onChange={(style) => setDock({ style })} />
          </Row>
          <Row label="Reserve screen space" hint="Full width only: maximized windows stop at the dock, like the taskbar.">
            <Toggle label="Reserve screen space" checked={d.reserveSpace} onChange={(reserveSpace) => setDock({ reserveSpace })} />
          </Row>
          <Row label="Hide the Windows taskbar" hint="Harbor puts it back when you quit or turn this off.">
            <Toggle label="Hide the Windows taskbar" checked={d.hideTaskbar} onChange={setHideTaskbar} />
          </Row>
          <Row label="Show the top menu bar">
            <Toggle label="Show the top menu bar" checked={config.bar.enabled} onChange={setBar} />
          </Row>
          {error && <p className="s-error s-pad">{error}</p>}
        </div>
      </section>

      <section className="s-section">
        <h2>Dock items</h2>
        <div className="s-card">
          {gallery ? (
            <div className="s-pad s-gallery">
              <Gallery
                only={PILL_KINDS}
                onClose={() => setGallery(false)}
                onAdd={(def) => {
                  const e = widget(def.kind);
                  setItems((list) => [...list, e]);
                  setGallery(false);
                  if (def.Settings) setConfiguring(e.id);
                }}
              />
            </div>
          ) : (
            <>
              {d.items.map((e, i) => {
                const def = e.kind.startsWith("widget:") ? widgetByKind.get(e.kind.slice(7)) : undefined;
                const open = configuring === e.id && def?.Settings && shared;
                return (
                  <div key={e.id} className="s-dock-item">
                    <div className="s-row">
                      <span>{entryLabel(e)}</span>
                      <div className="s-app-actions">
                        <button className="s-btn" title="Move earlier" disabled={i === 0} onClick={() => move(i, -1)}>
                          ←
                        </button>
                        <button className="s-btn" title="Move later" disabled={i === d.items.length - 1} onClick={() => move(i, 1)}>
                          →
                        </button>
                        {def?.Settings && (
                          <button className="s-btn" onClick={() => setConfiguring(open ? null : e.id)}>
                            {open ? "Done" : "Configure"}
                          </button>
                        )}
                        <button className="s-btn s-danger" onClick={() => setItems((list) => list.filter((x) => x.id !== e.id))}>
                          Remove
                        </button>
                      </div>
                    </div>
                    {open && def?.Settings && shared && (
                      <div className="s-pad">
                        <def.Settings
                          id={e.id}
                          settings={{ ...def.defaults, ...e.settings }}
                          setSettings={(patch: Record<string, unknown>) =>
                            setItems((list) => list.map((x) => (x.id === e.id ? { ...x, settings: { ...def.defaults, ...x.settings, ...patch } } : x)))
                          }
                          shared={shared}
                          updateShared={updateShared}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
              <div className="s-row s-row-end s-wrap">
                {!d.items.some((e) => e.kind === "apps") && (
                  <button className="s-btn" onClick={() => setItems((l) => [...l, { id: "apps", kind: "apps", settings: {} }])}>
                    + Apps
                  </button>
                )}
                <button className="s-btn" onClick={() => setItems((l) => [...l, entry("separator")])}>
                  + Separator
                </button>
                <button className="s-btn" onClick={() => setItems((l) => [...l, entry("spacer")])}>
                  + Space
                </button>
                <button className="s-btn" onClick={() => setItems((l) => [...l, entry("panel")])}>
                  + Widgets button
                </button>
                <button className="s-btn s-primary" onClick={() => setGallery(true)}>
                  + Widget…
                </button>
              </div>
            </>
          )}
        </div>
      </section>
    </>
  );
}
