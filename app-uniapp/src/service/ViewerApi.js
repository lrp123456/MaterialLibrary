/**
 * 素材库 API + 会话（MaterialViewer 迁移）
 * API_BASE = /api/viewer
 */
import { store } from './SyncStateStore'
import { viewerCache } from './ViewerCache'
import { currentServerUrl, ensureServerUrl, markServerDown } from './ServerResolve'

const API_BASE = '/api/viewer'
const TIMEOUT = 20000

function buildUrl(path, query = []) {
  const server = currentServerUrl()
  let url = server + API_BASE + path
  const valid = query.filter(Boolean)
  if (valid.length) url += '?' + valid.join('&')
  return url
}

function authHeader() {
  const h = { 'Content-Type': 'application/json' }
  const t = store.getToken()
  if (t) h['Authorization'] = 'Bearer ' + t
  return h
}

export async function request(path, { method = 'GET', query = [], body = '', timeout = TIMEOUT } = {}) {
  await ensureServerUrl()
  return new Promise((resolve, reject) => {
    uni.request({
      url: buildUrl(path, query),
      method,
      header: authHeader(),
      data: body || undefined,
      timeout: timeout || TIMEOUT,
      success: (res) => {
        const code = res.statusCode || 0
        if (code === 401 && path !== '/auth/login') {
          store.clearSession()
          viewerCache.clearAll()
          reject(new Error('未登录或会话已过期'))
          return
        }
        const root = res.data
        if (root == null || typeof root !== 'object') {
          reject(new Error(`服务端响应异常（HTTP ${code}），请确认地址是否正确`))
          return
        }
        const ok = root.success === true || root.success === 'true'
        if (code < 200 || code >= 300 || !ok) {
          reject(new Error(root.error || `HTTP ${code}`))
          return
        }
        resolve(root.data)
      },
      fail: (err) => {
        markServerDown(currentServerUrl())
        const msg = (err && err.errMsg) || '网络错误'
        if (/timeout/i.test(msg)) {
          reject(new Error('连接超时，请检查服务器地址与网络'))
        } else if (/cleartext|not allowed/i.test(msg)) {
          reject(new Error('无法建立连接（HTTP 明文请求可能被系统拦截）'))
        } else if (/fail/i.test(msg)) {
          reject(new Error('无法连接服务器，请检查地址与网络'))
        } else {
          reject(new Error(msg))
        }
      },
    })
  })
}

export async function login(username, password) {
  const data = await request('/auth/login', {
    method: 'POST',
    body: JSON.stringify({ username, password }),
  })
  const token = data.token || ''
  const user = data.user || {}
  store.setToken(token)
  store.setUsername(user.username || username)
  store.setRole(user.role || 'viewer')
  return data
}

export async function fetchMe() {
  return request('/auth/me')
}

export async function logout() {
  try {
    await request('/auth/logout', { method: 'POST' })
  } catch (e) {
    console.warn('[ViewerApi] logout notify failed (ignored)', e)
  } finally {
    store.clearSession()
    viewerCache.clearAll()
  }
}

export async function fetchAssets(opts = {}) {
  const {
    page = 1,
    pageSize = 30,
    keyword = '',
    space = '',
    style = '',
    material = '',
    colors = '',
    colorStyle = '',
    color_style = '',
    orientation = '',
    sort = 'latest',
    mediaType = '',
    videoSource = '',
    category = '',
    furniture_item = '',
    furniture_category = '',
    mood = '',
    genre = '',
    pose = '',
    character = '',
    skipFacets = false,
  } = opts
  // 服务端 sort：latest | earliest | recommend（兼容误传 oldest）
  const resolvedSort = sort === 'oldest' ? 'earliest' : sort
  const resolvedColorStyle = colorStyle || color_style
  const query = [
    `page=${page}`,
    `pageSize=${pageSize}`,
    keyword ? `keyword=${encodeURIComponent(keyword)}` : '',
    category ? `category=${encodeURIComponent(category)}` : '',
    space ? `space=${encodeURIComponent(space)}` : '',
    style ? `style=${encodeURIComponent(style)}` : '',
    material ? `material=${encodeURIComponent(material)}` : '',
    furniture_item ? `furniture_item=${encodeURIComponent(furniture_item)}` : '',
    furniture_category ? `furniture_category=${encodeURIComponent(furniture_category)}` : '',
    mood ? `mood=${encodeURIComponent(mood)}` : '',
    genre ? `genre=${encodeURIComponent(genre)}` : '',
    pose ? `pose=${encodeURIComponent(pose)}` : '',
    character ? `character=${encodeURIComponent(character)}` : '',
    colors ? `colors=${encodeURIComponent(colors)}` : '',
    resolvedColorStyle ? `color_style=${encodeURIComponent(resolvedColorStyle)}` : '',
    orientation ? `orientation=${encodeURIComponent(orientation)}` : '',
    resolvedSort ? `sort=${encodeURIComponent(resolvedSort)}` : '',
    mediaType ? `media_type=${encodeURIComponent(mediaType)}` : '',
    videoSource ? `video_source=${encodeURIComponent(videoSource)}` : '',
    skipFacets ? 'skip_facets=1' : '',
  ]
  const data = await request('/assets', { query })
  if (data) {
    const key = viewerCache.makeListKey(opts)
    viewerCache.setList(key, data)
  }
  return data
}

