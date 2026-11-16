//! The desktop wallpaper, cropped to the monitor like Windows' "Fill" mode, so
//! the glass styles can show the blurred wallpaper behind each surface at the
//! exact screen position.

use base64::{engine::general_purpose::STANDARD, Engine};
use image::{codecs::jpeg::JpegEncoder, imageops::FilterType};
use std::ffi::c_void;
use std::sync::Mutex;
use std::time::SystemTime;
use windows::Win32::UI::WindowsAndMessaging::{
    SystemParametersInfoW, SPI_GETDESKWALLPAPER, SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS,
};

use super::{err, CmdResult};

fn wallpaper_path() -> Option<String> {
    let mut buf = [0u16; 1024];
    unsafe {
        SystemParametersInfoW(
            SPI_GETDESKWALLPAPER,
            buf.len() as u32,
            Some(buf.as_mut_ptr() as *mut c_void),
            SYSTEM_PARAMETERS_INFO_UPDATE_FLAGS(0),
        )
        .ok()?;
    }
    let len = buf.iter().position(|&c| c == 0).unwrap_or(buf.len());
    let path = String::from_utf16_lossy(&buf[..len]);
    (!path.is_empty()).then_some(path)
}

type CacheKey = (String, Option<SystemTime>, u32, u32);
static CACHE: Mutex<Option<(CacheKey, Option<String>)>> = Mutex::new(None);

fn render(path: &str, width: u32, height: u32) -> CmdResult<String> {
    let bytes = std::fs::read(path).map_err(err)?;
    let img =
        image::load_from_memory(&bytes).map_err(|e| format!("couldn't read the wallpaper: {e}"))?;
    // "Fill": scale to cover the monitor, centered, cropping the overflow.
    let filled = img
        .resize_to_fill(width, height, FilterType::Triangle)
        .to_rgb8();
    let mut out = Vec::new();
    JpegEncoder::new_with_quality(&mut out, 82)
        .encode_image(&filled)
        .map_err(err)?;
    Ok(format!("data:image/jpeg;base64,{}", STANDARD.encode(out)))
}

/// Wallpaper as a JPEG data URL sized to `width`×`height` physical pixels, or
/// None for a solid-colour / slideshow-less desktop. Cached until the wallpaper
/// file or the requested size changes.
#[tauri::command]
pub async fn desktop_wallpaper(width: u32, height: u32) -> Option<String> {
    let (w, h) = (width.clamp(16, 8192), height.clamp(16, 8192));
    tauri::async_runtime::spawn_blocking(move || {
        let path = wallpaper_path()?;
        let modified = std::fs::metadata(&path).and_then(|m| m.modified()).ok();
        let key: CacheKey = (path.clone(), modified, w, h);
        if let Ok(cache) = CACHE.lock() {
            if let Some((k, v)) = cache.as_ref() {
                if *k == key {
                    return v.clone();
                }
            }
        }
        let url = render(&path, w, h).ok();
        if let Ok(mut cache) = CACHE.lock() {
            *cache = Some((key, url.clone()));
        }
        url
    })
    .await
    .ok()
    .flatten()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn renders_a_filled_jpeg_of_the_requested_size() {
        let dir = std::env::temp_dir().join(format!("harbor-wp-{}", std::process::id()));
        std::fs::create_dir_all(&dir).unwrap();
        let src = dir.join("wide.png");
        image::RgbImage::from_pixel(400, 100, image::Rgb([30, 120, 200]))
            .save(&src)
            .unwrap();
        let url = render(src.to_str().unwrap(), 160, 90).unwrap();
        let jpeg = STANDARD
            .decode(url.trim_start_matches("data:image/jpeg;base64,"))
            .unwrap();
        let out = image::load_from_memory(&jpeg).unwrap();
        assert_eq!((out.width(), out.height()), (160, 90));
        let _ = std::fs::remove_dir_all(dir);
    }
}
