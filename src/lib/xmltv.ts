/**
 * XMLTV 节目单解析：给 M3U 源补 EPG。
 *
 * XMLTV 时间形如 `20261120193000 +0800`，这里换算成时间戳；只保留关心的频道，
 * 每个频道最多留 limit 条，避免大文件把内存和 localStorage 撑爆。
 */
import type { EpgProgram } from './epg'

const TIME_RE = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})?\s*([+-]\d{4})?$/

export function parseXmltvTime(raw: string): number {
  const m = TIME_RE.exec(raw.trim())
  if (!m) return Number.NaN
  const [, y, mo, d, h, mi, se, tz] = m
  const base = Date.UTC(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi),
    Number(se ?? '00'),
  )
  if (!tz) return base
  const sign = tz.startsWith('-') ? -1 : 1
  const offsetMin = sign * (Number(tz.slice(1, 3)) * 60 + Number(tz.slice(3, 5)))
  return base - offsetMin * 60_000
}

export interface XmltvParseOptions {
  /** 只保留这些频道的节目（tvg-id） */
  channelIds?: Set<string>
  /** 每个频道最多保留多少条 */
  perChannel?: number
  /** 总共最多保留多少条 */
  total?: number
}

export function parseXmltv(text: string, opts: XmltvParseOptions = {}): Map<string, EpgProgram[]> {
  const perChannel = opts.perChannel ?? 64
  const totalCap = opts.total ?? 8000
  const out = new Map<string, EpgProgram[]>()

  if (typeof DOMParser === 'undefined') return out
  const doc = new DOMParser().parseFromString(text, 'text/xml')
  if (doc.getElementsByTagName('parsererror').length > 0) return out

  // channel 节点里的 display-name 按 id 建索引（频道名匹配时兜底用）
  const nameToId = new Map<string, string>()
  for (const node of Array.from(doc.getElementsByTagName('channel'))) {
    const id = node.getAttribute('id') ?? ''
    if (!id) continue
    const dn = node.getElementsByTagName('display-name')[0]?.textContent?.trim()
    if (dn) nameToId.set(dn, id)
  }

  let count = 0
  for (const node of Array.from(doc.getElementsByTagName('programme'))) {
    if (count >= totalCap) break
    let channel = node.getAttribute('channel') ?? ''
    if (!channel) continue
    if (opts.channelIds && !opts.channelIds.has(channel)) {
      // 用频道名兜底匹配
      const dn = node.getElementsByTagName('display-name')[0]?.textContent?.trim()
      const mapped = dn ? nameToId.get(dn) : undefined
      if (!mapped || !opts.channelIds.has(mapped)) continue
      channel = mapped
    }

    const startTs = parseXmltvTime(node.getAttribute('start') ?? '')
    const stopTs = parseXmltvTime(node.getAttribute('stop') ?? '')
    const title = node.getElementsByTagName('title')[0]?.textContent?.trim() ?? ''
    if (!title) continue
    const desc = node.getElementsByTagName('desc')[0]?.textContent?.trim() ?? ''

    const list = out.get(channel) ?? []
    if (list.length >= perChannel) continue
    list.push({
      id: `${channel}-${startTs}`,
      title,
      description: desc,
      start: '',
      end: '',
      startTs: Number.isFinite(startTs) ? Math.round(startTs / 1000) : undefined,
      stopTs: Number.isFinite(stopTs) ? Math.round(stopTs / 1000) : undefined,
      nowPlaying: false,
      hasArchive: false,
    })
    out.set(channel, list)
    count += 1
  }

  for (const [k, list] of out) {
    list.sort((a, b) => (a.startTs ?? 0) - (b.startTs ?? 0))
    out.set(k, list)
  }
  return out
}
