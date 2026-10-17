/**
 * 手机端媒体文件上传管理器 (Media Uploader)
 * - 支持 Wi-Fi 网络保护（避免蜂窝流量消耗）
 * - 6 并发受控上传队列，加快差量文件同步
 * - 区分视频与图片超时，避免大视频误报超时
 * - 原生端支持 uni.uploadFile 流式直传到 MaterialLibraryServer NAS 存储
 * - 失败自动重试（指数退避）；大视频走服务端分片接口，单片失败可续传
 */
import { store } from './SyncStateStore'

let isQueueRunning = false
const UPLOAD_CONCURRENCY = 6
const VIDEO_TIMEOUT_MS = 300000 // 视频 5 分钟超时
const IMAGE_TIMEOUT_MS = 60000  // 图片 1 分钟超时
const LARGE_VIDEO_THRESHOLD = 30 * 1024 * 1024
const UPLOAD_CHUNK_SIZE = 5 * 1024 * 1024
const UPLOAD_MAX_RETRIES = 3
const UPLOAD_RETRY_BACKOFF_MS = 2000

/**
 * 检查当前网络是否允许上传
 */
export function checkNetworkAllowed() {
  return new Promise((resolve) => {
    if (!store.isWifiOnlyEnabled()) {
      return resolve({ allowed: true, networkType: 'any' })
    }
    uni.getNetworkType({
      success: (res) => {
        const net = res.networkType || 'unknown'
        const isWifi = net === 'wifi' || net === 'ethernet'
        resolve({
          allowed: isWifi,
          networkType: net,
          reason: isWifi ? '' : '仅在 Wi-Fi 下同步原文件已开启，当前处于移动蜂窝网络'
        })
      },
      fail: () => {
        resolve({ allowed: true, networkType: 'unknown' })
      }
    })
  })
}

/**
 * 判断是否为视频文件
 */
function isVideoItem(item) {
  if (item.mediaType === 'video') return true
  const name = String(item.name || item.localPath || '').toLowerCase()
  return /\.(mp4|mov|m4v|3gp|mkv|webm|avi)$/i.test(name)
}

/**
 * 依据文件大小动态估算超时时间（防止超大视频因固定 5 分钟超时中断）
 */
