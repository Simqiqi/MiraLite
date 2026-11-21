//! 短剧：本机 sidecar（Node + openhongguo + 自研 CENC 解密）。
//!
//! 为什么用 sidecar：红果的分片是 CENC 加密的，SDK（Go 编译的 WASM）只在 JS 侧可用，
//! 且取流需要先「握手」。所以由 Node 进程负责取目录/取流 + 解密，Rust 只做进程管理与转发。
//! sidecar 只监听 127.0.0.1，不对外暴露。
use serde::Serialize;
use serde_json::Value;
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::Mutex;
use std::time::{Duration, Instant};
use tauri::{AppHandle, Manager};

const PORT: u16 = 9978;

#[derive(Default)]
pub struct ShortState {
  child: Mutex<Option<Child>>,
  ready: Mutex<bool>,
}

const NODE_VERSION: &str = "v22.14.0";

fn platform_tag() -> Result<&'static str, String> {
  let arch = std::env::consts::ARCH;
  let os = std::env::consts::OS;
  match (os, arch) {
    ("macos", "aarch64") => Ok("darwin-arm64"),
    ("macos", "x86_64") => Ok("darwin-x64"),
    ("linux", "x86_64") => Ok("linux-x64"),
    ("linux", "aarch64") => Ok("linux-arm64"),
    ("windows", "x86_64") => Ok("win-x64"),
    _ => Err(format!("暂不支持自动下载 Node：{os}/{arch}")),
  }
}

fn runtime_dir(app: &AppHandle) -> PathBuf {
  app
    .path()
    .app_data_dir()
    .unwrap_or_else(|_| std::env::temp_dir())
    .join("runtime")
}

fn bundled_node(app: &AppHandle) -> Option<String> {
  let tag = platform_tag().ok()?;
  let root = runtime_dir(app).join(format!("node-{NODE_VERSION}-{tag}"));
  // Windows 的压缩包把 node.exe 放在根目录，macOS / Linux 在 bin/ 下
  let candidates = if cfg!(windows) {
    vec![root.join("node.exe")]
  } else {
    vec![root.join("bin").join("node")]
  };
  candidates
    .into_iter()
    .find(|p| p.exists())
    .map(|p| p.to_string_lossy().to_string())
}

/// 系统 node 优先，其次内置运行时
fn resolve_node(app: &AppHandle) -> Option<String> {
  crate::diag::find_node().or_else(|| bundled_node(app))
}

#[derive(serde::Serialize)]
pub struct RuntimeStatus {
  pub node: Option<String>,
  pub source: String,
  pub version: String,
  pub hint: String,
}

#[tauri::command]
pub fn sd_runtime(app: AppHandle) -> RuntimeStatus {
  if let Some(p) = crate::diag::find_node() {
    return RuntimeStatus {
      node: Some(p),
      source: "system".into(),
      version: NODE_VERSION.into(),
      hint: String::new(),
    };
  }
  if let Some(p) = bundled_node(&app) {
    return RuntimeStatus {
      node: Some(p),
      source: "bundled".into(),
      version: NODE_VERSION.into(),
      hint: String::new(),
    };
  }
  RuntimeStatus {
    node: None,
    source: "none".into(),
    version: NODE_VERSION.into(),
    hint: "没找到 Node：点「下载运行时」即可内置一份（约 40MB），不用装开发环境".into(),
  }
}

