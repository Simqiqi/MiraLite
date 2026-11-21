/**
 * 运维相关：应用信息、日志、诊断包、缓存管理、更新检查、短剧运行时。
 */
import { invoke } from '@tauri-apps/api/core'
import { inTauri } from './cat'

export interface RuntimeInfo {
  version: string
  node: string | null
  nodeHint: string
  logPath: string
  cacheShortBytes: number
  cacheShortFiles: number
  appData: string
}

export interface UpdateInfo {
  current: string
  latest: string | null
  hasUpdate: boolean
  name: string
  notes: string
  htmlUrl: string
  dmgUrl: string | null
  publishedAt: string
  message: string
}

export interface CacheFile {
  name: string
  bytes: number
  mtime: number
}

export interface ShortRuntime {
  node: string | null
  source: 'system' | 'bundled' | 'none'
  version: string
  hint: string
}

export async function diagInfo(): Promise<RuntimeInfo | null> {
  if (!inTauri()) return null
  try {
    return (await invoke('diag_info')) as RuntimeInfo
  } catch {
    return null
  }
}

export async function diagLogTail(lines = 400): Promise<string> {
  if (!inTauri()) return ''
  return (await invoke('diag_log_tail', { lines })) as string
}

export async function diagExport(payload: unknown): Promise<{ path: string; bytes: number }> {
  return (await invoke('diag_export', { content: JSON.stringify(payload, null, 2) })) as {
    path: string
    bytes: number
  }
}

export async function updateCheck(): Promise<UpdateInfo> {
  return (await invoke('update_check')) as UpdateInfo
}

export async function shortCacheList(): Promise<CacheFile[]> {
  if (!inTauri()) return []
  return (await invoke('short_cache_list')) as CacheFile[]
}

export async function shortCacheClear(name?: string): Promise<number> {
  return (await invoke('short_cache_clear', { name: name ?? null })) as number
}

export async function sdRuntime(): Promise<ShortRuntime> {
  if (!inTauri()) return { node: null, source: 'none', version: '', hint: '' }
  return (await invoke('sd_runtime')) as ShortRuntime
}

export async function sdInstallRuntime(): Promise<string> {
  return (await invoke('sd_install_runtime')) as string
}

export function fmtBytes(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let v = n
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i += 1
  }
  return `${v.toFixed(v >= 10 || i === 0 ? 0 : 1)} ${units[i]}`
}
