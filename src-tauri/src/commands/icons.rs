//! App icons as PNG data URLs.
//!
//! All shell calls run on one dedicated STA thread. The shell icon APIs require
//! COM on the calling thread and are not reliable when called concurrently from
//! the async runtime's worker pool, which is what the dock does when it asks for
//! every icon at once. Failed lookups are retried after a short delay instead of
//! being cached forever.
//!
//! An icon *source* is either a file path (exe, lnk, document, folder) or a
//! `shell:AppsFolder\<AppUserModelID>` path for packaged (Store) apps.

use base64::{engine::general_purpose::STANDARD, Engine};
use image::{imageops::FilterType, DynamicImage, ImageFormat, RgbaImage};
use std::collections::HashMap;
use std::ffi::c_void;
use std::io::Cursor;
use std::mem::size_of;
use std::sync::mpsc::{channel, Sender};
use std::sync::OnceLock;
use std::time::{Duration, Instant};
use windows::{
    core::PCWSTR,
    Win32::{
        Foundation::{HWND, SIZE},
        Graphics::Gdi::{
            DeleteObject, GetDC, GetDIBits, GetObjectW, ReleaseDC, BITMAP, BITMAPINFO,
            BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS, HBITMAP,
        },
        Storage::FileSystem::FILE_FLAGS_AND_ATTRIBUTES,
        System::Com::{CoInitializeEx, COINIT_APARTMENTTHREADED},
        UI::{
            Shell::{
                IShellItemImageFactory, SHCreateItemFromParsingName, SHGetFileInfoW, SHFILEINFOW,
                SHGFI_ICON, SHGFI_LARGEICON, SIIGBF_BIGGERSIZEOK, SIIGBF_ICONONLY,
            },
            WindowsAndMessaging::{DestroyIcon, GetIconInfo, ICONINFO},
        },
    },
};

use super::{err, wide, CmdResult};

/// Edge length of the PNGs handed to the frontend: crisp up to ~2.5x display scaling.
pub const ICON_PX: u32 = 128;
const RETRY_FAILED_AFTER: Duration = Duration::from_secs(30);

struct Request {
    source: String,
    reply: Sender<Option<String>>,
}

fn worker() -> &'static Sender<Request> {
    static WORKER: OnceLock<Sender<Request>> = OnceLock::new();
    WORKER.get_or_init(|| {
        let (tx, rx) = channel::<Request>();
        std::thread::Builder::new()
            .name("harbor-icons".into())
            .spawn(move || {
                // Shell icon APIs want an apartment-threaded COM thread.
                let _ = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) };
                let mut cache: HashMap<String, (Instant, Option<String>)> = HashMap::new();
                for req in rx {
                    let key = req.source.to_lowercase();
                    let fresh = match cache.get(&key) {
                        Some((_, Some(url))) => Some(Some(url.clone())),
                        Some((at, None)) if at.elapsed() < RETRY_FAILED_AFTER => Some(None),
                        _ => None,
                    };
                    let result = fresh.unwrap_or_else(|| {
                        let r = extract(&req.source).map(data_url);
                        cache.insert(key, (Instant::now(), r.clone()));
                        r
                    });
                    let _ = req.reply.send(result);
                }
            })
            .expect("failed to start icon thread");
        tx
    })
}

/// Blocks until the icon thread answers; call from a blocking context.
pub fn icon_data_url(source: &str) -> Option<String> {
    let (reply, rx) = channel();
    worker()
        .send(Request {
            source: source.to_string(),
            reply,
        })
        .ok()?;
    rx.recv().ok().flatten()
}

pub fn data_url(png: Vec<u8>) -> String {
    format!("data:image/png;base64,{}", STANDARD.encode(png))
}

fn extract(source: &str) -> Option<Vec<u8>> {
    unsafe { shell_image(source).or_else(|| file_info_icon(source)) }
}

/// High-resolution icon via the shell item image factory (handles packaged apps).
unsafe fn shell_image(source: &str) -> Option<Vec<u8>> {
    let w = wide(source);
    let factory: IShellItemImageFactory =
        SHCreateItemFromParsingName(PCWSTR(w.as_ptr()), None).ok()?;
    let size = SIZE {
        cx: ICON_PX as i32,
        cy: ICON_PX as i32,
    };
    let bitmap = factory
        .GetImage(size, SIIGBF_ICONONLY | SIIGBF_BIGGERSIZEOK)
        .ok()?;
    // The factory returns premultiplied BGRA.
    let pixels = bitmap_rgba(bitmap, true);
    let _ = DeleteObject(bitmap);
    pixels.and_then(encode_png)
}

/// Fallback: the classic 32 px shell icon.
unsafe fn file_info_icon(source: &str) -> Option<Vec<u8>> {
    let w = wide(source);
    let mut sfi = SHFILEINFOW::default();
    let r = SHGetFileInfoW(
        PCWSTR(w.as_ptr()),
        FILE_FLAGS_AND_ATTRIBUTES(0),
        Some(&mut sfi),
        size_of::<SHFILEINFOW>() as u32,
        SHGFI_ICON | SHGFI_LARGEICON,
    );
    if r == 0 || sfi.hIcon.is_invalid() {
        return None;
    }
    let mut info = ICONINFO::default();
    let ok = GetIconInfo(sfi.hIcon, &mut info).is_ok();
    let _ = DestroyIcon(sfi.hIcon);
    if !ok {
        return None;
    }
    // Icon color bitmaps carry straight (non-premultiplied) alpha.
    let pixels = if info.hbmColor.is_invalid() {
        None
    } else {
        bitmap_rgba(info.hbmColor, false)
    };
    let _ = DeleteObject(info.hbmColor);
    let _ = DeleteObject(info.hbmMask);
    pixels.and_then(encode_png)
}

