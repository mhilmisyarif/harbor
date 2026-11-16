// Harbor drives Win32 directly (appbar, window list, audio), so it is Windows-only.
#[cfg(not(windows))]
compile_error!("Harbor targets Windows only.");

pub mod appbar;
pub mod apps;
pub mod audio;
pub mod icons;
pub mod layout;
pub mod media;
pub mod stats;
pub mod system_extra;
pub mod taskbar;
pub mod wallpaper;
pub mod widgets;
pub mod windows_list;

/// Tauri commands return `Result<T, String>` so errors reach the frontend as text.
pub type CmdResult<T> = Result<T, String>;

pub fn err<E: std::fmt::Display>(e: E) -> String {
    e.to_string()
}

/// UTF-16, NUL-terminated string for Win32 calls.
pub fn wide(s: &str) -> Vec<u16> {
    s.encode_utf16().chain(std::iter::once(0)).collect()
}
