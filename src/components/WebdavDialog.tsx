/**
 * WebDAV 云端同步弹窗：配置地址账号、测试连通、上传 / 恢复备份。
 */
import { useEffect, useState } from 'react'
import { AlertCircle, CheckCircle2, CloudDownload, CloudUpload, Loader2, X } from 'lucide-react'
import { downloadBackup, getWebdav, setWebdav, testWebdav, uploadBackup, type WebdavView } from '../lib/webdav'

export default function WebdavDialog({
  open,
  onClose,
  onRestored,
}: {
  open: boolean
  onClose: () => void
  onRestored?: () => void
}) {
  const [view, setView] = useState<WebdavView | null>(null)
  const [url, setUrl] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState<'save' | 'test' | 'up' | 'down' | null>(null)
  const [msg, setMsg] = useState<{ kind: 'ok' | 'err'; text: string } | null>(null)

  useEffect(() => {
    if (!open) return
    setMsg(null)
    setPassword('')
    void getWebdav().then((v) => {
      setView(v)
      setUrl(v.url)
      setUsername(v.username)
    })
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open, onClose])

  if (!open) return null

  const run = async (kind: 'save' | 'test' | 'up' | 'down', fn: () => Promise<string>) => {
    setBusy(kind)
    setMsg(null)
    try {
      setMsg({ kind: 'ok', text: await fn() })
    } catch (e) {
      setMsg({ kind: 'err', text: e instanceof Error ? e.message : String(e) })
    } finally {
      setBusy(null)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center px-6" role="dialog" aria-modal="true">
      <button aria-label="关闭" onClick={onClose} className="absolute inset-0 bg-black/55 backdrop-blur-[3px]" />
      <div className="glass-panel relative z-10 w-full max-w-[540px] overflow-hidden rounded-2xl">
        <header className="flex items-center gap-2.5 border-b border-white/10 px-5 py-3.5">
          <CloudUpload size={15} className="text-gold" />
          <span className="text-[13px] font-medium">云端同步（WebDAV）</span>
          <span
            className={`ml-auto rounded-full px-2 py-0.5 text-[10.5px] ${
              view?.configured ? 'bg-emerald-400/12 text-emerald-300' : 'bg-white/8 text-muted'
            }`}
          >
            {view?.configured ? '已配置' : '未配置'}
          </span>
          <button onClick={onClose} className="glass-btn rounded-lg p-1.5 text-muted hover:text-fg">
            <X size={13} />
          </button>
        </header>

        <div className="px-5 py-4">
          <p className="text-[11.5px] leading-relaxed text-muted">
            支持坚果云 / Nextcloud / 群晖等标准 WebDAV。填到目录即可（会自动追加文件名
            <span className="text-fg/80"> miralite-backup.json</span>）。坚果云需要用它生成的「应用密码」。
          </p>

          <div className="mt-3.5 grid grid-cols-1 gap-2 sm:grid-cols-[1.4fr_1fr]">
            <label className="block">
              <span className="mb-1 block text-[10.5px] text-muted">WebDAV 地址</span>
              <input
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                placeholder="https://dav.jianguoyun.com/dav/MiraLite"
                spellCheck={false}
                className="glass-input w-full rounded-lg px-2.5 py-1.5 text-[11.5px] outline-none"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-[10.5px] text-muted">账号</span>
              <input
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                spellCheck={false}
                className="glass-input w-full rounded-lg px-2.5 py-1.5 text-[11.5px] outline-none"
              />
            </label>
          </div>

          <label className="mt-2 block">
            <span className="mb-1 block text-[10.5px] text-muted">
              密码 / 应用密码{view?.hasPassword ? '（已保存，留空表示不改）' : ''}
            </span>
            <input
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              spellCheck={false}
              className="glass-input w-full rounded-lg px-2.5 py-1.5 text-[11.5px] outline-none"
            />
          </label>

          <div className="mt-3.5 flex flex-wrap items-center gap-2">
            <button
              onClick={() =>
                void run('save', async () => {
                  const v = await setWebdav(url, username, password || undefined)
                  setView(v)
                  setPassword('')
                  return v.configured ? '已保存 WebDAV 配置' : '已清空地址'
                })
              }
              disabled={busy !== null}
              className="glass-primary flex items-center gap-1.5 rounded-lg px-3.5 py-2 text-[11.5px] font-semibold disabled:opacity-50"
            >
              {busy === 'save' ? <Loader2 size={12} className="animate-spin" /> : null}
              保存
            </button>
            <button
              onClick={() => void run('test', () => testWebdav())}
              disabled={busy !== null || !view?.configured}
              className="glass-btn rounded-lg px-3 py-2 text-[11.5px] text-muted hover:text-gold disabled:opacity-50"
            >
              {busy === 'test' ? '测试中…' : '测试连接'}
            </button>
            <button
              onClick={() =>
                void run('up', async () => {
                  const r = await uploadBackup()
                  return `已上传 ${r.keys} 项配置（${Math.round(r.bytes / 1024)} KB）`
                })
              }
              disabled={busy !== null || !view?.configured}
              className="glass-btn flex items-center gap-1.5 rounded-lg px-3 py-2 text-[11.5px] text-fg/85 hover:text-gold disabled:opacity-50"
            >
              <CloudUpload size={12} /> {busy === 'up' ? '上传中…' : '上传备份'}
            </button>
            <button
              onClick={() =>
                void run('down', async () => {
                  const n = await downloadBackup()
                  onRestored?.()
                  window.setTimeout(() => window.location.reload(), 700)
                  return `已恢复 ${n} 项配置，正在刷新…`
                })
              }
              disabled={busy !== null || !view?.configured}
              className="glass-btn flex items-center gap-1.5 rounded-lg px-3 py-2 text-[11.5px] text-muted hover:text-gold disabled:opacity-50"
            >
              <CloudDownload size={12} /> {busy === 'down' ? '恢复中…' : '从云端恢复'}
            </button>
          </div>

          {msg && (
            <div
              className={`mt-2.5 flex items-center gap-1.5 text-[10.5px] ${
                msg.kind === 'ok' ? 'text-emerald-300' : 'text-amber-300'
              }`}
            >
              {msg.kind === 'ok' ? <CheckCircle2 size={11} /> : <AlertCircle size={11} />}
              {msg.text}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}