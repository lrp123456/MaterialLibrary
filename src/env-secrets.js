/**
 * 全局唯一密钥中心 (.env Single Authority Secret Store)
 *
 * 设计铁律：
 * 1. 所有上游厂商与本地网关的 API Key / AK / SK / Token 统一存储在项目根目录 `.env`（及内存 `process.env`）。
 * 2. 严禁从 SQLite 表或 JSON 配置文件中读取明文密钥，消除多源密钥冲突。
 * 3. 对管理端提供安全的脱敏状态探针（SHA-256 指纹 + 就绪状态）与热更新写入能力（修改即刻同步 `process.env`，无需重启）。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawnSync } = require('child_process');

const PROJECT_ENV = path.join(__dirname, '..', '.env');

const PROVIDER_ENV_VARS = {
  volcengine: ['ARK_API_KEY', 'ARK_API_KEYS'],
  agnes: ['AGNES_API_KEY', 'AGNES_API_KEYS'],
  agnes_intl: ['AGNES_INTL_API_KEY', 'AGNES_INTL_API_KEYS'],
  gemini: ['GEMINI_API_KEY', 'GEMINI_API_KEYS'],
  groq: ['GROQ_API_KEY', 'GROQ_API_KEYS'],
  litellm: ['LITELLM_API_KEY', 'LITELLM_API_KEYS'],
  kilo: ['KILO_API_KEY', 'KILO_API_KEYS'],
  modelscope: ['MODELSCOPE_API_KEY', 'MODELSCOPE_API_KEYS'],
  newapi: ['NEWAPI_API_KEY', 'NEWAPI_API_KEYS'],
  local: ['UMBRA_TOKEN', 'CREATION_PUBLIC_TOKEN'],
};

const STANDARD_ENV_KEY_SPECS = [
  { key: 'ARK_API_KEY', label: '火山方舟主密钥 (Bearer)', provider_id: 'volcengine', endpoint_id: 'volc_ark', kind: 'bearer', description: '用于 Seedream 5.0/4.5 生图、Seedance 2.5/2.0 生视频、Doubao Seed 2.1 对话与 Files API' },
  { key: 'ARK_API_KEYS', label: '火山方舟轮换密钥池 (逗号分隔)', provider_id: 'volcengine', endpoint_id: 'volc_ark', kind: 'bearer_pool', description: '多 Key 自动负载均衡与限流切换' },
  { key: 'AGNES_API_KEY', label: 'Agnes AI 国内站主密钥', provider_id: 'agnes', endpoint_id: 'agnes', kind: 'bearer', description: '用于 agnes-image-2.5-flash、agnes-video-2.5-flash、agnes-3.0-flash' },
  { key: 'AGNES_API_KEYS', label: 'Agnes AI 国内站轮换密钥池', provider_id: 'agnes', endpoint_id: 'agnes', kind: 'bearer_pool', description: '支持多 Key 轮询防并发限流' },
  { key: 'AGNES_INTL_API_KEY', label: 'Agnes AI 国际站密钥', provider_id: 'agnes', endpoint_id: 'agnes_intl', kind: 'bearer', description: '用于 apihub.agnes-ai.com 国际站接入点' },
  { key: 'VOLC_MUSIC_AK', label: '豆包音乐 AccessKey (AK)', provider_id: 'volcengine', endpoint_id: 'doubao_music', kind: 'ak', description: '火山引擎 imagination 服务专用 AK（与人像库隔离）' },
  { key: 'VOLC_MUSIC_SK', label: '豆包音乐 SecretKey (SK)', provider_id: 'volcengine', endpoint_id: 'doubao_music', kind: 'sk', description: '火山引擎 imagination 服务专用 SK' },
  { key: 'VOLC_AK', label: '火山通用 AccessKey (AK)', provider_id: 'volcengine', endpoint_id: 'doubao_music', kind: 'ak', description: '火山引擎 OpenAPI 通用 AK' },
  { key: 'VOLC_SK', label: '火山通用 SecretKey (SK)', provider_id: 'volcengine', endpoint_id: 'doubao_music', kind: 'sk', description: '火山引擎 OpenAPI 通用 SK' },
  { key: 'PORTRAIT_AK', label: '虚拟人像库专属 AK', provider_id: 'volcengine', endpoint_id: 'volc_portrait', kind: 'ak', description: '方舟虚拟人像 CreateAsset 专属 AK（严禁与音乐混用）' },
  { key: 'PORTRAIT_SK', label: '虚拟人像库专属 SK', provider_id: 'volcengine', endpoint_id: 'volc_portrait', kind: 'sk', description: '方舟虚拟人像 CreateAsset 专属 SK' },
  { key: 'ARK_PORTRAIT_AK', label: '虚拟人像库备用 AK', provider_id: 'volcengine', endpoint_id: 'volc_portrait', kind: 'ak', description: '方舟人像备用 AK' },
  { key: 'ARK_PORTRAIT_SK', label: '虚拟人像库备用 SK', provider_id: 'volcengine', endpoint_id: 'volc_portrait', kind: 'sk', description: '方舟人像备用 SK' },
  { key: 'LITELLM_API_KEY', label: '本地 LiteLLM 网关调用密钥', provider_id: 'litellm', endpoint_id: 'litellm', kind: 'bearer', description: '本地 :4000 统一文本/视觉网关鉴权 Key' },
  { key: 'LITELLM_MASTER_KEY', label: '本地 LiteLLM 管理主密钥', provider_id: 'litellm', endpoint_id: 'litellm', kind: 'bearer', description: '用于同步模型组与管理路由表' },
  { key: 'UMBRA_TOKEN', label: '本机 Umbra 算力服务 Token', provider_id: 'local', endpoint_id: 'local_host', kind: 'bearer', description: '用于本机扩图、消除、透视安装与漫游' },
  { key: 'CREATION_PUBLIC_TOKEN', label: '本机创作公共 Token', provider_id: 'local', endpoint_id: 'local_host', kind: 'bearer', description: 'Umbra 备用鉴权 Token' },
  { key: 'GEMINI_API_KEY', label: 'Google Gemini API Key', provider_id: 'gemini', endpoint_id: 'gemini', kind: 'bearer', description: 'Google AI Studio 密钥' },
  { key: 'GROQ_API_KEY', label: 'Groq 推理平台 API Key', provider_id: 'groq', endpoint_id: 'groq', kind: 'bearer', description: 'Groq 高速推理密钥' },
  { key: 'KILO_API_KEY', label: 'Kilo AI Gateway Key', provider_id: 'kilo', endpoint_id: 'kilo', kind: 'bearer', description: 'Kilo 网关密钥' },
  { key: 'MODELSCOPE_API_KEY', label: '魔搭社区 ModelScope Key', provider_id: 'modelscope', endpoint_id: 'modelscope', kind: 'bearer', description: 'ModelScope 推理密钥' },
  { key: 'NEWAPI_API_KEY', label: 'New API 聚合网关主密钥', provider_id: 'newapi', endpoint_id: 'newapi', kind: 'bearer', description: 'newapi.naite.cc 聚合网关，gemini-4-argon 等模型走这条通道' },
  { key: 'NEWAPI_API_KEYS', label: 'New API 轮换密钥池 (逗号分隔)', provider_id: 'newapi', endpoint_id: 'newapi', kind: 'bearer_pool', description: '多 Key 轮询，降低单 Key 限流概率' },
  { key: 'BA_RESOURCE_BASE', label: 'Ba 资源库地址', provider_id: 'ba', endpoint_id: 'ba_resource', kind: 'bearer', description: 'Ba 资源接口根地址，不含路径。例如 http://host:port' },
  { key: 'BA_RESOURCE_USER', label: 'Ba 资源库账号', provider_id: 'ba', endpoint_id: 'ba_resource', kind: 'bearer', description: '登录用户名。验证码开启时自动拉取会停止' },
  { key: 'BA_RESOURCE_PASSWORD', label: 'Ba 资源库密码', provider_id: 'ba', endpoint_id: 'ba_resource', kind: 'bearer', description: '登录密码，只写入 .env' },
];

function fingerprintKey(val) {
  const s = String(val || '').trim();
  if (!s) return '';
  return crypto.createHash('sha256').update(s).digest('hex').slice(0, 8);
}

function envNamesForProvider(providerId) {
  if (PROVIDER_ENV_VARS[providerId]) return PROVIDER_ENV_VARS[providerId];
  if (providerId && /^[a-z0-9_-]+$/i.test(providerId)) {
    const base = String(providerId).toUpperCase().replace(/[^A-Z0-9]/g, '_');
    return [`${base}_API_KEY`, `${base}_API_KEYS`];
  }
  return [];
}

function loadProjectEnv(envPath = PROJECT_ENV, { override = false } = {}) {
  try {
    if (!fs.existsSync(envPath)) return;
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      if (!override && process.env[m[1]] != null && process.env[m[1]] !== '') continue;
      let value = m[2];
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      process.env[m[1]] = value;
    }
  } catch (_) {}
}

function splitKeyList(raw) {
  return String(raw || '')
    .split(/[,;\n]/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function keysFromEnv(providerId) {
  const names = envNamesForProvider(providerId);
  if (!names.length) return [];
  const keys = [];
  for (const name of names) {
    for (const key of splitKeyList(process.env[name])) {
      if (!keys.includes(key)) keys.push(key);
    }
  }
  return keys;
}

function keysFromEnvVarNames(varNames = []) {
  const keys = [];
  for (const name of varNames) {
    if (!name || typeof name !== 'string') continue;
    for (const key of splitKeyList(process.env[name])) {
      if (!keys.includes(key)) keys.push(key);
    }
  }
  return keys;
}

function providerIdForEndpoint(endpointId) {
  if (endpointId === 'volc_ark') return 'volcengine';
  if (endpointId === 'agnes') return 'agnes';
  if (endpointId === 'agnes_intl') return 'agnes_intl';
  if (endpointId === 'local_host') return 'local';
  if (PROVIDER_ENV_VARS[endpointId]) return endpointId;
  return '';
}

function litellmMasterKey() {
  return String(process.env.LITELLM_MASTER_KEY || process.env.LITELLM_API_KEY || '').trim();
}

function formatEnvValue(value) {
  const s = String(value ?? '');
  if (/[\s#"'\\]/.test(s)) {
    return '"' + s.replace(/\\/g, '\\\\').replace(/"/g, '\\"') + '"';
  }
  return s;
}

function lockEnvFile(envPath) {
  try { fs.chmodSync(envPath, 0o600); } catch (_) {}
  if (!envPath.startsWith('/mnt/c/')) return;
  const win = 'C:' + envPath.slice('/mnt/c'.length).replace(/\//g, '\\');
  try {
    spawnSync('icacls.exe', [win, '/inheritance:r', '/grant:r', 'lrp:(R,W)'], { stdio: 'ignore' });
  } catch (_) {}
}

function setEnvAssignments(assignments, envPath = PROJECT_ENV) {
  const entries = Object.entries(assignments || {}).filter(([name, val]) => {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) return false;
    const s = String(val ?? '').trim();
    // 忽略掩码占位符，防止误把前端展示的 •••• 写进 .env
    if (s.includes('•') || s.startsWith('环境变量') || s === '***') return false;
    return true;
  });
  if (!entries.length) return false;
  let text = '';
  try {
    if (fs.existsSync(envPath)) text = fs.readFileSync(envPath, 'utf8');
  } catch (err) {
    throw new Error('无法读取 .env');
  }
  const pending = Object.fromEntries(entries);
  const lines = text.split(/\r?\n/);
  const out = lines.map((line) => {
    const m = line.match(/^(\s*)([A-Za-z_][A-Za-z0-9_]*)\s*=/);
    if (!m || !Object.prototype.hasOwnProperty.call(pending, m[2])) return line;
    const name = m[2];
    const value = pending[name];
    delete pending[name];
    return `${m[1]}${name}=${formatEnvValue(value)}`;
  });
  for (const [name, value] of Object.entries(pending)) {
    out.push(`${name}=${formatEnvValue(value)}`);
  }
  const body = out.join('\n').replace(/\n*$/, '\n');
  fs.mkdirSync(path.dirname(envPath), { recursive: true });
  fs.writeFileSync(envPath, body, { mode: 0o600 });
  for (const [name, value] of entries) {
    process.env[name] = String(value ?? '');
  }
  lockEnvFile(envPath);
  return true;
}

function writeProviderKeys(providerId, keys, extra = {}) {
  const names = envNamesForProvider(providerId);
  if (!names.length) return false;
  const unique = [];
  for (const key of keys || []) {
    const s = String(key || '').trim();
    if (!s || s.includes('•') || s.startsWith('环境变量')) continue;
    if (!unique.includes(s)) unique.push(s);
  }
  const assignments = {};
  if (unique.length) assignments[names[0]] = unique[0];
  if (unique.length > 1 && names[1]) assignments[names[1]] = unique.slice(1).join(',');
  if (extra.masterKey) {
    const master = String(extra.masterKey).trim();
    if (master && !master.includes('•') && !master.startsWith('环境变量')) {
      assignments.LITELLM_MASTER_KEY = master;
    }
  }
  if (!Object.keys(assignments).length) return false;
  return setEnvAssignments(assignments);
}

/**
 * 获取全量 .env 密钥池状态探针（绝不返回明文，只返回存在状态、密钥个数与 SHA-256 指纹）
 */
