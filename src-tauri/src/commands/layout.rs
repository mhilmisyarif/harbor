//! Window placement: the top menu bar, the dock strip (bottom or top, floating
//! or full width, optionally reserving screen space) and the widget panel.

use std::sync::atomic::{AtomicIsize, Ordering};
use tauri::{AppHandle, Emitter, Manager, PhysicalPosition, PhysicalSize};
use windows::Win32::Foundation::{HWND, RECT};
use windows::Win32::UI::WindowsAndMessaging::{
    SetWindowPos, HWND_TOPMOST, SWP_NOACTIVATE, SWP_NOMOVE, SWP_NOSIZE,
};

use super::{
    appbar::{self, Edge},
    apps::{DockPosition, DockStyle},
    err, CmdResult,
};

pub const BAR_HEIGHT: f64 = 30.0;
/// Initial dock height; the dock recomputes it from its contents via `layout_dock`.
pub const DOCK_HEIGHT: f64 = 140.0;
const DOCK_MARGIN: f64 = 6.0;

static BAR_HWND: AtomicIsize = AtomicIsize::new(0);
static DOCK_HWND: AtomicIsize = AtomicIsize::new(0);

fn monitor_rect(mon: &tauri::Monitor) -> RECT {
    let p = mon.position();
    let s = mon.size();
    RECT {
        left: p.x,
        top: p.y,
        right: p.x + s.width as i32,
        bottom: p.y + s.height as i32,
    }
}

/// Tauri links its own `windows` crate version; the raw window pointer is the same.
fn raw_hwnd(w: &tauri::WebviewWindow) -> tauri::Result<HWND> {
    Ok(HWND(w.hwnd()?.0))
}

// ---------- menu bar ----------

pub fn place_bar(app: &AppHandle) -> tauri::Result<()> {
    let Some(w) = app.get_webview_window("bar") else {
        return Ok(());
    };
    let Some(mon) = w.primary_monitor()? else {
        return Ok(());
    };
    let h = (BAR_HEIGHT * mon.scale_factor()).round() as i32;
    let hwnd = raw_hwnd(&w)?;
    BAR_HWND.store(hwnd.0 as isize, Ordering::SeqCst);
    let rc = appbar::register(hwnd, Edge::Top, monitor_rect(&mon), h);

    w.set_position(PhysicalPosition::new(rc.left, rc.top))?;
    w.set_size(PhysicalSize::new((rc.right - rc.left) as u32, h as u32))?;
    w.show()?;
    Ok(())
}

/// Gives the bar's reserved strip back to the shell.
pub fn release_bar() {
    let raw = BAR_HWND.swap(0, Ordering::SeqCst);
    if raw != 0 {
        appbar::unregister(HWND(raw as *mut _));
    }
}

fn release_dock() {
    let raw = DOCK_HWND.swap(0, Ordering::SeqCst);
    if raw != 0 {
        appbar::unregister(HWND(raw as *mut _));
    }
}

/// Everything Harbor reserved; call before exiting.
pub fn release_all() {
    release_bar();
    release_dock();
}

#[tauri::command]
pub fn set_bar_enabled(app: AppHandle, enabled: bool) -> CmdResult<()> {
    if enabled {
        place_bar(&app).map_err(err)
    } else {
        release_bar();
        match app.get_webview_window("bar") {
            Some(w) => w.hide().map_err(err),
            None => Ok(()),
        }
    }
}

// ---------- dock ----------

/// Logical-pixel geometry the dock reports from its rendered contents.
#[derive(serde::Deserialize, Clone, Copy, Debug)]
#[serde(rename_all = "camelCase")]
pub struct DockGeometry {
    /// Window width for a floating dock (ignored for full width).
    pub width: f64,
    /// Whole window height: the strip plus headroom for magnified icons/tooltips.
    pub height: f64,
    /// Height of the visible strip itself (what a full-width dock reserves).
    pub strip: f64,
    pub position: DockPosition,
    pub style: DockStyle,
    pub reserve_space: bool,
}

impl DockGeometry {
    pub fn initial() -> Self {
        Self {
            width: 480.0,
            height: DOCK_HEIGHT,
            strip: 76.0,
            position: DockPosition::Bottom,
            style: DockStyle::Floating,
            reserve_space: false,
        }
    }
}

