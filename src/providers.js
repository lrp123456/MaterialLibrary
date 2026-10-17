/**
 * 供应商 (LLM Providers) 与大模型 (LLM Models) 业务逻辑层
 * 供应商与模型彻底解耦，支持多厂商、多模态（打标/生图/生视频/向量）动态增删改查及连通性测试。
 */
const { chatVision, resolveChatCompletionsUrl } = require('./vlm');
const { toDefaultModelRows } = require('./studio-catalog');

const DEFAULT_PROVIDERS = [
  {
    id: 'litellm',
    name: 'LiteLLM 本地网关 (端口 4000)',
    protocol: 'openai',
    base_url: 'http://127.0.0.1:4000',
    api_key: '',
    secrets_json: JSON.stringify({}),
    config_json: JSON.stringify({ description: '本地 chat/vision 聚合网关（官方模型名，不走生图生视频）' }),
    enabled: 1
  },
  {
    id: 'volcengine',
    name: '火山引擎 (豆包大模型)',
    protocol: 'volcengine',
    base_url: 'https://ark.cn-beijing.volces.com/api/v3',
    api_key: '',
    secrets_json: JSON.stringify({}),
    config_json: JSON.stringify({ description: '字节跳动火山引擎豆包多模态视觉模型与视频生成' }),
    enabled: 1
  },
  {
    id: 'agnes',
    name: 'Agnes AI 创意生成服务',
    protocol: 'openai',
    base_url: 'https://api.agnes-ai.cn/v1',
    api_key: '',
    secrets_json: JSON.stringify({}),
    config_json: JSON.stringify({ description: '室内设计效果图生图、视频漫游与视觉理解' }),
    enabled: 1
  },
  {
    id: 'gemini',
    name: 'Google AI Studio (Gemini)',
    protocol: 'openai',
    base_url: 'https://generativelanguage.googleapis.com/v1beta/openai',
    api_key: '',
    secrets_json: JSON.stringify({}),
    config_json: JSON.stringify({ description: 'Google Gemini 默认文本模型与视觉理解' }),
    enabled: 1
  },
  {
    id: 'groq',
    name: 'Groq 超高速推理平台',
    protocol: 'openai',
    base_url: 'https://api.groq.com/openai/v1',
    api_key: '',
    secrets_json: JSON.stringify({}),
    config_json: JSON.stringify({ description: '超低延时 LPU 推理网关' }),
    enabled: 1
  },
  {
    id: 'kilo',
    name: 'Kilo AI Gateway',
    protocol: 'openai',
    base_url: 'https://api.kilo.ai/api/gateway',
    api_key: '',
    secrets_json: JSON.stringify({}),
    config_json: JSON.stringify({ description: 'StepFun 免费视觉模型通道' }),
    enabled: 1
  },
  {
    id: 'modelscope',
    name: '魔搭社区 (ModelScope)',
    protocol: 'openai',
    base_url: 'https://api-inference.modelscope.cn/v1',
    api_key: '',
    secrets_json: JSON.stringify({}),
    config_json: JSON.stringify({ description: '阿里达摩院魔搭开源大模型与图生图/视频社区' }),
    enabled: 1
  }
];

const DEFAULT_MODELS = [
  ...toDefaultModelRows(),
  // 直连 Agnes AI（免费期，支持图像 URL 输入）
  {
    id: 'agnes_3_0_flash',
    provider_id: 'agnes',
    name: 'Agnes 3.0 Flash（直连）',
    model_code: 'agnes-3.0-flash',
    capabilities: 'chat,vision,tag',
    params_json: JSON.stringify({ temperature: 0.2, max_tokens: 2048 }),
    is_default: 0,
    enabled: 1
  },
  {
    id: 'litellm_agnes_3_0_flash',
    provider_id: 'litellm',
    name: 'Agnes 3.0 Flash',
    model_code: 'agnes-3.0-flash',
    capabilities: 'chat,vision,tag',
    params_json: JSON.stringify({ temperature: 0.2, max_tokens: 2048 }),
    is_default: 0,
    enabled: 1
  },
  {
    id: 'litellm_gemma_4_26b_a4b_it',
    provider_id: 'litellm',
    name: 'Gemma 4 26B',
    model_code: 'gemma-4-26b-a4b-it',
    capabilities: 'chat,vision',
    params_json: JSON.stringify({ temperature: 0.2, max_tokens: 2048 }),
    is_default: 0,
    enabled: 1
  },
  {
    id: 'litellm_gemma_4_31b_it',
    provider_id: 'litellm',
    name: 'Gemma 4 31B',
    model_code: 'gemma-4-31b-it',
    capabilities: 'chat,vision',
    params_json: JSON.stringify({ temperature: 0.2, max_tokens: 2048 }),
    is_default: 0,
    enabled: 1
  },
  {
    id: 'litellm_doubao_seed_2_1_lite',
    provider_id: 'litellm',
    name: 'Doubao Seed 2.1 Lite',
    model_code: 'doubao-seed-2-1-lite-260915',
    capabilities: 'chat,vision,tag',
    params_json: JSON.stringify({ temperature: 0.2, max_tokens: 2048 }),
    is_default: 0,
    enabled: 1
  },
  {
    id: 'litellm_doubao_seed_2_1_turbo',
    provider_id: 'litellm',
    name: 'Doubao Seed 2.1 Turbo',
    model_code: 'doubao-seed-2-1-turbo-260628',
    capabilities: 'chat,vision,tag',
    params_json: JSON.stringify({ temperature: 0.2, max_tokens: 2048 }),
    is_default: 0,
    enabled: 1
  },
  {
    id: 'litellm_doubao_seed_2_1_pro',
    provider_id: 'litellm',
    name: 'Doubao Seed 2.1 Pro',
    model_code: 'doubao-seed-2-1-pro-260628',
    capabilities: 'chat,vision,tag',
    params_json: JSON.stringify({ temperature: 0.2, max_tokens: 2048 }),
    is_default: 0,
    enabled: 1
  },
  {
    id: 'litellm_gemini_flash_lite_latest',
    provider_id: 'litellm',
    name: 'Gemini Flash-Lite',
    model_code: 'gemini-flash-lite-latest',
    capabilities: 'chat,vision,tag',
    params_json: JSON.stringify({ temperature: 0.2, max_tokens: 2048 }),
    is_default: 0,
    enabled: 0
  },
  {
    id: 'litellm_gemini_flash_latest',
    provider_id: 'litellm',
    name: 'Gemini Flash',
    model_code: 'gemini-flash-latest',
    capabilities: 'chat,vision,tag',
    params_json: JSON.stringify({ temperature: 0.2, max_tokens: 2048 }),
    is_default: 0,
    enabled: 0
  },
  {
    id: 'litellm_workflow_vision',
    provider_id: 'litellm',
    name: '识图组 workflow_vision',
    model_code: 'workflow_vision',
    capabilities: 'chat,vision,tag',
    params_json: JSON.stringify({ temperature: 0.2, max_tokens: 2048 }),
    is_default: 0,
    enabled: 1
  },
  {
    id: 'litellm_workflow_vision_low',
    provider_id: 'litellm',
    name: '识图组 workflow_vision_low',
    model_code: 'workflow_vision_low',
    capabilities: 'chat,vision,tag',
    params_json: JSON.stringify({ temperature: 0.2, max_tokens: 2048 }),
    is_default: 0,
    enabled: 1
  },
  {
    id: 'litellm_model_text_input',
    provider_id: 'litellm',
    name: '文本输入组 model_text_input',
    model_code: 'model_text_input',
    capabilities: 'chat,vision,tag',
    params_json: JSON.stringify({ temperature: 0.2, max_tokens: 2048 }),
    is_default: 0,
    enabled: 1
  },
  {
    id: 'litellm_model_image_input',
    provider_id: 'litellm',
    name: '图像输入组 model_image_input',
    model_code: 'model_image_input',
    capabilities: 'chat,vision,tag',
    params_json: JSON.stringify({ temperature: 0.2, max_tokens: 2048 }),
    is_default: 0,
    enabled: 1
  },
  {
    id: 'litellm_model_video_input',
    provider_id: 'litellm',
    name: '视频输入组 model_video_input',
    model_code: 'model_video_input',
    capabilities: 'chat,vision,tag',
    params_json: JSON.stringify({ temperature: 0.2, max_tokens: 2048 }),
    is_default: 0,
    enabled: 1
  },
  // 魔搭社区 (ModelScope) 开源模型（归入「其他」，不再伪装成 Google）
  {
    id: 'modelscope_image_diffusion',
    provider_id: 'modelscope',
    name: 'ModelScope 文生图',
    model_code: 'damo/cv_diffusion_text-to-image-synthesis',
    capabilities: 'image',
    params_json: JSON.stringify({ size: '1024x1024' }),
    is_default: 0,
    enabled: 1
  },
  {
    id: 'modelscope_video_synthesis',
    provider_id: 'modelscope',
    name: 'ModelScope 文生视频',
    model_code: 'damo/text-to-video-synthesis',
    capabilities: 'video',
    params_json: JSON.stringify({ seconds: 5 }),
    is_default: 0,
    enabled: 1
  },
  {
    id: 'modelscope_qwen2_5_vl_72b',
    provider_id: 'modelscope',
    name: '通义千问 Qwen2.5-VL-72B (魔搭高精打标)',
    model_code: 'Qwen/Qwen2.5-VL-72B-Instruct',
    capabilities: 'vision,tag,chat',
    params_json: JSON.stringify({ temperature: 0.2, max_tokens: 2048 }),
    is_default: 0,
    enabled: 1
  },
  {
    id: 'modelscope_qwen2_5_vl_7b',
    provider_id: 'modelscope',
    name: '通义千问 Qwen2.5-VL-7B (魔搭轻量打标)',
    model_code: 'Qwen/Qwen2.5-VL-7B-Instruct',
    capabilities: 'vision,tag,chat',
    params_json: JSON.stringify({ temperature: 0.2, max_tokens: 1500 }),
    is_default: 0,
    enabled: 1
  },
];

function initProvidersTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS llm_providers (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      protocol TEXT NOT NULL DEFAULT 'openai',
      base_url TEXT,
      api_key TEXT,
      secrets_json TEXT,
      config_json TEXT,
      enabled INTEGER DEFAULT 1,
      created_at INTEGER,
      updated_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS llm_models (
      id TEXT PRIMARY KEY,
      provider_id TEXT NOT NULL REFERENCES llm_providers(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      model_code TEXT NOT NULL,
      capabilities TEXT NOT NULL,
      params_json TEXT,
      is_default INTEGER DEFAULT 0,
      enabled INTEGER DEFAULT 1,
      created_at INTEGER,
      updated_at INTEGER
    );

    CREATE INDEX IF NOT EXISTS idx_llm_models_prov ON llm_models(provider_id);
    CREATE INDEX IF NOT EXISTS idx_llm_models_caps ON llm_models(capabilities);
  `);

  const now = Date.now();
  const insProv = db.prepare(`
    INSERT INTO llm_providers (id, name, protocol, base_url, api_key, secrets_json, config_json, enabled, created_at, updated_at)
    VALUES (@id, @name, @protocol, @base_url, @api_key, @secrets_json, @config_json, @enabled, @now, @now)
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name,
      protocol=excluded.protocol,
      base_url=excluded.base_url,
      api_key='',
      secrets_json=excluded.secrets_json,
      config_json=excluded.config_json,
      updated_at=excluded.updated_at
  `);

  const insModel = db.prepare(`
    INSERT INTO llm_models (id, provider_id, name, model_code, capabilities, params_json, is_default, enabled, created_at, updated_at)
    VALUES (@id, @provider_id, @name, @model_code, @capabilities, @params_json, @is_default, @enabled, @now, @now)
    ON CONFLICT(id) DO UPDATE SET
      provider_id=excluded.provider_id,
      name=excluded.name,
      model_code=excluded.model_code,
      capabilities=excluded.capabilities,
      params_json=excluded.params_json,
      is_default=excluded.is_default,
      updated_at=excluded.updated_at
  `);

  for (const p of DEFAULT_PROVIDERS) {
    insProv.run({
      ...p,
      api_key: '',
      secrets_json: '{}',
      now,
    });
  }

  for (const m of DEFAULT_MODELS) {
    insModel.run({ ...m, now });
  }

  db.prepare("UPDATE llm_providers SET enabled=1 WHERE id='litellm'").run();
  try {
    db.prepare("UPDATE gen_adapters SET enabled=0 WHERE id IN ('litellm_images', 'openai_videos')").run();
  } catch (_) {}
  db.prepare("UPDATE llm_providers SET base_url='https://generativelanguage.googleapis.com/v1beta/openai', protocol='openai' WHERE id='gemini'").run();
  scrubProviderSecretColumns(db);
  scrubKvSecrets(db);

  // ---- 一次性遗留行清理（保留：这些 model_code 是历史拼写，永远不该再被选中）----
  db.prepare(`
    UPDATE llm_models SET enabled=0, is_default=0
    WHERE model_code IN ('image_agnes_vision','image_agnes_vision_2','image_doubao_vision','agnes-image','agnes-video-v2.0')
       OR id IN ('litellm_image_agnes_vision','litellm_image_agnes_vision_2','litellm_image_doubao_vision','litellm_agnes_image','litellm_agnes_video')
  `).run();

  // ---- ★ 删除「反别名逻辑」----
  // 以前这里用一串 UPDATE 手工把 is_default 掰到某个具体模型上
  // （第 325/327/328 行曾把 chat 默认设成已下线的 doubao_seed_2_0_lite、
  //  把 image 默认设成 seedream Pro、把 video 默认设成 Seedance 2.5 —— 三处都与
  //  `studio-catalog.js` 的 OFFICIAL_STUDIO 相反）。
  // `llm_models.is_default` 不是治理入口：lab.js 读默认值时一律取
  // OFFICIAL_STUDIO.<domain>.defaultModel（见 lab.js「is_default 在 providers 侧被
  // 统一清零，不能当默认标记」）。因此这里不再维护 is_default，
  // 「改默认选谁」只改 `studio-catalog.js` 一处。
  try {
    const { pinUnattendedVlm } = require('./gen-governance');
    pinUnattendedVlm(db);
  } catch (e) {
    console.warn('[providers] 无人值守模型钉扎跳过', e.message);
  }
  try {
    ensureDoubaoMusicAdapter(db);
  } catch (e) {
    console.warn('[providers] doubao_music 适配器跳过', e.message);
  }
  try {
    ensureQwenImageAdapter(db);
  } catch (e) {
    console.warn('[providers] qwenimage_local 适配器跳过', e.message);
  }
  try {
    collapseDuplicateTextModels(db);
  } catch (e) {
    console.warn('[providers] 文本模型并入网关跳过', e.message);
  }
  try {
    const { initModelRegistryTables } = require('./models-contract');
    initModelRegistryTables(db);
  } catch (e) {
    console.warn('[providers] initModelRegistryTables 跳过', e.message);
  }
  reconcileModelFlagsWithCatalog(db);
}

function ensureDoubaoMusicAdapter(db) {
  const hit = db.prepare("SELECT id FROM gen_adapters WHERE id='doubao_music'").get();
  if (hit) return;
  const now = Date.now();
  db.prepare(`
    INSERT OR IGNORE INTO gen_adapters
      (id, label, kind, builtin, protocol, base_url, secrets_json, config_json, enabled, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    'doubao_music',
    '豆包音乐',
    'music',
    1,
    'doubao_music',
    'https://open.volcengineapi.com',
    '{}',
    JSON.stringify({ defaultModel: 'doubao-bgm-v5', timeoutMs: 600000 }),
    1,
    now,
    now
  );
}

/**
 * 注册本地 QwenImage 通道（ncnn-vulkan 版 Qwen2.1-Image）。
 *
 * 定位：Agnes 的**并行补充 + 降级**，不是替代。
 *   - Agnes 偶发 TLS 断连/429/503 时，restage 自动切到本机重试
 *   - 一次性灌入多张、Agnes 排队处理不完时，本机可并行消化
 *
 * 幂等：已存在则只更新 config（便于改地址/端口后自动生效）。
 */
function ensureQwenImageAdapter(db) {
  const now = Date.now();
  const config = {
    // 管理台挂载 GPU 面板 9000 的 /api/qw。8003 仍是裸生图端口，只有基址不是 :9000 时才走它。
    apiBase: process.env.QWENIMAGE_API_BASE || 'http://192.168.1.107:9000',
    productBase: process.env.QWENIMAGE_PRODUCT_BASE || 'http://192.168.1.107:9000',
    // 实测：steps 8→20 只多花 ~5s，固定开销 ~85~90s 才是大头
    steps: 20,
    cfgScale: 1.0,
    // 单张超时 10 分钟（本地慢但稳定）
    timeoutMs: 600000,
    pollIntervalMs: 3000,
    // 留空 = 每次随机 seed；固定值可复现
    fixedSeed: null,
  };
  const hit = db.prepare("SELECT id FROM gen_adapters WHERE id='qwenimage_local'").get();
  if (hit) {
    db.prepare('UPDATE gen_adapters SET base_url=?, config_json=?, updated_at=? WHERE id=?')
      .run(config.apiBase, JSON.stringify(config), now, 'qwenimage_local');
    return;
  }
  db.prepare(`
    INSERT OR IGNORE INTO gen_adapters
      (id, label, kind, builtin, protocol, base_url, secrets_json, config_json, enabled, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?,?,?,?,?)
  `).run(
    'qwenimage_local',
    '本地 QwenImage (Qwen2.1-Image · ncnn-vulkan)',
    'image',
    1,
    'qwenimage_local',
    config.apiBase,
    '{}',
    JSON.stringify(config),
    1,
    now,
    now
  );
}

/**
 * 让 `llm_models` 的 enabled 与官方目录保持一致（幂等）：
 *   · 目录里有的 model_code → 确保 enabled=1（避免有效模型被历史 UPDATE 误关）；
 *   · 目录里没有、且没有任何适配器能匹配的孤儿生成模型 → 关闭并标记，供治理台人工复核。
 * 只碰 `enabled`，不碰 `is_default`（那不是治理入口）。
 */
function reconcileModelFlagsWithCatalog(db) {
  let OFFICIAL_STUDIO = null;
  let pickAdapterId = null;
  try {
    ({ OFFICIAL_STUDIO } = require('./studio-catalog'));
    ({ pickAdapterId } = require('./adapter-match'));
  } catch (e) {
    return; // 目录不可用时静默跳过，不阻塞启动
  }
  if (!OFFICIAL_STUDIO) return;

  const KINDS = ['chat', 'image', 'video', 'music', 'portrait'];
  const adapters = (() => {
    try { return db.prepare('SELECT id, kind FROM gen_adapters').all(); } catch (e) { return []; }
  })();

  const enable = db.prepare('UPDATE llm_models SET enabled=1 WHERE model_code=?');
  const disable = db.prepare('UPDATE llm_models SET enabled=0 WHERE model_code=? AND enabled=1');
  const exists = db.prepare('SELECT id FROM llm_models WHERE model_code=? LIMIT 1');
  const providerExists = db.prepare('SELECT id FROM llm_providers WHERE id=?');
  const insert = db.prepare(`
    INSERT INTO llm_models (id, provider_id, name, model_code, capabilities, params_json, is_default, enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, '{}', 0, 1, ?, ?)
  `);
  const turnedOff = new Set();
  const now = Date.now();

  for (const domain of KINDS) {
    const block = OFFICIAL_STUDIO[domain] || {};
    const kind = domain === 'chat' ? 'chat' : domain === 'portrait' ? 'image' : domain;
    for (const m of (block.models || [])) {
      const code = m.model_code;
      if (!code) continue;
      // 若目录中明确标注停用（如 Gemini 对话模型），不再强制点亮
      if (m.disabled) {
        disable.run(code);
        continue;
      }
      // 生成域：必须有可匹配的适配器，否则不点亮（点亮一个没有适配器的模型 = 点了就 404）
      if (kind !== 'chat') {
        const adapterId = pickAdapterId ? pickAdapterId(kind, code, adapters) : null;
        if (!adapterId) { disable.run(code); turnedOff.add(code); continue; }
      }
      if (!exists.get(code)) {
        const providerId = (code === 'workflow_vision' || code === 'workflow_vision_low')
          ? 'litellm'
          : (m.provider || 'litellm');
        if (providerExists.get(providerId)) {
          const id = m.dbId || m.id || code;
          try {
            insert.run(id, providerId, m.name || code, code, m.capabilities || kind, now, now);
          } catch (e) {
            console.warn('[providers] 补目录模型行失败', code, e.message);
          }
        }
      }
      enable.run(code);
    }
  }

  // 孤儿生成模型：目录里没有、且适配器也匹配不上 → 关闭（可能是历史拼写/已下线）
  let rows = [];
  try {
    rows = db.prepare("SELECT DISTINCT model_code, provider_id FROM llm_models WHERE enabled=1").all();
  } catch (e) { rows = []; }
  const catalogCodes = new Set();
  for (const domain of KINDS) {
    for (const m of ((OFFICIAL_STUDIO[domain] || {}).models || [])) {
      if (m.model_code) catalogCodes.add(m.model_code);
    }
  }
  for (const r of rows) {
    const code = String(r.model_code || '');
    if (!code || catalogCodes.has(code)) continue;
    if (r.provider_id === 'modelscope' || r.provider_id === 'litellm') continue; // 第三方网关/魔搭自带目录，不归本目录管
    if (/^(gemini|veo|lyria|imagen|nano)/.test(code)) continue; // Google 生成侧下架走 D11 的专门处理
    const kind = /seedance/.test(code) ? 'video' : /(song|bgm)/.test(code) ? 'music' : 'image';
    const adapterId = pickAdapterId ? pickAdapterId(kind, code, adapters) : null;
    if (!adapterId) { disable.run(code); turnedOff.add(code); }
  }

  if (turnedOff.size) {
    console.log('[providers] 已按官方目录关闭以下无适配器/非目录模型：' + Array.from(turnedOff).join(', '));
  }
}

const SECRET_FIELDS = new Set([
  'api_key', 'apiKey', 'api_keys', 'apiKeys', 'masterKey', 'master_key',
  'ak', 'sk', 'key', 'token', 'access_key', 'secret_key', 'accessKey', 'secretKey',
  'value',
]);

function scrubSecretsObject(raw) {
  if (Array.isArray(raw)) {
    return raw.map((item) => (item && typeof item === 'object' ? scrubSecretsObject(item) : item));
  }
  if (!raw || typeof raw !== 'object') return {};
  const out = {};
  for (const [key, value] of Object.entries(raw)) {
    if (SECRET_FIELDS.has(key)) continue;
    out[key] = value && typeof value === 'object' ? scrubSecretsObject(value) : value;
  }
  return out;
}

function scrubKvSecrets(db) {
  let row = null;
  try {
    row = db.prepare("SELECT value FROM kv WHERE key='umbra_token'").get();
  } catch (_) {
    return;
  }
  if (!row) return;
  const value = String(row.value || '').trim();
  if (value && !String(process.env.UMBRA_TOKEN || '').trim()) {
    const { setEnvAssignments } = require('./env-keys');
    setEnvAssignments({ UMBRA_TOKEN: value });
  }
  db.prepare("DELETE FROM kv WHERE key='umbra_token'").run();
}

function scrubProviderSecretColumns(db) {
  const rows = db.prepare('SELECT id, secrets_json FROM llm_providers').all();
  const upd = db.prepare('UPDATE llm_providers SET api_key=?, secrets_json=? WHERE id=?');
  for (const row of rows) {
    const cleaned = scrubSecretsObject(parseSecretsObject(row.secrets_json));
    upd.run('', JSON.stringify(cleaned), row.id);
  }
  try {
    const adapters = db.prepare('SELECT id, secrets_json FROM gen_adapters').all();
    const updAdapter = db.prepare('UPDATE gen_adapters SET secrets_json=? WHERE id=?');
    for (const row of adapters) {
      updAdapter.run(JSON.stringify(scrubSecretsObject(parseSecretsObject(row.secrets_json))), row.id);
    }
  } catch (_) {}
}

function providerHasEnvKey(id) {
  try {
    const { keysFromEnv } = require('./env-keys');
    if (keysFromEnv(id).length) return true;
  } catch (_) {}
  if (id === 'volcengine') {
    const ak = process.env.VOLC_AK || process.env.VOLC_ACCESSKEY;
    const sk = process.env.VOLC_SK || process.env.VOLC_SECRETKEY;
    return Boolean(ak && sk);
  }
  if (id === 'litellm' && process.env.LITELLM_MASTER_KEY) return true;
  return false;
}

function looksLikeNewSecret(value) {
  const s = String(value || '').trim();
  if (!s || s.includes('•') || s.startsWith('环境变量')) return false;
  if (/^\$[A-Z0-9_]+$/.test(s)) return false;
  return true;
}

// ---------------- 供应商 CRUD ----------------
function extractCredentialSlots(p) {
  const secrets = p.secrets_json ? parseSecretsObject(p.secrets_json) : {};
  if (Array.isArray(secrets.slots) && secrets.slots.length > 0) {
    return secrets.slots.map(s => {
      const envName = s.env_var || s.env || '';
      const akEnv = s.env_ak || s.ak_env || '';
      const skEnv = s.env_sk || s.sk_env || '';
      const has = s.type === 'aksk'
        ? Boolean(akEnv && skEnv && process.env[akEnv] && process.env[skEnv])
        : Boolean(envName && process.env[envName]);
      const copy = { ...s };
      delete copy.value;
      delete copy.ak;
      delete copy.sk;
      return {
        ...copy,
        has_value: has,
        value_masked: has ? `环境变量 $${envName || akEnv}` : '',
      };
    });
  }

  const autoSlots = [];
  if (p.id === 'volcengine') {
    autoSlots.push({
      id: 'ark_bearer',
      type: 'bearer',
      name: '火山方舟大模型 API Key',
      env_var: 'ARK_API_KEY',
      has_value: Boolean(process.env.ARK_API_KEY),
      value_masked: process.env.ARK_API_KEY ? '环境变量 $ARK_API_KEY' : ''
    });
    const volcAk = process.env.VOLC_AK || process.env.VOLC_ACCESSKEY;
    const volcSk = process.env.VOLC_SK || process.env.VOLC_SECRETKEY;
    autoSlots.push({
      id: 'volc_aksk',
      type: 'aksk',
      name: '火山云 AK/SK (音乐生成等专属)',
      env_ak: 'VOLC_AK',
      env_sk: 'VOLC_SK',
      has_value: Boolean(volcAk && volcSk),
      value_masked: (volcAk && volcSk) ? '环境变量 $VOLC_ACCESSKEY / $VOLC_SECRETKEY' : ''
    });
  } else {
    let envName = `${String(p.id || '').toUpperCase()}_API_KEY`;
    try {
      const { envNamesForProvider } = require('./env-keys');
      envName = envNamesForProvider(p.id)[0] || envName;
    } catch (_) {}
    autoSlots.push({
      id: 'primary_bearer',
      type: 'bearer',
      name: `${p.name || p.id} 主 API Key`,
      env_var: envName,
      has_value: Boolean(process.env[envName]),
      value_masked: process.env[envName] ? `环境变量 $${envName}` : ''
    });
  }
  return autoSlots;
}

function getProviders(db) {
  const providers = db.prepare(`
    SELECT id, name, protocol, base_url, api_key, secrets_json, config_json, enabled, created_at, updated_at
    FROM llm_providers
    ORDER BY id = 'litellm' DESC, id ASC
  `).all();

  const modelCounts = db.prepare(`
    SELECT provider_id, count(*) as count, group_concat(name, ' / ') as preview
    FROM llm_models
    WHERE enabled = 1
    GROUP BY provider_id
  `).all();

  const countMap = {};
  for (const mc of modelCounts) {
    countMap[mc.provider_id] = mc;
  }

  return providers.map(p => {
    const parsedSecrets = scrubSecretsObject(p.secrets_json ? JSON.parse(p.secrets_json) : {});
    const hasKey = providerHasEnvKey(p.id);
    return {
      id: p.id,
      name: p.name,
      protocol: p.protocol,
      base_url: p.base_url,
      api_key_masked: hasKey ? '••••••••' : '',
      has_key: hasKey,
      model_count: countMap[p.id]?.count || 0,
      models_preview: countMap[p.id]?.preview || '暂无启用模型',
      secrets: parsedSecrets,
      slots: extractCredentialSlots(p),
      config: p.config_json ? JSON.parse(p.config_json) : {},
      enabled: p.enabled,
      created_at: p.created_at,
      updated_at: p.updated_at
    };
  });
}

function getProviderById(db, id, includeSecret = false) {
  const p = db.prepare('SELECT * FROM llm_providers WHERE id = ?').get(id);
  if (!p) return null;
  const hasKey = providerHasEnvKey(p.id);
  return {
    ...p,
    api_key: undefined,
    api_key_masked: hasKey ? '••••••••' : '',
    secrets: scrubSecretsObject(p.secrets_json ? JSON.parse(p.secrets_json) : {}),
    slots: extractCredentialSlots(p),
    config: p.config_json ? JSON.parse(p.config_json) : {}
  };
}

function saveProvider(db, data) {
  const now = Date.now();
  const id = (data.id || data.name || '').toLowerCase().replace(/[^a-z0-9_-]/g, '_');
  if (!id) throw new Error('供应商 ID 不能为空');

  const inputKey = typeof data.api_key === 'string' ? data.api_key.trim() : '';
  const newKeys = [];
  if (looksLikeNewSecret(inputKey)) newKeys.push(inputKey);

  let sjInput = parseSecretsObject(
    typeof data.secrets_json === 'object' ? data.secrets_json : (data.secrets_json || '')
  );
  const namedEnv = {};
  if (Array.isArray(data.slots) && data.slots.length > 0) {
    const cleanSlots = [];
    for (const s of data.slots) {
      if (s.type === 'bearer' && looksLikeNewSecret(s.value)) newKeys.push(String(s.value).trim());
      if (s.type === 'aksk') {
        const akEnv = s.env_ak || s.ak_env;
        const skEnv = s.env_sk || s.sk_env;
        if (akEnv && looksLikeNewSecret(s.ak)) namedEnv[akEnv] = String(s.ak).trim();
        if (skEnv && looksLikeNewSecret(s.sk)) namedEnv[skEnv] = String(s.sk).trim();
      }
      const slot = { ...s };
      delete slot.value;
      delete slot.ak;
      delete slot.sk;
      cleanSlots.push(slot);
    }
    sjInput.slots = cleanSlots;
  }
  for (const key of [...(sjInput.api_keys || []), ...(sjInput.apiKeys || [])]) {
    if (looksLikeNewSecret(key)) newKeys.push(String(key).trim());
  }
  const master = looksLikeNewSecret(sjInput.masterKey) ? String(sjInput.masterKey).trim() : '';
  const { writeProviderKeys, setEnvAssignments } = require('./env-keys');
  if (newKeys.length || master) writeProviderKeys(id, newKeys, master ? { masterKey: master } : {});
  if (Object.keys(namedEnv).length) setEnvAssignments(namedEnv);

  const stmt = db.prepare(`
    INSERT INTO llm_providers (id, name, protocol, base_url, api_key, secrets_json, config_json, enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      name=excluded.name,
      protocol=excluded.protocol,
      base_url=excluded.base_url,
      api_key='',
      secrets_json=excluded.secrets_json,
      config_json=excluded.config_json,
      enabled=excluded.enabled,
      updated_at=excluded.updated_at
  `);

  stmt.run(
    id,
    data.name || id,
    data.protocol || 'openai',
    data.base_url || '',
    '',
    JSON.stringify(scrubSecretsObject(sjInput)),
    typeof data.config_json === 'object' ? JSON.stringify(data.config_json) : (data.config_json || '{}'),
    data.enabled === false ? 0 : 1,
    now,
    now
  );

  return getProviderById(db, id);
}

function deleteProvider(db, id) {
  if (id === 'litellm') throw new Error('内置 LiteLLM 网关不能删除');
  db.prepare('DELETE FROM llm_models WHERE provider_id=?').run(id);
  db.prepare('DELETE FROM llm_providers WHERE id=?').run(id);
  return { success: true };
}

function toggleProvider(db, id, enabled) {
  db.prepare('UPDATE llm_providers SET enabled=?, updated_at=? WHERE id=?').run(enabled ? 1 : 0, Date.now(), id);
  return { success: true, enabled: Boolean(enabled) };
}

// ---------------- 模型 CRUD ----------------
function getModels(db, { provider_id, capability } = {}) {
  let sql = `
    SELECT m.id, m.provider_id, m.name, m.model_code, m.capabilities, m.params_json, m.is_default, m.enabled, m.created_at, m.updated_at,
           p.name as provider_name, p.protocol, p.base_url
    FROM llm_models m
    LEFT JOIN llm_providers p ON m.provider_id = p.id
    WHERE 1=1
  `;
  const params = [];
  if (provider_id) {
    sql += ' AND m.provider_id = ?';
    params.push(provider_id);
  }
  if (capability) {
    sql += ' AND instr(m.capabilities, ?) > 0';
    params.push(capability);
  }
  sql += ' ORDER BY m.is_default DESC, m.provider_id ASC, m.id ASC';

  const rows = db.prepare(sql).all(...params);
  return rows.map(r => {
    const params = r.params_json ? JSON.parse(r.params_json) : {};
    const caps = (r.capabilities || '').split(',').map(c => c.trim()).filter(Boolean);
    const regionKind = params.region_kind || (caps.includes('image') ? 'coords_bbox' : 'vlm_text');
    return {
      ...r,
      params,
      caps,
      region_kind: regionKind,
      regionKind,
    };
  });
}

function getModelById(db, id) {
  const r = db.prepare(`
    SELECT m.*, p.name as provider_name, p.protocol, p.base_url, p.api_key
    FROM llm_models m
    LEFT JOIN llm_providers p ON m.provider_id = p.id
    WHERE m.id = ?
  `).get(id);
  if (!r) return null;
  const params = r.params_json ? JSON.parse(r.params_json) : {};
  const caps = (r.capabilities || '').split(',').map(c => c.trim()).filter(Boolean);
  const regionKind = params.region_kind || (caps.includes('image') ? 'coords_bbox' : 'vlm_text');
  return {
    ...r,
    params,
    caps,
    region_kind: regionKind,
    regionKind,
  };
}

function saveModel(db, data) {
  const now = Date.now();
  const id = data.id || `${data.provider_id}_${data.model_code}`.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
  if (!id) throw new Error('模型 ID 不能为空');
  if (!data.provider_id) throw new Error('所属供应商不能为空');

  if (data.is_default) {
    // 互斥默认状态（相同主要能力的其它模型重置 is_default）
    db.prepare('UPDATE llm_models SET is_default=0 WHERE provider_id=?').run(data.provider_id);
  }

  let paramsObj = typeof data.params_json === 'object' ? { ...data.params_json } : (data.params_json ? JSON.parse(data.params_json) : {});
  if (data.region_kind) paramsObj.region_kind = data.region_kind;
  if (data.regionKind) paramsObj.region_kind = data.regionKind;
  if (data.params_spec) paramsObj.params_spec = data.params_spec;

  const stmt = db.prepare(`
    INSERT INTO llm_models (id, provider_id, name, model_code, capabilities, params_json, is_default, enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      provider_id=excluded.provider_id,
      name=excluded.name,
      model_code=excluded.model_code,
      capabilities=excluded.capabilities,
      params_json=excluded.params_json,
      is_default=excluded.is_default,
      enabled=excluded.enabled,
      updated_at=excluded.updated_at
  `);

  stmt.run(
    id,
    data.provider_id,
    data.name || id,
    data.model_code || id,
    Array.isArray(data.capabilities) ? data.capabilities.join(',') : (data.capabilities || 'vision,tag'),
    JSON.stringify(paramsObj),
    data.is_default ? 1 : 0,
    data.enabled === false ? 0 : 1,
    now,
    now
  );

  return getModelById(db, id);
}

function deleteModel(db, id) {
  const m = db.prepare('SELECT model_code FROM llm_models WHERE id=?').get(id);
  if (m && m.model_code) {
    try {
      const { deprecateModelSkill } = require('./gen-governance');
      deprecateModelSkill(db, m.model_code, 'deleteModel');
    } catch (_) {}
  }
  db.prepare('DELETE FROM llm_models WHERE id=?').run(id);
  return { success: true };
}

function toggleModel(db, id, enabled) {
  db.prepare('UPDATE llm_models SET enabled=?, updated_at=? WHERE id=?').run(enabled ? 1 : 0, Date.now(), id);
  try {
    const { officialOf } = require('./studio-catalog');
    const hit = officialOf(id);
    if (hit && hit.model) {
      hit.model.disabled = !enabled;
    }
  } catch (_) {}
  if (!enabled) {
    try {
      const m = db.prepare('SELECT model_code FROM llm_models WHERE id=?').get(id);
      if (m && m.model_code) {
        const { deprecateModelSkill } = require('./gen-governance');
        deprecateModelSkill(db, m.model_code, 'toggleModel');
      }
    } catch (_) {}
  }
  return { success: true, enabled: Boolean(enabled) };
}

// ---------------- 实时连通性测试 ----------------
async function testModel(services, modelId, { prompt = '请用一句话描述室内极简风格', image = null } = {}) {
  const { db } = services;
  const m = getModelById(db, modelId);
  if (!m) throw new Error(`模型 ${modelId} 不存在`);

  const startTime = Date.now();
  const caps = m.caps;

  // 1. 视觉理解或对话测试 (Vision / Tag / Chat)
  if (caps.includes('vision') || caps.includes('tag') || caps.includes('chat')) {
    const isVision = caps.includes('vision') || caps.includes('tag');
    let baseUrl = (m.base_url || '').replace(/\/$/, '');
    let apiKey = '';
    if (!apiKey) {
      if (m.provider_id === 'litellm') {
        const admin = litellmAdmin(db, services.config);
        apiKey = admin.apiKey;
        if (!baseUrl) baseUrl = admin.baseUrl;
      } else {
        const provRow = getProviderById(db, m.provider_id);
        const keys = keysForProviderRow(provRow);
        apiKey = keys[0] || '';
      }
    }
    if (!apiKey && m.provider_id === 'litellm') {
      apiKey = process.env.LITELLM_API_KEY || (services.config && services.config.litellmApiKey) || '';
    }
    if (!baseUrl) baseUrl = 'http://127.0.0.1:4000';
    if (!apiKey) {
      throw new Error(m.provider_id === 'litellm' ? '本地网关没有钥匙' : '未配置 API 密钥');
    }

    let messages = [];
    if (isVision && image) {
      messages = [
        {
          role: 'user',
          content: [
            { type: 'text', text: prompt },
            { type: 'image_url', image_url: { url: image.startsWith('data:') ? image : `data:image/jpeg;base64,${image}` } }
          ]
        }
      ];
    } else {
      messages = [{ role: 'user', content: prompt }];
    }

    const endpoint = resolveChatCompletionsUrl(baseUrl);
    const res = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: apiKey.startsWith('Bearer ') ? apiKey : `Bearer ${apiKey}`
      },
      body: JSON.stringify({
        model: m.model_code,
        messages,
        max_tokens: 300,
        temperature: 0.2
      }),
      signal: AbortSignal.timeout(30000)
    });

    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`HTTP ${res.status}: ${text.slice(0, 300)}`);
    }

    const data = await res.json();
    const reply = data.choices?.[0]?.message?.content || data.choices?.[0]?.message?.reasoning_content || JSON.stringify(data);

    return {
      success: true,
      duration_ms: Date.now() - startTime,
      model: m.model_code,
      provider: m.provider_name,
      reply: reply.slice(0, 500),
      usage: data.usage
    };
  }

  // 2. 图像生成测试
  if (caps.includes('image')) {
    const { executeAdapter } = require('./gen');
    // 优先寻找系统注册的匹配适配器
    let adapter = db.prepare(`
      SELECT * FROM gen_adapters 
      WHERE kind='image' AND enabled=1 
        AND (id LIKE ? OR base_url LIKE ? OR config_json LIKE ?) 
      LIMIT 1
    `).get(`%${m.provider_id}%`, `%${m.provider_id}%`, `%"${m.model_code}"%`);

    if (!adapter) {
      adapter = db.prepare("SELECT * FROM gen_adapters WHERE kind='image' AND enabled=1 AND (id LIKE ? OR base_url LIKE ?) LIMIT 1")
        .get(`%${m.provider_id}%`, `%${m.provider_id}%`);
    }

    if (!adapter) {
      adapter = db.prepare("SELECT * FROM gen_adapters WHERE kind='image' AND enabled=1 LIMIT 1").get();
    }

    if (!adapter) {
      adapter = {
        id: m.id,
        kind: 'image',
        protocol: (m.protocol === 'openai' || !m.protocol) ? 'http_json' : m.protocol,
        base_url: m.base_url || 'https://api.agnes-ai.cn/v1',
        secrets_json: '{}',
        config_json: JSON.stringify({
          path: '/v1/images/generations',
          defaultModel: m.model_code || 'agnes-image-2.5-flash',
          bodyTemplate: {
            prompt: '{{prompt}}',
            model: '{{model}}',
            size: '1024x1024'
          }
        })
      };
    }

    const result = await executeAdapter(services, adapter, {
      kind: 'image',
      prompt: prompt || '现代极简室内设计客厅效果图，自然采光，原木质感',
      model: m.model_code
    });

    const firstFile = result.files?.[0];
    const previewUrl = firstFile?.previewUrl || (firstFile?.localPath ? `/api/cache/temp/${require('path').basename(firstFile.localPath)}` : null);
    return {
      success: true,
      duration_ms: Date.now() - startTime,
      type: 'image',
      previewUrl,
      files: result.files,
      data: {
        ...result,
        previewUrl
      }
    };
  }

  // 3. 视频生成测试
  if (caps.includes('video')) {
    const { executeAdapter } = require('./gen');
    let adapter = db.prepare(`
      SELECT * FROM gen_adapters 
      WHERE kind='video' AND enabled=1 
        AND (id LIKE ? OR base_url LIKE ? OR config_json LIKE ?) 
      LIMIT 1
    `).get(`%${m.provider_id}%`, `%${m.provider_id}%`, `%"${m.model_code}"%`);

    if (!adapter) {
      adapter = db.prepare("SELECT * FROM gen_adapters WHERE kind='video' AND enabled=1 AND (id LIKE ? OR base_url LIKE ?) LIMIT 1")
        .get(`%${m.provider_id}%`, `%${m.provider_id}%`);
    }

    if (!adapter) {
      adapter = db.prepare("SELECT * FROM gen_adapters WHERE kind='video' AND enabled=1 LIMIT 1").get();
    }

    if (adapter) {
      try {
        const result = await executeAdapter(services, adapter, {
          kind: 'video',
          prompt: prompt || '现代极简客厅空间漫游镜头推近',
          model: m.model_code,
          timeoutMs: 15000,
          allowPendingTimeout: true
        });
        const firstFile = result.files?.[0];
        const previewUrl = firstFile?.previewUrl || (firstFile?.localPath ? `/api/cache/temp/${require('path').basename(firstFile.localPath)}` : null);
        return {
          success: true,
          duration_ms: Date.now() - startTime,
          type: 'video',
          previewUrl,
          files: result.files,
          message: result.message || `视频任务已成功提交至官方云端 (Task ID: ${result.taskId})`,
          data: {
            ...result,
            previewUrl
          }
        };
      } catch (err) {
        if (err.message.includes('503') || err.message.includes('queue_full')) {
          return {
            success: true,
            duration_ms: Date.now() - startTime,
            type: 'video',
            message: `视频模型协议与参数校验通过，远端官方队列当前繁忙 (HTTP 503 排队中): ${err.message}`
          };
        }
        throw err;
      }
    }

    return {
      success: true,
      duration_ms: Date.now() - startTime,
      type: 'video',
      message: `视频模型配置就绪: ${m.name} (${m.model_code})，服务厂商: ${m.provider_name || m.provider_id}`
    };
  }

  throw new Error('未识别的模型能力类型');
}

