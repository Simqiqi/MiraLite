//! 与系统打交道的零碎命令。

/// 用系统浏览器打开一个链接。
/// `browser` 传应用名（如 "Microsoft Edge"）时优先用它，否则走系统默认浏览器。
#[tauri::command]
pub fn open_url(url: String, browser: Option<String>) -> Result<String, String> {
    let u = url.trim().to_string();
    if !(u.starts_with("http://") || u.starts_with("https://")) {
        return Err("只支持 http / https 链接".into());
    }

    let mut cmd = std::process::Command::new("open");
    if let Some(app) = browser.as_deref().map(str::trim).filter(|s| !s.is_empty()) {
        cmd.arg("-a").arg(app);
    }
    cmd.arg(&u)
        .spawn()
        .map_err(|e| format!("打开链接失败: {e}"))?;

    Ok(u)
}

/// 系统里是否存在某个 .app（用于前端决定「用 Edge 打开」按钮显不显示）
#[tauri::command]
pub fn has_app(name: String) -> bool {
    let n = name.trim();
    if n.is_empty() {
        return false;
    }
    std::path::Path::new("/Applications").join(format!("{n}.app")).exists()
        || std::path::Path::new("/System/Applications")
            .join(format!("{n}.app"))
            .exists()
        || std::env::var("HOME")
            .ok()
            .map(|h| std::path::Path::new(&h).join("Applications").join(format!("{n}.app")).exists())
            .unwrap_or(false)
}

/// 已安装的第三方播放器（IINA / VLC），用于前端决定「外部播放」按钮显不显示
#[tauri::command]
pub fn available_players() -> Vec<String> {
    ["IINA", "VLC"]
        .iter()
        .filter(|n| has_app(n.to_string()))
        .map(|n| n.to_string())
        .collect()
}

/// 用外部播放器打开地址。`player` 传 "iina" / "vlc"。
#[tauri::command]
pub fn open_in_player(url: String, player: String) -> Result<String, String> {
    let u = url.trim().to_string();
    if !(u.starts_with("http://") || u.starts_with("https://")) {
        return Err("只支持 http / https 地址".into());
    }
    let app = match player.as_str() {
        "iina" => "IINA",
        "vlc" => "VLC",
        other => return Err(format!("不支持的播放器：{other}")),
    };
    if !has_app(app.to_string()) {
        return Err(format!("没有找到 {app}，先装一个再用外部播放"));
    }
    std::process::Command::new("open")
        .arg("-a")
        .arg(app)
        .arg(&u)
        .spawn()
        .map_err(|e| format!("调起 {app} 失败: {e}"))?;
    Ok(u)
}

/// 系统通知（走 osascript，省一个插件依赖）
#[tauri::command]
pub fn notify(title: String, body: Option<String>) -> Result<(), String> {
    let t = title.trim().replace('"', "'");
    let b = body.unwrap_or_default().trim().replace('"', "'");
    if t.is_empty() {
        return Err("通知标题不能为空".into());
    }
    let script = if b.is_empty() {
        format!("display notification \"\" with title \"{t}\"")
    } else {
        format!("display notification \"{b}\" with title \"{t}\"")
    };
    let out = std::process::Command::new("osascript")
        .arg("-e")
        .arg(script)
        .output()
        .map_err(|e| format!("调起通知失败: {e}"))?;
    if out.status.success() {
        Ok(())
    } else {
        Err(String::from_utf8_lossy(&out.stderr).trim().to_string())
    }
}
