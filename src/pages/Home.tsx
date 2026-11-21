import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  AlertCircle,
  ChevronLeft,
  ChevronRight,
  Play,
  RefreshCw,
  Search,
  Shuffle,
  Star,
} from 'lucide-react'
import { fmtTime, removePlayback, usePlayback } from '../lib/playback'
import {
  tmdbRankings,
  onRankingsRefresh,
  type TmdbGroup,
  type TmdbItem,
  type TmdbRankings,
} from '../lib/tmdb'

const ROTATE_MS = 12_000

/** RGB → 色相 */
function rgbToHue(r: number, g: number, b: number): number {
  const rn = r / 255
  const gn = g / 255
  const bn = b / 255
  const max = Math.max(rn, gn, bn)
  const min = Math.min(rn, gn, bn)
  const d = max - min
  if (d === 0) return 0
  let h: number
  if (max === rn) h = ((gn - bn) / d) % 6
  else if (max === gn) h = (bn - rn) / d + 2
  else h = (rn - gn) / d + 4
  return (h * 60 + 360) % 360
}

/** 从 backdrop 采样主色（饱和像素加权）；跨域失败返回 null */
function sampleHue(src: string): Promise<number | null> {
  return new Promise((resolve) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.referrerPolicy = 'no-referrer'
    img.onload = () => {
      try {
        const canvas = document.createElement('canvas')
        canvas.width = 32
        canvas.height = 18
        const ctx = canvas.getContext('2d')
        if (!ctx) return resolve(null)
        ctx.drawImage(img, 0, 0, 32, 18)
        const data = ctx.getImageData(0, 0, 32, 18).data
        let r = 0
        let g = 0
        let b = 0
        let weight = 0
        for (let i = 0; i < data.length; i += 4) {
          const R = data[i]
          const G = data[i + 1]
          const B = data[i + 2]
          const mx = Math.max(R, G, B)
          const mn = Math.min(R, G, B)
          const sat = mx === 0 ? 0 : (mx - mn) / mx
          const w = 0.15 + sat * sat
          r += R * w
          g += G * w
          b += B * w
          weight += w
        }
        resolve(weight > 0 ? rgbToHue(r / weight, g / weight, b / weight) : null)
      } catch {
        resolve(null)
      }
    }
    img.onerror = () => resolve(null)
    img.src = src
  })
}

let ambientRaf = 0

/** 把全局环境色相平滑过渡到以 base 为中心的一组颜色 */
function shiftAmbient(base: number) {
  const root = document.documentElement
  const keys = ['--li-h1', '--li-h2', '--li-h3', '--li-h4']
  const targets = [base, (base + 42) % 360, (base + 158) % 360, (base + 248) % 360]
  const style = getComputedStyle(root)
  const starts = keys.map((k) => Number(style.getPropertyValue(k)) || 0)

  if (ambientRaf) cancelAnimationFrame(ambientRaf)
  const t0 = performance.now()

  const step = (now: number) => {
    const t = Math.min(1, (now - t0) / 900)
    const ease = 1 - Math.pow(1 - t, 3)
    keys.forEach((k, i) => {
      const a = starts[i]
      const b = targets[i]
      // 沿最短方向插值，避免从 350° 转到 10° 时绕一整圈
      const diff = ((b - a + 540) % 360) - 180
      root.style.setProperty(k, String((a + diff * ease + 360) % 360))
    })
    if (t < 1) ambientRaf = requestAnimationFrame(step)
    else ambientRaf = 0
  }
  ambientRaf = requestAnimationFrame(step)
}

