import { ReactNode, useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { AppearanceStyle, BarSettings, Config, DockSettings, exeName, NotchSettings, PinnedApp, samePath } from "../lib/api";
import { iconKey, useConfig, useIcons } from "../lib/config";
import { pickApp, pickIcon } from "../lib/pickIcon";
import { DockLayoutSection } from "./DockLayout";
import { AutomationsSection, CalendarsSection } from "./Smart";
import { useUpdater } from "../lib/updates";
import { useWidgetConfig } from "../lib/widgetConfig";
import { METHODS } from "../widgets/prayer";
import { fmtBytes } from "../widgets/kit";

type Update = (change: (c: Config) => Config) => void;

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="s-section">
      <h2>{title}</h2>
      <div className="s-card">{children}</div>
    </section>
  );
}

function Row({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) {
  return (
    <div className="s-row">
      <div>
        <div className="s-label">{label}</div>
        {hint && <div className="s-hint">{hint}</div>}
      </div>
      <div className="s-control">{children}</div>
    </div>
  );
}

function Toggle({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: string }) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={label}
      className={"s-switch" + (checked ? " on" : "")}
      onClick={() => onChange(!checked)}
    >
      <span />
    </button>
  );
}

function Slider(props: {
  value: number;
  min: number;
  max: number;
  step: number;
  disabled?: boolean;
  format: (v: number) => string;
  onChange: (v: number) => void;
  label: string;
}) {
  // Local value while dragging; the config is saved once on release.
  const [v, setV] = useState(props.value);
  useEffect(() => setV(props.value), [props.value]);
  const commit = () => v !== props.value && props.onChange(v);
  return (
    <div className="s-slider">
      <input
        type="range"
        aria-label={props.label}
        min={props.min}
        max={props.max}
        step={props.step}
        value={v}
        disabled={props.disabled}
        onChange={(e) => setV(Number(e.target.value))}
        onPointerUp={commit}
        onKeyUp={commit}
        onBlur={commit}
      />
      <span className="s-value">{props.format(v)}</span>
    </div>
  );
}

// ---------- sections ----------

function DockSection({ dock, update }: { dock: DockSettings; update: Update }) {
  const set = (patch: Partial<DockSettings>) => update((c) => ({ ...c, dock: { ...c.dock, ...patch } }));
  return (
    <Section title="Dock icons">
      <Row label="Icon size">
        <Slider
          label="Icon size"
          value={dock.iconSize}
          min={32}
          max={96}
          step={4}
          format={(v) => `${v}px`}
          onChange={(iconSize) => set({ iconSize })}
        />
      </Row>
      <Row label="Magnify on hover">
        <Toggle label="Magnify on hover" checked={dock.magnify} onChange={(magnify) => set({ magnify })} />
      </Row>
      <Row label="Magnification">
        <Slider
          label="Magnification"
          value={dock.magnifyScale}
          min={1.1}
          max={2}
          step={0.1}
          disabled={!dock.magnify}
          format={(v) => `${v.toFixed(1)}×`}
          onChange={(magnifyScale) => set({ magnifyScale })}
        />
      </Row>
      <Row label="Show running apps" hint="Apps that aren't pinned appear after your pinned ones.">
        <Toggle
          label="Show running apps"
          checked={dock.showRunning}
          onChange={(showRunning) => set({ showRunning })}
        />
      </Row>
      <Row label="Win+1 … Win+9 open dock apps" hint="By position, like the taskbar. Win+Shift/Ctrl/Alt combinations keep their Windows meaning.">
        <Toggle label="Win+1 … Win+9 open dock apps" checked={dock.winNumberKeys} onChange={(winNumberKeys) => set({ winNumberKeys })} />
      </Row>
    </Section>
  );
}

