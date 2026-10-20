/**
 * 统一网络通信层与免密/静默登录鉴权
 * 支持自动认证、401 自动续期重试、媒体 URL Token 自动注入
 */

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
 * 不再内置账号口令。没有本地会话时，调用方需要走登录接口。
 */
export async function autoLogin() {
  throw new Error('没有已保存的登录会话');
}

/**
 * 确保具备有效 Token，如果本地无 Token 则自动发起登录
 */
export async function ensureToken() {
  let token = getToken();
  if (token) return token;
  token = await autoLogin();
  return token;
}

/**
 * 携带鉴权头的通用 fetch，401 触发自动续约并重试 1 次
 */
export async function authFetch(url, options = {}, isRetry = false) {
  let token = getToken();
  if (!token) {
    token = await autoLogin();
  }

  const headers = new Headers(options.headers || {});
  if (!headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const res = await fetch(url, { ...options, headers });

  if (res.status === 401 && !isRetry) {
    console.warn('会话凭据已过期，重新静默登录并重试请求...');
    setSession('', null);
    await autoLogin();
    return authFetch(url, options, true);
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
  return `/api/viewer/assets/${encodeURIComponent(fid)}/image${qs ? `?${qs}` : ''}`;
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
  return `/api/viewer/assets/${encodeURIComponent(fid)}/poster${qs ? `?${qs}` : ''}`;
}

/**
 * 获取素材原文件下载 URL
 */
export function getAssetDownloadUrl(fid) {
  if (!fid) return '';
  const token = getToken();
  return `/api/viewer/assets/${encodeURIComponent(fid)}/file?token=${encodeURIComponent(token)}`;
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
  const res = await authFetch('/api/viewer/assets/trash/restore', {
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
  const res = await authFetch('/api/viewer/assets/trash/purge', {
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
  const res = await authFetch(`/api/viewer/assets/${encodeURIComponent(fid)}/delete`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ reason })
  });
  return res.json();
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
  return `/api/viewer/assets/${encodeURIComponent(fid)}/image${qs ? `?${qs}` : ''}`;
}

/**
 * 获取指定衍生版本的原图下载 URL
 */
export function getDerivativeDownloadUrl(fid, derivativeId) {
  if (!fid) return '';
  const token = getToken();
  const q = new URLSearchParams();
  if (derivativeId) q.set('derivative', String(derivativeId));
  q.set('dl', '1');
  if (token) q.set('token', token);
  return `/api/viewer/assets/${encodeURIComponent(fid)}/image?${q.toString()}`;
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