function calculateTimeout(item, isVideo) {
  const size = Number(item.size) || 0
  if (isVideo) {
    // 基础 5 分钟；按 300KB/s 兜底网速估算，600MB 视频获得约 35 分钟超时
    const dynamicMs = size > 0 ? Math.ceil(size / 300000) * 1000 : VIDEO_TIMEOUT_MS
    return Math.max(VIDEO_TIMEOUT_MS, dynamicMs)
  }
  const dynamicMs = size > 0 ? Math.ceil(size / 200000) * 1000 : IMAGE_TIMEOUT_MS
  return Math.max(IMAGE_TIMEOUT_MS, dynamicMs)
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

function makeSkipError(message) {
  const e = new Error(message || 'skip')
  e.skip = true
  return e
}

/**
 * 网络/连接层失败（statusCode null、超时、断连）可重试
 */
function isTransientUploadError(err) {
  if (!err) return false
  if (err.skip) return false
  const msg = String(err.message || err.errMsg || err || '')
  if (/blacklisted|黑名单|已被删除/i.test(msg)) return false
  if (/HTTP\s*[45]\d{2}/.test(msg) && !/HTTP\s*(502|503|504)/.test(msg)) return false
  return /statusCode:\s*null|timeout|timed\s*out|fail|network|ECONN|socket|abort|unreachable|无法连接|网络/i.test(msg)
}

function withRetry(fn, { retries = UPLOAD_MAX_RETRIES, baseMs = UPLOAD_RETRY_BACKOFF_MS } = {}) {
  return (async () => {
    let lastErr
    for (let attempt = 0; attempt <= retries; attempt++) {
      try {
        return await fn(attempt)
      } catch (err) {
        lastErr = err
        if (err && err.skip) throw err
        if (attempt >= retries || !isTransientUploadError(err)) throw err
        const wait = baseMs * Math.pow(2, attempt)
        console.warn(`[MediaUploader] 重试 ${attempt + 1}/${retries}，${wait}ms 后:`, err && err.message)
        await sleep(wait)
      }
    }
    throw lastErr
  })()
}

/**
 * App 端校验本地文件可读；H5/模拟路径直接放行
 */
function resolveContentUriToPath(localPath) {
  // #ifdef APP-PLUS
  try {
    if (localPath && localPath.startsWith('content://') && typeof plus !== 'undefined' && plus.android) {
      const main = plus.android.runtimeMainActivity()
      try { plus.android.importClass(main) } catch (_) {}
      let resolver = null
      try { resolver = main.getContentResolver() } catch (_) {}
      if (!resolver) resolver = plus.android.invoke(main, 'getContentResolver')
      if (resolver) {
        try { plus.android.importClass(resolver) } catch (_) {}
        const Uri = plus.android.importClass('android.net.Uri')
        const uri = plus.android.invoke(Uri, 'parse', localPath)
        const proj = ['_data']
        let cursor = null
        try {
          cursor = plus.android.invoke(resolver, 'query', uri, proj, null, null, null)
        } catch (_) {
          try { cursor = resolver.query(uri, proj, null, null, null) } catch (_) {}
        }
        if (cursor) {
          try {
            if (plus.android.invoke(cursor, 'moveToFirst')) {
              const col = plus.android.invoke(cursor, 'getColumnIndex', '_data')
              if (col >= 0) {
                const p = String(plus.android.invoke(cursor, 'getString', col) || '')
                if (p) return p
              }
            }
          } finally {
            try { plus.android.invoke(cursor, 'close') } catch (_) {}
          }
        }
      }
    }
  } catch (_) {}
  // #endif
  return localPath
}

function checkLocalFileReadable(localPath) {
  return new Promise((resolve) => {
    // #ifdef APP-PLUS
    if (!localPath || localPath.startsWith('mock_')) {
      resolve({ ok: true, path: localPath, mock: true })
      return
    }
    const resolved = resolveContentUriToPath(localPath)
    if (typeof plus === 'undefined' || !plus.io) {
      resolve({ ok: true, path: resolved, skipped: true })
      return
    }
    try {
      plus.io.resolveLocalFileSystemURL(
        resolved,
        (entry) => {
          try {
            entry.file(
              (file) => {
                resolve({
                  ok: true,
                  path: entry.fullPath || resolved,
                  size: Number(file.size) || 0,
                  entry
                })
              },
              () => resolve({ ok: false, path: resolved, reason: '文件不可读（File 入口失败）' })
            )
          } catch (_) {
            resolve({ ok: true, path: resolved })
          }
        },
        () => resolve({ ok: false, path: resolved, reason: '文件不存在或路径已失效' })
      )
    } catch (e) {
      resolve({ ok: false, path: resolved, reason: (e && e.message) || '路径校验异常' })
    }
    return
    // #endif
    // #ifndef APP-PLUS
    resolve({ ok: !!localPath, path: localPath })
    // #endif
  })
}

function postJson(url, body, token, timeout = 120000) {
  return new Promise((resolve, reject) => {
    const header = { 'Content-Type': 'application/json' }
    if (token) header['Authorization'] = `Bearer ${token}`
    uni.request({
      url,
      method: 'POST',
      header,
      data: body,
      timeout,
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(typeof res.data === 'string' ? JSON.parse(res.data) : res.data)
          } catch (_) {
            resolve(res.data)
          }
          return
        }
        let errDetail = `HTTP ${res.statusCode}`
        try {
          const parsed = typeof res.data === 'string' ? JSON.parse(res.data) : res.data
          if (parsed && parsed.error) errDetail = `${errDetail} (${parsed.error})`
        } catch (_) {}
        reject(new Error(errDetail))
      },
      fail: (err) => {
        reject(new Error((err && (err.errMsg || err.message)) || 'request:fail'))
      }
    })
  })
}

function getFsManager() {
  try {
    return typeof uni.getFileSystemManager === 'function' ? uni.getFileSystemManager() : null
  } catch (_) {
    return null
  }
}