function PinnedSection({ config, update }: { config: Config; update: Update }) {
  const iconFor = useIcons(config.pinned.map((p) => [p.path]));
  const [error, setError] = useState<string | null>(null);

  const setPinned = (fn: (list: PinnedApp[]) => PinnedApp[]) => update((c) => ({ ...c, pinned: fn(c.pinned) }));
  const move = (i: number, by: number) =>
    setPinned((list) => {
      const next = [...list];
      const j = i + by;
      if (j < 0 || j >= next.length) return list;
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  const rename = (i: number, name: string) =>
    setPinned((list) => list.map((p, k) => (k === i ? { ...p, name: name.trim() || exeName(p.path) } : p)));
  const remove = (i: number) => setPinned((list) => list.filter((_, k) => k !== i));
  const setGroup = (i: number, group: string) =>
    setPinned((list) => list.map((p, k) => (k === i ? { ...p, group: group.trim() || undefined } : p)));
  const groups = [...new Set(config.pinned.map((p) => p.group).filter((g): g is string => !!g))];

  const changeIcon = async (p: PinnedApp) => {
    setError(null);
    const url = await pickIcon();
    if (url) update((c) => ({ ...c, iconOverrides: { ...c.iconOverrides, [iconKey(p.path)]: url } }));
  };
  const resetIcon = (p: PinnedApp) =>
    update((c) => {
      const { [iconKey(p.path)]: _removed, ...rest } = c.iconOverrides;
      return { ...c, iconOverrides: rest };
    });

  const add = async () => {
    setError(null);
    const path = await pickApp();
    if (!path) return;
    if (config.pinned.some((p) => samePath(p.path, path))) {
      setError(`${exeName(path)} is already pinned.`);
      return;
    }
    setPinned((list) => [...list, { name: exeName(path), path }]);
  };

  return (
    <Section title="Pinned apps">
      {config.pinned.length === 0 && <p className="s-hint s-pad">Nothing pinned yet.</p>}
      {config.pinned.map((p, i) => {
        const override = config.iconOverrides[iconKey(p.path)];
        const icon = override ?? iconFor([p.path]);
        return (
          <div key={p.path} className="s-app">
            {icon ? (
              <img className="s-app-icon" src={icon} alt="" />
            ) : (
              <span className="s-app-icon s-app-fallback">{p.name.slice(0, 1).toUpperCase()}</span>
            )}
            <div className="s-app-main">
              <input
                className="s-input"
                aria-label={`Name for ${p.name}`}
                defaultValue={p.name}
                onBlur={(e) => e.target.value !== p.name && rename(i, e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
              />
              <div className="s-path" title={p.path}>
                {p.path}
              </div>
              <input
                key={p.group ?? ""}
                className="s-input s-group"
                list="pinned-groups"
                placeholder="No group"
                aria-label={`Group for ${p.name}`}
                title="Apps with the same group share one folder on the dock"
                defaultValue={p.group ?? ""}
                onBlur={(e) => e.target.value.trim() !== (p.group ?? "") && setGroup(i, e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && (e.target as HTMLInputElement).blur()}
              />
            </div>
            <div className="s-app-actions">
              <button className="s-btn" title="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
                ↑
              </button>
              <button
                className="s-btn"
                title="Move down"
                disabled={i === config.pinned.length - 1}
                onClick={() => move(i, 1)}
              >
                ↓
              </button>
              <button className="s-btn" onClick={() => changeIcon(p)}>
                Icon…
              </button>
              {override && (
                <button className="s-btn" onClick={() => resetIcon(p)}>
                  Reset
                </button>
              )}
              <button className="s-btn s-danger" onClick={() => remove(i)}>
                Remove
              </button>
            </div>
          </div>
        );
      })}
      <datalist id="pinned-groups">
        {groups.map((g) => (
          <option key={g} value={g} />
        ))}
      </datalist>
      <div className="s-row s-row-end">
        {error && <span className="s-error">{error}</span>}
        <button className="s-btn s-primary" onClick={add}>
          Add app…
        </button>
      </div>
      <p className="s-hint s-pad">
        You can also drop .exe or .lnk files onto the dock, or right-click a running app and choose Pin. Give apps
        the same group name to put them in one folder on the dock.
      </p>
    </Section>
  );
}

const BAR_TOGGLES: [keyof BarSettings, string][] = [
  ["showCpu", "CPU usage"],
  ["showRam", "Memory"],
  ["showBattery", "Battery"],
  ["showVolume", "Volume"],
  ["showWeather", "Weather"],
  ["showSeconds", "Seconds in clock"],
  ["clock24h", "24-hour clock"],
];

function BarSection({ bar, update }: { bar: BarSettings; update: Update }) {
  return (
    <Section title="Menu bar">
      {BAR_TOGGLES.map(([key, label]) => (
        <Row key={key} label={label}>
          <Toggle
            label={label}
            checked={bar[key]}
            onChange={(v) => update((c) => ({ ...c, bar: { ...c.bar, [key]: v } }))}
          />
        </Row>
      ))}
    </Section>
  );
}

function NotchSection({ notch, update }: { notch: NotchSettings; update: Update }) {
  const [shared, , updateShared] = useWidgetConfig();
  const set = (patch: Partial<NotchSettings>) => update((c) => ({ ...c, notch: { ...c.notch, ...patch } }));
  return (
    <Section title="Notch">
      <Row label="Show the notch" hint="A black island at the top centre of the screen. Hover it for media, prayer times and your clipboard.">
        <Toggle label="Show the notch" checked={notch.enabled} onChange={(enabled) => set({ enabled })} />
      </Row>
      <Row
        label="Prayer times"
        hint={
          shared?.location
            ? `Countdown to the next prayer in ${shared.location.name}, and a reminder when it's due.`
            : "Set a city in any weather or prayer widget first."
        }
      >
        <Toggle label="Prayer times" checked={notch.prayer} onChange={(prayer) => set({ prayer })} />
      </Row>
      {shared && (
        <>
          <Row label="Calculation method">
            <select className="s-input" aria-label="Calculation method" value={shared.prayerMethod} onChange={(e) => updateShared({ prayerMethod: e.target.value })}>
              {METHODS.map(([id, label]) => (
                <option key={id} value={id}>
                  {label}
                </option>
              ))}
            </select>
          </Row>
          <Row label="Asr">
            <select
              className="s-input"
              aria-label="Asr"
              value={shared.prayerAsr}
              onChange={(e) => updateShared({ prayerAsr: e.target.value as typeof shared.prayerAsr })}
            >
              <option value="standard">Standard</option>
              <option value="hanafi">Hanafi</option>
            </select>
          </Row>
        </>
      )}
      <Row
        label="Clipboard history"
        hint="Text and images you copy, kept in memory. Pinned items are saved to disk. Copies that password managers mark as private are skipped."
      >
        <Toggle label="Clipboard history" checked={notch.clipboard} onChange={(clipboard) => set({ clipboard })} />
      </Row>
    </Section>
  );
}

function GeneralSection() {
  const [autostart, setAutostart] = useState<boolean | null>(null);
  useEffect(() => {
    isEnabled().then(setAutostart, () => setAutostart(false));
  }, []);
  const toggle = async (on: boolean) => {
    await (on ? enable() : disable());
    setAutostart(await isEnabled());
  };
  return (
    <Section title="General">
      <Row label="Start with Windows">
        {autostart !== null && <Toggle label="Start with Windows" checked={autostart} onChange={toggle} />}
      </Row>
      <Row label="Show / hide dock" hint="Global shortcut">
        <kbd className="s-kbd">Alt</kbd>+<kbd className="s-kbd">D</kbd>
      </Row>

    </Section>
  );
}

function UpdatesSection({ config, update }: { config: Config; update: Update }) {
  const u = useUpdater(config.updates);
  const [version, setVersion] = useState("");
  useEffect(() => {
    getVersion().then(setVersion, () => {});
  }, []);
  const set = (patch: Partial<Config["updates"]>) => update((c) => ({ ...c, updates: { ...c.updates, ...patch } }));
  const s = u.state;
  return (
    <Section title="Updates">
      <Row label="Current version" hint={s.kind === "current" ? `Up to date · checked ${s.checkedAt.toLocaleTimeString()}` : undefined}>
        <span className="s-hint">Harbor {version}</span>
      </Row>
      {s.kind === "available" && (
        <div className="s-update">
          <div>
            <b>Harbor {s.update.version} is available</b>
            {s.update.body && <pre className="s-notes">{s.update.body}</pre>}
          </div>
          <button className="s-btn s-primary" onClick={() => u.install(s.update)}>
            Install and restart
          </button>
        </div>
      )}
      {s.kind === "downloading" && (
        <Row label={`Downloading ${s.update.version}…`}>
          <span className="s-hint">
            {fmtBytes(s.done)}
            {s.total ? ` of ${fmtBytes(s.total)}` : ""}
          </span>
        </Row>
      )}
      {s.kind === "installing" && (
        <Row label="Installing…" hint="Harbor will restart in a moment.">
          <span />
        </Row>
      )}
      {s.kind === "error" && <p className="s-error s-pad">{s.message}</p>}
      <Row label="Check automatically" hint="At startup and every 6 hours.">
        <Toggle label="Check automatically" checked={config.updates.autoCheck} onChange={(autoCheck) => set({ autoCheck })} />
      </Row>
      <Row label="Install automatically" hint="Download and install as soon as an update is found. Harbor restarts.">
        <Toggle
          label="Install automatically"
          checked={config.updates.autoInstall}
          onChange={(autoInstall) => set({ autoInstall })}
        />
      </Row>
      <div className="s-row s-row-end">
        <button className="s-btn" disabled={s.kind === "checking" || s.kind === "downloading" || s.kind === "installing"} onClick={u.check}>
          {s.kind === "checking" ? "Checking…" : "Check for updates"}
        </button>
      </div>
    </Section>
  );
}

const STYLES: { id: AppearanceStyle; name: string; hint: string; preview: string }[] = [
  { id: "glass", name: "Liquid Glass", hint: "Your wallpaper, blurred", preview: "linear-gradient(135deg, rgba(120,90,255,.55), rgba(255,120,90,.45))" },
  { id: "ios-glass", name: "iOS Glass", hint: "Brighter, frosted", preview: "linear-gradient(135deg, rgba(255,255,255,.55), rgba(160,200,255,.45))" },
  { id: "midnight", name: "Midnight", hint: "Deep navy", preview: "linear-gradient(135deg, #0b1230, #1c2a5c)" },
  { id: "black", name: "Black", hint: "Solid and quiet", preview: "#0a0b0e" },
  { id: "white", name: "White", hint: "Light and clean", preview: "#f6f6f9" },
];

function AppearanceSection({ config, update }: { config: Config; update: Update }) {
  const a = config.appearance;
  const set = (patch: Partial<Config["appearance"]>) => update((c) => ({ ...c, appearance: { ...c.appearance, ...patch } }));
  return (
    <Section title="Appearance">
      <div className="s-styles" role="radiogroup" aria-label="Style">
        {STYLES.map((s) => (
          <button key={s.id} role="radio" aria-checked={a.style === s.id} className={"s-style" + (a.style === s.id ? " on" : "")} onClick={() => set({ style: s.id })}>
            <span className="s-style-preview" style={{ background: s.preview }}>
              <span className={"s-style-pill" + (s.id === "white" ? " light" : "")} />
              <span className={"s-style-pill" + (s.id === "white" ? " light" : "")} />
            </span>
            <b>{s.name}</b>
            <span className="s-hint">{s.hint}</span>
          </button>
        ))}
      </div>
      <Row label="Spacing" hint="Gap between items on the dock.">
        <Slider label="Spacing" value={a.spacing} min={0} max={24} step={1} format={(v) => `${v}px`} onChange={(spacing) => set({ spacing })} />
      </Row>
    </Section>
  );
}

export function Settings() {
  const [config, update] = useConfig();
  if (!config) return null;
  return (
    <main className="s-page">
      <h1>Settings</h1>
      <AppearanceSection config={config} update={update} />
      <DockLayoutSection config={config} update={update} Row={Row} Toggle={Toggle} />
      <DockSection dock={config.dock} update={update} />
      <PinnedSection config={config} update={update} />
      <BarSection bar={config.bar} update={update} />
      <NotchSection notch={config.notch} update={update} />
      <CalendarsSection Row={Row} />
      <AutomationsSection config={config} update={update} Row={Row} Toggle={Toggle} />
      <GeneralSection />
      <UpdatesSection config={config} update={update} />
    </main>
  );
}
