import { NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { Clapperboard, Home, Library, Popcorn, Search, Settings2, Tv, UserRound } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import CommandPalette from './CommandPalette'
import { startReminderScheduler } from '../lib/reminders'

const navItems = [
  { to: '/', label: '首页', icon: Home },
  { to: '/chase', label: '追剧', icon: Clapperboard },
  { to: '/live', label: '直播', icon: Tv },
  { to: '/library', label: '片库', icon: Library },
  { to: '/short', label: '短剧', icon: Popcorn },
  { to: '/me', label: '我的', icon: UserRound },
]

export default function Shell() {
  const navigate = useNavigate()
  const location = useLocation()
  const section = useMemo(() => {
    const p = location.pathname
    if (p === '/') return '首页'
    if (p.startsWith('/chase')) return '追剧'
    if (p.startsWith('/live')) return '直播'
    if (p.startsWith('/library')) return '片库'
    if (p.startsWith('/me')) return '我的'
    if (p.startsWith('/glass')) return '液态玻璃'
    if (p.startsWith('/settings')) return '设置'
    if (p.startsWith('/play')) return '播放'
    if (p.startsWith('/cat/search') || p.startsWith('/search')) return '搜索'
    if (p.startsWith('/cat/item') || p.startsWith('/item')) return '影视详情'
    if (p.startsWith('/cat')) return '影视'
    return 'MiraLite'
  }, [location.pathname])

  const [query, setQuery] = useState('')
  const [paletteOpen, setPaletteOpen] = useState(false)
  const [barHidden, setBarHidden] = useState(false)
  const lastScroll = useRef(0)

  // 节目提醒轮询（只启动一次）
  useEffect(() => {
    startReminderScheduler()
  }, [])

  // ⌘K 唤出搜索；⌘1~⌘6 直接切页面
  useEffect(() => {
    const shortcuts = [...navItems.map((n) => n.to), '/settings']
    function onKey(e: KeyboardEvent) {
      if (!(e.metaKey || e.ctrlKey)) return
      const key = e.key.toLowerCase()
      if (key === 'k') {
        e.preventDefault()
        setPaletteOpen((v) => !v)
        return
      }
      const idx = Number(key) - 1
      if (Number.isInteger(idx) && idx >= 0 && idx < shortcuts.length) {
        e.preventDefault()
        navigate(shortcuts[idx])
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate])

  // 换页时顶栏复位、滚动基准归零
  useEffect(() => {
    setBarHidden(false)
    lastScroll.current = 0
  }, [location.pathname])

  function submitSearch(e: React.FormEvent) {
    e.preventDefault()
    const q = query.trim()
    if (!q) return
    navigate(`/search?q=${encodeURIComponent(q)}`)
  }

  // 内容向下滑 -> 顶栏上移隐藏；向上滑 / 回到顶部 -> 滑回。
  // 阈值过滤微小抖动，避免列表惯性滚动时来回跳。
  function onContentScroll(e: React.UIEvent<HTMLElement>) {
    const top = e.currentTarget.scrollTop
    const delta = top - lastScroll.current
    if (top <= 4) {
      setBarHidden(false)
    } else if (delta > 6) {
      setBarHidden(true)
    } else if (delta < -6) {
      setBarHidden(false)
    }
    lastScroll.current = top
  }

  return (
    <div className="grain relative isolate flex h-full w-full overflow-hidden text-fg">
      {/* 每次打开随机色相的环境光底层 */}
      <div className="liquid-bg" aria-hidden="true" />
      <div className="liquid-veil" aria-hidden="true" />
      <div className="liquid-shade" aria-hidden="true" />

      {/* 左侧：透明拖拽区避让 macOS 红绿灯，下方才是液态胶囊菜单 */}
      <aside className="relative z-10 flex w-[86px] shrink-0 flex-col py-3 pl-3">
        <div data-tauri-drag-region className="h-11 w-full shrink-0" aria-hidden="true" />
        <div className="glass-capsule flex min-h-0 flex-1 flex-col items-center gap-1 rounded-[26px] px-1.5 py-3">
          <div className="glass-logo mb-4 flex h-9 w-9 items-center justify-center rounded-xl text-[13px] font-bold text-gold">
            ML
          </div>
          {navItems.map(({ to, label, icon: Icon }) => (
            <NavLink
              key={to}
              to={to}
              end={to === '/'}
              className={({ isActive }) =>
                [
                  'glass-nav group flex w-[56px] flex-col items-center gap-1 rounded-xl py-2.5 text-[10.5px]',
                  isActive ? 'is-active' : '',
                ].join(' ')
              }
            >
              <Icon size={17} strokeWidth={1.8} />
              <span>{label}</span>
            </NavLink>
          ))}
          <div className="mt-auto flex flex-col items-center gap-1">
            <NavLink
              to="/settings"
              className={({ isActive }) =>
                [
                  'glass-nav flex w-[56px] flex-col items-center gap-1 rounded-xl py-2.5 text-[10.5px]',
                  isActive ? 'is-active' : '',
                ].join(' ')
              }
            >
              <Settings2 size={17} strokeWidth={1.8} />
              <span>设置</span>
            </NavLink>
          </div>
        </div>
      </aside>

      <div className="relative z-10 flex min-w-0 flex-1 flex-col py-3 pr-3">
        {/* 顶部液态胶囊状态栏：高度 + 位移组合动画，下滑时向上滑走且内容区上移填补 */}
        <div
          className={`shrink-0 overflow-hidden transition-all duration-300 ease-out ${
            barHidden
              ? 'max-h-0 -translate-y-4 opacity-0'
              : 'max-h-[60px] translate-y-0 opacity-100'
          }`}
        >
          <header className="glass-capsule flex h-[52px] items-center justify-between gap-4 rounded-[26px] px-5">
            {/* 左：字标 + 当前分区 */}
            <div data-tauri-drag-region className="flex min-w-0 items-center gap-3">
              <span className="font-serif text-[14px] font-semibold tracking-[0.02em] text-fg/90">
                MiraLite
              </span>
              <span className="h-3.5 w-px shrink-0 bg-white/12" aria-hidden="true" />
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="h-1 w-1 shrink-0 rounded-full bg-gold/80" aria-hidden="true" />
                <span className="truncate text-[10.5px] uppercase tracking-[0.18em] text-muted/80">
                  {section}
                </span>
              </span>
            </div>

            {/* 右：搜索胶囊 */}
            <form onSubmit={submitSearch} className="group relative shrink-0">
              <Search
                size={13}
                className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted transition group-focus-within:text-gold"
              />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="搜索片名、频道…"
                className="glass-input h-8 w-[252px] rounded-full pl-8 pr-14 text-[12px] text-fg transition"
              />
              <button
                type="button"
                onClick={() => setPaletteOpen(true)}
                title="全局搜索（⌘K）"
                className="absolute right-1 top-1/2 -translate-y-1/2 rounded-full bg-white/6 px-2 py-0.5 text-[9px] tracking-wider text-muted/70 transition hover:bg-gold/15 hover:text-gold"
              >
                ⌘K
              </button>
            </form>
          </header>
        </div>

        <main
          onScroll={onContentScroll}
          className="min-h-0 min-w-0 flex-1 overflow-y-auto overflow-x-hidden"
        >
          <Outlet />
        </main>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
    </div>
  )
}
