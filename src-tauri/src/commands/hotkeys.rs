//! Win+1 … Win+9 open the dock's apps by position, like the taskbar does.
//!
//! Explorer already owns those hotkeys, so `RegisterHotKey` can't take them;
//! a low-level keyboard hook sees them first instead. It only looks at the
//! digit keys 1–9 while a Windows key is held, and passes everything else on.

use std::sync::atomic::{AtomicBool, AtomicU32, Ordering};
use std::sync::mpsc::{channel, Sender};
use std::sync::OnceLock;
use tauri::{AppHandle, Emitter};
use windows::Win32::Foundation::{HINSTANCE, LPARAM, LRESULT, WPARAM};
use windows::Win32::System::LibraryLoader::GetModuleHandleW;
use windows::Win32::UI::Input::KeyboardAndMouse::{
    GetAsyncKeyState, SendInput, INPUT, INPUT_0, INPUT_KEYBOARD, KEYBDINPUT, KEYBD_EVENT_FLAGS,
    KEYEVENTF_KEYUP, VIRTUAL_KEY, VK_CONTROL, VK_LWIN, VK_MENU, VK_RWIN, VK_SHIFT,
};
use windows::Win32::UI::WindowsAndMessaging::{
    CallNextHookEx, GetMessageW, SetWindowsHookExW, HC_ACTION, KBDLLHOOKSTRUCT, LLKHF_INJECTED,
    MSG, WH_KEYBOARD_LL, WM_KEYDOWN, WM_SYSKEYDOWN,
};

pub const HOTKEY_EVENT: &str = "dock-hotkey";

static ENABLED: AtomicBool = AtomicBool::new(true);
/// Digits whose key-down we swallowed, so their key-up is swallowed too.
static HELD: AtomicU32 = AtomicU32::new(0);
static SEND: OnceLock<Sender<u32>> = OnceLock::new();

/// An unassigned virtual key: tapping it while Win is held stops the Start
/// menu from opening when Win is released (we swallowed the digit it saw).
const MASK_KEY: u16 = 0xE8;

fn down(vk: VIRTUAL_KEY) -> bool {
    unsafe { GetAsyncKeyState(vk.0 as i32) as u16 & 0x8000 != 0 }
}

fn tap_mask_key() {
    let key = |flags| INPUT {
        r#type: INPUT_KEYBOARD,
        Anonymous: INPUT_0 {
            ki: KEYBDINPUT {
                wVk: VIRTUAL_KEY(MASK_KEY),
                dwFlags: flags,
                ..Default::default()
            },
        },
    };
    let inputs = [key(KEYBD_EVENT_FLAGS(0)), key(KEYEVENTF_KEYUP)];
    unsafe { SendInput(&inputs, std::mem::size_of::<INPUT>() as i32) };
}

unsafe extern "system" fn hook(code: i32, wparam: WPARAM, lparam: LPARAM) -> LRESULT {
    if code == HC_ACTION as i32 && ENABLED.load(Ordering::Relaxed) {
        let kb = &*(lparam.0 as *const KBDLLHOOKSTRUCT);
        let injected = kb.flags.0 & LLKHF_INJECTED.0 != 0;
        if (0x31..=0x39).contains(&kb.vkCode) && !injected {
            let n = kb.vkCode - 0x30;
            let bit = 1u32 << n;
            let is_down = matches!(wparam.0 as u32, WM_KEYDOWN | WM_SYSKEYDOWN);
            if is_down {
                // Plain Win+N only; Shift/Ctrl/Alt variants keep their Windows meaning.
                let plain = (down(VK_LWIN) || down(VK_RWIN))
                    && !down(VK_SHIFT)
                    && !down(VK_CONTROL)
                    && !down(VK_MENU);
                if plain {
                    // Auto-repeat while held fires once.
                    if HELD.fetch_or(bit, Ordering::SeqCst) & bit == 0 {
                        tap_mask_key();
                        if let Some(tx) = SEND.get() {
                            let _ = tx.send(n);
                        }
                    }
                    return LRESULT(1);
                }
            } else if HELD.fetch_and(!bit, Ordering::SeqCst) & bit != 0 {
                return LRESULT(1);
            }
        }
    }
    CallNextHookEx(None, code, wparam, lparam)
}

/// Installs the hook on its own thread (hooks need a message loop) and
/// forwards presses to the dock as `dock-hotkey` with the 1-based position.
pub fn start(app: AppHandle) {
    let (tx, rx) = channel::<u32>();
    if SEND.set(tx).is_err() {
        return;
    }
    // Emitting happens off the hook thread so the hook returns quickly.
    std::thread::spawn(move || {
        for n in rx {
            let _ = app.emit_to(tauri::EventTarget::webview_window("dock"), HOTKEY_EVENT, n);
        }
    });
    std::thread::spawn(|| unsafe {
        let module = GetModuleHandleW(None)
            .map(|m| HINSTANCE(m.0))
            .unwrap_or_default();
        let Ok(_hook) = SetWindowsHookExW(WH_KEYBOARD_LL, Some(hook), module, 0) else {
            return;
        };
        let mut msg = MSG::default();
        while GetMessageW(&mut msg, None, 0, 0).as_bool() {}
    });
}

/// Settings → Dock → Win+1…9.
pub fn set_enabled(on: bool) {
    ENABLED.store(on, Ordering::SeqCst);
    if !on {
        HELD.store(0, Ordering::SeqCst);
    }
}
