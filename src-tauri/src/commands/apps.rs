//! Dock/bar configuration (persisted as JSON in the app config dir) and launching.
//!
//! The config is shared by every window. `save_config` validates it, writes it
//! atomically and broadcasts `config-changed` so the bar, dock and settings
//! window all re-render from the same saved state.

use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::path::PathBuf;
use tauri::{AppHandle, Emitter, Manager};
use windows::{
    core::{w, PCWSTR},
    Win32::{Foundation::HWND, UI::Shell::ShellExecuteW, UI::WindowsAndMessaging::SW_SHOWNORMAL},
};

use super::{err, wide, CmdResult};

pub const CONFIG_EVENT: &str = "config-changed";

/// Custom icons are PNG data URLs; keep config.json small.
const MAX_ICON_URL_BYTES: usize = 300 * 1024;

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct PinnedApp {
    pub name: String,
    /// Exe/lnk/folder path, or `shell:AppsFolder\<AppUserModelID>`.
    pub path: String,
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct DockSettings {
    pub icon_size: u32,
    pub magnify: bool,
    pub magnify_scale: f32,
    pub show_running: bool,
}

impl Default for DockSettings {
    fn default() -> Self {
        Self {
            icon_size: 48,
            magnify: true,
            magnify_scale: 1.5,
            show_running: true,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct BarSettings {
    pub show_cpu: bool,
    pub show_ram: bool,
    pub show_battery: bool,
    pub show_volume: bool,
    pub show_weather: bool,
    pub show_seconds: bool,
    pub clock_24h: bool,
}

impl Default for BarSettings {
    fn default() -> Self {
        Self {
            show_cpu: true,
            show_ram: true,
            show_battery: true,
            show_volume: true,
            show_weather: true,
            show_seconds: false,
            clock_24h: false,
        }
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase", default)]
pub struct Config {
    pub pinned: Vec<PinnedApp>,
    pub dock: DockSettings,
    pub bar: BarSettings,
    /// Custom icons keyed by lower-cased icon source (pinned path or running app).
    pub icon_overrides: BTreeMap<String, String>,
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
            dock: DockSettings::default(),
            bar: BarSettings::default(),
            icon_overrides: BTreeMap::new(),
        }
    }
}

impl Config {
    /// Clamps values the UI can't produce but a hand-edited file could.
    pub fn sanitized(mut self) -> Self {
        self.dock.icon_size = self.dock.icon_size.clamp(32, 96);
        if !self.dock.magnify_scale.is_finite() {
            self.dock.magnify_scale = DockSettings::default().magnify_scale;
        }
        self.dock.magnify_scale = self.dock.magnify_scale.clamp(1.0, 2.0);
        self.pinned.retain(|p| !p.path.trim().is_empty());
        for p in &mut self.pinned {
            p.name = p.name.trim().chars().take(60).collect();
        }
        self.icon_overrides = self
            .icon_overrides
            .into_iter()
            .filter(|(_, v)| {
                v.starts_with("data:image/png;base64,") && v.len() <= MAX_ICON_URL_BYTES
            })
            .map(|(k, v)| (k.to_lowercase(), v))
            .collect();
        self
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
    let config = match fs::read_to_string(&path) {
        Ok(text) => serde_json::from_str::<Config>(&text).unwrap_or_default(),
        Err(_) => Config::default(),
    };
    Ok(config.sanitized())
}

#[tauri::command]
pub fn save_config(app: AppHandle, config: Config) -> CmdResult<Config> {
    let config = config.sanitized();
    let path = config_path(&app)?;
    let text = serde_json::to_string_pretty(&config).map_err(err)?;
    // Write-then-rename so a crash never leaves a half-written config.
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, text).map_err(err)?;
    fs::rename(&tmp, &path).map_err(err)?;
    let _ = app.emit(CONFIG_EVENT, &config);
    Ok(config)
}

/// Opens an .exe, .lnk, document, folder or `shell:AppsFolder\...` app the way Explorer would.
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn old_config_files_still_load() {
        // v0.0.1 wrote only `pinned` and `showSeconds`.
        let old = r#"{"pinned":[{"name":"X","path":"C:\\x.exe"}],"showSeconds":true}"#;
        let c: Config = serde_json::from_str(old).unwrap();
        assert_eq!(c.pinned.len(), 1);
        assert_eq!(c.dock, DockSettings::default());
        assert!(c.icon_overrides.is_empty());
    }

    #[test]
    fn sanitize_clamps_and_drops_bad_values() {
        let mut c = Config::default();
        c.dock.icon_size = 500;
        c.dock.magnify_scale = f32::NAN;
        c.pinned.push(PinnedApp {
            name: "  Blank ".into(),
            path: "  ".into(),
        });
        c.icon_overrides
            .insert("C:\\A.EXE".into(), "data:image/png;base64,AAAA".into());
        c.icon_overrides
            .insert("b".into(), "javascript:alert(1)".into());
        c.icon_overrides.insert(
            "c".into(),
            format!("data:image/png;base64,{}", "A".repeat(MAX_ICON_URL_BYTES)),
        );
        let c = c.sanitized();
        assert_eq!(c.dock.icon_size, 96);
        assert_eq!(c.dock.magnify_scale, 1.5);
        assert!(c.pinned.iter().all(|p| !p.path.trim().is_empty()));
        assert_eq!(
            c.icon_overrides.keys().collect::<Vec<_>>(),
            vec!["c:\\a.exe"]
        );
    }

    #[test]
    fn config_uses_camel_case_on_the_wire() {
        let v = serde_json::to_value(Config::default()).unwrap();
        assert!(v["dock"].get("iconSize").is_some());
        assert!(v["bar"].get("clock24h").is_some());
        assert!(v.get("iconOverrides").is_some());
    }
}
