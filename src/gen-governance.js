/**
 * 生成模型治理：官方 polish + DB 覆盖；作业绑定表。
 */
const fs = require('fs')
const path = require('path')
const { OFFICIAL_STUDIO, resolveModelCode, officialOf } = require('./studio-catalog')
const { MODEL_SCHEMAS, schemaFor } = require('./model-schemas')
const { officialPolish } = require('./polish-prompts')
const { GATE_PROMPT, RESTAGE_PROMPT } = require('./nodes/catalog')
const { safeInstallAdapter } = require('./gen/adapters')

const NODE_JOB = {
  restage_dual: 'restage',
  restage_9_16: 'restage',
  gate: 'gate',
  tag: 'tag',
  tag_furniture: 'tag_furniture',
  clean: 'watermark',
  index: 'index',
}

const STALE_VLM_IDS = new Set([
  'image_agnes_vision',
  'image_agnes_vision_2',
  'model_image_input',
  'image_doubao_vision',
  'litellm_image_agnes_vision',
])

/**
 * 无人值守视觉作业只打免费别名 workflow_vision。
 * 原名（gemini-flash-lite-latest 等）仍可手选；交互对话默认仍是目录 chat.defaultModel。
 * 高优先组满时由 vlm.chatVision 改打 workflow_vision_low，不在这里写死 31B。
 */
const DEFAULT_VLM_ID = 'workflow_vision'
const VLM_JOBS = new Set(['gate', 'tag', 'tag_furniture'])

/**
 * 后台自动化生图的模型 = 官方目录里 image 域第一个免费档模型。
 * 铁律：无人值守流程严禁消耗付费额度，因此这里不允许写死任何具体 model id ——
 * 换成别的免费模型时，只改 `studio-catalog.js` 的 `caps.freeTier` 即可。
 */
function freeImageModelId() {
  const list = (OFFICIAL_STUDIO.image && OFFICIAL_STUDIO.image.models) || []
  const hit = list.find((m) => m.caps && m.caps.freeTier)
  return (hit && hit.id) || OFFICIAL_STUDIO.image.defaultModel
}

/**
 * ★「用户可手动选的模型池」= 官方目录 image 域的全部模型 id。
 *
 * 为什么要单独一个函数（而不是复用 capable）：
 *   - `capable` 是**调度通道**口径（umbra.expand / unified_gateway / local-4x…），
 *     它是服务端内部流水线节点，客户端拿它做下拉会显示一堆用户看不懂的通道名；
 *   - 用户要选的是「用哪个生图模型干活」，所以下拉必须给真实模型 id。
 * 因此每个「可交互」作业都带 `selectable: 'image'`，治理台据此渲染可选模型多选。
 */
function selectableModelIds(domain) {
  const list = (OFFICIAL_STUDIO[domain] && OFFICIAL_STUDIO[domain].models) || []
  return list.map((m) => m.id)
}

/** 治理台/客户端展示用的模型明细（带 label 与免费标记） */
function selectableModels(domain) {
  const list = (OFFICIAL_STUDIO[domain] && OFFICIAL_STUDIO[domain].models) || []
  return list.map((m) => ({
    id: m.id,
    name: m.name,
    model_code: m.model_code,
    provider: m.provider,
    free: Boolean(m.caps && m.caps.freeTier),
  }))
}

const DEFAULT_JOBS = [
  {
    job_id: 'expand',
    label: '扩图',
    group: 'quick',
    model_id: 'umbra.expand',
    params: { expand_ratio: '16:9' },
    fields: [
      { key: 'expand_ratio', label: '目标画幅', type: 'enum', options: ['16:9', '9:16', '1:1', '4:3', '3:4'], default: '16:9' },
      { key: 'seed', label: '种子', type: 'number', min: -1, max: 2147483647, default: -1 },
    ],
    capable: ['umbra.expand'],
    selectable: 'image',
    allow_models: selectableModelIds('image'),
  },
  {
    job_id: 'watermark',
    label: '去水印',
    group: 'quick',
    model_id: 'unified_gateway',
    params: {},
    fields: [],
    capable: ['unified_gateway', 'umbra.remove'],
    selectable: 'image',
    allow_models: selectableModelIds('image'),
  },
  {
    job_id: 'enhance',
    label: '清晰度',
    group: 'quick',
    model_id: 'local-4x',
    params: { scale: 4 },
    fields: [{ key: 'scale', label: '倍率', type: 'enum', options: [2, 4], default: 4 }],
    capable: ['local-4x', 'umbra.upscale'],
    selectable: 'image',
    allow_models: selectableModelIds('image'),
  },
  {
    job_id: 'insert',
    label: '精准·增',
    group: 'quick',
    model_id: 'umbra.insert',
    params: {},
    fields: [{ key: 'prompt', label: '描述', type: 'text', default: '' }],
    capable: ['umbra.insert'],
    selectable: 'image',
    allow_models: selectableModelIds('image'),
  },
  {
    job_id: 'remove',
    label: '精准·删',
    group: 'quick',
    model_id: 'umbra.remove',
    params: {},
    fields: [],
    capable: ['umbra.remove'],
    selectable: 'image',
    allow_models: selectableModelIds('image'),
  },
  {
    job_id: 'replace',
    label: '精准·改',
    group: 'quick',
    model_id: 'umbra.replace',
    params: {},
    fields: [{ key: 'prompt', label: '描述', type: 'text', default: '' }],
    capable: ['umbra.replace'],
    selectable: 'image',
    allow_models: selectableModelIds('image'),
  },
  {
    // ★ 补齐：风格转换此前完全没有作业定义 —— 治理台看不到、客户端也拿不到默认模型，
    //   而 edit-run 的 style_transfer 又不读opts.model，导致「风格转换换模型」整条链断掉。
    job_id: 'style_transfer',
    label: '风格转换',
    group: 'quick',
    model_id: OFFICIAL_STUDIO.image.defaultModel,
    params: { strengthLevel: 'standard' },
    fields: [{ key: 'strengthLevel', label: '重构深度', type: 'enum', options: ['light', 'standard', 'deep'], default: 'standard' }],
    capable: 'image',
    selectable: 'image',
    allow_models: selectableModelIds('image'),
  },
  {
    // ★ 补齐：清晰度在「快捷操作」里是 enhance（本地 4x），但 H5/App 编辑页还有一个
    //   云端重绘的 clarity op，此前同样没有作业定义。
    job_id: 'clarity',
    label: '超分增强',
    group: 'quick',
    model_id: OFFICIAL_STUDIO.image.defaultModel,
    params: {},
    fields: [],
    capable: 'image',
    selectable: 'image',
    allow_models: selectableModelIds('image'),
  },
  {
    job_id: 'space',
    label: '留白',
    group: 'quick',
    model_id: OFFICIAL_STUDIO.image.defaultModel,
    params: {},
    fields: [{ key: 'gapPct', label: '间隙占比', type: 'number', min: 0, max: 80, default: 18 }],
    capable: 'image',
    selectable: 'image',
    allow_models: selectableModelIds('image'),
  },
  {
    job_id: 'add',
    label: '精准·加',
    group: 'quick',
    model_id: OFFICIAL_STUDIO.image.defaultModel,
    params: {},
    fields: [{ key: 'prompt', label: '描述', type: 'text', default: '' }],
    capable: 'image',
    selectable: 'image',
    allow_models: selectableModelIds('image'),
  },
  {
    job_id: 'restage',
    label: 'AI 画幅重构',
    group: 'pipeline',
    model_id: freeImageModelId(),
    params: { ratios: ['9:16', '3:4'], sizePreset: '1080p', promptTemplate: RESTAGE_PROMPT },
    fields: [
      { key: 'ratios', label: '目标画幅', type: 'enum', options: ['9:16', '3:4', '16:9', '1:1'] },
      { key: 'sizePreset', label: '尺寸档', type: 'enum', options: ['1080p', '2K'], default: '1080p' },
      { key: 'promptTemplate', label: '重构提示', type: 'text', default: RESTAGE_PROMPT },
    ],
    capable: 'image',
    selectable: 'image',
    allow_models: [],
  },
  {
    job_id: 'gate',
    label: '室内闸门',
    group: 'pipeline',
    model_id: DEFAULT_VLM_ID,
    params: { promptTemplate: GATE_PROMPT },
    fields: [{ key: 'promptTemplate', label: '闸门提示', type: 'text', default: GATE_PROMPT }],
    capable: 'vision',
    allow_models: [],
  },
  {
    job_id: 'tag',
    label: '空间打标',
    group: 'pipeline',
    model_id: DEFAULT_VLM_ID,
    params: { skipCluster: true, phashThreshold: 5 },
    fields: [
      { key: 'skipCluster', label: '跳过单品', type: 'bool', default: true },
      { key: 'phashThreshold', label: 'pHash 阈值', type: 'number', min: 1, max: 16, default: 5 },
    ],
    capable: 'vision',
    allow_models: [],
  },
  {
    job_id: 'tag_furniture',
    label: '单品打标',
    group: 'pipeline',
    model_id: DEFAULT_VLM_ID,
    params: { skipCluster: true, phashThreshold: 5 },
    fields: [{ key: 'phashThreshold', label: 'pHash 阈值', type: 'number', min: 1, max: 16, default: 5 }],
    capable: 'vision',
    allow_models: [],
  },
  {
    job_id: 'index',
    label: '向量入库',
    group: 'pipeline',
    model_id: 'text-embedding-3-small',
    params: { embeddingProvider: 'litellm', embeddingModel: 'text-embedding-3-small' },
    fields: [{ key: 'embeddingModel', label: '向量模型', type: 'text', default: 'text-embedding-3-small' }],
    capable: ['text-embedding-3-small'],
    allow_models: [],
  },
  {
    job_id: 'prompt_optimize',
    label: '提示词优化器',
    group: 'optimize',
    // 默认优化器 = 官方目录里 chat 域的默认模型（改默认只改 studio-catalog.js）
    model_id: OFFICIAL_STUDIO.chat.defaultModel,
    params: { temperature: 0.4, timeoutMs: 90000 },
    fields: [
      { key: 'temperature', label: '温度', type: 'number', min: 0, max: 1, default: 0.4 },
      { key: 'timeoutMs', label: '超时 ms', type: 'number', min: 2000, max: 120000, default: 90000 },
    ],
    capable: 'chat',
    selectable: 'chat',
    allow_models: [],
  },
]

function ensureGenGovernanceSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS gen_polish_prompts (
      model_id TEXT PRIMARY KEY,
      prompt TEXT NOT NULL,
      optimizer_model_id TEXT,
      actor TEXT,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS gen_job_bindings (
      job_id TEXT PRIMARY KEY,
      model_id TEXT NOT NULL,
      params_json TEXT NOT NULL,
      allow_models_json TEXT,
      fields_json TEXT NOT NULL,
      actor TEXT,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS gen_model_custom_schemas (
      model_id TEXT PRIMARY KEY,
      custom_fields_json TEXT NOT NULL,
      custom_config_json TEXT,
      actor TEXT,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS gen_skill_drafts (
      id TEXT PRIMARY KEY,
      model_id TEXT NOT NULL,
      model_code TEXT NOT NULL,
      domain TEXT NOT NULL,
      doc_urls_json TEXT,
      schema_draft_json TEXT,
      polish_draft TEXT,
      skill_content TEXT,
      status TEXT DEFAULT 'pending',
      actor TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `)
}

function specOf(jobId) {
  return DEFAULT_JOBS.find((j) => j.job_id === jobId) || null
}

function parseJson(s, fallback) {
  try {
    return JSON.parse(s)
  } catch {
    return fallback
  }
}

function capableModels(job) {
  if (Array.isArray(job.capable)) return job.capable.map((id) => ({ id, name: id }))
  if (job.capable === 'image') {
    return (OFFICIAL_STUDIO.image.models || []).map((m) => ({ id: m.id, name: m.name }))
  }
  const chat = OFFICIAL_STUDIO.chat.models || []
  if (job.capable === 'vision') {
    return chat
      .filter((m) => String(m.capabilities || '').includes('vision') || String(m.capabilities || '').includes('tag'))
      .map((m) => ({ id: m.id, name: m.name }))
  }
  if (job.capable === 'chat') {
    return chat.map((m) => ({ id: m.id, name: m.name }))
  }
  return []
}

/**
 * 该作业「用户可手动选择」的真实模型清单（不含调度通道）。
 * - job.selectable 是域名字符串（'image' / 'chat'）→ 取该域全部模型；
 * - 治理台保存过allow_models → 以保存值为准（治理台是权威源）。
 * 返回 null 表示该作业不支持用户换模型（例如无人值守流水线作业）。
 */
function userSelectableModels(job, savedAllow) {
  const domain = typeof job.selectable === 'string' ? job.selectable : null
  const all = domain ? selectableModels(domain) : []
  if (!all.length) return null
  if (Array.isArray(savedAllow) && savedAllow.length) {
    const allowed = new Set(savedAllow.map((x) => String(x)))
    const filtered = all.filter((m) => allowed.has(m.id))
    // 治理台把池子清空/ 配错成不可用值时，回落到全量而不是给用户一个空下拉
    return filtered.length ? filtered : all
  }
  return all
}

function remapStaleVlm(db, jobId, modelId) {
  if (!VLM_JOBS.has(jobId)) return modelId
  if (!STALE_VLM_IDS.has(String(modelId || ''))) return modelId
  const now = Date.now()
  try {
    db.prepare(`
      UPDATE gen_job_bindings SET model_id=?, actor='remap_stale_vlm', updated_at=?
      WHERE job_id=? AND model_id=?
    `).run(DEFAULT_VLM_ID, now, jobId, modelId)
  } catch (_) {}
  return DEFAULT_VLM_ID
}

function isModelDisabled(modelId) {
  if (!modelId) return true;
  for (const dom of Object.values(OFFICIAL_STUDIO)) {
    for (const m of (dom.models || [])) {
      if ((m.id === modelId || m.model_code === modelId) && m.disabled) {
        return true;
      }
    }
  }
  return false;
}

function getJobBinding(db, jobId) {
  ensureGenGovernanceSchema(db)
  const spec = specOf(jobId)
  if (!spec) return null
  const row = db.prepare('SELECT * FROM gen_job_bindings WHERE job_id=?').get(jobId)
  const capable = capableModels(spec)
  const fallbackModel = () => {
    // 1. 该作业在代码里的 spec.model_id，且该模型仍启用
    if (spec.model_id && !isModelDisabled(spec.model_id)) return spec.model_id;
    // 2. 否则用该作业所属域里第一个仍启用的模型
    const firstEnabled = capable.find((c) => !isModelDisabled(c.id));
    if (firstEnabled) return firstEnabled.id;
    // 3. 域对不上时才用 OFFICIAL_STUDIO.chat.defaultModel
    return OFFICIAL_STUDIO.chat.defaultModel;
  };

  if (!row) {
    const rawModelId = spec.model_id;
    const modelId = isModelDisabled(rawModelId) ? fallbackModel() : rawModelId;
    if (modelId && !capable.some((c) => c.id === modelId)) {
      capable.unshift({ id: modelId, name: `${modelId}（当前）` })
    }
    return {
      job_id: spec.job_id,
      label: spec.label,
      group: spec.group,
      model_id: modelId,
      params: spec.params,
      fields: spec.fields,
      allow_models: spec.allow_models || [],
      capable,
      selectable: userSelectableModels(spec, spec.allow_models),
      source: 'official',
    }
  }
  const rawModelId = remapStaleVlm(db, jobId, row.model_id || spec.model_id)
  const modelId = isModelDisabled(rawModelId) ? fallbackModel() : rawModelId;
  if (modelId && !capable.some((c) => c.id === modelId)) {
    capable.unshift({ id: modelId, name: `${modelId}（当前）` })
  }
  return {
    job_id: spec.job_id,
    label: spec.label,
    group: spec.group,
    model_id: modelId,
    params: parseJson(row.params_json, spec.params),
    fields: parseJson(row.fields_json, spec.fields),
    allow_models: parseJson(row.allow_models_json, spec.allow_models || []),
    capable,
    selectable: userSelectableModels(spec, parseJson(row.allow_models_json, spec.allow_models || [])),
    source: 'override',
    actor: row.actor,
    updated_at: row.updated_at,
  }
}

function listJobBindings(db) {
  ensureGenGovernanceSchema(db)
  return DEFAULT_JOBS.map((j) => getJobBinding(db, j.job_id))
}

function saveJobBinding(db, jobId, body, actor) {
  ensureGenGovernanceSchema(db)
  const spec = specOf(jobId)
  if (!spec) throw new Error(`未知作业: ${jobId}`)
  const model_id = String(body.model_id || spec.model_id)
  const params = body.params && typeof body.params === 'object' ? body.params : spec.params
  const allow = Array.isArray(body.allow_models) ? body.allow_models : spec.allow_models || []
  const fields = Array.isArray(body.fields) ? body.fields : spec.fields
  const now = Date.now()
  db.prepare(`
    INSERT INTO gen_job_bindings (job_id, model_id, params_json, allow_models_json, fields_json, actor, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(job_id) DO UPDATE SET
      model_id=excluded.model_id,
      params_json=excluded.params_json,
      allow_models_json=excluded.allow_models_json,
      fields_json=excluded.fields_json,
      actor=excluded.actor,
      updated_at=excluded.updated_at
  `).run(jobId, model_id, JSON.stringify(params), JSON.stringify(allow), JSON.stringify(fields), actor || '', now)
  return getJobBinding(db, jobId)
}

function resetJobBinding(db, jobId, actor) {
  ensureGenGovernanceSchema(db)
  db.prepare('DELETE FROM gen_job_bindings WHERE job_id=?').run(jobId)
  return getJobBinding(db, jobId)
}

function polishFor(db, modelId) {
  ensureGenGovernanceSchema(db)
  const official = officialPolish(modelId)
  const row = db.prepare('SELECT * FROM gen_polish_prompts WHERE model_id=?').get(modelId)
  return {
    model_id: modelId,
    prompt: (row && row.prompt) || official || '',
    polishSource: row ? 'override' : 'official',
    optimizer_model_id: (row && row.optimizer_model_id) || '',
    hasOfficial: !!official,
  }
}

function getCustomSchema(db, modelId) {
  ensureGenGovernanceSchema(db)
  const row = db.prepare('SELECT * FROM gen_model_custom_schemas WHERE model_id=?').get(modelId)
  if (!row) return { custom_fields: [], custom_config: null }
  return {
    custom_fields: parseJson(row.custom_fields_json, []),
    custom_config: parseJson(row.custom_config_json, null)
  }
}

function saveCustomFields(db, modelId, fields, actor) {
  ensureGenGovernanceSchema(db)
  const arr = Array.isArray(fields) ? fields : []
  const now = Date.now()
  db.prepare(`
    INSERT INTO gen_model_custom_schemas (model_id, custom_fields_json, custom_config_json, actor, updated_at)
    VALUES (?, ?, NULL, ?, ?)
    ON CONFLICT(model_id) DO UPDATE SET
      custom_fields_json=excluded.custom_fields_json,
      actor=excluded.actor,
      updated_at=excluded.updated_at
  `).run(modelId, JSON.stringify(arr), actor || '', now)
  return getCustomSchema(db, modelId)
}

function createCustomModel(db, body, actor) {
  ensureGenGovernanceSchema(db)
  const id = String(body.id || `custom_${Date.now()}`).trim()
  const name = String(body.name || id).trim()
  const domain = String(body.domain || 'image').trim()
  const customConfig = {
    id,
    name,
    domain,
    model_code: body.model_code || id,
    provider: body.provider || 'custom',
    providerName: body.providerName || body.provider || '自定义',
    protocol: body.protocol || 'http_json',
    base_url: body.base_url || '',
    config_json: body.config_json || {},
    modes: body.modes || [{ id: 'text_to_image', label: '文生图' }]
  }
  const customFields = Array.isArray(body.fields) ? body.fields : []
  const now = Date.now()
  db.prepare(`
    INSERT INTO gen_model_custom_schemas (model_id, custom_fields_json, custom_config_json, actor, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(model_id) DO UPDATE SET
      custom_fields_json=excluded.custom_fields_json,
      custom_config_json=excluded.custom_config_json,
      actor=excluded.actor,
      updated_at=excluded.updated_at
  `).run(id, JSON.stringify(customFields), JSON.stringify(customConfig), actor || '', now)

  if (body.polishPrompt) {
    savePolish(db, id, { prompt: body.polishPrompt, optimizer_model_id: body.optimizer_model_id }, actor)
  }
  return customConfig
}

function deleteCustomModel(db, modelId, actor) {
  ensureGenGovernanceSchema(db)
  db.prepare('DELETE FROM gen_model_custom_schemas WHERE model_id=?').run(modelId)
  db.prepare('DELETE FROM gen_polish_prompts WHERE model_id=?').run(modelId)
  return { success: true, deleted: modelId }
}

function listGenModels(db) {
  ensureGenGovernanceSchema(db)
  const domains = ['image', 'video', 'music', 'portrait', 'chat']
  const out = {}
  for (const d of domains) {
    const block = OFFICIAL_STUDIO[d] || { models: [] }
    if (d === 'chat') {
      out.chat = (block.models || []).map((m) => ({
        id: m.id,
        name: m.name,
        model_code: m.model_code,
        provider: m.provider,
        providerName: m.providerName,
        badge: m.badge || '',
        default: m.id === block.defaultModel,
        disabled: Boolean(m.disabled),
        enabled: !m.disabled
      }))
      continue
    }
    out[d] = (block.models || []).map((om) => {
      let schema = MODEL_SCHEMAS[om.id] ? JSON.parse(JSON.stringify(MODEL_SCHEMAS[om.id])) : null
      const cs = getCustomSchema(db, om.id)
      if (schema && cs.custom_fields && cs.custom_fields.length > 0) {
        schema.custom = cs.custom_fields
        const existingKeys = new Set((schema.advanced || []).map(f => f.key).concat((schema.common || []).map(f => f.key)))
        for (const cf of cs.custom_fields) {
          if (!existingKeys.has(cf.key)) {
            schema.advanced = (schema.advanced || []).concat(cf)
            existingKeys.add(cf.key)
          }
        }
      }
      const p = polishFor(db, om.id)
      return {
        id: om.id,
        name: om.name,
        model_code: om.model_code,
        provider: om.provider,
        providerName: om.providerName,
        badge: om.badge || '',
        default: om.id === block.defaultModel,
        disabled: Boolean(om.disabled),
        enabled: !om.disabled,
        free: (schema && schema.free) || om.free || null,
        // ★ 能力描述符：治理台与管线 A/B 共用同一份真相
        caps: om.caps || null,
        regionKind: om.caps && om.caps.region ? om.caps.region.kind : null,
        schema,
        custom_fields: cs.custom_fields || [],
        polishHint: (schema && schema.polishHint) || '',
        polishPrompt: p.prompt,
        polishSource: p.polishSource,
        optimizer_model_id: p.optimizer_model_id,
        portraitAlias: d === 'image' && ['seedream5flash', 'seedream5pro', 'agnes_image_2_5_flash'].includes(om.id),
      }
    })
  }

  // 补入自定义注册模型
  const customRows = db.prepare("SELECT * FROM gen_model_custom_schemas WHERE custom_config_json IS NOT NULL").all()
  for (const r of customRows) {
    const cfg = parseJson(r.custom_config_json, null)
    if (!cfg) continue
    const dom = cfg.domain || 'image'
    const cFields = parseJson(r.custom_fields_json, [])
    const p = polishFor(db, cfg.id)
    const isCustomEnabled = cfg.enabled !== false && cfg.enabled !== 0
    const customSchema = {
      polishId: cfg.id,
      refStyle: 'generic',
      modes: cfg.modes || [{ id: 'default', label: '默认模式' }],
      common: cFields.slice(0, 3),
      advanced: cFields.slice(3),
      slots: { images: 4, videos: 0, audios: 0 }
    }
    if (!out[dom]) out[dom] = []
    out[dom].push({
      id: cfg.id,
      name: cfg.name,
      model_code: cfg.model_code,
      provider: cfg.provider,
      providerName: cfg.providerName,
      badge: '自定义',
      default: false,
      isCustom: true,
      disabled: !isCustomEnabled,
      enabled: isCustomEnabled,
      protocol: cfg.protocol,
      base_url: cfg.base_url,
      schema: customSchema,
      custom_fields: cFields,
      polishPrompt: p.prompt || '',
      polishSource: p.polishSource,
      optimizer_model_id: p.optimizer_model_id
    })
  }

  return out
}

function savePolish(db, modelId, { prompt, optimizer_model_id }, actor) {
  ensureGenGovernanceSchema(db)
  const isCustom = db.prepare('SELECT 1 FROM gen_model_custom_schemas WHERE model_id=?').get(modelId)
  if (!officialPolish(modelId) && !MODEL_SCHEMAS[modelId] && !isCustom) throw new Error(`未知生成模型: ${modelId}`)
  const text = String(prompt || '').trim()
  if (!text) throw new Error('系统提示词不能为空')
  const now = Date.now()
  const opt = optimizer_model_id != null ? String(optimizer_model_id) : ''
  db.prepare(`
    INSERT INTO gen_polish_prompts (model_id, prompt, optimizer_model_id, actor, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(model_id) DO UPDATE SET
      prompt=excluded.prompt,
      optimizer_model_id=excluded.optimizer_model_id,
      actor=excluded.actor,
      updated_at=excluded.updated_at
  `).run(modelId, text, opt, actor || '', now)
  return polishFor(db, modelId)
}

function resetPolish(db, modelId) {
  ensureGenGovernanceSchema(db)
  db.prepare('DELETE FROM gen_polish_prompts WHERE model_id=?').run(modelId)
  return polishFor(db, modelId)
}

function resolveOptimizerModel(db, genModelId) {
  const polish = polishFor(db, genModelId)
  const job = getJobBinding(db, 'prompt_optimize')
  const id = polish.optimizer_model_id || (job && job.model_id) || 'agnes3_0flash'
  const code = resolveModelCode(id) || id
  const params = (job && job.params) || {}
  return {
    modelId: id,
    modelCode: code,
    temperature: params.temperature != null ? Number(params.temperature) : 0.4,
    timeoutMs: params.timeoutMs != null ? Number(params.timeoutMs) : 90000,
  }
}

/**
 * 解析「后台视觉/标注作业」实际要调的模型。
 * 顺序：作业绑定表（可用治理台改）→ 目录 chat 默认。
 * 绑定表里的 id 会自动经 officialOf 归一成当前有效的 model_code，
 * 因此即便表里存着旧 id 也不会打到死端点上。
 */
function resolveVlmModel(db) {
  let job = null
  try {
    job = getJobBinding(db, 'tag') || getJobBinding(db, 'gate') || null
  } catch (_) {}
  const id = (job && job.model_id) || DEFAULT_VLM_ID
  const hit = officialOf(id) || officialOf(DEFAULT_VLM_ID)
  return {
    modelId: hit ? hit.model.id : id,
    modelCode: hit ? hit.model.model_code : (resolveModelCode(id) || id),
    source: job && job.model_id ? 'job_binding' : 'catalog_default',
    jobId: (job && job.job_id) || null,
  }
}

/**
 * 解析调用该模型所需的 OpenAI 兼容网关地址与 Key。
 * 复用 providers 的 LiteLLM 解析，避免在这里再抄一份 provider 表。
 */
function resolveVlmEndpoint(db, config, modelId) {
  const v = resolveVlmModel(db)
  const want = modelId || v.modelCode || v.modelId
  let llm = null
  try {
    const { resolveLiteLlmChatConfig } = require('./providers')
    llm = resolveLiteLlmChatConfig(db, config, want)
  } catch (_) {}
  return {
    modelId: v.modelId,
    modelCode: v.modelCode,
    baseUrl: (llm && (llm.baseUrl || llm.base_url)) || null,
    apiKey: (llm && (llm.apiKey || llm.api_key)) || null,
    source: v.source,
  }
}

function applyBindingToNodeConfig(db, node) {
  if (!node || !node.type) return node
  const jobId = NODE_JOB[node.type]
  if (!jobId) return node
  const jb = getJobBinding(db, jobId)
  if (!jb) return node
  const cfg = Object.assign({}, node.config || {})
  if (VLM_JOBS.has(jobId)) {
    cfg.model = DEFAULT_VLM_ID
    cfg.model_code = resolveModelCode(DEFAULT_VLM_ID) || DEFAULT_VLM_ID
  } else if (jb.model_id) {
    cfg.model = jb.model_id
    cfg.model_code = resolveModelCode(jb.model_id) || jb.model_id
  }
  const params = jb.params || {}
  if (params.promptTemplate) cfg.promptTemplate = params.promptTemplate
  if (params.ratios) cfg.ratios = params.ratios
  if (params.sizePreset) cfg.sizePreset = params.sizePreset
  if (params.embeddingModel) cfg.embeddingModel = params.embeddingModel
  if (params.adapterId) cfg.adapterId = params.adapterId
  node.config = cfg
  return node
}

function jobsForCapabilities(db) {
  return listJobBindings(db).map((j) => ({
    job_id: j.job_id,
    label: j.label,
    group: j.group,
    model_id: j.model_id,
    params: j.params,
    fields: j.fields,
    allow_models: j.allow_models,
    capable: (j.capable || []).map((c) => c.id),
  }))
}

/**
 * 启动时把 gate/tag/tag_furniture 的作业绑定和工作流图钉在免费别名上。
 * 过期 id（image_agnes_vision 等）留在 graph_json 里会让重试再次 400。
 */
function pinUnattendedVlm(db) {
  if (!db) return { jobs: 0, graphs: 0 }
  const now = Date.now()
  let jobs = 0
  let graphs = 0
  try {
    const info = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='gen_job_bindings'").get()
    if (info) {
      const upd = db.prepare('UPDATE gen_job_bindings SET model_id=?, actor=?, updated_at=? WHERE job_id=? AND model_id!=?')
      for (const jobId of VLM_JOBS) {
        jobs += upd.run(DEFAULT_VLM_ID, 'pin_workflow_vision', now, jobId, DEFAULT_VLM_ID).changes || 0
      }
    }
  } catch (_) {}
  try {
    const info = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='workflows'").get()
    if (!info) return { jobs, graphs }
    const rows = db.prepare('SELECT id, graph_json FROM workflows').all()
    const save = db.prepare('UPDATE workflows SET graph_json=? WHERE id=?')
    for (const row of rows) {
      let graph
      try { graph = JSON.parse(row.graph_json || '{}') } catch { continue }
      let changed = false
      for (const node of graph.nodes || []) {
        const jobId = NODE_JOB[node.type]
        if (!jobId || !VLM_JOBS.has(jobId)) continue
        node.config = node.config || {}
        if (node.config.model !== DEFAULT_VLM_ID || node.config.model_code !== DEFAULT_VLM_ID) {
          node.config.model = DEFAULT_VLM_ID
          node.config.model_code = DEFAULT_VLM_ID
          changed = true
        }
        const gatePrompt = String(node.config.promptTemplate || '')
        if (node.type === 'gate' && (!gatePrompt.includes('脸部特写') || gatePrompt.includes('手机状态栏仍算室内'))) {
          node.config.promptTemplate = GATE_PROMPT
          changed = true
        }
      }
      if (changed) {
        save.run(JSON.stringify(graph), row.id)
        graphs += 1
      }
    }
  } catch (_) {}
  return { jobs, graphs }
}

const SKILLS_DIR = path.join(__dirname, '../skills/media-prompt-skills')
const MODEL_MAP_FILE = path.join(SKILLS_DIR, 'model-map.json')
const MASTER_SKILL_FILE = path.join(SKILLS_DIR, 'media-prompt-gateway/SKILL.md')

function refreshMasterSkillNavigation(db) {
  try {
    if (!fs.existsSync(SKILLS_DIR)) fs.mkdirSync(SKILLS_DIR, { recursive: true })
    let map = {}
    if (fs.existsSync(MODEL_MAP_FILE)) {
      try { map = JSON.parse(fs.readFileSync(MODEL_MAP_FILE, 'utf8')) } catch { map = {} }
    }
    
    // 查询当前启用的模型
    const allGen = listGenModels(db)
    const enabledCodes = new Set()
    for (const dom of ['image', 'video', 'music', 'chat']) {
      for (const m of (allGen[dom] || [])) {
        if (m.model_code) enabledCodes.add(m.model_code)
        if (m.id) enabledCodes.add(m.id)
      }
    }

    const cleanMap = {}
    for (const [k, v] of Object.entries(map)) {
      if (enabledCodes.has(k) || k.startsWith('seed') || k.startsWith('agnes') || k.startsWith('doubao')) {
        cleanMap[k] = v
      }
    }
    fs.writeFileSync(MODEL_MAP_FILE, JSON.stringify(cleanMap, null, 2), 'utf8')

    if (fs.existsSync(MASTER_SKILL_FILE)) {
      let content = fs.readFileSync(MASTER_SKILL_FILE, 'utf8')
      const rows = Object.entries(cleanMap).map(([k, v]) => `| ${k} | \`${v}\` |`).join('\n')
      const tableRegex = /## 路由表\s*\n\s*\|[^\n]+\|\s*\n\s*\|[^\n]+\|\s*\n[\s\S]*?(?=\n\n|\n##|$)/
      if (tableRegex.test(content)) {
        content = content.replace(tableRegex, `## 路由表\n\n| 用户提到的模型/别名 | 子 skill |\n| --- | --- |\n${rows}`)
        fs.writeFileSync(MASTER_SKILL_FILE, content, 'utf8')
      }
    }
    return { success: true, count: Object.keys(cleanMap).length }
  } catch (err) {
    console.warn('[gen-governance] refreshMasterSkillNavigation 异常:', err.message)
    return { success: false, error: err.message }
  }
}

async function fetchDocSnippet(url) {
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,text/plain;q=0.8,*/*;q=0.7'
      },
      signal: AbortSignal.timeout(6000)
    })
    if (!res.ok) return ''
    const html = await res.text()
    return html
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<svg[\s\S]*?<\/svg>/gi, '')
      .replace(/<!--[\s\S]*?-->/g, '')
      .replace(/<[^>]+>/g, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(0, 5000)
  } catch (e) {
    return ''
  }
}

async function draftSkillFromDocs(db, { docUrls = [], modelCode, domain = 'image', promptNotes = '', modelName = '' }) {
  ensureGenGovernanceSchema(db)
  const id = `draft_${Date.now()}`
  const now = Date.now()
  const cleanCode = (modelCode || 'new_model').toLowerCase().replace(/[^a-z0-9_-]/g, '_')
  const name = modelName || modelCode || '新模型'

  const isVideo = domain === 'video'
  const isMusic = domain === 'music'
  let schemaDraft = {
    domain,
    modes: isVideo ? [{ id: 'text_to_video', label: '文生视频' }, { id: 'image_to_video', label: '图生视频' }] :
           isMusic ? [{ id: 'generate_bgm', label: '生成背景配乐' }] :
           [{ id: 'text_to_image', label: '文生图' }, { id: 'image_to_image', label: '垫图改图' }],
    common: [
      { key: 'size', label: '生成画幅/分辨率', type: 'enum', options: isVideo ? ['720p', '1080p'] : ['1024x1024', '1080x1920', '1920x1080'], default: isVideo ? '720p' : '1024x1024' },
      { key: isVideo ? 'duration' : 'count', label: isVideo ? '时长(秒)' : '出图片数', type: 'number', min: 1, max: isVideo ? 10 : 4, default: isVideo ? 5 : 1 }
    ],
    advanced: [
      { key: 'seed', label: '随机种子', type: 'number', min: -1, max: 2147483647, default: -1 },
      { key: 'prompt_strength', label: '提示词遵循度', type: 'range', min: 0.1, max: 1.0, default: 0.7 }
    ],
    regionKind: domain === 'image' ? 'coords_bbox' : 'vlm_text'
  }

  let polishDraft = `# ${name} (${modelCode}) 专属优化指南
- 重点关注设计意图、材质反光、真实光影细节
- 遵循通用契约，统一使用 @图片N 记号作为多图参考指代
- 严禁空洞形容词，必须具象化描述画面元素与镜头运动
${promptNotes ? `\n附加要求：${promptNotes}` : ''}`

  const skillName = `pe-${cleanCode.replace(/_/g, '-')}`
  let skillContent = `---
name: ${skillName}
description: ${name} (${modelCode}) 提示词优化与参数结构化指南
agent_created: true
---

# ${name} 提示词工程规范

## 推荐模型参数
\`\`\`yaml
model: ${modelCode}
size: ${isVideo ? '720p' : '1024x1024'}
${isVideo ? 'duration: 5' : 'count: 1'}
\`\`\`

## 优化逻辑
1. 提取室内设计空间定位（客厅/卧室/公区）、硬装材质与软装细节。
2. 强化空间透视与光影氛围。
3. 参考图指代严格使用规范记号。
`

  // 尝试联网抓取文档正文并调用 LLM 深度提取参数与优化规范
  const validUrls = (Array.isArray(docUrls) ? docUrls : [docUrls]).filter(u => typeof u === 'string' && u.startsWith('http'))
  if (validUrls.length > 0) {
    try {
      const snippets = []
      for (const u of validUrls.slice(0, 2)) {
        const t = await fetchDocSnippet(u)
        if (t) snippets.push(`【文档来源: ${u}】\n${t}`)
      }
      const combinedDoc = snippets.join('\n\n')
      if (combinedDoc.length > 100) {
        const { completeChat, extractJson } = require('./vlm')
        const { resolveLiteLlmChatConfig } = require('./providers')
        const llmCfg = resolveLiteLlmChatConfig(db)
        if (llmCfg && llmCfg.baseUrl) {
          const prompt = `你是一个专业的生成式 AI 模型与参数工程专家。
请根据以下官方技术文档内容，为模型 "${name}" (model_code: "${modelCode}", domain: "${domain}") 起草参数规范、优化模板与子技能。
如果用户有补充说明，也请纳入考虑：${promptNotes || '无'}。

官方技术文档摘要：
${combinedDoc}

请严格输出 JSON 对象（不要包裹多余 markdown），字段如下：
{
  "schemaDraft": {
    "domain": "${domain}",
    "common": [
      {"key": "size", "label": "画幅/分辨率", "type": "enum", "options": ["1024x1024"], "default": "1024x1024"},
      {"key": "${isVideo ? 'duration' : 'count'}", "label": "${isVideo ? '时长(秒)' : '出图张数'}", "type": "number", "default": ${isVideo ? 5 : 1}}
    ],
    "advanced": [
      {"key": "seed", "label": "随机种子", "type": "number", "default": -1}
    ],
    "regionKind": "coords_bbox"
  },
  "polishDraft": "模型专属提示词优化指南文本",
  "skillContent": "包含 --- name: ${skillName} ... --- 的完整 Markdown 文档内容"
}`
          const res = await completeChat({
            baseUrl: llmCfg.baseUrl,
            apiKey: llmCfg.apiKey,
            model: 'workflow_vision',
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.2,
            timeoutMs: 30000
          })
          const content = res?.choices?.[0]?.message?.content || ''
          const parsed = extractJson(content)
          if (parsed && typeof parsed === 'object') {
            if (parsed.schemaDraft) schemaDraft = parsed.schemaDraft
            if (parsed.polishDraft) polishDraft = parsed.polishDraft
            if (parsed.skillContent) skillContent = parsed.skillContent
          }
        }
      }
    } catch (err) {
      console.warn('[draftSkillFromDocs] 智能提取跳过/降级为模板:', err.message)
    }
  }

  db.prepare(`
    INSERT INTO gen_skill_drafts
      (id, model_id, model_code, domain, doc_urls_json, schema_draft_json, polish_draft, skill_content, status, actor, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'pending', '', ?, ?)
  `).run(
    id,
    cleanCode,
    modelCode,
    domain,
    JSON.stringify(docUrls),
    JSON.stringify(schemaDraft),
    polishDraft,
    skillContent,
    now,
    now
  )

  return {
    id,
    model_id: cleanCode,
    model_code: modelCode,
    domain,
    doc_urls: docUrls,
    schema_draft: schemaDraft,
    polish_draft: polishDraft,
    skill_content: skillContent,
    status: 'pending'
  }
}


function listSkillDrafts(db) {
  ensureGenGovernanceSchema(db)
  const rows = db.prepare('SELECT * FROM gen_skill_drafts ORDER BY created_at DESC').all()
  return rows.map(r => ({
    ...r,
    doc_urls: parseJson(r.doc_urls_json, []),
    schema_draft: parseJson(r.schema_draft_json, {}),
  }))
}

function acceptSkillDraft(db, draftId, actor) {
  ensureGenGovernanceSchema(db)
  const draft = db.prepare('SELECT * FROM gen_skill_drafts WHERE id=?').get(draftId)
  if (!draft) throw new Error(`未找到草稿: ${draftId}`)

  const schema = parseJson(draft.schema_draft_json, {})
  const modelId = draft.model_id
  const modelCode = draft.model_code
  const now = Date.now()

  // 1. 适配器代码草稿：写入 src/gen/adapters/ 并即时加载
  if (schema.kind === 'adapter') {
    const filename = schema.filename || `${modelCode || modelId}.js`
    try {
      const installedMod = safeInstallAdapter(filename, draft.skill_content || '')
      const adapterId = draft.model_id
      const protocol = installedMod.protocol || schema.protocol || adapterId
      const label = schema.label || schema.name || adapterId
      const kind = draft.domain || schema.domain || 'image'
      const baseUrl = schema.base_url || ''
      const apiKey = schema.apiKey || ''
      const secretsJson = apiKey ? JSON.stringify({ apiKey }) : (schema.secrets_json ? JSON.stringify(schema.secrets_json) : '{}')
      const configJson = JSON.stringify(schema.config || {})

      db.prepare(`
        INSERT INTO gen_adapters (id, label, kind, builtin, protocol, base_url, secrets_json, config_json, enabled, created_at, updated_at)
        VALUES (?, ?, ?, 0, ?, ?, ?, ?, 1, ?, ?)
        ON CONFLICT(id) DO UPDATE SET
          label=excluded.label, kind=excluded.kind, protocol=excluded.protocol,
          base_url=excluded.base_url, secrets_json=excluded.secrets_json,
          config_json=excluded.config_json, enabled=1, updated_at=excluded.updated_at
      `).run(adapterId, label, kind, protocol, baseUrl, secretsJson, configJson, now, now)

      delete schema.error
      db.prepare("UPDATE gen_skill_drafts SET status='accepted', schema_draft_json=?, actor=?, updated_at=? WHERE id=?")
        .run(JSON.stringify(schema), actor || '', now, draftId)
      return { success: true, draft_id: draftId, status: 'accepted', adapter_id: adapterId, protocol }
    } catch (err) {
      schema.error = err.message
      db.prepare("UPDATE gen_skill_drafts SET schema_draft_json=?, actor=?, updated_at=? WHERE id=?")
        .run(JSON.stringify(schema), actor || '', now, draftId)
      throw new Error(`适配器安装失败: ${err.message}`)
    }
  }

  // 2. 数据草稿：仅更新配置/提示词/作业绑定等 DB 记录
  if (schema.kind === 'data') {
    if (schema.customConfig) {
      saveCustomModel(db, modelId, { ...schema.customConfig, fields: schema.fields || [] }, actor)
    }
    if (draft.polish_draft) {
      savePolish(db, modelId, { prompt: draft.polish_draft, optimizer_model_id: schema.optimizer_model_id }, actor)
    }
    if (Array.isArray(schema.jobBindings)) {
      for (const jb of schema.jobBindings) {
        if (jb.job_id) saveJobBinding(db, jb.job_id, jb, actor)
      }
    } else if (schema.jobBindings && typeof schema.jobBindings === 'object') {
      for (const [jid, jb] of Object.entries(schema.jobBindings)) {
        saveJobBinding(db, jid, jb, actor)
      }
    }
    delete schema.error
    db.prepare("UPDATE gen_skill_drafts SET status='accepted', schema_draft_json=?, actor=?, updated_at=? WHERE id=?")
      .run(JSON.stringify(schema), actor || '', now, draftId)
    return { success: true, draft_id: draftId, status: 'accepted' }
  }

  // 3. 兼容历史遗留技能文档草稿
  if (schema.common || schema.advanced) {
    const fields = (schema.common || []).concat(schema.advanced || [])
    saveCustomFields(db, modelId, fields, actor)
  }

  if (draft.polish_draft) {
    savePolish(db, modelId, { prompt: draft.polish_draft }, actor)
  }

  try {
    const cleanCode = (modelCode || modelId).toLowerCase().replace(/[^a-z0-9_-]/g, '_')
    const skillName = `pe-${cleanCode.replace(/_/g, '-')}`
    const targetDir = path.join(SKILLS_DIR, skillName)
    if (!fs.existsSync(targetDir)) fs.mkdirSync(targetDir, { recursive: true })
    fs.writeFileSync(path.join(targetDir, 'SKILL.md'), draft.skill_content || '', 'utf8')

    let map = {}
    if (fs.existsSync(MODEL_MAP_FILE)) {
      try { map = JSON.parse(fs.readFileSync(MODEL_MAP_FILE, 'utf8')) } catch { map = {} }
    }
    map[modelId] = skillName
    if (modelCode) map[modelCode] = skillName
    fs.writeFileSync(MODEL_MAP_FILE, JSON.stringify(map, null, 2), 'utf8')

    refreshMasterSkillNavigation(db)
  } catch (err) {
    console.warn('[acceptSkillDraft] 技能落盘失败:', err.message)
  }

  db.prepare("UPDATE gen_skill_drafts SET status='accepted', actor=?, updated_at=? WHERE id=?").run(actor || '', now, draftId)
  return { success: true, draft_id: draftId, status: 'accepted' }
}

function deprecateModelSkill(db, modelCode, actor) {
  ensureGenGovernanceSchema(db)
  const cleanCode = (modelCode || '').toLowerCase().replace(/[^a-z0-9_-]/g, '_')
  const skillName = `pe-${cleanCode.replace(/_/g, '-')}`
  const targetDir = path.join(SKILLS_DIR, skillName)

  if (fs.existsSync(path.join(targetDir, 'SKILL.md'))) {
    try {
      let content = fs.readFileSync(path.join(targetDir, 'SKILL.md'), 'utf8')
      if (!content.includes('deprecated: true')) {
        content = content.replace(/^---\s*\n/, '---\ndeprecated: true\n')
        fs.writeFileSync(path.join(targetDir, 'SKILL.md'), content, 'utf8')
      }
    } catch {}
  }

  if (fs.existsSync(MODEL_MAP_FILE)) {
    try {
      const map = JSON.parse(fs.readFileSync(MODEL_MAP_FILE, 'utf8'))
      delete map[modelCode]
      delete map[cleanCode]
      fs.writeFileSync(MODEL_MAP_FILE, JSON.stringify(map, null, 2), 'utf8')
    } catch {}
  }

  refreshMasterSkillNavigation(db)
  return { success: true, modelCode, archived: true }
}

const MANUAL_OVERRIDES_KEY = 'studio_manual_defaults'

/**
 * 手动工坊的模型覆盖配置。存kv 表（键studio_manual_defaults），结构：
 *   { chat: {default_model, allow_models: []}, image: {...}, ... }
 * 读失败一律回落到空对象 —— 治理台覆盖是「锦上添花」，绝不能因为 kv 脏了让整个 AI 应用页挂掉。
 */
function getManualOverrides(db) {
  try {
    const row = db.prepare('SELECT value FROM kv WHERE key=?').get(MANUAL_OVERRIDES_KEY)
    const parsed = row && row.value ? parseJson(row.value, {}) : {}
    return parsed && typeof parsed === 'object' ? parsed : {}
  } catch (_) {
    return {}
  }
}

/** 保存某个手动工坊操作的默认模型 / 可选模型池（传 null 清除该项） */
function saveManualOverride(db, body, actor) {
  const id = String((body && body.id) || '').trim()
  if (!id) throw new Error('缺少操作 id')
  const all = getManualOverrides(db)
  if (body.default_model === null && body.allow_models === null) {
    delete all[id]
  } else {
    const prev = all[id] || {}
    all[id] = {
      default_model: body.default_model !== undefined ? body.default_model : (prev.default_model || ''),
      allow_models: Array.isArray(body.allow_models) ? body.allow_models : (prev.allow_models || []),
      actor: actor || '',
      updated_at: Date.now(),
    }
  }
  db.prepare(
    'INSERT INTO kv (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value'
  ).run(MANUAL_OVERRIDES_KEY, JSON.stringify(all))
  return all
}

function getAiApplications(db) {
  ensureGenGovernanceSchema(db)
  const jobMap = {}
  for (const j of listJobBindings(db)) {
    jobMap[j.job_id] = j
  }
  const allGen = listGenModels(db)
  
  const freeVlmModels = [
    { id: 'workflow_vision', name: '免费视觉别名池 (17 Deployments 轮转 - 推荐)' },
    { id: 'workflow_vision_low', name: '低优先免费视觉别名池 (Gemma 31B)' }
  ]
  const freeImageModels = (allGen.image || []).filter(m => m.free || m.caps?.freeTier).map(m => ({ id: m.id, name: m.name, free: true }))
  if (!freeImageModels.length && allGen.image?.length) {
    freeImageModels.push({ id: allGen.image[0].id, name: allGen.image[0].name, free: true })
  }

  const automation = [
    {
      id: 'gate',
      title: '室内入库闸门',
      desc: '识别室内设计/装修实景图，自动过滤非室内实景素材',
      category: 'vision',
      defaultModel: (jobMap.gate && jobMap.gate.model_id) || DEFAULT_VLM_ID,
      isFree: true,
      freeOnly: true,
      capableModels: freeVlmModels,
      params: (jobMap.gate && jobMap.gate.params) || {},
      fields: (jobMap.gate && jobMap.gate.fields) || []
    },
    {
      id: 'tag',
      title: '空间维度打标',
      desc: '识别空间类型、设计风格、主要色调、硬装材质等多维特征',
      category: 'vision',
      defaultModel: (jobMap.tag && jobMap.tag.model_id) || DEFAULT_VLM_ID,
      isFree: true,
      freeOnly: true,
      capableModels: freeVlmModels,
      params: (jobMap.tag && jobMap.tag.params) || {},
      fields: (jobMap.tag && jobMap.tag.fields) || []
    },
    {
      id: 'tag_furniture',
      title: '单品家具打标',
      desc: '识别家具单品、软装搭配、摆件细节',
      category: 'vision',
      defaultModel: (jobMap.tag_furniture && jobMap.tag_furniture.model_id) || DEFAULT_VLM_ID,
      isFree: true,
      freeOnly: true,
      capableModels: freeVlmModels,
      params: (jobMap.tag_furniture && jobMap.tag_furniture.params) || {},
      fields: (jobMap.tag_furniture && jobMap.tag_furniture.fields) || []
    },
    {
      id: 'restage',
      title: '画幅自动重构 (9:16 / 3:4)',
      desc: '入库后自动扩图重构为 9:16 与 3:4 多比例效果图',
      category: 'image',
      defaultModel: (jobMap.restage && jobMap.restage.model_id) || freeImageModelId(),
      isFree: true,
      freeOnly: true,
      capableModels: freeImageModels,
      params: (jobMap.restage && jobMap.restage.params) || { ratios: ['9:16', '3:4'], sizePreset: '1080p' },
      fields: (jobMap.restage && jobMap.restage.fields) || []
    },
    {
      id: 'index',
      title: '语义向量入库',
      desc: '为素材标签生成嵌入向量并构建多维语义检索索引',
      category: 'embedding',
      defaultModel: (jobMap.index && jobMap.index.model_id) || 'text-embedding-3-small',
      isFree: true,
      freeOnly: true,
      capableModels: [{ id: 'text-embedding-3-small', name: 'OpenAI Text Embedding 3 Small' }],
      params: (jobMap.index && jobMap.index.params) || {},
      fields: (jobMap.index && jobMap.index.fields) || []
    }
  ]

  const manual = [
    {
      id: 'chat',
      title: '多轮设计对话',
      desc: '设计助理聊天对话，多轮历史纯文本隔离与阈值摘要',
      domain: 'chat',
      defaultModel: OFFICIAL_STUDIO.chat.defaultModel,
      isFree: true,
      capableModels: (allGen.chat || []).map(m => ({ id: m.id, name: m.name, model_code: m.model_code, provider: m.provider })),
      currentModel: OFFICIAL_STUDIO.chat.defaultModel
    },
    {
      id: 'image',
      title: '效果图主动生成',
      desc: '单轮产物链、粘性参数、多图参考、组图输出',
      domain: 'image',
      defaultModel: OFFICIAL_STUDIO.image.defaultModel,
      isFree: false,
      regionKind: 'coords_bbox',
      capableModels: (allGen.image || []).map(m => ({
        id: m.id,
        name: m.name,
        model_code: m.model_code,
        provider: m.provider,
        free: Boolean(m.free),
        regionKind: m.regionKind || (m.caps && m.caps.region ? m.caps.region.kind : 'coords_bbox')
      })),
      currentModel: OFFICIAL_STUDIO.image.defaultModel
    },
    {
      id: 'video',
      title: '漫游视频生成',
      desc: '空间动态漫游视频生成，@长按引用视频，免除隐式计费',
      domain: 'video',
      defaultModel: OFFICIAL_STUDIO.video.defaultModel,
      isFree: false,
      capableModels: (allGen.video || []).map(m => ({
        id: m.id,
        name: m.name,
        model_code: m.model_code,
        provider: m.provider,
        free: Boolean(m.free)
      })),
      currentModel: OFFICIAL_STUDIO.video.defaultModel
    },
    {
      id: 'music',
      title: 'AI 设计配乐',
      desc: '背景音乐 (BGM) 与伴奏歌曲生成，参数粘性继承',
      domain: 'music',
      defaultModel: OFFICIAL_STUDIO.music.defaultModel,
      isFree: false,
      capableModels: (allGen.music || []).map(m => ({
        id: m.id,
        name: m.name,
        model_code: m.model_code,
        provider: m.provider,
        free: Boolean(m.free)
      })),
      currentModel: OFFICIAL_STUDIO.music.defaultModel
    },
    {
      id: 'edit',
      title: '精准修图与编辑',
      desc: '智能扩图、去水印、精准增删改，选区方案随模型能力自动适配',
      domain: 'edit',
      modes: [
        { id: 'expand', label: '智能扩图', region: 'coords_bbox', model: (jobMap.expand && jobMap.expand.model_id) || 'umbra.expand' },
        { id: 'watermark', label: '去水印', region: 'coords_bbox', model: (jobMap.watermark && jobMap.watermark.model_id) || 'unified_gateway' },
        { id: 'insert', label: '精准·增', region: 'coords_bbox', model: (jobMap.insert && jobMap.insert.model_id) || 'umbra.insert' },
        { id: 'remove', label: '精准·删', region: 'coords_bbox', model: (jobMap.remove && jobMap.remove.model_id) || 'umbra.remove' },
        { id: 'replace', label: '精准·改', region: 'coords_bbox', model: (jobMap.replace && jobMap.replace.model_id) || 'umbra.replace' },
        // ★ 补齐：此前 edit 只列了 5 个模式，风格转换 / 超分 / 留白 / 增加 四个 op
        //在治理台完全不可见 —— 这也是「风格转换没有模型可选」的直接原因。
        { id: 'style_transfer', label: '风格转换', region: 'vlm_text', model: (jobMap.style_transfer && jobMap.style_transfer.model_id) || OFFICIAL_STUDIO.image.defaultModel },
        { id: 'clarity', label: '超分增强', region: 'vlm_text', model: (jobMap.clarity && jobMap.clarity.model_id) || OFFICIAL_STUDIO.image.defaultModel },
        { id: 'space', label: '留白', region: 'coords_bbox', model: (jobMap.space && jobMap.space.model_id) || OFFICIAL_STUDIO.image.defaultModel },
        { id: 'add', label: '精准·加', region: 'coords_bbox', model: (jobMap.add && jobMap.add.model_id) || OFFICIAL_STUDIO.image.defaultModel }
      ]
    }
  ]

  // ★ 自动化作业回显「可选模型池」：治理台据此渲染多选框。
  //   注意只对有selectable 域的作业生效（无人值守流水线作业返回 null → 不渲染）。
  for (const job of automation) {
    const b = jobMap[job.id]
    if (!b) continue
    job.selectableModels = b.selectable || null
    job.allow_models = Array.isArray(b.allow_models) ? b.allow_models : []
  }

  // ★ 手动工坊覆盖：治理台保存的「默认模型 + 可选模型池」优先于官方目录默认值。
  const manualOverrides = getManualOverrides(db)
  for (const op of manual) {
    const ov = manualOverrides[op.id]
    if (!ov || op.modes) continue
    if (ov.default_model) op.defaultModel = ov.default_model
    if (Array.isArray(ov.allow_models) && ov.allow_models.length && op.capableModels) {
      const allow = new Set(ov.allow_models.map((x) => String(x)))
      const filtered = op.capableModels.filter((m) => allow.has(m.id))
      // 池子配错（模型已下架）时回落全量，避免治理台一次误操作把下拉清空
      if (filtered.length) op.capableModels = filtered
    }
    op.currentModel = op.defaultModel
    // 治理台回显用：让它知道当前池子里到底有哪些（勾选状态）
    op.allow_models = Array.isArray(ov && ov.allow_models) ? ov.allow_models.slice() : []
  }

  return { automation, manual }
}

module.exports = {
  DEFAULT_JOBS,
  NODE_JOB,
  STALE_VLM_IDS,
  VLM_JOBS,
  pinUnattendedVlm,
  ensureGenGovernanceSchema,
  listGenModels,
  polishFor,
  savePolish,
  resetPolish,
  listJobBindings,
  getJobBinding,
  saveJobBinding,
  resetJobBinding,
  getManualOverrides,
  saveManualOverride,
  resolveOptimizerModel,
  resolveVlmModel,
  resolveVlmEndpoint,
  DEFAULT_VLM_ID,
  applyBindingToNodeConfig,
  jobsForCapabilities,
  officialPolish,
  schemaFor,
  getCustomSchema,
  saveCustomFields,
  createCustomModel,
  deleteCustomModel,
  getAiApplications,
  draftSkillFromDocs,
  listSkillDrafts,
  acceptSkillDraft,
  deprecateModelSkill,
  refreshMasterSkillNavigation,
}

