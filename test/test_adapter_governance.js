/**
 * 模型与适配器服务端治理单元与集成自动化测试套件
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const { OFFICIAL_STUDIO } = require('../src/studio-catalog');
const { getProtocolManifest, listAllManifests } = require('../src/gen/builtin-protocols');
const { safeInstallAdapter, getAdapterModule, resolveSafePath, ADAPTERS_DIR } = require('../src/gen/adapters');
const { resolveProviderApiKey, initProvidersTables } = require('../src/providers');
const {
  ensureGenGovernanceSchema,
  getJobBinding,
  saveJobBinding,
  acceptSkillDraft,
  listGenModels,
} = require('../src/gen-governance');
const { BUILTIN_ADAPTERS } = require('../scripts/migrate');

async function runTests() {
  console.log('=== [1/8] 测试：Catalog 与默认模型治理 ===');
  {
    assert.strictEqual(OFFICIAL_STUDIO.chat.defaultModel, 'agnes3_0flash', 'chat.defaultModel 应为 agnes3_0flash');
    const lite = OFFICIAL_STUDIO.chat.models.find(m => m.id === 'gemini_flash_lite_latest');
    const flash = OFFICIAL_STUDIO.chat.models.find(m => m.id === 'gemini_flash_latest');
    assert.strictEqual(lite?.disabled, true, 'gemini_flash_lite_latest 应有 disabled: true');
    assert.strictEqual(flash?.disabled, true, 'gemini_flash_latest 应有 disabled: true');

    const gemma = OFFICIAL_STUDIO.chat.models.find(m => m.id === 'gemma_4_26b');
    assert.ok(gemma, 'gemma_4_26b 必须保留');
    assert.strictEqual(gemma.disabled, undefined, 'gemma_4_26b 不应被停用');
    console.log('✔ Catalog 默认模型与停用标记校验通过');
  }

  console.log('=== [2/8] 测试：初始内置适配器 Gemini 停用 ===');
  {
    const geminiAdapters = ['gemini_image', 'gemini_video', 'gemini_veo', 'gemini_lyria'];
    for (const gid of geminiAdapters) {
      const adp = BUILTIN_ADAPTERS.find(a => a.id === gid);
      assert.ok(adp, `内置适配器必须包含 ${gid}`);
      assert.strictEqual(adp.enabled, 0, `${gid} 初始 enabled 必须为 0`);
    }
    console.log('✔ Gemini 初始适配器 enabled === 0 校验通过');
  }

  console.log('=== [3/8] 测试：内置协议只读清单契约 ===');
  {
    const qwen = getProtocolManifest('qwenimage_local');
    assert.ok(qwen, '必须包含 qwenimage_local 协议清单');
    assert.ok(qwen.method.includes('POST'), 'qwenimage_local 方法应包含 POST');
    assert.ok(qwen.urlTemplate.includes('/api/generate'));
    assert.ok(qwen.paramLocations.prompt, '必须声明 prompt 落点');

    const doubao = getProtocolManifest('doubao_music');
    assert.ok(doubao, '必须包含 doubao_music 协议清单');
    assert.ok(doubao.steps && doubao.steps.length === 3, 'doubao_music 必须声明 3 个步骤');

    const geminiInteractions = getProtocolManifest('gemini_interactions');
    assert.ok(geminiInteractions, '必须包含 gemini_interactions 协议');
    assert.strictEqual(geminiInteractions.enabled, 0, 'gemini_interactions 应标注 enabled: 0');

    const manifests = listAllManifests();
    assert.ok(manifests.length >= 8, '只读清单导出数量至少应有 8 条');
    console.log('✔ 内置协议只读清单契约校验通过');
  }

  console.log('=== [4/8] 测试：密钥隔离与适配器密钥优先生效 ===');
  {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE IF NOT EXISTS gen_adapters (
        id TEXT PRIMARY KEY,
        label TEXT,
        kind TEXT,
        builtin INTEGER,
        protocol TEXT,
        base_url TEXT,
        secrets_json TEXT,
        config_json TEXT,
        enabled INTEGER,
        created_at INTEGER,
        updated_at INTEGER
      );
    `);
    initProvidersTables(db);

    db.prepare("UPDATE llm_providers SET api_key='vendor_volc_key' WHERE id='volcengine'").run();
    const prevArk = process.env.ARK_API_KEY;
    delete process.env.ARK_API_KEY;
    delete process.env.ARK_API_KEYS;

    const adpWithoutKey = { id: 'test_adp_1', base_url: 'https://ark.cn-beijing.volces.com', secrets_json: '{}' };
    const ignored = resolveProviderApiKey(db, adpWithoutKey, 'volcengine');
    assert.strictEqual(ignored, '', '数据库里的钥匙不再使用');

    process.env.ARK_API_KEY = 'vendor_volc_key';
    const adpWithKey = { id: 'test_adp_2', base_url: 'https://ark.cn-beijing.volces.com', secrets_json: JSON.stringify({ apiKey: 'adapter_isolated_key' }) };
    const fromEnv = resolveProviderApiKey(db, adpWithKey, 'volcengine');
    assert.strictEqual(fromEnv, 'vendor_volc_key', '只读环境变量，忽略适配器里的钥匙');

    const vendorRow = db.prepare("SELECT api_key FROM llm_providers WHERE id='volcengine'").get();
    assert.strictEqual(vendorRow.api_key, 'vendor_volc_key', '读取钥匙时不改供应商表');
    if (prevArk == null) delete process.env.ARK_API_KEY;
    else process.env.ARK_API_KEY = prevArk;
    console.log('✔ 钥匙只从环境变量读取');
  }

  console.log('=== [5/8] 测试：适配器文件路径安全防御 ===');
  {
    assert.throws(() => safeInstallAdapter('../../etc/passwd.js', ''), /文件名非法|禁止向适配器目录以外/);
    assert.throws(() => safeInstallAdapter('hack.sh', ''), /文件名非法/);
    assert.throws(() => safeInstallAdapter('index.js', ''), /禁止覆盖适配器入口文件/);
    console.log('✔ 路径越界与非法扩展名防御校验通过');
  }

  console.log('=== [6/8] 测试：适配器导出出口形状校验 ===');
  {
    // 缺少 buildRequest
    const invalidCode1 = `
      module.exports = {
        protocol: 'test_bad_1',
        method: 'POST',
        urlTemplate: '{{baseUrl}}',
        paramLocations: {},
        parseResponse: () => {}
      };
    `;
    assert.throws(() => safeInstallAdapter('test_bad_1.js', invalidCode1), /必须导出 buildRequest/);

    // 缺少 parseResponse
    const invalidCode2 = `
      module.exports = {
        protocol: 'test_bad_2',
        method: 'POST',
        urlTemplate: '{{baseUrl}}',
        paramLocations: {},
        buildRequest: () => {}
      };
    `;
    assert.throws(() => safeInstallAdapter('test_bad_2.js', invalidCode2), /必须导出 parseResponse/);
    console.log('✔ 适配器导出出口形状严格校验通过');
  }

  console.log('=== [7/8] 测试：原子热加载、错误回滚与留痕 ===');
  {
    const validProtoCode = `
      module.exports = {
        protocol: 'test_live_proto',
        method: 'POST',
        urlTemplate: '{{baseUrl}}/v1/run',
        paramLocations: { prompt: 'body.prompt' },
        buildRequest(ctx) { return { url: ctx.baseUrl, method: 'POST', headers: {}, body: '{}' }; },
        parseResponse(data) { return { status: 'success', files: [{ previewUrl: 'http://test.url/out.png' }] }; }
      };
    `;
    const filename = 'test_live_proto.js';
    const filePath = path.join(ADAPTERS_DIR, filename);

    // 1. 初次合法挂载
    const mod1 = safeInstallAdapter(filename, validProtoCode);
    assert.strictEqual(mod1.protocol, 'test_live_proto');
    assert.ok(getAdapterModule('test_live_proto'), '应该能从内存中查到刚挂载的适配器');

    // 2. 尝试传入损坏的语法，验证原子回滚
    const brokenCode = `
      module.exports = {
        protocol: 'test_live_proto',
        syntax error {{{
    `;
    assert.throws(() => safeInstallAdapter(filename, brokenCode));

    // 验证文件已被回滚回原先的代码
    const diskContent = fs.readFileSync(filePath, 'utf8');
    assert.strictEqual(diskContent, validProtoCode, '损坏安装后文件应自动回滚为原版本');

    // 3. 草稿采纳与留痕测试
    const db = new Database(':memory:');
    ensureGenGovernanceSchema(db);
    db.prepare(`
      INSERT INTO gen_skill_drafts (id, model_id, model_code, domain, doc_urls_json, schema_draft_json, skill_content, status, actor, created_at, updated_at)
      VALUES ('draft_err_1', 'bad_proto', 'bad_proto', 'image', '[]', '{"kind":"adapter","protocol":"bad_proto"}', 'bad syntax {{{', 'pending', '', 0, 0)
    `).run();

    assert.throws(() => acceptSkillDraft(db, 'draft_err_1', 'admin'), /适配器安装失败/);

    // 检查草稿依然是 pending 且记下了错误
    const draftAfter = db.prepare("SELECT * FROM gen_skill_drafts WHERE id='draft_err_1'").get();
    assert.strictEqual(draftAfter.status, 'pending', '失败草稿状态必须维持 pending');
    const schemaAfter = JSON.parse(draftAfter.schema_draft_json);
    assert.ok(schemaAfter.error, '草稿 schema_draft_json 中必须记录 error 错误信息');

    // 清理测试文件
    try { fs.unlinkSync(filePath); } catch (_) {}
    console.log('✔ 原子热加载、错误回滚与草稿留痕校验通过');
  }

  console.log('=== [8/8] 测试：作业绑定对已停用模型的透明降级 ===');
  {
    const db = new Database(':memory:');
    ensureGenGovernanceSchema(db);

    // 模拟 gen_job_bindings 指向已停用的 gemini_flash_lite_latest
    db.prepare(`
      INSERT INTO gen_job_bindings (job_id, model_id, params_json, allow_models_json, fields_json, actor, updated_at)
      VALUES ('gate', 'gemini_flash_lite_latest', '{}', '[]', '[]', 'test', 0)
    `).run();

    const binding = getJobBinding(db, 'gate');
    assert.notStrictEqual(binding.model_id, 'gemini_flash_lite_latest', '读取作业绑定时不能返回已停用的模型');
    assert.ok(binding.model_id === 'workflow_vision' || binding.model_id === 'agnes3_0flash', `应平滑降级为启用模型，实际: ${binding.model_id}`);

    // 检查 DB 中的原始绑定行未被删除或覆写（以后启用即可恢复）
    const rawRow = db.prepare("SELECT model_id FROM gen_job_bindings WHERE job_id='gate'").get();
    assert.strictEqual(rawRow.model_id, 'gemini_flash_lite_latest', 'DB 记录必须完整保留，不作破坏性删除');
    console.log('✔ 作业绑定透明降级且原样保留 DB 记录校验通过');
  }

  console.log('\n========================================');
  console.log('🎉 8 项核心治理契约全部通过！');
  console.log('========================================');
}

runTests().catch(err => {
  console.error('❌ 测试失败:', err);
  process.exit(1);
});
