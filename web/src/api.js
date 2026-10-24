// 前端 API 客户端 (统一支持独立站 :30001 与 DSH Webview /plugins/material)
const isDshWebview = typeof window !== 'undefined' && window.location.pathname.startsWith('/plugins/material');
export const API_BASE = isDshWebview ? '/plugins/material/api' : '/api';

export function getToken() {
  return localStorage.getItem('ml_token') || '';
}

export function setToken(token) {
  if (token) localStorage.setItem('ml_token', token);
  else localStorage.removeItem('ml_token');
}

export function getCurrentUser() {
  try { return JSON.parse(localStorage.getItem('ml_user') || 'null'); }
  catch { return null; }
}

export function setCurrentUser(user) {
  if (user) localStorage.setItem('ml_user', JSON.stringify(user));
  else localStorage.removeItem('ml_user');
}

async function request(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  const token = getToken();
  if (token) headers['Authorization'] = `Bearer ${token}`;
  if (opts.body && typeof opts.body === 'object' && !(opts.body instanceof FormData)) {
    headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(opts.body);
  }

  const res = await fetch(`${API_BASE}${path}`, { ...opts, headers });
  if (res.status === 401) {
    setToken(null);
    setCurrentUser(null);
    window.dispatchEvent(new CustomEvent('ml_auth_required'));
  }

  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(json.error || `HTTP ${res.status}`);
  }
  return json.data !== undefined ? json.data : json;
}

function scrubSensitiveText(text) {
  return String(text || '')
    .replace(/sk-[A-Za-z0-9_\-]+/gi, 'sk-***')
    .replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, 'Bearer ***')
    .replace(/"(api_?key|secret_?key|password|token|master_?key)"\s*:\s*"[^"]*"/gi, '"$1":"***"')
    .replace(/(api_?key|secret_?key|password|token|master_?key)\s*=\s*[^\s&]+/gi, '$1=***');
}

