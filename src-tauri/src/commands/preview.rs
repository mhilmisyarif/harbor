//! Live window previews on hover, like the taskbar's: DWM thumbnails of an
//! app's windows composited into Harbor's "preview" window, which is shown
//! without taking focus from the app you're working in.

use serde::{Deserialize, Serialize};
use std::ffi::c_void;
use std::sync::Mutex;
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize};
use windows::Win32::{
    Foundation::{BOOL, HWND, RECT},
    Graphics::Dwm::{
        DwmQueryThumbnailSourceSize, DwmRegisterThumbnail, DwmUnregisterThumbnail,
        DwmUpdateThumbnailProperties, DWM_THUMBNAIL_PROPERTIES, DWM_TNP_OPACITY,
        DWM_TNP_RECTDESTINATION, DWM_TNP_SOURCECLIENTAREAONLY, DWM_TNP_VISIBLE,
    },
    UI::WindowsAndMessaging::{IsWindow, ShowWindow, SW_HIDE, SW_SHOWNOACTIVATE},
};

use super::{err, layout::ClientRect, CmdResult};

struct State {
    anchor: RECT,
    up: bool,
    thumbs: Vec<isize>,
}

static STATE: Mutex<Option<State>> = Mutex::new(None);
const GAP: f64 = 8.0;

fn unregister_all(state: &mut State) {
    for t in state.thumbs.drain(..) {
        let _ = unsafe { DwmUnregisterThumbnail(t) };
    }
}

