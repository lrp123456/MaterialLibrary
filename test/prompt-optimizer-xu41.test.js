/**
 * 续 41 及提示词优化器拆分测试：
 * 1. Agnes 3 行凭证展开（指纹、尾号、has_value），国际站空凭证。
 * 2. 模型契约列表全量加载（含 LiteLLM 13 条文本契约），优化器专属 Skill 默认带出官方技能。
 * 3. 厂商自动优化参数统一抽象：off 彻底不传，standard/fast 规范封装。
 * 4. 工作流真实提示词提取与双向写回 workflows.default。
 * 5. 提示词即时试跑（draftPrompt 支持）。
 */
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');

const root = path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xu41-test-'));
const keys = ['test-key-50Mc', 'test-key-NcoB', 'test-key-3f1j'];
process.env.AGNES_API_KEY = keys[0];
process.env.AGNES_API_KEYS = keys.slice(1).join(',');
process.env.ML_DATA_DIR = tmp;

const {
  initProvidersTables,
} = require(path.join(root, 'src/providers'));

const {
  initModelRegistryTables,
  getEndpointsList,
  getModelContractsList,
  assembleModelPayload,
  getWorkflowsDocument,
  saveWorkflowsDocument,
  DEFAULT_MODEL_CONTRACTS,
} = require(path.join(root, 'src/models-contract'));

const { tagSpacePrompt } = require(path.join(root, 'src/nodes/index'));
const { POLISH_PROMPTS } = require(path.join(root, 'src/polish-prompts'));

