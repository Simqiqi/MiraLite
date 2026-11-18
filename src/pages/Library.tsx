/**
 * 片库：Xtream 点播（VOD）与剧集。
 *
 * 列表走 get_vod_streams / get_series，点剧集再拉 get_series_info 展开季集。
 * 播放不落库：直接把 sourceId + streamId 带到播放页，由播放页用源的凭据拼地址，
 * 避免把几千条点播条目塞进 localStorage。
 */
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { Film, Loader2, Play, Search, Star, X } from 'lucide-react'
import { useLibrary } from '../lib/store'
import type { Source } from '../lib/types'
import {
  xtreamCategories,
  xtreamSeries,
  xtreamSeriesInfo,
  xtreamVodStreams,
  type XtreamCategory,
  type XtreamEpisode,
  type XtreamSeries,
  type XtreamVodStream,
} from '../lib/xtream'

type Tab = 'vod' | 'series'

interface Cached {
  at: number
  cats: XtreamCategory[]
  vod: XtreamVodStream[]
  series: XtreamSeries[]
}

const TTL = 20 * 60 * 1000
const cache = new Map<string, Cached>()

function PosterCard({
  title,
  img,
  meta,
  badge,
  onClick,
}: {
  title: string
  img?: string
  meta: string
  badge?: string
  onClick: () => void
}) {
  const [broken, setBroken] = useState(false)
  const hue = (title.charCodeAt(0) * 37 + (title.charCodeAt(1) || 11) * 13) % 360
  return (
    <button
      onClick={onClick}
      className="glass-poster group relative aspect-[2/3] overflow-hidden rounded-xl text-left transition duration-300 hover:-translate-y-1 hover:scale-[1.02]"
    >
      {img && !broken ? (
        <img
          src={img}
          alt=""
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setBroken(true)}
          className="absolute inset-0 h-full w-full object-cover"
        />
      ) : (
        <div
          className="absolute inset-0 flex items-center justify-center px-2 text-center text-[12px] text-white/45"
          style={{
            background: `linear-gradient(155deg, hsl(${hue} 58% 26%) 0%, hsl(${(hue + 28) % 360} 44% 12%) 58%, #0b0b0f 100%)`,
          }}
        >
          {title.slice(0, 8)}
        </div>
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/90 via-black/10 to-transparent" />
      <div className="glass-sheen" />
      {badge && (
        <span className="absolute right-2 top-2 flex items-center gap-0.5 rounded bg-black/60 px-1.5 py-0.5 text-[10px] font-semibold text-gold backdrop-blur-sm">
          <Star size={9} fill="currentColor" /> {badge}
        </span>
      )}
      <div className="absolute inset-x-0 bottom-0 p-2.5">
        <div className="line-clamp-2 text-[12px] font-semibold leading-snug text-white drop-shadow">
          {title}
        </div>
        <div className="mt-0.5 truncate text-[10px] text-white/55">{meta}</div>
      </div>
      <span className="glass-primary absolute bottom-2.5 right-2.5 flex h-7 w-7 items-center justify-center rounded-full opacity-0 transition group-hover:opacity-100">
        <Play size={11} fill="currentColor" />
      </span>
    </button>
  )
}

function SeriesDrawer({
  source,
  series,
  onClose,
  onPlay,
}: {
  source: Source
  series: XtreamSeries
  onClose: () => void
  onPlay: (ep: XtreamEpisode) => void
}) {
  const [episodes, setEpisodes] = useState<XtreamEpisode[] | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setEpisodes(null)
    setErr(null)
    xtreamSeriesInfo(source.url, source.username ?? '', source.password ?? '', series.seriesId)
      .then((list) => {
        if (!cancelled) setEpisodes(list)
      })
      .catch((e) => {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e))
      })
    return () => {
      cancelled = true
    }
  }, [source, series.seriesId])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  const seasons = useMemo(() => {
    const map = new Map<number, XtreamEpisode[]>()
    for (const ep of episodes ?? []) {
      const list = map.get(ep.season) ?? []
      list.push(ep)
      map.set(ep.season, list)
    }
    return [...map.entries()].sort((a, b) => a[0] - b[0])
  }, [episodes])

  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true">
      <button aria-label="关闭" onClick={onClose} className="absolute inset-0 bg-black/55 backdrop-blur-[2px]" />
      <aside className="glass-panel relative z-10 flex h-full w-[440px] flex-col rounded-none border-y-0 border-r-0">
        <header className="flex items-start gap-3 border-b border-white/10 p-5">
          <div className="glass-poster h-[96px] w-[68px] shrink-0 overflow-hidden rounded-lg">
            {series.cover ? (
              <img src={series.cover} alt="" className="h-full w-full object-cover" referrerPolicy="no-referrer" />
            ) : (
              <div className="h-full w-full bg-white/6" />
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[15px] font-semibold">{series.name}</div>
            <div className="mt-1 flex items-center gap-2 text-[10.5px] text-muted">
              {series.year && <span>{series.year}</span>}
              {series.rating ? (
                <span className="flex items-center gap-0.5 text-gold">
                  <Star size={9} fill="currentColor" /> {series.rating.toFixed(1)}
                </span>
              ) : null}
              <span>{source.name}</span>
            </div>
            {series.plot && (
              <p className="mt-2 line-clamp-3 text-[11px] leading-relaxed text-muted/85">{series.plot}</p>
            )}
          </div>
          <button onClick={onClose} className="glass-btn rounded-lg p-1.5 text-muted hover:text-fg">
            <X size={14} />
          </button>
        </header>

        <div className="no-scrollbar flex-1 overflow-y-auto p-3">
          {!episodes && !err && (
            <div className="flex items-center justify-center gap-2 py-10 text-[12px] text-muted">
              <Loader2 size={14} className="animate-spin text-gold" /> 正在拉取季集…
            </div>
          )}
          {err && <div className="px-3 py-8 text-[12px] text-amber-300/90">拉取季集失败：{err}</div>}
          {episodes && episodes.length === 0 && (
            <div className="px-3 py-8 text-[12px] text-muted">这个剧集没有返回可播放的集。</div>
          )}
          {seasons.map(([season, list]) => (
            <section key={season} className="mb-3">
              <div className="px-2 py-1.5 text-[11px] text-muted/70">第 {season || 1} 季</div>
              {list.map((ep) => (
                <button
                  key={ep.id}
                  onClick={() => onPlay(ep)}
                  className="group flex w-full items-center gap-3 rounded-xl px-2.5 py-2 text-left hover:bg-white/6"
                >
                  <span className="w-7 shrink-0 text-center text-[11px] tabular-nums text-muted">
                    {String(ep.episode).padStart(2, '0')}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12px] text-fg/90">
                      {ep.title || `第 ${ep.episode} 集`}
                    </span>
                    <span className="mt-0.5 block truncate text-[10px] text-muted/70">
                      {[ep.duration, ep.rating ? `★ ${ep.rating.toFixed(1)}` : ''].filter(Boolean).join(' · ')}
                    </span>
                  </span>
                  <Play size={12} className="shrink-0 text-muted/40 group-hover:text-gold" />
                </button>
              ))}
            </section>
          ))}
        </div>
      </aside>
    </div>
  )
}

