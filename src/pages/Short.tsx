/**
 * 短剧页：免费方案（本机 sidecar + openhongguo）。
 *
 * 上新 / 搜索 / 详情 / 分集 直接浏览；点某一集会由 sidecar 下载并本地解密（CENC），
 * 然后交给内置播放器播放。取流接口偶尔会被上游限流，页面会把原因直接显示出来。
 */
import { useCallback, useEffect, useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { Bell, BellRing, Loader2, Play, RefreshCw, Search, X } from 'lucide-react'
import {
  cacheShortDramas,
  localPlayPath,
  sdEpisodes,
  sdNew,
  sdPrepare,
  sdQueue,
  sdQueueAdd,
  sdQueueClear,
  sdSearch,
  sdSeries,
  sdStart,
  type DramaEpisode,
  type DramaItem,
  type QueueItem,
  type QueueSnapshot,
} from '../lib/short'
import { useShortProgress } from '../lib/shortProgress'
import { removeShortProgress } from '../lib/shortProgress'
import { setQueue } from '../lib/playQueue'
import { sdInstallRuntime, sdRuntime, type ShortRuntime } from '../lib/ops'
import { isFollowed, syncFollowCount, toggleFollow, useShortFollows } from '../lib/shortFollow'

function DramaCard({ item, onClick }: { item: DramaItem; onClick: () => void }) {
  const [broken, setBroken] = useState(false)
  const hue = (item.title.charCodeAt(0) * 37 + (item.title.charCodeAt(1) || 11) * 13) % 360
  return (
    <button
      onClick={onClick}
      className="glass-poster group relative aspect-[3/4] overflow-hidden rounded-xl text-left transition duration-300 hover:-translate-y-1 hover:scale-[1.02]"
    >
      {item.cover && !broken ? (
        <img
          src={item.cover}
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
          {item.title.slice(0, 8)}
        </div>
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-black/92 via-black/15 to-transparent" />
      <div className="glass-sheen" />
      {item.episodes > 0 && (
        <span className="absolute right-2 top-2 rounded bg-black/55 px-1.5 py-0.5 text-[10px] text-white/80 backdrop-blur-sm">
          {item.episodes} 集
        </span>
      )}
      <div className="absolute inset-x-0 bottom-0 p-2.5">
        <div className="line-clamp-2 text-[12.5px] font-semibold leading-snug text-white drop-shadow">
          {item.title}
        </div>
        <div className="mt-0.5 truncate text-[10px] text-white/55">
          {item.tags.slice(0, 2).join(' · ') || '短剧'}
        </div>
      </div>
      <span className="glass-primary absolute bottom-2.5 right-2.5 flex h-7 w-7 items-center justify-center rounded-full opacity-0 transition group-hover:opacity-100">
        <Play size={11} fill="currentColor" />
      </span>
    </button>
  )
}

function EpisodePanel({
  item,
  onPlay,
  onPlayFrom,
  onQueue,
}: {
  item: DramaItem
  onPlay: (ep: DramaEpisode, file: string) => void
  onPlayFrom: (eps: DramaEpisode[], index: number) => void
  onQueue: (eps: DramaEpisode[]) => void
}) {
  const [eps, setEps] = useState<DramaEpisode[] | null>(null)
  const [busyEp, setBusyEp] = useState<string | null>(null)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  useEffect(() => {
    let cancelled = false
    setEps(null)
    setMsg(null)
    sdEpisodes(item.id)
      .then((list) => {
        if (cancelled) return
        setEps(list)
        if (list.length === 0) setMsg({ kind: 'err', text: '这部剧没有返回可播放的分集' })
      })
      .catch((e) => {
        if (!cancelled) setMsg({ kind: 'err', text: e instanceof Error ? e.message : String(e) })
      })
    return () => {
      cancelled = true
    }
  }, [item.id])

  async function play(ep: DramaEpisode) {
    if (busyEp) return
    setBusyEp(ep.id)
    setMsg({ kind: 'ok', text: `正在下载并解密第 ${ep.number} 集…（首次约 5~15 秒）` })
    try {
      const r = await sdPrepare(item.id, ep.id)
      setMsg({ kind: 'ok', text: r.cached ? '已命中本地缓存，直接播放' : `已解密到本地（${r.definition}）` })
      onPlay(ep, r.path)
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusyEp(null)
    }
  }

  return (
    <div className="mt-4">
      <div className="flex items-center justify-between gap-2 text-[11.5px] text-muted">
        <span>分集 · {eps ? eps.length : '…'} 集</span>
        <div className="flex items-center gap-1.5">
          {eps && eps.length > 0 && (
            <>
              <button
                onClick={() => onPlayFrom(eps, 0)}
                className="glass-chip rounded-lg px-2 py-0.5 text-[10.5px] text-fg/80 hover:text-gold"
              >
                从头连播
              </button>
              <button
                onClick={() => onQueue(eps.slice(0, 20))}
                className="glass-chip rounded-lg px-2 py-0.5 text-[10.5px] text-fg/80 hover:text-gold"
              >
                下载前 20 集
              </button>
              <button
                onClick={() => onQueue(eps.slice(0, 60))}
                className="glass-chip rounded-lg px-2 py-0.5 text-[10.5px] text-muted hover:text-gold"
              >
                全部
              </button>
            </>
          )}
        </div>
      </div>

      {!eps && !msg && (
        <div className="flex items-center gap-2 py-6 text-[12px] text-muted">
          <Loader2 size={13} className="animate-spin text-gold" /> 正在拉取分集…
        </div>
      )}

      {eps && (
        <div className="no-scrollbar mt-2 grid max-h-[46vh] grid-cols-[repeat(auto-fill,minmax(64px,1fr))] gap-1.5 overflow-y-auto">
          {eps.map((ep) => (
            <button
              key={ep.id}
              disabled={!ep.playable || busyEp !== null}
              onClick={() => void play(ep)}
              className={`flex h-9 items-center justify-center rounded-lg text-[11.5px] transition ${
                busyEp === ep.id
                  ? 'bg-gold/20 text-gold'
                  : ep.playable
                    ? 'bg-white/8 text-fg/85 hover:bg-white/14 hover:text-gold'
                    : 'bg-white/4 text-muted/40'
              }`}
            >
              {busyEp === ep.id ? <Loader2 size={12} className="animate-spin" /> : ep.number}
            </button>
          ))}
        </div>
      )}

      {msg && (
        <div
          className={`mt-2.5 rounded-lg px-2.5 py-2 text-[10.5px] leading-relaxed ${
            msg.kind === 'ok' ? 'bg-emerald-400/8 text-emerald-200/90' : 'bg-amber-400/8 text-amber-200/90'
          }`}
        >
          {msg.text}
        </div>
      )}
    </div>
  )
}

/** 下载队列面板：轮询 sidecar 的队列状态 */
function QueuePanel({ onPlayFile }: { onPlayFile: (q: QueueItem) => void }) {
  const [snap, setSnap] = useState<QueueSnapshot | null>(null)

  useEffect(() => {
    let alive = true
    const tick = async () => {
      try {
        const s = await sdQueue()
        if (alive) setSnap(s)
      } catch {
        /* 忽略单次失败 */
      }
    }
    void tick()
    const timer = window.setInterval(tick, 2000)
    return () => {
      alive = false
      window.clearInterval(timer)
    }
  }, [])

  if (!snap || snap.items.length === 0) return null
  const done = snap.items.filter((x) => x.status === 'done').length
  const failed = snap.items.filter((x) => x.status === 'failed').length
  const working = snap.items.find((x) => x.status === 'working')

  return (
    <div className="glass-panel mt-4 rounded-2xl px-4 py-3">
      <div className="flex items-center gap-3 text-[12px]">
        <Loader2OrDot running={snap.running} />
        <span className="font-medium">下载队列</span>
        <span className="text-muted">
          {done}/{snap.items.length} 完成{failed > 0 ? ` · 失败 ${failed}` : ''}
          {working ? ` · 正在下载第 ${working.number} 集` : ''}
        </span>
        <button
          onClick={() => void sdQueueClear().then(setSnap)}
          className="glass-btn ml-auto rounded-lg px-2.5 py-1 text-[11px] text-muted hover:text-gold"
        >
          清理已完成
        </button>
      </div>
      <div className="no-scrollbar mt-2 flex max-h-[92px] flex-wrap gap-1.5 overflow-y-auto">
        {snap.items.map((q) => (
          <button
            key={q.episodeId}
            disabled={q.status !== 'done'}
            onClick={() => onPlayFile(q)}
            title={q.error || q.path}
            className={`rounded-md px-2 py-1 text-[10.5px] ${
              q.status === 'done'
                ? 'bg-emerald-400/12 text-emerald-200/90 hover:bg-emerald-400/20'
                : q.status === 'failed'
                  ? 'bg-amber-400/12 text-amber-200/90'
                  : q.status === 'working'
                    ? 'bg-gold/20 text-gold'
                    : 'bg-white/8 text-muted'
            }`}
          >
            第 {q.number} 集{q.status === 'done' ? ' ✓' : q.status === 'failed' ? ' ✗' : ''}
          </button>
        ))}
      </div>
    </div>
  )
}

function Loader2OrDot({ running }: { running: boolean }) {
  return running ? (
    <Loader2 size={13} className="animate-spin text-gold" />
  ) : (
    <span className="h-2 w-2 rounded-full bg-white/30" />
  )
}

export default function ShortPage() {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const [tab, setTab] = useState<'new' | 'search'>('new')
  const [items, setItems] = useState<DramaItem[]>([])
  const [results, setResults] = useState<DramaItem[]>([])
  const [query, setQuery] = useState('')
  const [booting, setBooting] = useState(true)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [picked, setPicked] = useState<DramaItem | null>(null)
  const [runtime, setRuntime] = useState<ShortRuntime | null>(null)
  const [installing, setInstalling] = useState(false)
  const progress = useShortProgress()
  const follows = useShortFollows()

  const loadNew = useCallback(async (force = false) => {
    setLoading(true)
    setErr(null)
    try {
      const list = await sdNew()
      setItems(list)
      cacheShortDramas(list)
      list.forEach((d) => syncFollowCount(d))
      if (list.length === 0 && force) setErr('没有拿到上新列表，稍后再试')
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        setRuntime(await sdRuntime())
        await sdStart()
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e))
        if (!cancelled) void sdRuntime().then(setRuntime)
      } finally {
        if (!cancelled) setBooting(false)
      }
      if (!cancelled) await loadNew()
    })()
    return () => {
      cancelled = true
    }
  }, [loadNew])

  async function runSearch() {
    if (!query.trim()) return
    setTab('search')
    setLoading(true)
    setErr(null)
    try {
      const list = await sdSearch(query.trim())
      setResults(list)
      cacheShortDramas(list)
      list.forEach((d) => syncFollowCount(d))
      if (list.length === 0) setErr('没有搜到相关短剧')
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
      setResults([])
    } finally {
      setLoading(false)
    }
  }

  /** 准备某一集并跳转播放 */
  async function playEpisode(item: DramaItem, ep: DramaEpisode) {
    const r = await sdPrepare(item.id, ep.id)
    navigate(localPlayPath(item, ep, r.path))
  }

  /** 从某一集开始连播：把整季塞进播放队列 */
  async function playFrom(item: DramaItem, eps: DramaEpisode[], index: number) {
    const list = eps.slice(index).filter((e) => e.playable)
    setQueue(
      list.map((e) => ({
        kind: 'short' as const,
        name: `${item.title} · 第${e.number}集`,
        seriesId: item.id,
        episodeId: e.id,
        epNumber: e.number,
        cover: item.cover || undefined,
      })),
      0,
    )
    const first = list[0]
    if (!first) return
    try {
      await playEpisode(item, first)
    } catch (e) {
      setErr(e instanceof Error ? e.message : String(e))
    }
  }

  async function open(item: DramaItem) {
    setPicked(item)
    try {
      const full = await sdSeries(item.id)
      if (full) setPicked(full)
    } catch {
      /* 详情失败就用列表信息 */
    }
  }

  // 从 ⌘K 跳进来时自动打开对应剧集
  useEffect(() => {
    const openId = searchParams.get('open')
    if (!openId || items.length === 0) return
    const hit = items.find((x) => x.id === openId)
    setSearchParams({}, { replace: true })
    if (hit) void open(hit)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [items, searchParams])

  const list = tab === 'new' ? items : results

  return (
    <div className="pb-16">
      <div className="px-10 pt-7">
        <div className="flex items-end justify-between gap-4">
          <div>
            <h1 className="flex items-center gap-2 text-[22px] font-semibold tracking-tight">
              短剧
              {(loading || booting) && <Loader2 size={14} className="animate-spin text-gold/80" />}
            </h1>
            <p className="mt-1 text-[12px] text-muted">
              {booting ? '正在启动短剧服务…' : '红果短剧 · 免费浏览与播放（本地解密，无需账号）'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <div className="glass-inset flex rounded-lg p-0.5 text-[11px]">
              {(
                [
                  ['new', '上新'],
                  ['search', '搜索'],
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
            <button
              onClick={() => void (tab === 'new' ? loadNew(true) : runSearch())}
              disabled={loading}
              title="刷新"
              className="glass-btn flex h-8 w-8 items-center justify-center rounded-lg text-muted hover:text-gold disabled:opacity-50"
            >
              <RefreshCw size={13} className={loading ? 'animate-spin' : ''} />
            </button>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-2">
          <div className="glass-inset flex flex-1 items-center gap-1.5 rounded-lg px-2.5 py-1.5">
            <Search size={12} className="text-muted" />
            <input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void runSearch()
              }}
              placeholder="搜短剧名，回车开始搜索"
              className="w-full bg-transparent text-[11.5px] text-fg outline-none placeholder:text-muted/70"
            />
          </div>
          <button
            onClick={() => void runSearch()}
            className="glass-primary rounded-lg px-3.5 py-2 text-[11.5px] font-semibold"
          >
            搜索
          </button>
        </div>

        {err && <div className="glass-warn mt-4 rounded-lg px-3 py-2 text-[11.5px] text-amber-200/90">{err}</div>}

        {runtime?.source === 'none' && (
          <div className="glass-panel mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl px-4 py-3">
            <div className="min-w-0">
              <div className="text-[12.5px] font-medium">短剧需要 Node 运行时</div>
              <div className="mt-0.5 text-[11px] leading-relaxed text-muted">
                可以一键下载内置运行时（约 40MB，装到应用目录，不动系统环境），也可以自行安装 Node 后重启 App。
              </div>
            </div>
            <button
              onClick={() => {
                setInstalling(true)
                setErr(null)
                void sdInstallRuntime()
                  .then(() => sdRuntime())
                  .then((r) => {
                    setRuntime(r)
                    setErr('运行时已就绪，正在重新启动短剧服务…')
                    return sdStart().then(() => window.location.reload())
                  })
                  .catch((e) => setErr(e instanceof Error ? e.message : String(e)))
                  .finally(() => setInstalling(false))
              }}
              disabled={installing}
              className="glass-primary shrink-0 rounded-lg px-3.5 py-2 text-[12px] font-semibold disabled:opacity-50"
            >
              {installing ? '下载中…' : '下载运行时'}
            </button>
          </div>
        )}

        <QueuePanel
          onPlayFile={(q) => {
            const fake: DramaItem = {
              id: q.seriesId,
              title: q.title || '',
              description: '',
              cover: '',
              episodes: 0,
              tags: [],
            }
            navigate(localPlayPath(fake, { id: q.episodeId, number: q.number, title: '', playable: true, duration: 0 }, q.path))
          }}
        />

        {follows.length > 0 && (
          <div className="mt-4 flex flex-wrap items-center gap-2 text-[11px] text-muted">
            <span className="flex items-center gap-1">
              <BellRing size={11} className="text-gold/80" /> 关注 {follows.length} 部
            </span>
            {follows.slice(0, 6).map((f) => (
              <button
                key={f.seriesId}
                onClick={() => navigate(`/short?open=${encodeURIComponent(f.seriesId)}`)}
                className="glass-chip rounded-lg px-2 py-0.5 text-[10.5px] text-fg/80 hover:text-gold"
              >
                {f.title}
              </button>
            ))}
          </div>
        )}

        {progress.length > 0 && (
          <section className="mt-5">
            <div className="mb-2.5 flex items-baseline gap-2.5 border-b border-white/6 pb-2">
              <h2 className="text-[15px] font-semibold tracking-tight">继续观看</h2>
              <span className="text-[11px] text-muted/60">{progress.length} 部</span>
            </div>
            <div className="no-scrollbar flex gap-3 overflow-x-auto pb-2">
              {progress.slice(0, 10).map((p) => (
                <div key={p.seriesId} className="group relative w-[132px] shrink-0">
                  <button
                    onClick={() => {
                      const fake: DramaItem = {
                        id: p.seriesId,
                        title: p.title,
                        description: '',
                        cover: p.cover ?? '',
                        episodes: 0,
                        tags: [],
                      }
                      void playFrom(fake, [{ id: p.episodeId, number: p.epNumber, title: '', playable: true, duration: p.duration }], 0)
                    }}
                    className="block w-full text-left"
                  >
                    <div className="glass-poster relative aspect-[3/4] overflow-hidden rounded-xl">
                      {p.cover ? (
                        <img src={p.cover} alt="" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
                      ) : (
                        <div className="h-full w-full bg-white/6" />
                      )}
                      <div className="absolute inset-0 bg-gradient-to-t from-black/85 to-transparent" />
                      <div className="absolute inset-x-0 bottom-0 p-2 text-[10px] text-white/75">
                        看到第 {p.epNumber} 集
                      </div>
                    </div>
                    <p className="mt-1.5 truncate text-[11.5px] text-fg/85">{p.title}</p>
                  </button>
                  <button
                    onClick={() => removeShortProgress(p.seriesId)}
                    title="移除记录"
                    className="absolute right-1 top-1 hidden h-5 w-5 items-center justify-center rounded-full bg-black/70 text-white/70 hover:text-red-300 group-hover:flex"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </section>
        )}
      </div>

      {(loading || booting) && list.length === 0 && (
        <div className="mt-4 grid grid-cols-[repeat(auto-fill,minmax(148px,1fr))] gap-3 px-10">
          {Array.from({ length: 12 }).map((_, i) => (
            <div key={i} className="skeleton aspect-[3/4] rounded-xl" />
          ))}
        </div>
      )}

      <div className="mt-4 grid grid-cols-[repeat(auto-fill,minmax(148px,1fr))] gap-3 px-10">
        {list.map((d) => (
          <DramaCard key={d.id} item={d} onClick={() => void open(d)} />
        ))}
      </div>

      {!loading && !booting && list.length === 0 && !err && (
        <div className="px-10 pt-10 text-center text-[12px] text-muted">
          {tab === 'new' ? '今天没有拿到上新数据' : '搜一部短剧试试'}
        </div>
      )}

      {picked && (
        <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true">
          <button aria-label="关闭" onClick={() => setPicked(null)} className="absolute inset-0 bg-black/55 backdrop-blur-[2px]" />
          <aside className="glass-panel relative z-10 flex h-full w-[460px] flex-col overflow-y-auto rounded-none border-y-0 border-r-0 p-5">
            <header className="flex items-start gap-3">
              <div className="glass-poster h-[150px] w-[112px] shrink-0 overflow-hidden rounded-lg">
                {picked.cover ? (
                  <img src={picked.cover} alt="" referrerPolicy="no-referrer" className="h-full w-full object-cover" />
                ) : (
                  <div className="h-full w-full bg-white/6" />
                )}
              </div>
              <div className="min-w-0 flex-1">
                <div className="text-[15px] font-semibold leading-snug">{picked.title}</div>
                <div className="mt-1 text-[10.5px] text-muted">
                  {picked.episodes > 0 ? `${picked.episodes} 集` : '短剧'}
                </div>
                {picked.tags.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1">
                    {picked.tags.slice(0, 6).map((t) => (
                      <span key={t} className="rounded-full bg-white/8 px-2 py-0.5 text-[10px] text-muted">
                        {t}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div className="flex items-center gap-1.5">
                <button
                  onClick={() => {
                    const on = toggleFollow(picked)
                    setErr(on ? `已关注《${picked.title}》，有新集会通知你` : '已取消关注')
                    window.setTimeout(() => setErr(null), 2200)
                  }}
                  title="关注后，剧集更新会发系统通知"
                  className={`glass-btn rounded-lg p-1.5 ${isFollowed(picked.id) ? 'text-gold' : 'text-muted hover:text-fg'}`}
                >
                  {isFollowed(picked.id) ? <BellRing size={14} /> : <Bell size={14} />}
                </button>
                <button onClick={() => setPicked(null)} className="glass-btn rounded-lg p-1.5 text-muted hover:text-fg">
                  <X size={14} />
                </button>
              </div>
            </header>

            {picked.description && (
              <p className="mt-3 text-[11.5px] leading-relaxed text-muted/90">{picked.description}</p>
            )}

            <EpisodePanel
              item={picked}
              onPlay={(ep, file) => navigate(localPlayPath(picked, ep, file))}
              onPlayFrom={(eps, index) => void playFrom(picked, eps, index)}
              onQueue={(eps) => {
                void sdQueueAdd(
                  picked.id,
                  picked.title,
                  eps.filter((e) => e.playable).map((e) => ({ id: e.id, number: e.number })),
                )
              }}
            />
          </aside>
        </div>
      )}
    </div>
  )
}