/** 大横幅取片：按热度顺序去重，最多 12 部，优先有背景图的 */
function pickHeroItems(groups: TmdbGroup[]): TmdbItem[] {
  const picked: TmdbItem[] = []
  const seen = new Set<string>()
  const order = ['now_playing', 'popular_movie', 'popular_tv', 'top_rated_movie', 'top_rated_tv']
  const ordered = [...groups].sort((a, b) => order.indexOf(a.key) - order.indexOf(b.key))
  for (const g of ordered) {
    for (const it of g.items) {
      const key = it.title.replace(/\s+/g, '')
      if (!key || seen.has(key) || !(it.backdrop || it.poster)) continue
      seen.add(key)
      picked.push(it)
      if (picked.length >= 12) return picked
    }
  }
  return picked
}

function Hero({
  items,
  onOpen,
  onRefresh,
  loading,
  live,
  totalCount,
  updatedAt,
  stale,
}: {
  items: TmdbItem[]
  onOpen: (name: string) => void
  onRefresh: () => void
  loading: boolean
  live: boolean
  totalCount: number
  updatedAt: number | null
  stale: boolean
}) {
  const [index, setIndex] = useState(0)
  const [parallax, setParallax] = useState(0)
  const sectionRef = useRef<HTMLElement>(null)
  const total = items.length
  const item = items[index % Math.max(total, 1)]

  // 自己按节奏换片：12 秒一换，不因鼠标悬停停下
  useEffect(() => {
    if (total < 2) return
    const timer = window.setInterval(() => setIndex((i) => (i + 1) % total), ROTATE_MS)
    return () => window.clearInterval(timer)
  }, [total])

  // 视差：跟随外层 <main> 的滚动，背景比内容慢一点
  useEffect(() => {
    const el = sectionRef.current
    const scroller = el?.closest('main')
    if (!el || !scroller) return
    let raf = 0
    const onScroll = () => {
      if (raf) return
      raf = requestAnimationFrame(() => {
        raf = 0
        setParallax(Math.min(scroller.scrollTop, 260) * 0.16)
      })
    }
    scroller.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      scroller.removeEventListener('scroll', onScroll)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [])

  // 主色跟随：换片时从 backdrop 取色，带动整页环境光
  useEffect(() => {
    const src = item?.backdrop || item?.poster
    if (!src) return
    let cancelled = false
    void sampleHue(src).then((hue) => {
      if (cancelled || hue == null) return
      shiftAmbient(hue)
    })
    return () => {
      cancelled = true
    }
  }, [item?.backdrop, item?.poster])

  if (!item) return null

  const go = (step: number) => setIndex((i) => (i + step + total) % total)
  const timeText = updatedAt
    ? new Date(updatedAt).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })
    : ''

  return (
    <section
      ref={sectionRef}
      className="relative mx-10 mb-10 overflow-hidden rounded-3xl border border-white/10"
    >
      <div className="relative h-[430px]">
        <div
          className="absolute inset-0 will-change-transform"
          style={{ transform: `translate3d(0, ${parallax}px, 0) scale(1.06)` }}
        >
          <img
            key={`${item.mediaType}-${item.id}`}
            src={item.backdrop || item.poster}
            alt=""
            referrerPolicy="no-referrer"
            className="hero-zoom h-full w-full object-cover"
          />
        </div>
        <div className="absolute inset-0 bg-gradient-to-r from-[#08080a] via-[#08080a]/82 to-[#08080a]/10" />
        <div className="absolute inset-0 bg-gradient-to-t from-[#08080a] via-transparent to-[#08080a]/35" />

        <div className="relative z-10 flex h-full flex-col justify-end px-9 pb-9">
          <div className="max-w-[600px]">
            <div className="flex items-center gap-2.5 text-[11px]">
              <span className="rounded-full border border-gold/30 bg-gold/10 px-2 py-0.5 font-medium tracking-wide text-gold">
                {item.mediaType === 'tv' ? '剧集' : '电影'}
              </span>
              {item.year && <span className="text-white/50">{item.year}</span>}
              {item.rating > 0 && (
                <span className="flex items-center gap-1 text-gold">
                  <Star size={10} fill="currentColor" /> {item.rating.toFixed(1)}
                </span>
              )}
              <span className="text-white/30">·</span>
              <span className="text-[10.5px] uppercase tracking-[0.18em] text-white/35">TMDB 精选</span>
            </div>

            <h1 className="mt-3 font-serif text-[40px] font-semibold leading-[1.12] tracking-tight text-white drop-shadow-lg">
              {item.title}
            </h1>

            {item.overview && (
              <p className="mt-3 line-clamp-2 max-w-[560px] text-[12.5px] leading-relaxed text-white/60">
                {item.overview}
              </p>
            )}

            <div className="mt-5 flex items-center gap-2.5">
              <button
                onClick={() => onOpen(item.title)}
                className="glass-primary flex items-center gap-1.5 rounded-full px-5 py-2.5 text-[12.5px] font-semibold"
              >
                <Search size={13} /> 找可播线路
              </button>
              <button
                onClick={() => go(1)}
                className="glass-btn flex items-center gap-1.5 rounded-full px-4 py-2.5 text-[12px] text-white/80 hover:text-gold"
              >
                <Shuffle size={13} /> 换一部
              </button>
            </div>
          </div>
        </div>

        <button
          onClick={onRefresh}
          disabled={loading}
          title={`忽略缓存重新拉取榜单${timeText ? `（上次更新 ${timeText}）` : ''}`}
          className="glass-btn absolute right-4 top-4 z-20 flex h-8 w-8 items-center justify-center rounded-full text-fg/70 hover:text-gold disabled:opacity-50"
        >
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>

        {/* 右侧缩略图：接下来 4 部，点一下切过去 */}
        {total > 2 && (
          <div className="absolute right-5 top-1/2 z-20 hidden -translate-y-1/2 flex-col gap-2 xl:flex">
            {Array.from({ length: Math.min(4, total - 1) }, (_, i) => {
              const it = items[(index + 1 + i) % total]
              const src = it.poster || it.backdrop
              if (!src) return null
              return (
                <button
                  key={`${it.mediaType}-${it.id}-${i}`}
                  onClick={() => go(i + 1)}
                  title={it.title}
                  className="group/thumb relative h-[62px] w-[44px] overflow-hidden rounded-md border border-white/15 opacity-60 shadow-lg transition duration-200 hover:scale-105 hover:border-gold/60 hover:opacity-100"
                >
                  <img
                    src={src}
                    alt=""
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    className="h-full w-full object-cover"
                  />
                  <span className="absolute inset-0 bg-black/30 transition group-hover/thumb:bg-transparent" />
                </button>
              )
            })}
          </div>
        )}

        <div className="absolute bottom-5 right-5 z-20 flex items-center gap-3">
          <span className="hidden text-[10px] text-white/30 sm:block">
            TMDB · {totalCount} 部 · {live ? '实时' : '离线'}
            {timeText && ` · ${timeText}`}
            {stale && <span className="text-gold/80"> · 更新中</span>}
          </span>
          <div className="flex items-center gap-0.5 rounded-full border border-white/12 bg-black/35 p-1 shadow-[0_8px_28px_-12px_rgba(0,0,0,0.9)] backdrop-blur-xl">
            <button
              aria-label="上一部"
              onClick={() => go(-1)}
              className="flex h-7 w-7 items-center justify-center rounded-full text-white/60 transition duration-200 hover:bg-white/12 hover:text-gold active:scale-90"
            >
              <ChevronLeft size={15} strokeWidth={2.2} />
            </button>
            <span className="min-w-[42px] px-1 text-center text-[11px] tabular-nums leading-none">
              <span className="font-semibold text-white/90">{String(index + 1).padStart(2, '0')}</span>
              <span className="text-white/30"> / {String(total).padStart(2, '0')}</span>
            </span>
            <button
              aria-label="下一部"
              onClick={() => go(1)}
              className="flex h-7 w-7 items-center justify-center rounded-full text-white/60 transition duration-200 hover:bg-white/12 hover:text-gold active:scale-90"
            >
              <ChevronRight size={15} strokeWidth={2.2} />
            </button>
          </div>
        </div>
      </div>
    </section>
  )
}

