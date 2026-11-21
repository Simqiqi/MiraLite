/**
 * 节目提醒：把「某频道某档节目」记下来，到点弹系统通知。
 *
 * 只用 localStorage + 一个 30 秒轮询的定时器，不做后台常驻；
 * 定时器在 Shell 里启动一次，切换页面也不会重复。
 */
import { useSyncExternalStore } from 'react'
import { notify } from './system'

export interface Reminder {
  id: string
  /** 触发时间（毫秒） */
  at: number
  title: string
  /** 通知内容，一般是频道名 */
  body: string
}

const KEY = 'miralite.reminders.v1'
/** 提醒提前量：开播前 5 分钟 */
export const LEAD_MS = 5 * 60 * 1000

function load(): Reminder[] {
  try {
    const raw = localStorage.getItem(KEY)
    const list = raw ? (JSON.parse(raw) as unknown) : []
    if (!Array.isArray(list)) return []
    const now = Date.now()
    return list
      .filter((x): x is Reminder => {
        const r = x as Reminder
        return !!r && typeof r.at === 'number' && typeof r.title === 'string' && r.at > now - 60_000
      })
      .slice(0, 60)
  } catch {
    return []
  }
}

let items: Reminder[] = load()
const listeners = new Set<() => void>()

function commit(next: Reminder[]) {
  items = next
  try {
    localStorage.setItem(KEY, JSON.stringify(next))
  } catch {
    /* 存不下就只留内存 */
  }
  listeners.forEach((l) => l())
}

function subscribe(l: () => void) {
  listeners.add(l)
  return () => listeners.delete(l)
}

export function useReminders(): Reminder[] {
  return useSyncExternalStore(subscribe, () => items, () => items)
}

export function reminderId(channelId: string, startAt: number): string {
  return `${channelId}@${startAt}`
}

export function hasReminder(channelId: string, startAt: number): boolean {
  return items.some((r) => r.id === reminderId(channelId, startAt))
}

/** 添加提醒；返回是否新增成功（已过期不加） */
export function addReminder(input: { id: string; at: number; title: string; body: string }): boolean {
  if (input.at <= Date.now()) return false
  if (items.some((r) => r.id === input.id)) return true
  commit([...items, { ...input }].sort((a, b) => a.at - b.at).slice(0, 60))
  return true
}

export function removeReminder(id: string) {
  commit(items.filter((r) => r.id !== id))
}

let started = false

/** 启动轮询（Shell 里调用一次即可） */
export function startReminderScheduler() {
  if (started) return
  started = true
  const tick = () => {
    const now = Date.now()
    const due = items.filter((r) => r.at <= now)
    if (due.length === 0) return
    for (const r of due) void notify(r.title, r.body)
    commit(items.filter((r) => r.at > now))
  }
  tick()
  window.setInterval(tick, 30_000)
}