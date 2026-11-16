import { useCallback, useEffect, useMemo, useState } from "react";
import { Menu } from "@tauri-apps/api/menu";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { api, Config, exeName, poll, samePath, WindowInfo } from "../lib/api";

const SLOT = 64; // px per icon including gap
const PAD = 14; // dock inner padding
const EDGE = 40; // extra window width so magnified edge icons are not clipped
const MAX_SCALE = 1.5;
const RANGE = 140; // px of cursor distance over which magnification fades

interface DockItem {
  key: string;
  name: string;
  path: string;
  pinned: boolean;
  windows: WindowInfo[];
}

function useIcons(paths: string[]) {
  const [icons, setIcons] = useState<Record<string, string | null>>({});
  useEffect(() => {
    for (const p of paths) {
      const k = p.toLowerCase();
      if (k in icons) continue;
      setIcons((m) => ({ ...m, [k]: null }));
      api.icon(p).then((url) => setIcons((m) => ({ ...m, [k]: url })));
    }
  }, [paths.join("|")]); // eslint-disable-line react-hooks/exhaustive-deps
  return (path: string) => icons[path.toLowerCase()] ?? null;
}

export function Dock() {
  const [config, setConfig] = useState<Config | null>(null);
  const [windows, setWindows] = useState<WindowInfo[]>([]);
  const [mouseX, setMouseX] = useState<number | null>(null);

  useEffect(() => {
    api.loadConfig().then(setConfig);
  }, []);
  useEffect(() => poll(api.windows, 1000, setWindows), []);

  const updateConfig = useCallback((next: Config) => {
    setConfig(next);
    api.saveConfig(next).catch(console.error);
  }, []);

  // Pinned apps first (in pinned order), then running apps that aren't pinned.
  const items = useMemo<DockItem[]>(() => {
    if (!config) return [];
    const pinned: DockItem[] = config.pinned.map((p) => ({
      key: "pin:" + p.path,
      name: p.name,
      path: p.path,
      pinned: true,
      windows: windows.filter((w) => samePath(w.exe, p.path)),
    }));
    const extra = new Map<string, DockItem>();
    for (const w of windows) {
      if (!w.exe || pinned.some((p) => samePath(p.path, w.exe))) continue;
      const k = w.exe.toLowerCase();
      const item = extra.get(k) ?? {
        key: "run:" + k,
        name: exeName(w.exe),
        path: w.exe,
        pinned: false,
        windows: [],
      };
      item.windows.push(w);
      extra.set(k, item);
    }
    return [...pinned, ...extra.values()];
  }, [config, windows]);

  const iconFor = useIcons(items.map((i) => i.path));

  // Resize/recenter the native window whenever the item count changes.
  const width = items.length * SLOT + PAD * 2 + EDGE * 2;
  useEffect(() => {
    if (config) api.layoutDock(Math.max(width, 200)).catch(console.error);
  }, [width, config !== null]); // eslint-disable-line react-hooks/exhaustive-deps

  // Drop .exe / .lnk files onto the dock to pin them.
  useEffect(() => {
    const unlisten = getCurrentWebview().onDragDropEvent((e) => {
      if (e.payload.type !== "drop" || !config) return;
      const fresh = e.payload.paths
        .filter((p) => !config.pinned.some((x) => samePath(x.path, p)))
        .map((p) => ({ name: exeName(p), path: p }));
      if (fresh.length) updateConfig({ ...config, pinned: [...config.pinned, ...fresh] });
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, [config, updateConfig]);

  const onClick = (item: DockItem) => {
    if (item.windows.length === 0) {
      api.launch(item.path).catch(console.error);
      return;
    }
    // Cycle: if one of its windows is focused, go to the next one.
    const i = item.windows.findIndex((w) => w.focused);
    const target =
      i >= 0 && item.windows.length > 1
        ? item.windows[(i + 1) % item.windows.length]
        : item.windows[Math.max(i, 0)];
    api.activate(target.id).catch(console.error);
  };

  const onItemMenu = async (e: React.MouseEvent, item: DockItem) => {
    e.preventDefault();
    e.stopPropagation();
    if (!config) return;
    const entries = [
      ...item.windows.map((w) => ({
        text: w.title.length > 50 ? w.title.slice(0, 50) + "…" : w.title,
        action: () => api.activate(w.id),
      })),
      { text: "Open new window", action: () => api.launch(item.path) },
      item.pinned
        ? {
            text: "Unpin from dock",
            action: () =>
              updateConfig({
                ...config,
                pinned: config.pinned.filter((p) => !samePath(p.path, item.path)),
              }),
          }
        : {
            text: "Pin to dock",
            action: () =>
              updateConfig({
                ...config,
                pinned: [...config.pinned, { name: item.name, path: item.path }],
              }),
          },
      ...(item.windows.length
        ? [{ text: "Close all windows", action: () => item.windows.forEach((w) => api.close(w.id)) }]
        : []),
    ];
    const menu = await Menu.new({ items: entries });
    await menu.popup();
  };

  const onDockMenu = async (e: React.MouseEvent) => {
    e.preventDefault();
    const on = await isEnabled();
    const menu = await Menu.new({
      items: [
        {
          text: on ? "✓ Start with Windows" : "Start with Windows",
          action: () => (on ? disable() : enable()),
        },
      ],
    });
    await menu.popup();
  };

  const dockWidth = items.length * SLOT + PAD * 2;
  const scaleAt = (i: number) => {
    if (mouseX === null) return 1;
    const center = PAD + i * SLOT + SLOT / 2;
    const d = Math.abs(mouseX - center);
    return 1 + (MAX_SCALE - 1) * Math.max(0, 1 - d / RANGE);
  };

  return (
    <div className="dock-stage">
      <div
        className="dock"
        style={{ width: dockWidth }}
        onMouseMove={(e) => setMouseX(e.clientX - e.currentTarget.getBoundingClientRect().left)}
        onMouseLeave={() => setMouseX(null)}
        onContextMenu={onDockMenu}
      >
        {items.map((item, i) => {
          const icon = iconFor(item.path);
          const running = item.windows.length > 0;
          const focused = item.windows.some((w) => w.focused);
          return (
            <button
              key={item.key}
              className={"dock-item" + (focused ? " focused" : "")}
              style={{ "--scale": scaleAt(i) } as React.CSSProperties}
              onClick={() => onClick(item)}
              onContextMenu={(e) => onItemMenu(e, item)}
            >
              <span className="dock-tip">{item.name}</span>
              {icon ? (
                <img className="dock-icon" src={icon} alt="" draggable={false} />
              ) : (
                <span className="dock-icon dock-fallback">{item.name.slice(0, 1).toUpperCase()}</span>
              )}
              <span className={"dock-dot" + (running ? " on" : "")} />
            </button>
          );
        })}
      </div>
    </div>
  );
}
