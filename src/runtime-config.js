/**
 * 运行时参数配置模块 (Runtime Config)
 * 优先从 SQLite kv 表中读取 runtime_config，盖过同名环境变量。
 * 不改写 .env，不重启服务，下次使用即生效。
 */
const path = require('path');
const os = require('os');

// 允许在控制台调整与展示的白名单参数定义
const CONFIG_SCHEMA = {
  // 1. 处理并发
  process_concurrency: { env: 'ML_PROCESS_CONCURRENCY', default: 3, type: 'number' },
  tag_concurrency: { env: 'ML_TAG_CONCURRENCY', default: 8, type: 'number' },
  restage_concurrency: { env: 'ML_RESTAGE_CONCURRENCY', default: 4, type: 'number' },

  // 2. 夜间重打标时刻
  retag_night_hour: { env: 'ML_RETAG_NIGHT_HOUR', default: 2, type: 'number' },
  retag_night_minute: { env: 'ML_RETAG_NIGHT_MINUTE', default: 0, type: 'number' },

  // 3. NAS 目录
  nas_dir: { env: 'ML_NAS_DIR', default: '/mnt/synology/material', type: 'string' },

  // 4. LiteLLM 地址和模型名
  litellm_base_url: { env: 'LITELLM_BASE_URL', default: 'http://127.0.0.1:4000', type: 'string' },
  litellm_model: { env: 'LITELLM_MODEL', default: 'doubao-seed-2-0-lite-260428', type: 'string' },

  // 5. 对外基址
  bff_public_base: { env: 'BFF_PUBLIC_BASE', default: '', type: 'string' },

  // 6. Umbra 地址
  umbra_base_url: { env: 'UMBRA_BASE_URL', default: 'http://127.0.0.1:3001', type: 'string' },

  // 7. YOLO 地址
  yolo_seg_url: { env: 'YOLO_SEG_URL', default: 'http://127.0.0.1:5001/detect', type: 'string' },

  // 8. 技能根目录
  skills_root: { env: 'SKILLS_ROOT', default: '', type: 'string' },

  // 9. HTTP 代理和 NO_PROXY
  http_proxy: { env: 'HTTP_PROXY', default: '', type: 'string' },
  https_proxy: { env: 'HTTPS_PROXY', default: '', type: 'string' },
  no_proxy: { env: 'NO_PROXY', default: '127.0.0.1,localhost,::1', type: 'string' },

  // 10. 漫游/点选模板 ID
  umbra_template_walkthrough: { env: 'TPL_WALKTHROUGH', kvKey: 'umbra_template_walkthrough', default: '', type: 'string' },
  umbra_template_touch: { env: 'TPL_TOUCH_EDITOR', kvKey: 'umbra_template_touch', default: '', type: 'string' },

  // 11. 端口 (修改后需重启生效)
  port: { env: 'ML_PORT', default: 30001, type: 'number' },

  // 12. 数据目录 (只读展示)
  data_dir: { env: 'ML_DATA_DIR', default: path.join(os.homedir(), '.dsh-material-library'), type: 'string', readonly: true }
};

// 严禁进表单且绝不返回的敏感黑名单字段
const SENSITIVE_BLACK_LIST = new Set([
  'litellm_api_key', 'LITELLM_API_KEY',
  'umbra_token', 'UMBRA_TOKEN',
  'creation_public_token', 'CREATION_PUBLIC_TOKEN',
  'modelscope_api_key', 'MODELSCOPE_API_KEY',
  'admin_pass', 'ML_ADMIN_PASS',
  'viewer_pass', 'ML_VIEWER_PASS',
  'media_secret', 'ML_MEDIA_SECRET',
  'quark_cli_path', 'QUARK_CLI_PATH',
  'quark_root_fid', 'QUARK_ROOT_FID',
  'quark_system_fid', 'QUARK_SYSTEM_FID',
  'api_key', 'token', 'secret'
]);