/// 下载官方 Node 运行时到应用目录，供 sidecar 使用
#[tauri::command]
pub async fn sd_install_runtime(app: AppHandle) -> Result<String, String> {
  let tag = platform_tag()?;
  let dir = runtime_dir(&app);
  std::fs::create_dir_all(&dir).map_err(|e| format!("创建运行时目录失败：{e}"))?;
  let archive = dir.join(format!("node-{NODE_VERSION}-{tag}.tar.gz"));

  if !archive.exists() {
    let url = format!("https://nodejs.org/dist/{NODE_VERSION}/node-{NODE_VERSION}-{tag}.tar.gz");
    let client = reqwest::Client::builder()
      .timeout(std::time::Duration::from_secs(600))
      .user_agent("MiraLite/0.1 (Tauri)")
      .build()
      .map_err(|e| format!("HTTP 客户端创建失败：{e}"))?;
    let resp = client
      .get(&url)
      .send()
      .await
      .map_err(|e| format!("下载 Node 失败：{e}"))?;
    if !resp.status().is_success() {
      return Err(format!("下载 Node 失败：HTTP {}", resp.status().as_u16()));
    }
    let bytes = resp.bytes().await.map_err(|e| format!("读取下载内容失败：{e}"))?;
    std::fs::write(&archive, &bytes).map_err(|e| format!("写入安装包失败：{e}"))?;
  }

  let status = std::process::Command::new("tar")
    .arg("-xzf")
    .arg(&archive)
    .arg("-C")
    .arg(&dir)
    .status()
    .map_err(|e| format!("解压失败（需要系统自带 tar）：{e}"))?;
  if !status.success() {
    return Err("解压 Node 安装包失败".to_string());
  }

  let node = bundled_node(&app).ok_or_else(|| "解压后没有找到 node 可执行文件".to_string())?;
  let _ = std::fs::remove_file(&archive);
  Ok(node)
}

fn sidecar_dir(app: &AppHandle) -> Result<PathBuf, String> {
  let mut candidates: Vec<PathBuf> = Vec::new();

  // 1) 打进 App 资源里的副本
  if let Ok(res) = app.path().resource_dir() {
    candidates.push(res.join("sidecar/short-drama"));
    candidates.push(res.join("../sidecar/short-drama"));
  }
  // 2) 开发环境：仓库目录
  if let Ok(cwd) = std::env::current_dir() {
    candidates.push(cwd.join("sidecar/short-drama"));
    candidates.push(cwd.join("../sidecar/short-drama"));
  }
  // 3) 固定路径兜底（本机工作区）
  candidates.push(PathBuf::from("/Users/mac/Documents/Loomy Workspace/MiraLite/sidecar/short-drama"));

  for c in candidates {
    if c.join("server.mjs").exists() && c.join("node_modules/openhongguo").exists() {
      return Ok(c);
    }
  }
  Err("找不到短剧 sidecar（sidecar/short-drama），确认依赖已安装".to_string())
}

fn cache_dir(app: &AppHandle) -> PathBuf {
  app
    .path()
    .app_cache_dir()
    .unwrap_or_else(|_| std::env::temp_dir())
    .join("short-drama")
}

fn spawn(app: &AppHandle, state: &ShortState) -> Result<(), String> {
  {
    let guard = state.child.lock().unwrap();
    if guard.is_some() {
      return Ok(());
    }
  }
  let dir = sidecar_dir(app)?;
  let cache = cache_dir(app);
  std::fs::create_dir_all(&cache).map_err(|e| format!("创建缓存目录失败: {e}"))?;

  // Finder 启动的 App PATH 很干净：先找系统 node，再找内置运行时
  let node = resolve_node(&app).unwrap_or_else(|| "node".to_string());

  let child = Command::new(node)
    .arg("server.mjs")
    .arg("--port")
    .arg(PORT.to_string())
    .arg("--cache")
    .arg(cache.to_string_lossy().to_string())
    .current_dir(&dir)
    .stdout(Stdio::null())
    .stderr(Stdio::null())
    .spawn()
    .map_err(|e| format!("启动短剧服务失败（需要 node 在 PATH 里）: {e}"))?;

  *state.child.lock().unwrap() = Some(child);
  *state.ready.lock().unwrap() = false;
  Ok(())
}

async fn wait_ready(state: &ShortState) -> Result<(), String> {
  if *state.ready.lock().unwrap() {
    return Ok(());
  }
  let client = reqwest::Client::builder()
    .timeout(Duration::from_secs(3))
    .build()
    .map_err(|e| format!("HTTP 客户端创建失败: {e}"))?;
  let deadline = Instant::now() + Duration::from_secs(25);
  while Instant::now() < deadline {
    if let Ok(r) = client
      .get(format!("http://127.0.0.1:{PORT}/health"))
      .send()
      .await
    {
      if r.status().is_success() {
        *state.ready.lock().unwrap() = true;
        return Ok(());
      }
    }
    tokio::time::sleep(Duration::from_millis(400)).await;
  }
  Err("短剧服务启动超时（首次启动要装依赖，可能比较慢）".to_string())
}

