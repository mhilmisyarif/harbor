//! Local-PC widget backends: top processes, light/dark theme, shell shortcuts,
//! Recycle Bin and keyboard layout.

use serde::Serialize;
use std::collections::HashMap;
use std::ffi::c_void;
use std::mem::size_of;
use std::sync::atomic::{AtomicIsize, Ordering};
use sysinfo::{ProcessesToUpdate, System};
use tauri::State;
use windows::{
    core::{w, PCWSTR},
    Win32::{
        Foundation::{HWND, LPARAM, WPARAM},
        Globalization::{
            GetLocaleInfoEx, LCIDToLocaleName, LOCALE_SISO639LANGNAME, LOCALE_SLOCALIZEDDISPLAYNAME,
        },
        System::Registry::{
            RegGetValueW, RegSetKeyValueW, HKEY_CURRENT_USER, REG_DWORD, RRF_RT_REG_DWORD,
        },
        UI::{
            Input::KeyboardAndMouse::{GetKeyboardLayout, GetKeyboardLayoutList, HKL},
            Shell::{SHEmptyRecycleBinW, SHQueryRecycleBinW, SHQUERYRBINFO},
            WindowsAndMessaging::{
                GetWindowThreadProcessId, IsWindow, PostMessageW, SendMessageTimeoutW,
                SMTO_ABORTIFHUNG, WM_INPUTLANGCHANGEREQUEST, WM_SETTINGCHANGE,
            },
        },
    },
};

use super::{apps::launch_app, err, stats::StatsState, CmdResult};

// ---------- top processes ----------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProcessUsage {
    name: String,
    /// Percent of total CPU capacity (all cores = 100).
    cpu: f32,
    memory: u64,
    count: usize,
}

/// Processes grouped by name (so 30 `msedge.exe` count once), sorted by `by`.
#[tauri::command]
pub fn top_processes(state: State<'_, StatsState>, by: String, limit: usize) -> Vec<ProcessUsage> {
    let mut guard = state.0.lock().unwrap_or_else(|p| p.into_inner());
    let sys = guard.get_or_insert_with(System::new);
    // CPU usage is a delta between refreshes; the widget polls regularly.
    sys.refresh_processes(ProcessesToUpdate::All, true);
    let cores = sys.cpus().len().max(1) as f32;

    let mut groups: HashMap<String, ProcessUsage> = HashMap::new();
    for p in sys.processes().values() {
        let name = p
            .name()
            .to_string_lossy()
            .trim_end_matches(".exe")
            .to_string();
        if name.is_empty() || name == "System Idle Process" || name == "Idle" {
            continue;
        }
        let g = groups.entry(name.to_lowercase()).or_insert(ProcessUsage {
            name,
            cpu: 0.0,
            memory: 0,
            count: 0,
        });
        g.cpu += p.cpu_usage() / cores;
        g.memory += p.memory();
        g.count += 1;
    }
    let mut list: Vec<_> = groups.into_values().collect();
    if by == "ram" {
        list.sort_by_key(|p| std::cmp::Reverse(p.memory));
    } else {
        list.sort_by(|a, b| b.cpu.total_cmp(&a.cpu));
    }
    list.truncate(limit.clamp(1, 10));
    list
}

// ---------- theme ----------

const PERSONALIZE: PCWSTR = w!(r"Software\Microsoft\Windows\CurrentVersion\Themes\Personalize");

fn read_dword(name: PCWSTR) -> Option<u32> {
    let mut value = 0u32;
    let mut size = size_of::<u32>() as u32;
    let r = unsafe {
        RegGetValueW(
            HKEY_CURRENT_USER,
            PERSONALIZE,
            name,
            RRF_RT_REG_DWORD,
            None,
            Some(&mut value as *mut u32 as *mut c_void),
            Some(&mut size),
        )
    };
    r.is_ok().then_some(value)
}

/// True when apps use dark mode.
#[tauri::command]
pub fn get_dark_mode() -> bool {
    read_dword(w!("AppsUseLightTheme"))
        .map(|v| v == 0)
        .unwrap_or(false)
}

