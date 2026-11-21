import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { actions, useLibrary } from '../lib/store'
import LocalLibrary from '../components/LocalLibrary'
import SourcesSection from '../components/SourcesSection'
import SiteSwitches from '../components/SiteSwitches'
import { clearAllLineFails, failedLineCount } from '../lib/lines'
import { clearPlayback, usePlayback } from '../lib/playback'
import { applyBackup, exportSettings, pickBackup } from '../lib/backup'
import WebdavDialog from '../components/WebdavDialog'
import { getWebdav, type WebdavView } from '../lib/webdav'
import { useChannelPrefs, setBlockAdult, setBlockedWords } from '../lib/channelPrefs'
import {
  diagExport,
  diagInfo,
  diagLogTail,
  fmtBytes,
  sdInstallRuntime,
  sdRuntime,
  shortCacheClear,
  updateCheck,
  type RuntimeInfo,
  type ShortRuntime,
  type UpdateInfo,
} from '../lib/ops'

function Toggle({ on, onChange }: { on: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      onClick={() => onChange(!on)}
      className={`relative h-[22px] w-[38px] shrink-0 rounded-full transition ${
        on ? 'bg-gold shadow-[0_0_18px_-4px_rgba(232,180,76,0.75)]' : 'bg-white/14'
      }`}
    >
      <span
        className={`absolute top-[3px] h-4 w-4 rounded-full bg-white shadow transition-all ${
          on ? 'left-[19px]' : 'left-[3px]'
        }`}
      />
    </button>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div className="glass-panel mb-6 overflow-hidden rounded-2xl">
      <div className="border-b border-white/10 px-5 py-3 text-[12.5px] font-medium text-fg/85">{title}</div>
      <div className="divide-y divide-white/8">{children}</div>
    </div>
  )
}

function Row({ title, desc, right }: { title: string; desc: string; right: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between px-5 py-3.5">
      <div className="min-w-0 pr-6">
        <div className="text-[12.5px] text-fg/90">{title}</div>
        <div className="mt-0.5 text-[11px] leading-snug text-muted">{desc}</div>
      </div>
      {right}
    </div>
  )
}

