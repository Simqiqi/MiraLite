/**
 * 本地字幕：找同名字幕 → 读原文（UTF-8 / GBK 自动识别）→ 转成 WebVTT → Blob URL。
 *
 * <track> 只吃 WebVTT，所以 SRT / ASS 都在这里转一遍；ASS 只保留对白，
 * 样式（字体、位置、特效）会被丢弃，够看就行。
 */
import { invoke } from '@tauri-apps/api/core'
import { inTauri } from './cat'

export interface SubtitleTrack {
  label: string
  url: string
}

interface SubtitleFile {
  path: string
  name: string
}

function b64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64)
  const out = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i)
  return out
}

/** 先按 UTF-8 严格解，失败再按 GB18030（兼容 GBK） */
function decodeText(bytes: Uint8Array): string {
  try {
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes)
  } catch {
    try {
      return new TextDecoder('gb18030').decode(bytes)
    } catch {
      return new TextDecoder('utf-8').decode(bytes)
    }
  }
}

function normalizeTime(t: string): string {
  // SRT: 00:00:01,200  →  VTT: 00:00:01.200
  const s = t.trim().replace(',', '.')
  const m = /^(\d{1,2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/.exec(s)
  if (!m) return '00:00:00.000'
  const ms = (m[4] ?? '0').padEnd(3, '0')
  return `${String(Number(m[1])).padStart(2, '0')}:${m[2]}:${m[3]}.${ms}`
}

export function srtToVtt(text: string): string {
  const body = text
    .replace(/\r\n?/g, '\n')
    .replace(/^\uFEFF/, '')
    .replace(/(\d{1,2}:\d{2}:\d{2}),(\d{1,3})/g, '$1.$2')
  return `WEBVTT\n\n${body.trim()}\n`
}

/** ASS/SSA：只取 [Events] 里的 Dialogue，去掉 {\...} 样式标签 */
export function assToVtt(text: string): string {
  const lines = text.replace(/\r\n?/g, '\n').split('\n')
  let inEvents = false
  let startIdx = 1
  let endIdx = 2
  let textIdx = 9
  const cues: string[] = []

  for (const raw of lines) {
    const line = raw.trim()
    if (/^\[events\]$/i.test(line)) {
      inEvents = true
      continue
    }
    if (line.startsWith('[')) {
      inEvents = false
      continue
    }
    if (!inEvents) continue

    if (/^format\s*:/i.test(line)) {
      const cols = line
        .slice(line.indexOf(':') + 1)
        .split(',')
        .map((c) => c.trim().toLowerCase())
      const si = cols.indexOf('start')
      const ei = cols.indexOf('end')
      const ti = cols.indexOf('text')
      if (si >= 0) startIdx = si
      if (ei >= 0) endIdx = ei
      if (ti >= 0) textIdx = ti
      continue
    }
    if (!/^dialogue\s*:/i.test(line)) continue

    const body = line.slice(line.indexOf(':') + 1)
    const parts = body.split(',')
    if (parts.length <= Math.max(startIdx, endIdx, textIdx)) continue
    // Text 是最后一个字段，里面可能自带逗号，需要把剩余部分拼回去
    const textPart = parts.slice(textIdx).join(',')
    const content = textPart
      .replace(/\{[^}]*\}/g, '')
      .replace(/\\N|\\n/gi, '\n')
      .replace(/\\h/gi, ' ')
      .trim()
    if (!content) continue
    cues.push(`${normalizeTime(parts[startIdx])} --> ${normalizeTime(parts[endIdx])}\n${content}`)
  }

  return `WEBVTT\n\n${cues.join('\n\n')}\n`
}

function toVtt(text: string, name: string): string {
  const lower = name.toLowerCase()
  if (lower.endsWith('.ass') || lower.endsWith('.ssa')) return assToVtt(text)
  if (lower.endsWith('.vtt')) {
    return /^WEBVTT/.test(text.trimStart()) ? text : `WEBVTT\n\n${text}`
  }
  return srtToVtt(text)
}

/**
 * 为本地视频找并加载字幕，返回可直接塞进 <track> 的 Blob URL。
 * 调用方负责在有新列表 / 卸载时 revoke 旧 URL。
 */
export async function loadSubtitles(videoPath: string): Promise<SubtitleTrack[]> {
  if (!inTauri() || !videoPath) return []
  const files = (await invoke('find_subtitles', { videoPath })) as SubtitleFile[]
  if (!Array.isArray(files) || files.length === 0) return []

  const tracks: SubtitleTrack[] = []
  for (const f of files.slice(0, 8)) {
    try {
      const b64 = (await invoke('read_subtitle_b64', { path: f.path })) as string
      const text = decodeText(b64ToBytes(b64))
      const vtt = toVtt(text, f.name)
      const url = URL.createObjectURL(new Blob([vtt], { type: 'text/vtt' }))
      tracks.push({ label: f.name.replace(/\.[^.]+$/, ''), url })
    } catch {
      /* 单个字幕坏了就跳过 */
    }
  }
  return tracks
}