/// Switches apps and the Windows shell between light and dark.
#[tauri::command]
pub fn set_dark_mode(dark: bool) -> CmdResult<bool> {
    let light: u32 = if dark { 0 } else { 1 };
    for name in [w!("AppsUseLightTheme"), w!("SystemUsesLightTheme")] {
        let r = unsafe {
            RegSetKeyValueW(
                HKEY_CURRENT_USER,
                PERSONALIZE,
                name,
                REG_DWORD.0,
                Some(&light as *const u32 as *const c_void),
                size_of::<u32>() as u32,
            )
        };
        r.ok().map_err(err)?;
    }
    // Tell running apps and the shell to re-read the theme.
    unsafe {
        SendMessageTimeoutW(
            HWND(0xffff as *mut c_void), // HWND_BROADCAST
            WM_SETTINGCHANGE,
            WPARAM(0),
            LPARAM(w!("ImmersiveColorSet").as_ptr() as isize),
            SMTO_ABORTIFHUNG,
            200,
            None,
        );
    }
    Ok(get_dark_mode())
}

// ---------- shell shortcuts ----------

/// Fixed set of shell actions the widgets can trigger (no arbitrary paths).
#[tauri::command]
pub fn shell_action(action: String) -> CmdResult<()> {
    let target = match action.as_str() {
        "show-desktop" => "shell:::{3080F90D-D7AD-11D9-BD98-0000947B0257}",
        "notifications" => "ms-actioncenter:",
        "keyboard" => "osk.exe",
        "screenshot" => "ms-screenclip:",
        "task-manager" => "taskmgr.exe",
        "sound-settings" => "ms-settings:sound",
        "language-settings" => "ms-settings:regionlanguage",
        "storage-settings" => "ms-settings:storagesense",
        "recycle-bin" => "shell:RecycleBinFolder",
        // No public API toggles these, so their tiles open the right Settings page.
        "hotspot" => "ms-settings:network-mobilehotspot",
        "airplane" => "ms-settings:network-airplanemode",
        "focus" => "ms-settings:quiethours",
        "wifi-settings" => "ms-settings:network-wifi",
        "bluetooth-settings" => "ms-settings:bluetooth",
        "display-settings" => "ms-settings:display",
        other => return Err(format!("unknown shell action {other}")),
    };
    launch_app(target.to_string())
}

/// Opens a web search, or a folder/drive path typed into the Search widget.
#[tauri::command]
pub fn search_or_open(query: String) -> CmdResult<()> {
    let q = query.trim();
    if q.is_empty() {
        return Ok(());
    }
    let looks_like_path =
        q.len() >= 2 && (q.as_bytes()[1] == b':' || q.starts_with(r"\\") || q.starts_with('%'));
    if looks_like_path && std::path::Path::new(q).exists() {
        return launch_app(q.to_string());
    }
    if q.starts_with("https://") || q.starts_with("http://") {
        return launch_app(q.to_string());
    }
    let url =
        reqwest::Url::parse_with_params("https://www.bing.com/search", &[("q", q)]).map_err(err)?;
    launch_app(url.to_string())
}

// ---------- recycle bin ----------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RecycleBin {
    items: i64,
    bytes: i64,
}

#[tauri::command]
pub fn recycle_bin_info() -> CmdResult<RecycleBin> {
    let mut info = SHQUERYRBINFO {
        cbSize: size_of::<SHQUERYRBINFO>() as u32,
        ..Default::default()
    };
    unsafe { SHQueryRecycleBinW(PCWSTR::null(), &mut info) }.map_err(err)?;
    Ok(RecycleBin {
        items: info.i64NumItems,
        bytes: info.i64Size,
    })
}

/// Empties the bin after Windows' own confirmation dialog.
#[tauri::command]
pub async fn empty_recycle_bin() -> CmdResult<()> {
    tauri::async_runtime::spawn_blocking(|| unsafe {
        // Flags 0: show the confirmation, progress UI and sound, like Explorer.
        // Cancelling the dialog is reported as an error; treat it as a no-op.
        let _ = SHEmptyRecycleBinW(HWND(std::ptr::null_mut()), PCWSTR::null(), 0);
    })
    .await
    .map_err(err)
}