export default function SettingsPage() {
  const { prefs, progress, watchlist, sources, channels } = useLibrary()
  const navigate = useNavigate()
  const playback = usePlayback()
  const [backupMsg, setBackupMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)
  const [busy, setBusy] = useState<'export' | 'import' | null>(null)
  const [webdav, setWebdav] = useState<WebdavView | null>(null)
  const [info, setInfo] = useState<RuntimeInfo | null>(null)
  const [runtime, setRuntime] = useState<ShortRuntime | null>(null)
  const [update, setUpdate] = useState<UpdateInfo | null>(null)
  const [checking, setChecking] = useState(false)
  const [installing, setInstalling] = useState(false)
  const [logText, setLogText] = useState<string | null>(null)
  const [opsMsg, setOpsMsg] = useState<string | null>(null)
  const [webdavOpen, setWebdavOpen] = useState(false)
  const prefsCh = useChannelPrefs()
  const [words, setWords] = useState('')

  useEffect(() => {
    void getWebdav().then(setWebdav)
  }, [webdavOpen])

  useEffect(() => {
    void diagInfo().then(setInfo)
    void sdRuntime().then(setRuntime)
  }, [installing])

  useEffect(() => {
    setWords(prefsCh.blockedWords.join(' '))
  }, [prefsCh.blockedWords])

  async function doExport() {
    setBusy('export')
    setBackupMsg(null)
    try {
      const r = await exportSettings()
      setBackupMsg({ kind: 'ok', text: `已导出 ${r.keys} 项配置到 ${r.path}` })
    } catch (e) {
      setBackupMsg({ kind: 'err', text: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(null)
    }
  }

  async function doRestore() {
    setBackupMsg(null)
    try {
      const payload = await pickBackup()
      if (!payload) return
      if (!window.confirm('恢复会用备份覆盖当前配置，确定继续吗？')) return
      setBusy('import')
      const n = applyBackup(payload)
      setBackupMsg({ kind: 'ok', text: `已恢复 ${n} 项配置，正在刷新…` })
      window.setTimeout(() => window.location.reload(), 600)
    } catch (e) {
      setBackupMsg({ kind: 'err', text: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="px-10 pb-16 pt-7">
      <h1 className="mb-1 text-[22px] font-semibold tracking-tight">设置</h1>
      <p className="mb-6 text-[12px] text-muted">播放、推荐、片源与本地数据处理方式</p>

      <Section title="播放">
        <Row
          title="自动连播"
          desc="一集结束后自动进入下一集"
          right={<Toggle on={prefs.autoplayNext} onChange={(v) => actions.setPrefs({ autoplayNext: v })} />}
        />
        <Row
          title="优先画质"
          desc="直播流与点播的默认清晰度"
          right={
            <div className="glass-inset flex gap-1 rounded-lg p-0.5">
              {(['auto', '1080p', '720p'] as const).map((k) => (
                <button
                  key={k}
                  onClick={() => actions.setPrefs({ preferQuality: k })}
                  className={`glass-chip rounded-md px-2 py-1 text-[11px] ${
                    prefs.preferQuality === k ? 'is-active text-gold' : 'text-muted'
                  }`}
                >
                  {k}
                </button>
              ))}
            </div>
          }
        />
      </Section>

      <Section title="推荐">
        <Row
          title="TastePrint 推荐"
          desc="根据观看记录生成 For You 与相似作品，只从你已连接的源里选"
          right={<Toggle on={prefs.tastePrint} onChange={(v) => actions.setPrefs({ tastePrint: v })} />}
        />
      </Section>

      <Section title="外观">
        <Row
          title="液态玻璃展示"
          desc="面板、按钮、输入框、导航与可调光晕实验室"
          right={
            <button
              onClick={() => navigate('/glass')}
              className="glass-btn rounded-lg px-2.5 py-1 text-[11.5px] text-fg/80 transition hover:text-gold"
            >
              打开
            </button>
          }
        />
      </Section>

      <Section title="片源">
        <SourcesSection />
      </Section>

      <Section title="本地媒体库">
        <LocalLibrary />
      </Section>

      <Section title="站点">
        <SiteSwitches />
      </Section>

      <Section title="内容过滤">
        <Row
          title="成人频道过滤"
          desc="直播频道名命中内置词（成人 / 福利 / 18+ 等）时不显示"
          right={<Toggle on={prefsCh.blockAdult} onChange={(v) => setBlockAdult(v)} />}
        />
        <Row
          title="自定义屏蔽词"
          desc="空格分隔，命中即隐藏；只在开启过滤时生效"
          right={
            <div className="flex items-center gap-2">
              <input
                value={words}
                onChange={(e) => setWords(e.target.value)}
                placeholder="例如 莆田 赌博"
                className="glass-input h-7 w-[180px] rounded-lg px-2 text-[11.5px] outline-none"
              />
              <button
                onClick={() => setBlockedWords(words.split(/\s+/))}
                className="glass-btn rounded-lg px-2.5 py-1 text-[11.5px] text-fg/80 hover:text-gold"
              >
                保存
              </button>
            </div>
          }
        />
      </Section>

      <Section title="数据">
        <Row
          title="云端同步（WebDAV）"
          desc={webdav?.configured ? `已配置：${webdav.url}` : '把配置备份传到自己的网盘，换机时一键恢复'}
          right={
            <button
              onClick={() => setWebdavOpen(true)}
              className="glass-btn rounded-lg px-2.5 py-1 text-[11.5px] text-fg/80 transition hover:text-gold"
            >
              {webdav?.configured ? '管理' : '配置'}
            </button>
          }
        />
        <Row
          title="备份配置"
          desc="把源、收藏、追剧、观看进度、CAT 订阅与脚本导出成 JSON（不含缓存）"
          right={
            <button
              onClick={() => void doExport()}
              disabled={busy !== null}
              className="glass-btn rounded-lg px-2.5 py-1 text-[11.5px] text-fg/80 transition hover:text-gold disabled:opacity-50"
            >
              {busy === 'export' ? '导出中…' : '导出'}
            </button>
          }
        />
        <Row
          title="恢复备份"
          desc="从 .json 覆盖恢复当前配置，恢复后会自动刷新界面"
          right={
            <button
              onClick={() => void doRestore()}
              disabled={busy !== null}
              className="glass-btn rounded-lg px-2.5 py-1 text-[11.5px] text-muted transition hover:text-gold disabled:opacity-50"
            >
              {busy === 'import' ? '恢复中…' : '恢复'}
            </button>
          }
        />
        {backupMsg && (
          <div
            className={`px-5 py-2.5 text-[10.5px] leading-relaxed ${
              backupMsg.kind === 'ok' ? 'text-emerald-300/90' : 'text-amber-300/90'
            }`}
          >
            {backupMsg.text}
          </div>
        )}
        <Row title="片单" desc={`${watchlist.length} 部已收藏`} right={<span className="text-[12px] text-muted">—</span>} />
        <Row
          title="继续观看"
          desc={`${playback.length} 部片子记着看到哪，仅保存在本机`}
          right={
            <button
              onClick={() => clearPlayback()}
              className="glass-btn rounded-lg px-2.5 py-1 text-[11.5px] text-muted transition hover:text-red-300"
            >
              清空
            </button>
          }
        />
        <Row
          title="线路偏好"
          desc={`${failedLineCount()} 条线路带着失败记录，会被自动排到后面`}
          right={
            <button
              onClick={() => clearAllLineFails()}
              className="glass-btn rounded-lg px-2.5 py-1 text-[11.5px] text-muted transition hover:text-red-300"
            >
              重置
            </button>
          }
        />
        <Row
          title="演示媒体库进度"
          desc={`${Object.keys(progress).length} 条，仅保存在本机`}
          right={
            <button
              onClick={() => {
                Object.keys(progress).forEach((id) => actions.clearProgress(id))
              }}
              className="glass-btn rounded-lg px-2.5 py-1 text-[11.5px] text-muted transition hover:text-red-300"
            >
              清空
            </button>
          }
        />
      </Section>

      <Section title="关于与更新">
        <Row
          title={`MiraLite ${info?.version ?? '—'}`}
          desc={
            update
              ? update.hasUpdate
                ? `发现新版本 ${update.latest}（当前 ${update.current}）`
                : update.message || `已是最新版本（${update.current}）`
              : '检查 GitHub Release 是否有新版本'
          }
          right={
            <div className="flex items-center gap-2">
              {update?.hasUpdate && update.dmgUrl && (
                <button
                  onClick={() => window.open(update.dmgUrl ?? '', '_blank')}
                  className="glass-btn rounded-lg px-2.5 py-1 text-[11.5px] text-gold"
                >
                  下载安装包
                </button>
              )}
              {update?.hasUpdate && (
                <button
                  onClick={() => window.open(update.htmlUrl, '_blank')}
                  className="glass-btn rounded-lg px-2.5 py-1 text-[11.5px] text-fg/80 hover:text-gold"
                >
                  发布说明
                </button>
              )}
              <button
                onClick={() => {
                  setChecking(true)
                  setOpsMsg(null)
                  void updateCheck()
                    .then(setUpdate)
                    .catch((e) => setOpsMsg(e instanceof Error ? e.message : String(e)))
                    .finally(() => setChecking(false))
                }}
                disabled={checking}
                className="glass-btn rounded-lg px-2.5 py-1 text-[11.5px] text-fg/80 hover:text-gold disabled:opacity-50"
              >
                {checking ? '检查中…' : '检查更新'}
              </button>
            </div>
          }
        />
        <Row
          title="短剧运行环境（Node）"
          desc={
            runtime?.source === 'system'
              ? `使用系统 Node：${runtime.node}`
              : runtime?.source === 'bundled'
                ? '使用内置运行时'
                : runtime?.hint || '未检测到'
          }
          right={
            runtime?.source === 'none' ? (
              <button
                onClick={() => {
                  setInstalling(true)
                  setOpsMsg('正在下载 Node 运行时（约 40MB）…')
                  void sdInstallRuntime()
                    .then((p) => setOpsMsg(`已安装：${p}`))
                    .catch((e) => setOpsMsg(e instanceof Error ? e.message : String(e)))
                    .finally(() => setInstalling(false))
                }}
                disabled={installing}
                className="glass-primary rounded-lg px-2.5 py-1 text-[11.5px] font-semibold disabled:opacity-50"
              >
                {installing ? '下载中…' : '下载运行时'}
              </button>
            ) : (
              <span className="text-[11px] text-emerald-300/90">可用</span>
            )
          }
        />
        <Row
          title="短剧缓存"
          desc={`${info?.cacheShortFiles ?? 0} 个文件 · ${fmtBytes(info?.cacheShortBytes ?? 0)}，清理后下次播放会重新解密`}
          right={
            <button
              onClick={() => {
                void shortCacheClear()
                  .then((freed) => {
                    setOpsMsg(`已清理 ${fmtBytes(freed)}`)
                    return diagInfo().then(setInfo)
                  })
                  .catch((e) => setOpsMsg(e instanceof Error ? e.message : String(e)))
              }}
              className="glass-btn rounded-lg px-2.5 py-1 text-[11.5px] text-muted hover:text-red-300"
            >
              清理
            </button>
          }
        />
        <Row
          title="诊断与日志"
          desc={logText ? '已加载日志（见下方）' : '查看运行日志，或导出诊断包给开发者排查'}
          right={
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  setOpsMsg(null)
                  void diagLogTail(400)
                    .then(setLogText)
                    .catch((e) => setOpsMsg(e instanceof Error ? e.message : String(e)))
                }}
                className="glass-btn rounded-lg px-2.5 py-1 text-[11.5px] text-fg/80 hover:text-gold"
              >
                查看日志
              </button>
              <button
                onClick={() => {
                  setOpsMsg('正在导出…')
                  const payload = {
                    app: 'MiraLite',
                    exportedAt: new Date().toISOString(),
                    info,
                    runtime,
                    sources: {
                      total: sources.length,
                      kinds: sources.map((s) => ({ name: s.name, kind: s.kind, enabled: s.enabled, hasEpg: !!s.epgUrl })),
                    },
                    counts: {
                      channels: channels.length,
                      watchlist: watchlist.length,
                      playback: playback.length,
                    },
                    prefs,
                  }
                  void diagLogTail(800)
                    .then((logs) => diagExport({ ...payload, logs }))
                    .then((r) => setOpsMsg(`已导出：${r.path}`))
                    .catch((e) => setOpsMsg(e instanceof Error ? e.message : String(e)))
                }}
                className="glass-btn rounded-lg px-2.5 py-1 text-[11.5px] text-muted hover:text-gold"
              >
                导出诊断包
              </button>
            </div>
          }
        />
        {opsMsg && <div className="px-5 py-2 text-[10.5px] text-muted">{opsMsg}</div>}
        {logText && (
          <div className="px-5 pb-3">
            <pre className="no-scrollbar max-h-[220px] overflow-auto whitespace-pre-wrap rounded-lg bg-black/35 p-2.5 text-[10px] leading-relaxed text-muted">
              {logText}
            </pre>
            <button
              onClick={() => setLogText(null)}
              className="glass-btn mt-2 rounded-lg px-2.5 py-1 text-[11px] text-muted hover:text-fg"
            >
              收起日志
            </button>
          </div>
        )}
      </Section>

      <WebdavDialog open={webdavOpen} onClose={() => setWebdavOpen(false)} />

      <p className="text-[11px] leading-relaxed text-muted/70">
        MiraLite 不提供任何内容源，仅作为客户端读取你自行连接的来源。所有观看记录与设置都保存在本机。
      </p>
    </div>
  )
}