/**
 * 下载并保存媒体（图片/视频/人像/单品）到系统相册，并登记到防重扫描白名单
 */
export async function downloadAndSaveToAlbum({ url, fileName = '', isVideo = false, isAudio = false }) {
  if (!url) throw new Error('无效的下载地址')

  const isAudioFile = isAudio || /\.(mp3|wav|m4a|aac|flac)$/i.test(fileName || url)
  const isVideoFile = isVideo || /\.(mp4|mov|avi|mkv|webm)$/i.test(fileName || url)

  let saveName = fileName || (isAudioFile ? `ML_AUDIO_${Date.now()}.mp3` : (isVideoFile ? `ML_VIDEO_${Date.now()}.mp4` : `ML_IMAGE_${Date.now()}.jpg`))
  if (!saveName.toLowerCase().startsWith('ml_saved_')) {
    saveName = `ML_SAVED_${saveName}`
  }

  uni.showLoading({ title: '正在保存素材...', mask: true })

  const saveLocalFile = (filePath) => {
    return new Promise((resolve, reject) => {
      if (isAudioFile) {
        // 音频保存到应用永久本地存储，并登记防重白名单
        uni.saveFile({
          tempFilePath: filePath,
          success: (res) => {
            uni.hideLoading()
            store.recordExportedMedia(saveName)
            if (fileName && fileName !== saveName) {
              store.recordExportedMedia(fileName)
            }
            uni.showToast({ title: '音频已保存到手机', icon: 'success' })
            resolve({ success: true, savedFilePath: res.savedFilePath, fileName: saveName })
          },
          fail: (saveErr) => {
            uni.hideLoading()
            const errMsg = (saveErr && saveErr.errMsg) || '保存音频失败'
            uni.showToast({ title: errMsg, icon: 'none' })
            reject(new Error(errMsg))
          },
        })
        return
      }

      const saveFn = isVideoFile ? uni.saveVideoToPhotosAlbum : uni.saveImageToPhotosAlbum
      saveFn({
        filePath,
        success: () => {
          uni.hideLoading()
          store.recordExportedMedia(saveName)
          if (fileName && fileName !== saveName) {
            store.recordExportedMedia(fileName)
          }
          uni.showToast({ title: '已成功保存至相册', icon: 'success' })
          resolve({ success: true, fileName: saveName })
        },
        fail: (saveErr) => {
          uni.hideLoading()
          const errMsg = (saveErr && saveErr.errMsg) || '保存相册失败'
          uni.showToast({ title: errMsg, icon: 'none' })
          reject(new Error(errMsg))
        },
      })
    })
  }

  // 如果已经是本地文件路径
  if (!url.startsWith('http://') && !url.startsWith('https://')) {
    return saveLocalFile(url)
  }

  // 改造下载 URL，在 URL 路径末尾带上标准 saveName，防止客户端截取为 image.jpg / image(x).jpg
  let downloadUrl = url;
  try {
    if (url.startsWith('http://') || url.startsWith('https://')) {
      const u = new URL(url);
      if (u.pathname.endsWith('/image') || u.pathname.endsWith('/file')) {
        u.pathname = `${u.pathname}/${encodeURIComponent(saveName)}`;
        u.searchParams.set('download', '1');
        downloadUrl = u.toString();
      }
    }
  } catch (_) {}

  // 远程 URL 先下载为临时文件
  return new Promise((resolve, reject) => {
    uni.downloadFile({
      url: downloadUrl,
      success: async (res) => {
        if (res.statusCode === 200 && res.tempFilePath) {
          try {
            let targetPath = res.tempFilePath;
            if (typeof plus !== 'undefined' && plus.io && plus.io.resolveLocalFileSystemURL) {
              try {
                targetPath = await new Promise((resMove) => {
                  plus.io.resolveLocalFileSystemURL(res.tempFilePath, (entry) => {
                    plus.io.requestFileSystem(plus.io.PRIVATE_DOC, (fsSys) => {
                      fsSys.root.getDirectory('exports', { create: true }, (dir) => {
                        entry.moveTo(dir, saveName, (newEntry) => {
                          resMove(newEntry.toLocalURL ? newEntry.toLocalURL() : newEntry.fullPath);
                        }, () => resMove(res.tempFilePath));
                      }, () => resMove(res.tempFilePath));
                    }, () => resMove(res.tempFilePath));
                  }, () => resMove(res.tempFilePath));
                });
              } catch (_) {}
            }
            const r = await saveLocalFile(targetPath)
            resolve(r)
          } catch (e) {
            reject(e)
          }
        } else {
          uni.hideLoading()
          const msg = `下载文件失败 (HTTP ${res.statusCode})`
          uni.showToast({ title: msg, icon: 'none' })
          reject(new Error(msg))
        }
      },
      fail: (err) => {
        uni.hideLoading()
        const errMsg = (err && err.errMsg) || '网络下载失败'
        uni.showToast({ title: errMsg, icon: 'none' })
        reject(new Error(errMsg))
      },
    })
  })
}

