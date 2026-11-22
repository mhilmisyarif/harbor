//! Quick system controls behind the Phase B widgets: fullscreen auto-hide,
//! Recycle Bin drops, per-app volume, Wi-Fi/Bluetooth radios, display
//! brightness and the Downloads / Screenshots / Recent files lists.

use serde::Serialize;
use std::collections::BTreeMap;
use std::ffi::c_void;
use std::path::{Path, PathBuf};
use std::time::{Duration, UNIX_EPOCH};
use tauri::{AppHandle, Manager};
use windows::{
    core::{Interface, PCWSTR},
    Devices::Radios::{Radio, RadioAccessStatus, RadioKind, RadioState},
    Win32::{
        Devices::Display::{
            DestroyPhysicalMonitors, GetMonitorBrightness, GetNumberOfPhysicalMonitorsFromHMONITOR,
            GetPhysicalMonitorsFromHMONITOR, SetMonitorBrightness, PHYSICAL_MONITOR,
        },
        Foundation::{BOOL, HWND, LPARAM, RECT, S_OK, TRUE},
        Graphics::Gdi::{EnumDisplayMonitors, HDC, HMONITOR},
        Media::Audio::{
            eConsole, eRender, AudioSessionStateExpired, IAudioSessionControl2,
            IAudioSessionManager2, IMMDeviceEnumerator, ISimpleAudioVolume, MMDeviceEnumerator,
        },
        System::Com::{
            CoCreateInstance, CoInitializeEx, CoTaskMemFree, CLSCTX_ALL, COINIT_MULTITHREADED,
        },
        UI::Shell::{
            FOLDERID_Downloads, FOLDERID_Recent, FOLDERID_Screenshots, SHFileOperationW,
            SHGetKnownFolderPath, SHQueryUserNotificationState, FOF_ALLOWUNDO, FOF_NOCONFIRMATION,
            FOF_NOERRORUI, FOF_SILENT, FO_DELETE, KF_FLAG_DEFAULT, QUNS_BUSY,
            QUNS_PRESENTATION_MODE, QUNS_RUNNING_D3D_FULL_SCREEN, SHFILEOPSTRUCTW,
        },
    },
};

use super::{err, windows_list::process_info, CmdResult};

fn com() {
    let _ = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
}

// ---------- fullscreen auto-hide ----------

/// True while something is fullscreen, so the notch doesn't re-show itself when it resizes.
pub static FULLSCREEN: std::sync::atomic::AtomicBool = std::sync::atomic::AtomicBool::new(false);

/// Hides the dock, bar and notch while a game, video or presentation is
/// fullscreen, and brings back exactly the windows it hid.
pub fn start_fullscreen_watch(app: AppHandle) {
    let _ = std::thread::Builder::new().name("harbor-fullscreen".into()).spawn(move || {
        let mut hidden: Vec<&'static str> = Vec::new();
        loop {
            std::thread::sleep(Duration::from_millis(900));
            let state = unsafe { SHQueryUserNotificationState() }.ok();
            let fullscreen = matches!(state, Some(s) if s == QUNS_BUSY || s == QUNS_RUNNING_D3D_FULL_SCREEN || s == QUNS_PRESENTATION_MODE);
            FULLSCREEN.store(fullscreen, std::sync::atomic::Ordering::SeqCst);
            if fullscreen && hidden.is_empty() {
                for label in ["dock", "bar", "notch"] {
                    if let Some(w) = app.get_webview_window(label) {
                        if w.is_visible().unwrap_or(false) && w.hide().is_ok() {
                            hidden.push(label);
                        }
                    }
                }
            } else if !fullscreen && !hidden.is_empty() {
                for label in hidden.drain(..) {
                    if let Some(w) = app.get_webview_window(label) {
                        let _ = w.show();
                    }
                }
            }
        }
    });
}

// ---------- Recycle Bin drop ----------

/// Moves files dropped on the Recycle Bin pill to the Recycle Bin (undoable).
#[tauri::command]
pub async fn recycle_files(paths: Vec<String>) -> CmdResult<usize> {
    let existing: Vec<String> = paths
        .into_iter()
        .filter(|p| Path::new(p).exists())
        .take(500)
        .collect();
    if existing.is_empty() {
        return Ok(0);
    }
    let count = existing.len();
    tauri::async_runtime::spawn_blocking(move || {
        // Double-NUL-terminated list of paths.
        let mut from: Vec<u16> = Vec::new();
        for p in &existing {
            from.extend(p.encode_utf16());
            from.push(0);
        }
        from.push(0);
        let mut op = SHFILEOPSTRUCTW {
            hwnd: HWND(std::ptr::null_mut()),
            wFunc: FO_DELETE,
            pFrom: PCWSTR(from.as_ptr()),
            fFlags: (FOF_ALLOWUNDO.0 | FOF_NOCONFIRMATION.0 | FOF_SILENT.0 | FOF_NOERRORUI.0)
                as u16,
            ..Default::default()
        };
        let r = unsafe { SHFileOperationW(&mut op) };
        if r == 0 {
            Ok(count)
        } else {
            Err(format!(
                "couldn't move those files to the Recycle Bin (code {r})"
            ))
        }
    })
    .await
    .map_err(err)?
}

