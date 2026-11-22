//! Data for the widget panel. Every request goes to a fixed public endpoint
//! (no API keys); parameters are validated and URL-encoded here, and responses
//! are cached briefly so several windows polling the same data cost one request.

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::collections::HashMap;
use std::fs;
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::{Duration, Instant};
use sysinfo::{Disks, Networks};
use tauri::{AppHandle, Emitter, Manager, State};

use super::{err, CmdResult};

// ---------- HTTP with a small TTL cache ----------

pub struct Http {
    client: reqwest::Client,
    cache: Mutex<HashMap<String, (Instant, Value)>>,
}

impl Default for Http {
    fn default() -> Self {
        let client = reqwest::Client::builder()
            .user_agent(concat!("Harbor/", env!("CARGO_PKG_VERSION")))
            .timeout(Duration::from_secs(12))
            .build()
            .expect("failed to build HTTP client");
        Self {
            client,
            cache: Mutex::new(HashMap::new()),
        }
    }
}

impl Http {
    fn cached(&self, key: &str, ttl: Duration) -> Option<Value> {
        let cache = self.cache.lock().ok()?;
        let (at, value) = cache.get(key)?;
        (at.elapsed() < ttl).then(|| value.clone())
    }

    async fn get(&self, url: reqwest::Url, ttl: Duration) -> CmdResult<Value> {
        let key = url.to_string();
        if let Some(v) = self.cached(&key, ttl) {
            return Ok(v);
        }
        let host = url.host_str().unwrap_or("server").to_string();
        let resp = self
            .client
            .get(url)
            .send()
            .await
            .map_err(|e| format!("could not reach {host}: {e}"))?;
        if !resp.status().is_success() {
            return Err(format!("{host} returned {}", resp.status()));
        }
        let value: Value = resp.json().await.map_err(err)?;
        if let Ok(mut cache) = self.cache.lock() {
            cache.insert(key, (Instant::now(), value.clone()));
        }
        Ok(value)
    }
}

impl Http {
    /// POST a JSON body to a fixed endpoint, cached by URL + body.
    async fn post_json(&self, url: &str, body: Value, ttl: Duration) -> CmdResult<Value> {
        let key = format!("{url}\n{body}");
        if let Some(v) = self.cached(&key, ttl) {
            return Ok(v);
        }
        let resp = self
            .client
            .post(url)
            .header("Referer", "https://leetcode.com")
            .json(&body)
            .send()
            .await
            .map_err(|e| format!("could not reach {url}: {e}"))?;
        if !resp.status().is_success() {
            return Err(format!("{url} returned {}", resp.status()));
        }
        let value: Value = resp.json().await.map_err(err)?;
        if let Ok(mut cache) = self.cache.lock() {
            cache.insert(key, (Instant::now(), value.clone()));
        }
        Ok(value)
    }
}

impl Http {
    /// GET a text body (e.g. an iCalendar feed), cached like JSON responses.
    pub(crate) async fn get_text(&self, url: reqwest::Url, ttl: Duration) -> CmdResult<String> {
        let key = format!("text:{url}");
        if let Some(Value::String(s)) = self.cached(&key, ttl) {
            return Ok(s);
        }
        let host = url.host_str().unwrap_or("server").to_string();
        let resp = self
            .client
            .get(url)
            .send()
            .await
            .map_err(|e| format!("could not reach {host}: {e}"))?;
        if !resp.status().is_success() {
            return Err(format!("{host} returned {}", resp.status()));
        }
        let text = resp.text().await.map_err(err)?;
        if text.len() > 20 * 1024 * 1024 {
            return Err(format!("{host} sent more than 20 MB"));
        }
        if let Ok(mut cache) = self.cache.lock() {
            cache.insert(key, (Instant::now(), Value::String(text.clone())));
        }
        Ok(text)
    }
}

fn url(base: &str, params: &[(&str, String)]) -> CmdResult<reqwest::Url> {
    reqwest::Url::parse_with_params(base, params).map_err(err)
}

/// Ticker symbols end up in a URL path, so only allow the characters they use.
fn valid_symbol(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 20
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '.' | '-' | '^' | '='))
}

const MIN: Duration = Duration::from_secs(60);

// ---------- Weather (Open-Meteo) ----------