/// Reads a 32-bit DIB as straight-alpha RGBA.
unsafe fn bitmap_rgba(bitmap: HBITMAP, premultiplied: bool) -> Option<RgbaImage> {
    let mut bmp = BITMAP::default();
    GetObjectW(
        bitmap,
        size_of::<BITMAP>() as i32,
        Some(&mut bmp as *mut _ as *mut c_void),
    );
    let (w, h) = (bmp.bmWidth, bmp.bmHeight.abs());
    if w <= 0 || h <= 0 || w > 1024 || h > 1024 {
        return None;
    }

    let mut bi = BITMAPINFO {
        bmiHeader: BITMAPINFOHEADER {
            biSize: size_of::<BITMAPINFOHEADER>() as u32,
            biWidth: w,
            biHeight: -h, // top-down rows
            biPlanes: 1,
            biBitCount: 32,
            biCompression: BI_RGB.0,
            ..Default::default()
        },
        ..Default::default()
    };
    let mut buf = vec![0u8; (w * h * 4) as usize];
    let screen = HWND(std::ptr::null_mut());
    let hdc = GetDC(screen);
    let lines = GetDIBits(
        hdc,
        bitmap,
        0,
        h as u32,
        Some(buf.as_mut_ptr() as *mut c_void),
        &mut bi,
        DIB_RGB_COLORS,
    );
    ReleaseDC(screen, hdc);
    if lines == 0 {
        return None;
    }

    let has_alpha = buf.as_chunks::<4>().0.iter().any(|p| p[3] != 0);
    for p in buf.as_chunks_mut::<4>().0 {
        p.swap(0, 2); // BGRA -> RGBA
        if !has_alpha {
            p[3] = 255; // legacy icons without an alpha channel are opaque
        } else if premultiplied && p[3] != 0 && p[3] != 255 {
            let a = p[3] as u32;
            for c in &mut p[..3] {
                *c = ((*c as u32 * 255 + a / 2) / a).min(255) as u8;
            }
        }
    }
    RgbaImage::from_raw(w as u32, h as u32, buf)
}

fn encode_png(img: RgbaImage) -> Option<Vec<u8>> {
    let img = if img.width() > ICON_PX || img.height() > ICON_PX {
        DynamicImage::ImageRgba8(img)
            .resize(ICON_PX, ICON_PX, FilterType::Lanczos3)
            .to_rgba8()
    } else {
        img
    };
    let mut out = Cursor::new(Vec::new());
    img.write_to(&mut out, ImageFormat::Png).ok()?;
    Some(out.into_inner())
}

// ---------- commands ----------

#[tauri::command]
pub async fn app_icon(source: String) -> Option<String> {
    tauri::async_runtime::spawn_blocking(move || icon_data_url(&source))
        .await
        .ok()
        .flatten()
}

/// Turns a user-picked image (or an exe/lnk/ico whose icon they want) into a
/// small PNG data URL for use as a custom dock icon.
#[tauri::command]
pub async fn load_custom_icon(path: String) -> CmdResult<String> {
    let ext = std::path::Path::new(&path)
        .extension()
        .map(|e| e.to_string_lossy().to_lowercase())
        .unwrap_or_default();
    if matches!(ext.as_str(), "exe" | "lnk" | "dll" | "url") {
        let p = path.clone();
        return tauri::async_runtime::spawn_blocking(move || icon_data_url(&p))
            .await
            .map_err(err)?
            .ok_or_else(|| format!("{path} has no icon"));
    }
    tauri::async_runtime::spawn_blocking(move || {
        let meta = std::fs::metadata(&path).map_err(err)?;
        if meta.len() > 10 * 1024 * 1024 {
            return Err("that image is larger than 10 MB".to_string());
        }
        let bytes = std::fs::read(&path).map_err(err)?;
        let img = image::load_from_memory(&bytes)
            .map_err(|e| format!("could not read that image: {e}"))?
            .to_rgba8();
        encode_png(img)
            .map(data_url)
            .ok_or_else(|| "could not encode icon".to_string())
    })
    .await
    .map_err(err)?
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Regression test for the dock showing letters: many concurrent requests
    /// (as the dock makes on startup) must all resolve through the icon thread.
    #[test]
    fn concurrent_requests_all_resolve() {
        let paths = [
            r"C:\Windows\explorer.exe",
            r"C:\Windows\System32\notepad.exe",
            r"C:\Windows\System32\taskmgr.exe",
            r"C:\Windows\System32\cmd.exe",
        ];
        let handles: Vec<_> = (0..16)
            .map(|i| {
                let p = paths[i % paths.len()];
                std::thread::spawn(move || (p, icon_data_url(p)))
            })
            .collect();
        for h in handles {
            let (p, url) = h.join().unwrap();
            let url = url.unwrap_or_else(|| panic!("no icon for {p}"));
            assert!(url.starts_with("data:image/png;base64,"));
        }
    }

    #[test]
    fn icons_are_high_resolution() {
        let url = icon_data_url(r"C:\Windows\explorer.exe").expect("explorer icon");
        let png = STANDARD
            .decode(url.trim_start_matches("data:image/png;base64,"))
            .unwrap();
        let img = image::load_from_memory(&png).unwrap();
        assert!(img.width() >= 64, "icon is only {}px wide", img.width());
    }

    #[test]
    fn missing_file_is_none_not_a_panic() {
        assert!(icon_data_url(r"C:\definitely\not\here.exe").is_none());
    }
}