export async function fetchDetail(fid) {
  const data = await request('/assets/' + encodeURIComponent(fid))
  if (data) {
    viewerCache.setDetail(fid, data)
  }
  return data
}

/**
 * 素材质量评估（9 维）+ pHash 相似组。
 * 只读接口：服务端不提供任何淘汰/删除动作，这里只做展示。
 */
export async function fetchQuality(fid) {
  return request('/assets/' + encodeURIComponent(fid) + '/quality')
}

/**
 * 列表缩略图 URL。
 * 注意：assets.thumb_url 常是失效的 /api/thumbs/*.jpg，禁止直接使用；
 * 一律走 /assets/{fid}/image，并用 local=1 避免 302 到坏外链。
 */
export function thumbFetchUrl(fid, thumbPath = '', derivativeId = 0) {
  void thumbPath
  return mediaUrl(fid, derivativeId, false)
}

/** 媒体缩略/原图 URL（token 查询参数鉴权；local=1 强制服务端读本地产物） */
/**
 * 素材图片地址。
 * tier='grid' 走服务端 256px 网格档（App 列表专用，体积约为预览图的 1/30）
 */
export function mediaUrl(fid, derivativeId = 0, dl = false, tier = '') {
  const server = currentServerUrl()
  const token = store.getToken()
  const q = [`token=${encodeURIComponent(token)}`, 'local=1']
  if (derivativeId > 0) q.push(`derivative=${derivativeId}`)
  if (dl) q.push('dl=1')
  if (tier) q.push(`tier=${encodeURIComponent(tier)}`)
  return (
    server +
    API_BASE +
    '/assets/' +
    encodeURIComponent(fid) +
    '/image?' +
    q.join('&')
  )
}

/** 网格档缩略图地址（App 列表用） */
export function gridUrl(fid) {
  return mediaUrl(fid, 0, false, 'grid')
}

/** 视频媒体流地址 */
export function videoUrl(fid, dl = false) {
  return mediaUrl(fid, 0, dl)
}

/** 视频封面/海报图地址 */
export function posterUrl(fid) {
  const server = currentServerUrl()
  const token = store.getToken()
  const q = [`token=${encodeURIComponent(token)}`]
  return server + API_BASE + '/assets/' + encodeURIComponent(fid) + '/poster?' + q.join('&')
}

