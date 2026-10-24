/**
 * 统一网络通信层与免密/静默登录鉴权
 * 支持自动认证、401 自动续期重试、媒体 URL Token 自动注入
 *
 * 三级回退（同源网关 → 本机 → 局域网 → 公网）由 server-resolve.js 的全局
 * fetch 守卫透明处理；本模块只负责把相对媒体路径按当前生效 base 转成可用 URL。
 */
import { resolveApiUrl } from './server-resolve.js';

const TOKEN_KEY = 'ml_token';
const USER_KEY = 'ml_user';

export function getToken() {
  return localStorage.getItem(TOKEN_KEY) || '';
}

export function getCurrentUser() {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (_) {
    return null;
  }
}

export function setSession(token, user) {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_KEY);
  }
  if (user) {
    localStorage.setItem(USER_KEY, JSON.stringify(user));
  } else {
    localStorage.removeItem(USER_KEY);
  }
}

/**
 * 鉴权失败错误：调用方据此弹出登录框（区别于网络断线/普通业务错误）。
 */
export class AuthRequiredError extends Error {
  constructor(message = '需要登录') {
    super(message);
    this.name = 'AuthRequiredError';
  }
}

function notifyAuthRequired(reason = '') {
  try { window.dispatchEvent(new CustomEvent('ml_auth_required', { detail: reason })); } catch { /* ignore */ }
}

/**
 * 服务端说「未授权」时的统一收口：本地那份 token 已经是死串，
 * 必须清掉再广播 —— 否则 isLoggedIn() 仍为真，登录框永远弹不出来，
 * 用户只能对着满屏破图（<img> 不走 authFetch，没人替它清会话）。
 */
export function reportUnauthorized() {
  setSession('', null);
  notifyAuthRequired('expired');
}

/**
 * 用户名密码登录：POST /api/auth/login → { token, user }。
 * 成功后落地 localStorage，并广播登录成功事件供界面刷新。
 */
export async function login(username, password) {
  const res = await fetch('/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json?.data?.token) {
    throw new Error(json.error || `登录失败 HTTP ${res.status}`);
  }
  const { token, user } = json.data;
  setSession(token, user || { username });
  try { window.dispatchEvent(new CustomEvent('ml_login', { detail: user || { username } })); } catch { /* ignore */ }
  return { token, user: user || { username } };
}

export function logout() {
  // 尽力通知后端销毁会话；网络失败也照常清除本地会话
  fetch('/api/auth/logout', { method: 'POST' }).catch(() => {});
  setSession('', null);
  notifyAuthRequired();
}

export function isLoggedIn() {
  return !!getToken();
}

/**
 * 向服务端验一次本地会话。localStorage 里有 token 字符串不等于还活着：
 * 会话可能被撤销（换密码/被清理），此时页面照常打开、图片全 401 破图。
 * 进页面和切回页签各验一次，死了就当场要登录，而不是让人对着一屏破图猜。
 * 网络异常不算掉登录（离线/换源时不该把人踢出去）。
 */
export async function verifySession() {
  if (!getToken()) {
    notifyAuthRequired();
    return false;
  }
  try {
    const res = await authFetch('/api/auth/me');
    return res.status !== 403;
  } catch (e) {
    // authFetch 遇到 401 已经清会话 + 广播过了，这里只负责不再往上抛
    if (e && e.name === 'AuthRequiredError') return false;
    return true;
  }
}

/**
 * 确保具备有效 Token。web-pro 没有（也不应有）内置口令，
 * 本地无会话时抛 AuthRequiredError，由全局登录弹窗承接——
 * 这是局域网新设备之前“空白/未找到素材”的真正原因（localStorage 按源隔离，无 token）。
 */
export async function ensureToken() {
  const token = getToken();
  if (token) return token;
  notifyAuthRequired();
  throw new AuthRequiredError();
}

/**
 * 携带鉴权头的通用 fetch；无 token 或 401 时广播 ml_auth_required 并抛 AuthRequiredError。
 */