// ---------- per-app volume ----------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppVolume {
    pid: u32,
    name: String,
    /// Exe path, for the app's icon (empty for system sounds).
    exe: String,
    level: f32,
    muted: bool,
}

fn sessions() -> windows::core::Result<Vec<(u32, bool, ISimpleAudioVolume)>> {
    com();
    unsafe {
        let enumerator: IMMDeviceEnumerator =
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
        let device = enumerator.GetDefaultAudioEndpoint(eRender, eConsole)?;
        let manager: IAudioSessionManager2 = device.Activate(CLSCTX_ALL, None)?;
        let list = manager.GetSessionEnumerator()?;
        let mut out = Vec::new();
        for i in 0..list.GetCount()? {
            let control = list.GetSession(i)?;
            if control.GetState()? == AudioSessionStateExpired {
                continue;
            }
            let c2: IAudioSessionControl2 = control.cast()?;
            let system = c2.IsSystemSoundsSession() == S_OK;
            let volume: ISimpleAudioVolume = control.cast()?;
            out.push((c2.GetProcessId().unwrap_or(0), system, volume));
        }
        Ok(out)
    }
}

/// Apps currently playing (or able to play) sound, one row per process.
#[tauri::command]
pub async fn app_volumes() -> CmdResult<Vec<AppVolume>> {
    tauri::async_runtime::spawn_blocking(|| {
        let mut rows: BTreeMap<u32, AppVolume> = BTreeMap::new();
        for (pid, system, vol) in sessions().map_err(err)? {
            if rows.contains_key(&pid) {
                continue;
            }
            let (exe, name) = if system {
                (String::new(), "System sounds".to_string())
            } else {
                let exe = process_info(pid).0.unwrap_or_default();
                let name = Path::new(&exe)
                    .file_stem()
                    .map(|s| s.to_string_lossy().into_owned())
                    .unwrap_or_else(|| format!("Process {pid}"));
                (exe, name)
            };
            let (level, muted) = unsafe {
                (
                    vol.GetMasterVolume().unwrap_or(1.0),
                    vol.GetMute().map(|b| b.as_bool()).unwrap_or(false),
                )
            };
            rows.insert(
                pid,
                AppVolume {
                    pid,
                    name,
                    exe,
                    level,
                    muted,
                },
            );
        }
        Ok(rows.into_values().collect())
    })
    .await
    .map_err(err)?
}

/// Sets every audio session of one process (`level` 0..1 and/or `muted`).
#[tauri::command]
pub async fn set_app_volume(pid: u32, level: Option<f32>, muted: Option<bool>) -> CmdResult<()> {
    tauri::async_runtime::spawn_blocking(move || {
        for (p, _, vol) in sessions().map_err(err)? {
            if p != pid {
                continue;
            }
            unsafe {
                if let Some(l) = level {
                    vol.SetMasterVolume(l.clamp(0.0, 1.0), std::ptr::null())
                        .map_err(err)?;
                }
                if let Some(m) = muted {
                    vol.SetMute(BOOL::from(m), std::ptr::null()).map_err(err)?;
                }
            }
        }
        Ok(())
    })
    .await
    .map_err(err)?
}

// ---------- Wi-Fi / Bluetooth ----------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RadioInfo {
    /// `wifi`, `bluetooth` or `cellular`.
    kind: String,
    name: String,
    on: bool,
}

fn kind_name(k: RadioKind) -> Option<&'static str> {
    match k {
        RadioKind::WiFi => Some("wifi"),
        RadioKind::Bluetooth => Some("bluetooth"),
        RadioKind::MobileBroadband => Some("cellular"),
        _ => None,
    }
}

fn radios() -> windows::core::Result<Vec<Radio>> {
    com();
    let list = Radio::GetRadiosAsync()?.get()?;
    Ok(list.into_iter().collect())
}

