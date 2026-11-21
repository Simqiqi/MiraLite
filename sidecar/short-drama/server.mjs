/**
 * MiraLite 短剧 sidecar。
 *
 * 用 openhongguo（匿名设备、免登录、免费）取目录与分集播放信息；红果的分片是
 * CENC(cenc-aes-ctr) 加密的，SDK 会同时给出内容密钥，这里自己解密后落到本地缓存，
 * 再把明文 mp4 路径交给 App 播放（WebKit 播不了加密流，也没有 ffmpeg 依赖）。
 *
 * 只监听 127.0.0.1，供本机 App 调用；启动：node server.mjs --port 9978 --cache <dir>
 */
import { createServer } from 'node:http'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { createClient } from 'openhongguo'
import { decryptMp4 } from './decrypt.mjs'

const args = process.argv.slice(2)
const argOf = (name, fallback) => {
  const i = args.indexOf(`--${name}`)
  return i >= 0 && args[i + 1] ? args[i + 1] : fallback
}
const PORT = Number(argOf('port', '9978'))
const CACHE_DIR = argOf('cache', join(process.env.HOME ?? '.', 'Library/Caches/com.miralite.app/short-drama'))

mkdirSync(CACHE_DIR, { recursive: true })

let client = null
let warmed = false

async function getClient() {
  if (!client) {
    client = await createClient()
    warmed = false
  }
  // SDK 的取流接口需要先有一次轻量调用建立会话，否则会返回 ANONYMOUS_LIMITED
  if (!warmed) {
    for (const warm of [() => client.hotSearch(), () => client.search('短剧', { page: 1 })]) {
      try {
        await warm()
        warmed = true
        break
      } catch {
        /* 换下一种预热方式 */
      }
    }
  }
  return client
}

const json = (res, code, data) => {
  const body = JSON.stringify(data)
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body) })
  res.end(body)
}

/** 把 SDK 的结构收敛成前端好用的形状 */
function toDrama(s) {
  if (!s) return null
  return {
    id: String(s.id ?? s.series_id ?? ''),
    title: s.title ?? '',
    description: s.description ?? '',
    cover: s.cover_url ?? s.cover ?? '',
    episodes: Number(s.episode_count ?? s.episodes ?? 0) || 0,
    tags: Array.isArray(s.tags) ? s.tags : [],
  }
}

/** 上游偶发限流（anonymous response was empty）时，换一台匿名设备重试 */
async function withClient(fn) {
  let lastErr = null
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      const c = await getClient()
      return await fn(c)
    } catch (e) {
      lastErr = e
      const code = String(e?.code ?? '')
      const limited = /LIMITED|EMPTY|RATE|429|TOO_MANY/i.test(code) || /empty|limit|too many/i.test(String(e?.message ?? ''))
      if (!limited || attempt === 3) break
      // 换一台匿名设备再试，稍等一下避免又撞限流
      try {
        await client?.resetDevice()
      } catch {
        /* 重置失败就重建客户端 */
      }
      client = null
      warmed = false
      await new Promise((r) => setTimeout(r, 1200 * attempt))
    }
  }
  throw lastErr
}

/** 串行化 SDK 调用，避免并发把匿名设备打到限流 */
let chain = Promise.resolve()
function serialize(fn) {
  const run = chain.then(fn, fn)
  chain = run.then(
    () => undefined,
    () => undefined,
  )
  return run
}

