//! Clipboard history for the notch: text and images you copy, newest first.
//!
//! A background thread watches the clipboard sequence number. History lives in
//! memory only; pinned items are also written to `clipboard-pins.json` so they
//! survive a restart. Copies that password managers mark as private are skipped.

use base64::{engine::general_purpose::STANDARD as B64, Engine};
use serde::{Deserialize, Serialize};
use std::borrow::Cow;
use std::fs;
use std::io::Cursor;
use std::path::PathBuf;
use std::sync::atomic::{AtomicBool, AtomicU64, Ordering};
use std::sync::Mutex;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager};
use windows::core::PCWSTR;
use windows::Win32::System::DataExchange::{
    GetClipboardSequenceNumber, IsClipboardFormatAvailable, RegisterClipboardFormatW,
};

use super::{err, wide, CmdResult};

pub const CLIPBOARD_EVENT: &str = "clipboard-changed";
const MAX_HISTORY: usize = 30;
const MAX_IMAGES: usize = 8;
const MAX_PINS: usize = 20;
const MAX_TEXT: usize = 200_000;
/// 4K screenshots fit; anything larger is skipped to bound memory.
const MAX_PIXELS: usize = 3840 * 2400;
const PREVIEW_CHARS: usize = 600;

#[derive(Clone, PartialEq, Debug)]
enum Content {
    Text(String),
    /// PNG bytes plus a small PNG data URL for the list.
    Image {
        png: Vec<u8>,
        thumb: String,
        width: u32,
        height: u32,
    },
}

struct Item {
    id: u64,
    content: Content,
    pinned: bool,
    at: i64,
}

static HISTORY: Mutex<Vec<Item>> = Mutex::new(Vec::new());
static ENABLED: AtomicBool = AtomicBool::new(true);
static NEXT_ID: AtomicU64 = AtomicU64::new(1);

/// What the frontend sees for one entry.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ClipItem {
    pub id: u64,
    /// `text` or `image`.
    pub kind: &'static str,
    pub text: Option<String>,
    pub thumb: Option<String>,
    pub width: Option<u32>,
    pub height: Option<u32>,
    pub pinned: bool,
    pub at: i64,
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

fn view(item: &Item) -> ClipItem {
    let mut c = ClipItem {
        id: item.id,
        kind: "text",
        text: None,
        thumb: None,
        width: None,
        height: None,
        pinned: item.pinned,
        at: item.at,
    };
    match &item.content {
        Content::Text(t) => c.text = Some(t.chars().take(PREVIEW_CHARS).collect()),
        Content::Image {
            thumb,
            width,
            height,
            ..
        } => {
            c.kind = "image";
            c.thumb = Some(thumb.clone());
            c.width = Some(*width);
            c.height = Some(*height);
        }
    }
    c
}

fn image_content(img: image::RgbaImage) -> Option<Content> {
    let (width, height) = img.dimensions();
    let mut png = Vec::new();
    image::DynamicImage::ImageRgba8(img.clone())
        .write_to(&mut Cursor::new(&mut png), image::ImageFormat::Png)
        .ok()?;
    let small = image::imageops::thumbnail(
        &img,
        width.min(240 * width / width.max(height).max(1)).max(1),
        height.min(240 * height / width.max(height).max(1)).max(1),
    );
    let mut t = Vec::new();
    image::DynamicImage::ImageRgba8(small)
        .write_to(&mut Cursor::new(&mut t), image::ImageFormat::Png)
        .ok()?;
    Some(Content::Image {
        png,
        thumb: format!("data:image/png;base64,{}", B64.encode(t)),
        width,
        height,
    })
}

/// Adds content at the top (or moves an equal entry there). Returns whether anything changed.
fn push(list: &mut Vec<Item>, content: Content) -> bool {
    if let Some(i) = list.iter().position(|x| x.content == content) {
        let mut item = list.remove(i);
        item.at = now_ms();
        list.insert(0, item);
        return true;
    }
    list.insert(
        0,
        Item {
            id: NEXT_ID.fetch_add(1, Ordering::SeqCst),
            content,
            pinned: false,
            at: now_ms(),
        },
    );
    // Drop the oldest unpinned entries beyond the limits.
    let (mut n, mut images) = (0, 0);
    list.retain(|x| {
        if x.pinned {
            return true;
        }
        n += 1;
        let image = matches!(x.content, Content::Image { .. });
        images += image as usize;
        n <= MAX_HISTORY && (!image || images <= MAX_IMAGES)
    });
    true
}

