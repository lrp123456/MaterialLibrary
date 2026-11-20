/**
 * 上传服务（自 Uploader.ets 迁移）
 * POST {server}/api/snapshot；失败重试 1s/2s/4s 后写入待重传队列；
 * 配置了兜底目录时额外落盘一份（App 端 plus/fs，H5 跳过）。
 */
import {
  API_SNAPSHOT_PATH,
  API_HEALTH_PATH,
  UPLOAD_RETRY_TIMES,
  RETRY_BACKOFF_BASE_MS,
  HTTP_TIMEOUT_MS,
  FALLBACK_FILE_PREFIX,
} from '../common/Constants'
import { UploadStatus } from '../common/Types'
import { store } from './SyncStateStore'

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function buildHeader() {
  const header = { 'Content-Type': 'application/json' }
  const token = store.getServerToken()
  if (token) header['Authorization'] = `Bearer ${token}`
  return header
}

function postJson(url, body) {
  return new Promise((resolve, reject) => {
    uni.request({
      url,
      method: 'POST',
      header: buildHeader(),
      data: body,
      timeout: HTTP_TIMEOUT_MS,
      success: (res) => resolve({ status: res.statusCode || 0, data: res.data }),
      fail: (err) => reject(err),
    })
  })
}

export async function uploadSnapshot(json) {
  const server = store.getServerUrl()
  if (!server) {
    console.error('[Uploader] server not configured')
    return { status: saveToPending(json), data: null }
  }
  const url = server + API_SNAPSHOT_PATH
  for (let attempt = 0; attempt <= UPLOAD_RETRY_TIMES; attempt++) {
    try {
      const res = await postJson(url, json)
      const code = res.status
      if (code >= 200 && code < 300) {
        return { status: UploadStatus.SUCCESS, data: res.data }
      }
      if (code >= 400 && code < 500) {
        console.error('[Uploader] client error', code)
        break
      }
      console.error('[Uploader] server error', code)
    } catch (err) {
      console.error('[Uploader] network', err)
    }
    if (attempt < UPLOAD_RETRY_TIMES) {
      await sleep(RETRY_BACKOFF_BASE_MS * (1 << attempt))
    }
  }
  return { status: saveToPending(json), data: null }
}


function saveToPending(json) {
  writeFallback(json)
  const ok = store.savePending(json)
  return ok ? UploadStatus.FALLBACK : UploadStatus.ERROR
}

/**
 * 兜底落盘：写入用户选择的监控目录（如夸克网盘目录）。
 * H5 无文件系统能力，静默跳过。
 */
function writeFallback(json) {
  // #ifdef APP-PLUS
  const dirUri = store.getFallbackDir()
  if (!dirUri) return
  try {
    const plusAny = typeof plus !== 'undefined' ? plus : null
    if (!plusAny) return
    const name = `${FALLBACK_FILE_PREFIX}${Date.now()}.json`
    plusAny.io.resolveLocalFileSystemURL(
      dirUri,
      (entry) => {
        entry.getFile(
          name,
          { create: true },
          (fileEntry) => {
            fileEntry.createWriter((writer) => {
              writer.write(json)
            })
          },
          (e) => console.error('[Uploader] fallback getFile', e)
        )
      },
      (e) => console.error('[Uploader] fallback resolve dir', e)
    )
  } catch (e) {
    console.error('[Uploader] writeFallback', e)
  }
  // #endif
  // #ifndef APP-PLUS
  void json
  // #endif
}

export async function retryPending() {
  const server = store.getServerUrl()
  const items = store.listPending()
  if (!items.length || !server) return items.length
  const url = server + API_SNAPSHOT_PATH
  let remaining = items.length
  for (const item of items) {
    try {
      const res = await postJson(url, item.json)
      const code = res.status
      if (code >= 200 && code < 300) {
        store.removePending(item.id)
        remaining--
      }
    } catch (e) {
      console.error('[Uploader] retry pending', item.id, e)
    }
  }
  store.setPendingCount(remaining)
  return remaining
}

/**
 * 探测服务器是否可达。依次尝试 /api/health 与根路径，
 * 任一返回 HTTP 状态码即视为网络可达；全部 fail 才算连接失败。
 * 返回 { ok, message }
 */
export async function testConnection() {
  const server = store.getServerUrl()
  if (!server) return { ok: false, message: '未配置服务器地址' }

  const probes = [server + API_HEALTH_PATH, server + '/']
  const details = []

  for (const url of probes) {
    const result = await new Promise((resolve) => {
      uni.request({
        url,
        method: 'GET',
        timeout: HTTP_TIMEOUT_MS,
        success: (res) => {
          const code = res.statusCode || 0
          resolve({
            reachable: true,
            status: code,
            ok: code >= 200 && code < 400,
          })
        },
        fail: (err) => {
          resolve({
            reachable: false,
            errMsg: (err && err.errMsg) || 'request:fail',
          })
        },
      })
    })

    const short = url.replace(server, '')
    if (result.reachable) {
      details.push(`${short} → HTTP ${result.status}`)
      if (result.ok) {
        return {
          ok: true,
          message: '连接成功，服务器可用' + (details.length > 1 ? `（${details.join('；')}）` : ''),
        }
      }
    } else {
      details.push(`${short} → ${result.errMsg}`)
    }
  }

  const allNetFail = details.every((d) => !d.includes('HTTP'))
  return {
    ok: false,
    message: allNetFail
      ? `无法连接：${details.join('；')}`
      : `服务器有响应但异常：${details.join('；')}`,
  }
}

export { FALLBACK_FILE_PREFIX }