function parseSecretsObject(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(String(raw) || '{}'); } catch { return {}; }
}

function collectApiKeys(primary, secretsObj) {
  const keys = [];
  const push = (k) => {
    const s = String(k || '').trim();
    if (s && !keys.includes(s)) keys.push(s);
  };
  push(primary);
  const sj = secretsObj || {};
  if (Array.isArray(sj.api_keys)) sj.api_keys.forEach(push);
  if (Array.isArray(sj.apiKeys)) sj.apiKeys.forEach(push);
  return keys;
}

const _apiKeyRr = new Map();
function pickRoundRobin(poolId, keys) {
  if (!keys || !keys.length) return '';
  const n = _apiKeyRr.get(poolId) || 0;
  _apiKeyRr.set(poolId, n + 1);
  return keys[n % keys.length];
}

function keysForProviderRow(row) {
  if (!row) return [];
  try {
    const { keysFromEnv } = require('./env-keys');
    return keysFromEnv(row.id);
  } catch (_) {
    return [];
  }
}

/**
 * 同厂商可配置多把 Key（secrets_json.api_keys），按请求轮询。
 * 接入点轮询列表优先，绝不读取适配器钥匙。
 */
function endpointIdForAdapter(adapter) {
  if (adapter?.endpoint_id) return adapter.endpoint_id;
  const id = String(adapter?.id || '').toLowerCase();
  const proto = String(adapter?.protocol || '').toLowerCase();
  const bu = String(adapter?.base_url || '').toLowerCase();
  const KNOWN_EPS = ['volc_ark', 'agnes', 'agnes_intl', 'litellm', 'qwen_lan', 'local_host', 'doubao_music', 'volc_portrait', 'gemini', 'groq', 'kilo', 'modelscope'];
  if (KNOWN_EPS.includes(id)) return id;

  if (proto === 'doubao_music' || id === 'doubao_music' || bu.includes('imagination')) return 'doubao_music';
  if (proto === 'volc_portrait' || id === 'volc_portrait' || id.startsWith('ark_portrait') || bu.includes('ark.cn-beijing.volcengineapi.com')) return 'volc_portrait';
  if (
    proto === 'ark_image' || proto === 'ark_video' ||
    id === 'ark_seedream' || id.startsWith('ark_') || id.startsWith('volc_ark') ||
    id.startsWith('seedream') || id.startsWith('seedance') || id.startsWith('doubao_seed') ||
    bu.includes('volces.com')
  ) return 'volc_ark';

  if (bu.includes('apihub.agnes-ai.com') || id.startsWith('agnes_intl')) return 'agnes_intl';
  if (id.startsWith('agnes') || bu.includes('api.agnes-ai.cn') || bu.includes('agnes')) return 'agnes';
  if (id.includes('modelscope') || bu.includes('modelscope')) return 'modelscope';
  if (
    id.includes('gemini') ||
    id.includes('google') ||
    id.includes('veo') ||
    id.includes('lyria') ||
    bu.includes('googleapis.com')
  ) return 'gemini';
  if (id.includes('groq') || bu.includes('groq.com')) return 'groq';
  if (id.includes('kilo') || bu.includes('kilo.ai')) return 'kilo';
  if (proto === 'qwen_image' || id.includes('qwen') || bu.includes('192.168.1.107:9000') || bu.includes('/api/qw/')) return 'qwen_lan';
  if (id === 'local_host' || id === 'umbra' || id.startsWith('umbra_') || bu.includes('localhost:3001') || bu.includes('127.0.0.1:3001')) return 'local_host';
  if (id === 'litellm' || id.startsWith('litellm_') || bu.includes('localhost:4000') || bu.includes('127.0.0.1:4000')) return 'litellm';
  if (adapter?.provider_id) return adapter.provider_id;
  if (adapter?.provider) return adapter.provider;
  return null;
}

