/**
 * 直播页：Xtream / M3U 频道的频道墙 + EPG 节目单。
 *
 * 卡片上直接给「正在播 / 进度 / 下一档」，点开可以看到当天完整节目单；
 * 点卡片进播放页。EPG 由 lib/epg.ts 批量拉取（限并发 + 两层缓存）。
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Activity, Bell, BellRing, Clock, History, Loader2, Play, Radio, RefreshCw, Rewind, Search, Star, Tv, X } from 'lucide-react'
import { actions, useLibrary } from '../lib/store'
import { probeChannels, useHealth } from '../lib/health'
import {
  isBlocked,
  orderedChannels,
  setChannelNumber,
  toggleCollapsed,
  useChannelPrefs,
} from '../lib/channelPrefs'
import Hls from 'hls.js'
import { addReminder, hasReminder, removeReminder, reminderId, useReminders, LEAD_MS } from '../lib/reminders'
import type { MediaItem, Source } from '../lib/types'
import {
  fmtClock,
  fmtRange,
  loadEpg,
  loadEpgBatch,
  loadXmltvForSource,
  pickNowNext,
  programsForDay,
  windowOf,
  type EpgProgram,
} from '../lib/epg'

function initials(title: string): string {
  const clean = title.replace(/\s+/g, '')
  return clean.slice(0, 2) || 'TV'
}

function ChannelLogo({ item, size = 44 }: { item: MediaItem; size?: number }) {
  const [broken, setBroken] = useState(false)
  if (item.logo && !broken) {
    return (
      <img
        src={item.logo}
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setBroken(true)}
        className="shrink-0 rounded-xl object-contain"
        style={{ width: size, height: size, background: 'rgba(255,255,255,0.06)' }}
      />
    )
  }
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-xl text-[13px] font-semibold"
      style={{
        width: size,
        height: size,
        background: `linear-gradient(150deg, hsl(${item.hue} 58% 26%), hsl(${(item.hue + 26) % 360} 40% 12%))`,
        color: `hsl(${item.hue} 82% 78%)`,
      }}
    >
      {initials(item.title)}
    </div>
  )
}

/** 卡片上的「正在播」区块：没有 EPG 时退化成分类名 */
function NowStrip({ list, fallback }: { list?: EpgProgram[]; fallback: string }) {
  const nn = list ? pickNowNext(list) : null
  if (!nn?.now) {
    if (nn?.next) {
      const nextAt = windowOf(nn.next)
      return (
        <div className="mt-3 flex items-center gap-1.5 text-[11px] text-muted/80">
          <Radio size={11} className="shrink-0 opacity-70" />
          <span className="truncate">
            接下来 {fmtClock(nextAt.start)} {nn.next.title}
          </span>
        </div>
      )
    }
    return (
      <div className="mt-3 flex items-center gap-1.5 text-[11px] text-muted/80">
        <Radio size={11} className="shrink-0 opacity-70" />
        <span className="truncate">{fallback}</span>
      </div>
    )
  }
  return (
    <div className="mt-3">
      <div className="flex items-center gap-1.5 text-[11.5px] text-fg/90">
        <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-gold" />
        <span className="truncate">{nn.now.title}</span>
      </div>
      <div className="mt-2 h-[3px] overflow-hidden rounded-full bg-white/12">
        <div className="h-full rounded-full bg-gold/85" style={{ width: `${nn.progress * 100}%` }} />
      </div>
      <div className="mt-1.5 truncate text-[10.5px] text-muted">
        {fmtRange(nn.now)}
        {nn.next ? ` · 接下来 ${fmtClock(windowOf(nn.next).start)} ${nn.next.title}` : ''}
      </div>
    </div>
  )
}

interface Picked {
  item: MediaItem
  source?: Source
  list: EpgProgram[]
}

