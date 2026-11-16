//! Calendars from secret iCal (.ics) links — Google, Outlook, iCloud and
//! anything else that publishes iCalendar. Read-only: feeds are fetched from
//! the URLs saved in widget settings (never from an arbitrary URL passed in),
//! parsed here, and recurring events are expanded with `rrule`.

use chrono::{DateTime, Duration as ChronoDuration, Utc};
use rrule::{RRuleSet, Tz};
use serde::Serialize;
use std::collections::{HashMap, HashSet};
use std::time::Duration;
use tauri::{AppHandle, Manager};

use super::{
    err,
    widgets::{load_widget_config, Http},
    CmdResult,
};

const REFRESH: Duration = Duration::from_secs(15 * 60);
const MAX_INSTANCES: u16 = 400;

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Event {
    /// Stable per occurrence: uid + start.
    pub id: String,
    pub calendar: String,
    pub color: String,
    pub title: String,
    pub location: String,
    /// Unix milliseconds.
    pub start: i64,
    pub end: i64,
    pub all_day: bool,
}

// ---------- iCalendar parsing ----------

#[derive(Default, Debug)]
struct Prop {
    params: HashMap<String, String>,
    value: String,
}

#[derive(Default, Debug)]
struct VEvent {
    props: HashMap<String, Vec<Prop>>,
}

impl VEvent {
    fn first(&self, name: &str) -> Option<&Prop> {
        self.props.get(name).and_then(|v| v.first())
    }
    fn text(&self, name: &str) -> String {
        self.first(name)
            .map(|p| unescape(&p.value))
            .unwrap_or_default()
    }
}

fn unescape(s: &str) -> String {
    s.replace("\\n", "\n")
        .replace("\\N", "\n")
        .replace("\\,", ",")
        .replace("\\;", ";")
        .replace("\\\\", "\\")
}

/// RFC 5545 line unfolding: a line starting with a space or tab continues the previous one.
fn unfold(text: &str) -> Vec<String> {
    let mut lines: Vec<String> = Vec::new();
    for raw in text.split('\n') {
        let line = raw.trim_end_matches('\r');
        if (line.starts_with(' ') || line.starts_with('\t')) && !lines.is_empty() {
            lines.last_mut().unwrap().push_str(&line[1..]);
        } else {
            lines.push(line.to_string());
        }
    }
    lines
}

fn parse_line(line: &str) -> Option<(String, Prop)> {
    // NAME;PARAM=value;PARAM2="quoted:value":VALUE — the first ':' outside quotes splits.
    let mut in_quotes = false;
    let split = line.char_indices().find(|&(_, c)| {
        if c == '"' {
            in_quotes = !in_quotes;
        }
        c == ':' && !in_quotes
    })?;
    let (head, value) = (&line[..split.0], &line[split.0 + 1..]);
    let mut parts = head.split(';');
    let name = parts.next()?.trim().to_ascii_uppercase();
    let params = parts
        .filter_map(|p| p.split_once('='))
        .map(|(k, v)| (k.to_ascii_uppercase(), v.trim_matches('"').to_string()))
        .collect();
    Some((
        name,
        Prop {
            params,
            value: value.to_string(),
        },
    ))
}

fn parse_events(text: &str) -> Vec<VEvent> {
    let mut out = Vec::new();
    let mut current: Option<VEvent> = None;
    for line in unfold(text) {
        match line.as_str() {
            "BEGIN:VEVENT" => current = Some(VEvent::default()),
            "END:VEVENT" => out.extend(current.take()),
            _ => {
                if let (Some(ev), Some((name, prop))) = (current.as_mut(), parse_line(&line)) {
                    ev.props.entry(name).or_default().push(prop);
                }
            }
        }
    }
    out
}

// ---------- time handling via rrule ----------

fn all_day(p: &Prop) -> bool {
    p.params
        .get("VALUE")
        .is_some_and(|v| v.eq_ignore_ascii_case("DATE"))
        || p.value.len() == 8
}

