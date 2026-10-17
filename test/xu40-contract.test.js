/**
 * 续 40：Agnes 钥匙不再掉进 LiteLLM，Qwen 挂 9000，Seedance 技能与时长，文本模型分组。
 * 断言只用指纹，不打印钥匙。
 */
const assert = require('assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');

const root = path.join(__dirname, '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'xu40-'));
const keys = ['dom-key-1', 'dom-key-2', 'dom-key-3'];
process.env.AGNES_API_KEY = keys[0];
process.env.AGNES_API_KEYS = keys.slice(1).join(',');
process.env.ML_DATA_DIR = tmp;

const {
  initModelRegistryTables,
  resolveEndpointAuth,
  getModelContractsList,
  GATEWAY_GROUP_NAMES,
  assembleModelPayload,
  DEFAULT_MODEL_CONTRACTS,
} = require(path.join(root, 'src/models-contract'));
const {
  initProvidersTables,
  fallbackApiKey,
  collapseDuplicateTextModels,
  endpointIdForAdapter,
  DEFAULT_MODELS,
  resolveGatewayModelCapabilities,
  maskSensitiveText,
} = require(path.join(root, 'src/providers'));
const { snapMultipleOf32, qwenRoutes } = require(path.join(root, 'src/gen/qwenimage-local'));
const { isDeterministicErrorText, isTransientErrorText } = require(path.join(root, 'src/nodes/index'));

function fp(value) {
  return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 8);
}

function testMounts() {
  const db = new Database(':memory:');
  initProvidersTables(db);
  initModelRegistryTables(db);

  const qwen = db.prepare("SELECT endpoint_id, path, poll_path FROM llm_capabilities WHERE id='qwenimage_local'").get();
  assert.strictEqual(qwen.endpoint_id, 'qwen_lan');
  assert.strictEqual(qwen.path, '/api/qw/generate');
  assert.strictEqual(qwen.poll_path, '/api/qw/tasks/{{taskId}}');
  const umbra = db.prepare("SELECT id FROM llm_capabilities WHERE endpoint_id='local_host' AND id='qwenimage_local'").get();
  assert.strictEqual(umbra, undefined);

  const intl = db.prepare("SELECT credentials_json, base_url FROM llm_endpoints WHERE id='agnes_intl'").get();
  assert.strictEqual(intl.base_url, 'https://apihub.agnes-ai.com/v1');
  assert.deepStrictEqual(JSON.parse(intl.credentials_json), []);
  const intlAuth = resolveEndpointAuth(db, db.prepare("SELECT * FROM llm_endpoints WHERE id='agnes_intl'").get());
  assert.strictEqual(intlAuth.has_key, false);

  const domestic = db.prepare("SELECT * FROM llm_endpoints WHERE id='agnes'").get();
  const seen = new Set();
  for (let i = 0; i < 6; i++) {
    const auth = resolveEndpointAuth(db, domestic);
    assert.strictEqual(auth.has_key, true);
    seen.add(fp(auth.apiKey));
  }
  assert.deepStrictEqual([...seen].sort(), keys.map(fp).sort());

  const list = getModelContractsList(db).models;
  const s20 = list.find((m) => m.id === 'seedance2_0');
  const s25 = list.find((m) => m.id === 'seedance2_5');
  const d20 = s20.params.find((p) => p.key === 'duration');
  const d25 = s25.params.find((p) => p.key === 'duration');
  assert.strictEqual(d20.type, 'duration');
  assert.strictEqual(d20.max, 15);
  assert.strictEqual(d20.default, 5);
  assert.strictEqual(d25.max, 30);
  assert.strictEqual(d25.default, -1);
  assert.ok(s20.params.some((p) => p.key === 'resolution'));
  assert.ok(String(s20.optimizer.prompt).includes('4–15'));
  assert.ok(String(s25.optimizer.prompt).includes('Seedance 2.5'));

  db.prepare("UPDATE model_contracts SET optimizer_json=? WHERE id='seedance2_0'")
    .run(JSON.stringify({ optimizer_model_id: 'agnes3_0flash', prompt: 'KEEP ME' }));
  initModelRegistryTables(db);
  const kept = JSON.parse(db.prepare("SELECT optimizer_json FROM model_contracts WHERE id='seedance2_0'").get().optimizer_json);
  assert.strictEqual(kept.prompt, 'KEEP ME');

  const broken = s20.params.map((p) => (p.key === 'duration' ? { ...p, type: 'number', max: 12 } : p)).filter((p) => p.key !== 'resolution');
  db.prepare("UPDATE model_contracts SET params_json=? WHERE id='seedance2_0'").run(JSON.stringify(broken));
  initModelRegistryTables(db);
  const repaired = JSON.parse(db.prepare("SELECT params_json FROM model_contracts WHERE id='seedance2_0'").get().params_json);
  assert.strictEqual(repaired.find((p) => p.key === 'duration').max, 15);
  assert.ok(repaired.some((p) => p.key === 'resolution'));

  const text = list.find((m) => m.id === 'workflow_vision');
  assert.strictEqual(text.kind, 'chat');
  assert.ok(GATEWAY_GROUP_NAMES.has('workflow_vision'));
  assert.strictEqual(list.find((m) => m.id === 'gemini-flash-latest').enabled, false);
  assert.ok(list.some((m) => m.id === 'agnes-3.0-flash'));

  db.prepare(`INSERT INTO llm_models (id, provider_id, name, model_code, capabilities, enabled, created_at, updated_at)
    VALUES ('dup-openai', 'volcengine', 'dup', 'openai/agnes-3.0-flash', 'chat', 1, 0, 0)`).run();
  db.prepare(`INSERT INTO llm_models (id, provider_id, name, model_code, capabilities, enabled, created_at, updated_at)
    VALUES ('keep-image', 'volcengine', 'img', 'doubao-seedream-5-0-flash-260915', 'image', 1, 0, 0)`).run();
  db.prepare(`INSERT INTO llm_models (id, provider_id, name, model_code, capabilities, enabled, created_at, updated_at)
    VALUES ('litellm_agnes-3.0-flash', 'litellm', 'gw', 'agnes-3.0-flash', 'chat', 1, 0, 0)`).run();
  collapseDuplicateTextModels(db);
  assert.strictEqual(db.prepare("SELECT enabled FROM llm_models WHERE id='dup-openai'").get().enabled, 0);
  assert.strictEqual(db.prepare("SELECT enabled FROM llm_models WHERE id='keep-image'").get().enabled, 1);
  assert.strictEqual(db.prepare("SELECT enabled FROM llm_models WHERE id='litellm_agnes-3.0-flash'").get().enabled, 1);
}