// ---------- keyboard layout ----------

/// Last foreground window that isn't Harbor's. Clicking a widget focuses the
/// panel, so the layout must be read from (and switched for) the app the user
/// was typing in.
static LAST_APP_WINDOW: AtomicIsize = AtomicIsize::new(0);

pub fn note_foreground(hwnd: HWND) {
    LAST_APP_WINDOW.store(hwnd.0 as isize, Ordering::Relaxed);
}

fn last_app_window() -> Option<HWND> {
    let h = HWND(LAST_APP_WINDOW.load(Ordering::Relaxed) as *mut c_void);
    (!h.0.is_null() && unsafe { IsWindow(h) }.as_bool()).then_some(h)
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct InputLanguage {
    /// Short code such as "EN".
    short: String,
    /// Localized name such as "English (United States)".
    name: String,
    /// Number of installed layouts (switching only makes sense if > 1).
    available: usize,
}

fn layout_info(hkl: HKL) -> (String, String) {
    let langid = (hkl.0 as usize & 0xffff) as u32;
    let mut locale = [0u16; 85];
    let n = unsafe { LCIDToLocaleName(langid, Some(&mut locale), 0) };
    if n <= 0 {
        return ("??".into(), "Unknown layout".into());
    }
    let read = |kind| {
        let mut buf = [0u16; 128];
        let len = unsafe { GetLocaleInfoEx(PCWSTR(locale.as_ptr()), kind, Some(&mut buf)) };
        String::from_utf16_lossy(&buf[..(len.max(1) - 1) as usize])
    };
    (
        read(LOCALE_SISO639LANGNAME).to_uppercase(),
        read(LOCALE_SLOCALIZEDDISPLAYNAME),
    )
}

fn installed_layouts() -> Vec<HKL> {
    let mut list = [HKL::default(); 32];
    let n = unsafe { GetKeyboardLayoutList(Some(&mut list)) };
    list[..n.max(0) as usize].to_vec()
}

fn current_layout() -> HKL {
    let thread = last_app_window()
        .map(|h| unsafe { GetWindowThreadProcessId(h, None) })
        .unwrap_or(0);
    unsafe { GetKeyboardLayout(thread) }
}

#[tauri::command]
pub fn input_language() -> InputLanguage {
    let (short, name) = layout_info(current_layout());
    InputLanguage {
        short,
        name,
        available: installed_layouts().len(),
    }
}

/// Switches the app the user was last typing in to the next installed layout.
#[tauri::command]
pub fn next_input_language() -> CmdResult<InputLanguage> {
    let Some(target) = last_app_window() else {
        return Err("click into an app first, then switch its keyboard layout".into());
    };
    let layouts = installed_layouts();
    if layouts.len() < 2 {
        return Ok(input_language());
    }
    let current = current_layout();
    let i = layouts.iter().position(|l| *l == current).unwrap_or(0);
    let next = layouts[(i + 1) % layouts.len()];
    unsafe {
        PostMessageW(
            target,
            WM_INPUTLANGCHANGEREQUEST,
            WPARAM(0),
            LPARAM(next.0 as isize),
        )
    }
    .map_err(err)?;
    let (short, name) = layout_info(next);
    Ok(InputLanguage {
        short,
        name,
        available: layouts.len(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unknown_shell_actions_are_rejected() {
        assert!(shell_action("cmd.exe /c del".into()).is_err());
        assert!(shell_action("".into()).is_err());
    }

    #[test]
    fn current_layout_has_a_name() {
        let lang = input_language();
        assert!(!lang.short.is_empty());
        assert!(lang.available >= 1);
    }

    #[test]
    fn recycle_bin_can_be_queried() {
        let info = recycle_bin_info().expect("query recycle bin");
        assert!(info.items >= 0 && info.bytes >= 0);
    }
}