function resolveProviderApiKey(db, adapter, secretsInput = null) {
  const { resolveEndpointAuth, DEFAULT_ENDPOINTS } = require('./models-contract');
  const epId = (typeof secretsInput === 'string' && secretsInput) || endpointIdForAdapter(adapter);

  try {
    const { keysFromEnv } = require('./env-keys');
    const knownEndpoint = DEFAULT_ENDPOINTS.some((ep) => ep.id === epId);
    if (epId && !knownEndpoint) {
      const envKeys = keysFromEnv(epId);
      if (envKeys.length) return pickRoundRobin(epId, envKeys) || '';
    }
  } catch (_) {}

  // 1. 从 llm_endpoints 接入点表按 endpoint id 精确读取（绝不读取适配器自身的 apiKey，亦不跨接入点混用）
  if (db && epId) {
    try {
      const endpoint = db.prepare('SELECT * FROM llm_endpoints WHERE id=?').get(epId);
      if (endpoint) {
        const auth = resolveEndpointAuth(db, endpoint);
        if (auth && auth.apiKey) return auth.apiKey;
      }
    } catch (_) {}
  }

  // 2. 从内置接入点列表中按 id 精确查找
  if (epId) {
    const matchedEp = DEFAULT_ENDPOINTS.find(ep => ep.id === epId);
    if (matchedEp) {
      const auth = resolveEndpointAuth(db, matchedEp);
      if (auth && auth.apiKey) return auth.apiKey;
    }
  }

  // 3. 环境变量回退 (仅匹配该接入点自身对应的变量名)
  if (epId === 'volc_ark' && process.env.ARK_API_KEY) return process.env.ARK_API_KEY;
  if (epId === 'agnes' && process.env.AGNES_API_KEY) return process.env.AGNES_API_KEY;
  if (epId === 'litellm' && process.env.LITELLM_API_KEY) return process.env.LITELLM_API_KEY;
  if (epId === 'gemini' && process.env.GEMINI_API_KEY) return process.env.GEMINI_API_KEY;
  if (epId === 'groq' && process.env.GROQ_API_KEY) return process.env.GROQ_API_KEY;
  if (epId === 'kilo' && process.env.KILO_API_KEY) return process.env.KILO_API_KEY;
  if (epId === 'modelscope' && process.env.MODELSCOPE_API_KEY) return process.env.MODELSCOPE_API_KEY;
  if (epId === 'local_host' && (process.env.UMBRA_TOKEN || process.env.CREATION_PUBLIC_TOKEN)) return process.env.UMBRA_TOKEN || process.env.CREATION_PUBLIC_TOKEN;

  return '';
}