export default function LibraryPage() {
  const navigate = useNavigate()
  const { sources } = useLibrary()
  const xtreamSources = useMemo(
    () => sources.filter((s) => s.kind === 'xtream' && s.enabled),
    [sources],
  )
  const [sourceId, setSourceId] = useState(() => xtreamSources[0]?.id ?? '')
  const [tab, setTab] = useState<Tab>('vod')
  const [cats, setCats] = useState<XtreamCategory[]>([])
  const [vod, setVod] = useState<XtreamVodStream[]>([])
  const [series, setSeries] = useState<XtreamSeries[]>([])
  const [group, setGroup] = useState('全部')
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [picked, setPicked] = useState<XtreamSeries | null>(null)

  const source = xtreamSources.find((s) => s.id === sourceId) ?? xtreamSources[0]

  // 源被删/切换时兜底
  useEffect(() => {
    if (!sourceId && xtreamSources[0]) setSourceId(xtreamSources[0].id)
    if (sourceId && !xtreamSources.some((s) => s.id === sourceId) && xtreamSources[0]) {
      setSourceId(xtreamSources[0].id)
    }
  }, [sourceId, xtreamSources])

  const load = useCallback(
    async (force = false) => {
      if (!source) return
      const key = `${source.id}|${tab}`
      const hit = cache.get(key)
      if (!force && hit && Date.now() - hit.at < TTL) {
        setCats(hit.cats)
        setVod(hit.vod)
        setSeries(hit.series)
        setErr(null)
        return
      }
      setLoading(true)
      setErr(null)
      try {
        const base = source.url
        const user = source.username ?? ''
        const pass = source.password ?? ''
        if (tab === 'vod') {
          const [c, list] = await Promise.all([
            xtreamCategories(base, user, pass, 'vod').catch(() => [] as XtreamCategory[]),
            xtreamVodStreams(base, user, pass),
          ])
          setCats(c)
          setVod(list)
          setSeries([])
          cache.set(key, { at: Date.now(), cats: c, vod: list, series: [] })
        } else {
          const [c, list] = await Promise.all([
            xtreamCategories(base, user, pass, 'series').catch(() => [] as XtreamCategory[]),
            xtreamSeries(base, user, pass),
          ])
          setCats(c)
          setSeries(list)
          setVod([])
          cache.set(key, { at: Date.now(), cats: c, vod: [], series: list })
        }
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e))
      } finally {
        setLoading(false)
      }
    },
    [source, tab],
  )

  useEffect(() => {
    setGroup('全部')
    void load()
  }, [load])

  const catName = useMemo(() => new Map(cats.map((c) => [c.id, c.name])), [cats])

  const visibleVod = useMemo(() => {
    const q = query.trim().toLowerCase()
    return vod.filter((v) => {
      if (group !== '全部' && catName.get(v.categoryId) !== group) return false
      return !q || v.name.toLowerCase().includes(q)
    })
  }, [vod, group, query, catName])

  const visibleSeries = useMemo(() => {
    const q = query.trim().toLowerCase()
    return series.filter((s) => {
      if (group !== '全部' && catName.get(s.categoryId) !== group) return false
      return !q || s.name.toLowerCase().includes(q)
    })
  }, [series, group, query, catName])

  const groups = useMemo(() => {
    const count = new Map<string, number>()
    for (const c of cats) count.set(c.name, 0)
    for (const v of tab === 'vod' ? vod : series) {
      const name = catName.get(v.categoryId)
      if (name) count.set(name, (count.get(name) ?? 0) + 1)
    }
    return [...count.entries()].filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1])
  }, [cats, vod, series, tab, catName])

  function playVod(v: XtreamVodStream) {
    if (!source) return
    const params = new URLSearchParams({
      remote: '1',
      mode: 'vod',
      source: source.id,
      id: String(v.streamId),
      ext: v.container || 'mp4',
      name: v.name,
    })
    if (v.icon) params.set('poster', v.icon)
    navigate(`/play/_?${params.toString()}`)
  }

  function playEpisode(s: XtreamSeries, ep: XtreamEpisode) {
    if (!source) return
    const params = new URLSearchParams({
      remote: '1',
      mode: 'series',
      source: source.id,
      id: String(ep.id),
      ext: ep.container || 'mp4',
      name: `${s.name} · S${ep.season}E${ep.episode}`,
    })
    if (s.cover) params.set('poster', s.cover)
    navigate(`/play/_?${params.toString()}`)
  }

  if (xtreamSources.length === 0) {
    return (
      <div className="px-10 pt-10">
        <h1 className="text-[22px] font-semibold tracking-tight">片库</h1>
        <div className="glass-panel mt-6 rounded-2xl px-6 py-12 text-center">
          <Film size={26} className="mx-auto text-muted" />
          <p className="mt-3 text-[13px] text-fg/90">还没有可用的 Xtream 源</p>
          <p className="mx-auto mt-1.5 max-w-[440px] text-[12px] leading-relaxed text-muted">
            片库的点播与剧集来自 Xtream 面板。在 设置 → 片源 里接入账号后，这里会自动出现电影和剧集。
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

  const listCount = tab === 'vod' ? visibleVod.length : visibleSeries.length

  return (
    <div className="pb-16">
      <div className="px-10 pt-7">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-2 text-[22px] font-semibold tracking-tight">
              片库
              {loading && <Loader2 size={14} className="animate-spin text-gold/80" />}
            </h1>
            <p className="mt-1 text-[12px] text-muted">
              {source?.name ?? '未选择源'} · {tab === 'vod' ? `${vod.length} 部电影` : `${series.length} 部剧集`}
              {cats.length > 0 ? ` · ${groups.length} 个分类` : ''}
            </p>
          </div>
          <div className="flex items-center gap-2">
            {xtreamSources.length > 1 && (
              <select
                value={source?.id ?? ''}
                onChange={(e) => setSourceId(e.target.value)}
                className="glass-input h-8 rounded-lg px-2.5 text-[11.5px] text-fg outline-none"
              >
                {xtreamSources.map((s) => (
                  <option key={s.id} value={s.id} className="bg-[#101013]">
                    {s.name}
                  </option>
                ))}
              </select>
            )}
            <div className="glass-inset flex rounded-lg p-0.5 text-[11px]">
              {(
                [
                  ['vod', '电影'],
                  ['series', '剧集'],
                ] as const
              ).map(([v, label]) => (
                <button
                  key={v}
                  onClick={() => setTab(v)}
                  className={`rounded-md px-3 py-1 transition ${
                    tab === v ? 'bg-white/12 text-gold' : 'text-muted hover:text-fg/80'
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
                placeholder={tab === 'vod' ? '搜电影' : '搜剧集'}
                className="w-[120px] bg-transparent text-[11.5px] text-fg outline-none placeholder:text-muted/70"
              />
            </div>
          </div>
        </div>

        <div className="no-scrollbar mt-4 flex gap-1.5 overflow-x-auto pb-1">
          {(['全部', ...groups.map(([g]) => g)] as string[]).map((g, i) => {
            const n = i === 0 ? (tab === 'vod' ? vod.length : series.length) : groups[i - 1][1]
            return (
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
            )
          })}
        </div>

        {err && <div className="glass-warn mt-4 rounded-lg px-3 py-2 text-[11.5px] text-amber-200/90">{err}</div>}
      </div>

      {loading && listCount === 0 && (
        <div className="mt-4 grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3 px-10">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="skeleton aspect-[2/3] rounded-xl" />
          ))}
        </div>
      )}

      {!loading && listCount === 0 && !err && (
        <div className="px-10 pt-10 text-center text-[12px] text-muted">
          {tab === 'vod' ? '这个源没有返回点播电影' : '这个源没有返回剧集'}
        </div>
      )}

      <div className="mt-4 grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3 px-10">
        {tab === 'vod'
          ? visibleVod.map((v) => (
              <PosterCard
                key={v.streamId}
                title={v.name}
                img={v.icon}
                meta={[v.year, v.container?.toUpperCase()].filter(Boolean).join(' · ') || '点播'}
                badge={v.rating ? v.rating.toFixed(1) : undefined}
                onClick={() => playVod(v)}
              />
            ))
          : visibleSeries.map((s) => (
              <PosterCard
                key={s.seriesId}
                title={s.name}
                img={s.cover}
                meta={[s.year, '剧集'].filter(Boolean).join(' · ')}
                badge={s.rating ? s.rating.toFixed(1) : undefined}
                onClick={() => setPicked(s)}
              />
            ))}
      </div>

      {picked && source && (
        <SeriesDrawer
          source={source}
          series={picked}
          onClose={() => setPicked(null)}
          onPlay={(ep) => playEpisode(picked, ep)}
        />
      )}
    </div>
  )
}