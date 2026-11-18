import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import Hls from 'hls.js'
import {
  ArrowLeft,
  Captions,
  ChevronDown,
  ChevronUp,
  Maximize,
  Moon,
  Pause,
  PictureInPicture2,
  Play,
  RotateCcw,
  RotateCw,
  Volume2,
  VolumeX,
} from 'lucide-react'
import { useCatalog } from '../lib/catalog'
import { actions, useLibrary } from '../lib/store'
import { loadSubtitles, type SubtitleTrack } from '../lib/subtitles'
import { isDead } from '../lib/health'
import { normalizeBase } from '../lib/xtream'
import type { MediaItem } from '../lib/types'

const PIP_SUPPORTED =
  typeof document !== 'undefined' &&
  'pictureInPictureEnabled' in document &&
  (document as Document & { pictureInPictureEnabled: boolean }).pictureInPictureEnabled

function fmt(t: number): string {
  if (!Number.isFinite(t) || t < 0) return '00:00'
  const h = Math.floor(t / 3600)
  const m = Math.floor((t % 3600) / 60)
  const s = Math.floor(t % 60)
  const pad = (n: number) => String(n).padStart(2, '0')
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`
}

export default function PlayerPage() {
  const { id } = useParams()
  const navigate = useNavigate()
  const catalog = useCatalog()
  const [params] = useSearchParams()
  const { sources } = useLibrary()

  // 片库点播：以 query 形式带 sourceId + streamId，播放页用源凭据现场拼地址
  const remoteItem = useMemo<MediaItem | undefined>(() => {
    if (params.get('remote') !== '1') return undefined
    const source = sources.find((s) => s.id === params.get('source'))
    const streamId = Number(params.get('id') ?? 0)
    if (!source || !streamId) return undefined
    const mode = params.get('mode') === 'series' ? 'series' : 'movie'
    const ext = params.get('ext') || 'mp4'
    const base = normalizeBase(source.url)
    const name = params.get('name') || '点播'
    return {
      id: `remote-${mode}-${streamId}`,
      kind: 'movie',
      title: name,
      genres: [mode === 'series' ? '剧集' : '点播'],
      hue: (name.charCodeAt(0) * 37 + (name.charCodeAt(1) || 11) * 13) % 360,
      poster: params.get('poster') || undefined,
      streamUrl: `${base}/${mode}/${encodeURIComponent(source.username ?? '')}/${encodeURIComponent(
        source.password ?? '',
      )}/${streamId}.${ext}`,
    }
  }, [params, sources])

  const item = (id && id !== '_' ? catalog.byId[id] : undefined) ?? remoteItem
  const isLive = item?.kind === 'channel'
  const isRemote = item?.id.startsWith('remote-') ?? false

  const videoRef = useRef<HTMLVideoElement>(null)
  const wrapRef = useRef<HTMLDivElement>(null)
  const subUrlsRef = useRef<string[]>([])
  const [playing, setPlaying] = useState(false)
  const [muted, setMuted] = useState(false)
  const [current, setCurrent] = useState(0)
  const [duration, setDuration] = useState(0)
  const [hudVisible, setHudVisible] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [status, setStatus] = useState<string | null>(null)
  const [subTracks, setSubTracks] = useState<SubtitleTrack[]>([])
  const [subIndex, setSubIndex] = useState(-1)
  const [subMenu, setSubMenu] = useState(false)
  const [pipOn, setPipOn] = useState(false)
  const [sleepUntil, setSleepUntil] = useState<number | null>(null)
  const [sleepLeft, setSleepLeft] = useState(0)
  const [sleepMenu, setSleepMenu] = useState(false)

  /** 同源直播频道列表：用于 ↑↓ 快速换台（频道数量不大，直接算） */
  const channelList =
    isLive && item?.sourceId
      ? catalog.channels.filter((c) => c.kind === 'channel' && c.sourceId === item.sourceId)
      : []
  const channelPos = channelList.findIndex((c) => c.id === item?.id)

  const zap = useCallback(
    (step: number) => {
      if (!item?.sourceId) return
      const all = catalog.channels.filter(
        (c) => c.kind === 'channel' && c.sourceId === item.sourceId,
      )
      // 已知失效的频道自动跳过；全挂了就退回完整列表
      const alive = all.filter((c) => !isDead(c.id))
      const list = alive.length > 1 ? alive : all
      if (list.length < 2) return
      const pos = list.findIndex((c) => c.id === item.id)
      if (pos < 0 && list !== all) {
        const fallback = all.findIndex((c) => c.id === item.id)
        if (fallback < 0) return
        const next = all[(fallback + step + all.length) % all.length]
        navigate(`/play/${next.id}`, { replace: true })
        return
      }
      if (pos < 0) return
      const next = list[(pos + step + list.length) % list.length]
      navigate(`/play/${next.id}`, { replace: true })
    },
    [catalog.channels, item, navigate],
  )

  // 记一次最近观看
  useEffect(() => {
    if (item?.kind === 'channel') actions.markChannelPlayed(item.id)
  }, [item?.id, item?.kind])

  // ---- 播放：HLS 自适应 + 断流自动重连 ----
  useEffect(() => {
    const video = videoRef.current
    if (!video || !item?.streamUrl) return
    const src = item.streamUrl
    let hls: Hls | null = null
    let timer: number | undefined
    let attempts = 0
    let disposed = false
    const media = video
    setError(null)
    setStatus(null)

    /** 网络/解码错误后的退避重连；不同错误走不同恢复动作 */
    function retry(kind: 'load' | 'media' | 'source') {
      if (disposed) return
      if (attempts >= 6) {
        setStatus(null)
        setError('多次重连仍然失败，返回后换个频道或线路试试')
        return
      }
      attempts += 1
      setStatus(`信号中断，正在重连（${attempts}/6）…`)
      timer = window.setTimeout(() => {
        if (disposed) return
        try {
          if (hls) {
            if (kind === 'media') hls.recoverMediaError()
            else if (kind === 'load') hls.startLoad()
            else {
              hls.loadSource(src)
              hls.startLoad()
            }
          } else {
            media.src = src
            media.load()
            void media.play().catch(() => setPlaying(false))
          }
        } catch {
          /* 恢复动作本身失败时，下一轮继续 */
        }
      }, Math.min(1200 * attempts, 6000))
    }

    const onNativeError = () => {
      if (!hls) retry('source')
    }

    if (src.includes('.m3u8')) {
      if (Hls.isSupported()) {
        hls = new Hls({
          enableWorker: true,
          lowLatencyMode: !!isLive,
          backBufferLength: 60,
          // 直播断流时多给几次机会，别一掉线就黑屏
          manifestLoadingMaxRetry: 3,
          levelLoadingMaxRetry: 4,
          fragLoadingMaxRetry: 6,
        })
        hls.loadSource(src)
        hls.attachMedia(video)
        hls.on(Hls.Events.MANIFEST_PARSED, () => {
          attempts = 0
          setStatus(null)
          void video.play().catch(() => setPlaying(false))
        })
        hls.on(Hls.Events.ERROR, (_e, data) => {
          if (!data.fatal) return
          if (data.type === Hls.ErrorTypes.MEDIA_ERROR) retry('media')
          else if (data.type === Hls.ErrorTypes.NETWORK_ERROR) retry('load')
          else retry('source')
        })
      } else if (video.canPlayType('application/vnd.apple.mpegurl')) {
        video.src = src
        video.addEventListener('error', onNativeError)
      } else {
        setError('当前环境不支持 HLS 播放')
      }
    } else {
      video.src = src
      video.addEventListener('error', onNativeError)
    }

    void video.play().catch(() => setPlaying(false))

    return () => {
      disposed = true
      if (timer) window.clearTimeout(timer)
      video.removeEventListener('error', onNativeError)
      hls?.destroy()
      video.removeAttribute('src')
      video.load()
    }
  }, [item?.streamUrl, isLive])

  // ---- 本地同名字幕 ----
  useEffect(() => {
    const path = item?.filePath
    subUrlsRef.current.forEach((u) => URL.revokeObjectURL(u))
    subUrlsRef.current = []
    setSubTracks([])
    setSubIndex(-1)
    setSubMenu(false)
    if (!path) return
    let cancelled = false
    loadSubtitles(path)
      .then((list) => {
        if (cancelled) {
          list.forEach((t) => URL.revokeObjectURL(t.url))
          return
        }
        subUrlsRef.current = list.map((t) => t.url)
        setSubTracks(list)
        if (list.length > 0) setSubIndex(0)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [item?.filePath])

  useEffect(
    () => () => {
      subUrlsRef.current.forEach((u) => URL.revokeObjectURL(u))
      subUrlsRef.current = []
    },
    [],
  )

  // 字幕轨切换（track 元素要等元数据就绪才注册到 textTracks，所以监听一次再套用）
  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    const apply = () => {
      const tracks = v.textTracks
      for (let i = 0; i < tracks.length; i += 1) {
        tracks[i].mode = i === subIndex ? 'showing' : 'disabled'
      }
    }
    apply()
    v.addEventListener('loadedmetadata', apply)
    v.addEventListener('loadeddata', apply)
    return () => {
      v.removeEventListener('loadedmetadata', apply)
      v.removeEventListener('loadeddata', apply)
    }
  }, [subIndex, subTracks])

  // 进度记忆（直播不记）
  useEffect(() => {
    if (!item || isLive) return
    const timer = window.setInterval(() => {
      const v = videoRef.current
      if (!v || v.paused || !v.duration) return
      actions.setProgress(item.id, {
        position: v.currentTime,
        duration: v.duration,
        updatedAt: Date.now(),
      })
    }, 5000)
    return () => window.clearInterval(timer)
  }, [item, isLive, isRemote])

  // 键盘：直播 ↑↓ 换台，点播 ←→ 快进快退
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const v = videoRef.current
      if (!v) return
      const target = e.target as HTMLElement | null
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return

      if (isLive && (e.key === 'ArrowUp' || e.key === 'PageUp')) {
        e.preventDefault()
        zap(-1)
      } else if (isLive && (e.key === 'ArrowDown' || e.key === 'PageDown')) {
        e.preventDefault()
        zap(1)
      } else if (e.code === 'Space') {
        e.preventDefault()
        if (v.paused) void v.play()
        else v.pause()
      } else if (!isLive && e.key === 'ArrowLeft') {
        v.currentTime = Math.max(0, v.currentTime - 10)
      } else if (!isLive && e.key === 'ArrowRight') {
        v.currentTime = Math.min(v.duration || 0, v.currentTime + 10)
      } else if (e.key === 'Escape') {
        if (subMenu) setSubMenu(false)
        else navigate(-1)
      } else if (e.key.toLowerCase() === 'm') {
        v.muted = !v.muted
        setMuted(v.muted)
      } else if (e.key.toLowerCase() === 'c' && !isLive) {
        setSubIndex((idx) => (idx >= 0 ? -1 : subTracks.length > 0 ? 0 : -1))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate, isLive, zap, subMenu, subTracks.length])

  // 睡眠定时器
  useEffect(() => {
    if (!sleepUntil) {
      setSleepLeft(0)
      return
    }
    const tick = () => {
      const left = Math.max(0, Math.ceil((sleepUntil - Date.now()) / 1000))
      setSleepLeft(left)
      if (left <= 0) {
        const v = videoRef.current
        if (v && !v.paused) v.pause()
        setSleepUntil(null)
        setStatus('定时关闭时间到，已暂停播放')
        window.setTimeout(() => setStatus(null), 2600)
      }
    }
    tick()
    const timer = window.setInterval(tick, 1000)
    return () => window.clearInterval(timer)
  }, [sleepUntil])

  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    const onEnter = () => setPipOn(true)
    const onLeave = () => setPipOn(false)
    v.addEventListener('enterpictureinpicture', onEnter)
    v.addEventListener('leavepictureinpicture', onLeave)
    return () => {
      v.removeEventListener('enterpictureinpicture', onEnter)
      v.removeEventListener('leavepictureinpicture', onLeave)
    }
  }, [])

  useEffect(() => {
    if (!hudVisible) return
    const t = window.setTimeout(() => setHudVisible(false), 3200)
    return () => window.clearTimeout(t)
  }, [hudVisible])

  if (!item) {
    return (
      <div className="flex h-full items-center justify-center text-[13px] text-muted">
        找不到该条目
        <button onClick={() => navigate(-1)} className="ml-3 text-gold underline">
          返回
        </button>
      </div>
    )
  }

  const pct = duration > 0 ? (current / duration) * 100 : 0

  async function togglePip() {
    const v = videoRef.current
    if (!v) return
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture()
        setPipOn(false)
      } else if (document.pictureInPictureEnabled) {
        await v.requestPictureInPicture()
        setPipOn(true)
      }
    } catch {
      setStatus('当前视频不支持画中画')
      window.setTimeout(() => setStatus(null), 2000)
    }
  }

  return (
    <div
      ref={wrapRef}
      onMouseMove={() => setHudVisible(true)}
      className="relative flex h-full w-full items-center justify-center bg-black"
    >
      <video
        ref={videoRef}
        className="h-full w-full object-contain"
        playsInline
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onTimeUpdate={(e) => setCurrent(e.currentTarget.currentTime)}
        onLoadedMetadata={(e) => setDuration(e.currentTarget.duration)}
        onError={() => {
          if (!isLive) setError('无法加载该视频流，检查源是否可直连')
        }}
        onClick={() => {
          const v = videoRef.current
          if (!v) return
          if (v.paused) void v.play()
        else v.pause()
        }}
      >
        {subTracks.map((t, i) => (
          <track key={t.url} src={t.url} kind="subtitles" label={t.label} default={i === subIndex} />
        ))}
      </video>

      {status && (
        <div className="glass-tip absolute left-1/2 top-16 -translate-x-1/2 rounded-lg px-3 py-1.5 text-[11.5px] text-white/80">
          {status}
        </div>
      )}

      {error && (
        <div className="glass-warn absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 rounded-xl px-4 py-3 text-[12.5px] text-amber-200">
          {error}
        </div>
      )}

      <div
        className={`absolute inset-x-0 top-0 flex items-start justify-between bg-gradient-to-b from-black/85 to-transparent p-5 transition-opacity duration-300 ${
          hudVisible ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      >
        <button
          onClick={() => navigate(-1)}
          className="glass-btn flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] text-white/85"
        >
          <ArrowLeft size={14} /> 返回
        </button>
        <div className="text-right">
          <div className="text-[13.5px] font-medium text-white/90">{item.title}</div>
          <div className="mt-0.5 text-[11px] text-white/50">
            {item.year ? `${item.year} · ` : ''}
            {item.genres.join(' / ')}
            {isLive && channelPos >= 0 && channelList.length > 1
              ? ` · ${channelPos + 1}/${channelList.length}`
              : ''}
          </div>
        </div>
      </div>

      <div
        className={`absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/90 via-black/55 to-transparent px-6 pb-5 pt-10 transition-opacity duration-300 ${
          hudVisible ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      >
        {isLive ? (
          <div className="mb-2 flex items-center gap-2 text-[11px] text-white/45">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
            直播中
            {channelList.length > 1 && <span className="ml-1">· ↑ ↓ 换台</span>}
          </div>
        ) : (
          <div className="mb-2 flex items-center gap-2.5">
            <span className="w-11 text-right text-[10.5px] tabular-nums text-white/60">{fmt(current)}</span>
            <input
              type="range"
              min={0}
              max={duration || 0}
              step={0.1}
              value={current}
              onChange={(e) => {
                const v = videoRef.current
                if (!v) return
                v.currentTime = Number(e.target.value)
                setCurrent(Number(e.target.value))
              }}
              className="h-1 flex-1 cursor-pointer appearance-none rounded-full bg-white/20 accent-[#e8b44c]"
              style={{
                background: `linear-gradient(to right, #e8b44c ${pct}%, rgba(255,255,255,0.2) ${pct}%)`,
              }}
            />
            <span className="w-11 text-[10.5px] tabular-nums text-white/60">{fmt(duration)}</span>
          </div>
        )}

        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                const v = videoRef.current
                if (!v) return
                if (v.paused) void v.play()
        else v.pause()
              }}
              className="glass-btn flex h-9 w-9 items-center justify-center rounded-full text-white"
            >
              {playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" />}
            </button>

            {isLive ? (
              channelList.length > 1 && (
                <>
                  <button
                    onClick={() => zap(-1)}
                    title="上一个频道"
                    className="text-white/70 transition hover:text-white"
                  >
                    <ChevronUp size={16} />
                  </button>
                  <button
                    onClick={() => zap(1)}
                    title="下一个频道"
                    className="text-white/70 transition hover:text-white"
                  >
                    <ChevronDown size={16} />
                  </button>
                </>
              )
            ) : (
              <>
                <button
                  onClick={() => {
                    const v = videoRef.current
                    if (v) v.currentTime = Math.max(0, v.currentTime - 10)
                  }}
                  className="text-white/70 transition hover:text-white"
                >
                  <RotateCcw size={16} />
                </button>
                <button
                  onClick={() => {
                    const v = videoRef.current
                    if (v) v.currentTime = Math.min(v.duration || 0, v.currentTime + 10)
                  }}
                  className="text-white/70 transition hover:text-white"
                >
                  <RotateCw size={16} />
                </button>
              </>
            )}

            <button
              onClick={() => {
                const v = videoRef.current
                if (!v) return
                v.muted = !v.muted
                setMuted(v.muted)
              }}
              className="text-white/70 transition hover:text-white"
            >
              {muted ? <VolumeX size={16} /> : <Volume2 size={16} />}
            </button>

            <div className="relative">
              <button
                onClick={() => setSleepMenu((v) => !v)}
                title={sleepUntil ? `定时关闭：剩余 ${Math.floor(sleepLeft / 60)}:${String(sleepLeft % 60).padStart(2, '0')}` : '睡眠定时器'}
                className={`flex items-center gap-1 text-[11px] transition ${
                  sleepUntil ? 'text-gold' : 'text-white/70 hover:text-white'
                }`}
              >
                <Moon size={16} />
                {sleepUntil && (
                  <span className="tabular-nums">
                    {Math.floor(sleepLeft / 60)}:{String(sleepLeft % 60).padStart(2, '0')}
                  </span>
                )}
              </button>
              {sleepMenu && (
                <div className="glass-panel absolute bottom-9 left-1/2 z-20 w-[130px] -translate-x-1/2 rounded-xl p-1.5">
                  {[
                    [15, '15 分钟'],
                    [30, '30 分钟'],
                    [60, '60 分钟'],
                    [90, '90 分钟'],
                  ].map(([min, label]) => (
                    <button
                      key={min}
                      onClick={() => {
                        setSleepUntil(Date.now() + Number(min) * 60_000)
                        setSleepMenu(false)
                        setStatus(`已设置 ${label}后暂停`)
                        window.setTimeout(() => setStatus(null), 1800)
                      }}
                      className="w-full rounded-lg px-2.5 py-1.5 text-left text-[11.5px] text-white/80 hover:bg-white/8"
                    >
                      {label}
                    </button>
                  ))}
                  {sleepUntil && (
                    <button
                      onClick={() => {
                        setSleepUntil(null)
                        setSleepMenu(false)
                      }}
                      className="w-full rounded-lg px-2.5 py-1.5 text-left text-[11.5px] text-amber-300/90 hover:bg-white/8"
                    >
                      取消定时
                    </button>
                  )}
                </div>
              )}
            </div>

            {!isLive && (
              <div className="relative">
                <button
                  onClick={() => setSubMenu((v) => !v)}
                  title={subTracks.length ? '字幕' : '没有找到同名字幕'}
                  className={`transition ${
                    subIndex >= 0 ? 'text-gold' : subTracks.length ? 'text-white/70 hover:text-white' : 'text-white/25'
                  }`}
                >
                  <Captions size={16} />
                </button>
                {subMenu && subTracks.length > 0 && (
                  <div className="glass-panel absolute bottom-9 left-1/2 z-20 w-[210px] -translate-x-1/2 rounded-xl p-1.5">
                    <button
                      onClick={() => {
                        setSubIndex(-1)
                        setSubMenu(false)
                      }}
                      className={`w-full rounded-lg px-2.5 py-1.5 text-left text-[11.5px] hover:bg-white/8 ${
                        subIndex < 0 ? 'text-gold' : 'text-white/80'
                      }`}
                    >
                      关闭字幕
                    </button>
                    {subTracks.map((t, i) => (
                      <button
                        key={t.url}
                        onClick={() => {
                          setSubIndex(i)
                          setSubMenu(false)
                        }}
                        className={`w-full truncate rounded-lg px-2.5 py-1.5 text-left text-[11.5px] hover:bg-white/8 ${
                          i === subIndex ? 'text-gold' : 'text-white/80'
                        }`}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="flex items-center gap-3">
            {!isLive && PIP_SUPPORTED && (
              <button
                onClick={() => void togglePip()}
                title="画中画"
                className={`transition ${pipOn ? 'text-gold' : 'text-white/70 hover:text-white'}`}
              >
                <PictureInPicture2 size={16} />
              </button>
            )}
            <button
              onClick={() => {
                const el = wrapRef.current
                if (!el) return
                if (document.fullscreenElement) void document.exitFullscreen()
                else void el.requestFullscreen()
              }}
              className="text-white/70 transition hover:text-white"
            >
              <Maximize size={16} />
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}