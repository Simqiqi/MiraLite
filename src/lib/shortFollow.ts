/**
 * 短剧追更：关注一部剧，之后看到分集数变多就提醒一次。
 */
import { useSyncExternalStore } from 'react'
import { notify } from './system'
import type { DramaItem } from './short'

export interface ShortFollow {
  seriesId: string
  title: string
  cover: string
  episodes: number
  updatedAt: number
}

const KEY = 'miralite.shortFollows.v1'

function load(): ShortFollow[] {
  try {
    const raw = localStorage.getItem(KEY)
    const list = raw ? (JSON.parse(raw) as unknown) : []
    return Array.isArray(list) ? (list as ShortFollow[]) : []
  } catch {
    return []
  }
}

let items = load()
const listeners = new Set<() => void>()

function commit(next: ShortFollow[]) {
  items = next
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l())
}

export function useShortFollows(): ShortFollow[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => items,
    () => items,
  )
}

export function isFollowed(seriesId: string): boolean {
  return items.some((x) => x.seriesId === seriesId)
}

export function toggleFollow(item: DramaItem) {
  if (isFollowed(item.id)) {
    commit(items.filter((x) => x.seriesId !== item.id))
    return false
  }
  commit([
    { seriesId: item.id, title: item.title, cover: item.cover, episodes: item.episodes, updatedAt: Date.now() },
    ...items,
  ])
  return true
}

/** 用最新拿到的剧集信息更新关注记录；集数变多就发一次通知 */
export function syncFollowCount(item: DramaItem) {
  const hit = items.find((x) => x.seriesId === item.id)
  if (!hit) return
  if (item.episodes > hit.episodes && hit.episodes > 0) {
    void notify(`${item.title} 更新了`, `新增 ${item.episodes - hit.episodes} 集（共 ${item.episodes} 集）`)
  }
  if (item.episodes !== hit.episodes) {
    commit(
      items.map((x) =>
        x.seriesId === item.id ? { ...x, episodes: item.episodes, updatedAt: Date.now() } : x,
      ),
    )
  }
}
