import { CSSProperties, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Menu } from "@tauri-apps/api/menu";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { disable, enable, isEnabled } from "@tauri-apps/plugin-autostart";
import { emit, listen } from "@tauri-apps/api/event";
import { api, Config, DockEntry, exeName, poll, samePath, WindowInfo } from "../lib/api";
import { Backdrop } from "../lib/Backdrop";
import { iconKey, useConfig, useIcons } from "../lib/config";
import { pickIcon } from "../lib/pickIcon";
import { useWidgetConfig } from "../lib/widgetConfig";
import { PanelButtonPill, PILLS } from "../widgets/pills";
import { widgetByKind } from "../widgets/registry";

const RANGE = 140; // px of cursor distance over which magnification fades

interface AppItem {
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

function buildApps(config: Config, windows: WindowInfo[]): AppItem[] {
  const pinned: AppItem[] = config.pinned.map((p) => {
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

  const extra = new Map<string, AppItem>();
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

type Update = ReturnType<typeof useConfig>[1];

/** The pinned + running app icons, with hover magnification. */
function AppsGroup({ config, update, windows }: { config: Config; update: Update; windows: WindowInfo[] }) {
  const [mouseX, setMouseX] = useState<number | null>(null);
  const items = useMemo(() => buildApps(config, windows), [config, windows]);
  const iconFor = useIcons(items.map((i) => i.icons));
  const size = config.dock.iconSize;
  const scale = config.dock.magnify ? config.dock.magnifyScale : 1;
  const slot = size + 12;

  const onClick = (item: AppItem) => {
    if (item.windows.length === 0) {
      api.launch(item.path).catch(console.error);
      return;
    }
    // Cycle: if one of its windows is focused, go to the next one.
    const i = item.windows.findIndex((w) => w.focused);
    const target =
      i >= 0 && item.windows.length > 1 ? item.windows[(i + 1) % item.windows.length] : item.windows[Math.max(i, 0)];
    api.activate(target.id).catch(console.error);
  };

  const setIcon = async (item: AppItem) => {
    const url = await pickIcon();
    if (url) update((c) => ({ ...c, iconOverrides: { ...c.iconOverrides, [iconKey(item.path)]: url } }));
  };
  const resetIcon = (item: AppItem) =>
    update((c) => {
      const { [iconKey(item.path)]: _removed, ...rest } = c.iconOverrides;
      return { ...c, iconOverrides: rest };
    });

  const onItemMenu = async (e: React.MouseEvent, item: AppItem) => {
    e.preventDefault();
    e.stopPropagation();
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
            action: () => update((c) => ({ ...c, pinned: c.pinned.filter((p) => !samePath(p.path, item.path)) })),
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
      { text: "Customize dock…", action: () => api.openSettings() },
    ];
    const menu = await Menu.new({ items: entries });
    await menu.popup();
  };

  const scaleAt = (i: number) => {
    if (mouseX === null || scale === 1) return 1;
    const d = Math.abs(mouseX - (i * slot + slot / 2));
    return 1 + (scale - 1) * Math.max(0, 1 - d / RANGE);
  };

  return (
    <div
      className="dock-apps"
      onMouseMove={(e) => setMouseX(e.clientX - e.currentTarget.getBoundingClientRect().left)}
      onMouseLeave={() => setMouseX(null)}
    >
      {items.map((item, i) => {
        const icon = config.iconOverrides[iconKey(item.path)] ?? iconFor(item.icons);
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
            <span className={"dock-dot" + (item.windows.length ? " on" : "")} />
          </button>
        );
      })}
    </div>
  );
}

/** A widget placed in the dock as a pill. */
function DockWidget({ entry, update }: { entry: DockEntry; update: Update }) {
  const [shared, , updateShared] = useWidgetConfig();
  const kind = entry.kind.slice("widget:".length);
  const Pill = PILLS[kind];
  const def = widgetByKind.get(kind);
  if (!Pill || !def || !shared) return null;
  const settings = { ...def.defaults, ...entry.settings };
  return (
    <Pill
      id={entry.id}
      settings={settings}
      setSettings={(patch: Record<string, unknown>) =>
        update((c) => ({
          ...c,
          dock: {
            ...c.dock,
            items: c.dock.items.map((e) => (e.id === entry.id ? { ...e, settings: { ...settings, ...patch } } : e)),
          },
        }))
      }
      shared={shared}
      updateShared={updateShared}
    />
  );
}

export function Dock() {
  const [config, update] = useConfig();
  const [windows, setWindows] = useState<WindowInfo[]>([]);
  const dockRef = useRef<HTMLDivElement>(null);
  const [contentWidth, setContentWidth] = useState(0);

  useEffect(() => poll(api.windows, 1000, setWindows), []);

  // Measure the strip so a floating dock hugs its contents.
  useLayoutEffect(() => {
    const el = dockRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setContentWidth(Math.ceil(el.scrollWidth)));
    ro.observe(el);
    for (const child of Array.from(el.children)) ro.observe(child);
    return () => ro.disconnect();
  });

  // Drop .exe / .lnk files onto the dock to pin them.
  useEffect(() => {
    const unlisten = getCurrentWebview().onDragDropEvent((e) => {
      if (e.payload.type !== "drop") return;
      const dropped = e.payload.paths;
      update((c) => ({
        ...c,
        pinned: [
          ...c.pinned,
          ...dropped.filter((p) => !c.pinned.some((x) => samePath(x.path, p))).map((p) => ({ name: exeName(p), path: p })),
        ],
      }));
    });
    return () => {
      unlisten.then((f) => f());
    };
  }, [update]);

  const d = config?.dock;
  const size = d?.iconSize ?? 48;
  const scale = d?.magnify ? d.magnifyScale : 1;
  const strip = size + 20;
  const headroom = size * (scale - 1) + 34; // magnified icon + tooltip
  const full = d?.style === "full";
  const winHeight = Math.ceil(strip + headroom + (full ? 0 : 6));
  const winWidth = Math.max(contentWidth + 2 + 2 * (24 + (size * (scale - 1)) / 2), 200);

  useEffect(() => {
    if (!d || !contentWidth) return;
    api
      .layoutDock({
        width: winWidth,
        height: winHeight,
        strip,
        position: d.position,
        style: d.style,
        reserveSpace: d.reserveSpace,
      })
      .catch(console.error);
  }, [winWidth, winHeight, strip, d?.position, d?.style, d?.reserveSpace, contentWidth > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  // ---------- edit mode: drag to reorder, − to remove, + to add ----------

  const [editing, setEditing] = useState(false);
  const [drag, setDrag] = useState<{ id: string; startX: number; dx: number } | null>(null);
  const [update_, setUpdate] = useState<string | null>(null);

  // The settings window owns the updater; it tells the dock when there's something to install.
  useEffect(() => {
    const off = listen<{ version: string }>("update-available", (e) => setUpdate(e.payload.version));
    return () => {
      off.then((f) => f());
    };
  }, []);

  const reorder = (id: string, clientX: number) => {
    const els = Array.from(dockRef.current?.querySelectorAll<HTMLElement>("[data-entry]") ?? []);
    const others = els.filter((el) => el.dataset.entry !== id);
    let index = others.findIndex((el) => {
      const r = el.getBoundingClientRect();
      return clientX < r.left + r.width / 2;
    });
    if (index < 0) index = others.length;
    update((c) => {
      const items = [...c.dock.items];
      const from = items.findIndex((e) => e.id === id);
      if (from < 0) return c;
      const [moved] = items.splice(from, 1);
      const anchorId = others[index]?.dataset.entry;
      const to = anchorId ? items.findIndex((e) => e.id === anchorId) : items.length;
      items.splice(to < 0 ? items.length : to, 0, moved);
      return { ...c, dock: { ...c.dock, items } };
    });
  };

  const remove = (id: string) =>
    update((c) => ({ ...c, dock: { ...c.dock, items: c.dock.items.filter((e) => e.id !== id) } }));

  // ---------- drag an empty spot to snap the dock to the top or bottom ----------

  const snap = useRef<{ y: number } | null>(null);
  const onDockPointerDown = (e: React.PointerEvent) => {
    const target = e.target as HTMLElement;
    const empty = target === e.currentTarget || target.classList.contains("dock-items") || target.classList.contains("dock-spacer");
    if (!empty || e.button !== 0) return;
    snap.current = { y: e.screenY };
    e.currentTarget.setPointerCapture(e.pointerId);
  };
  const onDockPointerUp = (e: React.PointerEvent) => {
    const s = snap.current;
    snap.current = null;
    if (!s || Math.abs(e.screenY - s.y) < 40) return;
    const position = e.screenY < window.screen.height / 2 ? "top" : "bottom";
    update((c) => (c.dock.position === position ? c : { ...c, dock: { ...c.dock, position } }));
  };

  const onDockMenu = async (e: React.MouseEvent) => {
    e.preventDefault();
    const on = await isEnabled();
    const menu = await Menu.new({
      items: [
        { text: editing ? "Done editing" : "Edit dock (add, remove, reorder)", action: () => setEditing(!editing) },
        { text: "Widgets…", action: () => api.toggleWidgets() },
        { text: "Settings…", action: () => api.openSettings() },
        { text: on ? "✓ Start with Windows" : "Start with Windows", action: () => (on ? disable() : enable()) },
      ],
    });
    await menu.popup();
  };

  const openCard = (kind: string, id: string, el: HTMLElement) => {
    const r = el.getBoundingClientRect();
    api.openCard(kind, id, { x: r.left, y: r.top, width: r.width, height: r.height }).catch(console.error);
  };

  if (!config || !d) return null;

  const render = (entry: DockEntry) => {
    switch (entry.kind) {
      case "apps":
        return <AppsGroup config={config} update={update} windows={windows} />;
      case "separator":
        return <span className="dock-sep" />;
      case "spacer":
        return null;
      case "panel":
        return <PanelButtonPill />;
      default:
        return entry.kind.startsWith("widget:") ? <DockWidget entry={entry} update={update} /> : null;
    }
  };

  return (
    <div
      className={`dock-stage dock-${d.position} dock-${d.style}` + (editing ? " dock-editing" : "")}
      style={
        {
          "--icon": `${size}px`,
          "--slot": `${size + 12}px`,
          "--strip": `${strip}px`,
          "--gap": `${config.appearance.spacing}px`,
        } as CSSProperties
      }
    >
      <div className="dock has-backdrop" onContextMenu={onDockMenu} onPointerDown={onDockPointerDown} onPointerUp={onDockPointerUp}>
        <Backdrop />
        <div className="dock-items" ref={dockRef}>
          {d.items.map((entry) => {
            const isWidget = entry.kind.startsWith("widget:");
            const dragging = drag?.id === entry.id;
            return (
              <div
                key={entry.id}
                data-entry={entry.id}
                className={"dock-entry" + (entry.kind === "spacer" ? " dock-spacer" : "") + (dragging ? " dragging" : "")}
                style={dragging ? { transform: `translateX(${drag.dx}px)` } : undefined}
                onClick={(e) => {
                  if (!editing && isWidget) openCard(entry.kind.slice(7), entry.id, e.currentTarget);
                }}
                onPointerDown={(e) => {
                  if (!editing || e.button !== 0) return;
                  e.stopPropagation();
                  e.currentTarget.setPointerCapture(e.pointerId);
                  setDrag({ id: entry.id, startX: e.clientX, dx: 0 });
                }}
                onPointerMove={(e) => drag?.id === entry.id && setDrag({ ...drag, dx: e.clientX - drag.startX })}
                onPointerUp={(e) => {
                  if (drag?.id !== entry.id) return;
                  if (Math.abs(drag.dx) > 6) reorder(entry.id, e.clientX);
                  setDrag(null);
                }}
              >
                {render(entry)}
                {editing && entry.kind !== "apps" && (
                  <button
                    className="dock-remove"
                    aria-label="Remove from dock"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      remove(entry.id);
                    }}
                  >
                    −
                  </button>
                )}
              </div>
            );
          })}
          {update_ && (
            <button className="pill pill-click pill-update" title={`Install Harbor ${update_}`} onClick={() => emit("install-update")}>
              ⬆ Update
            </button>
          )}
          {editing && (
            <>
              <button className="pill pill-click dock-add" title="Add a widget" onClick={(e) => openCard("picker", "picker", e.currentTarget)}>
                ＋
              </button>
              <button className="pill pill-click dock-done" onClick={() => setEditing(false)}>
                Done
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
