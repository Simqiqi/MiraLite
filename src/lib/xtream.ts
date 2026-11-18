/**
 * Xtream Codes API 的前端封装（player_api.php）。
 *
 * 请求全部经 Rust 侧 `xtream_*` 命令发出：Xtream 面板基本不带 CORS 头，
 * webview 直连会被拦下来；Rust 侧还统一处理了超时、UA、响应大小上限。
 * 浏览器预览时退化为直连 fetch（多数面板会失败，仅供本地调试）。
 */
import { invoke } from '@tauri-apps/api/core'
import { inTauri } from './cat'
import type { MediaItem, Source } from './types'

export interface XtreamAccount {
  ok: boolean
  username: string
  status: string
  isTrial: boolean
  activeConns: number
  maxConnections: number
  expDate?: number
  timezone?: string
  serverUrl?: string
  port?: string
  formats: string[]
  message: string
}

export interface XtreamCategory {
  id: string
  name: string
  parentId: number
}

export interface XtreamLiveStream {
  streamId: number
  num: number
  name: string
  icon: string
  categoryId: string
  epgChannelId?: string
  tvArchive: boolean
  archiveDays: number
}

export interface XtreamVodStream {
  streamId: number
  name: string
  icon: string
  categoryId: string
  container: string
  rating?: number
  year?: string
}

export interface XtreamSeries {
  seriesId: number
  name: string
  cover: string
  categoryId: string
  rating?: number
  year?: string
  plot: string
}

export interface XtreamEpisode {
  id: number
  title: string
  season: number
  episode: number
  container: string
  plot: string
  duration: string
  rating?: number
}

export type XtreamKind = 'live' | 'vod' | 'series'

/** 去空白、去查询串、剥掉面板常见的接口尾巴，得到纯 base */
export function normalizeBase(raw: string): string {
  let t = (raw || '').trim()
  const q = t.indexOf('?')
  if (q >= 0) t = t.slice(0, q)
  t = t.replace(/\/+$/, '')
  for (const suffix of ['/player_api.php', '/get.php', '/xmltv.php', '/panel_api.php']) {
    while (t.endsWith(suffix)) t = t.slice(0, -suffix.length).replace(/\/+$/, '')
  }
  return t
}

function hashHue(input: string): number {
  let h = 0
  for (let i = 0; i < input.length; i += 1) h = (h * 31 + input.charCodeAt(i)) | 0
  return Math.abs(h) % 360
}

/** 浏览器预览的兜底：直接 fetch，失败时把可读原因抛出去 */
async function browserCall<T>(
  base: string,
  username: string,
  password: string,
  params: Record<string, string>,
): Promise<T> {
  const qs = new URLSearchParams({ username, password, ...params }).toString()
  const res = await fetch(`${base}/player_api.php?${qs}`)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return (await res.json()) as T
}

const num = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

const text = (v: unknown): string => (typeof v === 'string' ? v : v == null ? '' : String(v))

/** 直播地址：优先 HLS（hls.js / Safari 原生都能吃） */
export function liveUrl(base: string, username: string, password: string, streamId: number): string {
  return `${normalizeBase(base)}/live/${encodeURIComponent(username)}/${encodeURIComponent(password)}/${streamId}.m3u8`
}

/** VOD 地址（后续点播页用） */
export function vodUrl(
  base: string,
  username: string,
  password: string,
  streamId: number,
  container: string,
): string {
  const ext = container || 'mp4'
  return `${normalizeBase(base)}/movie/${encodeURIComponent(username)}/${encodeURIComponent(password)}/${streamId}.${ext}`
}

export async function xtreamLogin(
  base: string,
  username: string,
  password: string,
): Promise<XtreamAccount> {
  const b = normalizeBase(base)
  if (!b) throw new Error('源地址不能为空')
  if (inTauri()) {
    const raw = (await invoke('xtream_login', { base: b, username, password })) as Record<string, unknown>
    return {
      ok: !!raw.ok,
      username: text(raw.username),
      status: text(raw.status),
      isTrial: !!raw.isTrial,
      activeConns: num(raw.activeConns),
      maxConnections: num(raw.maxConnections),
      expDate: raw.expDate == null ? undefined : num(raw.expDate),
      timezone: raw.timezone ? text(raw.timezone) : undefined,
      serverUrl: raw.serverUrl ? text(raw.serverUrl) : undefined,
      port: raw.port ? text(raw.port) : undefined,
      formats: Array.isArray(raw.formats) ? raw.formats.map(text) : [],
      message: text(raw.message),
    }
  }
  const data = (await browserCall<Record<string, unknown>>(b, username, password, {})) as {
    user_info?: Record<string, unknown>
    server_info?: Record<string, unknown>
  }
  const user = data.user_info ?? {}
  const server = data.server_info ?? {}
  const ok = String(user.auth) === '1' || user.auth === true
  return {
    ok,
    username: text(user.username),
    status: text(user.status),
    isTrial: String(user.is_trial) === '1',
    activeConns: num(user.active_cons),
    maxConnections: num(user.max_connections),
    expDate: user.exp_date == null ? undefined : num(user.exp_date),
    timezone: server.timezone ? text(server.timezone) : undefined,
    serverUrl: server.url ? text(server.url) : undefined,
    port: server.port ? text(server.port) : undefined,
    formats: Array.isArray(server.allowed_output_formats) ? (server.allowed_output_formats as unknown[]).map(text) : [],
    message: ok ? '' : '账号校验失败：检查用户名、密码或账号状态',
  }
}

