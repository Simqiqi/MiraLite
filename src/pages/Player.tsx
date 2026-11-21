import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'
import Hls from 'hls.js'
import {
  ArrowLeft,
  Captions,
  ChevronDown,
  ChevronUp,
  Maximize,
  MonitorPlay,
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
import { availablePlayers, openInPlayer, type PlayerOption } from '../lib/system'
import { advance, useQueue, type QueueItem } from '../lib/playQueue'
import { getMarkers, setIntroEnd, setOutroStart } from '../lib/skipMarkers'
import { orderedChannels } from '../lib/channelPrefs'
import { saveShortProgress } from '../lib/shortProgress'
import { fileToPlayUrl, sdPrepare } from '../lib/short'
import type { MediaItem } from '../lib/types'

/** 队列项 → 播放页地址（短剧要现场解密，单独处理） */
function routeFor(item: QueueItem): string | null {
  if (item.kind === 'path') return item.path
  if (item.kind === 'vod') {
    const params = new URLSearchParams({
      remote: '1',
      mode: 'movie',
      source: item.sourceId,
      id: String(item.streamId),
      ext: item.ext,
      name: item.name,
    })
    if (item.poster) params.set('poster', item.poster)
    return `/play/_?${params.toString()}`
  }
  return null
}

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
    const mode = params.get('mode') ?? 'movie'
    const name0 = params.get('name') || '点播'

    // 直链模式：短剧等外部来源直接给播放地址
    if (mode === 'url') {
      const raw = params.get('u') ?? ''
      if (!/^(https?|asset):\/\//.test(raw)) return undefined
      return {
        id: `remote-url-${raw.slice(-24)}`,
        kind: 'movie',
        title: name0,
        genres: ['短剧'],
        hue: (name0.charCodeAt(0) * 37 + (name0.charCodeAt(1) || 11) * 13) % 360,
        poster: params.get('poster') || undefined,
        streamUrl: raw,
      }
    }

    const source = sources.find((s) => s.id === params.get('source'))
    const streamId = Number(params.get('id') ?? 0)
    if (!source || !streamId) return undefined
    const ext = params.get('ext') || 'mp4'
    const base = normalizeBase(source.url)
    const name = params.get('name') || '点播'
    const user = encodeURIComponent(source.username ?? '')
    const pass = encodeURIComponent(source.password ?? '')

    let streamUrl: string
    if (mode === 'timeshift') {
      // 回看：/timeshift/{user}/{pass}/{时长(分)}/{YYYY-MM-DD:HH-mm}/{stream_id}.m3u8
      const start = params.get('start') || ''
      const dur = params.get('dur') || '60'
      streamUrl = `${base}/timeshift/${user}/${pass}/${dur}/${start}/${streamId}.m3u8`
    } else {
      const kindPath = mode === 'series' ? 'series' : 'movie'
      streamUrl = `${base}/${kindPath}/${user}/${pass}/${streamId}.${ext}`
    }

    return {
      id: `remote-${source.id}-${mode}-${streamId}`,
      kind: 'movie',
      title: name,
      genres: [mode === 'series' ? '剧集' : mode === 'timeshift' ? '回看' : '点播'],
      hue: (name.charCodeAt(0) * 37 + (name.charCodeAt(1) || 11) * 13) % 360,
      poster: params.get('poster') || undefined,
      streamUrl,
    }
  }, [params, sources])

  const item = (id && id !== '_' ? catalog.byId[id] : undefined) ?? remoteItem
  const isLive = item?.kind === 'channel'
  const shortSeries = params.get('series')
  const shortEp = Number(params.get('ep') ?? 0)
  /** 片头片尾标记的 key：短剧按剧集，其余按条目 */
  const markerKey = shortSeries ? `short:${shortSeries}#${shortEp}` : (item?.id ?? '')
  const [markers, setMarkers] = useState(() => (markerKey ? getMarkers(markerKey) : {}))
  const introSkippedRef = useRef(false)

  useEffect(() => {
    setMarkers(markerKey ? getMarkers(markerKey) : {})
    introSkippedRef.current = false
  }, [markerKey])

  const queue = useQueue()
  const nextItem = queue.items[queue.index + 1] ?? null
  const isTimeshift = item?.id.includes('-timeshift-') ?? false
  /** 片库点播（电影/剧集）记进度；回看与直播不记 */
  const trackProgress = !!item && !isLive && !isTimeshift

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
  const [players, setPlayers] = useState<PlayerOption[]>([])
  const [extMenu, setExtMenu] = useState(false)
  const [zapBuffer, setZapBuffer] = useState('')
  const zapRef = useRef('')
  const zapTimerRef = useRef<number | undefined>(undefined)

  /** 同源直播频道列表：按频道号排序，和直播页显示的编号一致 */
  const channelSeqList = useMemo(
    () =>
      isLive && item?.sourceId
        ? orderedChannels(catalog.channels.filter((c) => c.kind === 'channel' && c.sourceId === item.sourceId))
        : [],
    [catalog.channels, isLive, item?.sourceId],
  )
  const channelList = channelSeqList.map((x) => x.item)
  const channelPos = channelList.findIndex((c) => c.id === item?.id)

  // HUD：3 秒无操作自动隐藏；鼠标移动或按键都会重新计时
  const hudTimerRef = useRef<number | undefined>(undefined)
  const showHud = useCallback(() => {
    setHudVisible(true)
    if (hudTimerRef.current) window.clearTimeout(hudTimerRef.current)
    hudTimerRef.current = window.setTimeout(() => setHudVisible(false), 3000)
  }, [])

  useEffect(() => {
    showHud()
    return () => {
      if (hudTimerRef.current) window.clearTimeout(hudTimerRef.current)
    }
  }, [showHud])

  /** 同源频道序列（带频道号）：优先只含未失效的频道 */
  const channelSeq = useCallback(() => {
    const alive = channelSeqList.filter((x) => !isDead(x.item.id))
    return alive.length > 1 ? alive : channelSeqList
  }, [channelSeqList])

  const zap = useCallback(
    (step: number) => {
      const list = channelSeq()
      if (list.length < 2) return
      const pos = list.findIndex((x) => x.item.id === item?.id)
      if (pos < 0) return
      const next = list[(pos + step + list.length) % list.length]
      navigate(`/play/${next.item.id}`, { replace: true })
    },
    [channelSeq, item?.id, navigate],
  )

  /** 数字键直达：输入的是「频道号」（可自定义），不是下标 */
  const zapToIndex = useCallback(
    (n: number) => {
      const list = channelSeq()
      const hit = list.find((x) => x.number === n)
      if (!hit) return
      navigate(`/play/${hit.item.id}`, { replace: true })
    },
    [channelSeq, navigate],
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

  // 片库续播：地址里带 pos=秒，元数据就绪后跳到该位置
  useEffect(() => {
    const v = videoRef.current
    if (!v) return
    const pos = Number(params.get('pos') ?? 0)
    if (!pos || !Number.isFinite(pos)) return
    const onLoaded = () => {
      if (v.currentTime < 1) v.currentTime = pos
    }
    v.addEventListener('loadedmetadata', onLoaded)
    return () => v.removeEventListener('loadedmetadata', onLoaded)
  }, [params, item?.streamUrl])

  // 外部播放器
  useEffect(() => {
    let cancelled = false
    void availablePlayers().then((list) => {
      if (!cancelled) setPlayers(list)
    })
    return () => {
      cancelled = true
    }
  }, [])

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

  // 进度记忆：短剧单独存一份（用于「继续观看」），其余走片库进度
  useEffect(() => {
    if (!trackProgress) return
    const timer = window.setInterval(() => {
      const v = videoRef.current
      if (!v || v.paused || !v.duration || !Number.isFinite(v.duration)) return
      if (shortSeries && item) {
        saveShortProgress(
          {
            seriesId: shortSeries,
            title: params.get('title') || item.title,
            cover: params.get('cover') || item.poster,
            episodeId: params.get('epId') ?? '',
            epNumber: shortEp,
            seconds: v.currentTime,
            duration: v.duration,
          },
          v.currentTime,
          v.duration,
        )
        return
      }
      if (item) {
        actions.setProgress(item.id, {
          position: v.currentTime,
          duration: v.duration,
          updatedAt: Date.now(),
        })
      }
    }, 5000)
    return () => window.clearInterval(timer)
  }, [item, trackProgress, shortSeries, shortEp, params])

  // 片头自动跳过
  useEffect(() => {
    const v = videoRef.current
    if (!v || isLive || !markers.introEnd) return
    const onTime = () => {
      if (introSkippedRef.current) return
      if (v.currentTime > 1 && v.currentTime < (markers.introEnd ?? 0) - 1) {
        v.currentTime = markers.introEnd as number
        introSkippedRef.current = true
        setStatus('已跳过片头')
        window.setTimeout(() => setStatus(null), 1600)
      }
    }
    v.addEventListener('timeupdate', onTime)
    return () => v.removeEventListener('timeupdate', onTime)
  }, [markers.introEnd, isLive, item?.streamUrl])

  /** 队列下一集；短剧要先下载解密 */
  const goNext = useCallback(async () => {
    const next = advance()
    if (!next) return
    if (next.kind === 'short') {
      setStatus(`正在准备 ${next.name}…`)
      try {
        const r = await sdPrepare(next.seriesId, next.episodeId)
        const qp = new URLSearchParams({
          remote: '1',
          mode: 'url',
          u: fileToPlayUrl(r.path),
          name: next.name,
          series: next.seriesId,
          ep: String(next.epNumber),
          epId: next.episodeId,
          title: next.name,
        })
        if (next.cover) qp.set('cover', next.cover)
        navigate(`/play/_?${qp.toString()}`, { replace: true })
        setStatus(null)
      } catch (e) {
        setStatus(e instanceof Error ? `下一集准备失败：${e.message}` : '下一集准备失败')
      }
      return
    }
    const path = routeFor(next)
    if (path) navigate(path, { replace: true })
  }, [navigate])

  const nextRef = useRef<() => void>(() => {})
  nextRef.current = () => {
    void goNext()
  }

  // 键盘：直播 ↑↓ 换台，点播 ←→ 快进快退
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      showHud()
      const v = videoRef.current
      if (!v) return
      const target = e.target as HTMLElement | null
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return

      if (isLive && /^[0-9]$/.test(e.key) && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault()
        zapRef.current = (zapRef.current + e.key).slice(-4)
        setZapBuffer(zapRef.current)
        if (zapTimerRef.current) window.clearTimeout(zapTimerRef.current)
        zapTimerRef.current = window.setTimeout(() => {
          zapRef.current = ''
          setZapBuffer('')
        }, 1500)
        return
      }
      if (isLive && e.key === 'Enter' && zapRef.current) {
        e.preventDefault()
        const n = Number(zapRef.current)
        zapRef.current = ''
        setZapBuffer('')
        if (zapTimerRef.current) window.clearTimeout(zapTimerRef.current)
        if (Number.isFinite(n)) zapToIndex(n)
        return
      }

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
      } else if (!isLive && e.key === 'n' && nextItem) {
        void goNext()
      } else if (!isLive && (e.key === '[' || e.key === ']')) {
        const v2 = videoRef.current
        if (!v2 || !markerKey) return
        if (e.key === '[') {
          setIntroEnd(markerKey, v2.currentTime)
          setMarkers(getMarkers(markerKey))
          setStatus(`片头结束标记于 ${Math.round(v2.currentTime)}s`)
        } else {
          setOutroStart(markerKey, v2.currentTime)
          setMarkers(getMarkers(markerKey))
          setStatus(`片尾起点标记于 ${Math.round(v2.currentTime)}s`)
        }
        window.setTimeout(() => setStatus(null), 1800)
      } else if (e.key.toLowerCase() === 'c' && !isLive) {
        setSubIndex((idx) => (idx >= 0 ? -1 : subTracks.length > 0 ? 0 : -1))
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [navigate, isLive, zap, zapToIndex, subMenu, subTracks.length, showHud, goNext, nextItem, markerKey])

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
      onMouseMove={showHud}
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
        onEnded={() => {
          if (!isLive && nextItem) nextRef.current()
        }}
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
        className={`pointer-events-none absolute inset-x-0 top-0 h-28 bg-gradient-to-b from-black/70 to-transparent transition-opacity duration-300 ${
          hudVisible ? 'opacity-100' : 'opacity-0'
        }`}
      />

      {/* 顶部玻璃条：左边留出 macOS 红绿灯的位置 */}
      <div
        className={`pointer-events-none absolute inset-x-0 top-0 flex items-start justify-between gap-3 px-4 pb-10 pl-[84px] pt-3 transition-opacity duration-300 ${
          hudVisible ? 'opacity-100' : 'opacity-0'
        }`}
      >
        <div className={`flex items-center gap-2 ${hudVisible ? 'pointer-events-auto' : 'pointer-events-none'}`}>
          <button
            onClick={() => navigate(-1)}
            className="glass-capsule flex items-center gap-1.5 rounded-full px-3.5 py-2 text-[12px] text-white/90 transition hover:text-gold"
          >
            <ArrowLeft size={14} /> 返回
          </button>
        </div>

        <div
          data-tauri-drag-region
          className={`glass-capsule flex max-w-[52%] items-center gap-2.5 rounded-full px-4 py-2 ${
            hudVisible ? 'pointer-events-auto' : 'pointer-events-none'
          }`}
        >
          <span className="truncate text-[12.5px] font-medium text-white/90">{item.title}</span>
          <span className="h-3 w-px shrink-0 bg-white/15" aria-hidden="true" />
          <span className="truncate text-[10.5px] text-white/45">
            {item.year ? `${item.year} · ` : ''}
            {item.genres.join(' / ')}
          </span>
          {isLive && channelPos >= 0 && channelList.length > 1 && (
            <span className="shrink-0 rounded-full bg-white/10 px-2 py-0.5 text-[10px] tabular-nums text-white/70">
              {channelSeqList[channelPos]?.number ?? channelPos + 1}/{channelSeqList.length}
            </span>
          )}
        </div>
      </div>

      <div
        className={`absolute inset-x-0 bottom-0 px-4 pb-4 pt-16 transition-opacity duration-300 ${
          hudVisible ? 'opacity-100' : 'pointer-events-none opacity-0'
        }`}
      >
        <div
          className="pointer-events-none absolute inset-x-0 bottom-0 h-40 bg-gradient-to-t from-black/75 to-transparent"
          aria-hidden="true"
        />
        <div
          className="glass-panel relative rounded-2xl px-4 py-3"
          style={{ backgroundImage: 'linear-gradient(145deg, rgba(20,20,28,0.62), rgba(8,8,14,0.5))' }}
        >
        {isLive ? (
          <div className="mb-2 flex items-center gap-2 text-[11px] text-white/45">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-red-500" />
            直播中
            {channelList.length > 1 && <span className="ml-1">· ↑ ↓ 换台 · 数字键按频道号直达</span>}
            {zapBuffer && <span className="ml-2 text-gold">跳到 {zapBuffer} 号</span>}
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

            {!isLive && markerKey && (
              <>
                <button
                  onClick={() => {
                    const v = videoRef.current
                    if (!v) return
                    setIntroEnd(markerKey, v.currentTime)
                    setMarkers(getMarkers(markerKey))
                    setStatus(`片头结束标记于 ${Math.round(v.currentTime)}s`)
                    window.setTimeout(() => setStatus(null), 1800)
                  }}
                  title="把当前时间记为片头结束（快捷键 [）"
                  className={`text-[11px] transition ${
                    markers.introEnd ? 'text-gold/80' : 'text-white/55 hover:text-white'
                  }`}
                >
                  片头
                </button>
                <button
                  onClick={() => {
                    const v = videoRef.current
                    if (!v) return
                    setOutroStart(markerKey, v.currentTime)
                    setMarkers(getMarkers(markerKey))
                    setStatus(`片尾起点标记于 ${Math.round(v.currentTime)}s`)
                    window.setTimeout(() => setStatus(null), 1800)
                  }}
                  title="把当前时间记为片尾起点（快捷键 ]）"
                  className={`text-[11px] transition ${
                    markers.outroStart ? 'text-gold/80' : 'text-white/55 hover:text-white'
                  }`}
                >
                  片尾
                </button>
              </>
            )}

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
            {!isLive && current >= (markers.outroStart ?? Infinity) - 1 && (
              <button
                onClick={() => {
                  if (nextItem) nextRef.current()
                  else {
                    const v = videoRef.current
                    if (v) v.pause()
                  }
                }}
                className="glass-primary rounded-full px-3 py-1.5 text-[11.5px] font-semibold"
              >
                {nextItem ? `跳过片尾 · 下一集` : '跳过片尾'}
              </button>
            )}
            {!isLive && nextItem && (
              <span className="hidden text-[10.5px] text-white/45 sm:inline">
                下一个：{nextItem.name}
              </span>
            )}
            {players.length > 0 && item.streamUrl && (
              <div className="relative">
                <button
                  onClick={() => setExtMenu((v) => !v)}
                  title="用外部播放器打开"
                  className={`transition ${extMenu ? 'text-gold' : 'text-white/70 hover:text-white'}`}
                >
                  <MonitorPlay size={16} />
                </button>
                {extMenu && (
                  <div className="glass-panel absolute bottom-9 right-0 z-20 w-[132px] rounded-xl p-1.5">
                    {players.map((pl) => (
                      <button
                        key={pl.id}
                        onClick={() => {
                          setExtMenu(false)
                          void openInPlayer(item.streamUrl as string, pl.id).catch((e) => {
                            setStatus(e instanceof Error ? e.message : String(e))
                            window.setTimeout(() => setStatus(null), 2600)
                          })
                        }}
                        className="w-full rounded-lg px-2.5 py-1.5 text-left text-[11.5px] text-white/80 hover:bg-white/8"
                      >
                        用 {pl.name} 播放
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}
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
    </div>
  )
}