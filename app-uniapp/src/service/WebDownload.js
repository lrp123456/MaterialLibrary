/**
 * Web（H5）媒体下载：Bearer + Blob，避免 token 进 URL。
 * 批量下载使用浏览器端 ZIP（store 无压缩）。
 */
import { store } from './SyncStateStore'
import { currentServerUrl, ensureServerUrl } from './ServerResolve'

const API_BASE = '/api/viewer'

export function apiBase() {
  return currentServerUrl().replace(/\/+$/, '') + API_BASE
}

/** 不带 query token 的媒体地址（需 Authorization 头） */
export function authMediaUrl(fid, { derivativeId = 0, kind = 'image', dl = false, thumbPath = '' } = {}) {
  ensureServerUrl()
  void thumbPath // 失效 /api/thumbs 不用
  let path = '/assets/' + encodeURIComponent(fid)
  if (kind === 'poster') path += '/poster'
  else if (kind === 'file') path += '/file'
  else path += '/image'
  const q = ['local=1']
  if (derivativeId > 0) q.push('derivative=' + derivativeId)
  if (dl) q.push('dl=1')
  return apiBase() + path + '?' + q.join('&')
}

function authHeaders() {
  const t = store.getToken()
  return t ? { Authorization: 'Bearer ' + t } : {}
}

export async function fetchMediaBlob(url, { timeoutMs = 45000 } = {}) {
  await ensureServerUrl()
  // 图片接口也接受 ?token= 会话；补上避免仅靠 Bearer 时预检/重定向踩坑
  if (url && url.indexOf('token=') === -1) {
    const t = store.getToken()
    if (t) {
      url += (url.indexOf('?') >= 0 ? '&' : '?') + 'token=' + encodeURIComponent(t)
    }
  }
  const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null
  const timer = ctrl ? setTimeout(() => ctrl.abort(), timeoutMs) : null
  try {
    const res = await fetch(url, {
      method: 'GET',
      headers: authHeaders(),
      signal: ctrl ? ctrl.signal : undefined,
    })
    if (res.status === 401) {
      store.clearSession()
      throw new Error('未登录或会话已过期')
    }
    if (!res.ok) throw new Error('下载失败 HTTP ' + res.status)
    return await res.blob()
  } finally {
    if (timer) clearTimeout(timer)
  }
}

const objectUrlCache = new Map()

export async function getMediaObjectUrl(cacheKey, url) {
  if (objectUrlCache.has(cacheKey)) return objectUrlCache.get(cacheKey)
  const blob = await fetchMediaBlob(url)
  const obj = URL.createObjectURL(blob)
  objectUrlCache.set(cacheKey, obj)
  return obj
}

export function revokeMediaObjectUrl(cacheKey) {
  const u = objectUrlCache.get(cacheKey)
  if (u) {
    URL.revokeObjectURL(u)
    objectUrlCache.delete(cacheKey)
  }
}

export function clearMediaObjectUrls() {
  objectUrlCache.forEach((u) => URL.revokeObjectURL(u))
  objectUrlCache.clear()
}

export function saveBlobAs(blob, fileName) {
  const a = document.createElement('a')
  const obj = URL.createObjectURL(blob)
  a.href = obj
  a.download = fileName || 'download.bin'
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(obj), 4000)
}

export async function downloadOne({ fid, fileName, derivativeId = 0, kind = 'image', dl = true }) {
  const url = authMediaUrl(fid, { derivativeId, kind, dl })
  const blob = await fetchMediaBlob(url)
  saveBlobAs(blob, fileName || `${fid}.bin`)
  return { ok: true, fileName }
}

