// Wallpaper glass: renders the real desktop wallpaper behind a surface at the
// exact screen position it occupies, then CSS blurs and tints it (themes.css).
// Only drawn for the glass styles.
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { currentMonitor, getCurrentWindow } from "@tauri-apps/api/window";
import { api } from "./api";
import { useShared } from "../widgets/kit";

interface Screen {
  /** Window's top-left relative to its monitor, CSS px. */
  x: number;
  y: number;
  /** Monitor size: CSS px and physical px. */
  w: number;
  h: number;
  pw: number;
  ph: number;
}

function useWindowScreen(): Screen | null {
  const [s, setS] = useState<Screen | null>(null);
  useEffect(() => {
    const win = getCurrentWindow();
    let alive = true;
    const measure = async () => {
      const [pos, mon] = await Promise.all([win.innerPosition(), currentMonitor()]);
      if (!alive || !mon) return;
      const k = mon.scaleFactor;
      setS({
        x: (pos.x - mon.position.x) / k,
        y: (pos.y - mon.position.y) / k,
        w: mon.size.width / k,
        h: mon.size.height / k,
        pw: mon.size.width,
        ph: mon.size.height,
      });
    };
    measure();
    const offs = [win.onMoved(measure), win.onResized(measure), win.onFocusChanged(measure)];
    return () => {
      alive = false;
      offs.forEach((p) => p.then((f) => f()));
    };
  }, []);
  return s;
}

const isGlass = () => ["glass", "ios-glass"].includes(document.body.dataset.style ?? "");

/** Place as the first child of an element with class `has-backdrop`. */
export function Backdrop() {
  const ref = useRef<HTMLDivElement>(null);
  const screen = useWindowScreen();
  const glass = isGlass();
  const { data: url } = useShared(
    glass && screen ? `wallpaper:${screen.pw}x${screen.ph}` : null,
    () => api.desktopWallpaper(screen!.pw, screen!.ph),
    5 * 60_000, // picks up a changed wallpaper
  );
  const [offset, setOffset] = useState({ left: 0, top: 0 });

  // The backdrop's own position inside the window (it is inset -60px from its parent).
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const update = () => {
      const r = el.getBoundingClientRect();
      setOffset((o) => (o.left === r.left && o.top === r.top ? o : { left: r.left, top: r.top }));
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(el.parentElement ?? el);
    return () => ro.disconnect();
  });

  if (!glass) return null;
  return (
    <div
      ref={ref}
      className="backdrop"
      aria-hidden
      style={
        url && screen
          ? {
              backgroundImage: `url(${url})`,
              backgroundSize: `${screen.w}px ${screen.h}px`,
              backgroundPosition: `${-(screen.x + offset.left)}px ${-(screen.y + offset.top)}px`,
            }
          : undefined
      }
    />
  );
}
