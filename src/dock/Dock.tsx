import { CSSProperties, useEffect, useMemo, useState } from "react";
import { Menu } from "@tauri-apps/api/menu";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { api, Config, exeName, poll, samePath, WindowInfo } from "../lib/api";
import { iconKey, useConfig, useIcons } from "../lib/config";
import { pickIcon } from "../lib/pickIcon";

const PAD = 14; // dock inner padding
const RANGE = 140; // px of cursor distance over which magnification fades

interface DockItem {
  key: string;
  name: string;
  /** What launching/pinning uses: path, or shell:AppsFolder\<id>. */
  path: string;
  /** Icon sources to try in order. */
  icons: string[];
  pinned: boolean;
  windows: WindowInfo[];
}

/** A running window belongs to a pinned item if either its exe or its app id matches. */
const belongsTo = (w: WindowInfo, path: string) => samePath(w.exe, path) || samePath(w.iconSource, path);

function buildItems(config: Config, windows: WindowInfo[]): DockItem[] {
  const pinned: DockItem[] = config.pinned.map((p) => {
    const wins = windows.filter((w) => belongsTo(w, p.path));
    return {
      key: "pin:" + p.path,
      name: p.name,
      path: p.path,
      icons: [p.path, ...(wins[0] ? [wins[0].iconSource, wins[0].exe] : [])],
      pinned: true,
      windows: wins,
    };
  });
  if (!config.dock.showRunning) return pinned;

  const extra = new Map<string, DockItem>();
  for (const w of windows) {
    if (!w.exe || pinned.some((p) => belongsTo(w, p.path))) continue;
    const k = w.iconSource.toLowerCase();
    const item = extra.get(k) ?? {
      key: "run:" + k,
      name: exeName(w.exe),
      path: w.iconSource,
      icons: [w.iconSource, w.exe],
      pinned: false,
      windows: [],
    };
    item.windows.push(w);
    extra.set(k, item);
  }
  return [...pinned, ...extra.values()];
}

export function Dock() {
  const [config, update] = useConfig();
  const [windows, setWindows] = useState<WindowInfo[]>([]);
  const [mouseX, setMouseX] = useState<number | null>(null);

  useEffect(() => poll(api.windows, 1000, setWindows), []);

  const items = useMemo(() => (config ? buildItems(config, windows) : []), [config, windows]);
  const iconFor = useIcons(items.map((i) => i.icons));

  // Geometry follows the configured icon size and magnification.
  const size = config?.dock.iconSize ?? 48;
  const scale = config?.dock.magnify ? config.dock.magnifyScale : 1;
  const slot = size + 16;
  const dockWidth = items.length * slot + PAD * 2;
  const dockHeight = size + 28;
  const headroom = size * (scale - 1) + 34; // magnified icon + tooltip
  const edge = 24 + (size * (scale - 1)) / 2;
  const winWidth = Math.max(dockWidth + edge * 2, 200);
  const winHeight = Math.ceil(dockHeight + headroom + 6);

  useEffect(() => {
    if (config) api.layoutDock(winWidth, winHeight).catch(console.error);
  }, [winWidth, winHeight, config !== null]); // eslint-disable-line react-hooks/exhaustive-deps

  // Drop .exe / .lnk files onto the dock to pin them.
  useEffect(() => {
    const unlisten = getCurrentWebview().onDragDropEvent((e) => {
      if (e.payload.type !== "drop") return;
      const dropped = e.payload.paths;
      update((c) => ({
        ...c,
        pinned: [
          ...c.pinned,
          ...dropped
            .filter((p) => !c.pinned.some((x) => samePath(x.path, p)))
            .map((p) => ({ name: exeName(p), path: p })),
        ],
      }));
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, [update]);

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

  const setIcon = async (item: DockItem) => {
    const url = await pickIcon();
    if (url) update((c) => ({ ...c, iconOverrides: { ...c.iconOverrides, [iconKey(item.path)]: url } }));
  };

  const resetIcon = (item: DockItem) =>
    update((c) => {
      const { [iconKey(item.path)]: _removed, ...rest } = c.iconOverrides;
      return { ...c, iconOverrides: rest };
    });

  const onItemMenu = async (e: React.MouseEvent, item: DockItem) => {
    e.preventDefault();
    e.stopPropagation();
    if (!config) return;
    const hasOverride = iconKey(item.path) in config.iconOverrides;
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
              update((c) => ({ ...c, pinned: c.pinned.filter((p) => !samePath(p.path, item.path)) })),
          }
        : {
            text: "Pin to dock",
            action: () => update((c) => ({ ...c, pinned: [...c.pinned, { name: item.name, path: item.path }] })),
          },
      { text: "Change icon…", action: () => setIcon(item) },
      ...(hasOverride ? [{ text: "Reset icon", action: () => resetIcon(item) }] : []),
      ...(item.windows.length
        ? [{ text: "Close all windows", action: () => item.windows.forEach((w) => api.close(w.id)) }]
        : []),
      { text: "Dock settings…", action: () => api.openSettings() },
    ];
    const menu = await Menu.new({ items: entries });
    await menu.popup();
  };

  const onDockMenu = async (e: React.MouseEvent) => {
    e.preventDefault();
    const on = await isEnabled();
    const menu = await Menu.new({
      items: [
        { text: "Settings…", action: () => api.openSettings() },
        { text: on ? "✓ Start with Windows" : "Start with Windows", action: () => (on ? disable() : enable()) },
      ],
    });
    await menu.popup();
  };

  const scaleAt = (i: number) => {
    if (mouseX === null || scale === 1) return 1;
    const center = PAD + i * slot + slot / 2;
    const d = Math.abs(mouseX - center);
    return 1 + (scale - 1) * Math.max(0, 1 - d / RANGE);
  };

  if (!config) return null;
  return (
    <div className="dock-stage" style={{ "--icon": `${size}px`, "--slot": `${slot}px` } as CSSProperties}>
      <div
        className="dock"
        style={{ width: dockWidth }}
        onMouseMove={(e) => setMouseX(e.clientX - e.currentTarget.getBoundingClientRect().left)}
        onMouseLeave={() => setMouseX(null)}
        onContextMenu={onDockMenu}
      >
        {items.map((item, i) => {
          const icon = config.iconOverrides[iconKey(item.path)] ?? iconFor(item.icons);
          const running = item.windows.length > 0;
          const focused = item.windows.some((w) => w.focused);
          return (
            <button
              key={item.key}
              className={"dock-item" + (focused ? " focused" : "")}
              style={{ "--scale": scaleAt(i) } as CSSProperties}
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