#[tauri::command]
pub async fn weather(
    http: State<'_, Http>,
    lat: f64,
    lon: f64,
    imperial: bool,
) -> CmdResult<Value> {
    let mut params = vec![
        ("latitude", format!("{lat:.4}")),
        ("longitude", format!("{lon:.4}")),
        (
            "current",
            "temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,wind_direction_10m,precipitation,is_day"
                .into(),
        ),
        (
            "hourly",
            "temperature_2m,weather_code,precipitation_probability,is_day".into(),
        ),
        (
            "daily",
            "weather_code,temperature_2m_max,temperature_2m_min,sunrise,sunset,precipitation_sum,precipitation_probability_max,wind_speed_10m_max,uv_index_max"
                .into(),
        ),
        ("timezone", "auto".into()),
        ("forecast_days", "7".into()),
        ("forecast_hours", "24".into()),
    ];
    if imperial {
        params.push(("temperature_unit", "fahrenheit".into()));
        params.push(("wind_speed_unit", "mph".into()));
    }
    let u = url("https://api.open-meteo.com/v1/forecast", &params)?;
    http.get(u, 10 * MIN).await
}

#[tauri::command]
pub async fn geocode(http: State<'_, Http>, query: String) -> CmdResult<Value> {
    let q = query.trim();
    if q.len() < 2 {
        return Ok(json!({ "results": [] }));
    }
    let u = url(
        "https://geocoding-api.open-meteo.com/v1/search",
        &[
            ("name", q.into()),
            ("count", "6".into()),
            ("language", "en".into()),
            ("format", "json".into()),
        ],
    )?;
    http.get(u, 60 * MIN).await
}

/// Approximate location from the public IP. Only called when the user asks for it.
#[tauri::command]
pub async fn locate_by_ip(http: State<'_, Http>) -> CmdResult<Value> {
    let u = url("https://ipinfo.io/json", &[])?;
    http.get(u, 60 * MIN).await
}

// ---------- Stocks (Yahoo Finance chart API) ----------

#[tauri::command]
pub async fn stocks(http: State<'_, Http>, symbols: Vec<String>) -> CmdResult<Vec<Value>> {
    let mut out = Vec::new();
    for raw in symbols.iter().take(12) {
        let sym = raw.trim().to_uppercase();
        if !valid_symbol(&sym) {
            out.push(json!({ "symbol": sym, "error": "invalid symbol" }));
            continue;
        }
        let base = format!("https://query1.finance.yahoo.com/v8/finance/chart/{sym}");
        let u = url(&base, &[("range", "1d".into()), ("interval", "15m".into())])?;
        match http.get(u, MIN).await {
            Ok(v) => out.push(json!({ "symbol": sym, "data": v })),
            Err(e) => out.push(json!({ "symbol": sym, "error": e })),
        }
    }
    Ok(out)
}

// ---------- Crypto (Binance public market data) ----------

#[tauri::command]
pub async fn crypto(http: State<'_, Http>, symbols: Vec<String>) -> CmdResult<Value> {
    let list: Vec<String> = symbols
        .iter()
        .map(|s| s.trim().to_uppercase())
        .filter(|s| !s.is_empty() && s.len() <= 20 && s.chars().all(|c| c.is_ascii_alphanumeric()))
        .take(12)
        .collect();
    if list.is_empty() {
        return Ok(json!([]));
    }
    let u = url(
        "https://data-api.binance.vision/api/v3/ticker/24hr",
        &[("symbols", serde_json::to_string(&list).map_err(err)?)],
    )?;
    http.get(u, Duration::from_secs(30)).await
}

/// Hourly closes for the last 24 hours, for the Crypto widget's line.
#[tauri::command]
pub async fn crypto_chart(http: State<'_, Http>, symbol: String) -> CmdResult<Vec<f64>> {
    let sym = symbol.trim().to_uppercase();
    if sym.is_empty() || sym.len() > 20 || !sym.chars().all(|c| c.is_ascii_alphanumeric()) {
        return Err("invalid symbol".into());
    }
    let u = url(
        "https://data-api.binance.vision/api/v3/klines",
        &[
            ("symbol", sym),
            ("interval", "1h".into()),
            ("limit", "24".into()),
        ],
    )?;
    let v = http.get(u, 5 * MIN).await?;
    // Each kline is [openTime, open, high, low, close, ...] with prices as strings.
    Ok(v.as_array()
        .map(|rows| {
            rows.iter()
                .filter_map(|r| r.get(4)?.as_str()?.parse::<f64>().ok())
                .collect()
        })
        .unwrap_or_default())
}

// ---------- LeetCode (public profile data) ----------

fn valid_username(s: &str) -> bool {
    !s.is_empty()
        && s.len() <= 40
        && s.chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '_' | '-' | '.'))
}

