/**
 * EPG（电子节目单）读取与展示辅助。
 *
 * 数据来源：Xtream `get_simple_data_table`（Rust 侧已做 10 分钟内存缓存）。
 * 这里再加一层 localStorage 缓存（15 分钟），保证切页/重开 App 不用重新拉全表；
 * 同时提供「正在播 / 下一档 / 播放进度」这类纯计算函数，方便页面和单测复用。
 */
import { invoke } from '@tauri-apps/api/core'
import { inTauri } from './cat'
import type { MediaItem, Source } from './types'
import { normalizeBase } from './xtream'

export interface EpgProgram {
  id: string
  title: string
  description: string
  /** 面板给的本地时间字符串，仅作兜底展示 */
  start: string
  end: string
  startTs?: number
  stopTs?: number
  nowPlaying: boolean
  hasArchive: boolean
}

const TTL = 15 * 60 * 1000
const PREFIX = 'miralite.epg.v1|'
const MAX_ENTRIES = 120

const mem = new Map<string, { at: number; list: EpgProgram[] }>()
let lastPrune = 0

function cacheKey(source: Source, streamId: number): string {
  return `${PREFIX}${normalizeBase(source.url)}|${source.username ?? ''}|${streamId}`
}

function readCache(key: string): EpgProgram[] | null {
  const hit = mem.get(key)
  if (hit && Date.now() - hit.at < TTL) return hit.list
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as { at?: number; list?: EpgProgram[] }
    if (!parsed.at || !Array.isArray(parsed.list)) return null
    if (Date.now() - parsed.at >= TTL) {
      localStorage.removeItem(key)
      return null
    }
    mem.set(key, { at: parsed.at, list: parsed.list })
    return parsed.list
  } catch {
    return null
  }
}

function writeCache(key: string, list: EpgProgram[]) {
  const at = Date.now()
  mem.set(key, { at, list })
  try {
    localStorage.setItem(key, JSON.stringify({ at, list }))
    // 批量写缓存时不必每次都扫一遍 localStorage，一分钟最多整理一次
    if (Date.now() - lastPrune > 60_000) {
      lastPrune = Date.now()
      prune()
    }
  } catch {
    /* 配额满了就只留内存缓存 */
  }
}

/** 清掉过期条目，避免 EPG 把 localStorage 撑爆 */
function prune() {
  try {
    const stale: string[] = []
    let alive = 0
    for (let i = 0; i < localStorage.length; i += 1) {
      const k = localStorage.key(i)
      if (!k || !k.startsWith(PREFIX)) continue
      let at = 0
      try {
        at = (JSON.parse(localStorage.getItem(k) || '{}') as { at?: number }).at ?? 0
      } catch {
        at = 0
      }
      if (!at || Date.now() - at > 12 * 60 * 60 * 1000) stale.push(k)
      else alive += 1
    }
    for (const k of stale) localStorage.removeItem(k)
    if (alive > MAX_ENTRIES) {
      // 超出上限时按写入时间淘汰最旧的一半
      const rows: Array<{ k: string; at: number }> = []
      for (let i = 0; i < localStorage.length; i += 1) {
        const k = localStorage.key(i)
        if (!k || !k.startsWith(PREFIX)) continue
        let at = 0
        try {
          at = (JSON.parse(localStorage.getItem(k) || '{}') as { at?: number }).at ?? 0
        } catch {
          at = 0
        }
        rows.push({ k, at })
      }
      rows
        .sort((a, b) => a.at - b.at)
        .slice(0, Math.max(1, Math.floor(rows.length / 2)))
        .forEach((r) => localStorage.removeItem(r.k))
    }
  } catch {
    /* 隐私模式 / 配额不可用时忽略 */
  }
}