export const api = {
  // Auth
  login: (username, password) => request('/auth/login', { method: 'POST', body: { username, password } }),
  logout: () => request('/auth/logout', { method: 'POST' }),
  me: () => request('/auth/me'),
  quarkStatus: () => request('/auth/quark-status'),
  quarkLogin: (code) => request('/auth/quark-login', { method: 'POST', body: { code } }),
  quarkInstall: (url, code) => request('/auth/quark-install', { method: 'POST', body: { url, code } }),

  // Assets
  assets: (params = {}) => {
    const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v !== undefined && v !== null && v !== '')).toString();
    return request(`/assets${q ? '?' + q : ''}`);
  },
  assetDetail: (fid) => request(`/assets/${encodeURIComponent(fid)}`),
  portraitCatalog: () => request('/portrait-library/catalog'),
  assetSimilar: (fid, limit = 8) => request(`/assets/${encodeURIComponent(fid)}/similar?limit=${limit}`),
  applyTag: (fid, dimension, dir) => request(`/assets/${encodeURIComponent(fid)}/tags`, { method: 'POST', body: { dimension, dir } }),
  triggerRestage: (fid, body = {}) => request(`/assets/${encodeURIComponent(fid)}/restage`, { method: 'POST', body }),
  setMainDerivative: (fid, derivativeId) => request(`/assets/${encodeURIComponent(fid)}/main-derivative`, { method: 'POST', body: { derivativeId } }),
  ingest: (formData) => request('/assets/ingest', { method: 'POST', body: formData }),
  pullBaResources: (body) => request('/ba-resource/pull', { method: 'POST', body }),
  backupSettings: () => request('/settings/backup'),
  saveBackupSettings: (body) => request('/settings/backup', { method: 'POST', body }),
  // 快照直收：App（素材库）直接推快照到本服务；此处仅剩设备状态查询
  snapshotStatus: () => request('/snapshot-status'),
  ungroupAsset: (groupId, fid) => request(`/dup-groups/${encodeURIComponent(groupId)}/ungroup`, { method: 'POST', body: { fid } }),
  recluster: () => request('/dup-groups/recluster', { method: 'POST' }),
  runAssetLineage: (runId, fid) => request(`/runs/${encodeURIComponent(runId)}/assets/${encodeURIComponent(fid)}`),
  workflowCatalog: () => request('/workflows/catalog'),
  imageUrl: (fid, derivativeId = null, dl = false, play = false) => {
    const params = new URLSearchParams();
    if (derivativeId) params.set('derivative', derivativeId);
    if (dl) params.set('dl', '1');
    if (play) params.set('play', '1');
    if (derivativeId) params.set('v', 'd1');
    const token = getToken();
    if (token) params.set('token', token);
    const qs = params.toString();
    return `${API_BASE}/assets/${encodeURIComponent(fid)}/image${qs ? '?' + qs : ''}`;
  },
  videoPosterUrl: (fid) => {
    const token = getToken();
    return `${API_BASE}/assets/${encodeURIComponent(fid)}/poster${token ? '?token=' + encodeURIComponent(token) : ''}`;
  },
  downloadAsset: async (fid, derivativeId = null) => {
    const params = new URLSearchParams();
    if (derivativeId) params.set('derivative', derivativeId);
    params.set('dl', '1');
    const token = getToken();
    if (token) params.set('token', token);
    const url = `${API_BASE}/assets/${encodeURIComponent(fid)}/image?${params.toString()}`;
    const res = await fetch(url, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
    const ct = res.headers.get('content-type') || '';
    if (!res.ok || ct.includes('application/json')) {
      const json = await res.json().catch(() => ({}));
      throw new Error(json.error || `下载失败 HTTP ${res.status}`);
    }
    const blob = await res.blob();
    let name = 'image.jpg';
    const cd = res.headers.get('content-disposition') || '';
    const m = cd.match(/filename\*=UTF-8''([^;]+)|filename="?([^";]+)"?/i);
    if (m) name = decodeURIComponent(m[1] || m[2]);
    const href = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = href;
    a.download = name;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(href), 1500);
  },

  // Stats & Scan
  stats: () => request('/stats'),
  scan: () => request('/scan', { method: 'POST' }),

  // Workflows
  defaultWorkflow: () => request('/workflows/default'),
  workflow: (id = 'default') => request(`/workflows/${encodeURIComponent(id)}`),
  saveWorkflow: (graph, id = 'default') => request('/workflows', { method: 'POST', body: { id, graph } }),
  saveWorkflowVideo: (graph) => request('/workflows/video', { method: 'PUT', body: { graph } }),
  startVideoWorkflow: () => request('/workflows/video/start', { method: 'POST' }),
  videoAssets: (page = 1, pageSize = 24) => request(`/workflows/video/assets?page=${page}&pageSize=${pageSize}`),

  // 运行参数治理
  runtimeConfig: () => request('/settings/runtime-config'),
  saveRuntimeConfig: (cfg) => request('/settings/runtime-config', { method: 'PUT', body: cfg }),

  // Runs & Exceptions
  runs: () => request('/runs'),
  runDetail: (id, page = 1, pageSize = 20) => request(`/runs/${encodeURIComponent(id)}?page=${page}&pageSize=${pageSize}`),
  triggerRun: (payload = {}) => request('/runs', { method: 'POST', body: payload }),
  exceptions: () => request('/exceptions'),
  // 治理台要用过滤统计（僵尸/已恢复/确定性各多少），request() 会剥掉 meta，所以单独走 raw
  exceptionsFull: async (scope = 'actionable') => {
    const headers = {};
    const token = getToken();
    if (token) headers['Authorization'] = `Bearer ${token}`;
    const res = await fetch(`${API_BASE}/exceptions?scope=${encodeURIComponent(scope)}`, { headers });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
    return json;
  },
  retryNodeRun: (nodeRunId) => request(`/exceptions/${nodeRunId}/retry`, { method: 'POST' }),

  // Adapters (兼容保留)
  adapters: async () => {
    const token = getToken();
    const res = await fetch(`${API_BASE}/adapters`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {}
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(json.error || `HTTP ${res.status}`);
    const list = Array.isArray(json.data) ? json.data : [];
    list.manifests = Array.isArray(json.manifests) ? json.manifests : [];
    return list;
  },
  saveAdapter: (adapter) => request('/adapters', { method: 'POST', body: adapter }),
  deleteAdapter: (id) => request(`/adapters/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  toggleAdapter: (id, enabled) => request(`/adapters/${encodeURIComponent(id)}/toggle`, { method: 'POST', body: { enabled } }),
  testAdapter: (payload) => request('/adapters/test', { method: 'POST', body: payload }),

  // 供应商与大模型 (Providers & Models)
  providers: () => request('/providers'),
  envSecrets: () => request('/providers/env-secrets'),
  saveEnvSecrets: (updates) => request('/providers/env-secrets', { method: 'POST', body: { updates } }),
  saveProvider: (p) => request('/providers', { method: 'POST', body: p }),
  deleteProvider: (id) => request(`/providers/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  toggleProvider: (id, enabled) => request(`/providers/${encodeURIComponent(id)}/toggle`, { method: 'POST', body: { enabled } }),

  models: (params = {}) => {
    const q = new URLSearchParams(params).toString();
    return request(`/models${q ? '?' + q : ''}`);
  },
  saveModel: (m) => request('/models', { method: 'POST', body: m }),
  deleteModel: (id) => request(`/models/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  toggleModel: (id, enabled) => request(`/models/${encodeURIComponent(id)}/toggle`, { method: 'POST', body: { enabled } }),
  testModel: (id, payload) => request(`/models/${encodeURIComponent(id)}/test`, { method: 'POST', body: payload }),
  syncLiteLLM: () => request('/models/sync-litellm', { method: 'POST' }),
  toggleLiteLLMBatch: (enabled) => request('/providers/litellm/toggle-batch', { method: 'POST', body: { enabled } }),
  retryAllFailed: () => request('/runs/retry-all-failed', { method: 'POST' }),
  runGraph: (id, fid = null, page = 1, pageSize = 24) => {
    const params = new URLSearchParams();
    if (fid) params.set('fid', fid);
    if (page) params.set('page', String(page));
    if (pageSize) params.set('pageSize', String(pageSize));
    const q = params.toString() ? `?${params.toString()}` : '';
    return request(`/runs/${encodeURIComponent(id)}/graph${q}`);
  },
  restageBackfill: (limit = 2000) => request('/runs/restage-backfill', { method: 'POST', body: { limit } }),
  vectorStatus: () => request('/vectors/status'),
  recomputeVectors: () => request('/vectors/recompute', { method: 'POST' }),

  // Groups
  setRepresentative: (groupId, fid) => request(`/dup-groups/${encodeURIComponent(groupId)}/representative`, { method: 'POST', body: { fid } }),

  // Dict & Users
  dict: (includeDeprecated = true) => request(`/dict?include_deprecated=${includeDeprecated ? '1' : '0'}`),
  saveTag: (tag) => request('/dict', { method: 'POST', body: tag }),
  deprecateTag: (body) => request('/dict/deprecate', { method: 'POST', body }),
  restoreTag: (body) => request('/dict/restore', { method: 'POST', body }),
  draftCriteria: (body) => request('/dict/draft-criteria', { method: 'POST', body }),
  estimateRetag: (dimensions) => request('/dict/retag/estimate', { method: 'POST', body: { dimensions } }),
  triggerRetag: (body) => request('/dict/retag', { method: 'POST', body }),
  retagJobs: () => request('/dict/retag/jobs'),
  dictAudit: (dimension) => request(`/dict/audit${dimension ? '?dimension=' + encodeURIComponent(dimension) : ''}`),
  dictAuditAssets: (id) => request(`/dict/audit/${id}/assets`),
  assetTagHistory: (fid) => request(`/assets/${encodeURIComponent(fid)}/tag-history`),
  users: () => request('/users'),
  createUser: (user) => request('/users', { method: 'POST', body: user }),
  changeUserPassword: (id, password) => request(`/users/${encodeURIComponent(id)}/password`, { method: 'POST', body: { password } }),
  deleteUser: (id) => request(`/users/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  updateUser: (id, data) => request(`/users/${encodeURIComponent(id)}`, { method: 'PUT', body: data }),

  // AI 试验场
  labCapabilities: () => request('/lab/capabilities'),
  labSubmit: (body) => request('/lab/runs', { method: 'POST', body }),
  labRunStatus: (engine, runId) =>
    request(`/lab/runs/${encodeURIComponent(engine)}/${encodeURIComponent(runId)}`),
  processJob: (id) => request(`/process/jobs/${encodeURIComponent(id)}`),

  genModels: () => request('/governance/gen-models'),
  litellmGroup: async (model) => {
    try {
      return await request(`/governance/litellm-groups?model=${encodeURIComponent(model)}`);
    } catch (e) {
      throw new Error(scrubSensitiveText(e.message));
    }
  },
  addLitellmMember: async (model, upstream) => {
    try {
      return await request(`/governance/litellm-groups/${encodeURIComponent(model)}/members`, { method: 'POST', body: { upstream } });
    } catch (e) {
      throw new Error(scrubSensitiveText(e.message));
    }
  },
  removeLitellmMember: async (model, id) => {
    try {
      return await request(`/governance/litellm-groups/${encodeURIComponent(model)}/members/${encodeURIComponent(id)}`, { method: 'DELETE' });
    } catch (e) {
      throw new Error(scrubSensitiveText(e.message));
    }
  },
  createGenModel: (body) => request('/governance/gen-models', { method: 'POST', body }),
  previewModelConvert: (body) => request('/governance/gen-models/preview-convert', { method: 'POST', body }),
  saveGenModelSchema: (id, body) => request(`/governance/gen-models/${encodeURIComponent(id)}/schema`, { method: 'PUT', body }),
  deleteGenModel: (id) => request(`/governance/gen-models/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  saveGenPolish: (id, body) => request(`/governance/gen-models/${encodeURIComponent(id)}/polish`, { method: 'PUT', body }),
  genJobs: () => request('/governance/gen-jobs'),
  saveGenJob: (id, body) => request(`/governance/gen-jobs/${encodeURIComponent(id)}`, { method: 'PUT', body }),
  resetGenJob: (id) => request(`/governance/gen-jobs/${encodeURIComponent(id)}/reset`, { method: 'POST' }),
  manualDefaults: () => request('/governance/manual-defaults'),
  saveManualDefaults: (body) => request('/governance/manual-defaults', { method: 'PUT', body }),

  // AI 模型与工作流治理
  envKeys: () => request('/providers/env-keys'),
  workflows: () => request('/governance/workflows'),
  saveWorkflows: (body) => request('/governance/workflows', { method: 'PUT', body }),
  unpackRun: (runId) => request(`/runs/${encodeURIComponent(runId)}/unpack`),
  rerunGen: (runId, body) => request(`/runs/${encodeURIComponent(runId)}/rerun-gen`, { method: 'POST', body }),
  draftSkillFromDocs: (body) => request('/governance/draft-from-doc', { method: 'POST', body }),
  skillDrafts: () => request('/governance/skill-drafts'),
  createSkillDraft: (body) => request('/governance/skill-drafts', { method: 'POST', body }),
  updateSkillDraft: (id, body) => request(`/governance/skill-drafts/${encodeURIComponent(id)}`, { method: 'PUT', body }),
  deleteSkillDraft: (id) => request(`/governance/skill-drafts/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  acceptSkillDraft: (id) => request(`/governance/skill-drafts/${encodeURIComponent(id)}/accept`, { method: 'POST' }),
  toggleGenModel: (id, enabled) => request(`/governance/gen-models/${encodeURIComponent(id)}/toggle`, { method: 'POST', body: { enabled } }),
  optimizePrompt: (body) => request('/chat/optimize-prompt', { method: 'POST', body }),

  // 算子目录、词典宏芯片、公共积木、编译预览与单节点沙盒实测
  operatorsCatalog: () => request('/governance/operators'),
  dictMacros: () => request('/governance/dict-macros'),
  promptSnippets: () => request('/governance/snippets'),
  savePromptSnippet: (body) => request('/governance/snippets', { method: 'POST', body }),
  deletePromptSnippet: (id) => request(`/governance/snippets/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  restorePromptSnippet: (id) => request(`/governance/snippets/${encodeURIComponent(id)}/restore`, { method: 'POST' }),
  previewCompilePrompt: (body) => request('/governance/prompts/preview-compile', { method: 'POST', body }),
  runNodeSandbox: (body) => request('/governance/sandbox/run-node', { method: 'POST', body }),

  // 提示词中心
  promptTemplates: () => request('/governance/prompts'),
  savePromptTemplate: (body) => request('/governance/prompts', { method: 'POST', body }),
  deletePromptTemplate: (id) => request(`/governance/prompts/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  restorePromptTemplate: (id) => request(`/governance/prompts/${encodeURIComponent(id)}/restore`, { method: 'POST' }),

  // 模块化工作流与挂载点
  mountPoints: () => request('/governance/mount-points'),
  saveMountPoint: (body) => request('/governance/mount-points', { method: 'POST', body }),
  deleteMountPoint: (id) => request(`/governance/mount-points/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  mountModules: (mountPointId) => request(`/governance/mount-points/${encodeURIComponent(mountPointId)}/modules`),
  saveMountModule: (mountPointId, body) => request(`/governance/mount-points/${encodeURIComponent(mountPointId)}/modules`, { method: 'POST', body }),
  deleteMountModule: (mountPointId, moduleId) => request(`/governance/mount-points/${encodeURIComponent(mountPointId)}/modules/${encodeURIComponent(moduleId)}`, { method: 'DELETE' }),
  reorderMountModules: (mountPointId, orderedIds) => request(`/governance/mount-points/${encodeURIComponent(mountPointId)}/reorder`, { method: 'POST', body: { orderedIds } }),
  executeMountPoint: (mountPointId, body) => request(`/governance/mount-points/${encodeURIComponent(mountPointId)}/execute`, { method: 'POST', body }),

  // 供应商与接入点
  saveProvider: (body) => request('/providers', { method: 'POST', body }),
  deleteProvider: (id) => request(`/providers/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  toggleProvider: (id, enabled) => request(`/providers/${encodeURIComponent(id)}/toggle`, { method: 'POST', body: { enabled } }),
  toggleEndpoint: (id, enabled) => request(`/providers/${encodeURIComponent(id)}/toggle`, { method: 'POST', body: { enabled } }),
};