function getRawRuntimeKv(db) {
  try {
    const row = db.prepare("SELECT value FROM kv WHERE key='runtime_config'").get();
    if (row && row.value) {
      return JSON.parse(row.value);
    }
  } catch (_) {}
  return {};
}

/**
 * 获取当前生效的运行参数对象
 */
function getRuntimeConfig(db) {
  const kvStored = getRawRuntimeKv(db);
  const result = {};

  for (const [key, spec] of Object.entries(CONFIG_SCHEMA)) {
    // 优先取 kv 中配置，其次取对应环境变量，最后取默认值
    if (kvStored[key] !== undefined && kvStored[key] !== null && kvStored[key] !== '') {
      result[key] = spec.type === 'number' ? Number(kvStored[key]) : String(kvStored[key]);
    } else if (spec.kvKey) {
      // 兼容直接写在 kv 里的单独 key（如 umbra_template_walkthrough）
      const singleKv = db.prepare('SELECT value FROM kv WHERE key=?').get(spec.kvKey)?.value;
      if (singleKv) {
        result[key] = singleKv;
      } else if (process.env[spec.env]) {
        result[key] = process.env[spec.env];
      } else {
        result[key] = spec.default;
      }
    } else if (process.env[spec.env]) {
      result[key] = spec.type === 'number' ? Number(process.env[spec.env]) : process.env[spec.env];
    } else {
      result[key] = spec.default;
    }
  }

  // 严格确保敏感项不混入
  for (const k of Object.keys(result)) {
    if (SENSITIVE_BLACK_LIST.has(k.toLowerCase())) {
      delete result[k];
    }
  }

  return result;
}

/**
 * 获取单个有效配置项（供后端业务模块调用）
 */
function getEffectiveConfig(db, key, fallback = null) {
  const spec = CONFIG_SCHEMA[key];
  if (!spec) return fallback;
  const all = getRuntimeConfig(db);
  return all[key] !== undefined ? all[key] : fallback;
}

/**
 * 保存运行参数到 kv runtime_config
 */
function setRuntimeConfig(db, newConfig = {}) {
  const current = getRawRuntimeKv(db);
  const updated = { ...current };

  for (const [key, spec] of Object.entries(CONFIG_SCHEMA)) {
    if (spec.readonly) continue; // 只读字段忽略写入
    if (newConfig[key] !== undefined) {
      if (spec.type === 'number') {
        const val = Number(newConfig[key]);
        if (Number.isFinite(val)) updated[key] = val;
      } else {
        updated[key] = String(newConfig[key]).trim();
      }

      // 若有单独的 kvKey 同步更新 (例如 umbra_template_walkthrough)
      if (spec.kvKey) {
        try {
          db.prepare('INSERT OR REPLACE INTO kv(key, value) VALUES(?, ?)').run(spec.kvKey, updated[key]);
        } catch (_) {}
      }
    }
  }

  // 代理参数即时刷新到当前 process.env，无需重启即可被后续网络请求采纳
  if (updated.http_proxy !== undefined) {
    process.env.HTTP_PROXY = updated.http_proxy;
    process.env.http_proxy = updated.http_proxy;
  }
  if (updated.https_proxy !== undefined) {
    process.env.HTTPS_PROXY = updated.https_proxy;
    process.env.https_proxy = updated.https_proxy;
  }
  if (updated.no_proxy !== undefined) {
    process.env.NO_PROXY = updated.no_proxy;
    process.env.no_proxy = updated.no_proxy;
  }
  if (updated.nas_dir) {
    process.env.ML_NAS_DIR = updated.nas_dir;
  }
  if (updated.bff_public_base) {
    process.env.BFF_PUBLIC_BASE = updated.bff_public_base;
  }

  const jsonStr = JSON.stringify(updated);
  db.prepare("INSERT OR REPLACE INTO kv (key, value) VALUES ('runtime_config', ?)").run(jsonStr);

  return getRuntimeConfig(db);
}

module.exports = {
  CONFIG_SCHEMA,
  getRuntimeConfig,
  getEffectiveConfig,
  setRuntimeConfig
};
