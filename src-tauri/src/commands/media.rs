//! Now Playing: reads and controls whatever app reports to the Windows media
//! session (Spotify, browsers, the Media Player app, ...).

use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Serialize;
use std::sync::Mutex;
use windows::{
    Media::Control::{
        GlobalSystemMediaTransportControlsSession as Session,
        GlobalSystemMediaTransportControlsSessionManager as Manager,
        GlobalSystemMediaTransportControlsSessionPlaybackStatus as Status,
    },
    Storage::Streams::DataReader,
    Win32::System::Com::{CoInitializeEx, COINIT_MULTITHREADED},
};

use super::{err, CmdResult};

/// Album art bigger than this is skipped rather than sent over IPC every poll.
const MAX_ART_BYTES: u32 = 2 * 1024 * 1024;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NowPlaying {
    title: String,
    artist: String,
    album: String,
    /// AppUserModelID of the app that owns the session.
    app: String,
    playing: bool,
    position_secs: f64,
    duration_secs: f64,
    /// Album art as a data URL, when the app provides one.
    art: Option<String>,
}

fn current_session() -> windows::core::Result<Option<Session>> {
    let _ = unsafe { CoInitializeEx(None, COINIT_MULTITHREADED) };
    let manager = Manager::RequestAsync()?.get()?;
    // No active session is reported as an error for a null result.
    Ok(manager.GetCurrentSession().ok())
}

/// Art is cached per track so each poll doesn't re-read the image stream.
fn cached_art(key: &str, read: impl FnOnce() -> Option<String>) -> Option<String> {
    static CACHE: Mutex<Option<(String, Option<String>)>> = Mutex::new(None);
    let mut cache = CACHE.lock().ok()?;
    if let Some((k, art)) = cache.as_ref() {
        if k == key {
            return art.clone();
        }
    }
    let art = read();
    *cache = Some((key.to_string(), art.clone()));
    art
}

fn read_art(
    props: &windows::Media::Control::GlobalSystemMediaTransportControlsSessionMediaProperties,
) -> Option<String> {
    let reference = props.Thumbnail().ok()?;
    let stream = reference.OpenReadAsync().ok()?.get().ok()?;
    let size = stream.Size().ok()? as u32;
    if size == 0 || size > MAX_ART_BYTES {
        return None;
    }
    let content_type = stream
        .ContentType()
        .map(|s| s.to_string())
        .unwrap_or_default();
    let content_type = if content_type.starts_with("image/") {
        content_type
    } else {
        "image/png".into()
    };
    let reader = DataReader::CreateDataReader(&stream).ok()?;
    reader.LoadAsync(size).ok()?.get().ok()?;
    let mut buf = vec![0u8; size as usize];
    reader.ReadBytes(&mut buf).ok()?;
    Some(format!(
        "data:{content_type};base64,{}",
        STANDARD.encode(buf)
    ))
}

fn read_now_playing() -> windows::core::Result<Option<NowPlaying>> {
    let Some(session) = current_session()? else {
        return Ok(None);
    };
    let props = session.TryGetMediaPropertiesAsync()?.get()?;
    let title = props.Title()?.to_string();
    let artist = props.Artist()?.to_string();
    let album = props
        .AlbumTitle()
        .map(|s| s.to_string())
        .unwrap_or_default();
    let app = session
        .SourceAppUserModelId()
        .map(|s| s.to_string())
        .unwrap_or_default();
    let playing = session.GetPlaybackInfo()?.PlaybackStatus()? == Status::Playing;
    let timeline = session.GetTimelineProperties()?;
    let secs = |t: windows::Foundation::TimeSpan| t.Duration as f64 / 10_000_000.0;
    let position_secs = timeline.Position().map(secs).unwrap_or(0.0);
    let duration_secs = timeline.EndTime().map(secs).unwrap_or(0.0);
    let art = cached_art(&format!("{app}\u{1f}{title}\u{1f}{artist}"), || {
        read_art(&props)
    });
    Ok(Some(NowPlaying {
        title,
        artist,
        album,
        app,
        playing,
        position_secs,
        duration_secs,
        art,
    }))
}

/// Pauses the current media session if it is playing; true if it paused something.
pub(crate) fn pause_if_playing() -> bool {
    let Ok(Some(session)) = current_session() else {
        return false;
    };
    let playing = session
        .GetPlaybackInfo()
        .and_then(|i| i.PlaybackStatus())
        .is_ok_and(|s| s == Status::Playing);
    playing
        && session
            .TryPauseAsync()
            .and_then(|op| op.get())
            .unwrap_or(false)
}

#[tauri::command]
pub async fn now_playing() -> CmdResult<Option<NowPlaying>> {
    tauri::async_runtime::spawn_blocking(|| read_now_playing().map_err(err))
        .await
        .map_err(err)?
}

/// `action` is one of `toggle`, `next`, `previous`.
#[tauri::command]
pub async fn media_control(action: String) -> CmdResult<()> {
    tauri::async_runtime::spawn_blocking(move || {
        let Some(session) = current_session().map_err(err)? else {
            return Err("nothing is playing".to_string());
        };
        let op = match action.as_str() {
            "toggle" => session.TryTogglePlayPauseAsync(),
            "next" => session.TrySkipNextAsync(),
            "previous" => session.TrySkipPreviousAsync(),
            other => return Err(format!("unknown media action {other}")),
        };
        op.and_then(|o| o.get()).map(|_| ()).map_err(err)
    })
    .await
    .map_err(err)?
}
