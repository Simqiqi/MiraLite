//! Xtream Codes 完整 API（player_api.php）。
//!
//! 上游是 `{base}/player_api.php?username=&password=&action=`。所有请求都在 Rust
//! 侧发出，避免 webview 的跨域限制；同时统一收口超时、UA、响应大小与错误信息。
//!
//! 覆盖：账号信息、直播/VOD/剧集分类、直播频道、VOD、剧集列表、EPG（get_simple_data_table）。
//! EPG 按 (base, 账号, stream_id) 在内存里缓存 10 分钟——切频道回来不用再拉整张表。

use futures_util::StreamExt;
use serde::Serialize;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::{Duration, Instant};

const USER_AGENT: &str = "MiraLite/0.1 (Tauri)";
const TIMEOUT: Duration = Duration::from_secs(20);
const MAX_BYTES: usize = 12 * 1024 * 1024;
const EPG_TTL: Duration = Duration::from_secs(600);
const EPG_MAX_ITEMS: usize = 200;

#[derive(Default)]
pub struct XtreamState {
  /// key = `{base}|{username}|{stream_id}`，值 = (写入时间, 节目表)
  epg: Mutex<HashMap<String, (Instant, Vec<EpgProgram>)>>,
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct XtreamAccount {
  pub ok: bool,
  pub username: String,
  pub status: String,
  pub is_trial: bool,
  pub active_conns: i64,
  pub max_connections: i64,
  pub exp_date: Option<i64>,
  pub timezone: Option<String>,
  pub server_url: Option<String>,
  pub port: Option<String>,
  pub formats: Vec<String>,
  pub message: String,
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct XtreamCategory {
  pub id: String,
  pub name: String,
  pub parent_id: i64,
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct XtreamLiveStream {
  pub stream_id: i64,
  pub num: i64,
  pub name: String,
  pub icon: String,
  pub category_id: String,
  pub epg_channel_id: Option<String>,
  pub tv_archive: bool,
  pub archive_days: i64,
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct XtreamVodStream {
  pub stream_id: i64,
  pub name: String,
  pub icon: String,
  pub category_id: String,
  pub container: String,
  pub rating: Option<f64>,
  pub year: Option<String>,
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct XtreamSeries {
  pub series_id: i64,
  pub name: String,
  pub cover: String,
  pub category_id: String,
  pub rating: Option<f64>,
  pub year: Option<String>,
  pub plot: String,
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct XtreamEpisode {
  pub id: i64,
  pub title: String,
  pub season: i64,
  pub episode: i64,
  pub container: String,
  pub plot: String,
  pub duration: String,
  pub rating: Option<f64>,
}

#[derive(Serialize, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct EpgProgram {
  pub id: String,
  pub title: String,
  pub description: String,
  /// 面板给的本地时间字符串，原样返回；部分面板没有
  pub start: String,
  pub end: String,
  /// 优先用时间戳，前端只有拿不到时间戳时才回退解析字符串
  pub start_ts: Option<i64>,
  pub stop_ts: Option<i64>,
  pub now_playing: bool,
  pub has_archive: bool,
}

// ---------------------------------------------------------------- 基础工具

/// 规范化用户填的源地址：去空白、去查询串、剥掉常见的接口尾巴。
fn normalize_base(raw: &str) -> Result<String, String> {
  let mut t = raw.trim();
  if t.is_empty() {
    return Err("源地址不能为空".to_string());
  }
  if let Some(pos) = t.find('?') {
    t = &t[..pos];
  }
  let mut t = t.trim_end_matches('/').to_string();
  for suffix in ["/player_api.php", "/get.php", "/xmltv.php", "/panel_api.php"] {
    while let Some(stripped) = t.strip_suffix(suffix) {
      t = stripped.trim_end_matches('/').to_string();
    }
  }
  if !(t.starts_with("http://") || t.starts_with("https://")) {
    return Err("源地址需要以 http:// 或 https:// 开头".to_string());
  }
  if t.len() < 10 {
    return Err("源地址看起来不完整".to_string());
  }
  Ok(t)
}

fn encode(s: &str) -> String {
  urlencoding::encode(s).into_owned()
}

/// 拼 player_api 请求地址；`extra` 里的参数按顺序追加。
fn api_url(base: &str, username: &str, password: &str, extra: &[(&str, String)]) -> String {
  let mut url = format!(
    "{base}/player_api.php?username={}&password={}",
    encode(username),
    encode(password)
  );
  for (k, v) in extra {
    url.push('&');
    url.push_str(k);
    url.push('=');
    url.push_str(&encode(v));
  }
  url
}

fn client() -> Result<reqwest::Client, String> {
  reqwest::Client::builder()
    .timeout(TIMEOUT)
    .user_agent(USER_AGENT)
    .build()
    .map_err(|e| format!("HTTP 客户端创建失败: {e}"))
}

/// 带大小上限地读完响应体，避免面板返回整站 m3u 时把内存吃满。
async fn read_limited(resp: reqwest::Response) -> Result<String, String> {
  let mut stream = resp.bytes_stream();
  let mut buf: Vec<u8> = Vec::new();
  while let Some(chunk) = stream.next().await {
    let chunk = chunk.map_err(|e| format!("读取响应失败: {e}"))?;
    if buf.len() + chunk.len() > MAX_BYTES {
      return Err(format!(
        "响应超过 {}MB，已中止",
        MAX_BYTES / 1024 / 1024
      ));
    }
    buf.extend_from_slice(&chunk);
  }
  String::from_utf8(buf).map_err(|_| "响应不是 UTF-8 文本".to_string())
}

async fn get_text(url: &str) -> Result<String, String> {
  let resp = client()?.get(url).send().await.map_err(|e| {
    if e.is_timeout() {
      "请求超时，检查网络或源地址".to_string()
    } else {
      format!("请求失败: {e}")
    }
  })?;
  let status = resp.status();
  if !status.is_success() {
    return Err(format!("上游返回 HTTP {}", status.as_u16()));
  }
  read_limited(resp).await
}

async fn get_json(url: &str) -> Result<Value, String> {
  let text = get_text(url).await?;
  serde_json::from_str::<Value>(&text).map_err(|_| {
    let head: String = text.trim().chars().take(120).collect();
    format!("上游返回的不是 JSON（可能是账号错误或地址填错）：{head}")
  })
}

fn as_array(v: &Value) -> Vec<Value> {
  v.as_array().cloned().unwrap_or_default()
}

fn str_of(v: &Value, key: &str) -> String {
  match v.get(key) {
    Some(Value::String(s)) => s.clone(),
    Some(Value::Number(n)) => n.to_string(),
    Some(Value::Bool(b)) => b.to_string(),
    _ => String::new(),
  }
}

fn opt_str(v: &Value, key: &str) -> Option<String> {
  let s = str_of(v, key);
  if s.is_empty() || s == "null" {
    None
  } else {
    Some(s)
  }
}

fn num_of(v: &Value, key: &str) -> i64 {
  match v.get(key) {
    Some(Value::Number(n)) => n.as_i64().unwrap_or(0),
    Some(Value::String(s)) => s.parse::<i64>().unwrap_or(0),
    _ => 0,
  }
}

fn opt_num(v: &Value, key: &str) -> Option<i64> {
  match v.get(key) {
    Some(Value::Number(n)) => n.as_i64(),
    Some(Value::String(s)) => s.parse::<i64>().ok(),
    _ => None,
  }
}

fn opt_f64(v: &Value, key: &str) -> Option<f64> {
  match v.get(key) {
    Some(Value::Number(n)) => n.as_f64(),
    Some(Value::String(s)) => s.parse::<f64>().ok().filter(|x| *x > 0.0),
    _ => None,
  }
}

/// `tv_archive` 这类字段不同面板会给 0/1、字符串或布尔，统一成 bool。
fn bool_of(v: &Value, key: &str) -> bool {
  match v.get(key) {
    Some(Value::Bool(b)) => *b,
    Some(Value::Number(n)) => n.as_i64().unwrap_or(0) != 0,
    Some(Value::String(s)) => matches!(s.as_str(), "1" | "true" | "True" | "yes"),
    _ => false,
  }
}

// ---------------------------------------------------------------- base64

const B64_TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

fn b64_decode(s: &str) -> Option<Vec<u8>> {
  let mut buf: u32 = 0;
  let mut bits: u32 = 0;
  let mut out = Vec::with_capacity(s.len() * 3 / 4);
  for c in s.bytes() {
    if c == b'=' || c == b'\n' || c == b'\r' {
      continue;
    }
    let v = B64_TABLE.iter().position(|&x| x == c)? as u32;
    buf = (buf << 6) | v;
    bits += 6;
    if bits >= 8 {
      bits -= 8;
      out.push(((buf >> bits) & 0xFF) as u8);
    }
  }
  Some(out)
}

/// Xtream 的 title / description 多数面板会给 base64（中文尤其常见）。
/// 解不出来、或者解出来是乱码，就原样返回，避免把明文标题解坏。
fn decode_text(raw: &str) -> String {
  let t = raw.trim();
  if t.is_empty() {
    return String::new();
  }
  let looks_b64 = t.len() >= 8
    && t.len() % 4 == 0
    && t
      .bytes()
      .all(|c| c.is_ascii_alphanumeric() || c == b'+' || c == b'/' || c == b'=');
  if !looks_b64 {
    return t.to_string();
  }
  match b64_decode(t).and_then(|b| String::from_utf8(b).ok()) {
    Some(d) if !d.trim().is_empty() && !d.contains('\u{FFFD}') => d.trim().to_string(),
    _ => t.to_string(),
  }
}

// ---------------------------------------------------------------- 命令

/// 账号信息兼连通性检测。失败时 `ok=false` + 可读的 message。
#[tauri::command]
pub async fn xtream_login(
  base: String,
  username: String,
  password: String,
) -> Result<XtreamAccount, String> {
  let base = normalize_base(&base)?;
  let url = api_url(&base, &username, &password, &[]);
  let data = get_json(&url).await?;

  let user = data.get("user_info").cloned().unwrap_or(Value::Null);
  if user.is_null() {
    return Ok(XtreamAccount {
      ok: false,
      message: "上游没有返回 user_info，确认地址是否为 Xtream 面板（player_api.php）".to_string(),
      ..Default::default()
    });
  }

  let auth = bool_of(&user, "auth") || num_of(&user, "auth") == 1;
  let status = str_of(&user, "status");
  let ok = auth && !status.eq_ignore_ascii_case("expired");
  let server = data.get("server_info").cloned().unwrap_or(Value::Null);

  Ok(XtreamAccount {
    ok,
    username: str_of(&user, "username"),
    status: status.clone(),
    is_trial: bool_of(&user, "is_trial"),
    active_conns: num_of(&user, "active_cons"),
    max_connections: num_of(&user, "max_connections"),
    exp_date: opt_num(&user, "exp_date"),
    timezone: opt_str(&server, "timezone").or_else(|| opt_str(&server, "time_now")),
    server_url: opt_str(&server, "url"),
    port: opt_str(&server, "port"),
    formats: server
      .get("allowed_output_formats")
      .and_then(|v| v.as_array())
      .map(|a| a.iter().filter_map(|x| x.as_str().map(str::to_string)).collect())
      .unwrap_or_default(),
    message: if ok {
      String::new()
    } else if status.is_empty() {
      "账号校验失败：用户名或密码不对".to_string()
    } else {
      format!("账号状态不可用：{status}")
    },
  })
}

fn categories_action(kind: &str) -> Result<&'static str, String> {
  match kind {
    "live" | "m3u" => Ok("get_live_categories"),
    "vod" | "movie" => Ok("get_vod_categories"),
    "series" | "tv" => Ok("get_series_categories"),
    other => Err(format!("不支持的分类类型：{other}")),
  }
}

/// 分类列表。`kind`：live / vod / series。
#[tauri::command]
pub async fn xtream_categories(
  base: String,
  username: String,
  password: String,
  kind: String,
) -> Result<Vec<XtreamCategory>, String> {
  let base = normalize_base(&base)?;
  let action = categories_action(&kind)?;
  let url = api_url(&base, &username, &password, &[("action", action.to_string())]);
  let data = get_json(&url).await?;
  Ok(
    as_array(&data)
      .into_iter()
      .map(|c| XtreamCategory {
        id: str_of(&c, "category_id"),
        name: decode_text(&str_of(&c, "category_name")),
        parent_id: num_of(&c, "parent_id"),
      })
      .collect(),
  )
}

/// 直播频道列表，可选按分类过滤。
#[tauri::command]
pub async fn xtream_live_streams(
  base: String,
  username: String,
  password: String,
  category_id: Option<String>,
) -> Result<Vec<XtreamLiveStream>, String> {
  let base = normalize_base(&base)?;
  let mut extra: Vec<(&str, String)> = vec![("action", "get_live_streams".to_string())];
  if let Some(cid) = category_id.filter(|c| !c.trim().is_empty()) {
    extra.push(("category_id", cid));
  }
  let url = api_url(&base, &username, &password, &extra);
  let data = get_json(&url).await?;
  Ok(
    as_array(&data)
      .into_iter()
      .map(|s| XtreamLiveStream {
        stream_id: num_of(&s, "stream_id"),
        num: num_of(&s, "num"),
        name: decode_text(&str_of(&s, "name")),
        icon: str_of(&s, "stream_icon"),
        category_id: str_of(&s, "category_id"),
        epg_channel_id: opt_str(&s, "epg_channel_id"),
        tv_archive: bool_of(&s, "tv_archive"),
        archive_days: num_of(&s, "tv_archive_duration"),
      })
      .filter(|s| s.stream_id > 0)
      .collect(),
  )
}

/// 点播（VOD）列表。
#[tauri::command]
pub async fn xtream_vod_streams(
  base: String,
  username: String,
  password: String,
  category_id: Option<String>,
) -> Result<Vec<XtreamVodStream>, String> {
  let base = normalize_base(&base)?;
  let mut extra: Vec<(&str, String)> = vec![("action", "get_vod_streams".to_string())];
  if let Some(cid) = category_id.filter(|c| !c.trim().is_empty()) {
    extra.push(("category_id", cid));
  }
  let url = api_url(&base, &username, &password, &extra);
  let data = get_json(&url).await?;
  Ok(
    as_array(&data)
      .into_iter()
      .map(|s| XtreamVodStream {
        stream_id: num_of(&s, "stream_id"),
        name: decode_text(&str_of(&s, "name")),
        icon: str_of(&s, "stream_icon"),
        category_id: str_of(&s, "category_id"),
        container: str_of(&s, "container_extension"),
        rating: opt_f64(&s, "rating"),
        year: opt_str(&s, "year"),
      })
      .filter(|s| s.stream_id > 0)
      .collect(),
  )
}

/// 剧集列表（series 层级，具体季集走 get_series_info）。
#[tauri::command]
pub async fn xtream_series(
  base: String,
  username: String,
  password: String,
  category_id: Option<String>,
) -> Result<Vec<XtreamSeries>, String> {
  let base = normalize_base(&base)?;
  let mut extra: Vec<(&str, String)> = vec![("action", "get_series".to_string())];
  if let Some(cid) = category_id.filter(|c| !c.trim().is_empty()) {
    extra.push(("category_id", cid));
  }
  let url = api_url(&base, &username, &password, &extra);
  let data = get_json(&url).await?;
  Ok(
    as_array(&data)
      .into_iter()
      .map(|s| XtreamSeries {
        series_id: num_of(&s, "series_id"),
        name: decode_text(&str_of(&s, "name")),
        cover: str_of(&s, "cover"),
        category_id: str_of(&s, "category_id"),
        rating: opt_f64(&s, "rating"),
        year: opt_str(&s, "year"),
        plot: decode_text(&str_of(&s, "plot")),
      })
      .filter(|s| s.series_id > 0)
      .collect(),
  )
}

fn i64_of(v: &Value) -> i64 {
  match v {
    Value::Number(n) => n.as_i64().unwrap_or(0),
    Value::String(s) => s.parse::<i64>().unwrap_or(0),
    _ => 0,
  }
}

/// 剧集详情：get_series_info 返回的是 { episodes: { "1": [...], "2": [...] } }
#[tauri::command]
pub async fn xtream_series_info(
  base: String,
  username: String,
  password: String,
  series_id: i64,
) -> Result<Vec<XtreamEpisode>, String> {
  let base = normalize_base(&base)?;
  if series_id <= 0 {
    return Err("剧集 ID 不合法".to_string());
  }
  let url = api_url(
    &base,
    &username,
    &password,
    &[
      ("action", "get_series_info".to_string()),
      ("series_id", series_id.to_string()),
    ],
  );
  let data = get_json(&url).await?;
  let episodes = data.get("episodes").cloned().unwrap_or(Value::Null);
  let mut out: Vec<XtreamEpisode> = Vec::new();

  if let Value::Object(map) = episodes {
    for (season_key, list) in map {
      let fallback_season = season_key.parse::<i64>().unwrap_or(0);
      for ep in as_array(&list) {
        let info = ep.get("info").cloned().unwrap_or(Value::Null);
        out.push(XtreamEpisode {
          id: i64_of(ep.get("id").unwrap_or(&Value::Null)),
          title: decode_text(&str_of(&ep, "title")),
          season: opt_num(&ep, "season").unwrap_or(fallback_season),
          episode: num_of(&ep, "episode_num"),
          container: str_of(&ep, "container_extension"),
          plot: decode_text(&str_of(&info, "plot")),
          duration: str_of(&info, "duration"),
          rating: opt_f64(&info, "rating"),
        });
      }
    }
  }

  out.retain(|e| e.id > 0);
  out.sort_by_key(|e| (e.season, e.episode));
  Ok(out)
}

/// 把 get_simple_data_table 的原始 JSON 映射成节目表（抽出来方便单测）。
fn map_programs(data: &Value, limit: usize) -> Vec<EpgProgram> {
  as_array(&data)
    .into_iter()
    .map(|p| EpgProgram {
      id: str_of(&p, "id"),
      title: decode_text(&str_of(&p, "title")),
      description: decode_text(&str_of(&p, "description")),
      start: str_of(&p, "start"),
      end: str_of(&p, "end"),
      start_ts: opt_num(&p, "start_timestamp"),
      stop_ts: opt_num(&p, "stop_timestamp"),
      now_playing: bool_of(&p, "now_playing"),
      has_archive: bool_of(&p, "has_archive"),
    })
    .filter(|p| !p.title.is_empty())
    .take(limit)
    .collect()
}

/// 单个频道的节目表（现在 + 接下来）。缓存 10 分钟。
#[tauri::command]
pub async fn xtream_epg(
  state: tauri::State<'_, XtreamState>,
  base: String,
  username: String,
  password: String,
  stream_id: i64,
  limit: Option<usize>,
) -> Result<Vec<EpgProgram>, String> {
  let base = normalize_base(&base)?;
  if stream_id <= 0 {
    return Err("频道 ID 不合法".to_string());
  }
  let limit = limit.unwrap_or(24).clamp(1, EPG_MAX_ITEMS);
  let key = format!("{base}|{username}|{stream_id}");

  if let Ok(cache) = state.epg.lock() {
    if let Some((at, list)) = cache.get(&key) {
      if at.elapsed() < EPG_TTL {
        return Ok(list.clone());
      }
    }
  }

  let url = api_url(
    &base,
    &username,
    &password,
    &[
      ("action", "get_simple_data_table".to_string()),
      ("stream_id", stream_id.to_string()),
    ],
  );
  let data = get_json(&url).await?;
  let listings = data.get("epg_listings").cloned().unwrap_or(Value::Null);
  let programs = map_programs(&listings, limit);

  if let Ok(mut cache) = state.epg.lock() {
    // 顺手清掉过期项，缓存不会无限长
    cache.retain(|_, (at, _)| at.elapsed() < EPG_TTL);
    cache.insert(key, (Instant::now(), programs.clone()));
  }
  Ok(programs)
}

/// 通用文本抓取（M3U / TXT 播放列表等），走 Rust 绕开 webview 跨域。
#[tauri::command]
pub async fn http_get_text(url: String) -> Result<String, String> {
  let target = url.trim();
  if !(target.starts_with("http://") || target.starts_with("https://")) {
    return Err("只支持 http/https 地址".to_string());
  }
  get_text(target).await
}

#[cfg(test)]
mod tests {
  use super::{api_url, b64_decode, decode_text, map_programs, normalize_base};
  use serde_json::json;

  #[test]
  fn base_strips_interface_tails() {
    assert_eq!(
      normalize_base(" http://host:8080/player_api.php ").unwrap(),
      "http://host:8080"
    );
    assert_eq!(
      normalize_base("https://host/get.php?username=a&password=b").unwrap(),
      "https://host"
    );
    assert_eq!(normalize_base("http://host/xmltv.php/").unwrap(), "http://host");
    assert_eq!(normalize_base("http://host///").unwrap(), "http://host");
  }

  #[test]
  fn base_rejects_bad_input() {
    assert!(normalize_base("").is_err());
    assert!(normalize_base("host:8080").is_err());
    assert!(normalize_base("ftp://host").is_err());
  }

  #[test]
  fn api_url_escapes_credentials() {
    let url = api_url(
      "http://h:8080",
      "user name",
      "p@ss&word",
      &[("action", "get_live_streams".to_string())],
    );
    assert_eq!(
      url,
      "http://h:8080/player_api.php?username=user%20name&password=p%40ss%26word&action=get_live_streams"
    );
  }

  #[test]
  fn base64_roundtrip_for_chinese() {
    let raw = "新闻联播";
    // 新闻联播 的 base64
    let encoded = {
      const T: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
      let bytes = raw.as_bytes();
      let mut out = String::new();
      for chunk in bytes.chunks(3) {
        let b = [
          chunk[0],
          *chunk.get(1).unwrap_or(&0),
          *chunk.get(2).unwrap_or(&0),
        ];
        let n = ((b[0] as u32) << 16) | ((b[1] as u32) << 8) | b[2] as u32;
        out.push(T[(n >> 18) as usize & 63] as char);
        out.push(T[(n >> 12) as usize & 63] as char);
        if chunk.len() > 1 {
          out.push(T[(n >> 6) as usize & 63] as char);
        } else {
          out.push('=');
        }
        if chunk.len() > 2 {
          out.push(T[n as usize & 63] as char);
        } else {
          out.push('=');
        }
      }
      out
    };
    assert_eq!(decode_text(&encoded), raw);
    assert_eq!(b64_decode(&encoded).unwrap(), raw.as_bytes());
  }

  #[test]
  fn plain_text_is_not_mangled() {
    assert_eq!(decode_text("CCTV-1 综合"), "CCTV-1 综合");
    assert_eq!(decode_text("News"), "News");
    assert_eq!(decode_text(""), "");
  }

  #[test]
  fn programs_map_and_limit() {
    let data = json!([
      { "title": "节目一", "start": "2026-11-19 20:00:00", "end": "2026-11-19 21:00:00",
        "start_timestamp": "1763553600", "stop_timestamp": "1763557200", "now_playing": 1 },
      { "title": "", "start": "x" },
      { "title": "节目二", "start": "2026-11-19 21:00:00", "end": "2026-11-19 22:00:00" }
    ]);
    let list = map_programs(&data, 10);
    assert_eq!(list.len(), 2, "空标题应被过滤");
    assert_eq!(list[0].title, "节目一");
    assert_eq!(list[0].start_ts, Some(1763553600));
    assert!(list[0].now_playing);
    assert_eq!(list[1].start_ts, None);

    assert_eq!(map_programs(&data, 1).len(), 1, "limit 生效");
    assert_eq!(map_programs(&json!(null), 10).len(), 0);
  }
}