fn preview_hwnd(app: &AppHandle) -> Option<(tauri::WebviewWindow, HWND)> {
    let w = app.get_webview_window("preview")?;
    let h = HWND(w.hwnd().ok()?.0);
    Some((w, h))
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct PreviewOpen {
    ids: Vec<isize>,
    up: bool,
}

/// Dock hover: remember the icon's position and ask the preview window to lay
/// out slots for these windows; it answers with `place_preview`.
#[tauri::command]
pub fn show_preview(
    app: AppHandle,
    window: tauri::WebviewWindow,
    ids: Vec<isize>,
    rect: ClientRect,
) -> CmdResult<()> {
    let ids: Vec<isize> = ids
        .into_iter()
        .filter(|&id| unsafe { IsWindow(HWND(id as *mut c_void)) }.as_bool())
        .take(8)
        .collect();
    if ids.is_empty() {
        return hide_preview(app);
    }
    let scale = window.scale_factor().map_err(err)?;
    let origin = window.inner_position().map_err(err)?;
    let px = |v: f64| (v * scale).round() as i32;
    let anchor = RECT {
        left: origin.x + px(rect.x),
        top: origin.y + px(rect.y),
        right: origin.x + px(rect.x + rect.width),
        bottom: origin.y + px(rect.y + rect.height),
    };
    let mid = window
        .current_monitor()
        .map_err(err)?
        .map(|m| m.position().y + m.size().height as i32 / 2)
        .unwrap_or(i32::MAX);
    let up = (anchor.top + anchor.bottom) / 2 > mid;
    if let Ok(mut s) = STATE.lock() {
        if let Some(old) = s.as_mut() {
            unregister_all(old);
        }
        *s = Some(State {
            anchor,
            up,
            thumbs: Vec::new(),
        });
    }
    app.emit_to(
        tauri::EventTarget::webview_window("preview"),
        "preview-open",
        PreviewOpen { ids, up },
    )
    .map_err(err)
}

#[derive(Deserialize, Clone, Copy, Debug)]
pub struct Slot {
    pub id: isize,
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

/// Fits a `src` aspect ratio inside `dst`, centered.
fn fit(dst: RECT, src_w: i32, src_h: i32) -> RECT {
    let (dw, dh) = (dst.right - dst.left, dst.bottom - dst.top);
    if src_w <= 0 || src_h <= 0 || dw <= 0 || dh <= 0 {
        return dst;
    }
    let scale = (dw as f64 / src_w as f64).min(dh as f64 / src_h as f64);
    let (w, h) = ((src_w as f64 * scale) as i32, (src_h as f64 * scale) as i32);
    let (x, y) = (dst.left + (dw - w) / 2, dst.top + (dh - h) / 2);
    RECT {
        left: x,
        top: y,
        right: x + w,
        bottom: y + h,
    }
}

/// The preview laid out its slots (CSS px): size and place it over the icon,
/// register a DWM thumbnail per slot, and show it without activating it.
#[tauri::command]
pub fn place_preview(app: AppHandle, width: f64, height: f64, slots: Vec<Slot>) -> CmdResult<()> {
    let Some((w, hwnd)) = preview_hwnd(&app) else {
        return Ok(());
    };
    let mut guard = STATE.lock().map_err(err)?;
    let Some(state) = guard.as_mut() else {
        return Ok(());
    };
    unregister_all(state);

    let cx = (state.anchor.left + state.anchor.right) / 2;
    let cy = (state.anchor.top + state.anchor.bottom) / 2;
    let Some(mon) = app.monitor_from_point(cx as f64, cy as f64).map_err(err)? else {
        return Ok(());
    };
    let scale = mon.scale_factor();
    let px = |v: f64| (v * scale).round() as i32;
    let (w_px, h_px) = (px(width.clamp(80.0, 1600.0)), px(height.clamp(60.0, 600.0)));
    let (mp, ms) = (mon.position(), mon.size());
    let gap = px(GAP);
    let x = (cx - w_px / 2).clamp(
        mp.x + gap,
        (mp.x + ms.width as i32 - w_px - gap).max(mp.x + gap),
    );
    let y = if state.up {
        state.anchor.top - h_px - gap
    } else {
        state.anchor.bottom + gap
    };
    let y = y.clamp(
        mp.y + gap,
        (mp.y + ms.height as i32 - h_px - gap).max(mp.y + gap),
    );
    w.set_size(PhysicalSize::new(w_px as u32, h_px as u32))
        .map_err(err)?;
    w.set_position(PhysicalPosition::new(x, y)).map_err(err)?;

    for s in slots {
        let src = HWND(s.id as *mut c_void);
        let Ok(thumb) = (unsafe { DwmRegisterThumbnail(hwnd, src) }) else {
            continue;
        };
        let size = unsafe { DwmQueryThumbnailSourceSize(thumb) }.unwrap_or_default();
        let slot = RECT {
            left: px(s.x),
            top: px(s.y),
            right: px(s.x + s.width),
            bottom: px(s.y + s.height),
        };
        let props = DWM_THUMBNAIL_PROPERTIES {
            dwFlags: DWM_TNP_RECTDESTINATION
                | DWM_TNP_VISIBLE
                | DWM_TNP_OPACITY
                | DWM_TNP_SOURCECLIENTAREAONLY,
            rcDestination: fit(slot, size.cx, size.cy),
            opacity: 255,
            fVisible: BOOL::from(true),
            fSourceClientAreaOnly: BOOL::from(false),
            ..Default::default()
        };
        if unsafe { DwmUpdateThumbnailProperties(thumb, &props) }.is_ok() {
            state.thumbs.push(thumb);
        } else {
            let _ = unsafe { DwmUnregisterThumbnail(thumb) };
        }
    }
    // Show without stealing focus from the app the user is in.
    let _ = unsafe { ShowWindow(hwnd, SW_SHOWNOACTIVATE) };
    Ok(())
}

#[tauri::command]
pub fn hide_preview(app: AppHandle) -> CmdResult<()> {
    if let Ok(mut s) = STATE.lock() {
        if let Some(state) = s.as_mut() {
            unregister_all(state);
        }
        *s = None;
    }
    if let Some((_, hwnd)) = preview_hwnd(&app) {
        let _ = unsafe { ShowWindow(hwnd, SW_HIDE) };
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn fit_keeps_aspect_and_centers() {
        let slot = RECT {
            left: 0,
            top: 0,
            right: 200,
            bottom: 100,
        };
        // A 16:9 window into a 2:1 slot is height-bound.
        let r = fit(slot, 1600, 900);
        assert_eq!((r.right - r.left, r.bottom - r.top), (177, 100));
        assert_eq!(r.left, 11);
        // Degenerate source keeps the slot.
        assert_eq!(fit(slot, 0, 0).right, 200);
    }
}
