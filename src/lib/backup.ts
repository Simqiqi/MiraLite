/**
 * 配置备份 / 恢复。
 *
 * 只收 `miralite.*` 里真正需要带走的东西：源、收藏、追剧、观看进度、
 * CAT 订阅、脚本等；EPG 缓存、榜单缓存、体检结果都能重新生成，不写进备份。
 */
import { invoke } from '@tauri-apps/api/core'
import { inTauri } from './cat'

const PREFIX = 'miralite.'
const SKIP_KEYS = new Set([
  'miralite.tmdb.rankings.v1',
  'miralite.health.v1',
  'miralite.debug',
])
const SKIP_PREFIX = ['miralite.epg.v1|']

export interface BackupPayload {
  app: 'MiraLite'
  version: 1
  exportedAt: number
  data: Record<string, string>
}

function shouldKeep(key: string): boolean {
  if (!key.startsWith(PREFIX)) return false
  if (SKIP_KEYS.has(key)) return false
  return !SKIP_PREFIX.some((p) => key.startsWith(p))
}

/** 把当前 localStorage 里需要备份的键收成一个对象 */
export function collectSettings(): Record<string, string> {
  const data: Record<string, string> = {}
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i)
    if (!key || !shouldKeep(key)) continue
    const value = localStorage.getItem(key)
    if (value != null) data[key] = value
  }
  return data
}

export async function exportSettings(): Promise<{ path: string; bytes: number; keys: number }> {
  const data = collectSettings()
  const payload: BackupPayload = { app: 'MiraLite', version: 1, exportedAt: Date.now(), data }
  const text = JSON.stringify(payload, null, 2)

  if (inTauri()) {
    const r = (await invoke('export_backup', { content: text })) as { path: string; bytes: number }
    return { ...r, keys: Object.keys(data).length }
  }

  // 浏览器预览兜底：直接触发下载
  const url = URL.createObjectURL(new Blob([text], { type: 'application/json' }))
  const a = document.createElement('a')
  a.href = url
  a.download = `miralite-backup-${Date.now()}.json`
  a.click()
  URL.revokeObjectURL(url)
  return { path: a.download, bytes: text.length, keys: Object.keys(data).length }
}

function validate(raw: unknown): BackupPayload {
  if (!raw || typeof raw !== 'object') throw new Error('备份文件格式不对')
  const p = raw as Partial<BackupPayload>
  if (p.app !== 'MiraLite') throw new Error('这不是 MiraLite 的备份文件')
  if (!p.data || typeof p.data !== 'object') throw new Error('备份里没有配置数据')
  const data: Record<string, string> = {}
  let count = 0
  for (const [k, v] of Object.entries(p.data)) {
    if (typeof k !== 'string' || !k.startsWith(PREFIX)) continue
    if (typeof v !== 'string') continue
    data[k] = v
    count += 1
    if (count > 300) throw new Error('备份条目异常，已中止')
  }
  if (count === 0) throw new Error('备份里没有可恢复的 MiraLite 配置')
  return { app: 'MiraLite', version: 1, exportedAt: Number(p.exportedAt) || Date.now(), data }
}

/** 选择备份文件并解析；用户取消返回 null */
export async function pickBackup(): Promise<BackupPayload | null> {
  if (!inTauri()) throw new Error('恢复备份需要在 App 内运行')
  const path = (await invoke('pick_backup_file')) as string | null
  if (!path) return null
  const text = (await invoke('read_backup_file', { path })) as string
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error('备份文件不是合法 JSON')
  }
  return validate(parsed)
}

/** 写入 localStorage，返回恢复的条目数（调用方负责 reload） */
export function applyBackup(payload: BackupPayload): number {
  const entries = Object.entries(payload.data)
  for (const [k, v] of entries) localStorage.setItem(k, v)
  return entries.length
}