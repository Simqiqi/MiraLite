/**
 * 播放队列：把「一集接一集」串起来。
 *
 * 队列项分三种：直链/本地文件走 path；片库点播走 vod；短剧走 short（下一集需要现场解密）。
 */
import { useSyncExternalStore } from 'react'

export type QueueItem =
  | { kind: 'path'; name: string; path: string }
  | { kind: 'vod'; name: string; sourceId: string; streamId: number; ext: string; poster?: string }
  | { kind: 'short'; name: string; seriesId: string; episodeId: string; epNumber: number; cover?: string }

interface QueueState {
  items: QueueItem[]
  index: number
}

let state: QueueState = { items: [], index: 0 }
const listeners = new Set<() => void>()

function commit(next: QueueState) {
  state = next
  listeners.forEach((l) => l())
}

export function useQueue(): QueueState {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => state,
    () => state,
  )
}

export function setQueue(items: QueueItem[], index = 0) {
  if (items.length === 0) {
    clearQueue()
    return
  }
  commit({ items, index: Math.max(0, Math.min(index, items.length - 1)) })
}

export function clearQueue() {
  commit({ items: [], index: 0 })
}

/** 当前项之后的下一项（不改变状态） */
export function peekNext(): QueueItem | null {
  return state.items[state.index + 1] ?? null
}

/** 推进到下一条，返回它 */
export function advance(): QueueItem | null {
  const next = state.items[state.index + 1]
  if (!next) return null
  commit({ items: state.items, index: state.index + 1 })
  return next
}