function parseServerTime(s: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?/.exec(s || '')
  if (!m) return NaN
  // 面板给的是服务器本地时间，没有时区信息；按本机时区解读，
  // 对同区面板（国内源基本如此）足够准，跨区会有固定偏移。
  return new Date(
    Number(m[1]),
    Number(m[2]) - 1,
    Number(m[3]),
    Number(m[4]),
    Number(m[5]),
    Number(m[6] ?? 0),
  ).getTime()
}

/** 节目起止毫秒；优先时间戳，缺失时才解析字符串 */
export function windowOf(p: EpgProgram): { start: number; end: number } {
  const start = p.startTs ? p.startTs * 1000 : parseServerTime(p.start)
  const end = p.stopTs ? p.stopTs * 1000 : parseServerTime(p.end)
  return { start: Number.isFinite(start) ? start : 0, end: Number.isFinite(end) ? end : 0 }
}

export interface NowNext {
  now?: EpgProgram
  next?: EpgProgram
  /** 当前节目的播放进度 0~1 */
  progress: number
  startAt: number
  endAt: number
}

/** 从节目表里挑出「正在播」和「接下来一档」 */
export function pickNowNext(list: EpgProgram[], nowMs = Date.now()): NowNext {
  const rows = list
    .map((p) => ({ p, w: windowOf(p) }))
    .filter((x) => x.w.end > 0)
    .sort((a, b) => a.w.start - b.w.start)

  const current = rows.find((x) => x.w.start <= nowMs && nowMs < x.w.end)
  const next = rows.find((x) => x.w.start > nowMs)
  const progress = current
    ? Math.min(1, Math.max(0, (nowMs - current.w.start) / Math.max(current.w.end - current.w.start, 1)))
    : 0
  return {
    now: current?.p,
    next: next?.p,
    progress,
    startAt: current?.w.start ?? 0,
    endAt: current?.w.end ?? 0,
  }
}

/** 今天（或节目所在日）的节目，按开始时间排序 */
export function programsForDay(list: EpgProgram[], dayMs = Date.now()): EpgProgram[] {
  const day = new Date(dayMs)
  const startOfDay = new Date(day.getFullYear(), day.getMonth(), day.getDate()).getTime()
  const endOfDay = startOfDay + 24 * 60 * 60 * 1000
  return list
    .filter((p) => {
      const w = windowOf(p)
      return w.end > startOfDay && w.start < endOfDay
    })
    .sort((a, b) => windowOf(a).start - windowOf(b).start)
}