function plusAvailable() {
  return typeof plus !== 'undefined' && !!plus.io
}

function plusResolve(url) {
  return new Promise((resolve, reject) => {
    plus.io.resolveLocalFileSystemURL(url, resolve, (e) => reject(new Error((e && e.message) || `路径无效: ${url}`)))
  })
}

/**
 * App 端写出二进制分片（plus.io FileWriter，兼容 ArrayBuffer/Blob）
 */
function writeBinaryViaPlusIo(destPath, arrayBuffer) {
  return new Promise((resolve, reject) => {
    const idx = String(destPath).lastIndexOf('/')
    const dirPath = idx > 0 ? destPath.substring(0, idx) : '_doc'
    const fileName = idx > 0 ? destPath.substring(idx + 1) : destPath

    plusResolve(dirPath)
      .then((dirEntry) => {
        dirEntry.getFile(
          fileName,
          { create: true },
          (fileEntry) => {
            fileEntry.createWriter(
              (writer) => {
                writer.onwrite = () => resolve(destPath)
                writer.onerror = (e) => reject(new Error((e && e.message) || '写入分片失败'))
                try {
                  const blob = typeof Blob !== 'undefined' ? new Blob([arrayBuffer]) : arrayBuffer
                  writer.write(blob)
                } catch (e) {
                  reject(new Error((e && e.message) || '写入分片异常'))
                }
              },
              (e) => reject(new Error((e && e.message) || '创建写入器失败'))
            )
          },
          (e) => reject(new Error((e && e.message) || '创建分片文件失败'))
        )
      })
      .catch(reject)
  })
}

/**
 * 策略 A：uni.getFileSystemManager 支持 position/length
 */
function extractChunkViaFsManager(srcPath, offset, length, destPath) {
  return new Promise((resolve, reject) => {
    const fs = getFsManager()
    if (!fs || !fs.readFile || !fs.writeFile) {
      reject(new Error('FSManager 不可用'))
      return
    }
    fs.readFile({
      filePath: srcPath,
      position: offset,
      length,
      success: (res) => {
        const data = res.data
        if (!data) {
          reject(new Error('分片内容为空'))
          return
        }
        fs.writeFile({
          filePath: destPath,
          data,
          success: () => resolve(destPath),
          fail: (e) => reject(new Error((e && e.errMsg) || '写入分片失败'))
        })
      },
      fail: (e) => reject(new Error((e && e.errMsg) || '读取分片失败'))
    })
  })
}

/**
 * 策略 B：plus.io File.slice + FileReader（WebView 标准 File API）
 */
function extractChunkViaPlusIoSlice(srcPath, offset, length, destPath) {
  return new Promise((resolve, reject) => {
    if (!plusAvailable()) {
      reject(new Error('plus.io 不可用'))
      return
    }
    plus.io.resolveLocalFileSystemURL(
      srcPath,
      (entry) => {
        entry.file(
          (file) => {
            try {
              if (offset >= file.size) {
                reject(new Error('分片偏移超出文件大小'))
                return
              }
              const end = Math.min(offset + length, file.size)
              const blob = file.slice(offset, end)
              const reader = new plus.io.FileReader()
              reader.onloadend = function () {
                if (reader.error) {
                  reject(new Error((reader.error.message || reader.error) + ''))
                  return
                }
                if (!reader.result) {
                  reject(new Error('分片读取结果为空'))
                  return
                }
                writeBinaryViaPlusIo(destPath, reader.result).then(resolve).catch(reject)
              }
              reader.onerror = function (e) {
                reject(new Error((e && e.message) || 'FileReader 读取失败'))
              }
              reader.readAsArrayBuffer(blob)
            } catch (e) {
              reject(new Error((e && e.message) || 'File.slice 失败'))
            }
          },
          (e) => reject(new Error((e && e.message) || '无法获取 File 对象'))
        )
      },
      () => reject(new Error(`源文件不可读: ${srcPath}`))
    )
  })
}

/**
 * 策略 C：plus.android RandomAccessFile + Channel 流式拷贝（不经过大 ArrayBuffer 桥）
 */