/// Password managers and other apps flag private copies with these formats.
// shortcut: `CanIncludeInClipboardHistory` is skipped whenever present, even when an app sets it to 1 (allow); read its DWORD if that ever matters.
fn is_private() -> bool {
    [
        "ExcludeClipboardContentFromMonitorProcessing",
        "CanIncludeInClipboardHistory",
        "Clipboard Viewer Ignore",
    ]
    .iter()
    .any(|name| unsafe {
        let n = wide(name);
        let f = RegisterClipboardFormatW(PCWSTR(n.as_ptr()));
        f != 0 && IsClipboardFormatAvailable(f).is_ok()
    })
}

fn read_clipboard() -> Option<Content> {
    let mut cb = arboard::Clipboard::new().ok()?;
    if let Ok(t) = cb.get_text() {
        if !t.trim().is_empty() && t.len() <= MAX_TEXT {
            return Some(Content::Text(t));
        }
    }
    let img = cb.get_image().ok()?;
    if img.width * img.height > MAX_PIXELS {
        return None;
    }
    let rgba =
        image::RgbaImage::from_raw(img.width as u32, img.height as u32, img.bytes.into_owned())?;
    image_content(rgba)
}

// ---------- pinned items on disk ----------

#[derive(Serialize, Deserialize)]
struct Pin {
    #[serde(default)]
    text: Option<String>,
    /// Base64 PNG.
    #[serde(default)]
    png: Option<String>,
}

fn pins_path(app: &AppHandle) -> CmdResult<PathBuf> {
    let dir = app.path().app_data_dir().map_err(err)?;
    fs::create_dir_all(&dir).map_err(err)?;
    Ok(dir.join("clipboard-pins.json"))
}

fn save_pins(app: &AppHandle, list: &[Item]) -> CmdResult<()> {
    let pins: Vec<Pin> = list
        .iter()
        .filter(|x| x.pinned)
        .map(|x| match &x.content {
            Content::Text(t) => Pin {
                text: Some(t.clone()),
                png: None,
            },
            Content::Image { png, .. } => Pin {
                text: None,
                png: Some(B64.encode(png)),
            },
        })
        .collect();
    let path = pins_path(app)?;
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, serde_json::to_string(&pins).map_err(err)?).map_err(err)?;
    fs::rename(&tmp, &path).map_err(err)
}

fn load_pins(app: &AppHandle) -> Vec<Item> {
    let Some(pins) = pins_path(app)
        .ok()
        .and_then(|p| fs::read_to_string(p).ok())
        .and_then(|t| serde_json::from_str::<Vec<Pin>>(&t).ok())
    else {
        return Vec::new();
    };
    pins.into_iter()
        .take(MAX_PINS)
        .filter_map(|p| {
            let content = match (p.text, p.png) {
                (Some(t), _) if t.len() <= MAX_TEXT => Content::Text(t),
                (_, Some(b)) => {
                    let bytes = B64.decode(b).ok()?;
                    let img = image::load_from_memory_with_format(&bytes, image::ImageFormat::Png)
                        .ok()?
                        .to_rgba8();
                    image_content(img)?
                }
                _ => return None,
            };
            Some(Item {
                id: NEXT_ID.fetch_add(1, Ordering::SeqCst),
                content,
                pinned: true,
                at: now_ms(),
            })
        })
        .collect()
}

// ---------- watcher ----------

/// Loads pinned items and starts watching the clipboard.
pub fn start(app: AppHandle) {
    let pins = load_pins(&app);
    if let Ok(mut h) = HISTORY.lock() {
        *h = pins;
    }
    std::thread::spawn(move || {
        let mut last = unsafe { GetClipboardSequenceNumber() };
        loop {
            std::thread::sleep(Duration::from_millis(400));
            let seq = unsafe { GetClipboardSequenceNumber() };
            if seq == last {
                continue;
            }
            last = seq;
            if !ENABLED.load(Ordering::SeqCst) {
                continue;
            }
            // Let the source app finish placing all its formats.
            std::thread::sleep(Duration::from_millis(120));
            if is_private() {
                continue;
            }
            let Some(content) = read_clipboard() else {
                continue;
            };
            let changed = HISTORY.lock().map(|mut h| push(&mut h, content));
            if changed.unwrap_or(false) {
                let _ = app.emit(CLIPBOARD_EVENT, ());
            }
        }
    });
}

