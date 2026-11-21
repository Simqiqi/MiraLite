/**
 * 短剧观看进度：记住每部剧看到第几集、第几秒（只存本机）。
 */
import { useSyncExternalStore } from 'react'

export interface ShortProgressEntry {
  seriesId: string
  title: string
  cover?: string
  episodeId: string
  epNumber: number
  seconds: number
  duration: number
  updatedAt: number
}

const KEY = 'miralite.shortProgress.v1'
const MAX = 40

function load(): ShortProgressEntry[] {
  try {
    const raw = localStorage.getItem(KEY)
    const list = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(list) ? (list as ShortProgressEntry[]).slice(0, MAX) : []
  } catch {
    return []
  }
}

let items = load()
const listeners = new Set<() => void>()

function commit(next: ShortProgressEntry[]) {
  items = next.slice(0, MAX)
  try {
    localStorage.setItem(KEY, JSON.stringify(items))
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l())
}

export function useShortProgress(): ShortProgressEntry[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => items,
    () => items,
  )
}

export function getShortProgress(seriesId: string): ShortProgressEntry | null {
  return items.find((x) => x.seriesId === seriesId) ?? null
}

export function saveShortProgress(entry: Omit<ShortProgressEntry, 'updatedAt'>, seconds: number, duration: number) {
  const next: ShortProgressEntry = { ...entry, seconds, duration, updatedAt: Date.now() }
  commit([next, ...items.filter((x) => x.seriesId !== entry.seriesId)])
}

export function removeShortProgress(seriesId: string) {
  commit(items.filter((x) => x.seriesId !== seriesId))
}

export function clearShortProgress() {
  commit([])
}