/** 鼠标聚光：一层很淡的径向光，让玻璃边缘高光跟着“扫过” */
function Spotlight() {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    let raf = 0
    let x = -999
    let y = -999
    const apply = () => {
      raf = 0
      const el = ref.current
      if (el) el.style.transform = `translate3d(${x - 320}px, ${y - 320}px, 0)`
    }
    const onMove = (e: MouseEvent) => {
      x = e.clientX
      y = e.clientY
      if (!raf) raf = requestAnimationFrame(apply)
    }
    const onLeave = (e: MouseEvent) => {
      // 只有真的离开窗口才隐藏；元素间移动也会触发 mouseout
      if (e.relatedTarget) return
      x = -999
      y = -999
      if (!raf) raf = requestAnimationFrame(apply)
    }
    window.addEventListener('mousemove', onMove, { passive: true })
    window.addEventListener('mouseout', onLeave)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseout', onLeave)
      if (raf) cancelAnimationFrame(raf)
    }
  }, [])

  return (
    <div
      ref={ref}
      aria-hidden="true"
      className="pointer-events-none fixed left-0 top-0 z-[1] h-[640px] w-[640px] rounded-full opacity-[0.05] will-change-transform"
      style={{
        background: 'radial-gradient(circle, hsl(var(--li-h1) 92% 72%) 0%, transparent 62%)',
      }}
    />
  )
}

