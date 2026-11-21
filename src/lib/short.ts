/**
 * 短剧（免费方案）：走本机 sidecar（Node + openhongguo）。
 *
 * 目录（上新 / 搜索 / 详情 / 分集）直接可用；点某一集时由 sidecar 下载并本地解密
 * （红果的分片是 CENC 加密），再返回明文 mp4 路径给播放器。
 */
import { invoke } from '@tauri-apps/api/core'
import { convertFileSrc } from '@tauri-apps/api/core'
import { inTauri } from './cat'

export interface DramaItem {
  id: string
  title: string
  description: string
  cover: string
  episodes: number
  tags: string[]
}

export interface DramaEpisode {
  id: string
  number: number
  title: string
  playable: boolean
  duration: number
}

export interface PreparedEpisode {
  path: string
  cached: boolean
  definition: string
  duration: number
  bytes?: number
}

/** 启动 sidecar（进页面时调一次；已启动会立刻返回） */
export async function sdStart(): Promise<void> {
  if (!inTauri()) return
  await invoke('sd_start')
}

export async function sdNew(): Promise<DramaItem[]> {
  if (!inTauri()) return []
  const r = (await invoke('sd_new')) as { items?: DramaItem[] }
  return Array.isArray(r?.items) ? r.items : []
}

export async function sdSearch(q: string): Promise<DramaItem[]> {
  if (!inTauri() || !q.trim()) return []
  const r = (await invoke('sd_search', { q })) as { items?: DramaItem[] }
  return Array.isArray(r?.items) ? r.items : []
}

export async function sdSeries(id: string): Promise<DramaItem | null> {
  if (!inTauri()) return null
  const r = (await invoke('sd_series', { id })) as DramaItem | null
  return r && r.id ? r : null
}

export async function sdEpisodes(id: string): Promise<DramaEpisode[]> {
  if (!inTauri()) return []
  const r = (await invoke('sd_episodes', { id })) as { items?: DramaEpisode[] }
  return Array.isArray(r?.items) ? r.items : []
}

/** 下载 + 解密某一集，返回本地文件（缓存命中会很快返回） */
export async function sdPrepare(
  seriesId: string,
  episodeId: string,
  definition = '540p',
): Promise<PreparedEpisode> {
  const r = (await invoke('sd_prepare', { seriesId, episodeId, definition })) as PreparedEpisode
  if (!r?.path) throw new Error('没有拿到可播放文件')
  return r
}

/** 本地文件 → 播放页地址 */
export function localPlayPath(item: DramaItem, ep: DramaEpisode, filePath: string): string {
  const params = new URLSearchParams({
    remote: '1',
    mode: 'url',
    u: convertFileSrc(filePath),
    name: `${item.title} · 第${ep.number}集`,
  })
  if (item.cover) params.set('poster', item.cover)
  return `/play/_?${params.toString()}`
}
// ---------------------------------------------------------------- 下载队列

export type QueueStatus = 'pending' | 'working' | 'done' | 'failed'

export interface QueueItem {
  episodeId: string
  seriesId: string
  number: number
  title: string
  status: QueueStatus
  error: string
  path: string
  bytes: number
}

export interface QueueSnapshot {
  running: boolean
  items: QueueItem[]
}

export async function sdQueue(): Promise<QueueSnapshot> {
  if (!inTauri()) return { running: false, items: [] }
  return (await invoke('sd_queue')) as QueueSnapshot
}

export async function sdQueueAdd(
  seriesId: string,
  title: string,
  episodes: Array<{ id: string; number: number }>,
): Promise<QueueSnapshot & { added?: number }> {
  return (await invoke('sd_queue_add', { seriesId, title, episodes })) as QueueSnapshot & { added?: number }
}

export async function sdQueueClear(): Promise<QueueSnapshot> {
  return (await invoke('sd_queue_clear')) as QueueSnapshot
}

export function fileToPlayUrl(path: string): string {
  return convertFileSrc(path)
}

// ---------------------------------------------------------------- 本地缓存（供 ⌘K 搜索）

const CACHE_KEY = 'miralite.shortCache.v1'
const CACHE_MAX = 120

export function cacheShortDramas(items: DramaItem[]): void {
  if (items.length === 0) return
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    const prev: DramaItem[] = raw ? (JSON.parse(raw) as DramaItem[]) : []
    const merged = [...items, ...prev.filter((p) => !items.some((i) => i.id === p.id))].slice(0, CACHE_MAX)
    localStorage.setItem(CACHE_KEY, JSON.stringify(merged))
  } catch {
    /* ignore */
  }
}

export function cachedShortDramas(): DramaItem[] {
  try {
    const raw = localStorage.getItem(CACHE_KEY)
    const list = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(list) ? (list as DramaItem[]) : []
  } catch {
    return []
  }
}