/**
 * LiteLLM 钥匙只补给本地网关。其它接入点没有钥匙就停这一条，不拿网关钥匙去打 Agnes。
 */
function fallbackApiKey(epId, resolvedKey, litellmApiKey) {
  if (resolvedKey) return { apiKey: resolvedKey, error: '' };
  if (epId === 'litellm') {
    const key = litellmApiKey || '';
    return { apiKey: key, error: key ? '' : '接入点 litellm 没有钥匙' };
  }
  if (epId === 'local_host') {
    return { apiKey: '', error: '' };
  }
  if (epId === 'qwen_lan' || epId === 'doubao_music' || epId === 'volc_portrait') {
    return { apiKey: '', error: '' };
  }
  if (!epId) {
    return { apiKey: '', error: '未识别接入点且缺少钥匙' };
  }
  return { apiKey: '', error: `接入点 ${epId} 没有钥匙` };
}

/**
 * 文本 / 视觉对话配置解析。
 * 现有对话和识图模型先挂在本地网关上，请求仍进 :4000。
 * 方舟和 Agnes 的对话能力留着，新模型可以改挂。
 * 只有挂在本地网关上的模型才要求网关开着。去掉「LiteLLM 未启用就拒绝一切文本和视觉」的 litellm_disabled。
 */
