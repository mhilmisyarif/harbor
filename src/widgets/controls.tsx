// Phase B widgets: quick toggles, brightness, per-app volume, recent folders
// and Screen Time. Each has a panel/card tile and a dock pill (see PILLS).
import { useState } from "react";
import { api, FileItem, FolderKind } from "../lib/api";
import { useIcons } from "../lib/config";
import { fmtBytes, setShared, Tile, useShared } from "./kit";

const fmtSecs = (s: number) => {
  const h = Math.floor(s / 3600);
  const m = Math.round((s % 3600) / 60);
  return h ? `${h}h ${m}m` : `${m}m`;
};

const ago = (ms: number) => {
  const s = (Date.now() - ms) / 1000;
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return new Date(ms).toLocaleDateString(undefined, { day: "numeric", month: "short" });
};

// ---------- quick toggles ----------

const useRadios = () => useShared("radios", api.radios, 4000);

export function QuickToggles() {
  const { data: radios } = useRadios();
  const [error, setError] = useState<string | null>(null);
  const radio = (kind: "wifi" | "bluetooth") => radios?.find((r) => r.kind === kind);
  const toggle = async (kind: "wifi" | "bluetooth") => {
    const r = radio(kind);
    if (!r) return api.shellAction(kind === "wifi" ? "wifi-settings" : "bluetooth-settings");
    try {
      setError(null);
      await api.setRadio(kind, !r.on);
      setShared("radios", await api.radios());
    } catch (e) {
      setError(String(e));
    }
  };
  const Btn = ({ on, icon, label, onClick, onMore }: { on?: boolean; icon: string; label: string; onClick: () => void; onMore?: () => void }) => (
    <button className={"w-qt" + (on ? " on" : "")} onClick={onClick} onContextMenu={(e) => (e.preventDefault(), onMore?.())}>
      <span className="w-qt-icon">{icon}</span>
      <span className="w-small">{label}</span>
    </button>
  );
  return (
    <Tile title="Quick toggles">
      <div className="w-qt-grid">
        <Btn on={radio("wifi")?.on} icon="📶" label="Wi-Fi" onClick={() => toggle("wifi")} onMore={() => api.shellAction("wifi-settings")} />
        <Btn on={radio("bluetooth")?.on} icon="🔵" label="Bluetooth" onClick={() => toggle("bluetooth")} onMore={() => api.shellAction("bluetooth-settings")} />
        <Btn icon="📡" label="Hotspot" onClick={() => api.shellAction("hotspot")} />
        <Btn icon="✈️" label="Airplane" onClick={() => api.shellAction("airplane")} />
        <Btn icon="🌙" label="Focus" onClick={() => api.shellAction("focus")} />
        <Btn icon="🖥️" label="Display" onClick={() => api.shellAction("display-settings")} />
      </div>
      <p className="w-muted w-small">Right-click Wi-Fi or Bluetooth for their settings.</p>
      {error && <p className="w-error">{error}</p>}
    </Tile>
  );
}

// ---------- brightness ----------

export function useBrightness() {
  const { data } = useShared("brightness", api.brightness, 10_000);
  const [local, setLocal] = useState<number | null>(null);
  const level = local ?? data?.level ?? 0;
  const commit = async () => {
    if (local === null) return;
    try {
      await api.setBrightness(local);
      setShared("brightness", { level: local, source: data?.source ?? null });
    } catch (e) {
      console.warn(e);
    }
    setLocal(null);
  };
  return { supported: data ? data.level !== null : true, loaded: !!data, level, setLocal, commit };
}

export function Brightness() {
  const b = useBrightness();
  return (
    <Tile title="Brightness">
      {b.supported ? (
        <div className="w-row w-gap">
          <span className="w-qt-icon">🔅</span>
          <input type="range" className="w-range" aria-label="Brightness" min={0} max={100} value={b.level} onChange={(e) => b.setLocal(Number(e.target.value))} onPointerUp={b.commit} onKeyUp={b.commit} />
          <span className="w-num w-small">{b.level}%</span>
        </div>
      ) : (
        <p className="w-muted w-small">This display doesn't support changing brightness from software.</p>
      )}
    </Tile>
  );
}

// ---------- per-app volume ----------

