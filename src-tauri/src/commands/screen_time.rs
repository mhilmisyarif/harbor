//! Screen Time: which app is in front, sampled every few seconds, totalled per
//! day and stored locally (`screen-time.json`, last 30 days). Idle time (no
//! keyboard or mouse input for 2 minutes) and Harbor itself are not counted.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};
use windows::Win32::{
    System::SystemInformation::{GetLocalTime, GetTickCount},
    UI::{
        Input::KeyboardAndMouse::{GetLastInputInfo, LASTINPUTINFO},
        WindowsAndMessaging::{GetForegroundWindow, GetWindowThreadProcessId},
    },
};

use super::windows_list::process_info;

const SAMPLE: Duration = Duration::from_secs(5);
const IDLE_AFTER_MS: u32 = 120_000;
const KEEP_DAYS: usize = 30;

/// date (YYYY-MM-DD) → exe path → seconds
#[derive(Default, Serialize, Deserialize)]
struct Store {
    days: BTreeMap<String, BTreeMap<String, u64>>,
}

static STORE: Mutex<Option<Store>> = Mutex::new(None);

fn today() -> String {
    let t = unsafe { GetLocalTime() };
    format!("{:04}-{:02}-{:02}", t.wYear, t.wMonth, t.wDay)
}

fn idle() -> bool {
    let mut info = LASTINPUTINFO {
        cbSize: std::mem::size_of::<LASTINPUTINFO>() as u32,
        dwTime: 0,
    };
    unsafe {
        GetLastInputInfo(&mut info).as_bool()
            && GetTickCount().wrapping_sub(info.dwTime) > IDLE_AFTER_MS
    }
}

fn foreground_exe() -> Option<String> {
    let h = unsafe { GetForegroundWindow() };
    if h.0.is_null() {
        return None;
    }
    let mut pid = 0u32;
    unsafe { GetWindowThreadProcessId(h, Some(&mut pid)) };
    if pid == 0 || pid == std::process::id() {
        return None;
    }
    process_info(pid).0
}

fn store_path(app: &AppHandle) -> Option<PathBuf> {
    let dir = app.path().app_data_dir().ok()?;
    std::fs::create_dir_all(&dir).ok()?;
    Some(dir.join("screen-time.json"))
}

fn save(path: &Path, store: &Store) {
    if let Ok(text) = serde_json::to_string(store) {
        let tmp = path.with_extension("tmp");
        if std::fs::write(&tmp, text).is_ok() {
            let _ = std::fs::rename(tmp, path);
        }
    }
}

fn record(store: &mut Store, day: &str, exe: &str, secs: u64) {
    *store
        .days
        .entry(day.to_string())
        .or_default()
        .entry(exe.to_string())
        .or_default() += secs;
    while store.days.len() > KEEP_DAYS {
        let oldest = store.days.keys().next().cloned();
        if let Some(k) = oldest {
            store.days.remove(&k);
        }
    }
}

pub fn start(app: AppHandle) {
    let path = store_path(&app);
    let loaded: Store = path
        .as_ref()
        .and_then(|p| std::fs::read_to_string(p).ok())
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default();
    if let Ok(mut s) = STORE.lock() {
        *s = Some(loaded);
    }
    let _ = std::thread::Builder::new()
        .name("harbor-screen-time".into())
        .spawn(move || {
            let mut last_save = Instant::now();
            loop {
                std::thread::sleep(SAMPLE);
                if idle() {
                    continue;
                }
                let Some(exe) = foreground_exe() else {
                    continue;
                };
                if let Ok(mut guard) = STORE.lock() {
                    let store = guard.get_or_insert_with(Store::default);
                    record(store, &today(), &exe, SAMPLE.as_secs());
                    if last_save.elapsed() > Duration::from_secs(60) {
                        if let Some(p) = &path {
                            save(p, store);
                        }
                        last_save = Instant::now();
                    }
                }
            }
        });
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppTime {
    exe: String,
    name: String,
    secs: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DayTime {
    date: String,
    total: u64,
    apps: Vec<AppTime>,
}

/// The last `days` days (newest first), apps sorted by time.
#[tauri::command]
pub fn screen_time(days: usize) -> Vec<DayTime> {
    let guard = STORE.lock().unwrap_or_else(|p| p.into_inner());
    let Some(store) = guard.as_ref() else {
        return Vec::new();
    };
    store
        .days
        .iter()
        .rev()
        .take(days.clamp(1, KEEP_DAYS))
        .map(|(date, apps)| {
            let mut list: Vec<AppTime> = apps
                .iter()
                .map(|(exe, &secs)| AppTime {
                    exe: exe.clone(),
                    name: Path::new(exe)
                        .file_stem()
                        .map(|s| s.to_string_lossy().into_owned())
                        .unwrap_or_else(|| exe.clone()),
                    secs,
                })
                .collect();
            list.sort_by_key(|a| std::cmp::Reverse(a.secs));
            DayTime {
                date: date.clone(),
                total: list.iter().map(|a| a.secs).sum(),
                apps: list,
            }
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn records_and_prunes_old_days() {
        let mut s = Store::default();
        for d in 1..=40 {
            record(&mut s, &format!("2026-01-{d:02}"), r"C:\a.exe", 5);
        }
        record(&mut s, "2026-01-40", r"C:\a.exe", 5);
        assert_eq!(s.days.len(), KEEP_DAYS);
        assert_eq!(s.days["2026-01-40"][r"C:\a.exe"], 10);
        assert!(!s.days.contains_key("2026-01-01"));
    }

    #[test]
    fn today_is_iso() {
        let t = today();
        assert_eq!(t.len(), 10);
        assert_eq!(&t[4..5], "-");
    }
}
