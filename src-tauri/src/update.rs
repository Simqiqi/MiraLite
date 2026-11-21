//! 更新检查：直接问 GitHub Releases（公开仓库），不需要签名密钥。
//!
//! 只在用户点「检查更新」时请求，comparison 用简单的语义化版本比较。
use serde::Serialize;
use serde_json::Value;
use std::time::Duration;

const REPO: &str = "Simqiqi/MiraLite";

#[derive(Serialize)]
pub struct UpdateInfo {
  pub current: String,
  pub latest: Option<String>,
  pub has_update: bool,
  pub name: String,
  pub notes: String,
  pub html_url: String,
  pub dmg_url: Option<String>,
  pub published_at: String,
  pub message: String,
}

fn parse_version(v: &str) -> Vec<u64> {
  v.trim()
    .trim_start_matches('v')
    .split(['.', '-', '+'])
    .map(|x| x.parse::<u64>().unwrap_or(0))
    .collect()
}

/// 返回 a 是否比 b 新
fn is_newer(a: &str, b: &str) -> bool {
  let (va, vb) = (parse_version(a), parse_version(b));
  for i in 0..va.len().max(vb.len()) {
    let x = *va.get(i).unwrap_or(&0);
    let y = *vb.get(i).unwrap_or(&0);
    if x != y {
      return x > y;
    }
  }
  false
}

#[tauri::command]
pub async fn update_check() -> Result<UpdateInfo, String> {
  let current = env!("CARGO_PKG_VERSION").to_string();
  let client = reqwest::Client::builder()
    .timeout(Duration::from_secs(20))
    .user_agent("MiraLite/0.1 (Tauri)")
    .build()
    .map_err(|e| format!("HTTP 客户端创建失败: {e}"))?;

  let resp = client
    .get(format!("https://api.github.com/repos/{REPO}/releases/latest"))
    .header("Accept", "application/vnd.github+json")
    .send()
    .await
    .map_err(|e| {
      if e.is_timeout() {
        "请求超时（检查网络或代理）".to_string()
      } else {
        format!("请求失败：{e}")
      }
    })?;

  if resp.status().as_u16() == 404 {
    return Ok(UpdateInfo {
      current: current.clone(),
      latest: None,
      has_update: false,
      name: String::new(),
      notes: String::new(),
      html_url: format!("https://github.com/{REPO}/releases"),
      dmg_url: None,
      published_at: String::new(),
      message: "仓库还没有发布过 Release".to_string(),
    });
  }
  if !resp.status().is_success() {
    return Err(format!("GitHub 返回 HTTP {}", resp.status().as_u16()));
  }

  let data: Value = resp.json().await.map_err(|e| format!("解析响应失败：{e}"))?;
  let tag = data.get("tag_name").and_then(|v| v.as_str()).unwrap_or("").to_string();
  let name = data.get("name").and_then(|v| v.as_str()).unwrap_or(&tag).to_string();
  let notes = data
    .get("body")
    .and_then(|v| v.as_str())
    .unwrap_or("")
    .chars()
    .take(1200)
    .collect::<String>();
  let html_url = data
    .get("html_url")
    .and_then(|v| v.as_str())
    .unwrap_or("")
    .to_string();
  let published_at = data
    .get("published_at")
    .and_then(|v| v.as_str())
    .unwrap_or("")
    .to_string();

  let dmg_url = data
    .get("assets")
    .and_then(|v| v.as_array())
    .and_then(|assets| {
      assets.iter().find_map(|a| {
        let n = a.get("name").and_then(|v| v.as_str()).unwrap_or("");
        if n.ends_with(".dmg") {
          a.get("browser_download_url").and_then(|v| v.as_str()).map(str::to_string)
        } else {
          None
        }
      })
    });

  let has_update = !tag.is_empty() && is_newer(&tag, &current);
  Ok(UpdateInfo {
    current,
    latest: if tag.is_empty() { None } else { Some(tag) },
    has_update,
    name,
    notes,
    html_url,
    dmg_url,
    published_at,
    message: String::new(),
  })
}

#[cfg(test)]
mod tests {
  use super::{is_newer, parse_version};

  #[test]
  fn version_compare() {
    assert!(is_newer("v0.3.0", "0.2.9"));
    assert!(is_newer("0.2.10", "0.2.9"));
    assert!(!is_newer("0.2.0", "0.2.0"));
    assert!(!is_newer("v0.1.9", "0.2.0"));
    assert_eq!(parse_version("v1.2.3"), vec![1, 2, 3]);
  }
}