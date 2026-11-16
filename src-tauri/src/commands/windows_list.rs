//! Enumerates taskbar-style top-level windows and switches between them.

use serde::Serialize;
use std::ffi::c_void;
use std::mem::size_of;
use windows::{
    core::PWSTR,
    Win32::{
        Foundation::{CloseHandle, BOOL, HANDLE, HWND, LPARAM, TRUE, WPARAM},
        Graphics::Dwm::{DwmGetWindowAttribute, DWMWA_CLOAKED},
        Storage::{
            EnhancedStorage::PKEY_AppUserModel_ID, Packaging::Appx::GetApplicationUserModelId,
        },
        System::Com::{CoTaskMemFree, StructuredStorage::PropVariantToStringAlloc},
        System::Threading::{
            OpenProcess, QueryFullProcessImageNameW, PROCESS_NAME_WIN32,
            PROCESS_QUERY_LIMITED_INFORMATION,
        },
        UI::Shell::PropertiesSystem::{IPropertyStore, SHGetPropertyStoreForWindow},
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
    /// What the dock uses for the icon and for launching/pinning: the exe path,
    /// or `shell:AppsFolder\<AppUserModelID>` for packaged (Store) apps, whose
    /// exe under WindowsApps can't be launched directly.
    icon_source: String,
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

/// Executable path and (for packaged apps) AppUserModelID of a process.
pub(crate) fn process_info(pid: u32) -> (Option<String>, Option<String>) {
    unsafe {
        let Ok(handle) = OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, BOOL(0), pid) else {
            return (None, None);
        };
        let path = image_path(handle);
        let aumid = package_app_id(handle);
        let _ = CloseHandle(handle);
        (path, aumid)
    }
}

unsafe fn image_path(handle: HANDLE) -> Option<String> {
    let mut buf = [0u16; 1024];
    let mut size = buf.len() as u32;
    QueryFullProcessImageNameW(
        handle,
        PROCESS_NAME_WIN32,
        PWSTR(buf.as_mut_ptr()),
        &mut size,
    )
    .ok()?;
    Some(String::from_utf16_lossy(&buf[..size as usize]))
}

unsafe fn package_app_id(handle: HANDLE) -> Option<String> {
    let mut buf = [0u16; 256];
    let mut len = buf.len() as u32;
    // Returns APPMODEL_ERROR_NO_APPLICATION for ordinary (unpackaged) processes.
    if GetApplicationUserModelId(handle, &mut len, PWSTR(buf.as_mut_ptr())).0 != 0 {
        return None;
    }
    let s = String::from_utf16_lossy(&buf[..len.saturating_sub(1) as usize]);
    (!s.is_empty()).then_some(s)
}

/// Explicit AppUserModelID set on the window (PWAs, some desktop apps).
fn window_app_id(h: HWND) -> Option<String> {
    unsafe {
        let store: IPropertyStore = SHGetPropertyStoreForWindow(h).ok()?;
        let value = store.GetValue(&PKEY_AppUserModel_ID).ok()?;
        let text = PropVariantToStringAlloc(&value).ok()?;
        let s = text.to_string().ok();
        CoTaskMemFree(Some(text.0 as *const c_void));
        s.filter(|s| !s.is_empty())
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
            let (exe, package_id) = process_info(pid);
            let exe = exe.unwrap_or_default();
            let icon_source = window_app_id(h)
                .or(package_id)
                .map(|id| format!(r"shell:AppsFolder\{id}"))
                .unwrap_or_else(|| exe.clone());
            Some(WindowInfo {
                id: h.0 as isize,
                title: window_title(h),
                exe,
                icon_source,
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
    super::system_extra::note_foreground(h);
    window_title(h)
}
