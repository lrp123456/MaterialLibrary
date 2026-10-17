/**
 * 供应商钥匙只放在项目根目录的 .env。
 * 不读数据库，不读 providers-secrets.json，也不把钥匙写回那些地方。
 */
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

const PROJECT_ENV = path.join(__dirname, '..', '.env');

const PROVIDER_ENV_VARS = {
  volcengine: ['ARK_API_KEY', 'ARK_API_KEYS'],
  agnes: ['AGNES_API_KEY', 'AGNES_API_KEYS'],
  gemini: ['GEMINI_API_KEY', 'GEMINI_API_KEYS'],
  groq: ['GROQ_API_KEY', 'GROQ_API_KEYS'],
  litellm: ['LITELLM_API_KEY', 'LITELLM_API_KEYS'],
  kilo: ['KILO_API_KEY', 'KILO_API_KEYS'],
  modelscope: ['MODELSCOPE_API_KEY', 'MODELSCOPE_API_KEYS'],
};

function envNamesForProvider(providerId) {
  if (PROVIDER_ENV_VARS[providerId]) return PROVIDER_ENV_VARS[providerId];
  if (providerId && /^[a-z0-9_-]+$/i.test(providerId)) {
    const base = String(providerId).toUpperCase().replace(/[^A-Z0-9]/g, '_');
    return [`${base}_API_KEY`, `${base}_API_KEYS`];
  }
  return [];
}

function loadProjectEnv(envPath = PROJECT_ENV) {
  try {
    if (!fs.existsSync(envPath)) return;
    for (const line of fs.readFileSync(envPath, 'utf8').split(/\r?\n/)) {
      const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!m) continue;
      if (process.env[m[1]] != null && process.env[m[1]] !== '') continue;
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

function providerIdForEndpoint(endpointId) {
  if (endpointId === 'volc_ark') return 'volcengine';
  if (endpointId === 'agnes') return 'agnes';
  if (PROVIDER_ENV_VARS[endpointId]) return endpointId;
  return '';
}

function litellmMasterKey() {
  return String(process.env.LITELLM_MASTER_KEY || '').trim();
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
  const entries = Object.entries(assignments || {}).filter(([name]) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(name));
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
  for (const [name, value] of entries) process.env[name] = String(value ?? '');
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

module.exports = {
  PROJECT_ENV,
  PROVIDER_ENV_VARS,
  envNamesForProvider,
  loadProjectEnv,
  keysFromEnv,
  providerIdForEndpoint,
  litellmMasterKey,
  setEnvAssignments,
  writeProviderKeys,
};
