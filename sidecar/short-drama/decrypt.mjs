/** 极简 CENC(cenc-aes-ctr) MP4 解密器：去掉加密信令 + 逐样本 AES-CTR 解密 */
import { createDecipheriv } from 'node:crypto'

const u16 = (b, o) => b.readUInt16BE(o)
const u32 = (b, o) => b.readUInt32BE(o)

function* boxes(buf, start, end) {
  let o = start
  while (o + 8 <= end) {
    let size = u32(buf, o)
    const type = buf.toString('latin1', o + 4, o + 8)
    let header = 8
    if (size === 1) { size = Number(buf.readBigUInt64BE(o + 8)); header = 16 } else if (size === 0) size = end - o
    if (size < header || o + size > end) break
    yield { type, start: o, end: o + size, header, size }
    o += size
  }
}
const kids = (buf, box) => [...boxes(buf, box.start + box.header, box.end)]
const child = (buf, box, type) => kids(buf, box).find((k) => k.type === type)
const path = (buf, box, ...types) => {
  let cur = box
  for (const t of types) {
    cur = child(buf, cur, t)
    if (!cur) return null
  }
  return cur
}

const DROP = new Set(['senc', 'saio', 'saiz', 'sgpd', 'sbgp', 'pssh'])
const CONTAINERS = new Set(['moov', 'trak', 'mdia', 'minf', 'stbl', 'edts', 'dinf', 'schi', 'sinf', 'udta'])

function boxBytes(type, payload) {
  const head = Buffer.alloc(8)
  head.writeUInt32BE(payload.length + 8, 0)
  head.write(type, 4, 'latin1')
  return Buffer.concat([head, payload])
}

/** 重建 moov：剔除加密信令、把 encv/enca 还原成明文 sample entry、按 delta 修正 chunk 偏移 */
function rebuildMoov(buf, moov, delta) {
  const buildBox = (box) => {
    if (DROP.has(box.type)) return null
    if (box.type === 'stco') {
      const out = Buffer.from(buf.subarray(box.start, box.start + box.header + 8))
      const n = u32(buf, box.start + box.header + 4)
      const body = Buffer.alloc(n * 4)
      for (let i = 0; i < n; i++) body.writeUInt32BE(u32(buf, box.start + box.header + 8 + i * 4) + delta, i * 4)
      return boxBytes('stco', Buffer.concat([out.subarray(box.header), body]))
    }
    if (box.type === 'co64') {
      const n = u32(buf, box.start + box.header + 4)
      const body = Buffer.alloc(n * 8)
      for (let i = 0; i < n; i++) {
        const v = Number(buf.readBigUInt64BE(box.start + box.header + 8 + i * 8)) + delta
        body.writeBigUInt64BE(BigInt(v), i * 8)
      }
      const head = Buffer.from(buf.subarray(box.start, box.start + box.header + 4))
      return boxBytes('co64', Buffer.concat([head.subarray(box.header), body]))
    }
    if (box.type === 'stsd') {
      const n = u32(buf, box.start + box.header + 4)
      const pre = Buffer.from(buf.subarray(box.start + box.header, box.start + box.header + 8)) // version/flags + count
      let o = box.start + box.header + 8
      const entries = []
      for (let i = 0; i < n; i++) {
        const esz = u32(buf, o)
        const etype = buf.toString('latin1', o + 4, o + 8)
        const entry = { type: etype, start: o, end: o + esz, header: 8 }
        entries.push(buildEntry(entry))
        o += esz
      }
      return boxBytes('stsd', Buffer.concat([pre, ...entries]))
    }
    if (CONTAINERS.has(box.type)) {
      const parts = kids(buf, box).map(buildBox).filter(Boolean)
      return boxBytes(box.type, Buffer.concat(parts))
    }
    return Buffer.from(buf.subarray(box.start, box.end))
  }

  const buildEntry = (entry) => {
    const isVideo = entry.type === 'encv'
    const fixedLen = entry.header + (isVideo ? 78 : 28)
    const fixed = Buffer.from(buf.subarray(entry.start, entry.start + fixedLen))
    const childrenStart = entry.start + fixedLen
    let frma = entry.type
    const sinf = [...boxes(buf, childrenStart, entry.end)].find((k) => k.type === 'sinf')
    if (sinf) {
      const frmaBox = [...boxes(buf, sinf.start + sinf.header, sinf.end)].find((k) => k.type === 'frma')
      if (frmaBox) frma = buf.toString('latin1', frmaBox.start + 8, frmaBox.start + 12)
    }
    const parts = [...boxes(buf, childrenStart, entry.end)]
      .filter((k) => k.type !== 'sinf' && !DROP.has(k.type))
      .map((k) => Buffer.from(buf.subarray(k.start, k.end)))
    const out = Buffer.concat([fixed, ...parts])
    if (entry.type === 'encv' || entry.type === 'enca') out.write(frma, 4, 'latin1')
    return out
  }

  return buildBox(moov)
}