function testQwenAndAuth() {
  assert.strictEqual(snapMultipleOf32(1080), 1088);
  assert.strictEqual(snapMultipleOf32(1920), 1920);
  assert.strictEqual(snapMultipleOf32(0), 0);
  assert.ok(qwenRoutes('http://192.168.1.107:9000').submit.endsWith('/api/qw/generate'));
  assert.ok(qwenRoutes('http://192.168.1.107:8003').task('abc').includes('/api/tasks/abc'));

  const decided = fallbackApiKey('agnes', '', 'sk-litellm-should-not-leak');
  assert.strictEqual(decided.apiKey, '');
  assert.ok(decided.error.includes('agnes'));
  assert.strictEqual(fallbackApiKey('litellm', '', 'gateway-key').apiKey, 'gateway-key');
  assert.strictEqual(fallbackApiKey('qwen_lan', '', 'gateway-key').apiKey, '');
  assert.strictEqual(fallbackApiKey('qwen_lan', '', 'gateway-key').error, '');

  const real = '生成服务请求失败 HTTP 401: {"error":{"code":"","message":"无效的令牌","request_id":"r1"}}';
  assert.strictEqual(isDeterministicErrorText(real), true);
  assert.strictEqual(isTransientErrorText(real), false);
  const bare = 'HTTP 401 无效的令牌';
  assert.strictEqual(isDeterministicErrorText(bare), false);
  assert.strictEqual(isTransientErrorText(bare), true);
}