#[tauri::command]
pub async fn leetcode(http: State<'_, Http>, username: String) -> CmdResult<Value> {
    let user = username.trim().trim_start_matches('@').to_string();
    if !valid_username(&user) {
        return Err("enter a LeetCode username".into());
    }
    let body = json!({
        "query": "query($u: String!) { matchedUser(username: $u) { username submitStatsGlobal { acSubmissionNum { difficulty count } } userCalendar { streak totalActiveDays } } allQuestionsCount { difficulty count } }",
        "variables": { "u": user },
    });
    http.post_json("https://leetcode.com/graphql", body, 30 * MIN)
        .await
}

// ---------- Currency (Frankfurter / ECB rates) ----------

#[tauri::command]
pub async fn fx(http: State<'_, Http>, base: String, quotes: Vec<String>) -> CmdResult<Value> {
    let is_code = |s: &str| s.len() == 3 && s.chars().all(|c| c.is_ascii_alphabetic());
    let base = base.trim().to_uppercase();
    if !is_code(&base) {
        return Err("currency codes are three letters, like USD".into());
    }
    let quotes: Vec<String> = quotes
        .iter()
        .map(|q| q.trim().to_uppercase())
        .filter(|q| is_code(q) && *q != base)
        .collect();
    let u = url(
        "https://api.frankfurter.dev/v1/latest",
        &[("base", base), ("symbols", quotes.join(","))],
    )?;
    http.get(u, 60 * MIN).await
}

// ---------- System: disks and network throughput ----------

