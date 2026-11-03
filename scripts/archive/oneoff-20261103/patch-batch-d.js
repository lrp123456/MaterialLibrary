const fs = require('fs');
const path = require('path');

console.log('--- Applying Batch D Patches ---');

// 1. patch src/models-contract.js (实装 syncEndpointToLegacyTables)
const mcFile = path.resolve(__dirname, '../src/models-contract.js');
let mcContent = fs.readFileSync(mcFile, 'utf8');

if (!mcContent.includes('function syncEndpointToLegacyTables(db)')) {
  const syncFunction = `
/**
 * 四套模型表同步桥接器 (CONFLICT-001)
 * 自动将 llm_endpoints 与 model_contracts 同步刷新到旧表 llm_providers, llm_models, gen_adapters
 */
function syncEndpointToLegacyTables(db) {
  if (!db) return;
  try {
    const endpoints = db.prepare('SELECT * FROM llm_endpoints').all();
    const now = Date.now();

    for (const ep of endpoints) {
      // 1. 同步刷新到 llm_providers
      const pId = ep.id === 'volc_ark' ? 'volcengine' : (ep.id === 'local_host' ? 'local' : ep.id);
      try {
        db.prepare(\`
          UPDATE llm_providers
          SET base_url = COALESCE(?, base_url), enabled = ?, updated_at = ?
          WHERE id = ? OR id = ?
        \`).run(ep.base_url, ep.enabled, now, ep.id, pId);
      } catch (_) {}

      // 2. 同步刷新到 gen_adapters
      try {
        db.prepare(\`
          UPDATE gen_adapters
          SET base_url = COALESCE(?, base_url), enabled = ?, updated_at = ?
          WHERE id = ?
        \`).run(ep.base_url, ep.enabled, now, ep.id);
      } catch (_) {}
    }

    // 3. 将 model_contracts 同步刷新到 llm_models 与 gen_adapters
    const contracts = db.prepare('SELECT * FROM model_contracts').all();
    for (const c of contracts) {
      try {
        db.prepare(\`
          UPDATE llm_models
          SET model_code = COALESCE(?, model_code), enabled = ?, updated_at = ?
          WHERE id = ? OR name = ?
        \`).run(c.vendor_model_id, c.enabled, now, c.id, c.name);
      } catch (_) {}

      try {
        db.prepare(\`
          UPDATE gen_adapters
          SET enabled = ?, updated_at = ?
          WHERE id = ?
        \`).run(c.enabled, now, c.id);
      } catch (_) {}
    }
  } catch (err) {
    console.warn('[models-contract] syncEndpointToLegacyTables error:', err.message);
  }
}
`;

  // 插入函数并挂接到各保存/删除方法
  const exportTarget = `module.exports = {`;
  mcContent = mcContent.replace(exportTarget, `${syncFunction}\n${exportTarget}\n  syncEndpointToLegacyTables,`);

  // 在 saveEndpointData 末尾调用
  mcContent = mcContent.replace(
    /return getEndpointsList\(db\);/g,
    `syncEndpointToLegacyTables(db);\n  return getEndpointsList(db);`
  );
  // 在 saveModelContractData 末尾调用
  mcContent = mcContent.replace(
    /return getModelContractsList\(db\);/g,
    `syncEndpointToLegacyTables(db);\n  return getModelContractsList(db);`
  );

  fs.writeFileSync(mcFile, mcContent, 'utf8');
  console.log('[PASS] src/models-contract.js syncEndpointToLegacyTables added');
} else {
  console.log('[INFO] src/models-contract.js already has syncEndpointToLegacyTables');
}

// 2. patch src/providers.js (resolveLiteLlmChatConfig 优先读取 llm_endpoints)
const provFile = path.resolve(__dirname, '../src/providers.js');
let provContent = fs.readFileSync(provFile, 'utf8');

const provTarget = `  // 2. 现有对话和识图模型先挂在本地网关上，请求仍进 :4000
  let row = null;
  try {
    row = db.prepare("SELECT id, base_url, api_key, secrets_json, enabled FROM llm_providers WHERE id='litellm'").get();
  } catch (_) {}`;

const provReplacement = `  // 2. 现有对话和识图模型优先读取第四代 llm_endpoints 权威配置
  let endpointRow = null;
  try {
    endpointRow = db.prepare("SELECT id, base_url, enabled FROM llm_endpoints WHERE id='litellm'").get();
  } catch (_) {}

  let row = null;
  try {
    row = db.prepare("SELECT id, base_url, api_key, secrets_json, enabled FROM llm_providers WHERE id='litellm'").get();
  } catch (_) {}`;

