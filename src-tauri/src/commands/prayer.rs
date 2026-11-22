//! Prayer times, calculated offline from the shared location (no HTTP).
//!
//! Standard solar-angle method: Fajr and Isha at a sun depression angle that
//! depends on the convention, sunrise/sunset at 0.833°, Asr when an object's
//! shadow is its length (Hanafi: twice its length) plus its noon shadow.

use serde::Serialize;

use super::CmdResult;

/// (id, Fajr angle, Isha angle or None for "90 min after Maghrib", ihtiyat minutes)
const METHODS: [(&str, f64, Option<f64>, f64); 6] = [
    // Kementerian Agama RI: 20° / 18°, with a 2-minute safety margin (ihtiyat).
    ("kemenag", 20.0, Some(18.0), 2.0),
    ("mwl", 18.0, Some(17.0), 0.0),
    ("isna", 15.0, Some(15.0), 0.0),
    ("egypt", 19.5, Some(17.5), 0.0),
    ("karachi", 18.0, Some(18.0), 0.0),
    ("makkah", 18.5, None, 0.0),
];

pub fn is_method(id: &str) -> bool {
    METHODS.iter().any(|m| m.0 == id)
}

#[derive(Serialize, Debug, Clone, Copy, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct PrayerDay {
    /// Unix milliseconds; `None` where the sun never reaches the angle (high latitudes).
    pub fajr: Option<i64>,
    pub sunrise: Option<i64>,
    pub dhuhr: Option<i64>,
    pub asr: Option<i64>,
    pub maghrib: Option<i64>,
    pub isha: Option<i64>,
    /// Tomorrow's Fajr, for the countdown after Isha.
    pub next_fajr: Option<i64>,
}

fn sin(d: f64) -> f64 {
    d.to_radians().sin()
}
fn cos(d: f64) -> f64 {
    d.to_radians().cos()
}
fn tan(d: f64) -> f64 {
    d.to_radians().tan()
}
fn fix(a: f64, b: f64) -> f64 {
    a.rem_euclid(b)
}

/// Julian day at 0h UTC of a civil date. Linear in `day`, so `day + 1` is tomorrow.
fn julian(year: i32, month: u32, day: f64) -> f64 {
    let (mut y, mut m) = (year as f64, month as f64);
    if m <= 2.0 {
        y -= 1.0;
        m += 12.0;
    }
    let a = (y / 100.0).floor();
    let b = 2.0 - a + (a / 4.0).floor();
    (365.25 * (y + 4716.0)).floor() + (30.6001 * (m + 1.0)).floor() + day + b - 1524.5
}

/// Sun declination (degrees) and equation of time (hours).
fn sun(jd: f64) -> (f64, f64) {
    let d = jd - 2451545.0;
    let g = fix(357.529 + 0.98560028 * d, 360.0);
    let q = fix(280.459 + 0.98564736 * d, 360.0);
    let l = fix(q + 1.915 * sin(g) + 0.020 * sin(2.0 * g), 360.0);
    let e = 23.439 - 0.00000036 * d;
    let ra = fix((cos(e) * sin(l)).atan2(cos(l)).to_degrees() / 15.0, 24.0);
    let decl = (sin(e) * sin(l)).asin().to_degrees();
    let eqt = q / 15.0 - ra;
    // Wrap into ±12 h so it stays a small correction.
    (decl, (eqt + 12.0).rem_euclid(24.0) - 12.0)
}

/// UTC hours after 0h of `jd_date` for [fajr, sunrise, dhuhr, asr, maghrib, isha].
fn day_hours(lat: f64, lon: f64, jd_date: f64, method: usize, asr_factor: f64) -> [f64; 6] {
    let (_, fajr_angle, isha_angle, ihtiyat) = METHODS[method];
    let jd = jd_date - lon / 360.0;
    let noon = |h: f64| 12.0 - sun(jd + h / 24.0).1;
    // Time the sun is `angle` degrees below the horizon, before (ccw) or after noon.
    let at_angle = |angle: f64, h: f64, before: bool| {
        let (decl, _) = sun(jd + h / 24.0);
        let x = (-sin(angle) - sin(decl) * sin(lat)) / (cos(decl) * cos(lat));
        let t = x.acos().to_degrees() / 15.0; // NaN when |x| > 1
        if before {
            noon(h) - t
        } else {
            noon(h) + t
        }
    };
    let asr = |h: f64| {
        let (decl, _) = sun(jd + h / 24.0);
        let angle = -(1.0 / (asr_factor + tan((lat - decl).abs())))
            .atan()
            .to_degrees();
        at_angle(angle, h, false)
    };

    // Two refinement passes: each time uses the sun's position at its own estimate.
    let mut t = [5.0, 6.0, 12.0, 13.0, 18.0, 18.0];
    for _ in 0..2 {
        t = [
            at_angle(fajr_angle, t[0], true),
            at_angle(0.833, t[1], true),
            noon(t[2]),
            asr(t[3]),
            at_angle(0.833, t[4], false),
            match isha_angle {
                Some(a) => at_angle(a, t[5], false),
                None => t[4] + 1.5,
            },
        ];
    }
    if isha_angle.is_none() {
        t[5] = t[4] + 1.5;
    }
    let m = ihtiyat / 60.0;
    let adj = [m, -m, m, m, m, m];
    std::array::from_fn(|i| t[i] + adj[i] - lon / 15.0)
}

