//! Extracts the shell icon of an executable/shortcut as a PNG data URL.

use base64::{engine::general_purpose::STANDARD, Engine};
use image::{ImageFormat, RgbaImage};
use std::collections::HashMap;
use std::ffi::c_void;
use std::io::Cursor;
use std::mem::size_of;
use std::sync::{Mutex, OnceLock};
use windows::{
    core::PCWSTR,
    Win32::{
        Foundation::HWND,
        Graphics::Gdi::{
            DeleteObject, GetDC, GetDIBits, GetObjectW, ReleaseDC, BITMAP, BITMAPINFO,
            BITMAPINFOHEADER, BI_RGB, DIB_RGB_COLORS,
        },
        Storage::FileSystem::FILE_FLAGS_AND_ATTRIBUTES,
        UI::{
            Shell::{SHGetFileInfoW, SHFILEINFOW, SHGFI_ICON, SHGFI_LARGEICON},
            WindowsAndMessaging::{DestroyIcon, GetIconInfo, HICON, ICONINFO},
        },
    },
};

use super::wide;

fn cache() -> &'static Mutex<HashMap<String, Option<String>>> {
    static CACHE: OnceLock<Mutex<HashMap<String, Option<String>>>> = OnceLock::new();
    CACHE.get_or_init(Default::default)
}

pub fn icon_data_url(path: &str) -> Option<String> {
    let key = path.to_lowercase();
    if let Some(hit) = cache().lock().ok()?.get(&key) {
        return hit.clone();
    }
    let result = extract(path);
    if let Ok(mut c) = cache().lock() {
        c.insert(key, result.clone());
    }
    result
}

fn extract(path: &str) -> Option<String> {
    let w = wide(path);
    let mut sfi = SHFILEINFOW::default();
    unsafe {
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
        let png = hicon_to_png(sfi.hIcon);
        let _ = DestroyIcon(sfi.hIcon);
        png.map(|bytes| format!("data:image/png;base64,{}", STANDARD.encode(bytes)))
    }
}

unsafe fn hicon_to_png(icon: HICON) -> Option<Vec<u8>> {
    let mut info = ICONINFO::default();
    GetIconInfo(icon, &mut info).ok()?;
    let color = info.hbmColor;
    let mask = info.hbmMask;
    let cleanup = || {
        let _ = DeleteObject(color);
        let _ = DeleteObject(mask);
    };
    if color.is_invalid() {
        cleanup();
        return None; // monochrome icon; not worth handling here
    }

    let mut bmp = BITMAP::default();
    GetObjectW(
        color,
        size_of::<BITMAP>() as i32,
        Some(&mut bmp as *mut _ as *mut c_void),
    );
    let (w, h) = (bmp.bmWidth, bmp.bmHeight);
    if w <= 0 || h <= 0 {
        cleanup();
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
        color,
        0,
        h as u32,
        Some(buf.as_mut_ptr() as *mut c_void),
        &mut bi,
        DIB_RGB_COLORS,
    );
    ReleaseDC(screen, hdc);
    cleanup();
    if lines == 0 {
        return None;
    }

    // BGRA -> RGBA. Legacy icons carry no alpha; treat them as opaque.
    let has_alpha = buf.as_chunks::<4>().0.iter().any(|p| p[3] != 0);
    for p in buf.as_chunks_mut::<4>().0 {
        p.swap(0, 2);
        if !has_alpha {
            p[3] = 255;
        }
    }

    let img = RgbaImage::from_raw(w as u32, h as u32, buf)?;
    let mut out = Cursor::new(Vec::new());
    img.write_to(&mut out, ImageFormat::Png).ok()?;
    Some(out.into_inner())
}