/// `DTSTART` line for rrule: keeps a TZID, makes dates midnight local time.
fn dtstart_line(p: &Prop, tzid: bool) -> String {
    let value = if all_day(p) {
        format!("{}T000000", &p.value[..8.min(p.value.len())])
    } else {
        p.value.clone()
    };
    match p.params.get("TZID") {
        Some(tz) if tzid && !value.ends_with('Z') => format!("DTSTART;TZID={tz}:{value}"),
        _ => format!("DTSTART:{value}"),
    }
}

fn exdate_lines(ev: &VEvent, tzid: bool) -> Vec<String> {
    ev.props
        .get("EXDATE")
        .into_iter()
        .flatten()
        .flat_map(|p| {
            p.value.split(',').map(move |v| Prop {
                params: p.params.clone(),
                value: v.to_string(),
            })
        })
        .map(|p| dtstart_line(&p, tzid).replacen("DTSTART", "EXDATE", 1))
        .collect()
}

/// Expands one event into occurrences between `from` and `to`. Tries the
/// event's TZID first; feeds with Windows-style zone names fall back to local time.
fn occurrences(ev: &VEvent, from: DateTime<Utc>, to: DateTime<Utc>) -> Vec<DateTime<Tz>> {
    let Some(start) = ev.first("DTSTART") else {
        return Vec::new();
    };
    let rule = ev
        .first("RRULE")
        .map(|p| p.value.clone())
        .unwrap_or_else(|| "FREQ=DAILY;COUNT=1".into());
    for tzid in [true, false] {
        let mut text = format!("{}\nRRULE:{rule}", dtstart_line(start, tzid));
        for ex in exdate_lines(ev, tzid) {
            text.push('\n');
            text.push_str(&ex);
        }
        if let Ok(set) = text.parse::<RRuleSet>() {
            let set = set
                .after(from.with_timezone(&Tz::UTC))
                .before(to.with_timezone(&Tz::UTC));
            return set.all(MAX_INSTANCES).dates;
        }
    }
    // Unparseable recurrence: still show the first occurrence.
    format!("{}\nRRULE:FREQ=DAILY;COUNT=1", dtstart_line(start, false))
        .parse::<RRuleSet>()
        .map(|s| s.all(1).dates)
        .unwrap_or_default()
}

/// Event length: DTEND − DTSTART, or DURATION, or 1 hour (1 day if all-day).
fn duration(ev: &VEvent) -> ChronoDuration {
    let Some(start) = ev.first("DTSTART") else {
        return ChronoDuration::hours(1);
    };
    if let Some(end) = ev.first("DTEND") {
        let one = |p: &Prop| {
            format!("{}\nRRULE:FREQ=DAILY;COUNT=1", dtstart_line(p, true))
                .parse::<RRuleSet>()
                .or_else(|_| {
                    format!("{}\nRRULE:FREQ=DAILY;COUNT=1", dtstart_line(p, false))
                        .parse::<RRuleSet>()
                })
                .ok()
                .and_then(|s| s.all(1).dates.into_iter().next())
        };
        if let (Some(a), Some(b)) = (one(start), one(end)) {
            let d = b.with_timezone(&Utc) - a.with_timezone(&Utc);
            if d > ChronoDuration::zero() {
                return d;
            }
        }
    }
    if let Some(d) = ev.first("DURATION").and_then(|p| parse_duration(&p.value)) {
        return d;
    }
    if all_day(start) {
        ChronoDuration::days(1)
    } else {
        ChronoDuration::hours(1)
    }
}

/// ISO 8601 durations as used by iCalendar: P1W, P1DT2H, PT30M, PT45S.
fn parse_duration(s: &str) -> Option<ChronoDuration> {
    let s = s.trim().trim_start_matches(['+', '-']).strip_prefix('P')?;
    let (mut total, mut num, mut in_time) = (0i64, String::new(), false);
    for c in s.chars() {
        match c {
            'T' => in_time = true,
            '0'..='9' => num.push(c),
            unit => {
                let n: i64 = num.parse().ok()?;
                num.clear();
                total += n * match (unit, in_time) {
                    ('W', _) => 604_800,
                    ('D', _) => 86_400,
                    ('H', true) => 3_600,
                    ('M', true) => 60,
                    ('S', true) => 1,
                    _ => return None,
                };
            }
        }
    }
    Some(ChronoDuration::seconds(total))
}

