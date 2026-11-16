// The widget panel: renders the saved layout, and in edit mode lets you add
// widgets from the gallery, reorder, configure and remove them.
import { useMemo, useState } from "react";
import { api, WidgetInstance } from "../lib/api";
import { useWidgetConfig } from "../lib/widgetConfig";
import { CATEGORIES, widgetByKind, WIDGETS, WidgetDef } from "./registry";

const newId = () => "w" + Math.random().toString(36).slice(2, 10);

export function Gallery({ onAdd, onClose, only }: {
  onAdd: (def: WidgetDef) => void;
  onClose: () => void;
  /** Limit to these kinds (e.g. widgets that have a dock pill). */
  only?: Set<string>;
}) {
  const [q, setQ] = useState("");
  const list = useMemo(() => {
    const s = q.trim().toLowerCase();
    const pool = only ? WIDGETS.filter((w) => only.has(w.kind)) : WIDGETS;
    return s ? pool.filter((w) => (w.name + " " + w.description + " " + w.category).toLowerCase().includes(s)) : pool;
  }, [q, only]);
  return (
    <div className="w-gallery">
      <div className="w-row w-gap">
        <input className="w-input" autoFocus placeholder={`Search ${list.length} widgets…`} value={q} onChange={(e) => setQ(e.target.value)} />
        <button className="w-btn" onClick={onClose}>
          Close
        </button>
      </div>
      {CATEGORIES.map((cat) => {
        const items = list.filter((w) => w.category === cat);
        if (!items.length) return null;
        return (
          <section key={cat}>
            <h3 className="w-gallery-cat">{cat}</h3>
            {items.map((w) => (
              <div key={w.kind} className="w-gallery-item">
                <div className="w-grow">
                  <b>{w.name}</b>
                  <div className="w-muted w-small">{w.description}</div>
                </div>
                <button className="w-btn w-primary" onClick={() => onAdd(w)}>
                  Add
                </button>
              </div>
            ))}
          </section>
        );
      })}
    </div>
  );
}

export function Widgets() {
  const [config, update, updateShared] = useWidgetConfig();
  const [editing, setEditing] = useState(false);
  const [gallery, setGallery] = useState(false);
  const [configuring, setConfiguring] = useState<string | null>(null);

  if (!config) return null;

  const setLayout = (fn: (l: WidgetInstance[]) => WidgetInstance[]) => update((c) => ({ ...c, layout: fn(c.layout) }));
  const move = (i: number, by: number) =>
    setLayout((l) => {
      const j = i + by;
      if (j < 0 || j >= l.length) return l;
      const next = [...l];
      [next[i], next[j]] = [next[j], next[i]];
      return next;
    });
  const add = (def: WidgetDef) => {
    const id = newId();
    setLayout((l) => [...l, { id, kind: def.kind, settings: { ...def.defaults } }]);
    setGallery(false);
    if (def.Settings) setConfiguring(id);
  };

  return (
    <div className="w-panel">
      <header className="w-panel-head">
        <b>Widgets</b>
        <div className="w-row w-gap">
          {editing && (
            <button className="w-btn w-primary" onClick={() => setGallery(true)}>
              + Add
            </button>
          )}
          <button className="w-btn" onClick={() => (setEditing(!editing), setConfiguring(null), setGallery(false))}>
            {editing ? "Done" : "Edit"}
          </button>
          <button className="w-btn" title="Harbor settings" onClick={() => api.openSettings()}>
            ⚙
          </button>
        </div>
      </header>

      {gallery ? (
        <Gallery onAdd={add} onClose={() => setGallery(false)} />
      ) : (
        <div className="w-grid">
          {config.layout.length === 0 && (
            <p className="w-muted w-empty">
              No widgets yet. Click <b>Edit</b>, then <b>+ Add</b>.
            </p>
          )}
          {config.layout.map((inst, i) => {
            const def = widgetByKind.get(inst.kind);
            if (!def) return null; // a widget removed in a newer version
            const settings = { ...def.defaults, ...inst.settings };
            const props = {
              id: inst.id,
              settings,
              setSettings: (patch: Record<string, unknown>) =>
                setLayout((l) => l.map((w) => (w.id === inst.id ? { ...w, settings: { ...settings, ...patch } } : w))),
              shared: config,
              updateShared,
            };
            const showSettings = editing && configuring === inst.id && def.Settings;
            return (
              <div key={inst.id} className={`w-cell w-${def.size}` + (editing ? " w-editing" : "")}>
                {editing && (
                  <div className="w-cell-bar">
                    <span className="w-small w-ellipsis">{def.name}</span>
                    <button className="w-x" title="Move earlier" disabled={i === 0} onClick={() => move(i, -1)}>
                      ↑
                    </button>
                    <button className="w-x" title="Move later" disabled={i === config.layout.length - 1} onClick={() => move(i, 1)}>
                      ↓
                    </button>
                    {def.Settings && (
                      <button className={"w-x" + (showSettings ? " on" : "")} title="Configure" onClick={() => setConfiguring(showSettings ? null : inst.id)}>
                        ⚙
                      </button>
                    )}
                    <button className="w-x" title="Remove" onClick={() => setLayout((l) => l.filter((w) => w.id !== inst.id))}>
                      ✕
                    </button>
                  </div>
                )}
                {showSettings && def.Settings ? (
                  <div className="w-tile">
                    <def.Settings {...props} />
                  </div>
                ) : (
                  <def.Component {...props} />
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
