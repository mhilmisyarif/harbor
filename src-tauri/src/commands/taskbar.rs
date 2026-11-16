//! Hides the Windows taskbar while Harbor's dock replaces it, and always puts
//! it back: on "Quit", when the option is turned off, and on the next launch if
//! Harbor was killed while it was hidden.
//!
//! Hiding is two steps: switch the taskbar to auto-hide (so it stops reserving
//! screen space) and hide its windows. Explorer recreates the taskbar when it
//! restarts, so a watchdog re-hides it while the option is on.

use std::mem::size_of;
use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::Once;
use std::time::Duration;
use windows::{
    core::{w, PCWSTR},
    Win32::{
        Foundation::{HWND, LPARAM},
        UI::{
            Shell::{SHAppBarMessage, ABM_GETSTATE, ABM_SETSTATE, ABS_AUTOHIDE, APPBARDATA},
            WindowsAndMessaging::{
                FindWindowExW, FindWindowW, IsWindowVisible, ShowWindow, SW_HIDE, SW_SHOWNA,
            },
        },
    },
};

use super::CmdResult;

/// Survives a crash: the auto-hide state to restore on the next launch.
fn state_file() -> Option<std::path::PathBuf> {
    let base = std::env::var_os("LOCALAPPDATA")?;
    let dir = std::path::Path::new(&base).join("dev.harbor.shell");
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir.join("taskbar-state"))
}

fn save_original(state: u32) {
    if let Some(p) = state_file() {
        let _ = std::fs::write(p, state.to_string());
    }
}

fn take_saved_original() -> Option<u32> {
    let p = state_file()?;
    let s = std::fs::read_to_string(&p).ok()?.trim().parse().ok();
    let _ = std::fs::remove_file(p);
    s
}

static HIDDEN: AtomicBool = AtomicBool::new(false);
/// Taskbar auto-hide state before we changed it (u32::MAX = not captured).
static ORIGINAL_STATE: AtomicU32 = AtomicU32::new(u32::MAX);

/// Primary taskbar plus one per extra monitor.
fn taskbars() -> Vec<HWND> {
    let mut out = Vec::new();
    unsafe {
        if let Ok(h) = FindWindowW(w!("Shell_TrayWnd"), PCWSTR::null()) {
            if !h.0.is_null() {
                out.push(h);
            }
        }
        let mut prev = HWND(std::ptr::null_mut());
        while let Ok(h) = FindWindowExW(
            HWND(std::ptr::null_mut()),
            prev,
            w!("Shell_SecondaryTrayWnd"),
            PCWSTR::null(),
        ) {
            if h.0.is_null() {
                break;
            }
            out.push(h);
            prev = h;
        }
    }
    out
}

fn appbar_state(taskbar: HWND) -> u32 {
    let mut abd = APPBARDATA {
        cbSize: size_of::<APPBARDATA>() as u32,
        hWnd: taskbar,
        ..Default::default()
    };
    unsafe { SHAppBarMessage(ABM_GETSTATE, &mut abd) as u32 }
}

fn set_appbar_state(taskbar: HWND, state: u32) {
    let mut abd = APPBARDATA {
        cbSize: size_of::<APPBARDATA>() as u32,
        hWnd: taskbar,
        lParam: LPARAM(state as isize),
        ..Default::default()
    };
    unsafe { SHAppBarMessage(ABM_SETSTATE, &mut abd) };
}

fn apply(hide: bool) {
    let bars = taskbars();
    let Some(&primary) = bars.first() else { return };
    if hide {
        if ORIGINAL_STATE.load(Ordering::SeqCst) == u32::MAX {
            let state = appbar_state(primary);
            ORIGINAL_STATE.store(state, Ordering::SeqCst);
            save_original(state);
        }
        set_appbar_state(primary, ABS_AUTOHIDE);
        for h in bars {
            if unsafe { IsWindowVisible(h) }.as_bool() {
                let _ = unsafe { ShowWindow(h, SW_HIDE) };
            }
        }
    } else {
        let original = ORIGINAL_STATE.swap(u32::MAX, Ordering::SeqCst);
        let saved = take_saved_original();
        let original = if original != u32::MAX {
            Some(original)
        } else {
            saved
        };
        if let Some(state) = original {
            set_appbar_state(primary, state);
        }
        for h in bars {
            let _ = unsafe { ShowWindow(h, SW_SHOWNA) };
        }
    }
}

fn start_watchdog() {
    static START: Once = Once::new();
    START.call_once(|| {
        let _ = std::thread::Builder::new()
            .name("harbor-taskbar".into())
            .spawn(|| loop {
                std::thread::sleep(Duration::from_secs(3));
                if HIDDEN.load(Ordering::SeqCst) {
                    apply(true);
                }
            });
    });
}

#[tauri::command]
pub fn set_taskbar_hidden(hidden: bool) -> CmdResult<()> {
    if taskbars().is_empty() {
        return Err("couldn't find the Windows taskbar".into());
    }
    HIDDEN.store(hidden, Ordering::SeqCst);
    apply(hidden);
    if hidden {
        start_watchdog();
    }
    Ok(())
}

/// Called on quit, and at startup as a safety net in case a previous run was
/// killed while the taskbar was hidden.
pub fn restore() {
    HIDDEN.store(false, Ordering::SeqCst);
    for h in taskbars() {
        let _ = unsafe { ShowWindow(h, SW_SHOWNA) };
    }
    apply(false);
}