export async function authFetch(url, options = {}) {
  const token = getToken();
  const headers = new Headers(options.headers || {});
  if (token && !headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const res = await fetch(url, { ...options, headers });

  if (res.status === 401) {
    reportUnauthorized();
    throw new AuthRequiredError('登录已过期，请重新登录');
  }

  return res;
}

/**
 * 获取素材缩略图/大图 URL（双重附带 Token 与 MediaToken，确保 <img> 永不 401）
 */
export function getAssetImageUrl(fid, mediaToken = '') {
  if (!fid) return '';
  const token = getToken();
  const q = new URLSearchParams();
  if (token) q.set('token', token);
  if (mediaToken) q.set('media_token', mediaToken);
  const qs = q.toString();
  return resolveApiUrl(`/api/viewer/assets/${encodeURIComponent(fid)}/image${qs ? `?${qs}` : ''}`);
}

/**
 * 重新签发素材 URL。创作配方里存下来的 `/api/.../image?token=xxx` 是当前会话的短期凭证，
 * 换登录/换 token 后原样回填必然 401；这里只换凭证，derivative 等业务参数原样保留。
 */
export function resignAssetUrl(storedUrl) {
  const url = String(storedUrl || '');
  if (!url.startsWith('/api/') && !/^https?:\/\//i.test(url)) return url;
  let u;
  try {
    u = new URL(url, window.location.origin);
  } catch {
    return url;
  }
  if (!/^\/api\/(?:viewer\/)?assets\//.test(u.pathname)) return url;
  // 跨主机的绝对地址不是我们签的，动不了，原样返回。
  if (!url.startsWith('/') && u.origin !== window.location.origin) return url;
  u.searchParams.delete('token');
  u.searchParams.delete('media_token');
  const token = getToken();
  if (token) u.searchParams.set('token', token);
  return `${u.pathname}${u.search}`;
}

/**
 * 获取素材「原始图」URL（raw=1 强制 origin 衍生，绕开默认缩略图 / main_derivative）
 * 版本选择器里的「原图」必须用它，否则可能拿到被重构过画幅的主衍生图。
 */
export function getAssetOriginalUrl(fid, mediaToken = '') {
  if (!fid) return '';
  const token = getToken();
  const q = new URLSearchParams();
  q.set('raw', '1');
  if (token) q.set('token', token);
  if (mediaToken) q.set('media_token', mediaToken);
  return resolveApiUrl(`/api/viewer/assets/${encodeURIComponent(fid)}/image?${q.toString()}`);
}

/**
 * 获取视频海报 URL
 */
export function getAssetPosterUrl(fid, mediaToken = '') {
  if (!fid) return '';
  const token = getToken();
  const q = new URLSearchParams();
  if (token) q.set('token', token);
  if (mediaToken) q.set('media_token', mediaToken);
  const qs = q.toString();
  return resolveApiUrl(`/api/viewer/assets/${encodeURIComponent(fid)}/poster${qs ? `?${qs}` : ''}`);
}

/**
 * 获取素材原文件的「可播放流」URL：走 /file（等价 raw=1），服务端按 Range 回 206，
 * 且不像 getAssetDownloadUrl 那样带 download=1（那会 no-store，逐帧拖拽要反复回源）。
 */
export function getAssetPlayableUrl(fid) {
  if (!fid) return '';
  const token = getToken();
  const q = new URLSearchParams();
  if (token) q.set('token', token);
  return resolveApiUrl(`/api/viewer/assets/${encodeURIComponent(fid)}/file?${q.toString()}`);
}

/**
 * 获取素材原文件下载 URL
 */
export function getAssetDownloadUrl(fid) {
  if (!fid) return '';
  const token = getToken();
  const safeFid = String(fid).replace(/[^A-Za-z0-9_-]/g, '');
  const saveName = `ML_SAVED_${safeFid}_origin.jpg`;
  const q = new URLSearchParams();
  q.set('download', '1');
  if (token) q.set('token', token);
  return resolveApiUrl(`/api/viewer/assets/${encodeURIComponent(fid)}/file/${encodeURIComponent(saveName)}?${q.toString()}`);
}

/**
 * 查询素材列表（支持多维度组合条件）
 */
export async function fetchAssets(params = {}) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') {
      q.set(k, String(v));
    }
  }
  const res = await authFetch(`/api/viewer/assets?${q.toString()}`);
  if (!res.ok) {
    throw new Error(`获取素材失败: HTTP ${res.status}`);
  }
  const json = await res.json();
  return json.data || json;
}

/**
 * 查询回收站列表
 */