if (provContent.includes(provTarget)) {
  provContent = provContent.replace(provTarget, provReplacement);
  provContent = provContent.replace(
    `const baseUrl = row?.base_url || config?.litellmBaseUrl || process.env.LITELLM_BASE_URL || 'http://127.0.0.1:4000';`,
    `const baseUrl = endpointRow?.base_url || row?.base_url || config?.litellmBaseUrl || process.env.LITELLM_BASE_URL || 'http://127.0.0.1:4000';`
  );
  fs.writeFileSync(provFile, provContent, 'utf8');
  console.log('[PASS] src/providers.js endpointRow priority applied');
}

// 3. patch src/interpreter.js (持久化 _flags 与动态展开 {{@dict.xxx}})
const interpFile = path.resolve(__dirname, '../src/interpreter.js');
let interpContent = fs.readFileSync(interpFile, 'utf8');

// 3a. 在 704 行持久化 _flags
const interpOutTarget = `        status,
        JSON.stringify(res.output || {}),`;
const interpOutReplacement = `        status,
        (() => {
          const outObj = (res.output && typeof res.output === 'object') ? { ...res.output } : { value: res.output };
          if (Array.isArray(res.flags) && res.flags.length > 0) {
            outObj._flags = res.flags;
          }
          return JSON.stringify(outObj);
        })(),`;
if (interpContent.includes(interpOutTarget)) {
  interpContent = interpContent.replace(interpOutTarget, interpOutReplacement);
  console.log('[PASS] src/interpreter.js _flags persistence applied');
}

// 3b. 动态展开 {{@dict.xxx}} 芯片
const promptTarget = `    if (targetNode.config && targetNode.config.promptTemplate) {
      try {
        const { expandPromptTemplate } = require('./models-contract');
        targetNode.config.prompt = expandPromptTemplate(this.db, targetNode.config.promptTemplate, asset, runCtx);
      } catch (_) {}
    }`;

const promptReplacement = `    if (targetNode.config && (targetNode.config.promptTemplate || targetNode.config.prompt)) {
      try {
        const { expandPromptTemplate, expandDictChips } = require('./models-contract');
        if (targetNode.config.promptTemplate && targetNode.config.promptTemplate.includes('{{@dict.')) {
          targetNode.config.promptTemplate = expandDictChips(this.db, targetNode.config.promptTemplate);
        }
        if (targetNode.config.prompt && targetNode.config.prompt.includes('{{@dict.')) {
          targetNode.config.prompt = expandDictChips(this.db, targetNode.config.prompt);
        }
        if (targetNode.config.promptTemplate) {
          targetNode.config.prompt = expandPromptTemplate(this.db, targetNode.config.promptTemplate, asset, runCtx);
        }
      } catch (_) {}
    }`;
if (interpContent.includes(promptTarget)) {
  interpContent = interpContent.replace(promptTarget, promptReplacement);
  console.log('[PASS] src/interpreter.js expandDictChips dynamic expanded');
}

fs.writeFileSync(interpFile, interpContent, 'utf8');

// 4. patch src/runtime-config.js (新增 applyRuntimeConfig)
const rcFile = path.resolve(__dirname, '../src/runtime-config.js');
let rcContent = fs.readFileSync(rcFile, 'utf8');

