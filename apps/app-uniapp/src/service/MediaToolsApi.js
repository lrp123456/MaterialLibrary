/**
 * 媒体工具箱 API（寻帧 / 格式转换 / 压缩 / 产物归档）。
 *
 * 这些能力在桌面端位于「常用媒体工具」，服务端契约在 /api/tools/*；
 * App 端只负责挑视频、定参数、看结果，重活全部交给服务端 ffmpeg。
 */
import { store } from './SyncStateStore'
import { currentServerUrl, ensureServerUrl, markServerDown } from './ServerResolve'

const TIMEOUT = 120000
const TOOL_TIMEOUT = 600000

function origin() {
  return String(currentServerUrl() || '').replace(/\/+$/, '')
}

function authOnlyHeader() {
  const h = {}
  const t = store.getToken()
  if (t) h.Authorization = 'Bearer ' + t
  return h
}

function toolUrl(path) {
  return origin() + '/api' + path
}

function failMessage(err, code = 0) {
  if (code === 401) return '未登录或会话已过期'
  return (err && err.error) || `媒体工具请求失败（HTTP ${code}）`
}

function requestJson(url, { method = 'POST', body = null, timeout = TIMEOUT } = {}) {
  return new Promise((resolve, reject) => {
    uni.request({
      url,
      method,
      header: { 'Content-Type': 'application/json', ...authOnlyHeader() },
      data: body || undefined,
      timeout,
      success: (res) => {
        const code = res.statusCode || 0
        const root = res.data && typeof res.data === 'object' ? res.data : {}
        if (code === 401) {
          store.clearSession()
          reject(new Error('未登录或会话已过期'))
          return
        }
        if (code < 200 || code >= 300 || root.success === false) {
          reject(new Error(failMessage(root, code)))
          return
        }
        resolve(root.data !== undefined ? root.data : root)
      },
      fail: (err) => {
        markServerDown(currentServerUrl())
        reject(new Error((err && err.errMsg) || '网络错误'))
      },
    })
  })
}

/** 直接请求 /api 前缀（归档接口返回 { ok: true, fid }，不是 success 包装） */
function requestRoot(url, { method = 'POST', body = null, timeout = TIMEOUT } = {}) {
  return new Promise((resolve, reject) => {
    uni.request({
      url,
      method,
      header: { 'Content-Type': 'application/json', ...authOnlyHeader() },
      data: body || undefined,
      timeout,
      success: (res) => {
        const code = res.statusCode || 0
        const root = res.data && typeof res.data === 'object' ? res.data : {}
        if (code === 401) {
          store.clearSession()
          reject(new Error('未登录或会话已过期'))
          return
        }
        if (code < 200 || code >= 300) {
          reject(new Error(failMessage(root, code)))
          return
        }
        resolve(root)
      },
      fail: (err) => {
        markServerDown(currentServerUrl())
        reject(new Error((err && err.errMsg) || '网络错误'))
      },
    })
  })
}

/** 本机视频上传到服务端临时目录，返回 { videoPath, fileName, size } */
export async function uploadToolVideo(filePath, fileName = 'media_tool_source.mp4') {
  await ensureServerUrl()
  return new Promise((resolve, reject) => {
    uni.uploadFile({
      url: toolUrl('/tools/upload'),
      filePath,
      name: 'file',
      header: { ...authOnlyHeader(), 'x-filename': encodeURIComponent(fileName) },
      timeout: TOOL_TIMEOUT,
      success: (res) => {
        const code = res.statusCode || 0
        let root = {}
        try {
          root = typeof res.data === 'string' ? JSON.parse(res.data) : res.data || {}
        } catch (e) {
          root = {}
        }
        if (code === 401) {
          store.clearSession()
          reject(new Error('未登录或会话已过期'))
          return
        }
        if (code < 200 || code >= 300 || root.success === false) {
          reject(new Error(failMessage(root, code)))
          return
        }
        resolve(root.data || {})
      },
      fail: (err) => {
        markServerDown(currentServerUrl())
        reject(new Error((err && err.errMsg) || '上传失败'))
      },
    })
  })
}

export async function videoOpen(source) {
  await ensureServerUrl()
  return requestJson(toolUrl('/tools/video-open'), { body: source })
}

export async function videoFilmstrip(source, count = 12) {
  await ensureServerUrl()
  const data = await requestJson(toolUrl('/tools/filmstrip'), { body: { ...source, count } })
  return Array.isArray(data) ? data : []
}

export function frameAt(source, { time = 0, purpose = 'full', maxEdge = 1280, gopSec = 2, fps = 30, duration = 0 } = {}) {
  return requestJson(toolUrl('/tools/frame-at'), {
    body: { ...source, time, purpose, maxEdge, gopSec, fps, duration },
  })
}

export function convertVideo({ source, targetFormat = 'mp4', crf = 23, extractAudio = false, cleanVocal = false }) {
  return requestJson(toolUrl('/tools/convert-video'), {
    timeout: TOOL_TIMEOUT,
    body: {
      ...source,
      targetFormat,
      crf,
      extractAudio,
      cleanVocal,
    },
  })
}

/** 把服务端临时产物归档进素材库；previewUrl 用返回的相对路径（/api/cache/temp/...） */
export async function registerToolResult({ previewUrl, prompt = '', model = 'ffmpeg', mode = 'convert' }) {
  await ensureServerUrl()
  return requestRoot(toolUrl('/assets/from-generation'), {
    body: { previewUrl, prompt, model, mode },
    timeout: TIMEOUT,
  })
}

export async function registerFrameResult({ dataUrl, prompt = '', frame = 0, time = 0 }) {
  await ensureServerUrl()
  return requestRoot(toolUrl('/assets/from-generation'), {
    body: {
      imageBase64: dataUrl,
      prompt,
      model: 'video-frame',
      mode: 'video_frame',
      frame,
      time,
    },
    timeout: TIMEOUT,
  })
}

/** 相对媒体地址补 origin + token，供 <image>/<video> 直接加载 */
export function toolMediaUrl(pathOrUrl, token = store.getToken()) {
  const raw = String(pathOrUrl || '')
  if (!raw) return ''
  if (/^(https?:|data:|blob:)/i.test(raw)) return raw
  const base = origin()
  const abs = raw.startsWith('/') ? base + raw : base + '/' + raw
  if (!token) return abs
  return abs + (abs.includes('?') ? '&' : '?') + 'token=' + encodeURIComponent(token)
}