#[derive(Default)]
pub struct NetState(Mutex<Option<(Networks, Instant)>>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct DiskInfo {
    name: String,
    mount: String,
    total: u64,
    available: u64,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SystemInfo {
    disks: Vec<DiskInfo>,
    rx_per_sec: f64,
    tx_per_sec: f64,
    uptime_secs: u64,
}

#[tauri::command]
pub fn system_widgets(net: State<'_, NetState>) -> SystemInfo {
    let mut seen = std::collections::HashSet::new();
    let disks = Disks::new_with_refreshed_list()
        .list()
        .iter()
        .filter(|d| d.total_space() > 0 && seen.insert(d.mount_point().to_path_buf()))
        .map(|d| DiskInfo {
            name: d.name().to_string_lossy().into_owned(),
            mount: d.mount_point().display().to_string(),
            total: d.total_space(),
            available: d.available_space(),
        })
        .collect();

    let mut guard = net.0.lock().unwrap_or_else(|p| p.into_inner());
    let (rx, tx) = match guard.as_mut() {
        None => {
            *guard = Some((Networks::new_with_refreshed_list(), Instant::now()));
            (0.0, 0.0)
        }
        Some((networks, last)) => {
            networks.refresh(true);
            let dt = last.elapsed().as_secs_f64().max(0.001);
            *last = Instant::now();
            let (rx, tx) = networks.iter().fold((0u64, 0u64), |(r, t), (_, n)| {
                (r + n.received(), t + n.transmitted())
            });
            (rx as f64 / dt, tx as f64 / dt)
        }
    };

    SystemInfo {
        disks,
        rx_per_sec: rx,
        tx_per_sec: tx,
        uptime_secs: sysinfo::System::uptime(),
    }
}

// ---------- Widget settings (separate file from the dock config) ----------

#[derive(Serialize, Deserialize, Clone)]
pub struct Location {
    pub name: String,
    pub lat: f64,
    pub lon: f64,
}

pub const WIDGET_CONFIG_EVENT: &str = "widget-config-changed";

const MAX_WIDGETS: usize = 60;
const MAX_WIDGET_SETTINGS_BYTES: usize = 16 * 1024;

/// A calendar subscribed by its secret iCal link.
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct CalendarSource {
    pub id: String,
    pub name: String,
    pub url: String,
    pub color: String,
}

/// One widget placed in the panel. `kind` selects the frontend component;
/// `settings` is that component's own options (shape owned by the frontend).
#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
pub struct WidgetInstance {
    pub id: String,
    pub kind: String,
    #[serde(default)]
    pub settings: Value,
}

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase", default)]
pub struct WidgetConfig {
    /// Shared defaults several widgets use (location, units, symbol lists).
    pub location: Option<Location>,
    pub imperial: bool,
    pub stocks: Vec<String>,
    pub crypto: Vec<String>,
    pub fx_base: String,
    pub fx_quotes: Vec<String>,
    /// Prayer times: calculation method (see `prayer::METHODS`) and Asr convention.
    pub prayer_method: String,
    pub prayer_asr: String,
    /// Widgets in panel order.
    pub layout: Vec<WidgetInstance>,
    /// iCal feeds shown in the calendar card and used by automations.
    pub calendars: Vec<CalendarSource>,
}

impl Default for WidgetConfig {
    fn default() -> Self {
        let v = |xs: &[&str]| xs.iter().map(|s| s.to_string()).collect();
        let w = |id: &str, kind: &str| WidgetInstance {
            id: id.into(),
            kind: kind.into(),
            settings: json!({}),
        };
        Self {
            location: None,
            imperial: false,
            stocks: v(&["AAPL", "MSFT", "NVDA"]),
            crypto: v(&["BTCUSDT", "ETHUSDT", "SOLUSDT"]),
            fx_base: "USD".into(),
            fx_quotes: v(&["EUR", "GBP", "JPY", "IDR"]),
            prayer_method: "kemenag".into(),
            prayer_asr: "standard".into(),
            layout: vec![
                w("w1", "clock"),
                w("w2", "weather"),
                w("w3", "forecast"),
                w("w4", "now-playing"),
                w("w5", "cpu-ring"),
                w("w6", "ram-ring"),
                w("w7", "stock-watchlist"),
                w("w8", "crypto"),
                w("w9", "network"),
                w("w10", "calendar"),
            ],
            calendars: Vec::new(),
        }
    }
}

impl WidgetConfig {
    fn sanitized(mut self) -> Self {
        let mut seen = std::collections::HashSet::new();
        self.layout.retain(|w| {
            let ok_id = !w.id.is_empty() && w.id.len() <= 40;
            let ok_kind = !w.kind.is_empty()
                && w.kind.len() <= 40
                && w.kind
                    .chars()
                    .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit() || c == '-');
            let ok_size = w.settings.to_string().len() <= MAX_WIDGET_SETTINGS_BYTES;
            ok_id && ok_kind && ok_size && seen.insert(w.id.clone())
        });
        for w in &mut self.layout {
            if !w.settings.is_object() {
                w.settings = json!({});
            }
        }
        self.layout.truncate(MAX_WIDGETS);
        // Calendar links: https only (webcal:// is the same feed over https).
        self.calendars = std::mem::take(&mut self.calendars)
            .into_iter()
            .filter_map(|mut c| {
                let url = c.url.trim();
                let url = url
                    .strip_prefix("webcal://")
                    .map(|r| format!("https://{r}"))
                    .unwrap_or_else(|| url.to_string());
                let ok = url.starts_with("https://")
                    && url.len() <= 2048
                    && reqwest::Url::parse(&url).is_ok();
                ok.then(|| {
                    c.url = url;
                    c.name = c.name.trim().chars().take(40).collect();
                    if c.name.is_empty() {
                        c.name = "Calendar".into();
                    }
                    if !(c.color.starts_with('#') && c.color.len() <= 9) {
                        c.color = "#60a5fa".into();
                    }
                    c
                })
            })
            .take(20)
            .collect();
        let d = Self::default();
        if !super::prayer::is_method(&self.prayer_method) {
            self.prayer_method = d.prayer_method;
        }
        if !["standard", "hanafi"].contains(&self.prayer_asr.as_str()) {
            self.prayer_asr = d.prayer_asr;
        }
        self
    }
}

fn widgets_path(app: &AppHandle) -> CmdResult<PathBuf> {
    let dir = app.path().app_config_dir().map_err(err)?;
    fs::create_dir_all(&dir).map_err(err)?;
    Ok(dir.join("widgets.json"))
}

#[tauri::command]
pub fn load_widget_config(app: AppHandle) -> CmdResult<WidgetConfig> {
    let path = widgets_path(&app)?;
    let config: WidgetConfig = fs::read_to_string(path)
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default();
    Ok(config.sanitized())
}

#[tauri::command]
pub fn save_widget_config(app: AppHandle, config: WidgetConfig) -> CmdResult<WidgetConfig> {
    let config = config.sanitized();
    let path = widgets_path(&app)?;
    write_atomic(&path, &serde_json::to_string_pretty(&config).map_err(err)?)?;
    let _ = app.emit(WIDGET_CONFIG_EVENT, &config);
    Ok(config)
}

fn write_atomic(path: &std::path::Path, text: &str) -> CmdResult<()> {
    let tmp = path.with_extension("tmp");
    fs::write(&tmp, text).map_err(err)?;
    fs::rename(&tmp, path).map_err(err)
}

// ---------- Widget data (todos, notes): user content, kept apart from settings ----------

/// Keys are widget-instance scoped, e.g. `todos-w12`; only a safe charset reaches the filesystem.
fn data_path(app: &AppHandle, key: &str) -> CmdResult<PathBuf> {
    let ok = !key.is_empty()
        && key.len() <= 60
        && key.chars().all(|c| c.is_ascii_alphanumeric() || c == '-');
    if !ok {
        return Err("invalid widget data key".into());
    }
    let dir = app.path().app_data_dir().map_err(err)?.join("widget-data");
    fs::create_dir_all(&dir).map_err(err)?;
    Ok(dir.join(format!("{key}.json")))
}

#[tauri::command]
pub fn load_widget_data(app: AppHandle, key: String) -> CmdResult<Value> {
    let path = data_path(&app, &key)?;
    Ok(fs::read_to_string(path)
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or(Value::Null))
}

#[tauri::command]
pub fn save_widget_data(app: AppHandle, key: String, value: Value) -> CmdResult<()> {
    let text = serde_json::to_string(&value).map_err(err)?;
    if text.len() > 512 * 1024 {
        return Err("that note is too large to save".into());
    }
    write_atomic(&data_path(&app, &key)?, &text)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn symbols_reject_path_and_query_characters() {
        for ok in ["AAPL", "BRK-B", "^GSPC", "EURUSD=X", "SHOP.TO"] {
            assert!(valid_symbol(ok), "{ok} should be accepted");
        }
        for bad in [
            "",
            "AAPL/../x",
            "A?b=1",
            "A B",
            "A#1",
            "AAAAAAAAAAAAAAAAAAAAA",
        ] {
            assert!(!valid_symbol(bad), "{bad:?} should be rejected");
        }
    }

    #[test]
    fn widget_config_fills_missing_fields_with_defaults() {
        let c: WidgetConfig = serde_json::from_str(r#"{"imperial": true}"#).unwrap();
        assert!(c.imperial);
        assert_eq!(c.fx_base, "USD");
        assert!(!c.stocks.is_empty());
        assert!(c.location.is_none());
        assert_eq!(c.prayer_method, "kemenag");
    }

    #[test]
    fn unknown_prayer_settings_fall_back() {
        let c = WidgetConfig {
            prayer_method: "made-up".into(),
            prayer_asr: "x".into(),
            ..WidgetConfig::default()
        };
        let c = c.sanitized();
        assert_eq!(
            (c.prayer_method.as_str(), c.prayer_asr.as_str()),
            ("kemenag", "standard")
        );
    }

    #[test]
    fn layout_sanitize_drops_bad_and_duplicate_widgets() {
        let mut c = WidgetConfig::default();
        let first = c.layout[0].clone();
        c.layout.push(first); // duplicate id
        c.layout.push(WidgetInstance {
            id: "x".into(),
            kind: "../evil".into(),
            settings: json!({}),
        });
        c.layout.push(WidgetInstance {
            id: "y".into(),
            kind: "notes".into(),
            settings: json!("not an object"),
        });
        let n_defaults = WidgetConfig::default().layout.len();
        let c = c.sanitized();
        assert_eq!(c.layout.len(), n_defaults + 1);
        assert!(c.layout.last().unwrap().settings.is_object());
    }

    #[test]
    fn calendar_links_must_be_https() {
        let mut c = WidgetConfig::default();
        let cal = |url: &str| CalendarSource {
            id: "c".into(),
            name: " Work ".into(),
            url: url.into(),
            color: "red".into(),
        };
        c.calendars = vec![
            cal("webcal://p01-caldav.icloud.com/x.ics"),
            cal("http://insecure.example/x.ics"),
            cal("file:///C:/x.ics"),
            cal("https://calendar.google.com/x/basic.ics"),
        ];
        let c = c.sanitized();
        let urls: Vec<_> = c.calendars.iter().map(|c| c.url.as_str()).collect();
        assert_eq!(
            urls,
            [
                "https://p01-caldav.icloud.com/x.ics",
                "https://calendar.google.com/x/basic.ics"
            ]
        );
        assert_eq!(c.calendars[0].name, "Work");
        assert_eq!(c.calendars[0].color, "#60a5fa");
    }

    #[test]
    fn old_widget_files_get_the_default_layout() {
        let c: WidgetConfig = serde_json::from_str(r#"{"imperial": true}"#).unwrap();
        assert!(!c.layout.is_empty());
    }

    #[test]
    fn widget_config_uses_camel_case_on_the_wire() {
        let json = serde_json::to_value(WidgetConfig::default()).unwrap();
        assert!(json.get("fxBase").is_some());
        assert!(json.get("fxQuotes").is_some());
    }
}