/// `show` is only set at startup, so a relayout never re-shows a dock the user hid (Alt+D).
pub fn place_dock(app: &AppHandle, g: DockGeometry, show: bool) -> tauri::Result<()> {
    let Some(w) = app.get_webview_window("dock") else {
        return Ok(());
    };
    let Some(mon) = w.primary_monitor()? else {
        return Ok(());
    };
    let scale = mon.scale_factor();
    let px = |v: f64| (v * scale).round() as i32;
    let h_px = px(g.height);
    let mon_rc = monitor_rect(&mon);
    let reserve = g.style == DockStyle::Full && g.reserve_space;

    let (x, y, w_px) = if reserve {
        // Full width, reserving the strip like the taskbar does.
        let hwnd = raw_hwnd(&w)?;
        DOCK_HWND.store(hwnd.0 as isize, Ordering::SeqCst);
        let edge = if g.position == DockPosition::Top {
            Edge::Top
        } else {
            Edge::Bottom
        };
        let rc = appbar::register(hwnd, edge, mon_rc, px(g.strip));
        let y = if edge == Edge::Top {
            rc.top
        } else {
            rc.bottom - h_px
        };
        (rc.left, y, rc.right - rc.left)
    } else {
        release_dock();
        let wa = mon.work_area();
        let (wa_x, wa_y) = (wa.position.x, wa.position.y);
        let (wa_w, wa_h) = (wa.size.width as i32, wa.size.height as i32);
        let margin = if g.style == DockStyle::Full {
            0
        } else {
            px(DOCK_MARGIN)
        };
        let w_px = if g.style == DockStyle::Full {
            wa_w
        } else {
            px(g.width).min(wa_w)
        };
        let x = wa_x + (wa_w - w_px) / 2;
        let y = if g.position == DockPosition::Top {
            wa_y + margin
        } else {
            wa_y + wa_h - h_px - margin
        };
        (x, y, w_px)
    };

    w.set_size(PhysicalSize::new(w_px.max(1) as u32, h_px.max(1) as u32))?;
    w.set_position(PhysicalPosition::new(x, y))?;
    if show {
        w.show()?;
    }
    Ok(())
}

/// Called by the dock whenever its contents, size, position or style change.
#[tauri::command]
pub fn layout_dock(app: AppHandle, geometry: DockGeometry) -> CmdResult<()> {
    let g = DockGeometry {
        width: geometry.width.clamp(120.0, 8000.0),
        height: geometry.height.clamp(40.0, 400.0),
        strip: geometry.strip.clamp(24.0, 200.0),
        ..geometry
    };
    place_dock(&app, g, false).map_err(err)
}

// ---------- widget panel ----------

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

/// Bar/dock button: opens the panel at the right edge of the work area, or closes it.
#[tauri::command]
pub fn toggle_widgets(app: AppHandle) -> CmdResult<()> {
    let Some(w) = app.get_webview_window("widgets") else {
        return Ok(());
    };
    if w.is_visible().map_err(err)? {
        return w.hide().map_err(err);
    }
    // Clicking the button blurs the open panel (which hides it) right before
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
    let wa = mon.work_area();
    let gap = (8.0 * scale) as i32;
    let w_px = (WIDGETS_W * scale).round() as i32;
    let h_px = ((WIDGETS_H * scale).round() as i32).min(wa.size.height as i32 - 2 * gap);
    let x = wa.position.x + wa.size.width as i32 - w_px - gap;
    let y = wa.position.y + gap;

    w.set_size(PhysicalSize::new(w_px as u32, h_px as u32))
        .map_err(err)?;
    w.set_position(PhysicalPosition::new(x, y)).map_err(err)?;
    w.show().map_err(err)?;
    w.set_focus().map_err(err)
}

// ---------- widget cards ----------

/// A rectangle in the calling window's CSS pixels (from getBoundingClientRect).
#[derive(serde::Deserialize, Clone, Copy, Debug)]
pub struct ClientRect {
    pub x: f64,
    pub y: f64,
    pub width: f64,
    pub height: f64,
}

#[derive(serde::Deserialize, serde::Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CardRequest {
    /// What to show: a widget kind, or `picker` for the widget picker.
    pub kind: String,
    /// Dock entry the card belongs to (its settings live there).
    pub entry_id: String,
}

#[derive(serde::Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct CardOpen {
    kind: String,
    entry_id: String,
    /// True when the card opens upward (dock at the bottom).
    up: bool,
}

struct CardState {
    entry_id: String,
    anchor: RECT,
    up: bool,
}

static CARD: std::sync::Mutex<Option<CardState>> = std::sync::Mutex::new(None);
static CARD_HIDDEN: std::sync::Mutex<Option<(std::time::Instant, String)>> =
    std::sync::Mutex::new(None);
const CARD_GAP: f64 = 8.0;

/// Called when the card loses focus and hides itself.
pub fn note_card_hidden() {
    let id = CARD
        .lock()
        .ok()
        .and_then(|c| c.as_ref().map(|s| s.entry_id.clone()));
    if let (Ok(mut h), Some(id)) = (CARD_HIDDEN.lock(), id) {
        *h = Some((std::time::Instant::now(), id));
    }
}