function testSuspiciousPoints() {
  const db = new Database(':memory:');
  initProvidersTables(db);
  initModelRegistryTables(db);

  // 1. 国际站凭据保护与误复制清除：
  // 1a. 与国内凭证相同的旧值会被清掉成 '[]'
  const domesticCreds = db.prepare("SELECT credentials_json FROM llm_endpoints WHERE id='agnes'").get().credentials_json;
  db.prepare("UPDATE llm_endpoints SET credentials_json=? WHERE id='agnes_intl'").run(domesticCreds);
  initModelRegistryTables(db);
  assert.strictEqual(db.prepare("SELECT credentials_json FROM llm_endpoints WHERE id='agnes_intl'").get().credentials_json, '[]');

  // 1b. agnes_intl 若被设成只含 AGNES_API_KEY 的数组，初始化后必须是 '[]'
  db.prepare("UPDATE llm_endpoints SET credentials_json='[\"AGNES_API_KEY\"]' WHERE id='agnes_intl'").run();
  initModelRegistryTables(db);
  assert.strictEqual(db.prepare("SELECT credentials_json FROM llm_endpoints WHERE id='agnes_intl'").get().credentials_json, '[]');

  // 1c. '["intl-only"]' 这种管理员配置的不同列表在第二次 initModelRegistryTables 后仍然在
  db.prepare("UPDATE llm_endpoints SET credentials_json='[\"intl-only\"]' WHERE id='agnes_intl'").run();
  initModelRegistryTables(db);
  assert.strictEqual(db.prepare("SELECT credentials_json FROM llm_endpoints WHERE id='agnes_intl'").get().credentials_json, '["intl-only"]');

  // 1d. '[]' 保持空
  db.prepare("UPDATE llm_endpoints SET credentials_json='[]' WHERE id='agnes_intl'").run();
  initModelRegistryTables(db);
  assert.strictEqual(db.prepare("SELECT credentials_json FROM llm_endpoints WHERE id='agnes_intl'").get().credentials_json, '[]');

  // 1e. 把 agnes 改成只含 AGNES_API_KEY 的数组，把 gemini 改成 ["STALE"]，再跑一次 initModelRegistryTables
  db.prepare("UPDATE llm_endpoints SET credentials_json='[\"AGNES_API_KEY\"]' WHERE id='agnes'").run();
  db.prepare("UPDATE llm_endpoints SET credentials_json='[\"STALE\"]' WHERE id='gemini'").run();
  initModelRegistryTables(db);

  // agnes 的 credentials_json 只保留环境变量名
  const agnesCreds = db.prepare("SELECT credentials_json FROM llm_endpoints WHERE id='agnes'").get().credentials_json;
  assert.ok(!agnesCreds.includes('provider_secrets'), 'agnes 不再引用密钥文件');
  assert.strictEqual(agnesCreds, '["AGNES_API_KEY"]');

  // gemini 必须回到 DEFAULT_ENDPOINTS 里该接入点的 credentials，不能留下 STALE
  const geminiCreds = db.prepare("SELECT credentials_json FROM llm_endpoints WHERE id='gemini'").get().credentials_json;
  assert.ok(!geminiCreds.includes('STALE'), 'gemini 不能留下 STALE');
  assert.ok(geminiCreds.includes('GEMINI_API_KEY'), 'gemini 必须回到默认配置');

  // 2. seedStoredContract 每次启动保留用户改过的显示名、非 Seedance 的已有参数
  db.prepare("UPDATE model_contracts SET name='用户自定义名', params_json='[]' WHERE id='agnes-3.0-flash'").run();
  initModelRegistryTables(db);
  const userRenamed = db.prepare("SELECT name, params_json FROM model_contracts WHERE id='agnes-3.0-flash'").get();
  assert.strictEqual(userRenamed.name, '用户自定义名');
  assert.strictEqual(userRenamed.params_json, '[]');

  // 3. endpointIdForAdapter: 不相关适配器不能被误判为 volc_ark 或 qwen_lan
  assert.strictEqual(endpointIdForAdapter({ id: 'ark_video_ad', protocol: 'ark_video' }), 'volc_ark');
  assert.strictEqual(endpointIdForAdapter({ id: 'seedance2_0', provider: 'volcengine' }), 'volc_ark');
  assert.strictEqual(endpointIdForAdapter({ id: 'unrelated_seed_tool', provider: 'my_co' }), 'my_co');
  assert.strictEqual(endpointIdForAdapter({ id: 'custom_ark_helper', provider: 'other_co' }), 'other_co');
  assert.notStrictEqual(endpointIdForAdapter({ id: 'some_service', base_url: 'http://192.168.1.50:9000' }), 'qwen_lan');
  assert.strictEqual(endpointIdForAdapter({ id: 'qwen_lan', base_url: 'http://192.168.1.107:9000' }), 'qwen_lan');
  assert.strictEqual(endpointIdForAdapter({ id: 'local_host', base_url: 'http://127.0.0.1:3001' }), 'local_host');
  assert.notStrictEqual(endpointIdForAdapter({ id: 'remote_app', base_url: 'http://otherhost:3001' }), 'local_host');

  // 4. fallbackApiKey: local_host 不报错，未知接入点无钥匙直接报错
  const localAuth = fallbackApiKey('local_host', '', '');
  assert.strictEqual(localAuth.apiKey, '');
  assert.strictEqual(localAuth.error, '');
  const unknownAuth = fallbackApiKey('unconfigured_gateway', '', 'sk-litellm-secret');
  assert.strictEqual(unknownAuth.apiKey, '');
  assert.ok(unknownAuth.error.includes('没有钥匙'));

  // 5. 启动禁用名单不要关掉 model_text_input, model_image_input, model_video_input
  const inputModels = DEFAULT_MODELS.filter(m => ['model_text_input', 'model_image_input', 'model_video_input'].includes(m.model_code));
  assert.strictEqual(inputModels.length, 3);
  for (const im of inputModels) {
    assert.strictEqual(im.enabled, 1);
  }

  // 6. assembleModelPayload 图层拆分 2K 不会变成 auto，透明底 0 张图/2 张图抛出异常
  const flashContract = DEFAULT_MODEL_CONTRACTS.find(m => m.id === 'seedream5flash');
  const payload2k = assembleModelPayload({
    modelContract: flashContract,
    values: { layer_decomposition: true, size: '2K' },
    editablePrompt: '测试图层拆分',
  });
  assert.strictEqual(payload2k.body.size, '2K');

  assert.throws(() => {
    assembleModelPayload({
      modelContract: flashContract,
      values: { background: 'transparent' },
      images: [],
    });
  }, /透明背景必须且仅支持传入单张参考图/);

  assert.throws(() => {
    assembleModelPayload({
      modelContract: flashContract,
      values: { background: 'transparent' },
      images: ['https://example.com/1.png', 'https://example.com/2.png'],
    });
  }, /透明背景必须且仅支持传入单张参考图/);

  const payloadTransparent = assembleModelPayload({
    modelContract: flashContract,
    values: { background: 'transparent' },
    images: ['https://example.com/1.png'],
  });
  assert.strictEqual(payloadTransparent.body.background, 'transparent');
  assert.strictEqual(payloadTransparent.body.output_format, 'png');

  // 7. 网关文本模型能力推断纯函数测试
  const capsVideoInput = resolveGatewayModelCapabilities('model_video_input');
  assert.ok(capsVideoInput.includes('chat'), 'model_video_input 必须包含 chat');
  assert.notStrictEqual(capsVideoInput, 'video', 'model_video_input 不能等于单独的 video');
  assert.strictEqual(capsVideoInput, 'chat,vision,tag');
  assert.strictEqual(resolveGatewayModelCapabilities('model_image_input'), 'chat,vision,tag');
  assert.strictEqual(resolveGatewayModelCapabilities('workflow_vision'), 'chat,vision,tag');
  assert.strictEqual(resolveGatewayModelCapabilities('workflow_vision_low'), 'chat,vision,tag');
  assert.strictEqual(resolveGatewayModelCapabilities('model_text_input'), 'chat,vision,tag');
  assert.strictEqual(resolveGatewayModelCapabilities('agnes-3.0-flash'), 'chat');

  // 8. 密钥脱密与字段名保持测试（不含真实钥匙）
  const sampleJson = '{"error":{"message":"Invalid token","api_key":"dummy_test_secret_12345"}}';
  const scrubbedJson = maskSensitiveText(sampleJson);
  assert.ok(!scrubbedJson.includes('dummy_test_secret_12345'), '原密钥值不能留在输出中');
  assert.ok(scrubbedJson.includes('"api_key":"***"'), '输出中必须保持 api_key 字段并打码为 ***');
  assert.ok(!scrubbedJson.includes('$1'), '输出中严禁出现字面量 $1');

  const sampleUrl = 'http://localhost:4000/v1/models?api_key=dummy_test_secret_67890&type=test';
  const scrubbedUrl = maskSensitiveText(sampleUrl);
  assert.ok(!scrubbedUrl.includes('dummy_test_secret_67890'));
  assert.ok(scrubbedUrl.includes('api_key=***'));
  assert.ok(!scrubbedUrl.includes('$1'));

  const sampleBearer = 'Authorization: Bearer dummy_test_token_abcdef';
  const scrubbedBearer = maskSensitiveText(sampleBearer);
  assert.ok(!scrubbedBearer.includes('dummy_test_token_abcdef'));
  assert.ok(scrubbedBearer.includes('Bearer ***'));
  assert.ok(!scrubbedBearer.includes('$1'));
}

testMounts();
testQwenAndAuth();
testSuspiciousPoints();
console.log('xu40-contract ok');

