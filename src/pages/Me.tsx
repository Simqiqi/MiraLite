/**
 * 「我的」页：收藏与历史。
 *
 * 收藏 = 影视片单 + 收藏的直播频道；历史 = 继续观看（CAT 带进度）+ 最近看过的频道。
 * 数据分别来自 store.watchlist / channelFavorites、playback 与 channelRecent，纯前端聚合。
 */
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { History, Play, Star, Trash2, Tv, X } from 'lucide-react'
import Poster from '../components/Poster'
import { useCatalog } from '../lib/catalog'
import { actions, useLibrary } from '../lib/store'
import { clearPlayback, fmtTime, removePlayback, usePlayback } from '../lib/playback'
import type { MediaItem } from '../lib/types'

function ChannelLogo({ item, size = 38 }: { item: MediaItem; size?: number }) {
  const [broken, setBroken] = useState(false)
  if (item.logo && !broken) {
    return (
      <img
        src={item.logo}
        alt=""
        loading="lazy"
        referrerPolicy="no-referrer"
        onError={() => setBroken(true)}
        className="shrink-0 rounded-lg object-contain"
        style={{ width: size, height: size, background: 'rgba(255,255,255,0.06)' }}
      />
    )
  }
  const initials = item.title.replace(/\s+/g, '').slice(0, 2) || 'TV'
  return (
    <div
      className="flex shrink-0 items-center justify-center rounded-lg text-[12px] font-semibold"
      style={{
        width: size,
        height: size,
        background: `linear-gradient(150deg, hsl(${item.hue} 58% 26%), hsl(${(item.hue + 26) % 360} 40% 12%))`,
        color: `hsl(${item.hue} 82% 78%)`,
      }}
    >
      {initials}
    </div>
  )
}

function Empty({ title, desc, action }: { title: string; desc: string; action?: React.ReactNode }) {
  return (
    <div className="glass-panel rounded-2xl px-6 py-12 text-center">
      <p className="text-[13px] text-fg/85">{title}</p>
      <p className="mx-auto mt-1.5 max-w-[380px] text-[11.5px] leading-relaxed text-muted">{desc}</p>
      {action}
    </div>
  )
}

