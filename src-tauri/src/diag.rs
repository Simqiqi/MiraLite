//! 诊断与运维：应用信息、日志读取、诊断包导出、缓存统计与清理。
use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Manager};

#[derive(Serialize)]
pub struct RuntimeInfo {
  pub version: String,
  pub node: Option<String>,
  pub node_hint: String,
  pub log_path: String,
  pub cache_short_bytes: u64,
  pub cache_short_files: u64,
  pub app_data: String,
}

fn dir_size(dir: &Path) -> (u64, u64) {
  let mut bytes = 0u64;
  let mut files = 0u64;
  if let Ok(rd) = std::fs::read_dir(dir) {
    for entry in rd.flatten() {
      if let Ok(meta) = entry.metadata() {
        if meta.is_file() {
          bytes += meta.len();
          files += 1;
        } else if meta.is_dir() {
          let (b, f) = dir_size(&entry.path());
          bytes += b;
          files += f;
        }
      }
    }
  }
  (bytes, files)
}

fn log_path(app: &AppHandle) -> PathBuf {
  app
    .path()
    .app_log_dir()
    .map(|d| d.join("MiraLite.log"))
    .unwrap_or_else(|_| std::env::temp_dir().join("MiraLite.log"))
}

fn node_candidates() -> Vec<String> {
  let mut out = vec![
    "/usr/local/bin/node".to_string(),
    "/opt/homebrew/bin/node".to_string(),
    "/usr/bin/node".to_string(),
  ];
  if let Ok(home) = std::env::var("HOME") {
    out.push(format!("{home}/.volta/bin/node"));
    out.push(format!("{home}/.nvm/current/bin/node"));
  }
  out
}

pub(crate) fn find_node() -> Option<String> {
  node_candidates()
    .into_iter()
    .find(|p| Path::new(p).exists())
}

#[tauri::command]
pub fn diag_info(app: AppHandle) -> RuntimeInfo {
  let cache_dir = app
    .path()
    .app_cache_dir()
    .unwrap_or_else(|_| std::env::temp_dir())
    .join("short-drama");
  let (cache_short_bytes, cache_short_files) = dir_size(&cache_dir);
  let node = find_node();

  RuntimeInfo {
    version: env!("CARGO_PKG_VERSION").to_string(),
    node_hint: if node.is_some() {
      "系统已安装 Node".to_string()
    } else {
      "没找到 Node：短剧功能需要在设置里一键下载内置运行时".to_string()
    },
    node,
    log_path: log_path(&app).to_string_lossy().to_string(),
    cache_short_bytes,
    cache_short_files,
    app_data: app
      .path()
      .app_data_dir()
      .map(|p| p.to_string_lossy().to_string())
      .unwrap_or_default(),
  }
}

/// 读取日志末尾若干行（默认 300）
#[tauri::command]
pub fn diag_log_tail(app: AppHandle, lines: Option<usize>) -> Result<String, String> {
  let path = log_path(&app);
  let text = std::fs::read_to_string(&path).map_err(|e| format!("读不到日志（{e}）"))?;
  let take = lines.unwrap_or(300).min(5000);
  let all: Vec<&str> = text.lines().collect();
  let start = all.len().saturating_sub(take);
  Ok(all[start..].join("\n"))
}

#[derive(Serialize)]
pub struct ExportInfo {
  pub path: String,
  pub bytes: usize,
}

/// 把诊断包写进下载目录（前端把配置摘要拼好传进来）
#[tauri::command]
pub fn diag_export(content: String) -> Result<ExportInfo, String> {
  let home = std::env::var("HOME").map_err(|_| "拿不到用户目录".to_string())?;
  let dir = PathBuf::from(home).join("Downloads");
  std::fs::create_dir_all(&dir).map_err(|e| format!("创建下载目录失败：{e}"))?;
  let stamp = std::process::Command::new("date")
    .arg("+%Y%m%d-%H%M%S")
    .output()
    .ok()
    .filter(|o| o.status.success())
    .map(|o| String::from_utf8_lossy(&o.stdout).trim().to_string())
    .unwrap_or_else(|| "diag".to_string());
  let path = dir.join(format!("miralite-diag-{stamp}.json"));
  std::fs::write(&path, content.as_bytes()).map_err(|e| format!("写入失败：{e}"))?;
  Ok(ExportInfo {
    path: path.to_string_lossy().to_string(),
    bytes: content.len(),
  })
}

/// 短剧缓存列表（文件名 / 大小 / 时间）
#[derive(Serialize)]
pub struct CacheFile {
  pub name: String,
  pub bytes: u64,
  pub mtime: u64,
}

#[tauri::command]
pub fn short_cache_list(app: AppHandle) -> Vec<CacheFile> {
  let dir = app
    .path()
    .app_cache_dir()
    .unwrap_or_else(|_| std::env::temp_dir())
    .join("short-drama");
  let mut out = Vec::new();
  if let Ok(rd) = std::fs::read_dir(&dir) {
    for entry in rd.flatten() {
      if let Ok(meta) = entry.metadata() {
        if !meta.is_file() {
          continue;
        }
        let mtime = meta
          .modified()
          .ok()
          .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
          .map(|d| d.as_secs())
          .unwrap_or(0);
        out.push(CacheFile {
          name: entry.file_name().to_string_lossy().to_string(),
          bytes: meta.len(),
          mtime,
        });
      }
    }
  }
  out.sort_by(|a, b| b.mtime.cmp(&a.mtime));
  out
}

/// 清空短剧缓存；传 name 只删单个文件
#[tauri::command]
pub fn short_cache_clear(app: AppHandle, name: Option<String>) -> Result<u64, String> {
  let dir = app
    .path()
    .app_cache_dir()
    .unwrap_or_else(|_| std::env::temp_dir())
    .join("short-drama");
  let mut freed = 0u64;
  match name {
    Some(n) => {
      let p = dir.join(n);
      if let Ok(meta) = std::fs::metadata(&p) {
        freed = meta.len();
      }
      std::fs::remove_file(&p).map_err(|e| format!("删除失败：{e}"))?;
    }
    None => {
      if let Ok(rd) = std::fs::read_dir(&dir) {
        for entry in rd.flatten() {
          if let Ok(meta) = entry.metadata() {
            if meta.is_file() {
              freed += meta.len();
              let _ = std::fs::remove_file(entry.path());
            }
          }
        }
      }
    }
  }
  Ok(freed)
}