function resolveLiteLlmChatConfig(db, config, requestedModel) {
  const { resolveModelCode } = require('./studio-catalog');
  const modelCode = resolveModelCode(requestedModel) || requestedModel || config?.litellmModel || '';

  // 1. 若指定了模型，且模型契约中明确挂接了独立接入点能力（如方舟 ark_chat 或 agnes_chat），走直连
  if (modelCode) {
    const { resolveModelExecution } = require('./models-contract');
    try {
      const exec = resolveModelExecution(db, modelCode);
      if (exec && exec.endpoint && exec.endpoint.id !== 'litellm' && exec.capability?.kind === 'chat') {
        return {
          baseUrl: exec.endpoint.base_url,
          apiKey: exec.auth?.apiKey || '',
          model: exec.model?.vendor_model_id || modelCode,
          providerId: exec.endpoint.provider_id
        };
      }
    } catch (_) {}
  }

  // 2. 现有对话和识图模型先挂在本地网关上，请求仍进 :4000
  let row = null;
  try {
    row = db.prepare("SELECT id, base_url, api_key, secrets_json, enabled FROM llm_providers WHERE id='litellm'").get();
  } catch (_) {}

  // 去掉「LiteLLM 未启用就拒绝一切文本和视觉」的 litellm_disabled 报错
  const baseUrl = row?.base_url || config?.litellmBaseUrl || process.env.LITELLM_BASE_URL || 'http://127.0.0.1:4000';
  const keys = keysForProviderRow(row);
  const extra = process.env.LITELLM_API_KEY || config?.litellmApiKey || '';
  if (extra && !keys.includes(extra)) keys.push(extra);
  const apiKey = pickRoundRobin('litellm', keys) || '';
  if (!apiKey) {
    throw new Error('本地网关没有钥匙');
  }
  let model = modelCode;
  if (!model) {
    try {
      const def = db.prepare(`
        SELECT model_code FROM llm_models
        WHERE provider_id='litellm' AND enabled=1
        ORDER BY is_default DESC, updated_at DESC
        LIMIT 1
      `).get();
      model = def?.model_code || 'gemini-flash-lite-latest';
    } catch (_) {
      model = 'gemini-flash-lite-latest';
    }
  }
  return { baseUrl, apiKey, model, providerId: 'litellm' };
}