/** 区块标题：字号 / 字距 / 细分隔线，统一节奏 */
function RowHeader({ title, count, hint }: { title: string; count: number; hint: string }) {
  return (
    <div className="mb-4 flex items-baseline justify-between border-b border-white/6 px-10 pb-3">
      <div className="flex items-baseline gap-2.5">
        <h2 className="text-[17px] font-semibold tracking-[0.01em] text-fg">{title}</h2>
        <span className="text-[11px] tabular-nums text-muted/60">{count} 部</span>
      </div>
      <span className="text-[11px] text-muted/55">{hint}</span>
    </div>
  )
}

/** 榜单横向海报行：隐藏滚动条，hover 出翻页箭头，两端用遮罩渐隐 */
function RankingRow({ group, onOpen }: { group: TmdbGroup; onOpen: (name: string) => void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [canLeft, setCanLeft] = useState(false)
  const [canRight, setCanRight] = useState(false)

  const sync = useCallback(() => {
    const el = ref.current
    if (!el) return
    setCanLeft(el.scrollLeft > 4)
    setCanRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 4)
  }, [])

  useEffect(() => {
    sync()
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(sync)
    ro.observe(el)
    return () => ro.disconnect()
  }, [sync, group.items.length])

  const page = (dir: number) => {
    const el = ref.current
    if (!el) return
    el.scrollBy({ left: dir * el.clientWidth * 0.8, behavior: 'smooth' })
  }

  // 高分榜做「Top 10」描边序号，其余榜单保持干净
  const showRank = group.key === 'top_rated_movie' || group.key === 'top_rated_tv'

  return (
    <section className="animate-fade-up">
      <RowHeader
        title={group.label}
        count={group.items.length}
        hint={showRank ? 'Top 10 · 点海报搜可播线路' : '点海报跨站搜可播线路'}
      />
      <div className="group/row relative">
        <div
          ref={ref}
          onScroll={sync}
          className="row-mask no-scrollbar flex gap-3 overflow-x-auto px-10 pb-2"
        >
          {group.items.map((it, i) => (
            <MiniPoster
              key={`${it.mediaType}-${it.id}`}
              item={it}
              onClick={() => onOpen(it.title)}
              rank={showRank && i < 10 ? i + 1 : undefined}
            />
          ))}
        </div>

        {canLeft && (
          <button
            aria-label="向前翻"
            onClick={() => page(-1)}
            className="glass-btn absolute left-3 top-1/2 z-10 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full text-white/85 opacity-0 transition duration-200 hover:text-gold group-hover/row:opacity-100"
          >
            <ChevronLeft size={16} />
          </button>
        )}
        {canRight && (
          <button
            aria-label="向后翻"
            onClick={() => page(1)}
            className="glass-btn absolute right-3 top-1/2 z-10 flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full text-white/85 opacity-0 transition duration-200 hover:text-gold group-hover/row:opacity-100"
          >
            <ChevronRight size={16} />
          </button>
        )}
      </div>
    </section>
  )
}