export async function fetchTrashAssets(params = {}) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') {
      q.set(k, String(v));
    }
  }
  const res = await authFetch(`/api/viewer/assets/trash?${q.toString()}`);
  if (!res.ok) {
    throw new Error(`获取回收站失败: HTTP ${res.status}`);
  }
  const json = await res.json();
  return json.data || json;
}

/**
 * 从回收站恢复素材
 */
export async function restoreFromTrash(fids) {
  const list = Array.isArray(fids) ? fids : [fids];
  const res = await authFetch('/api/assets/trash/restore', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fids: list })
  });
  return res.json();
}

/**
 * 彻底粉碎/删除回收站素材
 */
export async function purgeFromTrash(fids) {
  const list = Array.isArray(fids) ? fids : [fids];
  const res = await authFetch('/api/assets/trash/purge', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fids: list })
  });
  return res.json();
}

/**
 * 将素材移入回收站
 */
export async function deleteAsset(fid, reason = 'web_user_deleted') {
  const res = await authFetch(`/api/assets/${encodeURIComponent(fid)}/delete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason })
  });
  return res.json();
}

/**
 * 批量将素材移入回收站（素材库多选删除）。
 * 优先走服务端批量端点 /api/assets/batch-delete（逐项容错，返回 ok/failed 清单）；
 * 端点不存在或返回结构不符合预期（旧后端 404/400/HTML 兜底页等）时，
 * 自动回退为小并发逐条删除，保证灰度期兼容。
 * @returns {Promise<{ok: string[], failed: Array<{fid: string, error: string, code?: string, usedBy?: any[]}>}>}
 */
export async function deleteAssets(fids, reason = 'web_user_deleted') {
  const list = (Array.isArray(fids) ? fids : [fids]).filter(Boolean).map(String);
  if (!list.length) return { ok: [], failed: [] };
  try {
    const res = await authFetch('/api/assets/batch-delete', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fids: list, reason })
    });
    let json = null;
    try { json = await res.json(); } catch (_) { /* 非 JSON 响应（HTML 兜底页等）走回退 */ }
    const data = json?.data;
    // 只有结构完整才算批量端点真正生效，否则回退逐条（旧后端不会给出这个结构）
    if (res.ok && data && Array.isArray(data.ok) && Array.isArray(data.failed)) {
      return { ok: data.ok, failed: data.failed };
    }
  } catch (e) {
    // 登录过期等真实错误直接抛出，交由全局登录弹窗处理
    if (e?.name === 'AuthRequiredError') throw e;
  }
  // 回退：逐条软删（并发 4，失败项带原因汇总，不中断整批）
  const ok = [];
  const failed = [];
  let cursor = 0;
  async function worker() {
    while (cursor < list.length) {
      const fid = list[cursor++];
      try {
        const res = await authFetch(`/api/assets/${encodeURIComponent(fid)}/delete`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reason })
        });
        const json = await res.json().catch(() => ({}));
        if (!res.ok) {
          failed.push({ fid, error: json.error || `HTTP ${res.status}`, code: json.code || '', usedBy: json.usedBy || [] });
        } else {
          ok.push(fid);
        }
      } catch (err) {
        failed.push({ fid, error: err?.message || String(err) });
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(4, list.length) }, worker));
  return { ok, failed };
}

/**
 * 收藏 / 取消收藏素材
 */
export async function toggleFavorite(fid, on) {
  const options = { method: 'POST' };
  if (typeof on !== 'undefined') {
    options.headers = { 'Content-Type': 'application/json' };
    options.body = JSON.stringify({ on: !!on });
  }
  const res = await authFetch(`/api/viewer/assets/${encodeURIComponent(fid)}/favorite`, options);
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error(err.error || `收藏操作失败: HTTP ${res.status}`);
  }
  return res.json();
}

/**
 * 获取菜单树字典
 */
export async function fetchMenuTree() {
  const res = await authFetch('/api/viewer/dict/menu-tree');
  if (!res.ok) return null;
  const json = await res.json();
  return json.data || json;
}

/**
 * 获取素材完整详情（含 9:16、3:4、精修等全部衍生版本、打标与色卡）
 */
export async function fetchAssetDetail(fid) {
  if (!fid) return null;
  const res = await authFetch(`/api/viewer/assets/${encodeURIComponent(fid)}`);
  if (!res.ok) {
    throw new Error(`获取素材详情失败: HTTP ${res.status}`);
  }
  const json = await res.json();
  return json.data || json;
}

async function postJson(url, body) {
  const res = await authFetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {})
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.ok === false) throw new Error(json.error || `请求失败 ${res.status}`);
  return json;
}

export function moveAssetShelf(fid, shelf) {
  return postJson('/api/assets/shelf', { fid, shelf });
}

export function classifyAsset(body) {
  return postJson('/api/assets/classify', body);
}

export function retagAsset(fid) {
  return postJson('/api/assets/retag', { fid });
}

export function registerGeneratedAsset(body) {
  return postJson('/api/assets/from-generation', body);
}

/**
 * 触发单张素材的画幅重构（默认 9:16 + 3:4）。
 *
 * 后端这条链路是同步的：请求会一直挂到生图返回（几十秒到几分钟），
 * 调用方必须自己显示「生成中」并禁止重复点击，不能靠 loading 骨架屏猜。
 * ratios 只传实际缺失的那几档，避免把已经有的画幅重新生成一遍。
 *
 * model 显式传 Seedream 5.0 Flash：default 工作流的 restage_dual 可能为省成本挂到
 * 本机免费模型，手动点的人是盯着插槽等出图的，不能跟着排进本机 GPU 长队。
 * gpuPriority 同理 —— 手动点的图在 GPU 队列里排高位。
 */
export function triggerRestageDerivatives(fid, ratios = ['9:16', '3:4'], model = 'seedream5flash') {
  const list = Array.isArray(ratios) && ratios.length ? ratios : ['9:16', '3:4'];
  return postJson(`/api/viewer/assets/${encodeURIComponent(fid)}/restage`, {
    ratios: list,
    model,
    gpuPriority: 'high',
    forceMember: true,
  });
}

/**
 * 获取指定衍生版本的图片 URL
 */
export function getDerivativeImageUrl(fid, derivativeId, mediaToken = '') {
  if (!fid) return '';
  const token = getToken();
  const q = new URLSearchParams();
  if (derivativeId) q.set('derivative', String(derivativeId));
  if (token) q.set('token', token);
  if (mediaToken) q.set('media_token', mediaToken);
  const qs = q.toString();
  return resolveApiUrl(`/api/viewer/assets/${encodeURIComponent(fid)}/image${qs ? `?${qs}` : ''}`);
}

/**
 * 获取指定衍生版本的原图下载 URL
 */
export function getDerivativeDownloadUrl(fid, derivativeId, kind = 'derivative') {
  if (!fid) return '';
  const token = getToken();
  const safeFid = String(fid).replace(/[^A-Za-z0-9_-]/g, '');
  const safeKind = String(kind || 'derivative').replace(/[^A-Za-z0-9_-]/g, '');
  const saveName = `ML_SAVED_${safeFid}_${safeKind}.jpg`;
  const q = new URLSearchParams();
  if (derivativeId) q.set('derivative', String(derivativeId));
  q.set('dl', '1');
  q.set('download', '1');
  if (token) q.set('token', token);
  return resolveApiUrl(`/api/viewer/assets/${encodeURIComponent(fid)}/image/${encodeURIComponent(saveName)}?${q.toString()}`);
}

/**
 * 获取侧边时间轴精准天数统计列表
 */
export async function fetchTimelineDays(params = {}) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') {
      q.set(k, String(v));
    }
  }
  const res = await authFetch(`/api/viewer/assets/timeline-days?${q.toString()}`);
  if (!res.ok) return [];
  const json = await res.json();
  return json.data || [];
}

/**
 * 即梦智能扩图服务 (支持比例扩展与画布+mask扩展)
 */
export async function expandJimeng(params) {
  const res = await authFetch('/api/ai/expand-jimeng', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params)
  });
  const json = await res.json();
  if (!json.success && !json.url && !json.image_url && !json.b64_json && !json.data?.url) {
    throw new Error(json.error || '即梦扩图失败');
  }
  return json.data || json;
}

/**
 * 统一精准编辑与全局重绘管线 (/edit/run)
 * 支持 style_transfer, clarity, remove, replace, insert, add, space, expand
 */
export async function runEditPipeline(params) {
  const res = await authFetch('/api/edit/run', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params)
  });
  const json = await res.json();
  if (!json.success && !json.data?.image) {
    throw new Error(json.error || 'AI 图像编辑执行失败');
  }
  return json.data || json;
}

/**
 * 自定义风格库（风格迁移）
 */
export async function fetchCustomStyles() {
  const res = await authFetch('/api/custom-styles');
  const json = await res.json();
  if (!res.ok || json.success === false) throw new Error(json.error || '自定义风格读取失败');
  return json.data || [];
}

export async function createCustomStyle(params) {
  const res = await authFetch('/api/custom-styles', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params)
  });
  const json = await res.json();
  if (!res.ok || json.success === false) throw new Error(json.error || '自定义风格保存失败');
  return json.data;
}

export async function updateCustomStyle(id, params) {
  const res = await authFetch(`/api/custom-styles/${encodeURIComponent(id)}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params)
  });
  const json = await res.json();
  if (!res.ok || json.success === false) throw new Error(json.error || '自定义风格更新失败');
  return json.data;
}