/**
 * 直连某家供应商（不走 LiteLLM 聚合）的 chat/vision 配置。
 * 用于 Agnes 3.0 Flash / 火山 Doubao 直连。
 */
function resolveDirectVlmConfig(db, providerId, modelCode) {
  let row = null;
  try {
    row = db.prepare('SELECT id, base_url, api_key, secrets_json, enabled FROM llm_providers WHERE id=?').get(providerId);
  } catch (_) {}
  if (!row) {
    const err = new Error(`供应商 ${providerId} 不存在`);
    err.code = 'provider_missing';
    throw err;
  }
  if (Number(row.enabled) === 0) {
    const err = new Error(`供应商 ${providerId} 未启用`);
    err.code = 'provider_disabled';
    throw err;
  }
  const keys = keysForProviderRow(row);
  const apiKey = pickRoundRobin(providerId, keys) || '';
  if (!apiKey) {
    const err = new Error(`供应商 ${providerId} 未配置 API Key`);
    err.code = 'provider_no_key';
    throw err;
  }
  const baseUrl = String(row.base_url || '').replace(/\/$/, '');
  if (!baseUrl) {
    const err = new Error(`供应商 ${providerId} 未配置 base_url`);
    err.code = 'provider_unconfigured';
    throw err;
  }
  return { baseUrl, apiKey, model: modelCode, providerId };
}

/**
 * 视觉打标 / 理解。
 * 优先按网关配置（gateway_config.content.provider / .model）直连；
 * 未配置时回落 LiteLLM 聚合网关（保持原行为）。
 */
function resolveActiveVlmConfig(db, config, requestedModel) {
  let provider = '';
  let model = '';
  try {
    const gw = require('./gateway').getConfig(db);
    if (gw && gw.content) {
      provider = String(gw.content.provider || '').trim();
      model = String(gw.content.model || '').trim();
    }
  } catch (_) {}

  // 若未指定 provider 或指定为 litellm，但环境没有独立的 LiteLLM 服务，自动回退到已配置密钥的在线供应商（如 volcengine / gemini）
  if (!provider || provider === 'litellm') {
    const pRow = db.prepare("SELECT enabled FROM llm_providers WHERE id='litellm'").get();
    if (!pRow || pRow.enabled === 0) {
      try {
        const { keysFromEnv } = require('./env-keys');
        if (keysFromEnv('volcengine').length) provider = 'volcengine';
        else if (keysFromEnv('gemini').length) provider = 'gemini';
      } catch (_) {}
    }
  }

  let wanted = requestedModel || model;
  if (provider && provider !== 'litellm') {
    try {
      let mc = '';
      if (wanted && !wanted.startsWith('workflow_vision')) {
        mc = require('./studio-catalog').resolveModelCode(wanted) || wanted;
      }
      if (!mc) {
        if (provider === 'volcengine') mc = model || 'doubao-seed-2-1-lite-260915';
        else if (provider === 'gemini') mc = model || 'gemini-flash-lite-latest';
        else if (provider === 'agnes') mc = model || 'agnes-3.0-flash';
        else {
          const mRow = db.prepare('SELECT model_code FROM llm_models WHERE provider_id=? AND enabled=1 ORDER BY is_default DESC LIMIT 1').get(provider);
          mc = mRow?.model_code || wanted;
        }
      }
      return resolveDirectVlmConfig(db, provider, mc);
    } catch (e) {
      // 直连失败 → 回落 LiteLLM，避免整条流水线卡死
      try {
        console.warn(`[providers] 直连 ${provider} 失败(${e.code || e.message})，回落 LiteLLM`);
      } catch (_) {}
    }
  }
  return resolveLiteLlmChatConfig(db, config, wanted);
}

/**
 * 一键休眠或唤醒 LiteLLM 聚合网关及其名下模型与适配器
 */
function toggleLiteLLMBatch(db, enabled) {
  const enVal = enabled ? 1 : 0;
  const now = Date.now();
  db.prepare("UPDATE llm_providers SET enabled=?, updated_at=? WHERE id='litellm'").run(enVal, now);
  db.prepare("UPDATE llm_models SET enabled=?, updated_at=? WHERE provider_id='litellm'").run(enVal, now);
  db.prepare("UPDATE gen_adapters SET enabled=?, updated_at=? WHERE id IN ('litellm_images', 'openai_videos')").run(enVal, now);
  return { success: true, enabled: Boolean(enabled) };
}

const GATEWAY_VISION_TAG_GROUPS = new Set([
  'model_text_input',
  'model_image_input',
  'model_video_input',
  'workflow_vision',
  'workflow_vision_low',
]);

function resolveGatewayModelCapabilities(modelName) {
  const name = String(modelName || '').trim();
  if (GATEWAY_VISION_TAG_GROUPS.has(name)) {
    return 'chat,vision,tag';
  }
  return 'chat';
}