function extractChunkViaAndroidChannel(srcPath, offset, length, destPath) {
  return new Promise((resolve, reject) => {
    // #ifdef APP-PLUS
    if (typeof plus === 'undefined' || !plus.android) {
      reject(new Error('plus.android 不可用'))
      return
    }
    let raf = null
    let fos = null
    try {
      let buffer
      try {
        const ByteBuffer = plus.android.importClass('java.nio.ByteBuffer')
        buffer = ByteBuffer.allocate(Math.min(Number(length), 1024 * 1024))
      } catch (_) {
        buffer = plus.android.invoke('java.nio.ByteBuffer', 'allocate', Math.min(Number(length), 1024 * 1024))
      }

      raf = plus.android.newObject('java.io.RandomAccessFile', String(srcPath), 'r')
      fos = plus.android.newObject('java.io.FileOutputStream', String(destPath))
      plus.android.invoke(raf, 'seek', Number(offset))
      const inCh = plus.android.invoke(raf, 'getChannel')
      const outCh = plus.android.invoke(fos, 'getChannel')
      const bufSize = Math.min(Number(length), 1024 * 1024)
      let remaining = Number(length)
      while (remaining > 0) {
        plus.android.invoke(buffer, 'clear')
        const limit = Math.min(bufSize, remaining)
        plus.android.invoke(buffer, 'limit', limit)
        const n = plus.android.invoke(inCh, 'read', buffer)
        if (n === null || n === undefined || Number(n) <= 0) break
        plus.android.invoke(buffer, 'flip')
        plus.android.invoke(outCh, 'write', buffer)
        remaining -= Number(n)
      }
      if (remaining > 0) {
        reject(new Error(`分片拷贝不完整，剩余 ${remaining} 字节`))
        return
      }
      resolve(destPath)
    } catch (e) {
      reject(new Error((e && e.message) || 'Android Channel 分片失败'))
    } finally {
      try { if (raf) plus.android.invoke(raf, 'close') } catch (_) {}
      try { if (fos) plus.android.invoke(fos, 'close') } catch (_) {}
    }
    return
    // #endif
    // #ifndef APP-PLUS
    reject(new Error('非 App 平台'))
    // #endif
  })
}

/**
 * 将大文件指定区间抽出为临时分片文件（多策略回退）
 */
async function extractChunkToFile(srcPath, offset, length, destPath) {
  const strategies = [
    ['FSManager', extractChunkViaFsManager],
    ['AndroidChannel', extractChunkViaAndroidChannel],
    ['PlusIoSlice', extractChunkViaPlusIoSlice]
  ]
  const errors = []
  for (const [name, fn] of strategies) {
    try {
      const t0 = Date.now()
      const out = await fn(srcPath, offset, length, destPath)
      if (offset === 0 || name !== 'FSManager') {
        console.log(`[MediaUploader] 分片切出策略=${name} offset=${offset} len=${length} cost=${Date.now() - t0}ms`)
      }
      return out
    } catch (e) {
      errors.push(`${name}: ${(e && e.message) || e}`)
    }
  }
  throw new Error(`分片读取失败（${errors.join(' | ')}）`)
}

function removeFileQuiet(path) {
  if (!path) return
  const fs = getFsManager()
  if (fs && fs.unlink) {
    try {
      fs.unlink({ filePath: path, fail: () => {} })
    } catch (_) {}
  }
  // #ifdef APP-PLUS
  try {
    if (plusAvailable()) {
      plus.io.resolveLocalFileSystemURL(
        path,
        (entry) => {
          try { entry.remove(() => {}, () => {}) } catch (_) {}
        },
        () => {}
      )
    }
  } catch (_) {}
  // #endif
}

function ensureChunkWorkDir() {
  return new Promise((resolve) => {
    // #ifdef APP-PLUS
    if (!plusAvailable()) {
      resolve('_doc/upload_chunks')
      return
    }
    try {
      plus.io.resolveLocalFileSystemURL(
        '_doc',
        (root) => {
          root.getDirectory(
            'upload_chunks',
            { create: true },
            (dir) => resolve(dir.fullPath || '_doc/upload_chunks'),
            () => resolve('_doc/upload_chunks')
          )
        },
        () => resolve('_doc/upload_chunks')
      )
    } catch (_) {
      resolve('_doc/upload_chunks')
    }
    return
    // #endif
    // #ifndef APP-PLUS
    resolve('_doc/upload_chunks')
    // #endif
  })
}