export async function deleteCustomStyle(id) {
  const res = await authFetch(`/api/custom-styles/${encodeURIComponent(id)}`, { method: 'DELETE' });
  const json = await res.json();
  if (!res.ok || json.success === false) throw new Error(json.error || '自定义风格删除失败');
  return json.data;
}

/**
 * 用一次 LLM 把自定义风格解析成生图模型更容易吃透的「风格锚定描述」
 */
export async function analyzeStyle(params) {
  const res = await authFetch('/api/ai/style/analyze', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params)
  });
  const json = await res.json();
  if (!res.ok || json.success === false) throw new Error(json.error || 'AI 风格解析失败');
  return json.data || {};
}

/**
 * 真实 AI 实例分割/目标检测 (/ai/detect)
 * @param {{image:string, conf?:number, iou?:number}} params
 */
export async function aiDetect(params) {
  const res = await authFetch('/api/ai/detect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params)
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) throw new Error(json.error || 'AI 自动识别失败');
  return json.data || json;
}

/**
 * 真实 AI 生图接口 (/gen/images)
 */
export async function fetchStudioCatalog() {
  const res = await authFetch('/api/studio/catalog');
  const json = await res.json();
  if (!res.ok || json.error) throw new Error(json.error || '模型参数表读取失败');
  return json.data || json;
}