function GuideDrawer({
  picked,
  loading,
  now,
  onClose,
  onPlay,
  onCatchup,
}: {
  picked: Picked
  loading: boolean
  now: number
  onClose: () => void
  onPlay: () => void
  onCatchup: (p: EpgProgram) => void
}) {
  const reminders = useReminders()
  const rows = programsForDay(picked.list)
  const nn = pickNowNext(picked.list)
  const canCatchup = !!picked.item.tvArchive && typeof picked.item.streamId === 'number'

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true">
      <button
        aria-label="关闭节目单"
        onClick={onClose}
        className="absolute inset-0 bg-black/55 backdrop-blur-[2px]"
      />
      <aside className="glass-panel relative z-10 flex h-full w-[420px] flex-col rounded-none border-y-0 border-r-0">
        <header className="flex items-start gap-3 border-b border-white/10 px-5 py-4">
          <ChannelLogo item={picked.item} size={48} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[15px] font-semibold">{picked.item.title}</div>
            <div className="mt-0.5 truncate text-[11px] text-muted">
              {picked.item.group || '未分组'}
              {picked.item.tvArchive ? ' · 支持回看' : ''}
              {picked.source?.name ? ` · ${picked.source.name}` : ''}
            </div>
          </div>
          <button onClick={onClose} className="glass-btn rounded-lg p-1.5 text-muted hover:text-fg">
            <X size={14} />
          </button>
        </header>

        <div className="flex items-center justify-between px-5 pt-4">
          <div className="flex items-center gap-2 text-[12px] font-medium text-fg/90">
            今日节目单
            {loading && <Loader2 size={12} className="animate-spin text-gold/80" />}
          </div>
          <button
            onClick={onPlay}
            className="glass-primary flex items-center gap-1 rounded-lg px-3 py-1.5 text-[11.5px] font-semibold"
          >
            <Play size={11} /> 观看
          </button>
        </div>

        <div className="no-scrollbar mt-3 flex-1 overflow-y-auto px-3 pb-6">
          {rows.length === 0 && (
            <div className="px-3 py-8 text-[12px] leading-relaxed text-muted">
              这个频道暂时没有节目单。部分面板只对部分频道提供 EPG，也可能是当天数据还没生成。
            </div>
          )}
          {rows.map((p, idx) => {
            const w = windowOf(p)
            const isNow = nn.now?.id === p.id
            return (
              <div
                key={p.id || `${idx}-${p.title}`}
                className={`flex gap-3 rounded-xl px-3 py-2.5 ${
                  isNow ? 'bg-gold/10 ring-1 ring-gold/25' : 'hover:bg-white/5'
                }`}
              >
                <div className="w-[46px] shrink-0 pt-0.5 text-[11px] tabular-nums text-muted">
                  {fmtClock(w.start)}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    {isNow && <span className="h-1.5 w-1.5 shrink-0 animate-pulse rounded-full bg-gold" />}
                    <div className="truncate text-[12.5px] text-fg/90">{p.title}</div>
                  </div>
                  {p.description && (
                    <div className="mt-0.5 line-clamp-2 text-[11px] leading-snug text-muted">{p.description}</div>
                  )}
                  <div className="mt-1 flex items-center gap-2">
                    {canCatchup && w.end <= now && (
                      <button
                        onClick={() => onCatchup(p)}
                        className="flex items-center gap-1 rounded-md bg-white/6 px-2 py-0.5 text-[10.5px] text-muted hover:text-gold"
                      >
                        <Rewind size={10} /> 回看
                      </button>
                    )}
                    {w.start > now && (
                      <button
                        onClick={() => {
                          const id = reminderId(picked.item.id, w.start)
                          if (reminders.some((r) => r.id === id)) removeReminder(id)
                          else
                            addReminder({
                              id,
                              at: w.start - LEAD_MS,
                              title: `即将开播：${p.title}`,
                              body: `${picked.item.title} · ${fmtClock(w.start)} 开始`,
                            })
                        }}
                        className={`flex items-center gap-1 rounded-md px-2 py-0.5 text-[10.5px] ${
                          hasReminder(picked.item.id, w.start)
                            ? 'bg-gold/15 text-gold'
                            : 'bg-white/6 text-muted hover:text-gold'
                        }`}
                      >
                        {hasReminder(picked.item.id, w.start) ? <BellRing size={10} /> : <Bell size={10} />}
                        {hasReminder(picked.item.id, w.start) ? '已设提醒' : '提醒'}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </aside>
    </div>
  )
}

/** EPG 时间轴：频道为行、时间为列，默认看「过去 30 分钟 + 未来 2.5 小时」 */
function TimelineView({
  items,
  epg,
  now,
  onPlay,
}: {
  items: MediaItem[]
  epg: Record<string, EpgProgram[]>
  now: number
  onPlay: (c: MediaItem) => void
}) {
  const BEFORE = 30 * 60_000
  const AFTER = 150 * 60_000
  const start = now - BEFORE
  const end = now + AFTER
  const PX_PER_MIN = 2.6
  const totalPx = (BEFORE + AFTER) / 60_000 * PX_PER_MIN

  const rows = items.filter((c) => (epg[c.id] ?? []).length > 0).slice(0, 60)
  if (rows.length === 0) {
    return (
      <div className="glass-panel mx-10 mt-4 rounded-2xl px-6 py-10 text-center text-[12px] text-muted">
        还没有可用的节目单数据。Xtream 源的 EPG 加载完成后，这里会按频道排出时间轴。
      </div>
    )
  }

  const ticks: number[] = []
  for (let t = start - (start % (30 * 60_000)) + 30 * 60_000; t < end; t += 30 * 60_000) ticks.push(t)
  const nowLeft = ((now - start) / 60_000) * PX_PER_MIN

  return (
    <div className="glass-panel mx-10 mt-4 overflow-hidden rounded-2xl">
      <div className="no-scrollbar overflow-x-auto">
        <div style={{ width: 120 + totalPx }}>
          <div className="flex h-9 border-b border-white/10">
            <div className="sticky left-0 z-10 flex w-[120px] shrink-0 items-center bg-[#0e0e12] px-3 text-[10.5px] text-muted">
              频道
            </div>
            <div className="relative" style={{ width: totalPx }}>
              {ticks.map((t) => (
                <span
                  key={t}
                  className="absolute top-1/2 -translate-y-1/2 whitespace-nowrap text-[10px] tabular-nums text-muted/80"
                  style={{ left: ((t - start) / 60_000) * PX_PER_MIN }}
                >
                  {fmtClock(t)}
                </span>
              ))}
            </div>
          </div>

          {rows.map((c) => {
            const programs = (epg[c.id] ?? [])
              .map((p) => ({ p, w: windowOf(p) }))
              .filter((x) => x.w.end > start && x.w.start < end)
            return (
              <div key={c.id} className="flex h-11 border-b border-white/5 last:border-b-0 hover:bg-white/3">
                <button
                  onClick={() => onPlay(c)}
                  className="sticky left-0 z-10 flex w-[120px] shrink-0 items-center gap-2 bg-[#0e0e12] px-2.5 text-left"
                >
                  <ChannelLogo item={c} size={22} />
                  <span className="truncate text-[11px] text-fg/85">{c.title}</span>
                </button>
                <div className="relative" style={{ width: totalPx }}>
                  {programs.map(({ p, w }, idx) => {
                    const left = Math.max(0, ((w.start - start) / 60_000) * PX_PER_MIN)
                    const right = Math.min(totalPx, ((w.end - start) / 60_000) * PX_PER_MIN)
                    const active = w.start <= now && now < w.end
                    return (
                      <button
                        key={p.id || `${c.id}-${idx}`}
                        onClick={() => onPlay(c)}
                        title={`${p.title} ${fmtRange(p)}`}
                        className={`absolute top-1 h-9 overflow-hidden rounded-md px-2 text-left text-[10.5px] leading-9 whitespace-nowrap transition ${
                          active
                            ? 'bg-gold/20 text-gold ring-1 ring-gold/30'
                            : 'bg-white/6 text-fg/70 hover:bg-white/12'
                        }`}
                        style={{ left, width: Math.max(right - left - 2, 18) }}
                      >
                        <span className="block truncate">{p.title}</span>
                      </button>
                    )
                  })}
                  <span
                    className="pointer-events-none absolute inset-y-0 z-10 w-px bg-gold/60"
                    style={{ left: nowLeft }}
                  />
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

/** 多屏同看：2×2 四路同时播，点哪格哪格出声 */
function MultiView({ items }: { items: MediaItem[] }) {
  const [slots, setSlots] = useState<Array<MediaItem | null>>(() => items.slice(0, 4))
  const [active, setActive] = useState(0)
  const [pick, setPick] = useState(0)
  const videoRefs = useRef<Array<HTMLVideoElement | null>>([])
  const hlsRefs = useRef<Array<Hls | null>>([])

  useEffect(() => {
    slots.forEach((item, i) => {
      const video = videoRefs.current[i]
      if (!video) return
      hlsRefs.current[i]?.destroy()
      hlsRefs.current[i] = null
      video.removeAttribute('src')
      video.load()
      if (!item?.streamUrl) return
      if (Hls.isSupported()) {
        const hls = new Hls({ enableWorker: true, lowLatencyMode: true })
        hls.loadSource(item.streamUrl)
        hls.attachMedia(video)
        hlsRefs.current[i] = hls
      } else {
        video.src = item.streamUrl
      }
      void video.play().catch(() => {})
    })
    return () => {
      hlsRefs.current.forEach((h) => h?.destroy())
      hlsRefs.current = []
    }
  }, [slots])

  useEffect(() => {
    videoRefs.current.forEach((v, i) => {
      if (v) v.muted = i !== active
    })
  }, [active, slots])

  const fill = (start: number) => {
    const next: Array<MediaItem | null> = []
    for (let i = 0; i < 4; i += 1) next.push(items[(start + i) % Math.max(items.length, 1)] ?? null)
    setSlots(next)
  }

  const setSlot = (index: number, item: MediaItem) => {
    setSlots((prev) => prev.map((x, i) => (i === index ? item : x)))
    setActive(index)
  }

  return (
    <div className="mx-10 mt-4">
      <div className="grid grid-cols-2 gap-2.5">
        {slots.map((item, i) => (
          <button
            key={i}
            onClick={() => {
              setActive(i)
              setPick(i)
            }}
            className={`relative aspect-video overflow-hidden rounded-xl border transition ${
              active === i ? 'border-gold/60' : 'border-white/10 hover:border-white/25'
            }`}
          >
            <video
              ref={(el) => {
                videoRefs.current[i] = el
              }}
              playsInline
              muted
              className="h-full w-full bg-black object-contain"
            />
            <span className="absolute inset-x-0 bottom-0 flex items-center justify-between bg-gradient-to-t from-black/85 to-transparent px-2.5 pb-1.5 pt-6 text-[10.5px] text-white/80">
              <span className="truncate">{item ? item.title : '空'}</span>
              <span className={active === i ? 'text-gold' : 'text-white/40'}>{active === i ? '出声' : '静音'}</span>
            </span>
            {pick === i && (
              <span className="absolute right-2 top-2 rounded bg-gold/85 px-1.5 py-0.5 text-[9.5px] font-semibold text-black">
                选台中
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="mt-3 flex items-center gap-2">
        <span className="shrink-0 text-[11px] text-muted">给第 {pick + 1} 格选台</span>
        <button
          onClick={() => fill(Math.floor(Math.random() * Math.max(items.length, 1)))}
          className="glass-chip shrink-0 rounded-lg px-2.5 py-1 text-[11px] text-muted hover:text-gold"
        >
          随机换一组
        </button>
      </div>

      <div className="no-scrollbar mt-2 flex gap-2 overflow-x-auto pb-1">
        {items.slice(0, 120).map((c) => (
          <button
            key={c.id}
            onClick={() => setSlot(pick, c)}
            className="glass-chip flex shrink-0 items-center gap-1.5 rounded-lg py-1 pl-1 pr-2.5 text-[11px] text-fg/80 hover:text-gold"
          >
            <ChannelLogo item={c} size={18} />
            <span className="max-w-[110px] truncate">{c.title}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

export default function LivePage() {
  const navigate = useNavigate()
  const { sources, channels, channelFavorites, channelRecent } = useLibrary()
  const health = useHealth()
  const prefs = useChannelPrefs()
  const [query, setQuery] = useState('')
  const [group, setGroup] = useState('全部')
  const [view, setView] = useState<'grid' | 'timeline' | 'multi'>('grid')
  const [epg, setEpg] = useState<Record<string, EpgProgram[]>>({})
  const [loading, setLoading] = useState(false)
  const [picked, setPicked] = useState<{ item: MediaItem; source?: Source } | null>(null)
  const [guideLoading, setGuideLoading] = useState(false)
  const [notice, setNotice] = useState<string | null>(null)
  const [now, setNow] = useState(() => Date.now())
  const [probing, setProbing] = useState(false)
  const [probeDone, setProbeDone] = useState(0)
  const [hideDead, setHideDead] = useState(false)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editValue, setEditValue] = useState('')
  const probeSignal = useRef<{ cancelled: boolean }>({ cancelled: false })

  const sourceById = useMemo(() => {
    const map = new Map<string, Source>()
    for (const s of sources) map.set(s.id, s)
    return map
  }, [sources])

  const liveChannels = useMemo(
    () =>
      channels.filter(
        (c) => c.kind === 'channel' && (!c.sourceId || sourceById.has(c.sourceId)) && !isBlocked(c.title),
      ),
    // prefs 变化（开关过滤）时也要重算
    [channels, sourceById, prefs.blockAdult, prefs.blockedWords],
  )

  /** 频道号：自定义优先，其余按原顺序补号 */
  const numbered = useMemo(() => orderedChannels(liveChannels), [liveChannels, prefs.numbers])
  const numberById = useMemo(() => new Map(numbered.map((x) => [x.item.id, x.number])), [numbered])

  const groups = useMemo(() => {
    const count = new Map<string, number>()
    for (const c of liveChannels) {
      const g = c.group || c.genres[0] || '未分组'
      count.set(g, (count.get(g) ?? 0) + 1)
    }
    return [...count.entries()].sort((a, b) => b[1] - a[1])
  }, [liveChannels])

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase()
    const fav = new Set(channelFavorites)
    return liveChannels
      .filter((c) => {
        if (group === '收藏') {
          if (!fav.has(c.id)) return false
        } else {
          const g = c.group || c.genres[0] || '未分组'
          if (group !== '全部' && g !== group) return false
        }
        if (hideDead && health[c.id]?.ok === false) return false
        if (!q) return true
        return c.title.toLowerCase().includes(q)
      })
      // 失效的沉底；同组里收藏的靠前
      .sort((a, b) => {
        const deadA = health[a.id]?.ok === false ? 1 : 0
        const deadB = health[b.id]?.ok === false ? 1 : 0
        if (deadA !== deadB) return deadA - deadB
        return Number(fav.has(b.id)) - Number(fav.has(a.id))
      })
  }, [liveChannels, group, query, channelFavorites, hideDead, health])

  const recentChannels = useMemo(
    () =>
      channelRecent
        .map((id) => liveChannels.find((c) => c.id === id))
        .filter((c): c is MediaItem => !!c)
        .slice(0, 8),
    [channelRecent, liveChannels],
  )

  const favoriteCount = useMemo(
    () => liveChannels.filter((c) => channelFavorites.includes(c.id)).length,
    [liveChannels, channelFavorites],
  )

  /** 回看：拼 timeshift 地址跳到播放页 */
  function catchup(channel: MediaItem, program: EpgProgram) {
    const src = channel.sourceId ? sourceById.get(channel.sourceId) : undefined
    if (!src || typeof channel.streamId !== 'number') return
    const w = windowOf(program)
    const dur = Math.max(1, Math.round((w.end - w.start) / 60_000))
    const d = new Date(w.start)
    const pad = (n: number) => String(n).padStart(2, '0')
    const start = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}:${pad(d.getHours())}-${pad(
      d.getMinutes(),
    )}`
    const params = new URLSearchParams({
      remote: '1',
      mode: 'timeshift',
      source: src.id,
      id: String(channel.streamId),
      start,
      dur: String(dur),
      name: `${channel.title} · ${program.title}`,
    })
    setPicked(null)
    navigate(`/play/_?${params.toString()}`)
  }

  function playChannel(c: MediaItem) {
    actions.markChannelPlayed(c.id)
    navigate(`/play/${c.id}`)
  }

  const deadCount = useMemo(
    () => liveChannels.filter((c) => health[c.id]?.ok === false).length,
    [liveChannels, health],
  )

  async function runProbe() {
    if (probing) return
    probeSignal.current = { cancelled: false }
    setProbing(true)
    setProbeDone(0)
    setNotice(null)
    try {
      const ok = await probeChannels(liveChannels, {
        concurrency: 4,
        signal: probeSignal.current,
        onProgress: (done) => setProbeDone(done),
      })
      setNotice(`体检完成：${ok} / ${liveChannels.length} 个频道可播放`)
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e))
    } finally {
      if (!probeSignal.current.cancelled) setProbing(false)
    }
  }

  useEffect(() => {
    return () => {
      probeSignal.current.cancelled = true
    }
  }, [])

  /**
   * 拉节目单：
   * - Xtream 源走 player_api（get_simple_data_table）
   * - M3U 源如果填了 XMLTV 地址，就抓下来解析后按 tvg-id 对上
   */
  async function loadAllEpg(force = false) {
    const xtreamBySource = new Map<string, MediaItem[]>()
    const xmltvBySource = new Map<string, { source: Source; ids: string[]; idMap: Map<string, string> }>()

    for (const c of liveChannels) {
      const src = c.sourceId ? sourceById.get(c.sourceId) : undefined
      if (!src) continue
      if (src.kind === 'xtream' && typeof c.streamId === 'number') {
        const arr = xtreamBySource.get(src.id) ?? []
        arr.push(c)
        xtreamBySource.set(src.id, arr)
      } else if (src.kind === 'm3u' && src.epgUrl && c.epgChannelId) {
        const entry =
          xmltvBySource.get(src.id) ?? { source: src, ids: [] as string[], idMap: new Map<string, string>() }
        entry.ids.push(c.epgChannelId)
        if (!entry.idMap.has(c.epgChannelId)) entry.idMap.set(c.epgChannelId, c.id)
        xmltvBySource.set(src.id, entry)
      }
    }

    if (xtreamBySource.size === 0 && xmltvBySource.size === 0) {
      setNotice('当前频道没有可用的节目单来源：Xtream 源需要面板提供 EPG，M3U 源需要在片源里填 XMLTV 地址')
      return
    }

    setLoading(true)
    setNotice(null)
    try {
      for (const [sourceId, items] of xtreamBySource) {
        const src = sourceById.get(sourceId)
        if (!src) continue
        const acc: Record<string, EpgProgram[]> = {}
        // 每个源内部限并发，面板通常只允许 1~2 个连接
        await loadEpgBatch(src, items.slice(0, 80), {
          concurrency: 2,
          limit: 24,
          force,
          onEach: (id, list) => {
            acc[id] = list
          },
        })
        if (Object.keys(acc).length > 0) setEpg((prev) => ({ ...prev, ...acc }))
      }

      for (const { source, ids, idMap } of xmltvBySource.values()) {
        try {
          const parsed = await loadXmltvForSource(source, ids, { force })
          const patch: Record<string, EpgProgram[]> = {}
          for (const [epgId, list] of Object.entries(parsed)) {
            const chId = idMap.get(epgId)
            if (chId && list.length > 0) patch[chId] = list
          }
          const matched = Object.keys(patch).length
          if (matched > 0) setEpg((prev) => ({ ...prev, ...patch }))
          else setNotice(`${source.name}：XMLTV 里没有匹配到频道（检查片源里的 tvg-id 是否和节目单一致）`)
        } catch (e) {
          setNotice(`${source.name} 的 XMLTV 拉取失败：${e instanceof Error ? e.message : String(e)}`)
        }
      }
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void loadAllEpg()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sources])

  // 每 30 秒刷新一次「正在播 / 时间轴红线」，不重新请求网络
  useEffect(() => {
    const t = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(t)
  }, [])

  /** 频道墙按分组分区（「全部」时带折叠头，选了具体分类就铺平） */
  const groupSections = useMemo(() => {
    const map = new Map<string, MediaItem[]>()
    for (const c of visible) {
      const g = c.group || c.genres[0] || '未分组'
      const arr = map.get(g) ?? []
      arr.push(c)
      map.set(g, arr)
    }
    if (group !== '全部') return [[group, visible]] as Array<[string, MediaItem[]]>
    return [...map.entries()].sort((a, b) => b[1].length - a[1].length)
  }, [visible, group])

  /** 单张频道卡：带自定义频道号（点数字可改） */
  function renderCard(c: MediaItem) {
    const list = epg[c.id]
    const num = numberById.get(c.id)
    return (
      <div
        key={c.id}
        className={`glass-panel group relative cursor-pointer overflow-hidden rounded-2xl p-3.5 transition hover:border-gold/30 ${
          health[c.id]?.ok === false ? 'opacity-55' : ''
        }`}
        onClick={() => playChannel(c)}
        role="button"
        tabIndex={0}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') playChannel(c)
        }}
      >
        {health[c.id]?.ok === false && (
          <span className="absolute right-2 top-2 rounded-md bg-red-500/15 px-1.5 py-0.5 text-[9.5px] text-red-300/90">
            失效
          </span>
        )}
        <div className="flex items-center gap-3">
          {editingId === c.id ? (
            <input
              autoFocus
              value={editValue}
              onChange={(e) => setEditValue(e.target.value.replace(/[^0-9]/g, ''))}
              onClick={(e) => e.stopPropagation()}
              onBlur={() => {
                setChannelNumber(c.id, Number(editValue) || 0)
                setEditingId(null)
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  setChannelNumber(c.id, Number(editValue) || 0)
                  setEditingId(null)
                }
                if (e.key === 'Escape') setEditingId(null)
              }}
              className="h-7 w-11 shrink-0 rounded-md bg-white/12 text-center text-[11.5px] tabular-nums text-fg outline-none"
            />
          ) : (
            <button
              onClick={(e) => {
                e.stopPropagation()
                setEditingId(c.id)
                setEditValue(num ? String(num) : '')
              }}
              title="点击设置频道号"
              className="w-7 shrink-0 text-center text-[12px] tabular-nums text-muted/60 transition hover:text-gold"
            >
              {num ?? '—'}
            </button>
          )}
          <ChannelLogo item={c} />
          <div className="min-w-0 flex-1">
            <div className="truncate text-[13px] font-medium">{c.title}</div>
            <div className="truncate text-[10.5px] text-muted">{c.group || '未分组'}</div>
          </div>
          <Play
            size={13}
            className="shrink-0 text-muted opacity-0 transition group-hover:opacity-100 group-hover:text-gold"
          />
        </div>

        <NowStrip list={list} fallback="暂无节目单" />

        <div className="mt-2.5 flex items-center justify-between">
          <button
            onClick={(e) => {
              e.stopPropagation()
              void openGuide(c)
            }}
            className="flex items-center gap-1 text-[10.5px] text-muted/80 hover:text-gold"
          >
            <Clock size={10.5} /> 节目单
          </button>
          <button
            onClick={(e) => {
              e.stopPropagation()
              actions.toggleChannelFavorite(c.id)
            }}
            title={channelFavorites.includes(c.id) ? '取消收藏' : '收藏频道'}
            className={`rounded-md p-1 transition ${
              channelFavorites.includes(c.id)
                ? 'text-gold'
                : 'text-muted/50 opacity-0 group-hover:opacity-100 hover:text-gold'
            }`}
          >
            <Star size={12} fill={channelFavorites.includes(c.id) ? 'currentColor' : 'none'} />
          </button>
        </div>
      </div>
    )
  }

  const pickedSource = picked?.item.sourceId ? sourceById.get(picked.item.sourceId) : undefined
  const pickedList = picked ? epg[picked.item.id] ?? [] : []

  /** 打开节目单：列表里没有就单独拉一次（频道太多时批量只覆盖前 80 个） */
  async function openGuide(item: MediaItem) {
    setPicked({ item })
    if (epg[item.id]) return
    const src = item.sourceId ? sourceById.get(item.sourceId) : undefined
    if (!src || src.kind !== 'xtream' || typeof item.streamId !== 'number') return
    setGuideLoading(true)
    try {
      const list = await loadEpg(src, item.streamId)
      if (list.length > 0) setEpg((prev) => ({ ...prev, [item.id]: list }))
    } catch (e) {
      setNotice(e instanceof Error ? e.message : String(e))
    } finally {
      setGuideLoading(false)
    }
  }

  if (liveChannels.length === 0) {
    return (
      <div className="px-10 pt-10">
        <h1 className="text-[22px] font-semibold tracking-tight">直播</h1>
        <div className="glass-panel mt-6 rounded-2xl px-6 py-10 text-center">
          <Tv size={26} className="mx-auto text-muted" />
          <p className="mt-3 text-[13px] text-fg/90">还没有直播频道</p>
          <p className="mx-auto mt-1.5 max-w-[420px] text-[12px] leading-relaxed text-muted">
            在 设置 → 片源 里接入 Xtream 账号或 M3U 直播源，频道会自动出现在这里，Xtream 源还会带上节目单。
          </p>
          <button
            onClick={() => navigate('/settings')}
            className="glass-primary mt-5 rounded-lg px-4 py-2 text-[12.5px] font-semibold"
          >
            去接入片源
          </button>
        </div>
      </div>
    )
  }

  return (
    <div className="pb-16">
      <div className="px-10 pt-7">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-2 text-[22px] font-semibold tracking-tight">
              直播
              {loading && <Loader2 size={14} className="animate-spin text-gold/80" />}
            </h1>
            <p className="mt-1 text-[12px] text-muted">
              共 {liveChannels.length} 个频道 · {groups.length} 个分类
              {Object.keys(epg).length > 0 ? ' · 节目单已更新' : ''}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="glass-inset flex rounded-lg p-0.5 text-[11px]">
              {(
                [
                  ['grid', '频道墙'],
                  ['timeline', '时间轴'],
                  ['multi', '多屏'],
                ] as const
              ).map(([v, label]) => (
                <button
                  key={v}
                  onClick={() => setView(v)}
                  className={`rounded-md px-2.5 py-1 transition ${
                    view === v ? 'bg-white/12 text-gold' : 'text-muted hover:text-fg/80'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
            <div className="glass-inset flex items-center gap-1.5 rounded-lg px-2.5 py-1.5">
              <Search size={12} className="text-muted" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜频道"
                className="w-[120px] bg-transparent text-[11.5px] text-fg outline-none placeholder:text-muted/70"
              />
            </div>
            <button
              onClick={() => void runProbe()}
              disabled={probing}
              title="逐个探测频道是否还能播"
              className="glass-btn flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11.5px] text-fg/80 disabled:opacity-60"
            >
              {probing ? (
                <Loader2 size={12} className="animate-spin" />
              ) : (
                <Activity size={12} />
              )}
              {probing ? `${probeDone}/${liveChannels.length}` : '体检'}
            </button>
            <button
              onClick={() => void loadAllEpg(true)}
              disabled={loading}
              title="刷新节目单"
              className="glass-btn flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11.5px] text-fg/80 disabled:opacity-50"
            >
              <RefreshCw size={12} className={loading ? 'animate-spin' : ''} />
              节目单
            </button>
          </div>
        </div>

        <div className="no-scrollbar mt-4 flex items-center gap-1.5 overflow-x-auto pb-1">
          {(
            [
              ['全部', liveChannels.length] as const,
              ['收藏', favoriteCount] as const,
              ...groups,
            ] as const
          ).map(([g, n]) => (
            <button
              key={g}
              onClick={() => setGroup(g)}
              className={`glass-chip shrink-0 rounded-lg px-3 py-1.5 text-[11.5px] ${
                group === g ? 'is-active text-gold' : 'text-muted'
              }`}
            >
              {g}
              <span className="ml-1.5 text-[10px] opacity-60">{n}</span>
            </button>
          ))}
          {deadCount > 0 && (
            <button
              onClick={() => setHideDead((v) => !v)}
              className={`glass-chip ml-1 flex shrink-0 items-center gap-1 rounded-lg px-2.5 py-1.5 text-[11px] ${
                hideDead ? 'is-active text-gold' : 'text-muted'
              }`}
              title="隐藏 6 小时内检测到失效的频道"
            >
              {hideDead ? '已隐藏' : '隐藏'}失效 · {deadCount}
            </button>
          )}
        </div>

        {recentChannels.length > 0 && (
          <div className="no-scrollbar mt-2 flex items-center gap-2 overflow-x-auto pb-1">
            <span className="flex shrink-0 items-center gap-1 text-[10.5px] text-muted">
              <History size={11} /> 最近
            </span>
            {recentChannels.map((c) => (
              <button
                key={c.id}
                onClick={() => playChannel(c)}
                className="glass-chip flex shrink-0 items-center gap-1.5 rounded-lg py-1 pl-1 pr-2.5 text-[11px] text-fg/80 hover:text-gold"
              >
                <ChannelLogo item={c} size={20} />
                <span className="max-w-[110px] truncate">{c.title}</span>
              </button>
            ))}
          </div>
        )}

        {notice && (
          <div className="glass-tip mt-4 rounded-lg px-3 py-2 text-[11.5px] text-muted">{notice}</div>
        )}
      </div>

      {view === 'timeline' && <TimelineView items={visible} epg={epg} now={now} onPlay={playChannel} />}
      {view === 'multi' && <MultiView items={visible} />}

      {view === 'grid' && (
        <div className="mt-4 px-10">
          {groupSections.map(([g, list]) => (
            <section key={g} className="mb-6">
              {group === '全部' && (
                <button
                  onClick={() => toggleCollapsed(g)}
                  className="mb-2.5 flex items-center gap-2 text-[12.5px] text-muted hover:text-gold"
                >
                  <span className="text-[10px]">{prefs.collapsed.includes(g) ? '▸' : '▾'}</span>
                  <span className="font-medium text-fg/85">{g}</span>
                  <span className="text-[10.5px] text-muted/60">{list.length} 个</span>
                </button>
              )}
              {!prefs.collapsed.includes(g) && (
                <div className="grid grid-cols-[repeat(auto-fill,minmax(232px,1fr))] gap-3">
                  {list.map((c) => renderCard(c))}
                </div>
              )}
            </section>
          ))}
        </div>
      )}

      {view === 'grid' && visible.length === 0 && (
        <div className="px-10 pt-10 text-center text-[12px] text-muted">
          {group === '收藏' && !query.trim()
            ? '还没有收藏频道：把鼠标移到频道卡片上，点右下角的星星即可收藏'
            : '没有匹配的频道，换个关键词试试'}
        </div>
      )}

      {picked && (
        <GuideDrawer
          picked={{ item: picked.item, source: pickedSource, list: pickedList }}
          loading={guideLoading}
          now={now}
          onCatchup={(p) => catchup(picked.item, p)}
          onClose={() => setPicked(null)}
          onPlay={() => {
            setPicked(null)
            navigate(`/play/${picked.item.id}`)
          }}
        />
      )}
    </div>
  )
}