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
use tauri::{AppHandle, Manager, State};

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
            "temperature_2m,apparent_temperature,relative_humidity_2m,weather_code,wind_speed_10m,is_day"
                .into(),
        ),
        ("daily", "weather_code,temperature_2m_max,temperature_2m_min".into()),
        ("timezone", "auto".into()),
        ("forecast_days", "5".into()),
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

#[derive(Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase", default)]
pub struct WidgetConfig {
    pub location: Option<Location>,
    pub imperial: bool,
    pub stocks: Vec<String>,
    pub crypto: Vec<String>,
    pub fx_base: String,
    pub fx_quotes: Vec<String>,
}

impl Default for WidgetConfig {
    fn default() -> Self {
        let v = |xs: &[&str]| xs.iter().map(|s| s.to_string()).collect();
        Self {
            location: None,
            imperial: false,
            stocks: v(&["AAPL", "MSFT", "NVDA"]),
            crypto: v(&["BTCUSDT", "ETHUSDT", "SOLUSDT"]),
            fx_base: "USD".into(),
            fx_quotes: v(&["EUR", "GBP", "JPY", "IDR"]),
        }
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
    Ok(fs::read_to_string(path)
        .ok()
        .and_then(|t| serde_json::from_str(&t).ok())
        .unwrap_or_default())
}

#[tauri::command]
pub fn save_widget_config(app: AppHandle, config: WidgetConfig) -> CmdResult<()> {
    let path = widgets_path(&app)?;
    let tmp = path.with_extension("json.tmp");
    fs::write(&tmp, serde_json::to_string_pretty(&config).map_err(err)?).map_err(err)?;
    fs::rename(&tmp, &path).map_err(err)
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
    }

    #[test]
    fn widget_config_uses_camel_case_on_the_wire() {
        let json = serde_json::to_value(WidgetConfig::default()).unwrap();
        assert!(json.get("fxBase").is_some());
        assert!(json.get("fxQuotes").is_some());
    }
}