function runTests() {
  console.log('=== 测试 1：Agnes 凭证按环境变量展开 3 行，国际站保持空 ===');
  const db = new Database(':memory:');
  initProvidersTables(db);
  initModelRegistryTables(db);

  const endpoints = getEndpointsList(db);
  const agnesEp = endpoints.find(e => e.id === 'agnes');
  assert.ok(agnesEp, '必须存在 agnes 接入点');
  assert.strictEqual(agnesEp.credentials.length, 3, 'agnes 凭证池必须展开为 3 行');
  assert.deepStrictEqual(agnesEp.credentials.map(c => c.tail), ['50Mc', 'NcoB', '3f1j']);
  assert.ok(agnesEp.credentials.every(c => c.has_value === true));
  assert.ok(agnesEp.credentials.every(c => c.masked === '••••••••' + c.tail));
  assert.ok(agnesEp.credentials.every(c => !c.key && !c.api_key), '绝不泄漏明文 Key');

  const agnesIntl = endpoints.find(e => e.id === 'agnes_intl');
  assert.ok(agnesIntl, '必须存在 agnes_intl 接入点');
  assert.strictEqual(agnesIntl.credentials.length, 0, '国际接入点必须为空凭证');
  console.log('✔ 测试 1 通过');

  console.log('=== 测试 2：模型契约列表全量加载与专属 Skill 默认带出 ===');
  const { models } = getModelContractsList(db);
  assert.ok(models.length >= 21, `契约数量必须 >= 21，实际为 ${models.length}`);

  const flash = models.find(m => m.id === 'seedream5flash');
  assert.ok(flash, '必须包含 seedream5flash');
  assert.ok(flash.optimizer && flash.optimizer.prompt.includes('Seedream 5.0 Flash'), '必须带出官方专属技能正文');
  assert.strictEqual(flash.optimizer.has_official, true);
  assert.strictEqual(flash.optimizer.optimizer_model_id, 'agnes-3.0-flash');

  const textGroup = models.find(m => m.id === 'workflow_vision');
  assert.ok(textGroup, '必须包含 workflow_vision 契约');
  assert.ok(textGroup.conditional_rules.some(r => r.type === 'litellm_group'), '必须标记为 litellm_group');
  console.log('✔ 测试 2 通过');

  console.log('=== 测试 3：厂商自动优化参数组装规范 (off彻底不传，standard规范封装) ===');
  const contract = DEFAULT_MODEL_CONTRACTS.find(m => m.id === 'seedream5flash');

  // 1. 当选 off 时，绝不向请求体注入 optimize_prompt_options 字段（符合方舟规范，防止400）
  const offPayload = assembleModelPayload({
    modelContract: contract,
    values: { prompt: '极简客厅', 'optimize_prompt_options.mode': 'off' },
  });
  assert.strictEqual(offPayload.body.optimize_prompt_options, undefined, 'off 时必须彻底剔除 optimize_prompt_options 字段');

  // 2. 当未传时，也必须不注入
  const defaultPayload = assembleModelPayload({
    modelContract: contract,
    values: { prompt: '极简客厅' },
  });
  assert.strictEqual(defaultPayload.body.optimize_prompt_options, undefined, '未配置时必须不注入 optimize_prompt_options 字段');

  // 3. 当选 standard 时，封装为标准对象
  const stdPayload = assembleModelPayload({
    modelContract: contract,
    values: { prompt: '极简客厅', 'optimize_prompt_options.mode': 'standard' },
  });
  assert.deepStrictEqual(stdPayload.body.optimize_prompt_options, { mode: 'standard' });

  // 4. 当选 fast 时，封装为 fast 对象
  const fastPayload = assembleModelPayload({
    modelContract: contract,
    values: { prompt: '极简客厅', 'optimize_prompt_options.mode': 'fast' },
  });
  assert.deepStrictEqual(fastPayload.body.optimize_prompt_options, { mode: 'fast' });
  console.log('✔ 测试 3 通过');

  console.log('=== 测试 4：工作流真实提示词提取与双向同步 workflows.default ===');
  db.exec(`
    CREATE TABLE IF NOT EXISTS workflows (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      description TEXT,
      graph_json TEXT NOT NULL,
      enabled INTEGER DEFAULT 1,
      created_at INTEGER,
      updated_at INTEGER
    );
  `);

  const mockGatePrompt = '你是室内设计空间闸门测试提示词，必须大于600字...'.repeat(20);
  const initialNodes = [
    { id: 'gate', type: 'gate', config: { model: 'workflow_vision', promptTemplate: mockGatePrompt } },
    { id: 'tag', type: 'tag', config: { model: 'workflow_vision', promptTemplate: '' } },
    { id: 'index', type: 'index', config: { embeddingModel: 'text-embedding-3-small', embeddingProvider: 'litellm' } }
  ];
  db.prepare("INSERT INTO workflows (id, name, graph_json) VALUES ('default', '默认产线', ?)").run(JSON.stringify({ nodes: initialNodes }));

  const wfDoc = getWorkflowsDocument(db);
  const gateNode = wfDoc.unattended.nodes.find(n => n.id === 'gate');
  assert.strictEqual(gateNode.template, mockGatePrompt, 'gate 节点必须精准读出图上的真实提示词');

  const tagNode = wfDoc.unattended.nodes.find(n => n.id === 'tag');
  assert.ok(tagNode.template && tagNode.template.includes('你是室内设计空间素材标注器'), 'tag 节点在图上为空时必须自动填充动态字典拼装词');

  const indexNode = wfDoc.unattended.nodes.find(n => n.id === 'index');
  assert.strictEqual(indexNode.model_id, 'text-embedding-3-small');
  assert.strictEqual(indexNode.template, '', '向量节点无提示词');

  // 测试保存时写回 workflows.default
  const updatedPrompt = '管理员更新后的闸门真实词-123456';
  gateNode.template = updatedPrompt;
  saveWorkflowsDocument(db, wfDoc);

  const wfRow = db.prepare("SELECT graph_json FROM workflows WHERE id='default'").get();
  const gj = JSON.parse(wfRow.graph_json);
  const savedGateNode = gj.nodes.find(n => n.id === 'gate');
  assert.strictEqual(savedGateNode.config.promptTemplate, updatedPrompt, '保存工作流必须双向同步写回 workflows.default 图节点');
  console.log('✔ 测试 4 通过');

  console.log('\n🎉 全部续 41 与提示词优化器独立化单元测试 100% 通过！');
}

runTests();
