//! Widgets working together: calendar events drive reminders and pause music
//! for meetings; quiet hours hold Harbor's notifications. Runs in the backend so
//! it works while every Harbor window is hidden. Everything stays on this PC.

use std::collections::HashSet;
use std::time::Duration;
use tauri::AppHandle;
use tauri_plugin_notification::NotificationExt;
use windows::Win32::System::SystemInformation::GetLocalTime;

use super::{
    apps::{in_window, load_config, parse_hhmm, Automations},
    calendar::{upcoming, Event},
    media,
};

const TICK: Duration = Duration::from_secs(30);

fn minutes_now() -> u32 {
    let t = unsafe { GetLocalTime() };
    t.wHour as u32 * 60 + t.wMinute as u32
}

pub fn quiet_now(a: &Automations) -> bool {
    match (
        a.quiet_hours,
        parse_hhmm(&a.quiet_start),
        parse_hhmm(&a.quiet_end),
    ) {
        (true, Some(s), Some(e)) => in_window(minutes_now(), s, e),
        _ => false,
    }
}

fn notify(app: &AppHandle, a: &Automations, title: &str, body: &str) {
    if quiet_now(a) {
        return;
    }
    let _ = app.notification().builder().title(title).body(body).show();
}

/// Events whose action window is open now and that weren't handled yet.
fn due<'a>(
    events: &'a [Event],
    now_ms: i64,
    lead_ms: i64,
    grace_ms: i64,
    done: &HashSet<String>,
) -> Vec<&'a Event> {
    events
        .iter()
        .filter(|e| {
            !e.all_day
                && !done.contains(&e.id)
                && now_ms >= e.start - lead_ms
                && now_ms < e.start + grace_ms
        })
        .collect()
}

pub fn start(app: AppHandle) {
    let _ = std::thread::Builder::new()
        .name("harbor-automations".into())
        .spawn(move || {
            let mut reminded: HashSet<String> = HashSet::new();
            let mut paused: HashSet<String> = HashSet::new();
            loop {
                std::thread::sleep(TICK);
                let Ok(config) = load_config(app.clone()) else {
                    continue;
                };
                let a = config.automations;
                if !a.remind_before_events && !a.pause_media_for_meetings {
                    continue;
                }
                let Ok((events, _)) = tauri::async_runtime::block_on(upcoming(&app, 1)) else {
                    continue;
                };
                let now = chrono::Utc::now().timestamp_millis();

                if a.remind_before_events {
                    let lead = a.remind_minutes as i64 * 60_000;
                    for e in due(&events, now, lead, 60_000, &reminded) {
                        let mins = ((e.start - now) as f64 / 60_000.0).ceil().max(0.0) as i64;
                        let when = if mins <= 0 {
                            "now".to_string()
                        } else {
                            format!("in {mins} min")
                        };
                        let body = if e.location.is_empty() {
                            e.calendar.clone()
                        } else {
                            format!("{} · {}", e.calendar, e.location)
                        };
                        notify(&app, &a, &format!("{} starts {when}", e.title), &body);
                        reminded.insert(e.id.clone());
                    }
                }
                if a.pause_media_for_meetings {
                    // At the start time (and for 2 minutes after, in case Harbor was busy).
                    for e in due(&events, now, 0, 120_000, &paused) {
                        paused.insert(e.id.clone());
                        if media::pause_if_playing() {
                            notify(
                                &app,
                                &a,
                                "Paused your music",
                                &format!("{} is starting", e.title),
                            );
                        }
                    }
                }
                // Forget events that are long over.
                let keep: HashSet<&String> = events.iter().map(|e| &e.id).collect();
                reminded.retain(|id| keep.contains(id));
                paused.retain(|id| keep.contains(id));
            }
        });
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ev(id: &str, start: i64, all_day: bool) -> Event {
        Event {
            id: id.into(),
            calendar: "Work".into(),
            color: "#fff".into(),
            title: id.into(),
            location: String::new(),
            start,
            end: start + 3_600_000,
            all_day,
        }
    }

    #[test]
    fn due_respects_lead_grace_all_day_and_done() {
        let now = 1_000_000_000;
        let events = vec![
            ev("soon", now + 5 * 60_000, false),
            ev("later", now + 30 * 60_000, false),
            ev("allday", now + 60_000, true),
            ev("started", now - 30_000, false),
            ev("old", now - 10 * 60_000, false),
        ];
        let mut done = HashSet::new();
        let ids = |v: Vec<&Event>| v.into_iter().map(|e| e.id.clone()).collect::<Vec<_>>();
        assert_eq!(
            ids(due(&events, now, 10 * 60_000, 60_000, &done)),
            ["soon", "started"]
        );
        done.insert("soon".to_string());
        assert_eq!(
            ids(due(&events, now, 10 * 60_000, 60_000, &done)),
            ["started"]
        );
        assert_eq!(
            ids(due(&events, now, 0, 120_000, &HashSet::new())),
            ["started"]
        );
    }
}
