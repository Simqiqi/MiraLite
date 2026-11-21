//! WebDAV 配置同步：把本机备份上传到自己的网盘，换机时拉回来。
//! 只做 PUT / GET + Basic Auth，够用且不引入额外依赖。
use serde::{Deserialize, Serialize};
use std::path::PathBuf;
use std::time::Duration;
use tauri::{AppHandle, Manager};

#[derive(Serialize, Deserialize, Clone, Default)]
pub struct WebdavConfig {
  #[serde(default)]
  pub url: String,
  #[serde(default)]
  pub username: String,
  #[serde(default)]
  pub password: String,
}

#[derive(Serialize)]
pub struct WebdavView {
  pub configured: bool,
  pub url: String,
  pub username: String,
  pub has_password: bool,
}

fn config_path(app: &AppHandle) -> Result<PathBuf, String> {
  let dir = app
    .path()
    .app_data_dir()
    .map_err(|e| format!("拿不到应用数据目录: {e}"))?;
  std::fs::create_dir_all(&dir).map_err(|e| format!("创建配置目录失败: {e}"))?;
  Ok(dir.join("webdav.json"))
}

fn load(app: &AppHandle) -> WebdavConfig {
  match config_path(app)
    .ok()
    .and_then(|p| std::fs::read_to_string(p).ok())
  {
    Some(s) => serde_json::from_str::<WebdavConfig>(&s).unwrap_or_default(),
    None => WebdavConfig::default(),
  }
}

fn save(app: &AppHandle, cfg: &WebdavConfig) -> Result<(), String> {
  let path = config_path(app)?;
  let text = serde_json::to_string_pretty(cfg).map_err(|e| format!("序列化失败: {e}"))?;
  std::fs::write(&path, text).map_err(|e| format!("写入失败: {e}"))
}

fn client() -> Result<reqwest::Client, String> {
  reqwest::Client::builder()
    .timeout(Duration::from_secs(60))
    .user_agent("MiraLite/0.1 (Tauri)")
    .build()
    .map_err(|e| format!("HTTP 客户端创建失败: {e}"))
}

fn endpoint(cfg: &WebdavConfig, file: &str) -> Result<String, String> {
  let base = cfg.url.trim().trim_end_matches('/');
  if base.is_empty() {
    return Err("还没配置 WebDAV 地址".to_string());
  }
  if !(base.starts_with("http://") || base.starts_with("https://")) {
    return Err("WebDAV 地址需要以 http:// 或 https:// 开头".to_string());
  }
  Ok(format!("{base}/{file}"))
}

#[tauri::command]
pub fn webdav_get_config(app: AppHandle) -> WebdavView {
  let cfg = load(&app);
  WebdavView {
    configured: !cfg.url.trim().is_empty(),
    url: cfg.url,
    username: cfg.username,
    has_password: !cfg.password.is_empty(),
  }
}

#[tauri::command]
pub fn webdav_set_config(
  app: AppHandle,
  url: String,
  username: String,
  password: Option<String>,
) -> Result<WebdavView, String> {
  let mut cfg = load(&app);
  cfg.url = url.trim().to_string();
  cfg.username = username.trim().to_string();
  // 传空字符串 = 清空密码；传 None = 保留原密码
  if let Some(p) = password {
    cfg.password = p;
  }
  save(&app, &cfg)?;
  Ok(WebdavView {
    configured: !cfg.url.trim().is_empty(),
    url: cfg.url,
    username: cfg.username,
    has_password: !cfg.password.is_empty(),
  })
}

/// 上传一份文本到 `{url}/{file}`
#[tauri::command]
pub async fn webdav_upload(app: AppHandle, file: String, content: String) -> Result<u64, String> {
  let cfg = load(&app);
  let url = endpoint(&cfg, file.trim())?;
  let mut req = client()?.put(url).body(content.clone());
  if !cfg.username.is_empty() {
    req = req.basic_auth(cfg.username.clone(), Some(cfg.password.clone()));
  }
  let resp = req
    .header("content-type", "application/json")
    .send()
    .await
    .map_err(|e| format!("上传失败: {e}"))?;
  let status = resp.status().as_u16();
  if !(200..300).contains(&status) {
    return Err(format!("上传失败：HTTP {status}（检查地址、账号或目录权限）"));
  }
  Ok(content.len() as u64)
}

/// 从 `{url}/{file}` 拉回文本
#[tauri::command]
pub async fn webdav_download(app: AppHandle, file: String) -> Result<String, String> {
  let cfg = load(&app);
  let url = endpoint(&cfg, file.trim())?;
  let mut req = client()?.get(url);
  if !cfg.username.is_empty() {
    req = req.basic_auth(cfg.username.clone(), Some(cfg.password.clone()));
  }
  let resp = req.send().await.map_err(|e| format!("下载失败: {e}"))?;
  let status = resp.status().as_u16();
  if status == 404 {
    return Err("云端还没有这个备份文件".to_string());
  }
  if !(200..300).contains(&status) {
    return Err(format!("下载失败：HTTP {status}"));
  }
  resp.text().await.map_err(|e| format!("读取内容失败: {e}"))
}

/// 连通性测试：上传一个探针文件再读回来
#[tauri::command]
pub async fn webdav_test(app: AppHandle) -> Result<String, String> {
  let probe = "miralite-webdav-probe.json".to_string();
  let payload = format!("{{\"t\":{}}}", now_secs());
  webdav_upload(app.clone(), probe.clone(), payload.clone()).await?;
  let back = webdav_download(app, probe).await?;
  if back.trim() == payload.trim() {
    Ok("连接正常，上传与读取都成功".to_string())
  } else {
    Ok("能上传，但读回的内容不一致（可能是网盘做了改写）".to_string())
  }
}

fn now_secs() -> u64 {
  std::time::SystemTime::now()
    .duration_since(std::time::UNIX_EPOCH)
    .map(|d| d.as_secs())
    .unwrap_or(0)
}