//! Reserves a strip of the screen for the bar via the shell's appbar API,
//! so maximized windows stop below it (same mechanism as the Windows taskbar).

use std::mem::size_of;
use windows::Win32::{
    Foundation::{HWND, RECT},
    UI::Shell::{
        SHAppBarMessage, ABE_TOP, ABM_NEW, ABM_QUERYPOS, ABM_REMOVE, ABM_SETPOS, APPBARDATA,
    },
};

const CALLBACK_MSG: u32 = 0x0400 + 77; // WM_USER + 77

fn data(hwnd: HWND) -> APPBARDATA {
    APPBARDATA {
        cbSize: size_of::<APPBARDATA>() as u32,
        hWnd: hwnd,
        uCallbackMessage: CALLBACK_MSG,
        ..Default::default()
    }
}

/// Registers `hwnd` as a top-edge appbar and returns the rect the shell granted.
pub fn register_top(hwnd: HWND, x: i32, y: i32, width: i32, height: i32) -> RECT {
    unsafe {
        let mut abd = data(hwnd);
        SHAppBarMessage(ABM_NEW, &mut abd);

        abd.uEdge = ABE_TOP;
        abd.rc = RECT {
            left: x,
            top: y,
            right: x + width,
            bottom: y + height,
        };
        SHAppBarMessage(ABM_QUERYPOS, &mut abd);
        abd.rc.bottom = abd.rc.top + height;
        SHAppBarMessage(ABM_SETPOS, &mut abd);
        abd.rc
    }
}

pub fn unregister(hwnd: HWND) {
    unsafe {
        let mut abd = data(hwnd);
        SHAppBarMessage(ABM_REMOVE, &mut abd);
    }
}