export async function generateAiImage(params) {
  const res = await authFetch('/api/gen/images', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params)
  });
  const json = await res.json();
  if (!res.ok || json.error) {
    throw new Error(json.error || `生图请求失败: HTTP ${res.status}`);
  }
  return json.data || json;
}

/**
 * 真实 AI 视频生成接口 (/gen/videos)
 */
export async function generateAiAudio(params) {
  const res = await authFetch('/api/gen/audio', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params)
  });
  const json = await res.json();
  if (!res.ok || json.error) {
    throw new Error(json.error || `音频生成请求失败: HTTP ${res.status}`);
  }
  return json.data || json;
}

export async function generateAiVideo(params) {
  const res = await authFetch('/api/gen/videos', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params)
  });
  const json = await res.json();
  if (!res.ok || json.error) {
    throw new Error(json.error || `视频生成请求失败: HTTP ${res.status}`);
  }
  return json.data || json;
}

/**
 * 真实 AI 对话接口 (/gen/chat)
 */
export async function generateAiChat(params) {
  const res = await authFetch('/api/gen/chat', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params)
  });
  const json = await res.json();
  if (!res.ok || json.error) {
    throw new Error(json.error || `AI 对话请求失败: HTTP ${res.status}`);
  }
  return json.data || json;
}

/**
 * 获取聊天会话列表 (/chat/sessions)
 */
export async function fetchChatSessions() {
  const res = await authFetch('/api/chat/sessions');
  if (!res.ok) return [];
  const json = await res.json();
  return json.data || [];
}

/**
 * 获取会话中的消息历史 (/chat/messages?sessionId=...)
 */
export async function fetchChatMessages(sessionId) {
  if (!sessionId) return [];
  const res = await authFetch(`/api/chat/messages?sessionId=${encodeURIComponent(sessionId)}`);
  if (!res.ok) return [];
  const json = await res.json();
  return json.data || [];
}