/* ---------- 极简 ZIP（store / 不压缩） ---------- */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let i = 0; i < 256; i++) {
    let c = i
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[i] = c >>> 0
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function dosDateTime(d = new Date()) {
  const time =
    ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | ((d.getSeconds() / 2) & 31)
  const date =
    (((d.getFullYear() - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31)
  return { time, date }
}

function u16(n) {
  return [n & 0xff, (n >>> 8) & 0xff]
}
function u32(n) {
  return [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff]
}

/** entries: [{ name, data: Uint8Array }] */
export function buildZipStore(entries) {
  const { time, date } = dosDateTime()
  const parts = []
  const central = []
  let offset = 0

  for (const e of entries) {
    const nameBytes = new TextEncoder().encode(e.name)
    const data = e.data
    const crc = crc32(data)
    const local = [
      ...u32(0x04034b50),
      ...u16(20),
      ...u16(0),
      ...u16(0),
      ...u16(time),
      ...u16(date),
      ...u32(crc),
      ...u32(data.length),
      ...u32(data.length),
      ...u16(nameBytes.length),
      ...u16(0),
    ]
    parts.push(new Uint8Array(local), nameBytes, data)

    const cen = [
      ...u32(0x02014b50),
      ...u16(20),
      ...u16(20),
      ...u16(0),
      ...u16(0),
      ...u16(time),
      ...u16(date),
      ...u32(crc),
      ...u32(data.length),
      ...u32(data.length),
      ...u16(nameBytes.length),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u16(0),
      ...u32(0),
      ...u32(offset),
    ]
    central.push(new Uint8Array(cen), nameBytes)
    offset += local.length + nameBytes.length + data.length
  }

  const centralStart = offset
  let centralSize = 0
  for (const p of central) centralSize += p.length
  const end = [
    ...u32(0x06054b50),
    ...u16(0),
    ...u16(0),
    ...u16(entries.length),
    ...u16(entries.length),
    ...u32(centralSize),
    ...u32(centralStart),
    ...u16(0),
  ]

  const all = [...parts, ...central, new Uint8Array(end)]
  return new Blob(all, { type: 'application/zip' })
}

function uniqueName(name, used) {
  let n = name || 'file.bin'
  if (!used.has(n)) {
    used.add(n)
    return n
  }
  const dot = n.lastIndexOf('.')
  const base = dot > 0 ? n.slice(0, dot) : n
  const ext = dot > 0 ? n.slice(dot) : ''
  let i = 2
  while (used.has(`${base}_${i}${ext}`)) i++
  const out = `${base}_${i}${ext}`
  used.add(out)
  return out
}

/**
 * 解析衍生版本 id。
 * kind: 'origin' | 'restage_9_16' | 'restage_3_4'（也接受 '9:16'/'3:4'）
 * 找不到该画幅时返回 null（由调用方决定跳过或回退）。
 */
export function pickDerivativeId(derivatives, kind) {
  if (!kind || kind === 'origin') return 0
  const list = Array.isArray(derivatives) ? derivatives : []
  const k = String(kind).replace(/^9:16$/i, 'restage_9_16').replace(/^3:4$/i, 'restage_3_4')
  const hit =
    list.find((d) => d && d.kind === k) ||
    list.find((d) => d && String(d.kind || '').includes(k)) ||
    list.find((d) => d && String(d.kind || '').includes(k.replace('restage_', '')))
  return hit && hit.id ? hit.id : null
}

/**
 * 批量下载：逐个拉取并打成 zip。
 * items: [{ fid, fileName, derivativeId?, derivatives?, isVideo?... }]
 * opts: { zipName, onProgress, derivativeKind: 'origin'|'restage_9_16'|'restage_3_4', resolveDerivatives? }
 * resolveDerivatives(item) => Promise<derivatives[]> 列表缺衍生时回源详情
 */
export async function downloadBatchZip(items, { zipName, onProgress, derivativeKind = 'origin', resolveDerivatives } = {}) {
  const list = (items || []).filter(Boolean)
  if (!list.length) throw new Error('未选择素材')
  const used = new Set()
  const entries = []
  const skipped = []
  for (let i = 0; i < list.length; i++) {
    const it = list[i]
    let derivativeId = 0
    if (derivativeKind && derivativeKind !== 'origin') {
      let derivs = it.derivatives
      if ((!derivs || !derivs.length) && typeof resolveDerivatives === 'function') {
        try {
          derivs = (await resolveDerivatives(it)) || []
          it.derivatives = derivs
        } catch (e) {
          derivs = []
        }
      }
      derivativeId = pickDerivativeId(derivs, derivativeKind)
      if (derivativeId == null) {
        skipped.push(it.fileName || it.fid)
        if (onProgress) onProgress({ done: i, total: list.length, currentName: '跳过无' + derivativeKind })
        continue
      }
    } else if (it.derivativeId) {
      derivativeId = it.derivativeId
    }
    const pathKind = it.isVideo || it.isMusic || it.isModel ? 'file' : 'image'
    const url = authMediaUrl(it.fid, {
      derivativeId: derivativeId || 0,
      kind: pathKind,
      dl: true,
    })
    if (onProgress) onProgress({ done: i, total: list.length, currentName: it.fileName || it.fid })
    const blob = await fetchMediaBlob(url)
    const buf = new Uint8Array(await blob.arrayBuffer())
    const suffix = derivativeKind === 'restage_9_16' ? '_9x16' : derivativeKind === 'restage_3_4' ? '_3x4' : ''
    const baseName = it.fileName || `${it.fid}.bin`
    const named = suffix ? injectSuffix(baseName, suffix) : baseName
    entries.push({ name: uniqueName(named, used), data: buf })
  }
  if (onProgress) onProgress({ done: list.length, total: list.length, currentName: '' })
  if (!entries.length) {
    throw new Error('所选素材均无 ' + (derivativeKind === 'restage_9_16' ? '9:16' : '3:4') + ' 版本')
  }
  const zip = buildZipStore(entries)
  const tag = derivativeKind === 'restage_9_16' ? '9x16' : derivativeKind === 'restage_3_4' ? '3x4' : '原图'
  const name = zipName || `素材批量下载_${tag}_${new Date().toISOString().slice(0, 10)}.zip`
  saveBlobAs(zip, name)
  return { ok: true, count: entries.length, fileName: name, skipped }
}

function injectSuffix(fileName, suffix) {
  const dot = String(fileName || '').lastIndexOf('.')
  if (dot <= 0) return fileName + suffix
  return fileName.slice(0, dot) + suffix + fileName.slice(dot)
}

export default {
  authMediaUrl,
  fetchMediaBlob,
  getMediaObjectUrl,
  revokeMediaObjectUrl,
  clearMediaObjectUrls,
  saveBlobAs,
  downloadOne,
  downloadBatchZip,
  buildZipStore,
}
