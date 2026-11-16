//! CPU, memory and battery readings for the bar.

use serde::Serialize;
use std::sync::Mutex;
use sysinfo::System;
use tauri::State;
use windows::Win32::System::Power::{GetSystemPowerStatus, SYSTEM_POWER_STATUS};

#[derive(Default)]
pub struct StatsState(pub(crate) Mutex<Option<System>>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Stats {
    cpu: f32,
    mem_used: u64,
    mem_total: u64,
    battery: Option<u8>,
    charging: bool,
}

#[tauri::command]
pub fn get_stats(state: State<'_, StatsState>) -> Stats {
    let mut guard = state.0.lock().unwrap_or_else(|p| p.into_inner());
    let sys = guard.get_or_insert_with(System::new);
    // CPU usage is a delta between refreshes; the frontend polls regularly.
    sys.refresh_cpu_usage();
    sys.refresh_memory();

    let (battery, charging) = battery();
    Stats {
        cpu: sys.global_cpu_usage(),
        mem_used: sys.used_memory(),
        mem_total: sys.total_memory(),
        battery,
        charging,
    }
}

fn battery() -> (Option<u8>, bool) {
    let mut s = SYSTEM_POWER_STATUS::default();
    if unsafe { GetSystemPowerStatus(&mut s) }.is_err() {
        return (None, false);
    }
    // 128 = no system battery, 255 = unknown percentage.
    if s.BatteryFlag & 128 != 0 || s.BatteryLifePercent == 255 {
        return (None, s.ACLineStatus == 1);
    }
    (Some(s.BatteryLifePercent), s.ACLineStatus == 1)
}
