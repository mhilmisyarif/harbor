//! Enumerates taskbar-style top-level windows and switches between them.

use serde::Serialize;
use std::ffi::c_void;
use std::mem::size_of;
use windows::{
    core::PWSTR,
    Win32::{
        Foundation::{CloseHandle, BOOL, HWND, LPARAM, TRUE, WPARAM},
        Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED},
        System::Threading::{
            OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
            PROCESS_QUERY_LIMITED_INFORMATION,
        },
        UI::WindowsAndMessaging::{
            EnumWindows, GetForegroundWindow, GetWindow, GetWindowLongPtrW, GetWindowTextLengthW,
            GetWindowTextW, GetWindowThreadProcessId, IsIconic, IsWindowVisible, PostMessageW,
            SetForegroundWindow, ShowWindow, GWL_EXSTYLE, GW_OWNER, SW_MINIMIZE, SW_RESTORE,
            WM_CLOSE, WS_EX_APPWINDOW, WS_EX_TOOLWINDOW,
        },
    },
};

use super::{err, CmdResult};

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WindowInfo {
    /// HWND as an integer; stable for the lifetime of the window.
    id: isize,
    title: String,
    exe: String,
    focused: bool,
    minimized: bool,
}

fn hwnd(id: isize) -> HWND {
    HWND(id as *mut c_void)
}

pub fn window_title(h: HWND) -> String {
    unsafe {
        let len = GetWindowTextLengthW(h);
        if len <= 0 {
            return String::new();
        }
        let mut buf = vec![0u16; len as usize + 1];
        let n = GetWindowTextW(h, &mut buf);
        String::from_utf16_lossy(&buf[..n.max(0) as usize])
    }
}

fn process_path(pid: u32) -> Option<String> {
    unsafe {
        let handle = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, BOOL(0), pid).ok()?;
        let mut buf = [0u16; 1024];
        let mut size = buf.len() as u32;
        let ok = QueryFullProcessImageNameW(
            handle,
            PROCESS_NAME_WIN32,
            PWSTR(buf.as_mut_ptr()),
            &mut size,
        );
        let _ = CloseHandle(handle);
        ok.ok()?;
        Some(String::from_utf16_lossy(&buf[..size as usize]))
    }
}

/// Mirrors the taskbar's rules: visible, unowned, not a tool window, not cloaked
/// (cloaked = hidden UWP frames or windows on other virtual desktops).
fn is_taskbar_window(h: HWND) -> bool {
    unsafe {
        if !IsWindowVisible(h).as_bool() {
            return false;
        }
        let ex = GetWindowLongPtrW(h, GWL_EXSTYLE) as u32;
        let owned = GetWindow(h, GW_OWNER)
            .map(|o| !o.0.is_null())
            .unwrap_or(false);
        if ex & WS_EX_TOOLWINDOW.0 != 0 {
            return false;
        }
        if owned && ex & WS_EX_APPWINDOW.0 == 0 {
            return false;
        }
        let mut cloaked: u32 = 0;
        let cloak_ok = DwmGetWindowAttribute(
            h,
            DWMWA_CLOAKED,
            &mut cloaked as *mut u32 as *mut c_void,
            size_of::<u32>() as u32,
        );
        if cloak_ok.is_ok() && cloaked != 0 {
            return false;
        }
        GetWindowTextLengthW(h) > 0
    }
}

unsafe extern "system" fn collect(h: HWND, lparam: LPARAM) -> BOOL {
    let out = &mut *(lparam.0 as *mut Vec<HWND>);
    if is_taskbar_window(h) {
        out.push(h);
    }
    TRUE
}

#[tauri::command]
pub fn list_windows() -> Vec<WindowInfo> {
    let mut handles: Vec<HWND> = Vec::new();
    unsafe {
        let _ = EnumWindows(Some(collect), LPARAM(&mut handles as *mut _ as isize));
    }
    let own_pid = std::process::id();
    let fg = unsafe { GetForegroundWindow() };

    handles
        .into_iter()
        .filter_map(|h| {
            let mut pid = 0u32;
            unsafe { GetWindowThreadProcessId(h, Some(&mut pid)) };
            if pid == own_pid {
                return None;
            }
            Some(WindowInfo {
                id: h.0 as isize,
                title: window_title(h),
                exe: process_path(pid).unwrap_or_default(),
                focused: h == fg,
                minimized: unsafe { IsIconic(h) }.as_bool(),
            })
        })
        .collect()
}

/// Dock click: restore + focus, or minimize if it is already in front.
#[tauri::command]
pub fn activate_window(id: isize) -> CmdResult<()> {
    let h = hwnd(id);
    unsafe {
        if GetForegroundWindow() == h && !IsIconic(h).as_bool() {
            let _ = ShowWindow(h, SW_MINIMIZE);
            return Ok(());
        }
        if IsIconic(h).as_bool() {
            let _ = ShowWindow(h, SW_RESTORE);
        }
        let _ = SetForegroundWindow(h);
    }
    Ok(())
}

#[tauri::command]
pub fn close_window(id: isize) -> CmdResult<()> {
    unsafe { PostMessageW(hwnd(id), WM_CLOSE, WPARAM(0), LPARAM(0)) }.map_err(err)
}

/// Title of the window the user is working in, for the bar.
#[tauri::command]
pub fn foreground_title() -> String {
    let h = unsafe { GetForegroundWindow() };
    if h.0.is_null() {
        return String::new();
    }
    let mut pid = 0u32;
    unsafe { GetWindowThreadProcessId(h, Some(&mut pid)) };
    if pid == std::process::id() {
        return String::new();
    }
    window_title(h)
}
