/**
 * 系统能力：外部播放器与系统通知。
 * 都用 Rust 侧命令实现（open / osascript），浏览器预览时静默降级。
 */
import { invoke } from '@tauri-apps/api/core'
import { inTauri } from './cat'

export interface PlayerOption {
  id: 'iina' | 'vlc'
  name: string
}

/** 检测本机装了哪些外部播放器 */
export async function availablePlayers(): Promise<PlayerOption[]> {
  if (!inTauri()) return []
  try {
    const list = (await invoke('available_players')) as string[]
    return (Array.isArray(list) ? list : []).map((name) => ({
      id: name === 'IINA' ? 'iina' : 'vlc',
      name,
    }))
  } catch {
    return []
  }
}

/** 用外部播放器打开地址（解决 MKV / 特殊编码 WebKit 播不了的问题） */
export async function openInPlayer(url: string, player: 'iina' | 'vlc'): Promise<void> {
  await invoke('open_in_player', { url, player })
}

/** 系统通知 */
export async function notify(title: string, body?: string): Promise<void> {
  if (!inTauri()) return
  try {
    await invoke('notify', { title, body: body ?? null })
  } catch {
    /* 通知失败不影响主流程 */
  }
}