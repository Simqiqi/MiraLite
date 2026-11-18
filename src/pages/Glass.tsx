/**
 * 液态玻璃展示页（/glass）。
 *
 * 把项目里现有的玻璃材质一次性摊开：面板层级、按钮、输入框、导航胶囊、海报卡，
 * 外加一个可调色相 / 模糊 / 流动速度的「光晕实验室」，方便定参数。
 */
import { useState } from 'react'
import {
  Check,
  Droplets,
  Layers,
  MousePointerClick,
  Palette,
  Play,
  RefreshCw,
  Search,
  Sparkles,
  Star,
} from 'lucide-react'

function Block({ title, desc, children }: { title: string; desc: string; children: React.ReactNode }) {
  return (
    <section className="mb-7">
      <div className="mb-3 flex items-baseline gap-2.5">
        <h2 className="text-[15px] font-semibold tracking-tight text-fg">{title}</h2>
        <span className="text-[11px] text-muted/70">{desc}</span>
      </div>
      {children}
    </section>
  )
}

/** 重新生成一组全局环境色相（和启动时逻辑一致） */
function rollAmbient(): number {
  const root = document.documentElement
  const h1 = Math.floor(Math.random() * 360)
  const h2 = (h1 + 52 + Math.floor(Math.random() * 96)) % 360
  const h3 = (h1 + 150 + Math.floor(Math.random() * 60) + 360) % 360
  const h4 = (h1 + 250 + Math.floor(Math.random() * 70) + 360) % 360
  root.style.setProperty('--li-h1', String(h1))
  root.style.setProperty('--li-h2', String(h2))
  root.style.setProperty('--li-h3', String(h3))
  root.style.setProperty('--li-h4', String(h4))
  root.style.setProperty('--li-rot', `${Math.floor(Math.random() * 360)}deg`)
  root.dataset.ambientHue = String(h1)
  return h1
}

