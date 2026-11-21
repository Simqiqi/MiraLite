/**
 * WebDAV 云端同步：把本机配置备份传到自己的网盘，换机时拉回来。
 * 配置存在本机（app_data/webdav.json），请求由 Rust 发出，避免跨域。
 */
import { invoke } from '@tauri-apps/api/core'
import { inTauri } from './cat'
import { collectSettings, applyBackup, parseBackupText, type BackupPayload } from './backup'

export interface WebdavView {
  configured: boolean
  url: string
  username: string
  hasPassword: boolean
}

const FILE = 'miralite-backup.json'

export async function getWebdav(): Promise<WebdavView> {
  if (!inTauri()) return { configured: false, url: '', username: '', hasPassword: false }
  return (await invoke('webdav_get_config')) as WebdavView
}

export async function setWebdav(url: string, username: string, password?: string): Promise<WebdavView> {
  return (await invoke('webdav_set_config', { url, username, password: password ?? null })) as WebdavView
}

export async function testWebdav(): Promise<string> {
  return (await invoke('webdav_test')) as string
}

/** 上传当前配置（覆盖云端同名文件） */
export async function uploadBackup(): Promise<{ bytes: number; keys: number }> {
  const data = collectSettings()
  const payload: BackupPayload = { app: 'MiraLite', version: 1, exportedAt: Date.now(), data }
  const text = JSON.stringify(payload, null, 2)
  const bytes = (await invoke('webdav_upload', { file: FILE, content: text })) as number
  return { bytes, keys: Object.keys(data).length }
}

/** 从云端拉回并写入本机（调用方负责刷新界面） */
export async function downloadBackup(): Promise<number> {
  const text = (await invoke('webdav_download', { file: FILE })) as string
  const payload = parseBackupText(JSON.parse(text))
  return applyBackup(payload)
}
