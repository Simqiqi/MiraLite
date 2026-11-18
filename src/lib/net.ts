/**
 * 文本抓取小工具：Tauri 内走 Rust 的 `http_get_text`（绕开 webview 跨域），
 * 浏览器预览时退回原生 fetch。
 */
import { invoke } from '@tauri-apps/api/core'
import { inTauri } from './cat'

export async function fetchText(url: string): Promise<string> {
  const target = url.trim()
  if (!/^https?:\/\//i.test(target)) throw new Error('只支持 http/https 地址')
  if (inTauri()) return (await invoke('http_get_text', { url: target })) as string
  const res = await fetch(target)
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.text()
}