function uploadSingleChunkOnce(serverUrl, token, chunkPath, meta) {
  return new Promise((resolve, reject) => {
    const url = `${serverUrl}/api/sync/chunk`
    const header = {
      'x-upload-id': String(meta.uploadId),
      'x-chunk-index': String(meta.chunkIndex),
      'x-total-chunks': String(meta.totalChunks)
    }
    if (token) header['Authorization'] = `Bearer ${token}`

    uni.uploadFile({
      url,
      filePath: chunkPath,
      name: 'file',
      header,
      formData: {
        upload_id: String(meta.uploadId),
        chunk_index: String(meta.chunkIndex),
        total_chunks: String(meta.totalChunks)
      },
      timeout: Math.max(120000, IMAGE_TIMEOUT_MS),
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(typeof res.data === 'string' ? JSON.parse(res.data) : res.data)
          } catch (_) {
            resolve(res.data)
          }
          return
        }
        let errDetail = `HTTP ${res.statusCode}`
        try {
          const parsed = typeof res.data === 'string' ? JSON.parse(res.data) : res.data
          if (parsed && parsed.error) errDetail = `${errDetail} (${parsed.error})`
        } catch (_) {}
        reject(new Error(`分片上传服务端异常 ${errDetail}`))
      },
      fail: (err) => {
        const errMsg = err && (err.errMsg || err.message) ? (err.errMsg || err.message) : JSON.stringify(err)
        reject(new Error(errMsg))
      }
    })
  })
}

/**
 * 大视频分片直传：切片 → 逐片上传（带重试）→ complete 合并
 */
async function uploadLargeVideoChunked(serverUrl, item, token, readablePath) {
  const size = Number(item.size) || 0
  if (!size) {
    throw new Error('缺少文件大小，无法分片')
  }
  const totalChunks = Math.ceil(size / UPLOAD_CHUNK_SIZE)
  const uploadId = `${Date.now()}_${Math.random().toString(36).slice(2, 10)}`
  const workDir = await ensureChunkWorkDir()
  const srcPath = readablePath || item.localPath

  console.log(`[MediaUploader] 大视频分片上传: ${item.name} (${Math.round(size / 1048576)}MB, ${totalChunks} 片) src=${srcPath} workDir=${workDir}`)

  for (let i = 0; i < totalChunks; i++) {
    const offset = i * UPLOAD_CHUNK_SIZE
    const length = Math.min(UPLOAD_CHUNK_SIZE, size - offset)
    const chunkPath = `${workDir}/${uploadId}_${i}`

    store.updateMediaQueueStatus({
      progressPercent: Math.min(99, Math.floor((i / totalChunks) * 100)),
      currentFileName: `${item.name || 'video'} [${i + 1}/${totalChunks}]`
    })

    try {
      await extractChunkToFile(srcPath, offset, length, chunkPath)
      await withRetry(() => uploadSingleChunkOnce(serverUrl, token, chunkPath, {
        uploadId,
        chunkIndex: i,
        totalChunks
      }))
    } catch (chunkStepErr) {
      // 首片失败：整条分片链路不可用，抛给上层回退
      if (i === 0) throw chunkStepErr
      console.error(`[MediaUploader] 第 ${i + 1}/${totalChunks} 片失败:`, chunkStepErr && chunkStepErr.message)
      throw chunkStepErr
    } finally {
      removeFileQuiet(chunkPath)
    }
  }

  return postJson(
    `${serverUrl}/api/sync/complete`,
    {
      uploadId,
      fileName: String(item.name || ''),
      totalChunks,
      dateModified: item.modified || '',
      clientAssetId: item.id || '',
      source: 'sync'
    },
    token,
    // 合并后服务端还要抽帧/入库，给更长窗口
    Math.max(VIDEO_TIMEOUT_MS, 180000)
  )
}