export default function GlassPage() {
  const [hue, setHue] = useState(() => Number(document.documentElement.dataset.ambientHue ?? 210))
  const [blur, setBlur] = useState(46)
  const [speed, setSpeed] = useState(18)

  const blobs = [
    { x: '12%', y: '8%', size: 300, dh: 0 },
    { x: '62%', y: '0%', size: 340, dh: 54 },
    { x: '38%', y: '44%', size: 320, dh: 150 },
  ]

  return (
    <div className="px-10 pb-16 pt-7">
      <div className="mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-[22px] font-semibold tracking-tight">
            液态玻璃
            <span className="text-[12px] font-normal text-muted/70">Liquid Glass</span>
          </h1>
          <p className="mt-1 max-w-[640px] text-[12px] leading-relaxed text-muted">
            整个界面共用一套玻璃材质：背景彩色光晕缓慢流动，前景面板做背景模糊、边缘高光与彩色折射。
            下面是各组件的实际效果，参数可以现场调。
          </p>
        </div>
        <button
          onClick={() => setHue(rollAmbient())}
          className="glass-btn flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11.5px] text-fg/80 hover:text-gold"
        >
          <RefreshCw size={12} /> 换一组光晕
        </button>
      </div>

      <Block title="材质层级" desc="同一个玻璃家族里的三种密度">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="glass-panel rounded-2xl p-4">
            <div className="flex items-center gap-2 text-[12.5px] font-medium">
              <Layers size={14} className="text-gold" /> glass-panel
            </div>
            <p className="mt-2 text-[11.5px] leading-relaxed text-muted">
              标准面板，用在设置区块、内容卡与弹层。24px 背景模糊 + 顶部高光边。
            </p>
          </div>
          <div className="glass-inset rounded-2xl p-4">
            <div className="flex items-center gap-2 text-[12.5px] font-medium">
              <Droplets size={14} className="text-gold" /> glass-inset
            </div>
            <p className="mt-2 text-[11.5px] leading-relaxed text-muted">
              内嵌面板，比标准面板更压暗，用来放列表、开关组和二级内容。
            </p>
          </div>
          <div className="glass-tip rounded-2xl p-4">
            <div className="flex items-center gap-2 text-[12.5px] font-medium">
              <Sparkles size={14} className="text-gold" /> glass-tip
            </div>
            <p className="mt-2 text-[11.5px] leading-relaxed text-muted">
              提示条，深色底 + 细边，适合状态说明与轻提示，不抢内容。
            </p>
          </div>
        </div>
      </Block>

      <Block title="按钮与标签" desc="主按钮、玻璃按钮、可选中胶囊">
        <div className="glass-panel flex flex-wrap items-center gap-3 rounded-2xl p-4">
          <button className="glass-primary flex items-center gap-1.5 rounded-full px-4 py-2 text-[12px] font-semibold">
            <Play size={12} /> 主操作
          </button>
          <button className="glass-btn flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-[12px] text-fg/85 hover:text-gold">
            <Check size={12} /> 玻璃按钮
          </button>
          <button className="glass-chip is-active flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[11.5px] text-gold">
            <Star size={11} fill="currentColor" /> 选中胶囊
          </button>
          <button className="glass-chip rounded-lg px-3 py-1.5 text-[11.5px] text-muted">普通胶囊</button>
          <span className="ml-auto flex items-center gap-1 text-[10.5px] text-muted/60">
            <MousePointerClick size={11} /> 悬停看高光变化
          </span>
        </div>
      </Block>

      <Block title="输入与导航" desc="输入框、搜索框与胶囊导航">
        <div className="grid grid-cols-1 gap-3 lg:grid-cols-[1.2fr_1fr]">
          <div className="glass-panel rounded-2xl p-4">
            <div className="space-y-2.5">
              <input
                placeholder="普通输入框（glass-input）"
                className="glass-input h-9 w-full rounded-lg px-3 text-[12px] text-fg"
              />
              <div className="relative">
                <Search
                  size={13}
                  className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted"
                />
                <input
                  placeholder="带图标的搜索框"
                  className="glass-input h-9 w-full rounded-lg pl-8 pr-3 text-[12px] text-fg"
                />
              </div>
            </div>
          </div>

          <div className="glass-panel flex items-center justify-center rounded-2xl p-6">
            <div className="glass-capsule flex items-center gap-1 rounded-full p-1.5">
              {[
                ['首页', true],
                ['直播', false],
                ['我的', false],
              ].map(([label, active]) => (
                <span
                  key={String(label)}
                  className={`glass-nav rounded-full px-3 py-1.5 text-[11.5px] ${
                    active ? 'is-active text-gold' : 'text-muted'
                  }`}
                >
                  {label}
                </span>
              ))}
              <span className="ml-1 flex h-6 w-6 items-center justify-center rounded-full bg-gold text-[10px] font-bold text-black">
                ML
              </span>
            </div>
          </div>
        </div>
      </Block>

      <Block title="折射卡片" desc="海报、封面与悬浮高光">
        <div className="flex flex-wrap gap-3">
          {[
            { title: '沙漠日落', hue: 24 },
            { title: '深海静默', hue: 205 },
            { title: '霓虹雨夜', hue: 300 },
          ].map((c) => (
            <div
              key={c.title}
              className="glass-poster group relative h-[188px] w-[132px] overflow-hidden rounded-xl transition duration-300 hover:-translate-y-1"
            >
              <div
                className="absolute inset-0"
                style={{
                  background: `linear-gradient(150deg, hsl(${c.hue} 62% 30%) 0%, hsl(${(c.hue + 28) % 360} 44% 12%) 58%, #0b0b0f 100%)`,
                }}
              />
              <div
                className="absolute inset-0 opacity-70 mix-blend-overlay"
                style={{
                  background: `radial-gradient(circle at 30% 18%, hsl(${c.hue} 92% 62% / 0.5), transparent 62%)`,
                }}
              />
              <div className="glass-sheen" />
              <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/85 to-transparent p-2.5 pt-8">
                <div className="text-[12px] font-medium text-white/90">{c.title}</div>
                <div className="mt-0.5 text-[10px] text-white/50">glass-poster</div>
              </div>
            </div>
          ))}
        </div>
      </Block>

      <Block title="光晕实验室" desc="调色相、模糊与流动速度，观察玻璃后的折射">
        <div className="glass-panel grid grid-cols-1 gap-4 rounded-2xl p-4 lg:grid-cols-[260px_1fr]">
          <div className="space-y-4">
            <label className="block">
              <span className="flex items-center justify-between text-[11px] text-muted">
                <span className="flex items-center gap-1">
                  <Palette size={11} /> 基础色相
                </span>
                <span className="tabular-nums text-fg/70">{hue}°</span>
              </span>
              <input
                type="range"
                min={0}
                max={359}
                value={hue}
                onChange={(e) => setHue(Number(e.target.value))}
                className="mt-2 h-1 w-full cursor-pointer appearance-none rounded-full accent-[#e8b44c]"
                style={{
                  background: `linear-gradient(to right, hsl(${hue} 80% 55%), hsl(${(hue + 120) % 360} 80% 55%), hsl(${(hue + 240) % 360} 80% 55%))`,
                }}
              />
            </label>

            <label className="block">
              <span className="flex items-center justify-between text-[11px] text-muted">
                <span>光斑模糊</span>
                <span className="tabular-nums text-fg/70">{blur}px</span>
              </span>
              <input
                type="range"
                min={10}
                max={90}
                value={blur}
                onChange={(e) => setBlur(Number(e.target.value))}
                className="mt-2 h-1 w-full cursor-pointer appearance-none rounded-full bg-white/15 accent-[#e8b44c]"
              />
            </label>

            <label className="block">
              <span className="flex items-center justify-between text-[11px] text-muted">
                <span>流动速度</span>
                <span className="tabular-nums text-fg/70">{speed}s</span>
              </span>
              <input
                type="range"
                min={6}
                max={40}
                value={speed}
                onChange={(e) => setSpeed(Number(e.target.value))}
                className="mt-2 h-1 w-full cursor-pointer appearance-none rounded-full bg-white/15 accent-[#e8b44c]"
              />
            </label>

            <p className="text-[10.5px] leading-relaxed text-muted/70">
              这里的参数只作用于右侧预览；点右上角「换一组光晕」可以同时换掉整个 App 的环境色。
            </p>
          </div>

          <div className="relative min-h-[260px] overflow-hidden rounded-xl border border-white/10 bg-[#07070b]">
            {blobs.map((b, i) => (
              <div
                key={i}
                className="glass-blob"
                style={{
                  left: b.x,
                  top: b.y,
                  width: b.size,
                  height: b.size,
                  background: `radial-gradient(circle at 40% 35%, hsl(${(hue + b.dh) % 360} 92% 60% / 0.75), hsl(${(hue + b.dh + 40) % 360} 90% 45% / 0.15) 60%, transparent 72%)`,
                  filter: `blur(${blur}px)`,
                  animationDuration: `${speed}s`,
                  animationDelay: `${-i * 4}s`,
                }}
              />
            ))}
            <div className="absolute inset-0 bg-gradient-to-t from-black/35 to-transparent" />

            <div className="relative flex h-full min-h-[260px] items-center justify-center p-6">
              <div className="glass-panel w-full max-w-[320px] rounded-2xl p-5">
                <div className="flex items-center gap-2 text-[12.5px] font-medium">
                  <Droplets size={14} className="text-gold" /> 折射预览
                </div>
                <p className="mt-2 text-[11.5px] leading-relaxed text-muted">
                  玻璃面板会模糊背后的彩色光斑，边缘带了一圈冷色高光。光晕流动时，面板上的颜色也会缓慢变化。
                </p>
                <div className="mt-3 flex items-center gap-2">
                  <span className="glass-chip is-active rounded-full px-2.5 py-1 text-[10.5px] text-gold">
                    实时
                  </span>
                  <span className="glass-chip rounded-full px-2.5 py-1 text-[10.5px] text-muted">
                    backdrop-filter
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </Block>
    </div>
  )
}