/** 取某条轨道的样本在文件里的偏移与长度 */
function sampleTable(buf, trak) {
  const stbl = path(buf, trak, 'mdia', 'minf', 'stbl')
  const stsz = child(buf, stbl, 'stsz')
  const stsc = child(buf, stbl, 'stsc')
  const stco = child(buf, stbl, 'stco') ?? child(buf, stbl, 'co64')
  const stz2 = child(buf, stbl, 'stz2')
  const senc = child(buf, stbl, 'senc')

  const count = stz2 ? u32(buf, stz2.start + stz2.header + 4) : u32(buf, stsz.start + stsz.header + 8)
  const sizes = new Array(count)
  if (stz2) {
    const field = buf[stz2.start + stz2.header + 7]
    const bytes = field === 16 ? 2 : field === 8 ? 1 : 0.5
    let p = stz2.start + stz2.header + 8
    for (let i = 0; i < count; i++) {
      if (field === 16) { sizes[i] = u16(buf, p); p += 2 }
      else if (field === 8) { sizes[i] = buf[p]; p += 1 }
      else { sizes[i] = i % 2 === 0 ? buf[p] >> 4 : buf[p++] & 0x0f }
    }
  } else {
    const uniform = u32(buf, stsz.start + stsz.header + 4)
    if (uniform) sizes.fill(uniform)
    else {
      let p = stsz.start + stsz.header + 12
      for (let i = 0; i < count; i++) { sizes[i] = u32(buf, p); p += 4 }
    }
  }

  const nStsc = u32(buf, stsc.start + stsc.header + 4)
  const runs = []
  for (let i = 0; i < nStsc; i++) {
    const p = stsc.start + stsc.header + 8 + i * 12
    runs.push({ first: u32(buf, p), per: u32(buf, p + 4), desc: u32(buf, p + 8) })
  }
  const is64 = child(buf, stbl, 'stco') == null
  const nChunk = u32(buf, stco.start + stco.header + 4)
  const chunkOffsets = new Array(nChunk)
  for (let i = 0; i < nChunk; i++) {
    chunkOffsets[i] = is64
      ? Number(buf.readBigUInt64BE(stco.start + stco.header + 8 + i * 8))
      : u32(buf, stco.start + stco.header + 8 + i * 4)
  }

  const offsets = new Array(count)
  let sample = 0
  for (let r = 0; r < runs.length && sample < count; r++) {
    const run = runs[r]
    const nextFirst = r + 1 < runs.length ? runs[r + 1].first : nChunk + 1
    for (let c = run.first; c < nextFirst && sample < count; c++) {
      let off = chunkOffsets[c - 1]
      if (off == null) break
      for (let k = 0; k < run.per && sample < count; k++) {
        offsets[sample] = off
        off += sizes[sample]
        sample++
      }
    }
  }

  // senc：每个样本一个 IV（本文件的 IV 长度为 8，无子样本）
  const ivSize = 8
  const sencFlags = senc ? buf.readUIntBE(senc.start + senc.header + 1, 3) : 0
  const ivs = []
  if (senc) {
    let p = senc.start + senc.header + 8
    for (let i = 0; i < count; i++) {
      const iv = Buffer.from(buf.subarray(p, p + ivSize))
      p += ivSize
      if (sencFlags & 1) {
        const subs = u16(buf, p); p += 2
        for (let s = 0; s < subs; s++) p += 6
      }
      ivs.push(iv)
    }
  }
  return { sizes, offsets, ivs, sencFlags, count, ivSize }
}

export function decryptMp4(buf, keyHex) {
  const key = Buffer.from(keyHex, 'hex')
  const top = [...boxes(buf, 0, buf.length)]
  const ftyp = top.find((b) => b.type === 'ftyp')
  const moov = top.find((b) => b.type === 'moov')
  const mdat = top.find((b) => b.type === 'mdat')
  if (!ftyp || !moov || !mdat) throw new Error('不是标准的 MP4 分片结构')

  const mdatBody = Buffer.from(buf.subarray(mdat.start + mdat.header, mdat.end))
  const traks = kids(buf, moov).filter((k) => k.type === 'trak')
  let decrypted = mdatBody.length

  // 两遍重建：先量长度差值，再按差值修正 chunk 偏移
  let newMoov = rebuildMoov(buf, moov, 0)
  const delta = newMoov.length - moov.size
  newMoov = rebuildMoov(buf, moov, delta)

  for (const trak of traks) {
    const t = sampleTable(buf, trak)
    for (let i = 0; i < t.count; i++) {
      if (!t.ivs[i] || t.offsets[i] == null) continue
      const abs = t.offsets[i] - (mdat.start + mdat.header)
      if (abs < 0 || abs + t.sizes[i] > mdatBody.length) continue
      const iv = Buffer.concat([t.ivs[i], Buffer.alloc(16 - t.ivs[i].length)])
      const decipher = createDecipheriv('aes-128-ctr', key, iv)
      const plain = Buffer.concat([decipher.update(mdatBody.subarray(abs, abs + t.sizes[i])), decipher.final()])
      plain.copy(mdatBody, abs)
    }
  }

  // 按原顺序拼回顶层盒子：moov 换成重建版，mdat 换成解密版，其他（ftyp/free…）原样保留
  const parts = []
  for (const box of top) {
    if (box.type === 'moov') parts.push(newMoov)
    else if (box.type === 'mdat') parts.push(boxBytes('mdat', mdatBody))
    else parts.push(Buffer.from(buf.subarray(box.start, box.end)))
  }
  return { mp4: Buffer.concat(parts), decrypted }
}

export { boxes, kids, child, path }
