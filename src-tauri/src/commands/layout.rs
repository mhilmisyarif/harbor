//! Positions the bar (top edge, reserved via appbar) and the dock (bottom, centered).

use std::sync::atomic::{AtomicIsize, Ordering};
use tauri::{AppHandle, Manager, PhysicalPosition, PhysicalSize};
use windows::Win32::Foundation::HWND;

use super::{appbar, err, CmdResult};

pub const BAR_HEIGHT: f64 = 30.0;
/// Initial dock height; the dock recomputes it from the icon size via `layout_dock`.
pub const DOCK_HEIGHT: f64 = 140.0;
const DOCK_MARGIN: f64 = 6.0;

static BAR_HWND: AtomicIsize = AtomicIsize::new(0);

pub fn place_bar(app: &AppHandle) -> tauri::Result<()> {
    let Some(w) = app.get_webview_window("bar") else {
        return Ok(());
    };
    let Some(mon) = w.primary_monitor()? else {
        return Ok(());
    };

    let pos = *mon.position();
    let size = *mon.size();
    let h = (BAR_HEIGHT * mon.scale_factor()).round() as i32;

    // Tauri links its own `windows` crate version; the raw pointer is the same.
    let hwnd = HWND(w.hwnd()?.0);
    BAR_HWND.store(hwnd.0 as isize, Ordering::SeqCst);
    let rc = appbar::register_top(hwnd, pos.x, pos.y, size.width as i32, h);

    w.set_position(PhysicalPosition::new(rc.left, rc.top))?;
    w.set_size(PhysicalSize::new((rc.right - rc.left) as u32, h as u32))?;
    w.show()?;
    Ok(())
}

/// Gives the reserved screen strip back to the shell. Call before exiting.
pub fn release_bar() {
    let raw = BAR_HWND.swap(0, Ordering::SeqCst);
    if raw != 0 {
        appbar::unregister(HWND(raw as *mut _));
    }
}

/// Sizes and centers the dock above the work area's bottom edge. `show` is only
/// set at startup, so a relayout never re-shows a dock the user hid (Alt+D).
pub fn place_dock(app: &AppHandle, width: f64, height: f64, show: bool) -> tauri::Result<()> {
    let Some(w) = app.get_webview_window("dock") else {
        return Ok(());
    };
    let Some(mon) = w.primary_monitor()? else {
        return Ok(());
    };

    let scale = mon.scale_factor();
    let wa = mon.work_area();
    let w_px = (width * scale).round() as i32;
    let h_px = (height * scale).round() as i32;
    let x = wa.position.x + (wa.size.width as i32 - w_px) / 2;
    let y = wa.position.y + wa.size.height as i32 - h_px - (DOCK_MARGIN * scale) as i32;

    w.set_size(PhysicalSize::new(w_px as u32, h_px as u32))?;
    w.set_position(PhysicalPosition::new(x, y))?;
    if show {
        w.show()?;
    }
    Ok(())
}

// ---------- Widget panel ----------

const WIDGETS_W: f64 = 420.0;
const WIDGETS_H: f64 = 780.0;

static WIDGETS_HIDDEN_AT: std::sync::Mutex<Option<std::time::Instant>> =
    std::sync::Mutex::new(None);

/// Called when the panel loses focus and hides itself.
pub fn note_widgets_hidden() {
    if let Ok(mut t) = WIDGETS_HIDDEN_AT.lock() {
        *t = Some(std::time::Instant::now());
    }
}

/// Bar button: opens the panel under the bar's right edge, or closes it.
#[tauri::command]
pub fn toggle_widgets(app: AppHandle) -> CmdResult<()> {
    let Some(w) = app.get_webview_window("widgets") else {
        return Ok(());
    };
    if w.is_visible().map_err(err)? {
        return w.hide().map_err(err);
    }
    // Clicking the bar button blurs the open panel (which hides it) right before
    // this runs; without this check that click would reopen it immediately.
    let just_hidden = WIDGETS_HIDDEN_AT
        .lock()
        .ok()
        .and_then(|t| *t)
        .is_some_and(|t| t.elapsed().as_millis() < 300);
    if just_hidden {
        return Ok(());
    }

    let Some(mon) = w.primary_monitor().map_err(err)? else {
        return Ok(());
    };
    let scale = mon.scale_factor();
    let pos = *mon.position();
    let size = *mon.size();
    let w_px = (WIDGETS_W * scale).round() as i32;
    let h_px = ((WIDGETS_H * scale).round() as i32).min(size.height as i32 - (60.0 * scale) as i32);
    let x = pos.x + size.width as i32 - w_px - (8.0 * scale) as i32;
    let y = pos.y + ((BAR_HEIGHT + 6.0) * scale) as i32;

    w.set_size(PhysicalSize::new(w_px as u32, h_px as u32))
        .map_err(err)?;
    w.set_position(PhysicalPosition::new(x, y)).map_err(err)?;
    w.show().map_err(err)?;
    w.set_focus().map_err(err)
}

/// Called by the dock whenever its item count or icon size changes.
#[tauri::command]
pub fn layout_dock(app: AppHandle, width: f64, height: f64) -> CmdResult<()> {
    let width = width.clamp(120.0, 4000.0);
    let height = height.clamp(60.0, 400.0);
    place_dock(&app, width, height, false).map_err(err)
}

/// Shows the settings window (tray, dock menu or widget panel).
pub fn show_settings(app: &AppHandle) -> tauri::Result<()> {
    let Some(w) = app.get_webview_window("settings") else {
        return Ok(());
    };
    if w.is_minimized()? {
        w.unminimize()?;
    }
    w.show()?;
    w.set_focus()
}

#[tauri::command]
pub fn open_settings(app: AppHandle) -> CmdResult<()> {
    show_settings(&app).map_err(err)
}