function getEnvSecretsStatus() {
  const knownSet = new Set(STANDARD_ENV_KEY_SPECS.map((s) => s.key));
  const extraSpecs = [];
  for (const k of Object.keys(process.env || {})) {
    if (knownSet.has(k)) continue;
    if (k.endsWith('_KEY') || k.endsWith('_KEYS') || k.endsWith('_TOKEN') || k.endsWith('_AK') || k.endsWith('_SK')) {
      extraSpecs.push({
        key: k,
        label: `自定义密钥 (${k})`,
        provider_id: 'custom',
        endpoint_id: 'custom',
        kind: k.endsWith('_KEYS') ? 'bearer_pool' : 'bearer',
        description: '从当前进程环境变量发现的密钥项',
      });
    }
  }

  return [...STANDARD_ENV_KEY_SPECS, ...extraSpecs].map((spec) => {
    const raw = String(process.env[spec.key] || '').trim();
    const list = splitKeyList(raw);
    const hasValue = list.length > 0;
    return {
      ...spec,
      has_value: hasValue,
      count: list.length,
      fingerprints: list.map(fingerprintKey),
      fingerprint: list[0] ? fingerprintKey(list[0]) : '',
      maskedValue: hasValue ? '••••••••••••' : '',
    };
  });
}

module.exports = {
  PROJECT_ENV,
  PROVIDER_ENV_VARS,
  STANDARD_ENV_KEY_SPECS,
  fingerprintKey,
  envNamesForProvider,
  loadProjectEnv,
  splitKeyList,
  keysFromEnv,
  keysFromEnvVarNames,
  providerIdForEndpoint,
  litellmMasterKey,
  setEnvAssignments,
  writeProviderKeys,
  getEnvSecretsStatus,
};

function parseEnvContent(text = '') {
  const map = new Map();
  const lines = String(text || '').split(/\r?\n/);
  for (const line of lines) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let val = m[2];
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    map.set(m[1], val);
  }
  return { lines, map };
}

function inspectEnvKey(envName) {
  const raw = String(process.env[envName] || '').trim();
  const list = splitKeyList(raw);
  const hasValue = list.length > 0;
  const first = list[0] || '';
  return {
    env: envName,
    key: envName,
    has_value: hasValue,
    count: list.length,
    fingerprint: first ? fingerprintKey(first) : '',
    tail: first ? first.slice(-4) : '',
    masked: hasValue ? '••••••••' + first.slice(-4) : '',
    maskedValue: hasValue ? '••••••••••••' : '',
  };
}

function writeEnvUpdates(updates, envPath = PROJECT_ENV) {
  setEnvAssignments(updates, envPath);
  return Object.keys(updates || {}).map(k => inspectEnvKey(k));
}

module.exports.parseEnvContent = parseEnvContent;
module.exports.inspectEnvKey = inspectEnvKey;
module.exports.writeEnvUpdates = writeEnvUpdates;
module.exports.KNOWN_SECRET_ENV_SPECS = STANDARD_ENV_KEY_SPECS;