#[tauri::command]
pub async fn list_radios() -> CmdResult<Vec<RadioInfo>> {
    tauri::async_runtime::spawn_blocking(|| {
        Ok(radios()
            .map_err(err)?
            .into_iter()
            .filter_map(|r| {
                let kind = kind_name(r.Kind().ok()?)?;
                Some(RadioInfo {
                    kind: kind.into(),
                    name: r.Name().map(|s| s.to_string()).unwrap_or_default(),
                    on: r.State().ok()? == RadioState::On,
                })
            })
            .collect())
    })
    .await
    .map_err(err)?
}

#[tauri::command]
pub async fn set_radio(kind: String, on: bool) -> CmdResult<()> {
    tauri::async_runtime::spawn_blocking(move || {
        com();
        let access = Radio::RequestAccessAsync()
            .and_then(|a| a.get())
            .map_err(err)?;
        if access != RadioAccessStatus::Allowed {
            return Err(
                "Windows didn't allow Harbor to change radios. Check Settings → Privacy → Radios."
                    .into(),
            );
        }
        let target = if on { RadioState::On } else { RadioState::Off };
        let mut found = false;
        for r in radios().map_err(err)? {
            if r.Kind().ok().and_then(kind_name) == Some(kind.as_str()) {
                found = true;
                let status = r.SetStateAsync(target).and_then(|a| a.get()).map_err(err)?;
                if status != RadioAccessStatus::Allowed {
                    return Err(format!(
                        "couldn't turn {kind} {}",
                        if on { "on" } else { "off" }
                    ));
                }
            }
        }
        if found {
            Ok(())
        } else {
            Err(format!("no {kind} adapter found"))
        }
    })
    .await
    .map_err(err)?
}

// ---------- brightness ----------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Brightness {
    /// 0..100, or None when no display supports software brightness.
    level: Option<u8>,
    /// `external` (DDC/CI monitors) or `panel` (laptop screen).
    source: Option<String>,
}

unsafe extern "system" fn collect_monitor(h: HMONITOR, _: HDC, _: *mut RECT, l: LPARAM) -> BOOL {
    (*(l.0 as *mut Vec<HMONITOR>)).push(h);
    TRUE
}

/// Runs `f` on every DDC/CI-capable physical monitor; returns how many it ran on.
fn with_ddc_monitors(
    mut f: impl FnMut(windows::Win32::Foundation::HANDLE, u32, u32, u32),
) -> usize {
    let mut monitors: Vec<HMONITOR> = Vec::new();
    let mut count = 0;
    unsafe {
        let _ = EnumDisplayMonitors(
            HDC::default(),
            None,
            Some(collect_monitor),
            LPARAM(&mut monitors as *mut _ as isize),
        );
        for m in monitors {
            let mut n = 0u32;
            if GetNumberOfPhysicalMonitorsFromHMONITOR(m, &mut n).is_err() || n == 0 {
                continue;
            }
            let mut phys = vec![PHYSICAL_MONITOR::default(); n as usize];
            if GetPhysicalMonitorsFromHMONITOR(m, &mut phys).is_err() {
                continue;
            }
            for p in &phys {
                let (mut min, mut cur, mut max) = (0u32, 0u32, 0u32);
                if GetMonitorBrightness(p.hPhysicalMonitor, &mut min, &mut cur, &mut max) != 0
                    && max > min
                {
                    f(p.hPhysicalMonitor, min, cur, max);
                    count += 1;
                }
            }
            let _ = DestroyPhysicalMonitors(&phys);
        }
    }
    count
}

/// Laptop panels don't speak DDC/CI; they are controlled through WMI.
fn panel_powershell(script: &str) -> Option<String> {
    use std::os::windows::process::CommandExt;
    let out = std::process::Command::new("powershell.exe")
        .args(["-NoProfile", "-NonInteractive", "-Command", script])
        .creation_flags(0x0800_0000) // CREATE_NO_WINDOW
        .output()
        .ok()?;
    out.status
        .success()
        .then(|| String::from_utf8_lossy(&out.stdout).trim().to_string())
}

#[tauri::command]
pub async fn get_brightness() -> Brightness {
    tauri::async_runtime::spawn_blocking(|| {
        let mut level = None;
        with_ddc_monitors(|_, min, cur, max| {
            level.get_or_insert(((cur - min) * 100 / (max - min)) as u8);
        });
        if level.is_some() {
            return Brightness { level, source: Some("external".into()) };
        }
        let panel = panel_powershell("(Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightness -ErrorAction Stop | Select-Object -First 1).CurrentBrightness")
            .and_then(|s| s.parse::<u8>().ok());
        Brightness { level: panel, source: panel.map(|_| "panel".into()) }
    })
    .await
    .unwrap_or(Brightness { level: None, source: None })
}

