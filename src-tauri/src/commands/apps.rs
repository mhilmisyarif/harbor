//! Pinned apps (persisted as JSON in the app config dir) and launching.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Manager};
use windows::{
    core::{w, PCWSTR},
    Win32::{Foundation::HWND, UI::Shell::ShellExecuteW, UI::WindowsAndMessaging::SW_SHOWNORMAL},
};

use super::{err, icons, wide, CmdResult};

#[derive(Serialize, Deserialize, Clone)]
pub struct PinnedApp {
    pub name: String,
    pub path: String,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase", default)]
pub struct Config {
    pub pinned: Vec<PinnedApp>,
    pub show_seconds: bool,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            pinned: vec![
                PinnedApp {
                    name: "File Explorer".into(),
                    path: r"C:\Windows\explorer.exe".into(),
                },
                PinnedApp {
                    name: "Notepad".into(),
                    path: r"C:\Windows\System32\notepad.exe".into(),
                },
            ],
            show_seconds: false,
        }
    }
}

fn config_path(app: &AppHandle) -> CmdResult<PathBuf> {
    let dir = app.path().app_config_dir().map_err(err)?;
    fs::create_dir_all(&dir).map_err(err)?;
    Ok(dir.join("config.json"))
}

#[tauri::command]
pub fn load_config(app: AppHandle) -> CmdResult<Config> {
    let path = config_path(&app)?;
    match fs::read_to_string(&path) {
        Ok(text) => Ok(serde_json::from_str(&text).unwrap_or_default()),
        Err(_) => Ok(Config::default()),
    }
}

#[tauri::command]
pub fn save_config(app: AppHandle, config: Config) -> CmdResult<()> {
    let path = config_path(&app)?;
    let text = serde_json::to_string_pretty(&config).map_err(err)?;
    // Write-then-rename so a crash never leaves a half-written config.
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, text).map_err(err)?;
    fs::rename(&tmp, &path).map_err(err)
}

/// Opens an .exe, .lnk, document or folder the way Explorer would.
#[tauri::command]
pub fn launch_app(path: String) -> CmdResult<()> {
    let file = wide(&path);
    let result = unsafe {
        ShellExecuteW(
            HWND(std::ptr::null_mut()),
            w!("open"),
            PCWSTR(file.as_ptr()),
            PCWSTR::null(),
            PCWSTR::null(),
            SW_SHOWNORMAL,
        )
    };
    // ShellExecute reports success as a value > 32.
    if result.0 as isize > 32 {
        Ok(())
    } else {
        Err(format!(
            "could not open {path} (code {})",
            result.0 as isize
        ))
    }
}

#[tauri::command]
pub async fn app_icon(path: String) -> Option<String> {
    icons::icon_data_url(&path)
}
