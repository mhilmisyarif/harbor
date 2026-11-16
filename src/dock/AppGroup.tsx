// The card a pinned app group opens: its apps in a grid, like a folder.
import { useEffect, useState } from "react";
import { api, Config, poll, samePath, WindowInfo } from "../lib/api";
import { iconKey, useIcons } from "../lib/config";

export function AppGroup({ config, name }: { config: Config; name: string }) {
  const apps = config.pinned.filter((p) => p.group === name);
  const [windows, setWindows] = useState<WindowInfo[]>([]);
  const iconFor = useIcons(apps.map((p) => [p.path]));

  useEffect(() => poll(api.windows, 1500, setWindows), []);

  if (apps.length === 0) return <p className="w-muted">This group is empty.</p>;

  const open = (path: string) => {
    const wins = windows.filter((w) => samePath(w.exe, path) || samePath(w.iconSource, path));
    (wins.length ? api.activate((wins.find((w) => w.focused) ?? wins[0]).id) : api.launch(path)).catch(console.error);
    api.closeCard().catch(console.error);
  };

  return (
    <div className="app-group">
      {apps.map((p) => {
        const icon = config.iconOverrides[iconKey(p.path)] ?? iconFor([p.path]);
        const running = windows.some((w) => samePath(w.exe, p.path) || samePath(w.iconSource, p.path));
        return (
          <button key={p.path} className="app-group-item" title={p.path} onClick={() => open(p.path)}>
            {icon ? (
              <img src={icon} alt="" draggable={false} />
            ) : (
              <span className="app-group-letter">{p.name.slice(0, 1).toUpperCase()}</span>
            )}
            <span className="app-group-name">{p.name}</span>
            <span className={"dock-dot" + (running ? " on" : "")} />
          </button>
        );
      })}
    </div>
  );
}