/** 提交 AI 处理 / 衍生生成任务 */
export async function submitAiTask(fid, payload = {}) {
  return request('/ai/tasks', {
    method: 'POST',
    body: JSON.stringify({ fid, ...payload }),
  })
}

/** 精修贴图/遮罩临时上传，返回引擎可拉的 url */
export function uploadAiFile(filePath, filename = 'upload.png') {
  return new Promise((resolve, reject) => {
    const server = currentServerUrl()
    const token = store.getToken()
    uni.uploadFile({
      url: server + API_BASE + '/ai/upload',
      filePath,
      name: 'file',
      header: token ? { Authorization: 'Bearer ' + token } : {},
      formData: { filename },
      timeout: 60000,
      success: (res) => {
        try {
          const root = typeof res.data === 'string' ? JSON.parse(res.data) : res.data
          if (res.statusCode >= 200 && res.statusCode < 300 && root && root.success) {
            resolve(root.data)
            return
          }
          reject(new Error((root && root.error) || `上传失败 HTTP ${res.statusCode}`))
        } catch (e) {
          reject(new Error('上传响应无法解析'))
        }
      },
      fail: (err) => reject(new Error((err && err.errMsg) || '上传失败')),
    })
  })
}

/** 查询 AI 处理任务状态与产物（按 fid 取最新） */
export async function queryAiTask(fid) {
  return request(`/assets/${encodeURIComponent(fid)}/ai/tasks`, {
    method: 'GET',
  })
}

/** 按 taskId 查询 AI 任务 */
export async function queryAiTaskById(taskId) {
  return request(`/ai/tasks/${encodeURIComponent(taskId)}`, {
    method: 'GET',
  })
}

export async function triggerRestage(fid, { ratios = ['9:16', '3:4'], mainRatio = '9:16', extraPrompt = '' } = {}) {
  return request(`/assets/${encodeURIComponent(fid)}/restage`, {
    method: 'POST',
    body: JSON.stringify({
      ratios,
      mainRatio,
      extraPrompt: String(extraPrompt || '').trim(),
      replaceExisting: true,
      forceMember: true,
    }),
    timeout: 180000,
  })
}

/** 获取动态能力清单 (扩图/消除/超分/漫游等) */
export async function fetchQuickCapabilities() {
  return request('/ai/capabilities')
}

export async function fetchLabCapabilities() {
  return request('/lab/capabilities', { method: 'GET' })
}

export function fetchPortraitLibrary() {
  return request('/portrait-library', { method: 'GET' })
}

export function acceptPortraitConsent() {
  return request('/portrait-library/consent', {
    method: 'POST',
    body: JSON.stringify({ accepted: true }),
  })
}

export function createPortraitGroup(name) {
  return request('/portrait-library/groups', {
    method: 'POST',
    body: JSON.stringify({ name }),
  })
}

export function deletePortraitAsset(id) {
  return request('/portrait-library/assets/' + encodeURIComponent(id), { method: 'DELETE' })
}

export function deletePortraitGroup(id) {
  return request('/portrait-library/groups/' + encodeURIComponent(id), { method: 'DELETE' })
}

export function uploadPortraitAsset(groupId, filePath, filename = 'portrait.jpg') {
  return new Promise((resolve, reject) => {
    const server = currentServerUrl()
    const token = store.getToken()
    uni.uploadFile({
      url: server + API_BASE + '/portrait-library/groups/' + encodeURIComponent(groupId) + '/assets',
      filePath,
      name: 'file',
      header: token ? { Authorization: 'Bearer ' + token } : {},
      formData: { filename },
      timeout: 120000,
      success: (res) => {
        try {
          const root = typeof res.data === 'string' ? JSON.parse(res.data) : res.data
          if (res.statusCode >= 200 && res.statusCode < 300 && root && root.success) {
            resolve(root.data)
            return
          }
          reject(new Error((root && root.error) || `上传失败 HTTP ${res.statusCode}`))
        } catch (e) {
          reject(new Error('上传响应无法解析'))
        }
      },
      fail: (err) => reject(new Error((err && err.errMsg) || '上传失败')),
    })
  })
}