export function AppMixer() {
  const { data: apps } = useShared("app-volumes", api.appVolumes, 2500);
  const iconFor = useIcons((apps ?? []).map((a) => [a.exe]));
  const [local, setLocal] = useState<Record<number, number>>({});
  const refresh = async () => setShared("app-volumes", await api.appVolumes());
  return (
    <Tile title="Apps">
      {(apps ?? []).length === 0 && <p className="w-muted w-small">No apps are using sound.</p>}
      {(apps ?? []).map((a) => {
        const level = local[a.pid] ?? Math.round(a.level * 100);
        const icon = a.exe ? iconFor([a.exe]) : null;
        return (
          <div key={a.pid} className="w-mixer-row">
            {icon ? <img className="w-mixer-icon" src={icon} alt="" /> : <span className="w-mixer-icon">🔔</span>}
            <div className="w-grow w-min0">
              <div className="w-row w-small">
                <span className="w-ellipsis">{a.name}</span>
                <span className="w-muted">{a.muted ? "Muted" : `${level}%`}</span>
              </div>
              <input
                type="range"
                className="w-range"
                aria-label={`${a.name} volume`}
                min={0}
                max={100}
                value={level}
                onChange={(e) => setLocal((m) => ({ ...m, [a.pid]: Number(e.target.value) }))}
                onPointerUp={async () => {
                  await api.setAppVolume(a.pid, level / 100);
                  setLocal(({ [a.pid]: _done, ...rest }) => rest);
                  refresh();
                }}
              />
            </div>
            <button className="w-x" title={a.muted ? "Unmute" : "Mute"} onClick={async () => (await api.setAppVolume(a.pid, undefined, !a.muted), refresh())}>
              {a.muted ? "🔇" : "🔊"}
            </button>
          </div>
        );
      })}
    </Tile>
  );
}

// ---------- Downloads / Screenshots / Recent ----------

const FOLDERS: Record<FolderKind, { title: string; icon: string }> = {
  downloads: { title: "Downloads", icon: "⬇️" },
  screenshots: { title: "Screenshots", icon: "🖼️" },
  recent: { title: "Recently opened", icon: "🕘" },
};

export const useFolder = (kind: FolderKind, limit = 8) => useShared(`folder:${kind}:${limit}`, () => api.recentFiles(kind, limit), 15_000);

function FolderList({ kind }: { kind: FolderKind }) {
  const { data, error } = useFolder(kind);
  const iconFor = useIcons((data ?? []).map((f) => [f.path]));
  const f = FOLDERS[kind];
  return (
    <Tile
      title={
        <span className="w-row">
          {f.icon} {f.title}
          <button className="w-link" onClick={() => api.openKnownFolder(kind)}>
            Open
          </button>
        </span>
      }
    >
      {(data ?? []).map((item: FileItem) => {
        const icon = iconFor([item.path]);
        return (
          <div key={item.path} className="w-file" title={item.path}>
            <button className="w-file-main" onClick={() => api.launch(item.path)}>
              {icon ? <img className="w-file-icon" src={icon} alt="" /> : <span className="w-file-icon">📄</span>}
              <span className="w-grow w-min0">
                <span className="w-ellipsis w-block">{item.name}</span>
                <span className="w-muted w-small">
                  {ago(item.modified)}
                  {!item.isDir && kind !== "recent" ? ` · ${fmtBytes(item.size)}` : ""}
                </span>
              </span>
            </button>
            {kind !== "recent" && (
              <button className="w-x" title="Show in folder" onClick={() => api.revealFile(item.path)}>
                📂
              </button>
            )}
          </div>
        );
      })}
      {data?.length === 0 && <p className="w-muted w-small">Nothing here yet.</p>}
      {error && <p className="w-error">{error}</p>}
    </Tile>
  );
}

export const Downloads = () => <FolderList kind="downloads" />;
export const Screenshots = () => <FolderList kind="screenshots" />;
export const RecentFiles = () => <FolderList kind="recent" />;

// ---------- Screen Time ----------

export const useScreenTime = () => useShared("screen-time", () => api.screenTime(7), 30_000);

export function ScreenTime() {
  const { data } = useScreenTime();
  const today = data?.[0];
  const iconFor = useIcons((today?.apps ?? []).slice(0, 5).map((a) => [a.exe]));
  const week = [...(data ?? [])].reverse();
  const max = Math.max(1, ...week.map((d) => d.total));

  return (
    <Tile title="Screen Time">
      <div className="w-row">
        <span className="w-big">{fmtSecs(today?.total ?? 0)}</span>
        <span className="w-muted w-small">today</span>
      </div>
      <div className="w-st-week">
        {week.map((d) => (
          <div key={d.date} className="w-st-day" title={`${d.date}: ${fmtSecs(d.total)}`}>
            <span className="w-st-bar" style={{ height: `${(d.total / max) * 100}%` }} />
            <span className="w-small w-muted">{new Date(d.date + "T12:00").toLocaleDateString(undefined, { weekday: "narrow" })}</span>
          </div>
        ))}
      </div>
      {(today?.apps ?? []).slice(0, 5).map((a) => {
        const icon = iconFor([a.exe]);
        return (
          <div key={a.exe} className="w-row w-small">
            <span className="w-row w-gap w-min0">
              {icon && <img className="w-file-icon" src={icon} alt="" />}
              <span className="w-ellipsis">{a.name}</span>
            </span>
            <span className="w-num">{fmtSecs(a.secs)}</span>
          </div>
        );
      })}
      {!today && <p className="w-muted w-small">Harbor starts counting while it runs. Check back in a few minutes.</p>}
    </Tile>
  );
}

export { fmtSecs };