/// A dock pill was clicked: remember where it is and ask the card window to
/// render; it calls `place_card` once it knows its size. Clicking the same
/// pill again closes the card.
#[tauri::command]
pub fn open_card(
    app: AppHandle,
    window: tauri::WebviewWindow,
    card: CardRequest,
    rect: ClientRect,
) -> CmdResult<()> {
    let Some(card_win) = app.get_webview_window("card") else {
        return Ok(());
    };
    let same = CARD
        .lock()
        .ok()
        .and_then(|c| c.as_ref().map(|s| s.entry_id == card.entry_id))
        .unwrap_or(false);
    if card_win.is_visible().map_err(err)? {
        card_win.hide().map_err(err)?;
        if same {
            return Ok(());
        }
    }
    // The click that opened this toggle blurred (and hid) the card a moment ago.
    let just_closed = CARD_HIDDEN
        .lock()
        .ok()
        .and_then(|h| h.clone())
        .is_some_and(|(at, id)| id == card.entry_id && at.elapsed().as_millis() < 300);
    if just_closed {
        return Ok(());
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
    if let Ok(mut c) = CARD.lock() {
        *c = Some(CardState {
            entry_id: card.entry_id.clone(),
            anchor,
            up,
        });
    }
    app.emit_to(
        tauri::EventTarget::webview_window("card"),
        "card-open",
        CardOpen {
            kind: card.kind,
            entry_id: card.entry_id,
            up,
        },
    )
    .map_err(err)
}

/// The card rendered at `width`×`height` CSS px: position it over its pill and show it.
#[tauri::command]
pub fn place_card(app: AppHandle, width: f64, height: f64) -> CmdResult<()> {
    let Some(w) = app.get_webview_window("card") else {
        return Ok(());
    };
    let Some((anchor, up)) = CARD
        .lock()
        .ok()
        .and_then(|c| c.as_ref().map(|s| (s.anchor, s.up)))
    else {
        return Ok(());
    };
    let cx = (anchor.left + anchor.right) / 2;
    let cy = (anchor.top + anchor.bottom) / 2;
    let Some(mon) = app
        .monitor_from_point(cx as f64, cy as f64)
        .map_err(err)?
        .or(w.primary_monitor().map_err(err)?)
    else {
        return Ok(());
    };
    let scale = mon.scale_factor();
    let (w_px, h_px) = (
        (width.clamp(120.0, 900.0) * scale) as i32,
        (height.clamp(60.0, 1000.0) * scale) as i32,
    );
    let gap = (CARD_GAP * scale) as i32;
    let p = mon.position();
    let s = mon.size();
    let (left, top, right, bottom) = (p.x, p.y, p.x + s.width as i32, p.y + s.height as i32);
    let x = (cx - w_px / 2).clamp(left + gap, (right - w_px - gap).max(left + gap));
    let y = if up {
        anchor.top - h_px - gap
    } else {
        anchor.bottom + gap
    };
    let y = y.clamp(top + gap, (bottom - h_px - gap).max(top + gap));

    w.set_size(PhysicalSize::new(w_px as u32, h_px as u32))
        .map_err(err)?;
    w.set_position(PhysicalPosition::new(x, y)).map_err(err)?;
    w.show().map_err(err)?;
    w.set_focus().map_err(err)
}

#[tauri::command]
pub fn close_card(app: AppHandle) -> CmdResult<()> {
    match app.get_webview_window("card") {
        Some(w) => w.hide().map_err(err),
        None => Ok(()),
    }
}

// ---------- notch ----------

/// The notch rendered at `width`×`height` CSS px: pin it to the top centre of
/// the primary monitor (over the menu bar) and show it.
#[tauri::command]
pub fn place_notch(app: AppHandle, width: f64, height: f64) -> CmdResult<()> {
    let Some(w) = app.get_webview_window("notch") else {
        return Ok(());
    };
    let Some(mon) = w.primary_monitor().map_err(err)? else {
        return Ok(());
    };
    let scale = mon.scale_factor();
    let w_px = (width.clamp(80.0, 900.0) * scale).round() as i32;
    let h_px = (height.clamp(16.0, 900.0) * scale).round() as i32;
    let rc = monitor_rect(&mon);
    let x = rc.left + (rc.right - rc.left - w_px) / 2;
    let hwnd = raw_hwnd(&w).map_err(err)?;
    // One call moves, resizes and raises it, so it never flashes off-centre.
    unsafe { SetWindowPos(hwnd, HWND_TOPMOST, x, rc.top, w_px, h_px, SWP_NOACTIVATE) }
        .map_err(err)?;
    let fullscreen = super::system_controls::FULLSCREEN.load(std::sync::atomic::Ordering::SeqCst);
    if !fullscreen && !w.is_visible().map_err(err)? {
        w.show().map_err(err)?;
    }
    Ok(())
}

/// Keeps the notch above the bar and dock after either is clicked (all three are topmost).
pub fn raise_notch(app: &AppHandle) {
    let Some(w) = app.get_webview_window("notch") else {
        return;
    };
    if let Ok(hwnd) = raw_hwnd(&w) {
        let flags = SWP_NOMOVE | SWP_NOSIZE | SWP_NOACTIVATE;
        let _ = unsafe { SetWindowPos(hwnd, HWND_TOPMOST, 0, 0, 0, 0, flags) };
    }
}

// ---------- settings window ----------

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