/** 提交 AI 试验场 / 快捷精修任务 */
export async function submitLabRun(payload = {}) {
  return request('/lab/runs', {
    method: 'POST',
    body: JSON.stringify(payload),
    timeout: 90000,
  })
}

/** 轮询 AI 试验场 / 快捷精修任务状态 */
export async function pollLabRun(engine, runId) {
  return request(`/lab/runs/${encodeURIComponent(engine)}/${encodeURIComponent(runId)}`, {
    method: 'GET',
    timeout: 15000,
  })
}

/** 获取企业级 AI 创作会话列表 */
export async function fetchChatSessions() {
  return request('/chat/sessions', { method: 'GET' })
}

/** 创建/切换 AI 创作会话 */
export async function createChatSession(payload = {}) {
  return request('/chat/sessions', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

/** 删除 AI 创作会话 */
export async function deleteChatSession(sessionId) {
  return request(`/chat/sessions/${encodeURIComponent(sessionId)}`, {
    method: 'DELETE',
  })
}

/** 获取指定会话的消息流 */
export async function fetchChatMessages(sessionId = 'default_session', limit = 100) {
  return request('/chat/messages', {
    method: 'GET',
    query: [`sessionId=${encodeURIComponent(sessionId)}`, `limit=${limit}`],
  })
}

/** 保存/更新一条对话消息 */
export async function saveChatMessage(payload = {}) {
  return request('/chat/messages', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

/** ch01 元素标签对话：文本 + 引用芯片 → 豆包 → 回复 */
export async function chatComplete(payload = {}) {
  return request('/gen/chat', {
    method: 'POST',
    body: JSON.stringify(payload),
    timeout: 120000,
  })
}

/** ch01 对话别名（与 Web 端 sendChat 同名） */
export const sendChat = chatComplete

/** ch03 精准编辑：选区 + 操作 + 提示词 → 贴回 */
export async function aiEdit(payload = {}) {
  return request('/edit/run', {
    method: 'POST',
    body: JSON.stringify(payload),
    timeout: 180000,
  })
}

/** ch04 实例分割（YOLO-seg / 本地兜底） */
export async function aiSegment(payload = {}) {
  return request('/ai/segment', {
    method: 'POST',
    body: JSON.stringify(payload),
    timeout: 90000,
  })
}

/** ch02 分模型提示词优化（独立调用） */
export async function optimizePrompt(arg1 = {}, arg2 = {}) {
  const body = typeof arg1 === 'string' ? JSON.stringify({ prompt: arg1, ...arg2 }) : JSON.stringify(arg1)
  return request('/chat/optimize-prompt', {
    method: 'POST',
    body,
    timeout: 120000,
  })
}

/** 生成/编辑异步任务提交 */
export async function aiTaskSubmit(payload = {}) {
  return request('/ai/tasks', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

/** 贴回校验别名 */
export const aiEditVerify = verifyPasteback

/** 清空当前会话的消息 */
export async function clearChatMessages(sessionId = 'default_session') {
  return request('/chat/messages', {
    method: 'DELETE',
    query: [`sessionId=${encodeURIComponent(sessionId)}`],
  })
}

/**
 * 上传本地参考图，返回引擎可拉取的绝对 URL。
 * Agnes/火山要求公网可访问，故用服务器地址拼绝对路径。
 */
export function uploadRefImage(filePath, name = 'ref.jpg') {
  return new Promise((resolve, reject) => {
    const server = currentServerUrl()
    if (!server || !filePath) {
      reject(new Error('缺少服务器或本地文件'))
      return
    }
    const token = store.getToken()
    const header = {}
    if (token) header['Authorization'] = 'Bearer ' + token
    uni.uploadFile({
      url: server + API_BASE + '/ai/upload',
      filePath,
      name: 'file',
      header,
      formData: { filename: name },
      timeout: 60000,
      success: (res) => {
        try {
          const body = typeof res.data === 'string' ? JSON.parse(res.data) : res.data
          if (res.statusCode >= 200 && res.statusCode < 300 && body && body.success !== false) {
            const data = body.data || body
            let u = data.url || ''
            // 服务端可能返回 localhost/127.0.0.1，云端模型拉不到：改用 App 配置的服务器地址
            const srv = String(server || '').replace(/\/$/, '')
            if (u && /^https?:\/\//i.test(u)) {
              if (/^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?/i.test(u) && srv && !/^https?:\/\/(127\.0\.0\.1|localhost)/i.test(srv)) {
                try {
                  const pathPart = u.replace(/^https?:\/\/[^/]+/i, '')
                  u = srv + pathPart
                } catch (e) {}
              }
            } else if (u) {
              u = srv + (u.startsWith('/') ? u : '/' + u)
            }
            resolve({ id: data.id || '', url: u })
          } else {
            reject(new Error((body && body.error) || `HTTP ${res.statusCode}`))
          }
        } catch (e) {
          reject(new Error('上传响应解析失败'))
        }
      },
      fail: (err) => reject(new Error((err && err.errMsg) || '上传失败')),
    })
  })
}

/** 批量上传参考图 */
export async function uploadRefImages(filePaths = []) {
  const out = []
  for (const p of filePaths) {
    if (!p) continue
    // 已是 http(s) 的直接透传（例如从素材库转生视频带来的 URL）
    if (/^https?:\/\//i.test(p)) {
      out.push({ url: p, id: '' })
      continue
    }
    out.push(await uploadRefImage(p))
  }
  return out
}

// /** 智能提示词扩写优化（支持多模态参考图传入 VLM） */
// export async function optimizePrompt(prompt, { modelId, mode, slots, locked, imageUrls, images } = {}) {
//   return request('/chat/optimize-prompt', {
//     method: 'POST',
//     body: JSON.stringify({ prompt, modelId, mode, slots, locked, imageUrls, images }),
//     timeout: 90000,
//   })
// }

/** 快捷实例分割 (YOLO-seg) — 编辑器主路径已改为端侧 EdgeSAM，本接口保留兼容 */
export async function segmentImage(payload = {}) {
  return request('/ai/segment', {
    method: 'POST',
    body: JSON.stringify(payload),
  })
}

/** §10 端侧本地模型目录 */
export async function fetchLocalModels() {
  return request('/lab/local-models', { method: 'GET' })
}

/** §10 模型包下载 URL（配合 uni.downloadFile / 原生桥） */
export function localModelDownloadUrl(modelId) {
  return buildUrl(`/lab/local-models/${encodeURIComponent(modelId)}/download`)
}

/** §12 提交选区精准编辑（maskUrl + polygon） */
export async function submitMaskedEdit(payload = {}) {
  return request('/lab/runs', {
    method: 'POST',
    body: JSON.stringify({
      entryId: payload.entryId || 'edit.masked',
      fid: payload.fid || null,
      params: payload.params || {},
    }),
    timeout: 60000,
  })
}

/** 获取预置 3D 产品列表 */
export async function fetchProductPresets() {
  return request('/products/presets', {
    method: 'GET',
  })
}

/** 软删除素材资产 */
export async function deleteAsset(fid) {
  if (!fid) return false
  const res = await request(`/assets/${encodeURIComponent(fid)}`, {
    method: 'DELETE',
  })
  viewerCache.clearAll()
  return res
}

/** 设置母素材的主封面衍生版本 */
export async function setMainDerivativeApi(fid, derivativeId) {
  if (!fid || !derivativeId) throw new Error('缺少参数')
  const res = await request(`/assets/${encodeURIComponent(fid)}/main-derivative`, {
    method: 'POST',
    body: JSON.stringify({ derivativeId }),
  })
  viewerCache.clearAll()
  return res
}

export function sessionValid() {
  return !!store.getToken()
}

/** 获取统一三层菜单树与打标联动系统 */
export async function fetchMenuTree() {
  return request('/dict/menu-tree', { method: 'GET' })
}

/** 获取统一工作台 Schema 契约（模型列表、快捷项与高级抽屉控制项） */
export async function fetchStudioSchema() {
  return request('/studio/schema', { method: 'GET' })
}

/** 优化提示词 (根据模型与模式服务端专属 Skill 扩写) */
export async function optimizePromptApi({ prompt, modelId, mode, imageUrls }) {
  return request('/chat/optimize-prompt', {
    method: 'POST',
    body: JSON.stringify({ prompt, modelId, mode, imageUrls }),
  })
}

export { viewerCache }

