//! Master volume of the default playback device (Core Audio).
//! Commands are `async` so they run off the main (STA) thread and can use MTA COM.

use serde::Serialize;
use windows::Win32::{
    Foundation::BOOL,
    Media::Audio::{
        eConsole, eRender, Endpoints::IAudioEndpointVolume, IMMDeviceEnumerator, MMDeviceEnumerator,
    },
    System::Com::{CoCreateInstance, CoInitializeEx, CLSCTX_ALL, COINIT_MULTITHREADED},
};

use super::{err, CmdResult};

#[derive(Serialize)]
pub struct Volume {
    level: f32,
    muted: bool,
}

fn endpoint() -> windows::core::Result<IAudioEndpointVolume> {
    unsafe {
        // Already-initialized threads return S_FALSE / RPC_E_CHANGED_MODE; both are fine.
        let _ = CoInitializeEx(None, COINIT_MULTITHREADED);
        let enumerator: IMMDeviceEnumerator =
            CoCreateInstance(&MMDeviceEnumerator, None, CLSCTX_ALL)?;
        let device = enumerator.GetDefaultAudioEndpoint(eRender, eConsole)?;
        device.Activate::<IAudioEndpointVolume>(CLSCTX_ALL, None)
    }
}

fn read(ep: &IAudioEndpointVolume) -> windows::core::Result<Volume> {
    unsafe {
        Ok(Volume {
            level: ep.GetMasterVolumeLevelScalar()?,
            muted: ep.GetMute()?.as_bool(),
        })
    }
}

#[tauri::command]
pub async fn get_volume() -> CmdResult<Volume> {
    let ep = endpoint().map_err(err)?;
    read(&ep).map_err(err)
}

#[tauri::command]
pub async fn set_volume(level: f32) -> CmdResult<Volume> {
    let ep = endpoint().map_err(err)?;
    unsafe {
        ep.SetMasterVolumeLevelScalar(level.clamp(0.0, 1.0), std::ptr::null())
            .map_err(err)?;
        if level > 0.0 {
            ep.SetMute(BOOL::from(false), std::ptr::null())
                .map_err(err)?;
        }
    }
    read(&ep).map_err(err)
}

#[tauri::command]
pub async fn toggle_mute() -> CmdResult<Volume> {
    let ep = endpoint().map_err(err)?;
    unsafe {
        let muted = ep.GetMute().map_err(err)?.as_bool();
        ep.SetMute(BOOL::from(!muted), std::ptr::null())
            .map_err(err)?;
    }
    read(&ep).map_err(err)
}
