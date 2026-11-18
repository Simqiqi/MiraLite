/**
 * 频道体检结果：内存 + localStorage 存 6 小时，直播页标红、换台时自动跳过。
 *
 * 探测在 Rust 侧做（短超时 + Range 读头部），前端只负责限并发和展示。
 */
import { useSyncExternalStore } from 'react'
import { invoke } from '@tauri-apps/api/core'
import { inTauri } from './cat'
import type { MediaItem } from './types'

export interface HealthEntry {
  ok: boolean
  /** 检测时间戳 */
  at: number
  /** 响应耗时（毫秒），失败时为超时耗时 */
  ms: number
  message: string
}

export interface ProbeResult {
  ok: boolean
  status: number
  ms: number
  message: string
}

const KEY = 'miralite.health.v1'
const TTL = 6 * 60 * 60 * 1000

function load(): Record<string, HealthEntry> {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, HealthEntry>
    const now = Date.now()
    const out: Record<string, HealthEntry> = {}
    for (const [id, e] of Object.entries(parsed)) {
      if (e && typeof e.at === 'number' && now - e.at < TTL) out[id] = e
    }
    return out
  } catch {
    return {}
  }
}

let state: Record<string, HealthEntry> = load()
const listeners = new Set<() => void>()

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(state))
  } catch {
    /* 配额不足就只留内存 */
  }
}

function set(next: Record<string, HealthEntry>) {
  state = next
  persist()
  listeners.forEach((l) => l())
}

function subscribe(l: () => void) {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function useHealth(): Record<string, HealthEntry> {
  return useSyncExternalStore(subscribe, () => state, () => state)
}

export function healthOf(id: string): HealthEntry | undefined {
  const e = state[id]
  if (!e) return undefined
  return Date.now() - e.at < TTL ? e : undefined
}

/** 已知失效（6 小时内检出过） */
export function isDead(id: string): boolean {
  return healthOf(id)?.ok === false
}

export function clearHealth() {
  set({})
}

/**
 * 批量体检，限并发。每完成一个就回调一次，方便页面逐步刷新。
 */
export async function probeChannels(
  items: MediaItem[],
  opts: {
    concurrency?: number
    onProgress?: (done: number, total: number) => void
    onEach?: (id: string, entry: HealthEntry) => void
    signal?: { cancelled: boolean }
  } = {},
): Promise<number> {
  if (!inTauri()) throw new Error('频道体检需要在 App 内运行')
  const queue = items.filter((i) => !!i.streamUrl)
  const concurrency = Math.max(1, opts.concurrency ?? 4)
  let cursor = 0
  let done = 0
  let okCount = 0

  async function worker() {
    while (cursor < queue.length) {
      if (opts.signal?.cancelled) return
      const item = queue[cursor]
      cursor += 1
      let entry: HealthEntry
      try {
        const r = (await invoke('probe_url', { url: item.streamUrl })) as ProbeResult
        entry = { ok: !!r.ok, at: Date.now(), ms: Number(r.ms) || 0, message: String(r.message ?? '') }
      } catch (e) {
        entry = {
          ok: false,
          at: Date.now(),
          ms: 0,
          message: e instanceof Error ? e.message : String(e),
        }
      }
      if (opts.signal?.cancelled) return
      state = { ...state, [item.id]: entry }
      if (entry.ok) okCount += 1
      done += 1
      opts.onEach?.(item.id, entry)
      opts.onProgress?.(done, queue.length)
    }
  }

  await Promise.all(Array.from({ length: Math.min(concurrency, queue.length) }, worker))
  set({ ...state })
  return okCount
}