export default function MePage() {
  const navigate = useNavigate()
  const catalog = useCatalog()
  const { watchlist, channels, channelFavorites, channelRecent } = useLibrary()
  const playback = usePlayback()
  const [tab, setTab] = useState<'fav' | 'history'>('fav')

  const favItems = useMemo(
    () => watchlist.map((id) => catalog.byId[id]).filter((x): x is MediaItem => !!x),
    [watchlist, catalog.byId],
  )
  const favChannels = useMemo(
    () => channels.filter((c) => channelFavorites.includes(c.id)),
    [channels, channelFavorites],
  )
  const history = useMemo(
    () => [...playback].sort((a, b) => b.updatedAt - a.updatedAt),
    [playback],
  )
  const recentChannels = useMemo(
    () =>
      channelRecent
        .map((id) => channels.find((c) => c.id === id))
        .filter((c): c is MediaItem => !!c),
    [channelRecent, channels],
  )

  return (
    <div className="px-10 pb-16 pt-7">
      <div className="mb-5 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-[22px] font-semibold tracking-tight">我的</h1>
          <p className="mt-1 text-[12px] text-muted">
            {favItems.length + favChannels.length} 项收藏 · {history.length} 条观看记录
          </p>
        </div>
        <div className="glass-inset flex rounded-lg p-0.5 text-[11.5px]">
          {(
            [
              ['fav', '收藏'],
              ['history', '历史'],
            ] as const
          ).map(([v, label]) => (
            <button
              key={v}
              onClick={() => setTab(v)}
              className={`rounded-md px-3 py-1.5 transition ${
                tab === v ? 'bg-white/12 text-gold' : 'text-muted hover:text-fg/80'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {tab === 'fav' && (
        <div className="space-y-8">
          <section>
            <div className="mb-3 flex items-baseline gap-2.5">
              <h2 className="text-[15px] font-semibold tracking-tight">片单</h2>
              <span className="text-[11px] text-muted/70">{favItems.length} 部</span>
            </div>
            {favItems.length === 0 ? (
              <Empty
                title="片单还是空的"
                desc="在影视详情页点右上角的星标，收藏的片子会出现在这里。"
                action={
                  <button
                    onClick={() => navigate('/')}
                    className="glass-btn mt-4 rounded-lg px-4 py-2 text-[12px] text-fg/80 hover:text-gold"
                  >
                    去首页逛逛
                  </button>
                }
              />
            ) : (
              <div className="flex flex-wrap gap-3.5">
                {favItems.map((item) => (
                  <div key={item.id} className="group relative">
                    <Poster item={item} width={158} onOpen={() => navigate(`/item/${item.id}`)} />
                    <button
                      onClick={() => actions.toggleWatchlist(item.id)}
                      title="取消收藏"
                      className="absolute right-1.5 top-1.5 hidden h-6 w-6 items-center justify-center rounded-full bg-black/70 text-white/70 transition hover:text-red-300 group-hover:flex"
                    >
                      <X size={12} />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>

          <section>
            <div className="mb-3 flex items-baseline gap-2.5">
              <h2 className="text-[15px] font-semibold tracking-tight">收藏频道</h2>
              <span className="text-[11px] text-muted/70">{favChannels.length} 个</span>
            </div>
            {favChannels.length === 0 ? (
              <Empty
                title="还没有收藏频道"
                desc="在直播页把鼠标移到频道卡片上，点右下角的小星星即可收藏，收藏的频道会排到频道墙最前面。"
                action={
                  <button
                    onClick={() => navigate('/live')}
                    className="glass-btn mt-4 rounded-lg px-4 py-2 text-[12px] text-fg/80 hover:text-gold"
                  >
                    去直播页
                  </button>
                }
              />
            ) : (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
                {favChannels.map((c) => (
                  <div
                    key={c.id}
                    className="glass-panel group flex items-center gap-3 rounded-2xl p-3"
                  >
                    <button
                      onClick={() => {
                        actions.markChannelPlayed(c.id)
                        navigate(`/play/${c.id}`)
                      }}
                      className="flex min-w-0 flex-1 items-center gap-3 text-left"
                    >
                      <ChannelLogo item={c} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12.5px] text-fg/90">{c.title}</span>
                        <span className="mt-0.5 block truncate text-[10.5px] text-muted">
                          {c.group || '直播频道'}
                        </span>
                      </span>
                      <Play size={13} className="shrink-0 text-muted/40 group-hover:text-gold" />
                    </button>
                    <button
                      onClick={() => actions.toggleChannelFavorite(c.id)}
                      title="取消收藏"
                      className="shrink-0 text-gold/80 transition hover:text-red-300"
                    >
                      <Star size={13} fill="currentColor" />
                    </button>
                  </div>
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {tab === 'history' && (
        <div className="space-y-8">
          <section>
            <div className="mb-3 flex items-center justify-between">
              <div className="flex items-baseline gap-2.5">
                <h2 className="text-[15px] font-semibold tracking-tight">继续观看</h2>
                <span className="text-[11px] text-muted/70">{history.length} 条</span>
              </div>
              {history.length > 0 && (
                <button
                  onClick={() => {
                    if (window.confirm('清空所有观看进度？')) clearPlayback()
                  }}
                  className="glass-btn flex items-center gap-1 rounded-lg px-2.5 py-1 text-[11px] text-muted hover:text-red-300"
                >
                  <Trash2 size={11} /> 清空
                </button>
              )}
            </div>
            {history.length === 0 ? (
              <Empty title="还没有观看记录" desc="在 CAT 站点播放影视后会自动记录看到第几集、第几分钟，方便下次接着看。" />
            ) : (
              <div className="flex flex-wrap gap-3.5">
                {history.map((e) => {
                  const pct = e.duration > 0 ? Math.min(100, Math.round((e.position / e.duration) * 100)) : 0
                  const hue = (e.name.charCodeAt(0) * 37 + (e.name.charCodeAt(1) || 11) * 13) % 360
                  return (
                    <div key={e.key} className="group relative w-[152px]">
                      <button
                        onClick={() =>
                          navigate(
                            `/cat/item?site=${encodeURIComponent(e.siteKey)}&id=${encodeURIComponent(e.vodId)}&resume=1`,
                          )
                        }
                        className="block w-full text-left"
                      >
                        <div className="glass-poster relative h-[214px] overflow-hidden rounded-xl">
                          {e.pic ? (
                            <img
                              src={e.pic}
                              alt=""
                              referrerPolicy="no-referrer"
                              loading="lazy"
                              className="h-full w-full object-cover transition group-hover:scale-[1.04]"
                            />
                          ) : (
                            <div
                              className="flex h-full w-full items-center justify-center px-2 text-center text-[13px] text-white/50"
                              style={{
                                background: `linear-gradient(155deg, hsl(${hue} 55% 24%) 0%, hsl(${(hue + 32) % 360} 44% 11%) 60%, #0b0b0f 100%)`,
                              }}
                            >
                              {e.name.slice(0, 6)}
                            </div>
                          )}
                          <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/45 to-transparent px-2 pb-1.5 pt-6">
                            <div className="h-[3px] overflow-hidden rounded-full bg-white/25">
                              <div className="h-full rounded-full bg-gold" style={{ width: `${pct}%` }} />
                            </div>
                            <p className="mt-1 truncate text-[10px] text-white/70">
                              {e.epName} · {fmtTime(e.position)}
                              {e.duration > 0 ? ` / ${fmtTime(e.duration)}` : ''}
                            </p>
                          </div>
                        </div>
                        <p className="mt-2 truncate text-[12px] text-fg/90">{e.name}</p>
                        <p className="mt-0.5 truncate text-[10.5px] text-muted">{e.siteName}</p>
                      </button>
                      <button
                        onClick={() => removePlayback(e.key)}
                        title="从历史移除"
                        className="absolute right-1 top-1 hidden h-6 w-6 items-center justify-center rounded-full bg-black/65 text-white/70 hover:text-red-300 group-hover:flex"
                      >
                        <X size={12} />
                      </button>
                    </div>
                  )
                })}
              </div>
            )}
          </section>

          <section>
            <div className="mb-3 flex items-baseline gap-2.5">
              <h2 className="text-[15px] font-semibold tracking-tight">最近看过的频道</h2>
              <span className="text-[11px] text-muted/70">{recentChannels.length} 个</span>
            </div>
            {recentChannels.length === 0 ? (
              <Empty title="还没有看直播" desc="在直播页打开任意频道，最近看过的会出现在这里，最多保留 8 个。" />
            ) : (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-3">
                {recentChannels.map((c) => (
                  <button
                    key={c.id}
                    onClick={() => {
                      actions.markChannelPlayed(c.id)
                      navigate(`/play/${c.id}`)
                    }}
                    className="glass-panel group flex items-center gap-3 rounded-2xl p-3 text-left"
                  >
                    <ChannelLogo item={c} />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] text-fg/90">{c.title}</span>
                      <span className="mt-0.5 flex items-center gap-1 text-[10.5px] text-muted">
                        <History size={10} /> {c.group || '直播频道'}
                      </span>
                    </span>
                    <Play size={13} className="shrink-0 text-muted/40 group-hover:text-gold" />
                  </button>
                ))}
              </div>
            )}
          </section>
        </div>
      )}

      {favItems.length + favChannels.length === 0 && history.length === 0 && (
        <p className="mt-8 flex items-center gap-1.5 text-[11px] text-muted/60">
          <Tv size={11} /> 收藏与观看记录都只保存在本机，可在 设置 → 数据 里备份。
        </p>
      )}
    </div>
  )
}