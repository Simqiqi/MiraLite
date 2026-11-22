/**
 * 内嵌网页：调用 Rust 在 App 窗口里创建一个子 Webview 打开外部网站。
 * 位置/大小由内容区元素的实际 rect 决定，窗口变化时同步。
 */
import { invoke } from '@tauri-apps/api/core'
import { inTauri } from './cat'

export interface SiteStatus {
  open: boolean
  url: string
}

export interface Bounds {
  x: number
  y: number
  width: number
  height: number
}

export async function siteOpen(url: string, bounds: Bounds): Promise<void> {
  await invoke('site_open', { url, ...bounds })
}

export async function siteBounds(bounds: Bounds): Promise<void> {
  await invoke('site_bounds', { ...bounds })
}

export async function siteNavigate(url: string): Promise<void> {
  await invoke('site_navigate', { url })
}

export async function siteReload(): Promise<void> {
  await invoke('site_reload')
}

export async function siteClose(): Promise<void> {
  await invoke('site_close')
}

export async function siteStatus(): Promise<SiteStatus> {
  if (!inTauri()) return { open: false, url: '' }
  try {
    return (await invoke('site_status')) as SiteStatus
  } catch {
    return { open: false, url: '' }
  }
}

/** 交给系统默认浏览器打开（登录/播放更稳） */
export async function openExternally(url: string): Promise<void> {
  await invoke('open_url', { url, browser: null })
}