export async function xtreamCategories(
  base: string,
  username: string,
  password: string,
  kind: XtreamKind,
): Promise<XtreamCategory[]> {
  const b = normalizeBase(base)
  const action =
    kind === 'live' ? 'get_live_categories' : kind === 'vod' ? 'get_vod_categories' : 'get_series_categories'
  if (inTauri()) {
    const raw = (await invoke('xtream_categories', { base: b, username, password, kind })) as Array<
      Record<string, unknown>
    >
    return (Array.isArray(raw) ? raw : []).map((c) => ({
      id: text(c.id),
      name: text(c.name),
      parentId: num(c.parentId),
    }))
  }
  const data = await browserCall<Array<Record<string, unknown>>>(b, username, password, { action })
  return (Array.isArray(data) ? data : []).map((c) => ({
    id: text(c.category_id),
    name: text(c.category_name),
    parentId: num(c.parent_id),
  }))
}

export async function xtreamLiveStreams(
  base: string,
  username: string,
  password: string,
  categoryId?: string,
): Promise<XtreamLiveStream[]> {
  const b = normalizeBase(base)
  if (inTauri()) {
    const raw = (await invoke('xtream_live_streams', {
      base: b,
      username,
      password,
      categoryId: categoryId || null,
    })) as Array<Record<string, unknown>>
    return (Array.isArray(raw) ? raw : [])
      .map((s) => ({
        streamId: num(s.streamId),
        num: num(s.num),
        name: text(s.name),
        icon: text(s.icon),
        categoryId: text(s.categoryId),
        epgChannelId: s.epgChannelId ? text(s.epgChannelId) : undefined,
        tvArchive: !!s.tvArchive,
        archiveDays: num(s.archiveDays),
      }))
      .filter((s) => s.streamId > 0)
  }
  const data = await browserCall<Array<Record<string, unknown>>>(b, username, password, {
    action: 'get_live_streams',
    ...(categoryId ? { category_id: categoryId } : {}),
  })
  return (Array.isArray(data) ? data : [])
    .map((s) => ({
      streamId: num(s.stream_id),
      num: num(s.num),
      name: text(s.name),
      icon: text(s.stream_icon),
      categoryId: text(s.category_id),
      epgChannelId: s.epg_channel_id ? text(s.epg_channel_id) : undefined,
      tvArchive: String(s.tv_archive) === '1',
      archiveDays: num(s.tv_archive_duration),
    }))
    .filter((s) => s.streamId > 0)
}

export async function xtreamVodStreams(
  base: string,
  username: string,
  password: string,
  categoryId?: string,
): Promise<XtreamVodStream[]> {
  const b = normalizeBase(base)
  if (!inTauri()) {
    const data = await browserCall<Array<Record<string, unknown>>>(b, username, password, {
      action: 'get_vod_streams',
      ...(categoryId ? { category_id: categoryId } : {}),
    })
    return (Array.isArray(data) ? data : []).map((s) => ({
      streamId: num(s.stream_id),
      name: text(s.name),
      icon: text(s.stream_icon),
      categoryId: text(s.category_id),
      container: text(s.container_extension),
      rating: s.rating == null ? undefined : num(s.rating),
      year: s.year ? text(s.year) : undefined,
    }))
  }
  const raw = (await invoke('xtream_vod_streams', {
    base: b,
    username,
    password,
    categoryId: categoryId || null,
  })) as Array<Record<string, unknown>>
  return (Array.isArray(raw) ? raw : []).map((s) => ({
    streamId: num(s.streamId),
    name: text(s.name),
    icon: text(s.icon),
    categoryId: text(s.categoryId),
    container: text(s.container),
    rating: s.rating == null ? undefined : num(s.rating),
    year: s.year ? text(s.year) : undefined,
  }))
}

