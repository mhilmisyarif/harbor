// Local PC widgets: CPU/RAM, top apps, network, storage, battery styles, theme,
// keyboard layout and one-click shell shortcuts.
import { useEffect, useState } from "react";
import { api, ShellAction } from "../lib/api";
import { useNetworkHistory, useStats, useSystemInfo, useTopProcesses } from "./data";
import { fmtBytes, pct, Ring, Spark, Tile, useShared } from "./kit";

const NO_BATTERY = <p className="w-muted">No battery detected</p>;

export function CpuRing() {
  const { data } = useStats();
  return (
    <Tile title="CPU" className="w-center">
      <Ring value={(data?.cpu ?? 0) / 100} color={(data?.cpu ?? 0) > 85 ? "#f87171" : "var(--accent)"}>
        <b>{data ? pct(data.cpu) : "–"}</b>
      </Ring>
    </Tile>
  );
}

export function RamRing() {
  const { data } = useStats();
  const used = data ? data.memUsed / data.memTotal : 0;
  return (
    <Tile title="Memory" className="w-center">
      <Ring value={used} color={used > 0.9 ? "#f87171" : "#a78bfa"}>
        <b>{data ? pct(used * 100) : "–"}</b>
      </Ring>
      {data && <div className="w-muted w-small">{fmtBytes(data.memUsed)} of {fmtBytes(data.memTotal)}</div>}
    </Tile>
  );
}

function TopList({ by }: { by: "cpu" | "ram" }) {
  const { data } = useTopProcesses(by);
  return (
    <Tile title={by === "cpu" ? "Top CPU" : "Top memory"} onClick={() => api.shellAction("task-manager")}>
      {(data ?? []).map((p) => (
        <div key={p.name} className="w-row">
          <span className="w-ellipsis">
            {p.name}
            {p.count > 1 && <span className="w-muted w-small"> ×{p.count}</span>}
          </span>
          <span className="w-num">{by === "cpu" ? `${p.cpu.toFixed(1)}%` : fmtBytes(p.memory)}</span>
        </div>
      ))}
      {!data && <p className="w-muted">Measuring…</p>}
    </Tile>
  );
}
export const TopCpu = () => <TopList by="cpu" />;
export const TopRam = () => <TopList by="ram" />;

export function Network() {
  const { data } = useSystemInfo();
  const { rx, tx } = useNetworkHistory();
  return (
    <Tile title="Network">
      <div className="w-row">
        <span className="w-net-down">↓ {fmtBytes(data?.rxPerSec ?? 0)}/s</span>
        <span className="w-net-up">↑ {fmtBytes(data?.txPerSec ?? 0)}/s</span>
      </div>
      <div className="w-net-chart">
        <Spark values={rx} height={44} />
        <div className="w-net-overlay">
          <Spark values={tx} height={44} fill={false} />
        </div>
      </div>
    </Tile>
  );
}

export function Storage() {
  const { data } = useSystemInfo();
  return (
    <Tile title="Storage" onClick={() => api.shellAction("storage-settings")}>
      {(data?.disks ?? []).map((d) => {
        const used = (d.total - d.available) / d.total;
        return (
          <div key={d.mount} className="w-disk">
            <div className="w-row">
              <span>{d.mount}</span>
              <span className="w-muted w-small">{fmtBytes(d.available)} free</span>
            </div>
            <div className="w-meter">
              <div className={"w-meter-fill" + (used > 0.9 ? " warn" : "")} style={{ width: `${used * 100}%` }} />
            </div>
          </div>
        );
      })}
    </Tile>
  );
}

// ---------- battery styles ----------

const batteryColor = (level: number, charging: boolean) =>
  charging ? "#4ade80" : level <= 15 ? "#f87171" : level <= 30 ? "#fbbf24" : "var(--accent)";

export function Battery() {
  const { data } = useStats();
  if (data && data.battery === null) return <Tile title="Battery">{NO_BATTERY}</Tile>;
  const level = data?.battery ?? 0;
  return (
    <Tile title="Battery">
      <div className="w-row">
        <span className="w-big">{level}%</span>
        <span className="w-muted">{data?.charging ? "⚡ Charging" : "On battery"}</span>
      </div>
      <div className="w-meter w-meter-thick">
        <div className="w-meter-fill" style={{ width: `${level}%`, background: batteryColor(level, !!data?.charging) }} />
      </div>
    </Tile>
  );
}