/** 榜单小海报：悬停时上浮、放大并展开简介与入口 */
function MiniPoster({ item, onClick, rank }: { item: TmdbItem; onClick: () => void; rank?: number }) {
  return (
    <button
      onClick={onClick}
      title={`${item.title} · ${item.rating.toFixed(1)}`}
      className="glass-poster group relative h-[238px] w-[159px] shrink-0 overflow-hidden rounded-xl text-left outline-none transition duration-300 ease-out hover:z-10 hover:-translate-y-1.5 hover:scale-[1.03]"
    >
      <PosterArt item={item} />
      <div className="absolute inset-0 bg-gradient-to-t from-black/92 via-black/25 to-black/10" />
      <div className="glass-sheen" />
      <span className="absolute right-2 top-2 flex items-center gap-0.5 rounded bg-black/55 px-1.5 py-0.5 text-[10px] font-semibold text-gold backdrop-blur-sm">
        <Star size={9} fill="currentColor" /> {item.rating.toFixed(1)}
      </span>

      {rank != null && (
        <span
          className="pointer-events-none absolute -left-0.5 top-0 select-none text-[46px] font-black leading-none tracking-tighter drop-shadow-[0_4px_16px_rgba(0,0,0,0.65)]"
          style={{ WebkitTextStroke: '1.5px rgba(255,255,255,0.5)', color: 'transparent' }}
        >
          {String(rank).padStart(2, '0')}
        </span>
      )}

      <div className="absolute inset-x-0 bottom-0 p-2.5">
        <div className="line-clamp-2 text-[12.5px] font-semibold leading-snug text-white drop-shadow">
          {item.title}
        </div>
        <div className="mt-0.5 text-[10px] text-white/55">
          {item.year}
          {item.year ? ' · ' : ''}
          {item.mediaType === 'tv' ? '剧集' : '电影'}
        </div>
      </div>

      {/* 悬停浮层：标题 + 简介 + 入口，盖住底栏，避免撑高卡片 */}
      <div className="pointer-events-none absolute inset-0 flex flex-col justify-end bg-gradient-to-t from-black/95 via-black/70 to-transparent p-3 opacity-0 transition-opacity duration-300 group-hover:opacity-100">
        <div className="line-clamp-2 text-[13px] font-semibold leading-snug text-white">{item.title}</div>
        <div className="mt-1 flex items-center gap-1.5 text-[10px] text-white/55">
          {item.year && <span>{item.year}</span>}
          <span>{item.mediaType === 'tv' ? '剧集' : '电影'}</span>
          {item.rating > 0 && (
            <span className="flex items-center gap-0.5 text-gold/90">
              <Star size={8} fill="currentColor" /> {item.rating.toFixed(1)}
            </span>
          )}
        </div>
        <p className="mt-1.5 line-clamp-3 text-[10.5px] leading-relaxed text-white/65">
          {item.overview || '暂无简介'}
        </p>
        <span className="mt-2 flex items-center gap-1 text-[10.5px] font-medium text-gold">
          <Search size={10} /> 找可播线路
        </span>
      </div>
    </button>
  )
}

