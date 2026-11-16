import { ReactNode, useEffect, useState } from "react";
import { getVersion } from "@tauri-apps/api/app";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { BarSettings, Config, DockSettings, exeName, PinnedApp, samePath } from "../lib/api";
import { iconKey, useConfig, useIcons } from "../lib/config";
import { pickApp, pickIcon } from "../lib/pickIcon";

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
    <Section title="Dock">
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
      <div className="s-row s-row-end">
        {error && <span className="s-error">{error}</span>}
        <button className="s-btn s-primary" onClick={add}>
          Add app…
        </button>
      </div>
      <p className="s-hint s-pad">
        You can also drop .exe or .lnk files onto the dock, or right-click a running app and choose Pin.
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

function GeneralSection() {
  const [autostart, setAutostart] = useState<boolean | null>(null);
  const [version, setVersion] = useState("");
  useEffect(() => {
    isEnabled().then(setAutostart, () => setAutostart(false));
    getVersion().then(setVersion, () => {});
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
      {version && (
        <Row label="Version">
          <span className="s-hint">Harbor {version}</span>
        </Row>
      )}
    </Section>
  );
}

export function Settings() {
  const [config, update] = useConfig();
  if (!config) return null;
  return (
    <main className="s-page">
      <h1>Settings</h1>
      <DockSection dock={config.dock} update={update} />
      <PinnedSection config={config} update={update} />
      <BarSection bar={config.bar} update={update} />
      <GeneralSection />
    </main>
  );
}
