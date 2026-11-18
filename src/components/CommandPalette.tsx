/**
 * ⌘K 全局搜索：本地片库 / 直播频道 / 最近观看 / 最近搜索，一个浮层搞定。
 * 跨站影视搜索交给 CAT（回车或最后一行跳过去）。
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  ArrowRight,
  Clapperboard,
  Clock,
  CornerDownLeft,
  Film,
  Search,
  Settings2,
  Sparkles,
  Tv,
} from 'lucide-react'
import { useCatalog } from '../lib/catalog'
import { useLibrary } from '../lib/store'
import type { MediaItem } from '../lib/types'

const RECENT_KEY = 'miralite.recentQueries.v1'

function loadRecent(): string[] {
  try {
    const raw = localStorage.getItem(RECENT_KEY)
    const list = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(list) ? list.filter((x): x is string => typeof x === 'string').slice(0, 8) : []
  } catch {
    return []
  }
}

function pushRecent(q: string): string[] {
  const text = q.trim()
  if (!text) return loadRecent()
  const next = [text, ...loadRecent().filter((x) => x.toLowerCase() !== text.toLowerCase())].slice(0, 8)
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(next))
  } catch {
    /* 存不了就只影响最近列表 */
  }
  return next
}

interface Row {
  key: string
  title: string
  sub?: string
  icon: ReactNode
  run: () => void
}

