//! Reserves a strip of the screen via the shell's appbar API, so maximized
//! windows stop at it (the same mechanism the Windows taskbar uses).

use std::mem::size_of;
use windows::Win32::{
    Foundation::{HWND, RECT},
    UI::Shell::{
        SHAppBarMessage, ABE_BOTTOM, ABE_TOP, ABM_NEW, ABM_QUERYPOS, ABM_REMOVE, ABM_SETPOS,
        APPBARDATA,
    },
};

const CALLBACK_MSG: u32 = 0x0400 + 77; // WM_USER + 77

#[derive(Clone, Copy, PartialEq, Debug)]
pub enum Edge {
    Top,
    Bottom,
}

fn data(hwnd: HWND) -> APPBARDATA {
    APPBARDATA {
        cbSize: size_of::<APPBARDATA>() as u32,
        hWnd: hwnd,
        uCallbackMessage: CALLBACK_MSG,
        ..Default::default()
    }
}

/// Registers (or re-positions) `hwnd` as an appbar `thickness` pixels deep on
/// `edge` of the monitor rectangle, and returns the rect the shell granted.
pub fn register(hwnd: HWND, edge: Edge, monitor: RECT, thickness: i32) -> RECT {
    unsafe {
        let mut abd = data(hwnd);
        SHAppBarMessage(ABM_NEW, &mut abd); // harmless if already registered

        abd.uEdge = if edge == Edge::Top {
            ABE_TOP
        } else {
            ABE_BOTTOM
        };
        abd.rc = monitor;
        match edge {
            Edge::Top => abd.rc.bottom = abd.rc.top + thickness,
            Edge::Bottom => abd.rc.top = abd.rc.bottom - thickness,
        }
        SHAppBarMessage(ABM_QUERYPOS, &mut abd);
        // The shell may move the rect past other appbars; keep our thickness.
        match edge {
            Edge::Top => abd.rc.bottom = abd.rc.top + thickness,
            Edge::Bottom => abd.rc.top = abd.rc.bottom - thickness,
        }
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