export function fmtClock(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '--:--'
  const d = new Date(ms)
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`
}

export function fmtRange(p: EpgProgram): string {
  const w = windowOf(p)
  return `${fmtClock(w.start)} - ${fmtClock(w.end)}`
}

function mapProgram(raw: Record<string, unknown>): EpgProgram {
  return {
    id: String(raw.id ?? ''),
    title: String(raw.title ?? ''),
    description: String(raw.description ?? ''),
    start: String(raw.start ?? ''),
    end: String(raw.end ?? ''),
    startTs: typeof raw.startTs === 'number' ? raw.startTs : undefined,
    stopTs: typeof raw.stopTs === 'number' ? raw.stopTs : undefined,
    nowPlaying: !!raw.nowPlaying,
    hasArchive: !!raw.hasArchive,
  }
}

/** 拉单个频道的节目表（带两层缓存） */
export async function loadEpg(
  source: Source,
  streamId: number,
  opts: { force?: boolean; limit?: number } = {},
): Promise<EpgProgram[]> {
  const key = cacheKey(source, streamId)
  if (!opts.force) {
    const cached = readCache(key)
    if (cached) return cached
  }
  if (!inTauri()) return []
  const raw = (await invoke('xtream_epg', {
    base: normalizeBase(source.url),
    username: source.username ?? '',
    password: source.password ?? '',
    streamId,
    limit: opts.limit ?? 24,
  })) as Array<Record<string, unknown>>
  const list = (Array.isArray(raw) ? raw : []).map(mapProgram).filter((p) => p.title)
  if (list.length > 0) writeCache(key, list)
  return list
}

/** 批量拉节目表，限制并发，避免一次把面板打满（很多面板限 1~2 个连接） */
export async function loadEpgBatch(
  source: Source,
  items: MediaItem[],
  opts: { concurrency?: number; limit?: number; force?: boolean; onEach?: (id: string, list: EpgProgram[]) => void } = {},
): Promise<Map<string, EpgProgram[]>> {
  const concurrency = Math.max(1, opts.concurrency ?? 3)
  const queue = items.filter((i) => typeof i.streamId === 'number')
  const result = new Map<string, EpgProgram[]>()
  let cursor = 0

  async function worker() {
    while (cursor < queue.length) {
      const item = queue[cursor]
      cursor += 1
      try {
        const list = await loadEpg(source, item.streamId as number, { limit: opts.limit, force: opts.force })
        if (list.length > 0) {
          result.set(item.id, list)
          opts.onEach?.(item.id, list)
        }
      } catch {
        /* 单个频道失败不打断整批 */
      }
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker))
  return result
}
// ---------------------------------------------------------------- XMLTV（给 M3U 源补节目单）

const XMLTV_KEY = 'miralite.xmltv.v1|'
const XMLTV_TTL = 6 * 60 * 60 * 1000

interface XmltvCache {
  at: number
  channels: Record<string, EpgProgram[]>
}

function readXmltvCache(key: string): XmltvCache | null {
  const memHit = mem.get(`xmltv:${key}`) as unknown as { at: number; list: EpgProgram[] } | undefined
  if (memHit) return { at: memHit.at, channels: memHit.list as unknown as Record<string, EpgProgram[]> }
  try {
    const raw = localStorage.getItem(key)
    if (!raw) return null
    const parsed = JSON.parse(raw) as XmltvCache
    if (!parsed?.at || Date.now() - parsed.at >= XMLTV_TTL) return null
    mem.set(`xmltv:${key}`, { at: parsed.at, list: parsed.channels as unknown as EpgProgram[] })
    return parsed
  } catch {
    return null
  }
}

function writeXmltvCache(key: string, channels: Record<string, EpgProgram[]>) {
  const at = Date.now()
  mem.set(`xmltv:${key}`, { at, list: channels as unknown as EpgProgram[] })
  try {
    localStorage.setItem(key, JSON.stringify({ at, channels }))
  } catch {
    /* 太大就只留内存 */
  }
}

/**
 * 拉取并解析一个源的 XMLTV，只保留指定频道的节目。
 * 结果按 URL 缓存 6 小时（内存 + localStorage）。
 */
export async function loadXmltvForSource(
  source: Source,
  channelIds: string[],
  opts: { force?: boolean } = {},
): Promise<Record<string, EpgProgram[]>> {
  const url = (source.epgUrl ?? '').trim()
  const wanted = new Set(channelIds.filter(Boolean))
  if (!url || wanted.size === 0) return {}

  const key = `${XMLTV_KEY}${url}`
  const cached = opts.force ? null : readXmltvCache(key)
  if (cached) {
    const hit: Record<string, EpgProgram[]> = {}
    let covered = 0
    for (const id of wanted) {
      const list = cached.channels[id]
      if (list && list.length > 0) {
        hit[id] = list
        covered += 1
      }
    }
    // 覆盖到一半以上就当命中，避免每次进页面都重拉大文件
    if (covered >= Math.min(wanted.size, 3)) return hit
  }

  const { fetchText } = await import('./net')
  const { parseXmltv } = await import('./xmltv')
  const text = await fetchText(url)
  const parsed = parseXmltv(text, { channelIds: wanted, perChannel: 72, total: 12000 })

  const channels: Record<string, EpgProgram[]> = {}
  for (const [id, list] of parsed) {
    if (list.length > 0) channels[id] = list
  }
  if (Object.keys(channels).length > 0) {
    writeXmltvCache(key, { ...(readXmltvCache(key)?.channels ?? {}), ...channels })
  }
  return channels
}