export function BatteryRing() {
  const { data } = useStats();
  if (data && data.battery === null) return <Tile title="Battery">{NO_BATTERY}</Tile>;
  const level = data?.battery ?? 0;
  return (
    <Tile className={"w-center" + (data?.charging ? " w-charging" : "")}>
      <Ring value={level / 100} color={batteryColor(level, !!data?.charging)} size={88}>
        <b>{level}%</b>
        {data?.charging && <span className="w-small">⚡</span>}
      </Ring>
    </Tile>
  );
}

export function BatteryCore() {
  const { data } = useStats();
  if (data && data.battery === null) return <Tile title="Battery">{NO_BATTERY}</Tile>;
  const level = data?.battery ?? 0;
  const lit = Math.round((level / 100) * 12);
  return (
    <Tile title={`Energy core · ${level}%`} className={data?.charging ? "w-charging" : ""}>
      <div className="w-core">
        {Array.from({ length: 12 }, (_, i) => (
          <span key={i} className={i < lit ? "on" : ""} style={{ background: i < lit ? batteryColor(level, !!data?.charging) : undefined }} />
        ))}
      </div>
    </Tile>
  );
}

export function BatteryDots() {
  const { data } = useStats();
  if (data && data.battery === null) return <Tile title="Battery">{NO_BATTERY}</Tile>;
  const level = data?.battery ?? 0;
  return (
    <Tile className="w-center">
      <div className="w-dot-number">{level}</div>
      <div className="w-dotbar">
        {Array.from({ length: 20 }, (_, i) => (
          <span key={i} className={i < Math.round(level / 5) ? "on" : ""} />
        ))}
      </div>
    </Tile>
  );
}

export function BatteryGauge() {
  const { data } = useStats();
  if (data && data.battery === null) return <Tile title="Battery">{NO_BATTERY}</Tile>;
  const level = data?.battery ?? 0;
  const angle = -90 + (level / 100) * 180;
  return (
    <Tile title="Fuel" className="w-center">
      <svg viewBox="0 0 100 60" className="w-gauge">
        <path d="M10 55 A40 40 0 0 1 90 55" className="w-gauge-track" />
        <path d="M10 55 A40 40 0 0 1 90 55" className="w-gauge-fill" pathLength={100} strokeDasharray={`${level} 100`} />
        <line x1="50" y1="55" x2={50 + 34 * Math.sin((angle * Math.PI) / 180)} y2={55 - 34 * Math.cos((angle * Math.PI) / 180)} className="w-gauge-needle" />
        <text x="8" y="58" className="w-gauge-label">E</text>
        <text x="86" y="58" className="w-gauge-label">F</text>
      </svg>
      <div className="w-small">{level}%{data?.charging ? " · charging" : ""}</div>
    </Tile>
  );
}

// ---------- toggles & shortcuts ----------

export function ThemeToggle() {
  const [dark, setDark] = useState<boolean | null>(null);
  useEffect(() => {
    api.getDarkMode().then(setDark);
  }, []);
  return (
    <Tile title="Theme" className="w-center">
      <button className="w-big-btn" onClick={() => api.setDarkMode(!dark).then(setDark)} disabled={dark === null}>
        {dark ? "🌙" : "☀️"}
        <span className="w-small">{dark ? "Dark" : "Light"}</span>
      </button>
    </Tile>
  );
}

export function Language() {
  const { data } = useShared("input-language", api.inputLanguage, 2000);
  const [error, setError] = useState<string | null>(null);
  return (
    <Tile title="Keyboard" className="w-center">
      <button
        className="w-big-btn"
        title={data?.name}
        onClick={() => api.nextInputLanguage().then(() => setError(null), (e) => setError(String(e)))}
        onContextMenu={(e) => (e.preventDefault(), api.shellAction("language-settings"))}
      >
        <span className="w-lang">{data?.short ?? "–"}</span>
        <span className="w-small w-ellipsis">{data?.available && data.available > 1 ? "Click to switch" : data?.name}</span>
      </button>
      {error && <p className="w-error">{error}</p>}
    </Tile>
  );
}

function ActionTile({ action, icon, label }: { action: ShellAction; icon: string; label: string }) {
  return (
    <Tile className="w-center">
      <button className="w-big-btn" onClick={() => api.shellAction(action)}>
        {icon}
        <span className="w-small">{label}</span>
      </button>
    </Tile>
  );
}
export const ShowDesktop = () => <ActionTile action="show-desktop" icon="🖥️" label="Show desktop" />;
export const NotificationsTile = () => <ActionTile action="notifications" icon="🔔" label="Notifications" />;
export const KeyboardTile = () => <ActionTile action="keyboard" icon="⌨️" label="On-screen keyboard" />;
export const Screenshot = () => <ActionTile action="screenshot" icon="✂️" label="Screenshot" />;