function uploadSingleDirectOnce(serverUrl, item, token, filePathOverride) {
  return new Promise((resolve, reject) => {
    const url = `${serverUrl}/api/sync/upload`
    const header = {}
    if (token) header['Authorization'] = `Bearer ${token}`

    const isVideo = isVideoItem(item)
    const timeout = calculateTimeout(item, isVideo)
    const filePath = filePathOverride || item.localPath

    const uploadTask = uni.uploadFile({
      url,
      filePath,
      name: 'file',
      header,
      formData: {
        client_asset_id: String(item.id || ''),
        taken_at: String(item.modified || ''),
        filename: String(item.name || ''),
        source: 'sync'
      },
      timeout,
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) {
          try {
            resolve(typeof res.data === 'string' ? JSON.parse(res.data) : res.data)
          } catch (_) {
            resolve(res.data)
          }
          return
        }
        let errDetail = `HTTP ${res.statusCode}`
        let body = null
        try {
          body = JSON.parse(res.data)
          if (body && body.error) errDetail = `${errDetail} (${body.error})`
        } catch (_) {}
        if (body && (body.code === 'blacklisted' || /黑名单|已被删除/.test(String(body.error || '')))) {
          reject(makeSkipError(body.error || 'blacklisted'))
          return
        }
        reject(new Error(`上传服务端异常 ${errDetail}`))
      },
      fail: (err) => {
        const errMsg = err && (err.errMsg || err.message) ? (err.errMsg || err.message) : JSON.stringify(err)
        reject(new Error(errMsg))
      }
    })

    if (uploadTask && uploadTask.onProgressUpdate) {
      uploadTask.onProgressUpdate((p) => {
        store.updateMediaQueueStatus({
          progressPercent: p.progress || 0
        })
      })
    }
  })
}

function uploadMockOnce(serverUrl, item, token) {
  return new Promise((resolve, reject) => {
    const url = `${serverUrl}/api/sync/upload`
    const header = {}
    if (token) header['Authorization'] = `Bearer ${token}`

    const mockBlob = new Blob([`mock-media-content-${item.id}`], { type: 'text/plain' })
    const form = new FormData()
    form.append('file', mockBlob, item.name || 'mock.jpg')
    form.append('client_asset_id', item.id)
    form.append('taken_at', String(item.modified || Date.now()))

    uni.request({
      url,
      method: 'POST',
      header,
      data: form,
      timeout: IMAGE_TIMEOUT_MS,
      success: (res) => {
        if (res.statusCode >= 200 && res.statusCode < 300) resolve(res.data)
        else reject(new Error(`HTTP ${res.statusCode}`))
      },
      fail: reject
    })
  })
}

/**
 * 单文件上传至服务端 /api/sync/upload（大视频自动分片）
 */
async function uploadSingleMedia(serverUrl, item, token) {
  // H5 / 模拟无真实路径时
  if (!item.localPath || item.localPath.startsWith('mock_')) {
    return withRetry(() => uploadMockOnce(serverUrl, item, token))
  }

  const pre = await checkLocalFileReadable(item.localPath)
  if (!pre.ok) {
    throw new Error(`本地文件不可用: ${pre.reason || '路径失效'}`)
  }

  const isVideo = isVideoItem(item)
  const size = Number(item.size) || pre.size || 0

  // 大视频：优先分片，失败则回退整包直传
  if (isVideo && size >= LARGE_VIDEO_THRESHOLD) {
    try {
      return await uploadLargeVideoChunked(serverUrl, item, token, pre.path || item.localPath)
    } catch (chunkErr) {
      if (chunkErr && chunkErr.skip) throw chunkErr
      console.warn(`[MediaUploader] 分片上传失败，回退整包直传: ${chunkErr && chunkErr.message}`)
    }
  }

  return withRetry(() => uploadSingleDirectOnce(serverUrl, item, token, pre.path || item.localPath))
}

/**
 * 启动待上传媒体文件队列（带受控并发加速）
 * @param {Array} neededItems 服务端快照比对后返回的缺失列表
 */
