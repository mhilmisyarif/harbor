// Live window previews: when you hover a running app on the dock, this window
// slides over the icon with one slot per window. The backend draws a DWM
// thumbnail of each window into its slot; we only lay out the frames, titles
// and buttons around them.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import { api, PreviewOpen, PreviewSlot, WindowInfo } from "../lib/api";
import { Backdrop } from "../lib/Backdrop";

/** Tells the dock whether the pointer is over the preview, so it doesn't hide it. */
export const PREVIEW_HOVER_EVENT = "preview-hover";

const THUMB_W = 200;
const THUMB_H = 124;
const MAX_COLS = 4;

export function Preview() {
  const [req, setReq] = useState<(PreviewOpen & { n: number }) | null>(null);
  const [windows, setWindows] = useState<WindowInfo[]>([]);
  const [closed, setClosed] = useState<number[]>([]);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let n = 0;
    const off = listen<PreviewOpen>("preview-open", (e) => {
      setClosed([]);
      setReq({ ...e.payload, n: ++n });
      api.windows().then(setWindows).catch(console.error);
    });
    return () => {
      off.then((f) => f());
    };
  }, []);

  const ids = (req?.ids ?? []).filter((id) => !closed.includes(id));
  const titleOf = (id: number) => windows.find((w) => w.id === id)?.title || "Window";

  // Once laid out, report each thumbnail frame so the backend can draw into it.
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || !req) return;
    if (ids.length === 0) {
      api.hidePreview().catch(console.error);
      return;
    }
    const slots: PreviewSlot[] = Array.from(el.querySelectorAll<HTMLElement>("[data-thumb]")).map((t) => {
      const r = t.getBoundingClientRect();
      return { id: Number(t.dataset.thumb), x: r.left, y: r.top, width: r.width, height: r.height };
    });
    const box = el.getBoundingClientRect();
    api.placePreview(Math.ceil(box.width), Math.ceil(box.height), slots).catch(console.error);
  }, [req?.n, ids.join(","), windows.length > 0]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!req || ids.length === 0) return null;

  const done = () => {
    emit(PREVIEW_HOVER_EVENT, false);
    api.hidePreview().catch(console.error);
  };

  return (
    <div
      ref={ref}
      className={`preview has-backdrop ${req.up ? "preview-up" : "preview-down"}`}
      style={{ gridTemplateColumns: `repeat(${Math.min(ids.length, MAX_COLS)}, ${THUMB_W}px)` }}
      onMouseEnter={() => emit(PREVIEW_HOVER_EVENT, true)}
      onMouseLeave={done}
    >
      <Backdrop />
      {ids.map((id) => (
        <div
          key={id}
          className="preview-slot"
          onClick={() => {
            api.activate(id).catch(console.error);
            done();
          }}
        >
          <div className="preview-head">
            <span className="preview-title" title={titleOf(id)}>
              {titleOf(id)}
            </span>
            <button
              className="preview-close"
              title="Close window"
              onClick={(e) => {
                e.stopPropagation();
                api.close(id).catch(console.error);
                setClosed((c) => [...c, id]);
              }}
            >
              ✕
            </button>
          </div>
          <div className="preview-thumb" data-thumb={id} style={{ width: THUMB_W, height: THUMB_H }} />
        </div>
      ))}
    </div>
  );
}