/**
 * 新增/保存单条消息到服务端 (/chat/messages)
 */
export async function saveChatMessage(payload) {
  const res = await authFetch('/api/chat/messages', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return await res.json();
}

/**
 * 删除会话 (/chat/sessions/:id)
 */
export async function deleteChatSession(sessionId) {
  const res = await authFetch(`/api/chat/sessions/${encodeURIComponent(sessionId)}`, {
    method: 'DELETE'
  });
  return await res.json();
}

// ===== 相似处理工作台 (Similarity Workbench) =====
export async function fetchSimilarityWorkbench(params = {}) {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== null && v !== '') q.set(k, String(v));
  }
  const res = await authFetch(`/api/assets/similarity-workbench?${q.toString()}`);
  return res.json();
}

export async function resolveSimilarityCluster(payload) {
  const res = await authFetch('/api/assets/similarity-workbench/resolve', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  return res.json();
}

export async function cleanExactDuplicates() {
  const res = await authFetch('/api/assets/similarity-workbench/clean-exact', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  });
  return res.json();
}

export async function fetchSimilarityIgnored() {
  const res = await authFetch('/api/assets/similarity-workbench/ignored');
  return res.json();
}

export async function deleteSimilarityIgnored(fidA, fidB) {
  const res = await authFetch('/api/assets/similarity-workbench/ignored', {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ fidA, fidB })
  });
  return res.json();
}

// ===== 系统设置（管理员）=====
/**
 * 读取运行时参数 (GET /api/settings/runtime-config，仅 admin)
 * 返回 kv runtime_config 覆盖同名环境变量后的生效值。
 */
export async function getRuntimeConfig() {
  const res = await authFetch('/api/settings/runtime-config');
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) {
    throw new Error(json.error || `读取运行参数失败: HTTP ${res.status}`);
  }
  return json.data || {};
}

/**
 * 保存运行时参数 (PUT /api/settings/runtime-config，仅 admin)
 * 只提交白名单字段，敏感项由服务端 .env 单向管理。
 */
export async function saveRuntimeConfig(body) {
  const res = await authFetch('/api/settings/runtime-config', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body || {}),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) {
    throw new Error(json.error || `保存运行参数失败: HTTP ${res.status}`);
  }
  return json.data || {};
}

/**
 * 管理员修改指定用户密码 (POST /api/users/password，仅超级管理员 admin)
 */
export async function changeUserPassword(username, password) {
  const res = await authFetch('/api/users/password', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) {
    throw new Error(json.error || `修改密码失败: HTTP ${res.status}`);
  }
  return json;
}

/**
 * 读取灰度更新状态 (GET /api/app/update/state)
 * 返回 { latest, canary, grayscale, channels }，白名单挂在 grayscale.targetDevices。
 */
export async function fetchAppUpdateState() {
  const res = await authFetch('/api/app/update/state');
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) {
    throw new Error(json.error || `读取灰度状态失败: HTTP ${res.status}`);
  }
  return json.data || {};
}

/**
 * 读取密钥脱敏状态 (GET /api/providers/env-secrets，仅 admin)
 * 服务端只返回掩码、末 4 位与指纹，绝不回显明文。
 */
export async function fetchEnvSecrets() {
  const res = await authFetch('/api/providers/env-secrets');
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) {
    throw new Error(json.error || `读取密钥状态失败: HTTP ${res.status}`);
  }
  return json.data || {};
}

/**
 * 写入密钥到 .env 并热更新 process.env (POST /api/providers/env-secrets，仅 admin)
 * @param {Record<string,string>} updates 例如 { ARK_API_KEY: 'xxx' }
 */
export async function saveEnvSecrets(updates) {
  const res = await authFetch('/api/providers/env-secrets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ updates: updates || {} }),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || json.success === false) {
    throw new Error(json.error || `更新密钥失败: HTTP ${res.status}`);
  }
  return json.data || {};
}

// ===== 服务端三级回退（转发自 server-resolve.js，组件统一从 api.js 引入）=====
export { resolveApiUrl };
export {
  ensureServerBase,
  currentBase,
  currentLabel as serverLabel,
  isAllDown,
  listCandidates,
  listCandidateUrls,
  setManualServer,
  getManualServer,
  onStatusChange as onServerStatusChange,
} from './server-resolve.js';



