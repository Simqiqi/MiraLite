/**
 * 片头 / 片尾标记：按「条目」记录一次，之后自动跳过片头、提示跳过片尾。
 * key 规则：短剧 = `short:<seriesId>#<ep>`；CAT = `<siteKey>::<vodId>`；其他 = item.id
 */
export interface Markers {
  introEnd?: number
  outroStart?: number
}

const KEY = 'miralite.skipMarkers.v1'

function loadAll(): Record<string, Markers> {
  try {
    const raw = localStorage.getItem(KEY)
    const parsed = raw ? (JSON.parse(raw) as unknown) : {}
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, Markers>) : {}
  } catch {
    return {}
  }
}

let all = loadAll()

function persist() {
  try {
    localStorage.setItem(KEY, JSON.stringify(all))
  } catch {
    /* ignore */
  }
}

export function getMarkers(key: string): Markers {
  return all[key] ?? {}
}

export function setIntroEnd(key: string, seconds: number) {
  all = { ...all, [key]: { ...getMarkers(key), introEnd: Math.max(0, Math.round(seconds)) } }
  persist()
}

export function setOutroStart(key: string, seconds: number) {
  all = { ...all, [key]: { ...getMarkers(key), outroStart: Math.max(0, Math.round(seconds)) } }
  persist()
}

export function clearMarkers(key: string) {
  const next = { ...all }
  delete next[key]
  all = next
  persist()
}