#[tauri::command]
pub async fn set_brightness(level: u8) -> CmdResult<()> {
    let level = level.min(100);
    tauri::async_runtime::spawn_blocking(move || {
        let n = with_ddc_monitors(|h, min, _, max| unsafe {
            SetMonitorBrightness(h, min + (max - min) * level as u32 / 100);
        });
        if n > 0 {
            return Ok(());
        }
        // `level` is a validated integer, so it is safe to put in the script.
        panel_powershell(&format!(
            "Get-CimInstance -Namespace root/WMI -ClassName WmiMonitorBrightnessMethods -ErrorAction Stop | Invoke-CimMethod -MethodName WmiSetBrightness -Arguments @{{Timeout=1; Brightness={level}}} | Out-Null"
        ))
        .map(|_| ())
        .ok_or_else(|| "this display doesn't support changing brightness from software".to_string())
    })
    .await
    .map_err(err)?
}

// ---------- Downloads / Screenshots / Recent ----------

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileItem {
    name: String,
    path: String,
    size: u64,
    /// Unix milliseconds.
    modified: u64,
    is_dir: bool,
}

fn known_folder(kind: &str) -> Option<PathBuf> {
    let id = match kind {
        "downloads" => &FOLDERID_Downloads,
        "screenshots" => &FOLDERID_Screenshots,
        "recent" => &FOLDERID_Recent,
        _ => return None,
    };
    unsafe {
        let p = SHGetKnownFolderPath(id, KF_FLAG_DEFAULT, None).ok()?;
        let s = p.to_string().ok();
        CoTaskMemFree(Some(p.0 as *const c_void));
        s.map(PathBuf::from)
    }
}

/// Newest entries in Downloads, Screenshots or Recent (`kind`), newest first.
#[tauri::command]
pub async fn recent_files(kind: String, limit: usize) -> CmdResult<Vec<FileItem>> {
    let dir = known_folder(&kind).ok_or_else(|| format!("unknown folder {kind}"))?;
    let recent = kind == "recent";
    tauri::async_runtime::spawn_blocking(move || {
        let mut items: Vec<FileItem> = std::fs::read_dir(&dir)
            .map_err(err)?
            .filter_map(|e| e.ok())
            .filter_map(|e| {
                let name = e.file_name().to_string_lossy().into_owned();
                if name.eq_ignore_ascii_case("desktop.ini")
                    || (recent && !name.to_lowercase().ends_with(".lnk"))
                {
                    return None;
                }
                let meta = e.metadata().ok()?;
                let modified = meta
                    .modified()
                    .ok()?
                    .duration_since(UNIX_EPOCH)
                    .ok()?
                    .as_millis() as u64;
                Some(FileItem {
                    name: if recent {
                        name.trim_end_matches(".lnk").to_string()
                    } else {
                        name
                    },
                    path: e.path().to_string_lossy().into_owned(),
                    size: meta.len(),
                    modified,
                    is_dir: meta.is_dir(),
                })
            })
            .collect();
        items.sort_by_key(|f| std::cmp::Reverse(f.modified));
        items.truncate(limit.clamp(1, 50));
        Ok(items)
    })
    .await
    .map_err(err)?
}

/// Opens Explorer with the file selected.
#[tauri::command]
pub fn reveal_file(path: String) -> CmdResult<()> {
    if !Path::new(&path).exists() {
        return Err("that file no longer exists".into());
    }
    std::process::Command::new("explorer.exe")
        .arg(format!("/select,{path}"))
        .spawn()
        .map(|_| ())
        .map_err(err)
}

/// Opens a known folder (Downloads, Screenshots, Recent).
#[tauri::command]
pub fn open_known_folder(kind: String) -> CmdResult<()> {
    let dir = known_folder(&kind).ok_or_else(|| format!("unknown folder {kind}"))?;
    super::apps::launch_app(dir.to_string_lossy().into_owned())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn known_folders_resolve() {
        for k in ["downloads", "recent"] {
            let p = known_folder(k).unwrap_or_else(|| panic!("{k} folder"));
            assert!(p.is_absolute());
        }
        assert!(known_folder("system32").is_none());
    }

    #[test]
    fn recycle_ignores_missing_files() {
        let n = tauri::async_runtime::block_on(recycle_files(vec![
            r"C:\definitely\not\here.txt".into()
        ]))
        .unwrap();
        assert_eq!(n, 0);
    }
}