const routes = {
  async '/health'() {
    return { ok: true, cache: CACHE_DIR, version: 1 }
  },

  /** 上新日历（默认今天） */
  async '/new'(url) {
    const date = url.searchParams.get('date') || undefined
    return withClient(async (c) => {
      const page = await c.newReleases(date ? { date } : undefined)
      return { date: page?.date ?? '', items: (page?.items ?? []).map(toDrama).filter((x) => x && x.id) }
    })
  },

  async '/search'(url) {
    const q = (url.searchParams.get('q') ?? '').trim()
    if (!q) return { items: [] }
    const page = Number(url.searchParams.get('page') ?? 1) || 1
    return withClient(async (c) => {
      const r = await c.search(q, { page })
      return { items: (r?.items ?? []).map(toDrama).filter((x) => x && x.id) }
    })
  },

  async '/series'(url) {
    const id = url.searchParams.get('id')
    return withClient(async (c) => toDrama(await c.getSeries(id)))
  },

  async '/episodes'(url) {
    const id = url.searchParams.get('id')
    return withClient(async (c) => {
      const page = await c.listEpisodes(id, { page: 1 })
      const items = (page?.items ?? []).map((e) => ({
        id: String(e.id),
        number: Number(e.number ?? 0),
        title: e.title ?? '',
        playable: e.playable !== false,
        duration: Number(e.duration ?? 0) || 0,
      }))
      return { items, playable: items.filter((x) => x.playable).length }
    })
  },

  /**
   * 取某一集：解析播放信息 → 下载 → 解密 → 写缓存 → 返回本地路径
   * body: { episodeId, definition? }
   */
  async '/prepare'(url, body) {
    const episodeId = body?.episodeId
    const seriesId = body?.seriesId
    const definition = body?.definition || '540p'
    if (!episodeId) throw new Error('缺少 episodeId')
    return withClient(async (c) => {
      // 取流前先用这部剧的分集列表「握手」，SDK 没这一步会返回空
      if (seriesId) {
        try {
          await c.listEpisodes(seriesId, { page: 1 })
        } catch {
          /* 握手失败也让 resolve 自己试 */
        }
      }
      const r = await c.resolvePlayback(episodeId)
      const pb = r.playback
      if (!pb) throw new Error('没有拿到播放信息')
      const streams = pb.streams ?? []
      const stream = streams.find((s) => s.definition === definition) ?? streams[0]
      if (!stream?.url) throw new Error('没有可用的清晰度')

      const key = r.contentKey?.key
      if (!key) throw new Error(r.contentKeyError?.message || '这一集拿不到解密密钥，换一集试试')

      const tag = createHash('sha1').update(`${episodeId}|${stream.definition ?? ''}`).digest('hex').slice(0, 16)
      const file = join(CACHE_DIR, `${tag}.mp4`)

      if (existsSync(file)) {
        return { path: file, cached: true, definition: stream.definition, duration: pb.duration_seconds ?? 0 }
      }

      const resp = await fetch(stream.url)
      if (!resp.ok) throw new Error(`下载失败：HTTP ${resp.status}`)
      const cipher = Buffer.from(await resp.arrayBuffer())
      const { mp4 } = decryptMp4(cipher, key)
      writeFileSync(file, mp4)

      return {
        path: file,
        cached: false,
        definition: stream.definition,
        duration: pb.duration_seconds ?? 0,
        bytes: mp4.length,
      }
    })
  },

  /** 缓存信息：条数与占用 */
  async '/cache'() {
    return { dir: CACHE_DIR }
  },

  /** 队列快照 */
  async '/queue'() {
    return queueSnapshot()
  },

  /** 把若干集加入下载队列（串行处理，失败不阻塞后面的） */
  async '/queue/add'(url, body) {
    const seriesId = String(body?.seriesId ?? '')
    const title = String(body?.title ?? '')
    const list = Array.isArray(body?.episodes) ? body.episodes : []
    if (!seriesId || list.length === 0) throw new Error('缺少 seriesId 或 episodes')
    let added = 0
    for (const ep of list) {
      const episodeId = String(ep?.id ?? ep?.episodeId ?? '')
      if (!episodeId) continue
      if (queue.some((q) => q.episodeId === episodeId)) continue
      queue.push({
        seriesId,
        episodeId,
        number: Number(ep?.number ?? 0) || 0,
        title,
        status: 'pending',
        error: '',
        path: '',
        bytes: 0,
      })
      added += 1
    }
    void pump()
    return { added, ...queueSnapshot() }
  },

  /** 清掉已完成/失败的条目 */
  async '/queue/clear'() {
    queue = queue.filter((q) => q.status === 'pending' || q.status === 'working')
    return queueSnapshot()
  },
}

// ---------------------------------------------------------------- 下载队列（串行）

let queue = []
let pumping = false

function queueSnapshot() {
  return {
    running: pumping,
    items: queue.map((q) => ({
      episodeId: q.episodeId,
      seriesId: q.seriesId,
      number: q.number,
      title: q.title,
      status: q.status,
      error: q.error,
      path: q.path,
      bytes: q.bytes,
    })),
  }
}

async function processOne(job) {
  job.status = 'working'
  try {
    const c = await getClient()
    try {
      await c.listEpisodes(job.seriesId, { page: 1 })
    } catch {
      /* 握手失败也让 resolve 自己试 */
    }
    const r = await c.resolvePlayback(job.episodeId)
    const pb = r.playback
    const stream = (pb?.streams ?? []).find((s) => s.definition === '540p') ?? pb?.streams?.[0]
    if (!stream?.url) throw new Error('没有可用的清晰度')
    const key = r.contentKey?.key
    if (!key) throw new Error(r.contentKeyError?.message || '拿不到解密密钥')

    const tag = createHash('sha1').update(`${job.episodeId}|${stream.definition ?? ''}`).digest('hex').slice(0, 16)
    const file = join(CACHE_DIR, `${tag}.mp4`)
    if (existsSync(file)) {
      job.status = 'done'
      job.path = file
      job.bytes = statSync(file).size
      return
    }
    const resp = await fetch(stream.url)
    if (!resp.ok) throw new Error(`下载失败 HTTP ${resp.status}`)
    const { mp4 } = decryptMp4(Buffer.from(await resp.arrayBuffer()), key)
    writeFileSync(file, mp4)
    job.status = 'done'
    job.path = file
    job.bytes = mp4.length
  } catch (e) {
    job.status = 'failed'
    job.error = e?.message ?? String(e)
    // 被限流时把设备换掉，后面的条目才可能成功
    if (/LIMITED|empty/i.test(job.error)) {
      try {
        await client?.resetDevice()
      } catch {
        /* ignore */
      }
      client = null
      warmed = false
    }
  }
}

/** 串行泵：一次只处理一集，条目之间留间隔，别把上游打爆 */
async function pump() {
  if (pumping) return
  pumping = true
  try {
    for (;;) {
      const job = queue.find((q) => q.status === 'pending')
      if (!job) break
      await processOne(job)
      await new Promise((r) => setTimeout(r, 1500))
    }
  } finally {
    pumping = false
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', `http://127.0.0.1:${PORT}`)
  const handler = routes[url.pathname]
  if (!handler) return json(res, 404, { error: 'not found' })

  let body = null
  if (req.method === 'POST') {
    const chunks = []
    for await (const chunk of req) chunks.push(chunk)
    if (chunks.length) {
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'))
      } catch {
        return json(res, 400, { error: '请求体不是合法 JSON' })
      }
    }
  }

  try {
    const data = await serialize(() => handler(url, body))
    return json(res, 200, data)
  } catch (e) {
    const message = e?.message ?? String(e)
    const code = e?.code ?? ''
    return json(res, 500, { error: message, code })
  }
})

server.listen(PORT, '127.0.0.1', () => {
  console.log(`[short-drama] listening on 127.0.0.1:${PORT}, cache=${CACHE_DIR}`)
})