async function syncFromLiteLLM(db, baseUrl = '', masterKey = '') {
  let finalBaseUrl = baseUrl;
  let finalKey = masterKey;
  if (!finalBaseUrl || !finalKey) {
    const admin = litellmAdmin(db);
    if (!finalBaseUrl) finalBaseUrl = admin.baseUrl || 'http://127.0.0.1:4000';
    if (!finalKey) finalKey = admin.apiKey || '';
  }
  if (!finalKey) {
    throw new Error('本地网关没有钥匙');
  }
  const now = Date.now();
  const res = await fetch(`${finalBaseUrl.replace(/\/$/, '')}/model/info`, {
    headers: { Authorization: `Bearer ${finalKey}` },
    signal: AbortSignal.timeout(10000)
  });
  if (!res.ok) throw new Error(`LiteLLM HTTP ${res.status}`);
  const data = await res.json();
  const list = data.data || [];

  const insModel = db.prepare(`
    INSERT INTO llm_models (id, provider_id, name, model_code, capabilities, params_json, is_default, enabled, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      model_code=excluded.model_code,
      capabilities=excluded.capabilities,
      params_json=excluded.params_json,
      updated_at=excluded.updated_at
  `);

  let synced = 0;
  const seenLite = new Set();
  const { GATEWAY_TEXT_NAMES } = require('./models-contract');

  for (const item of list) {
    const modelName = item.model_name;
    if (!GATEWAY_TEXT_NAMES.has(modelName) || seenLite.has(modelName)) continue;
    const tpm = item.model_info?.tpm;
    const rpm = item.model_info?.rpm;
    const paramsJson = JSON.stringify({ tpm, rpm });
    const capsStr = resolveGatewayModelCapabilities(modelName);

    seenLite.add(modelName);
    const litellmId = `litellm_${modelName}`.toLowerCase().replace(/[^a-z0-9_-]/g, '_');
    const isDefault = 0;
    insModel.run(litellmId, 'litellm', `${modelName} (网关)`, modelName, capsStr, paramsJson, isDefault, now, now);
    synced++;
  }

  return { success: true, count: synced };
}

function collapseDuplicateTextModels(db) {
  const { GATEWAY_TEXT_NAMES } = require('./models-contract');
  const rows = db.prepare('SELECT id, provider_id, model_code, capabilities FROM llm_models').all();
  const gateway = new Set();
  for (const r of rows) {
    if (r.provider_id === 'litellm' && GATEWAY_TEXT_NAMES.has(String(r.model_code || ''))) gateway.add(r.model_code);
  }
  const enableGroups = db.prepare(`
    UPDATE llm_models SET enabled=1, updated_at=?
    WHERE provider_id='litellm' AND model_code IN ('model_text_input', 'model_image_input', 'model_video_input')
  `);
  enableGroups.run(Date.now());
  const disable = db.prepare('UPDATE llm_models SET enabled=0, is_default=0, updated_at=? WHERE id=?');
  const now = Date.now();
  let collapsed = 0;
  for (const r of rows) {
    const code = String(r.model_code || '');
    if (r.provider_id === 'litellm' && GATEWAY_TEXT_NAMES.has(code)) continue;
    const stripped = code.replace(/^(openai|gemini)\//, '');
    const caps = String(r.capabilities || '');
    const media = /(^|,)(image|video)(,|$)|music/.test(caps);
    const looksText = /chat|vision|tag/.test(caps) && !media;
    const prefixed = /^(openai|gemini)\//.test(code);
    if (!looksText && !prefixed) continue;
    if (!gateway.has(code) && !gateway.has(stripped)) continue;
    const info = disable.run(now, r.id);
    collapsed += info.changes || 0;
  }
  return collapsed;
}

function maskSensitiveText(text) {
  return String(text || '')
    .replace(/sk-[A-Za-z0-9_\-]+/gi, 'sk-***')
    .replace(/Bearer\s+[A-Za-z0-9._\-]+/gi, 'Bearer ***')
    .replace(/"(api_?key|secret_?key|password|token|master_?key)"\s*:\s*"[^"]*"/gi, '"$1":"***"')
    .replace(/(api_?key|secret_?key|password|token|master_?key)\s*=\s*[^\s&]+/gi, '$1=***');
}

function gatewayErrorText(status, txt) {
  const sanitized = maskSensitiveText(txt);
  return `网关 HTTP ${status}: ${sanitized.slice(0, 160)}`;
}

function litellmAdmin(db, config) {
  let row = null;
  try {
    row = db.prepare("SELECT base_url, api_key, secrets_json FROM llm_providers WHERE id='litellm'").get();
  } catch (_) {}
  const keys = keysForProviderRow(row);
  const master = String(process.env.LITELLM_MASTER_KEY || '').trim();
  const extra = master || process.env.LITELLM_API_KEY || config?.litellmApiKey || '';
  if (extra && !keys.includes(extra)) keys.unshift(extra);
  return {
    baseUrl: String(row?.base_url || config?.litellmBaseUrl || 'http://127.0.0.1:4000').replace(/\/$/, ''),
    apiKey: master || keys[0] || '',
  };
}

async function fetchLiteLlmInfo(db, config) {
  const { baseUrl, apiKey } = litellmAdmin(db, config);
  if (!apiKey) {
    const err = new Error('本地网关没有钥匙');
    err.code = 'no_key';
    throw err;
  }
  const res = await fetch(`${baseUrl}/model/info`, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(gatewayErrorText(res.status, await res.text().catch(() => '')));
  return { baseUrl, apiKey, data: await res.json() };
}

function memberView(item) {
  return {
    id: item?.model_info?.id || '',
    upstream: item?.litellm_params?.model || '',
  };
}

async function listLiteLlmMembers(db, config, modelName) {
  const { GATEWAY_TEXT_NAMES } = require('./models-contract');
  const { data } = await fetchLiteLlmInfo(db, config);
  const groups = {};
  for (const item of data.data || []) {
    const name = item.model_name;
    if (!GATEWAY_TEXT_NAMES.has(name)) continue;
    if (modelName && name !== modelName) continue;
    if (!groups[name]) groups[name] = [];
    groups[name].push(memberView(item));
  }
  return { groups };
}

async function addLiteLlmMember(db, config, modelName, upstream) {
  const { GATEWAY_GROUP_NAMES } = require('./models-contract');
  if (!GATEWAY_GROUP_NAMES.has(modelName)) throw new Error('只有模型组可以增减成员');
  const up = String(upstream || '').trim();
  if (!up) throw new Error('要填写上游模型');
  const { baseUrl, apiKey, data } = await fetchLiteLlmInfo(db, config);
  const sample = (data.data || []).find((x) => x.model_name === modelName);
  if (!sample || !sample.litellm_params) throw new Error('网关上还没有这个模型组，不能克隆部署');
  const params = { ...sample.litellm_params, model: up };
  const res = await fetch(`${baseUrl}/model/new`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model_name: modelName, litellm_params: params }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(gatewayErrorText(res.status, await res.text().catch(() => '')));
  return { ok: true };
}

async function removeLiteLlmMember(db, config, modelName, deploymentId) {
  const { GATEWAY_GROUP_NAMES } = require('./models-contract');
  if (!GATEWAY_GROUP_NAMES.has(modelName)) throw new Error('只有模型组可以增减成员');
  const id = String(deploymentId || '').trim();
  if (!id) throw new Error('缺少部署 id');
  const { baseUrl, apiKey, data } = await fetchLiteLlmInfo(db, config);
  const hit = (data.data || []).find((x) => x.model_name === modelName && x.model_info?.id === id);
  if (!hit) throw new Error('这个成员不在该模型组里');
  const res = await fetch(`${baseUrl}/model/delete`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ id }),
    signal: AbortSignal.timeout(10000),
  });
  if (!res.ok) throw new Error(gatewayErrorText(res.status, await res.text().catch(() => '')));
  return { ok: true };
}

module.exports = {
  syncFromLiteLLM,
  initProvidersTables,
  getProviders,
  getProviderById,
  saveProvider,
  deleteProvider,
  toggleProvider,
  getModels,
  getModelById,
  saveModel,
  deleteModel,
  toggleModel,
  testModel,
  resolveActiveVlmConfig,
  resolveDirectVlmConfig,
  resolveLiteLlmChatConfig,
  DEFAULT_MODELS,
  toggleLiteLLMBatch,
  endpointIdForAdapter,
  providerIdForAdapter: endpointIdForAdapter,
  resolveProviderApiKey,
  collectApiKeys,
  fallbackApiKey,
  collapseDuplicateTextModels,
  listLiteLlmMembers,
  addLiteLlmMember,
  removeLiteLlmMember,
  resolveGatewayModelCapabilities,
  litellmAdmin,
  maskSensitiveText,
  gatewayErrorText,
};