/** TMDB 海报图，加载失败回退渐变占位 */
function PosterArt({ item }: { item: TmdbItem }) {
  const [broken, setBroken] = useState(false)
  if (!item.poster || broken) {
    const hue = (item.title.charCodeAt(0) * 37 + (item.title.charCodeAt(1) || 11) * 13) % 360
    return (
      <div
        className="absolute inset-0"
        style={{
          background: `linear-gradient(155deg, hsl(${hue} 55% 24%) 0%, hsl(${(hue + 32) % 360} 44% 11%) 60%, #0b0b0f 100%)`,
        }}
      />
    )
  }
  return (
    <img
      src={item.poster}
      alt=""
      loading="lazy"
      referrerPolicy="no-referrer"
      onError={() => setBroken(true)}
      className="absolute inset-0 h-full w-full object-cover"
    />
  )
}

/** 首页「继续观看」：16:9 横版大卡，显示剩余时长 */
function ContinueRow() {
  const list = usePlayback()
  const navigate = useNavigate()
  const items = [...list].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, 10)
  if (items.length === 0) return null
  return (
    <section className="animate-fade-up mb-10">
      <RowHeader title="继续观看" count={items.length} hint="接着上次看到的位置播" />
      <div className="no-scrollbar flex gap-3.5 overflow-x-auto px-10 pb-2">
        {items.map((e) => {
          const pct = e.duration > 0 ? Math.min(100, Math.round((e.position / e.duration) * 100)) : 0
          const leftMin = e.duration > 0 ? Math.max(1, Math.round((e.duration - e.position) / 60)) : 0
          const hue = (e.name.charCodeAt(0) * 37 + (e.name.charCodeAt(1) || 11) * 13) % 360
          return (
            <div key={e.key} className="group relative w-[272px] shrink-0">
              <button
                onClick={() =>
                  navigate(
                    `/cat/item?site=${encodeURIComponent(e.siteKey)}&id=${encodeURIComponent(e.vodId)}&resume=1`,
                  )
                }
                className="block w-full text-left"
              >
                <div className="glass-poster relative aspect-video overflow-hidden rounded-xl">
                  {e.pic ? (
                    <img
                      src={e.pic}
                      alt=""
                      referrerPolicy="no-referrer"
                      loading="lazy"
                      className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.05]"
                    />
                  ) : (
                    <div
                      className="flex h-full w-full items-center justify-center px-3 text-center text-[13px] text-white/50"
                      style={{
                        background: `linear-gradient(155deg, hsl(${hue} 55% 24%) 0%, hsl(${(hue + 32) % 360} 44% 11%) 60%, #0b0b0f 100%)`,
                      }}
                    >
                      {e.name.slice(0, 8)}
                    </div>
                  )}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/10 to-transparent" />
                  <div className="glass-sheen" />

                  <div className="absolute inset-x-0 bottom-0 px-3 pb-2.5">
                    <div className="mb-1.5 flex items-center justify-between text-[10px] text-white/65">
                      <span className="truncate pr-2">{e.epName}</span>
                      <span className="shrink-0 tabular-nums">
                        {leftMin > 0 ? `还剩 ${leftMin} 分钟` : '快看完了'}
                      </span>
                    </div>
                    <div className="h-[3px] overflow-hidden rounded-full bg-white/20">
                      <div className="h-full rounded-full bg-gold" style={{ width: `${pct}%` }} />
                    </div>
                  </div>

                  <span className="glass-primary absolute right-2.5 top-2.5 flex h-8 w-8 items-center justify-center rounded-full opacity-0 transition group-hover:opacity-100">
                    <Play size={13} fill="currentColor" />
                  </span>
                </div>
                <p className="mt-2 truncate text-[12.5px] text-fg/90">{e.name}</p>
                <p className="mt-0.5 truncate text-[10.5px] text-muted">
                  {e.siteName} · {fmtTime(e.position)}
                  {e.duration > 0 ? ` / ${fmtTime(e.duration)}` : ''}
                </p>
              </button>
              <button
                onClick={() => removePlayback(e.key)}
                title="从继续观看移除"
                className="absolute right-1.5 top-1.5 hidden h-6 w-6 items-center justify-center rounded-full bg-black/70 text-[13px] text-white/70 hover:text-red-300 group-hover:flex"
              >
                ×
              </button>
            </div>
          )
        })}
      </div>
    </section>
  )
}