export default function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const navigate = useNavigate()
  const catalog = useCatalog()
  const { channels, channelRecent } = useLibrary()
  const [q, setQ] = useState('')
  const [sel, setSel] = useState(0)
  const [recent, setRecent] = useState<string[]>(() => loadRecent())
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    if (!open) return
    setQ('')
    setSel(0)
    setRecent(loadRecent())
    const t = window.setTimeout(() => inputRef.current?.focus(), 30)
    return () => window.clearTimeout(t)
  }, [open])

  const go = (fn: () => void) => {
    onClose()
    fn()
  }

  const rows: Row[] = (() => {
    const query = q.trim().toLowerCase()
    const list: Row[] = []

    if (!query) {
      const recentChannels = channelRecent
        .map((id) => channels.find((c) => c.id === id))
        .filter((c): c is MediaItem => !!c)
        .slice(0, 4)
      for (const c of recentChannels) {
        list.push({
          key: `recent-${c.id}`,
          title: c.title,
          sub: '最近观看的频道',
          icon: <Tv size={15} className="text-gold/80" />,
          run: () => go(() => navigate(`/play/${c.id}`)),
        })
      }
      for (const r of recent.slice(0, 4)) {
        list.push({
          key: `rq-${r}`,
          title: r,
          sub: '最近搜索',
          icon: <Clock size={15} className="text-muted" />,
          run: () => setQ(r),
        })
      }
      list.push(
        {
          key: 'go-live',
          title: '打开直播',
          sub: '频道墙与节目单',
          icon: <Tv size={15} className="text-white/70" />,
          run: () => go(() => navigate('/live')),
        },
        {
          key: 'go-chase',
          title: '打开追剧',
          sub: '继续追的剧集',
          icon: <Clapperboard size={15} className="text-white/70" />,
          run: () => go(() => navigate('/chase')),
        },
        {
          key: 'go-library',
          title: '打开片库',
          sub: 'Xtream 点播电影与剧集',
          icon: <Film size={15} className="text-white/70" />,
          run: () => go(() => navigate('/library')),
        },
        {
          key: 'go-glass',
          title: '液态玻璃展示',
          sub: '材质、组件与光晕实验室',
          icon: <Sparkles size={15} className="text-white/70" />,
          run: () => go(() => navigate('/glass')),
        },
        {
          key: 'go-settings',
          title: '打开设置',
          sub: '片源、备份与播放偏好',
          icon: <Settings2 size={15} className="text-white/70" />,
          run: () => go(() => navigate('/settings')),
        },
      )
      return list
    }

    for (const c of channels.filter((x) => x.title.toLowerCase().includes(query)).slice(0, 6)) {
      list.push({
        key: `ch-${c.id}`,
        title: c.title,
        sub: c.group || '直播频道',
        icon: <Tv size={15} className="text-gold/80" />,
        run: () => go(() => navigate(`/play/${c.id}`)),
      })
    }

    const library = [...catalog.movies, ...catalog.series].filter(
      (x) => x.kind !== 'channel' && x.title.toLowerCase().includes(query),
    )
    for (const m of library.slice(0, 6)) {
      list.push({
        key: `lib-${m.id}`,
        title: m.title,
        sub: m.kind === 'series' ? '剧集 · 本地片库' : '电影 · 本地片库',
        icon: <Film size={15} className="text-white/70" />,
        run: () => go(() => navigate(`/item/${m.id}`)),
      })
    }

    list.push({
      key: 'cat-search',
      title: `跨站搜索「${q.trim()}」`,
      sub: '在 CAT 聚合站点里找可播线路',
      icon: <Search size={15} className="text-gold" />,
      run: () => {
        pushRecent(q)
        go(() => navigate(`/cat/search?name=${encodeURIComponent(q.trim())}`))
      },
    })
    return list
  })()

  useEffect(() => {
    setSel(0)
  }, [q])

  if (!open) return null

  const runRow = (row?: Row) => {
    if (!row) return
    if (q.trim() && row.key === 'cat-search') {
      pushRecent(q)
      setRecent(loadRecent())
    }
    row.run()
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center px-6 pt-[16vh]" role="dialog" aria-modal="true">
      <button aria-label="关闭搜索" onClick={onClose} className="absolute inset-0 bg-black/55 backdrop-blur-[3px]" />
      <div className="glass-panel relative z-10 w-full max-w-[620px] overflow-hidden rounded-2xl shadow-[0_40px_120px_-40px_rgba(0,0,0,0.95)]">
        <div className="flex items-center gap-2.5 border-b border-white/10 px-4 py-3">
          <Search size={15} className="shrink-0 text-muted" />
          <input
            ref={inputRef}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'ArrowDown') {
                e.preventDefault()
                setSel((i) => (rows.length ? (i + 1) % rows.length : 0))
              } else if (e.key === 'ArrowUp') {
                e.preventDefault()
                setSel((i) => (rows.length ? (i - 1 + rows.length) % rows.length : 0))
              } else if (e.key === 'Enter') {
                e.preventDefault()
                runRow(rows[sel])
              } else if (e.key === 'Escape') {
                e.preventDefault()
                onClose()
              }
            }}
            placeholder="搜频道、片名，或回车跨站搜索…"
            className="h-7 flex-1 bg-transparent text-[13px] text-fg outline-none placeholder:text-muted/60"
          />
          <span className="rounded border border-white/12 px-1.5 py-0.5 text-[9.5px] text-muted/60">ESC</span>
        </div>

        <div className="no-scrollbar max-h-[46vh] overflow-y-auto p-1.5">
          {rows.length === 0 && (
            <div className="px-3 py-8 text-center text-[12px] text-muted">没有匹配结果，换个关键词试试</div>
          )}
          {rows.map((row, i) => (
            <button
              key={row.key}
              onMouseEnter={() => setSel(i)}
              onClick={() => runRow(row)}
              className={`flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left transition ${
                i === sel ? 'bg-white/10' : 'hover:bg-white/6'
              }`}
            >
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-white/6">
                {row.icon}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px] text-fg/90">{row.title}</span>
                {row.sub && <span className="mt-0.5 block truncate text-[10.5px] text-muted">{row.sub}</span>}
              </span>
              {i === sel ? (
                <CornerDownLeft size={13} className="shrink-0 text-gold/80" />
              ) : (
                <ArrowRight size={13} className="shrink-0 text-white/15" />
              )}
            </button>
          ))}
        </div>

        <div className="flex items-center justify-between border-t border-white/8 px-4 py-2 text-[10px] text-muted/60">
          <span>↑ ↓ 选择 · Enter 打开 · Esc 关闭</span>
          <span>⌘K 随时唤出</span>
        </div>
      </div>
    </div>
  )
}