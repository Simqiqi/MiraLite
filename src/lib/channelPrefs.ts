/**
 * 直播频道偏好：自定义频道号、成人频道过滤、分组折叠状态。
 * 全部只存本机。
 */
import { useSyncExternalStore } from 'react'
import type { MediaItem } from './types'

export interface ChannelPrefs {
  /** 频道 id → 自定义频道号 */
  numbers: Record<string, number>
  /** 是否开启成人频道过滤 */
  blockAdult: boolean
  /** 自定义屏蔽关键词（与内置词一起生效） */
  blockedWords: string[]
  /** 已折叠的分组名 */
  collapsed: string[]
}

/** 内置的过滤词，命中频道名就不显示（开启过滤时） */
export const ADULT_WORDS = ['成人', '福利', '18+', '十八禁', '裸', '性感', '色情', '深夜剧场']

const KEY = 'miralite.channelPrefs.v1'

const DEFAULTS: ChannelPrefs = {
  numbers: {},
  blockAdult: false,
  blockedWords: [],
  collapsed: [],
}

function load(): ChannelPrefs {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return DEFAULTS
    const parsed = JSON.parse(raw) as Partial<ChannelPrefs>
    return {
      numbers: parsed.numbers ?? {},
      blockAdult: !!parsed.blockAdult,
      blockedWords: Array.isArray(parsed.blockedWords) ? parsed.blockedWords : [],
      collapsed: Array.isArray(parsed.collapsed) ? parsed.collapsed : [],
    }
  } catch {
    return DEFAULTS
  }
}

let state = load()
const listeners = new Set<() => void>()

function commit(next: ChannelPrefs) {
  state = next
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    /* ignore */
  }
  listeners.forEach((l) => l())
}

export function useChannelPrefs(): ChannelPrefs {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l)
      return () => listeners.delete(l)
    },
    () => state,
    () => state,
  )
}

export function getChannelPrefs(): ChannelPrefs {
  return state
}

export function setChannelNumber(id: string, num: number) {
  const numbers = { ...state.numbers }
  if (num > 0) numbers[id] = Math.round(num)
  else delete numbers[id]
  commit({ ...state, numbers })
}

export function clearChannelNumbers() {
  commit({ ...state, numbers: {} })
}

export function setBlockAdult(on: boolean) {
  commit({ ...state, blockAdult: on })
}

export function setBlockedWords(words: string[]) {
  commit({ ...state, blockedWords: words.map((w) => w.trim()).filter(Boolean).slice(0, 50) })
}

export function toggleCollapsed(group: string) {
  const has = state.collapsed.includes(group)
  commit({
    ...state,
    collapsed: has ? state.collapsed.filter((g) => g !== group) : [...state.collapsed, group],
  })
}

/** 命中屏蔽词（开启过滤时用） */
export function isBlocked(title: string): boolean {
  if (!state.blockAdult) return false
  const words = [...ADULT_WORDS, ...state.blockedWords]
  const t = title.toLowerCase()
  return words.some((w) => w && t.includes(w.toLowerCase()))
}

/** 按「自定义频道号优先、其余按原顺序」排出频道表，并带上显示用的频道号 */
export function orderedChannels(list: MediaItem[]): Array<{ item: MediaItem; number: number }> {
  const withNumber = list.map((item, i) => ({ item, number: state.numbers[item.id] ?? 0, fallback: i + 1 }))
  const numbered = withNumber.filter((x) => x.number > 0).sort((a, b) => a.number - b.number)
  const rest = withNumber.filter((x) => x.number === 0)

  const taken = new Set(numbered.map((x) => x.number))
  let cursor = 1
  const out: Array<{ item: MediaItem; number: number }> = [...numbered]
  for (const r of rest) {
    while (taken.has(cursor)) cursor += 1
    taken.add(cursor)
    out.push({ item: r.item, number: cursor })
  }
  return out
}