/// Settings → Notch → Clipboard history. Turning it off forgets unpinned items.
pub fn set_enabled(app: &AppHandle, on: bool) {
    if ENABLED.swap(on, Ordering::SeqCst) && !on {
        if let Ok(mut h) = HISTORY.lock() {
            h.retain(|x| x.pinned);
        }
        let _ = app.emit(CLIPBOARD_EVENT, ());
    }
}

// ---------- commands ----------

#[tauri::command]
pub fn clipboard_history() -> CmdResult<Vec<ClipItem>> {
    let h = HISTORY.lock().map_err(err)?;
    // Pinned first, then newest first.
    let mut items: Vec<ClipItem> = h.iter().filter(|x| x.pinned).map(view).collect();
    items.extend(h.iter().filter(|x| !x.pinned).map(view));
    Ok(items)
}

/// Puts an entry back on the clipboard (the watcher then moves it to the top).
#[tauri::command]
pub fn clipboard_copy(id: u64) -> CmdResult<()> {
    let content = HISTORY
        .lock()
        .map_err(err)?
        .iter()
        .find(|x| x.id == id)
        .map(|x| x.content.clone())
        .ok_or("that item is no longer in the history")?;
    let mut cb = arboard::Clipboard::new().map_err(err)?;
    match content {
        Content::Text(t) => cb.set_text(t).map_err(err),
        Content::Image { png, .. } => {
            let img = image::load_from_memory_with_format(&png, image::ImageFormat::Png)
                .map_err(err)?
                .to_rgba8();
            cb.set_image(arboard::ImageData {
                width: img.width() as usize,
                height: img.height() as usize,
                bytes: Cow::Owned(img.into_raw()),
            })
            .map_err(err)
        }
    }
}

#[tauri::command]
pub fn clipboard_pin(app: AppHandle, id: u64, pinned: bool) -> CmdResult<()> {
    {
        let mut h = HISTORY.lock().map_err(err)?;
        let count = h.iter().filter(|x| x.pinned).count();
        let item = h.iter_mut().find(|x| x.id == id).ok_or("item not found")?;
        if pinned && !item.pinned && count >= MAX_PINS {
            return Err(format!("You can pin up to {MAX_PINS} items."));
        }
        item.pinned = pinned;
        save_pins(&app, &h)?;
    }
    let _ = app.emit(CLIPBOARD_EVENT, ());
    Ok(())
}

#[tauri::command]
pub fn clipboard_delete(app: AppHandle, id: u64) -> CmdResult<()> {
    {
        let mut h = HISTORY.lock().map_err(err)?;
        let was_pinned = h.iter().any(|x| x.id == id && x.pinned);
        h.retain(|x| x.id != id);
        if was_pinned {
            save_pins(&app, &h)?;
        }
    }
    let _ = app.emit(CLIPBOARD_EVENT, ());
    Ok(())
}

/// Clears everything except pinned items.
#[tauri::command]
pub fn clipboard_clear(app: AppHandle) -> CmdResult<()> {
    HISTORY.lock().map_err(err)?.retain(|x| x.pinned);
    let _ = app.emit(CLIPBOARD_EVENT, ());
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn text(s: &str) -> Content {
        Content::Text(s.into())
    }

    #[test]
    fn repeats_move_to_the_top_instead_of_duplicating() {
        let mut list = Vec::new();
        push(&mut list, text("a"));
        push(&mut list, text("b"));
        push(&mut list, text("a"));
        let order: Vec<_> = list.iter().map(|x| x.content.clone()).collect();
        assert_eq!(order, vec![text("a"), text("b")]);
    }

    #[test]
    fn history_is_capped_but_pins_are_kept() {
        let mut list = Vec::new();
        push(&mut list, text("pinned"));
        list[0].pinned = true;
        for i in 0..MAX_HISTORY + 10 {
            push(&mut list, text(&i.to_string()));
        }
        assert_eq!(list.len(), MAX_HISTORY + 1);
        assert!(list.iter().any(|x| x.pinned));
    }

    #[test]
    fn images_round_trip_through_png_with_a_thumbnail() {
        let img = image::RgbaImage::from_pixel(600, 300, image::Rgba([10, 20, 30, 255]));
        let Some(Content::Image {
            png,
            thumb,
            width,
            height,
        }) = image_content(img)
        else {
            panic!("expected an image");
        };
        assert_eq!((width, height), (600, 300));
        assert!(thumb.starts_with("data:image/png;base64,"));
        let back = image::load_from_memory(&png).unwrap();
        assert_eq!(back.width(), 600);
    }
}