fn expand(
    text: &str,
    calendar: &str,
    color: &str,
    from: DateTime<Utc>,
    to: DateTime<Utc>,
) -> Vec<Event> {
    let events = parse_events(text);
    // Moved/edited single occurrences (RECURRENCE-ID) replace the master's occurrence.
    let overridden: HashSet<(String, i64)> = events
        .iter()
        .filter_map(|e| {
            let rid = e.first("RECURRENCE-ID")?;
            let fake = VEvent {
                props: HashMap::from([(
                    "DTSTART".to_string(),
                    vec![Prop {
                        params: rid.params.clone(),
                        value: rid.value.clone(),
                    }],
                )]),
            };
            let at = occurrences(
                &fake,
                from - ChronoDuration::days(400),
                to + ChronoDuration::days(400),
            )
            .into_iter()
            .next()?;
            Some((e.text("UID"), at.timestamp_millis()))
        })
        .collect();

    let mut out = Vec::new();
    for ev in &events {
        if ev.text("STATUS").eq_ignore_ascii_case("CANCELLED") {
            continue;
        }
        let uid = ev.text("UID");
        let is_override = ev.first("RECURRENCE-ID").is_some();
        let len = duration(ev);
        let all_day = ev.first("DTSTART").is_some_and(all_day);
        // Look back by the event length so ongoing events are included.
        for start in occurrences(ev, from - len, to) {
            let start_ms = start.timestamp_millis();
            if !is_override && overridden.contains(&(uid.clone(), start_ms)) {
                continue;
            }
            let end_ms = start_ms + len.num_milliseconds();
            if end_ms < from.timestamp_millis() {
                continue;
            }
            out.push(Event {
                id: format!("{uid}@{start_ms}"),
                calendar: calendar.to_string(),
                color: color.to_string(),
                title: {
                    let t = ev.text("SUMMARY");
                    if t.is_empty() {
                        "(No title)".into()
                    } else {
                        t
                    }
                },
                location: ev.text("LOCATION"),
                start: start_ms,
                end: end_ms,
                all_day,
            });
        }
    }
    out
}

// ---------- fetching ----------

