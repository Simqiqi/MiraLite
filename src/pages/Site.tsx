/**
 * 内嵌网页（看看影视）：在 App 内容区里用子 Webview 打开外部站点，铺满整个内容区。
 * 子 Webview 是真实浏览器视图，不受目标站 X-Frame-Options 限制。
 */
import { useCallback, useEffect, useRef, useState } from 'react'
import { Globe, Loader2, TriangleAlert } from 'lucide-react'
import { siteBounds, siteClose, siteNavigate, siteOpen, type Bounds } from '../lib/embed'

const HOME = 'https://www.kankanya.me'

export default function SitePage() {
  const [url] = useState(HOME)
  const [err, setErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(true)
  const holderRef = useRef<HTMLDivElement>(null)
  const firstRef = useRef(true)

  const measure = useCallback((): Bounds | null => {
    const el = holderRef.current
    if (!el) return null
    const r = el.getBoundingClientRect()
    if (r.width < 40 || r.height < 40) return null
    return {
      x: Math.round(r.left),
      y: Math.round(r.top),
      width: Math.round(r.width),
      height: Math.round(r.height),
    }
  }, [])

  // 首次打开；再次进入时复用同一个内嵌视图并跳转
  useEffect(() => {
    const bounds = measure()
    if (!bounds) return
    setErr(null)
    if (firstRef.current) {
      firstRef.current = false
      void siteOpen(url, bounds)
        .catch((e) => setErr(e instanceof Error ? e.message : String(e)))
        .finally(() => window.setTimeout(() => setBusy(false), 600))
    } else {
      void siteNavigate(url).catch((e) => setErr(e instanceof Error ? e.message : String(e)))
      setBusy(false)
    }
    return () => {
      void siteClose()
      firstRef.current = true
    }
  }, [url, measure])

  // 内容区尺寸变化时跟随
  useEffect(() => {
    const el = holderRef.current
    if (!el) return
    const sync = () => {
      const b = measure()
      if (b) void siteBounds(b)
    }
    const ro = new ResizeObserver(sync)
    ro.observe(el)
    window.addEventListener('resize', sync)
    const timer = window.setTimeout(sync, 150)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', sync)
      window.clearTimeout(timer)
    }
  }, [measure])

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div ref={holderRef} className="relative min-h-0 flex-1 overflow-hidden bg-[#08080a]">
        {err && (
          <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex justify-center pt-4">
            <div className="glass-warn flex items-center gap-2 rounded-lg px-3 py-2 text-[11.5px] text-amber-200/90">
              <TriangleAlert size={12} /> {err}
            </div>
          </div>
        )}

        {busy && (
          <div className="absolute inset-0 flex items-center justify-center gap-2 text-[12px] text-muted">
            <Loader2 size={14} className="animate-spin text-gold" /> 正在打开 {url}…
          </div>
        )}

        {!busy && (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 px-8 text-center">
            <Globe size={22} className="text-muted/60" />
            <p className="text-[12.5px] text-fg/80">网页显示在这个区域</p>
            <p className="max-w-[420px] text-[11px] leading-relaxed text-muted">
              如果一直空白，多半是该站点不允许被嵌入或需要登录。
            </p>
          </div>
        )}
      </div>
    </div>
  )
}