fn to_ms(jd_date: f64, hours: f64) -> Option<i64> {
    hours
        .is_finite()
        .then(|| ((jd_date - 2440587.5) * 86_400_000.0 + hours * 3_600_000.0).round() as i64)
}

pub fn calculate(
    lat: f64,
    lon: f64,
    year: i32,
    month: u32,
    day: u32,
    method: &str,
    asr: &str,
) -> CmdResult<PrayerDay> {
    let valid = lat.is_finite()
        && lon.is_finite()
        && (-90.0..=90.0).contains(&lat)
        && (-180.0..=180.0).contains(&lon)
        && (1900..=2200).contains(&year)
        && (1..=12).contains(&month)
        && (1..=31).contains(&day);
    if !valid {
        return Err("invalid date or location".into());
    }
    let m = METHODS
        .iter()
        .position(|x| x.0 == method)
        .ok_or("unknown calculation method")?;
    let factor = match asr {
        "standard" => 1.0,
        "hanafi" => 2.0,
        _ => return Err("unknown Asr convention".into()),
    };
    let jd = julian(year, month, day as f64);
    let h = day_hours(lat, lon, jd, m, factor);
    let next = day_hours(lat, lon, jd + 1.0, m, factor);
    Ok(PrayerDay {
        fajr: to_ms(jd, h[0]),
        sunrise: to_ms(jd, h[1]),
        dhuhr: to_ms(jd, h[2]),
        asr: to_ms(jd, h[3]),
        maghrib: to_ms(jd, h[4]),
        isha: to_ms(jd, h[5]),
        next_fajr: to_ms(jd + 1.0, next[0]),
    })
}

/// Prayer times for the given local calendar date at a location.
#[tauri::command]
pub fn prayer_times(
    lat: f64,
    lon: f64,
    year: i32,
    month: u32,
    day: u32,
    method: String,
    asr: String,
) -> CmdResult<PrayerDay> {
    calculate(lat, lon, year, month, day, &method, &asr)
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Minutes past midnight at a fixed UTC offset.
    fn local_min(ms: Option<i64>, offset_h: i64) -> i64 {
        (ms.unwrap() / 60_000 + offset_h * 60).rem_euclid(1440)
    }

    #[test]
    fn jakarta_times_are_plausible_and_ordered() {
        let d = calculate(-6.2088, 106.8456, 2026, 11, 22, "kemenag", "standard").unwrap();
        let all = [
            d.fajr,
            d.sunrise,
            d.dhuhr,
            d.asr,
            d.maghrib,
            d.isha,
            d.next_fajr,
        ];
        assert!(all.windows(2).all(|w| w[0].unwrap() < w[1].unwrap()));
        // Solar noon in Jakarta in late November is ~11:38 WIB (+2 min ihtiyat).
        let dhuhr = local_min(d.dhuhr, 7);
        assert!(
            (11 * 60 + 37..=11 * 60 + 45).contains(&dhuhr),
            "dhuhr {dhuhr}"
        );
        let fajr = local_min(d.fajr, 7);
        assert!((3 * 60 + 45..=4 * 60 + 10).contains(&fajr), "fajr {fajr}");
        let maghrib = local_min(d.maghrib, 7);
        assert!(
            (17 * 60 + 45..=18 * 60 + 5).contains(&maghrib),
            "maghrib {maghrib}"
        );
        let gap = d.next_fajr.unwrap() - d.fajr.unwrap();
        assert!(
            (gap - 86_400_000).abs() < 120_000,
            "tomorrow is ~24 h later"
        );
    }

    #[test]
    fn equator_at_the_equinox() {
        let d = calculate(0.0, 0.0, 2026, 3, 20, "mwl", "standard").unwrap();
        // Equation of time is about -7.5 min in late March.
        let noon = local_min(d.dhuhr, 0);
        assert!((12 * 60 + 4..=12 * 60 + 11).contains(&noon), "noon {noon}");
        let rise = local_min(d.sunrise, 0);
        assert!((6 * 60..=6 * 60 + 10).contains(&rise), "sunrise {rise}");
    }

    #[test]
    fn hanafi_asr_is_later_and_makkah_isha_follows_maghrib() {
        let std = calculate(21.42, 39.83, 2026, 6, 1, "makkah", "standard").unwrap();
        let han = calculate(21.42, 39.83, 2026, 6, 1, "makkah", "hanafi").unwrap();
        assert!(han.asr.unwrap() > std.asr.unwrap());
        assert_eq!(std.isha.unwrap() - std.maghrib.unwrap(), 90 * 60_000);
    }

    #[test]
    fn polar_night_has_no_sunrise() {
        let d = calculate(78.2, 15.6, 2026, 12, 21, "mwl", "standard").unwrap();
        assert!(d.sunrise.is_none());
        assert!(d.dhuhr.is_some());
    }

    #[test]
    fn bad_input_is_rejected() {
        assert!(calculate(f64::NAN, 0.0, 2026, 1, 1, "mwl", "standard").is_err());
        assert!(calculate(95.0, 0.0, 2026, 1, 1, "mwl", "standard").is_err());
        assert!(calculate(0.0, 0.0, 2026, 13, 1, "mwl", "standard").is_err());
        assert!(calculate(0.0, 0.0, 2026, 1, 1, "nope", "standard").is_err());
        assert!(calculate(0.0, 0.0, 2026, 1, 1, "mwl", "maliki?").is_err());
    }
}