export async function startUploadQueue(neededItems = []) {
  if (isQueueRunning) {
    console.warn('[MediaUploader] 队列正在运行中')
    return store.getMediaQueueStatus()
  }

  const serverUrl = store.getServerUrl()
  if (!serverUrl) {
    console.error('[MediaUploader] 未配置服务器地址')
    return
  }
  const token = store.getServerToken() || store.getToken()

  // 1. 网络检查
  const net = await checkNetworkAllowed()
  if (!net.allowed) {
    console.log(`[MediaUploader] ${net.reason}`)
    uni.showToast({ title: '仅 Wi-Fi 同步已开启，当前已暂停上传', icon: 'none' })
    return
  }

  if (!neededItems.length) {
    console.log('[MediaUploader] 没有需要上传的媒体文件，已是最新状态')
    return
  }

  isQueueRunning = true
  let success = 0
  let fail = 0
  let completed = 0
  const total = neededItems.length
  const failedItems = []

  store.updateMediaQueueStatus({
    isUploading: true,
    total,
    current: 0,
    currentFileName: '',
    progressPercent: 0,
    successCount: 0,
    failCount: 0
  })

  // 分离大文件（>= 30MB 视频）与普通文件：普通文件 3 并发快速完成，大视频单任务独享带宽
  const normalItems = []
  const largeVideoItems = []
  for (const it of neededItems) {
    const isVid = isVideoItem(it)
    const sz = Number(it.size) || 0
    if (isVid && sz >= LARGE_VIDEO_THRESHOLD) {
      largeVideoItems.push(it)
    } else {
      normalItems.push(it)
    }
  }

  console.log(`[MediaUploader] 开始上传差量媒体文件: 总计 ${total} 项 (普通文件 ${normalItems.length} 项，超大视频 ${largeVideoItems.length} 项)`)

  async function processItem(item) {
    store.updateMediaQueueStatus({
      current: completed + 1,
      currentFileName: item.name || `item_${completed + 1}`
    })

    try {
      await uploadSingleMedia(serverUrl, item, token)
      success++
      store.updateMediaQueueStatus({ successCount: success })
    } catch (err) {
      if (err && err.skip) {
        // 黑名单/已删除：跳过，不计失败
        success++
        store.updateMediaQueueStatus({ successCount: success })
        console.log(`[MediaUploader] 跳过已删除素材: ${item.name}`)
      } else {
        fail++
        const reason = err && err.message ? err.message : String(err)
        const sizeMb = item.size ? ` size=${(Number(item.size) / 1048576).toFixed(1)}MB` : ''
        console.error(`[MediaUploader] 上传失败: ${item.name}${sizeMb}`, reason)
        failedItems.push({ name: item.name, id: item.id, error: reason })
        store.updateMediaQueueStatus({ failCount: fail })
      }
    } finally {
      completed++
      store.updateMediaQueueStatus({
        current: Math.min(completed, total),
        progressPercent: Math.round((completed / total) * 100)
      })
    }
  }

  // 1. 普通文件并发高速同步
  if (normalItems.length > 0) {
    let cur = 0
    const workers = []
    const conc = Math.min(UPLOAD_CONCURRENCY, normalItems.length)
    for (let i = 0; i < conc; i++) {
      workers.push((async () => {
        while (cur < normalItems.length) {
          const idx = cur++
          await processItem(normalItems[idx])
        }
      })())
    }
    await Promise.all(workers)
  }

  // 2. 超大视频单路串行上传（独享带宽，避免网络拥塞与相互超时）
  for (const bigVideo of largeVideoItems) {
    await processItem(bigVideo)
  }

  isQueueRunning = false
  store.updateMediaQueueStatus({
    isUploading: false,
    progressPercent: 100
  })

  console.log(`[MediaUploader] 媒体队列同步完成: 成功 ${success}, 失败 ${fail}${failedItems.length ? ` (失败 ${failedItems.length} 项)` : ''}`)
  return { total, success, fail, failedItems }
}

export function isMediaUploaderRunning() {
  return isQueueRunning
}