async fn call(path: &str, body: Option<Value>) -> Result<Value, String> {
  let client = reqwest::Client::builder()
    .timeout(Duration::from_secs(300))
    .build()
    .map_err(|e| format!("HTTP 客户端创建失败: {e}"))?;
  let url = format!("http://127.0.0.1:{PORT}{path}");
  let resp = match body {
    Some(b) => client.post(&url).json(&b).send().await,
    None => client.get(&url).send().await,
  }
  .map_err(|e| format!("短剧服务请求失败: {e}"))?;

  let status = resp.status().as_u16();
  let text = resp.text().await.map_err(|e| format!("读取响应失败: {e}"))?;
  let parsed: Value = serde_json::from_str(&text).unwrap_or(Value::Null);
  if !(200..300).contains(&status) {
    let msg = parsed
      .get("error")
      .and_then(|v| v.as_str())
      .unwrap_or("短剧服务返回错误");
    return Err(msg.to_string());
  }
  Ok(parsed)
}

/// 确保 sidecar 在跑（前端进页面时调一次）
#[tauri::command]
pub async fn sd_start(app: AppHandle, state: tauri::State<'_, ShortState>) -> Result<bool, String> {
  spawn(&app, &state)?;
  wait_ready(&state).await?;
  Ok(true)
}

#[tauri::command]
pub async fn sd_new(state: tauri::State<'_, ShortState>) -> Result<Value, String> {
  call("/new", None).await
}

#[tauri::command]
pub async fn sd_search(q: String, state: tauri::State<'_, ShortState>) -> Result<Value, String> {
  let q = urlencoding::encode(q.trim()).into_owned();
  call(&format!("/search?q={q}"), None).await
}

#[tauri::command]
pub async fn sd_series(id: String, state: tauri::State<'_, ShortState>) -> Result<Value, String> {
  let id = urlencoding::encode(id.trim()).into_owned();
  call(&format!("/series?id={id}"), None).await
}

#[tauri::command]
pub async fn sd_episodes(id: String, state: tauri::State<'_, ShortState>) -> Result<Value, String> {
  let id = urlencoding::encode(id.trim()).into_owned();
  call(&format!("/episodes?id={id}"), None).await
}

/// 取某一集：下载 + 解密到本地缓存，返回本地文件路径
#[tauri::command]
pub async fn sd_prepare(
  series_id: String,
  episode_id: String,
  definition: Option<String>,
  state: tauri::State<'_, ShortState>,
) -> Result<Value, String> {
  call(
    "/prepare",
    Some(serde_json::json!({
      "seriesId": series_id,
      "episodeId": episode_id,
      "definition": definition.unwrap_or_else(|| "540p".to_string()),
    })),
  )
  .await
}

/// 把若干集加入下载队列（串行下载 + 解密），返回队列快照
#[tauri::command]
pub async fn sd_queue_add(
  series_id: String,
  title: String,
  episodes: Vec<Value>,
  state: tauri::State<'_, ShortState>,
) -> Result<Value, String> {
  call(
    "/queue/add",
    Some(serde_json::json!({
      "seriesId": series_id,
      "title": title,
      "episodes": episodes,
    })),
  )
  .await
}

#[tauri::command]
pub async fn sd_queue(state: tauri::State<'_, ShortState>) -> Result<Value, String> {
  let _ = &state;
  call("/queue", None).await
}

#[tauri::command]
pub async fn sd_queue_clear(state: tauri::State<'_, ShortState>) -> Result<Value, String> {
  let _ = &state;
  call("/queue/clear", Some(serde_json::json!({}))).await
}

#[derive(Serialize)]
pub struct ShortStatus {
  pub running: bool,
  pub port: u16,
}

#[tauri::command]
pub fn sd_status(state: tauri::State<'_, ShortState>) -> ShortStatus {
  let running = state.child.lock().map(|g| g.is_some()).unwrap_or(false);
  ShortStatus { running, port: PORT }
}