if (!rcContent.includes('function applyRuntimeConfig(db, services)')) {
  const rcAddition = `
/**
 * 将运行时配置全面推送到 process.env 与 services 实例
 */
function applyRuntimeConfig(db, services) {
  const cfg = getRuntimeConfig(db);
  if (cfg.http_proxy !== undefined) {
    process.env.HTTP_PROXY = cfg.http_proxy;
    process.env.http_proxy = cfg.http_proxy;
  }
  if (cfg.https_proxy !== undefined) {
    process.env.HTTPS_PROXY = cfg.https_proxy;
    process.env.https_proxy = cfg.https_proxy;
  }
  if (cfg.no_proxy !== undefined) {
    process.env.NO_PROXY = cfg.no_proxy;
    process.env.no_proxy = cfg.no_proxy;
  }
  if (cfg.nas_dir) process.env.ML_NAS_DIR = cfg.nas_dir;
  if (cfg.bff_public_base) process.env.BFF_PUBLIC_BASE = cfg.bff_public_base;
  if (cfg.litellm_base_url) process.env.LITELLM_BASE_URL = cfg.litellm_base_url;
  if (cfg.litellm_model) process.env.LITELLM_MODEL = cfg.litellm_model;
  if (cfg.umbra_base_url) process.env.UMBRA_BASE_URL = cfg.umbra_base_url;
  if (cfg.yolo_seg_url) process.env.YOLO_SEG_URL = cfg.yolo_seg_url;
  if (cfg.skills_root) process.env.SKILLS_ROOT = cfg.skills_root;

  if (services?.interpreter) {
    if (cfg.tag_concurrency) services.interpreter.tagConcurrency = Number(cfg.tag_concurrency) || 8;
    if (cfg.restage_concurrency) services.interpreter.restageConcurrency = Number(cfg.restage_concurrency) || 4;
    services.interpreter.concurrency = (services.interpreter.tagConcurrency || 8) + (services.interpreter.restageConcurrency || 4);
  }
  return cfg;
}
`;
  rcContent = rcContent.replace('module.exports = {', `${rcAddition}\nmodule.exports = {\n  applyRuntimeConfig,`);
  rcContent = rcContent.replace(
    'return getRuntimeConfig(db);',
    'const res = getRuntimeConfig(db);\n  try { applyRuntimeConfig(db); } catch (_) {}\n  return res;'
  );
  fs.writeFileSync(rcFile, rcContent, 'utf8');
  console.log('[PASS] src/runtime-config.js applyRuntimeConfig added');
}

// 5. patch src/nodes/index.js (executeTagClothing / executeTagPortrait dominant_color 回写与 executeIndex 语义标签拼接)
const nodesFile = path.resolve(__dirname, '../src/nodes/index.js');
let nodesContent = fs.readFileSync(nodesFile, 'utf8');

// 5a. executeTagPortrait dominant_color 回写
const portraitTarget = `  return {
    success: true,
    output: {
      tags,`;
const portraitReplacement = `  try {
    const domColor = Array.isArray(colors) ? colors[0] : (colors || null);
    db.prepare('UPDATE assets SET dominant_color = COALESCE(?, dominant_color), status = ? WHERE fid = ?')
      .run(domColor, 'processing', asset.fid);
  } catch (_) {}

  return {
    success: true,
    output: {
      tags,`;
if (nodesContent.includes(portraitTarget)) {
  nodesContent = nodesContent.replace(portraitTarget, portraitReplacement);
  console.log('[PASS] src/nodes/index.js tag_portrait dominant_color update applied');
}

// 5b. executeIndex 拼接服装与人像细分标签及主色
const indexTarget = `  if (currentCategory === 'clothing') {
    parts.push('类别:服装');
  } else if (currentCategory === 'portrait') {
    parts.push('类别:人像');`;

const indexReplacement = `  if (currentCategory === 'clothing') {
    parts.push('类别:服装');
    if (tagMap.clothing_category) parts.push(\`类目:\${tagMap.clothing_category.join(',')}\`);
    if (tagMap.clothing_silhouette) parts.push(\`版型:\${tagMap.clothing_silhouette.join(',')}\`);
    if (tagMap.clothing_fabric) parts.push(\`面料:\${tagMap.clothing_fabric.join(',')}\`);
    if (tagMap.clothing_scene) parts.push(\`场景:\${tagMap.clothing_scene.join(',')}\`);
    if (asset.dominant_color) parts.push(\`主色:\${asset.dominant_color}\`);
  } else if (currentCategory === 'portrait') {
    parts.push('类别:人像');
    if (tagMap.pose) parts.push(\`姿态:\${tagMap.pose.join(',')}\`);
    if (tagMap.character) parts.push(\`角色:\${tagMap.character.join(',')}\`);
    if (tagMap.shot_type) parts.push(\`景别:\${tagMap.shot_type.join(',')}\`);
    if (asset.dominant_color) parts.push(\`主色:\${asset.dominant_color}\`);`;

if (nodesContent.includes(indexTarget)) {
  nodesContent = nodesContent.replace(indexTarget, indexReplacement);
  console.log('[PASS] src/nodes/index.js executeIndex clothing/portrait enrich applied');
}

fs.writeFileSync(nodesFile, nodesContent, 'utf8');
console.log('--- Batch D Patches Complete ---');
