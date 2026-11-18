//! 频道体检与配置备份。
//!
//! 体检用短超时 GET + Range 读前 2KB，不发 HEAD（不少 IPTV 源对 HEAD 返回 405），
//! 拿到响应头就算连通，不读整段流。备份写文件走系统下载目录，恢复时用系统选择框。
use serde::Serialize;
use std::path::PathBuf;
use std::time::{Duration, Instant};

const PROBE_TIMEOUT: Duration = Duration::from_secs(6);
const MAX_BACKUP_BYTES: u64 = 5 * 1024 * 1024;

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ProbeResult {
  pub ok: bool,
  pub status: u16,
  pub ms: u64,
  pub message: String,
}

/// 探测一个播放地址是否可达
#[tauri::command]
pub async fn probe_url(url: String) -> Result<ProbeResult, String> {
  let target = url.trim().to_string();
  if !(target.starts_with("http://") || target.starts_with("https://")) {
    return Err("只支持 http/https 地址".to_string());
  }
  let client = reqwest::Client::builder()
    .timeout(PROBE_TIMEOUT)
    .user_agent("MiraLite/0.1 (Tauri)")
    .build()
    .map_err(|e| format!("HTTP 客户端创建失败：{e}"))?;

  let started = Instant::now();
  let resp = client
    .get(&target)
    .header("Range", "bytes=0-2047")
    .send()
    .await;

  let ms = started.elapsed().as_millis() as u64;
  match resp {
    Ok(r) => {
      let status = r.status().as_u16();
      let ok = status < 400;
      Ok(ProbeResult {
        ok,
        status,
        ms,
        message: if ok {
          String::new()
        } else {
          format!("上游返回 HTTP {status}")
        },
      })
    }
    // 探测失败不算命令失败，返回结构体让前端批量处理
    Err(e) => Ok(ProbeResult {
      ok: false,
      status: 0,
      ms,
      message: if e.is_timeout() {
        "连接超时".to_string()
      } else if e.is_connect() {
        "无法连接".to_string()
      } else {
        format!("请求失败：{e}")
      },
    }),
  }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct ExportResult {
  pub path: String,
  pub bytes: usize,
}

fn timestamp() -> String {
  // macOS / Linux 都有 date，省掉一个时间库依赖
  std::process::Command::new("date")
    .arg("+%Y%m%d-%H%M%S")
    .output()
    .ok()
    .and_then(|o| {
      if o.status.success() {
        Some(String::from_utf8_lossy(&o.stdout).trim().to_string())
      } else {
        None
      }
    })
    .unwrap_or_else(|| "backup".to_string())
}

/// 把前端拼好的 JSON 写到下载目录，返回完整路径
#[tauri::command]
pub fn export_backup(content: String) -> Result<ExportResult, String> {
  let home = std::env::var("HOME").map_err(|_| "拿不到用户目录".to_string())?;
  let dir = PathBuf::from(home).join("Downloads");
  if !dir.exists() {
    std::fs::create_dir_all(&dir).map_err(|e| format!("创建下载目录失败：{e}"))?;
  }
  let path = dir.join(format!("miralite-backup-{}.json", timestamp()));
  std::fs::write(&path, content.as_bytes()).map_err(|e| format!("写入备份失败：{e}"))?;
  Ok(ExportResult {
    path: path.to_string_lossy().to_string(),
    bytes: content.len(),
  })
}

/// 系统选择框挑一个 .json 备份；取消返回 None
#[tauri::command]
pub async fn pick_backup_file() -> Result<Option<String>, String> {
  tauri::async_runtime::spawn_blocking(|| {
    let script = "POSIX path of (choose file with prompt \"选择 MiraLite 备份\" of type {\"json\"})";
    let out = std::process::Command::new("osascript")
      .arg("-e")
      .arg(script)
      .output()
      .map_err(|e| format!("调起选择框失败：{e}"))?;
    if !out.status.success() {
      return Ok(None);
    }
    let path = String::from_utf8_lossy(&out.stdout).trim().to_string();
    if path.is_empty() {
      Ok(None)
    } else {
      Ok(Some(path))
    }
  })
  .await
  .map_err(|e| format!("选择框异常：{e}"))?
}

/// 读取备份文件（只允许 .json，5MB 上限）
#[tauri::command]
pub fn read_backup_file(path: String) -> Result<String, String> {
  let p = PathBuf::from(&path);
  let is_json = p
    .extension()
    .map(|e| e.to_string_lossy().to_lowercase() == "json")
    .unwrap_or(false);
  if !is_json {
    return Err("只能恢复 .json 备份文件".to_string());
  }
  let meta = std::fs::metadata(&p).map_err(|e| format!("读不到备份文件：{e}"))?;
  if meta.len() > MAX_BACKUP_BYTES {
    return Err("备份文件超过 5MB，可能不是 MiraLite 的备份".to_string());
  }
  std::fs::read_to_string(&p).map_err(|e| format!("读取备份失败：{e}"))
}