export async function xtreamSeries(
  base: string,
  username: string,
  password: string,
  categoryId?: string,
): Promise<XtreamSeries[]> {
  const b = normalizeBase(base)
  if (!inTauri()) {
    const data = await browserCall<Array<Record<string, unknown>>>(b, username, password, {
      action: 'get_series',
      ...(categoryId ? { category_id: categoryId } : {}),
    })
    return (Array.isArray(data) ? data : []).map((s) => ({
      seriesId: num(s.series_id),
      name: text(s.name),
      cover: text(s.cover),
      categoryId: text(s.category_id),
      rating: s.rating == null ? undefined : num(s.rating),
      year: s.year ? text(s.year) : undefined,
      plot: text(s.plot),
    }))
  }
  const raw = (await invoke('xtream_series', {
    base: b,
    username,
    password,
    categoryId: categoryId || null,
  })) as Array<Record<string, unknown>>
  return (Array.isArray(raw) ? raw : []).map((s) => ({
    seriesId: num(s.seriesId),
    name: text(s.name),
    cover: text(s.cover),
    categoryId: text(s.categoryId),
    rating: s.rating == null ? undefined : num(s.rating),
    year: s.year ? text(s.year) : undefined,
    plot: text(s.plot),
  }))
}

/** 剧集详情（季集列表） */
export async function xtreamSeriesInfo(
  base: string,
  username: string,
  password: string,
  seriesId: number,
): Promise<XtreamEpisode[]> {
  const b = normalizeBase(base)
  if (!seriesId) return []

  const mapList = (raw: unknown): XtreamEpisode[] => {
    // 浏览器返回原始结构；Rust 已压平成数组
    if (Array.isArray(raw)) {
      return raw
        .map((e) => {
          const row = e as Record<string, unknown>
          return {
            id: num(row.id),
            title: text(row.title),
            season: num(row.season),
            episode: num(row.episode),
            container: text(row.container),
            plot: text(row.plot),
            duration: text(row.duration),
            rating: row.rating == null ? undefined : num(row.rating),
          }
        })
        .filter((e) => e.id > 0)
    }
    const out: XtreamEpisode[] = []
    const data = raw as Record<string, unknown> | null
    const episodes = data?.episodes as Record<string, Array<Record<string, unknown>>> | undefined
    if (!episodes) return out
    for (const [seasonKey, list] of Object.entries(episodes)) {
      const fallback = Number(seasonKey) || 0
      for (const ep of Array.isArray(list) ? list : []) {
        const info = (ep.info ?? {}) as Record<string, unknown>
        out.push({
          id: num(ep.id),
          title: text(ep.title),
          season: num(ep.season) || fallback,
          episode: num(ep.episode_num),
          container: text(ep.container_extension),
          plot: text(info.plot),
          duration: text(info.duration),
          rating: info.rating == null ? undefined : num(info.rating),
        })
      }
    }
    return out.filter((e) => e.id > 0).sort((a, b) => a.season - b.season || a.episode - b.episode)
  }

  if (inTauri()) {
    const raw = await invoke('xtream_series_info', {
      base: b,
      username,
      password,
      seriesId,
    })
    return mapList(raw)
  }
  const data = await browserCall<Record<string, unknown>>(b, username, password, {
    action: 'get_series_info',
    series_id: String(seriesId),
  })
  return mapList(data)
}

/**
 * 拉一个 Xtream 源的直播频道，并顺手带上分类名。
 * 分类接口失败不影响频道导入（group 退化成「未分组」）。
 */
export async function fetchXtreamChannels(source: Source): Promise<MediaItem[]> {
  const base = normalizeBase(source.url)
  const username = source.username ?? ''
  const password = source.password ?? ''
  if (!base) throw new Error('源地址不能为空')

  const [cats, streams] = await Promise.all([
    xtreamCategories(base, username, password, 'live').catch(() => [] as XtreamCategory[]),
    xtreamLiveStreams(base, username, password),
  ])
  const catName = new Map(cats.map((c) => [c.id, c.name]))

  return streams
    .map((s) => {
      const group = catName.get(s.categoryId) || '未分组'
      return {
        id: `ch_${source.id}_${s.streamId}`,
        kind: 'channel' as const,
        title: s.name || `频道 ${s.streamId}`,
        genres: [group],
        hue: hashHue(s.name || String(s.streamId)),
        streamUrl: liveUrl(base, username, password, s.streamId),
        sourceId: source.id,
        group,
        logo: s.icon || undefined,
        streamId: s.streamId,
        epgChannelId: s.epgChannelId,
        tvArchive: s.tvArchive,
        categoryId: s.categoryId,
      }
    })
}