/// Events from every saved calendar between now (minus ongoing) and `days` ahead.
pub async fn upcoming(app: &AppHandle, days: i64) -> CmdResult<(Vec<Event>, Vec<String>)> {
    let config = load_widget_config(app.clone())?;
    let http = app.state::<Http>();
    let now = Utc::now();
    let (from, to) = (
        now - ChronoDuration::hours(12),
        now + ChronoDuration::days(days.clamp(1, 60)),
    );
    let mut events = Vec::new();
    let mut errors = Vec::new();
    for cal in &config.calendars {
        let url = match reqwest::Url::parse(&cal.url) {
            Ok(u) => u,
            Err(e) => {
                errors.push(format!("{}: {e}", cal.name));
                continue;
            }
        };
        match http.get_text(url, REFRESH).await {
            Ok(text) => events.extend(expand(&text, &cal.name, &cal.color, from, to)),
            Err(e) => errors.push(format!("{}: {e}", cal.name)),
        }
    }
    events.sort_by_key(|e| (e.start, e.all_day));
    Ok((events, errors))
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CalendarData {
    events: Vec<Event>,
    /// Calendars that couldn't be loaded, with why.
    errors: Vec<String>,
}

#[tauri::command]
pub async fn calendar_events(app: AppHandle, days: i64) -> CmdResult<CalendarData> {
    let (events, errors) = upcoming(&app, days).await.map_err(err)?;
    Ok(CalendarData { events, errors })
}

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    const ICS: &str = "BEGIN:VCALENDAR\r\n\
BEGIN:VEVENT\r\nUID:one\r\nSUMMARY:Stand-up\\, daily\r\nDTSTART;TZID=Asia/Jakarta:20261116T090000\r\nDTEND;TZID=Asia/Jakarta:20261116T091500\r\nRRULE:FREQ=WEEKLY;BYDAY=MO,WE,FR\r\nEXDATE;TZID=Asia/Jakarta:20261118T090000\r\nEND:VEVENT\r\n\
BEGIN:VEVENT\r\nUID:one\r\nRECURRENCE-ID;TZID=Asia/Jakarta:20261120T090000\r\nSUMMARY:Stand-up (moved)\r\nDTSTART;TZID=Asia/Jakarta:20261120T110000\r\nDTEND;TZID=Asia/Jakarta:20261120T111500\r\nEND:VEVENT\r\n\
BEGIN:VEVENT\r\nUID:two\r\nSUMMARY:Holiday\r\nDTSTART;VALUE=DATE:20261117\r\nDTEND;VALUE=DATE:20261118\r\nEND:VEVENT\r\n\
BEGIN:VEVENT\r\nUID:three\r\nSUMMARY:Lunch with a very long\r\n  folded title\r\nDTSTART:20261117T050000Z\r\nDURATION:PT1H30M\r\nEND:VEVENT\r\n\
BEGIN:VEVENT\r\nUID:four\r\nSUMMARY:Cancelled thing\r\nSTATUS:CANCELLED\r\nDTSTART:20261117T050000Z\r\nEND:VEVENT\r\n\
END:VCALENDAR\r\n";

    fn window() -> (DateTime<Utc>, DateTime<Utc>) {
        (
            Utc.with_ymd_and_hms(2026, 11, 16, 0, 0, 0).unwrap(),
            Utc.with_ymd_and_hms(2026, 11, 23, 0, 0, 0).unwrap(),
        )
    }

    #[test]
    fn expands_weekly_with_exdate_and_override() {
        let (from, to) = window();
        let ev = expand(ICS, "Work", "#60a5fa", from, to);
        let standups: Vec<_> = ev
            .iter()
            .filter(|e| e.title.starts_with("Stand-up"))
            .collect();
        // Mon 16 and Fri 20 (moved to 11:00); Wed 18 is excluded.
        assert_eq!(standups.len(), 2, "{standups:#?}");
        assert_eq!(standups[0].title, "Stand-up, daily");
        // 09:00 Jakarta = 02:00 UTC
        assert_eq!(
            standups[0].start,
            Utc.with_ymd_and_hms(2026, 11, 16, 2, 0, 0)
                .unwrap()
                .timestamp_millis()
        );
        assert_eq!(standups[0].end - standups[0].start, 15 * 60 * 1000);
        assert_eq!(standups[1].title, "Stand-up (moved)");
        assert_eq!(
            standups[1].start,
            Utc.with_ymd_and_hms(2026, 11, 20, 4, 0, 0)
                .unwrap()
                .timestamp_millis()
        );
    }

    #[test]
    fn handles_all_day_folding_duration_and_cancelled() {
        let (from, to) = window();
        let ev = expand(ICS, "Work", "#60a5fa", from, to);
        let holiday = ev
            .iter()
            .find(|e| e.title == "Holiday")
            .expect("all-day event");
        assert!(holiday.all_day);
        assert_eq!(holiday.end - holiday.start, 24 * 3600 * 1000);
        let lunch = ev
            .iter()
            .find(|e| e.title.starts_with("Lunch"))
            .expect("folded event");
        assert_eq!(lunch.title, "Lunch with a very long folded title");
        assert_eq!(lunch.end - lunch.start, 90 * 60 * 1000);
        assert!(ev.iter().all(|e| e.title != "Cancelled thing"));
    }

    #[test]
    fn parses_durations() {
        assert_eq!(parse_duration("PT1H30M"), Some(ChronoDuration::minutes(90)));
        assert_eq!(parse_duration("P1W"), Some(ChronoDuration::days(7)));
        assert_eq!(parse_duration("P1DT2H"), Some(ChronoDuration::hours(26)));
        assert_eq!(parse_duration("garbage"), None);
    }
}
