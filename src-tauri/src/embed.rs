//! 内嵌网页：在 App 窗口里放一个子 Webview 打开外部网站。
//!
//! 用子 Webview 而不是 iframe，可以绕开目标站点的 X-Frame-Options / CSP 限制；
//! 位置与大小由前端按内容区算好传进来，跟随窗口尺寸变化调整。
use serde::Serialize;
use tauri::webview::WebviewBuilder;
use tauri::{AppHandle, LogicalPosition, LogicalSize, Manager, WebviewUrl};

/// 内嵌网页的固定 label（同一时间只保留一个）
const LABEL: &str = "site";

#[derive(Serialize)]
pub struct SiteStatus {
  pub open: bool,
  pub url: String,
}

fn parse_url(url: &str) -> Result<tauri::Url, String> {
  let parsed = url
    .trim()
    .parse::<tauri::Url>()
    .map_err(|e| format!("地址不合法：{e}"))?;
  match parsed.scheme() {
    "http" | "https" => Ok(parsed),
    other => Err(format!("只支持 http / https，收到：{other}")),
  }
}

/// 打开（或替换）内嵌网页
#[tauri::command]
pub fn site_open(
  app: AppHandle,
  url: String,
  x: f64,
  y: f64,
  width: f64,
  height: f64,
) -> Result<(), String> {
  let parsed = parse_url(&url)?;
  if let Some(existing) = app.get_webview(LABEL) {
    let _ = existing.close();
  }
  let window = app
    .get_window("main")
    .ok_or_else(|| "找不到主窗口".to_string())?;
  let builder = WebviewBuilder::new(LABEL, WebviewUrl::External(parsed));
  window
    .add_child(
      builder,
      LogicalPosition::new(x, y),
      LogicalSize::new(width.max(120.0), height.max(120.0)),
    )
    .map_err(|e| format!("内嵌网页失败：{e}"))?;
  Ok(())
}

/// 跟随内容区尺寸变化
#[tauri::command]
pub fn site_bounds(app: AppHandle, x: f64, y: f64, width: f64, height: f64) -> Result<(), String> {
  if let Some(wv) = app.get_webview(LABEL) {
    wv.set_position(LogicalPosition::new(x, y))
      .map_err(|e| format!("调整位置失败：{e}"))?;
    wv.set_size(LogicalSize::new(width.max(120.0), height.max(120.0)))
      .map_err(|e| format!("调整尺寸失败：{e}"))?;
  }
  Ok(())
}

/// 在同一内嵌视图里跳转到新地址
#[tauri::command]
pub fn site_navigate(app: AppHandle, url: String) -> Result<(), String> {
  let parsed = parse_url(&url)?;
  let wv = app
    .get_webview(LABEL)
    .ok_or_else(|| "内嵌网页还没有打开".to_string())?;
  wv.navigate(parsed).map_err(|e| format!("跳转失败：{e}"))?;
  Ok(())
}

/// 重新加载当前页面
#[tauri::command]
pub fn site_reload(app: AppHandle) -> Result<(), String> {
  let wv = app
    .get_webview(LABEL)
    .ok_or_else(|| "内嵌网页还没有打开".to_string())?;
  wv.eval("location.reload()")
    .map_err(|e| format!("刷新失败：{e}"))?;
  Ok(())
}

/// 关闭内嵌网页（离开页面时调用）
#[tauri::command]
pub fn site_close(app: AppHandle) -> Result<(), String> {
  if let Some(wv) = app.get_webview(LABEL) {
    let _ = wv.close();
  }
  Ok(())
}

#[tauri::command]
pub fn site_status(app: AppHandle) -> SiteStatus {
  match app.get_webview(LABEL) {
    Some(wv) => SiteStatus {
      open: true,
      url: wv.url().map(|u| u.to_string()).unwrap_or_default(),
    },
    None => SiteStatus {
      open: false,
      url: String::new(),
    },
  }
}