/** 首屏骨架：海报形状占位 + 扫光，避免加载时闪白跳版 */
function SkeletonHome() {
  return (
    <div className="px-10">
      <div className="skeleton h-[430px] w-full rounded-3xl" />
      <div className="mt-10 space-y-9">
        {[0, 1].map((r) => (
          <div key={r}>
            <div className="skeleton mb-4 h-4 w-44 rounded" />
            <div className="flex gap-3 overflow-hidden">
              {Array.from({ length: 7 }).map((_, i) => (
                <div key={i} className="skeleton h-[238px] w-[159px] shrink-0 rounded-xl" />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

export default function HomePage() {
  const navigate = useNavigate()
  const [groups, setGroups] = useState<TmdbGroup[] | null>(null)
  const [live, setLive] = useState(false)
  const [loading, setLoading] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [updatedAt, setUpdatedAt] = useState<number | null>(null)
  const [stale, setStale] = useState(false)
  const hasDataRef = useRef(false)

  const apply = useCallback((data: TmdbRankings) => {
    if (!data.groups.length) throw new Error('没有拿到任何影视榜单')
    setGroups(data.groups)
    setLive(data.live)
    setUpdatedAt(data.updatedAt ?? null)
    setStale(!!data.stale)
    hasDataRef.current = true
  }, [])

  const load = useCallback(
    async (force = false) => {
      // 有缓存时不闪骨架，仅在真加载时显示
      let timer: number | undefined
      if (force || !hasDataRef.current) {
        timer = window.setTimeout(() => setLoading(true), 140)
      }
      setErr(null)
      try {
        apply(await tmdbRankings({ force }))
      } catch (e) {
        setErr(e instanceof Error ? e.message : String(e))
      } finally {
        if (timer) window.clearTimeout(timer)
        setLoading(false)
      }
    },
    [apply],
  )

  useEffect(() => {
    void load()
  }, [load])

  useEffect(
    () =>
      onRankingsRefresh((data) => {
        try {
          apply(data)
        } catch {
          /* 空榜单忽略 */
        }
      }),
    [apply],
  )

  const searchFor = (name: string) => navigate(`/cat/search?name=${encodeURIComponent(name)}`)

  const heroItems = useMemo(() => pickHeroItems(groups ?? []), [groups])
  const totalCount = useMemo(
    () => new Set((groups ?? []).flatMap((g) => g.items).map((x) => x.mediaType + x.id)).size,
    [groups],
  )

  return (
    <div className="pb-16">
      <Spotlight />
      {err && !groups && (
        <section className="glass-panel mx-10 mb-6 mt-6 rounded-2xl p-6">
          <div className="flex items-center gap-2 text-[13px] font-medium">
            <AlertCircle size={15} className="text-amber-300" />
            影视榜单加载失败
          </div>
          <p className="mt-2 text-[12px] leading-relaxed text-muted">{err}</p>
          <button
            onClick={() => void load(true)}
            className="glass-primary mt-4 flex items-center gap-1.5 rounded-lg px-4 py-2 text-[12.5px] font-semibold"
          >
            重试
          </button>
        </section>
      )}

      {loading && !groups ? (
        <div className="pt-1">
          <SkeletonHome />
        </div>
      ) : (
        <>
          <div className="pt-1">
            <Hero
              items={heroItems}
              onOpen={searchFor}
              onRefresh={() => void load(true)}
              loading={loading}
              live={live}
              totalCount={totalCount}
              updatedAt={updatedAt}
              stale={stale}
            />
          </div>

          <ContinueRow />

          <div className="space-y-10">
            {(groups ?? [])
              .filter((g) => g.items.length > 0)
              .map((g) => (
                <RankingRow key={g.key} group={g} onOpen={searchFor} />
              ))}

          </div>
        </>
      )}
    </div>
  )
}