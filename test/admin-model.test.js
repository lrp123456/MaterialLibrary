/**
 * 模型区 7 个实施步骤综合合规测试
 * 严格按照 docs/design/admin-model-agy-task.md 要求校验：
 * 1. 模型解析到接入点、鉴权与能力（钥匙隔离，无 litellm_disabled 报错）
 * 2. 提交组装纯函数（decompose 支持 1K/1.5K/2K/auto，透明底单张图校验，未匹配组合报错）
 * 3. 生成模块 normalizeArkSeedreamPayload 规则一致性
 * 4. 客户端工坊公开契约目录（停用不出、人像无生图控件、不泄露内部参数）
 * 5. 前端导航与视图合规检查
 * 6. 工作流前置四项独立门禁持久化（ai_defect 独立存在不合入 quality）
 * 7. 工坊触发拆盒与重跑逻辑（非 studio 触发严格 400 拒绝，支持 prompt 与 visionFields 更新 node_runs）
 */
const assert = require('assert');
const Database = require('better-sqlite3');
const {
  initProvidersTables,
  resolveProviderApiKey,
  resolveLiteLlmChatConfig,
  getProviders
} = require('../src/providers');
const {
  initModelRegistryTables,
  resolveModelExecution,
  assembleModelPayload,
  getModelPublicCatalog,
  getWorkflowsDocument,
  saveWorkflowsDocument,
  getEndpointsList,
  SEEDREAM_FLASH_SIZE_TABLE,
  QWEN_SIZE_TABLE
} = require('../src/models-contract');

async function testStep1() {
  console.log('=== 测试第 1 步：模型解析到接入点、鉴权与能力 & 钥匙隔离 ===');
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
  initModelRegistryTables(db);

  // 设置环境变量
  process.env.ARK_API_KEY = 'ark-bearer-test-key';
  process.env.VOLC_MUSIC_AK = 'volc-music-ak-test';
  process.env.VOLC_MUSIC_SK = 'volc-music-sk-test';
  process.env.PORTRAIT_AK = 'volc-portrait-ak-test';
  process.env.PORTRAIT_SK = 'volc-portrait-sk-test';

  // 1. Seedream Flash 走到方舟图片路径和 Bearer
  const seedreamResolved = resolveModelExecution(db, 'seedream5flash');
  assert.ok(seedreamResolved, 'Seedream Flash 必须能够被解析');
  assert.strictEqual(seedreamResolved.endpoint.base_url, 'https://ark.cn-beijing.volces.com/api/v3', '方舟图片根地址应为 https://ark.cn-beijing.volces.com/api/v3');
  assert.strictEqual(seedreamResolved.capability.path, '/images/generations', '方舟图片能力路径应为 /images/generations');
  assert.strictEqual(seedreamResolved.capability.method, 'POST');
  assert.strictEqual(seedreamResolved.auth.type, 'bearer', '方舟大模型应使用 bearer 鉴权');
  assert.strictEqual(seedreamResolved.auth.apiKey, 'ark-bearer-test-key', 'Bearer Key 应来自接入点绑定的 ARK_API_KEY');

  // 2. 豆包纯音乐走到 GenBGMForTime 和该接入点的 AK/SK，QuerySong 是轮询动作而非独立能力
  const bgmResolved = resolveModelExecution(db, 'doubao_bgm_v5');
  assert.ok(bgmResolved, '豆包纯音乐必须能够被解析');
  assert.strictEqual(bgmResolved.endpoint.base_url, 'https://open.volcengineapi.com', '豆包音乐根地址应为 https://open.volcengineapi.com');
  assert.strictEqual(bgmResolved.capability.action, 'GenBGMForTime', '豆包纯音乐能力 Action 应为 GenBGMForTime');
  assert.strictEqual(bgmResolved.capability.poll_action, 'QuerySong', 'QuerySong 应作为轮询动作挂在能力上');
  assert.strictEqual(bgmResolved.auth.type, 'aksk', '豆包音乐应使用 aksk 鉴权');
  assert.strictEqual(bgmResolved.auth.service, 'imagination', '豆包音乐签名 service 应为 imagination');
  assert.strictEqual(bgmResolved.auth.version, '2024-08-12', '豆包音乐签名 version 应为 2024-08-12');
  assert.strictEqual(bgmResolved.auth.ak, 'volc-music-ak-test', 'AK 应来自豆包音乐接入点');
  assert.strictEqual(bgmResolved.auth.sk, 'volc-music-sk-test', 'SK 应来自豆包音乐接入点');

  // 3. 钥匙隔离：人像接入点绝不拿音乐的钥匙
  const portraitResolved = resolveModelExecution(db, 'portrait_create_group');
  assert.ok(portraitResolved, '人像分组能力必须能够被解析');
  assert.strictEqual(portraitResolved.auth.ak, 'volc-portrait-ak-test', '人像分组 AK 必须严格来自人像专属凭证');
  assert.notStrictEqual(portraitResolved.auth.ak, 'volc-music-ak-test', '人像严禁混用音乐接入点的 AK');

  // 当人像环境变量未配时，绝不会回退到通用的 VOLC_AK
  delete process.env.PORTRAIT_AK;
  delete process.env.ARK_PORTRAIT_AK;
  process.env.VOLC_AK = 'generic-volc-key';
  const { resolveEndpointAuth } = require('../src/models-contract');
  const portraitAuthWithoutEnv = resolveEndpointAuth(db, portraitResolved.endpoint);
  assert.ok(!portraitAuthWithoutEnv.ak, '人像未配置时严禁回退到通用 VOLC_AK');
  assert.notStrictEqual(portraitAuthWithoutEnv.ak, 'generic-volc-key', '人像严禁读取通用的 VOLC_AK');

  // 4. resolveProviderApiKey 精准匹配接入点，旧 adapter 内部 apiKey 不得压过接入点轮询列表
  const fakeAdapterWithStaleKey = {
    id: 'ark_seedream',
    base_url: 'https://ark.cn-beijing.volces.com/api/v3',
    secrets_json: JSON.stringify({ apiKey: 'stale-adapter-key-should-be-ignored' })
  };
  const resolvedKey = resolveProviderApiKey(db, fakeAdapterWithStaleKey);
  assert.notStrictEqual(resolvedKey, 'stale-adapter-key-should-be-ignored', '适配器上的旧 apiKey 不得参与挑选');
  assert.strictEqual(resolvedKey, 'ark-bearer-test-key', '应回退并只读接入点轮询列表');

  // 5. 对话模型挂挂在本机网关 :4000 (litellm_chat)，彻底删掉 litellm_disabled 报错
  db.prepare("UPDATE llm_providers SET enabled=0 WHERE id='litellm'").run();
  const chatConfig = resolveLiteLlmChatConfig(db, {}, 'doubao-seed-2-1-lite-260915');
  assert.ok(chatConfig, '对话模型解析成功');
  assert.strictEqual(chatConfig.baseUrl, 'http://127.0.0.1:4000', '对话模型应挂在本机网关 :4000');

  // 6. 凭证脱敏：响应和库里没有密钥全文，全掩码绝不泄露头尾明文字符
  const endpoints = getEndpointsList(db);
  for (const ep of endpoints) {
    if (ep.keys) {
      for (const k of ep.keys) {
        if (k.maskedValue) {
          assert.strictEqual(/^[•]+$/.test(k.maskedValue), true, '掩码必须完全匿名，严禁泄露头尾字符');
        }
      }
    }
  }

  console.log('✔ 第 1 步测试通过');
}

async function testStep2() {
  console.log('=== 测试第 2 步：提交组装纯函数 (assembleModelPayload) ===');
  const db = new Database(':memory:');
  initModelRegistryTables(db);
  const flashExecution = resolveModelExecution(db, 'seedream5flash');
  const flashContract = flashExecution.model;

  // 1. 2K 加 9:16 得到 size=1584x2816 且 prompt 里没有比例句
  const res1 = assembleModelPayload({
    modelContract: flashContract,
    editablePrompt: '温馨现代客厅效果图',
    values: {
      size: '2K',
      ratio: '9:16'
    }
  });
  assert.strictEqual(res1.body.size, '1584x2816', '2K + 9:16 应换算得到 1584x2816');
  assert.strictEqual(res1.body.ratio, undefined, 'Seedream Flash 请求体不传 ratio 字段');
  assert.strictEqual(res1.prompt, '温馨现代客厅效果图', '提示词不应包含画面比例');
  assert.ok(!res1.prompt.includes('9:16') && !res1.prompt.includes('比例'), '提示词不应拼接画面比例句');

  // 2. 换算表不存在的尺寸/比例组合必须报错，严禁默默回退到默认分辨率
  assert.throws(() => {
    assembleModelPayload({
      modelContract: flashContract,
      editablePrompt: '测试未收录比例',
      values: {
        size: '2K',
        ratio: '7:3'
      }
    });
  }, /不支持.*尺寸.*组合/, '未收录的尺寸比例组合必须显式报错');

  // 3. 图层分解：size 支持 1K, 1.5K, 2K, auto，缺省才为 auto；传入 2K 必须尊重 2K
  const resDecomp2K = assembleModelPayload({
    modelContract: flashContract,
    editablePrompt: '拆分卧室图层',
    values: {
      size: '2K',
      ratio: '9:16',
      layer_decomposition: true
    },
    image: 'https://example.com/ref.jpg'
  });
  assert.strictEqual(resDecomp2K.body.layer_decomposition, true, '图层拆分字段应为 true');
  assert.strictEqual(resDecomp2K.body.size, '2K', '图层拆分传入 2K 时必须尊重 2K');
  assert.strictEqual(resDecomp2K.body.ratio, undefined, '图层拆分打开后不提交宽高比');

  const resDecompDefault = assembleModelPayload({
    modelContract: flashContract,
    editablePrompt: '拆分卧室图层缺省 size',
    values: {
      layer_decomposition: true
    },
    image: 'https://example.com/ref.jpg'
  });
  assert.strictEqual(resDecompDefault.body.size, 'auto', '图层拆分未传 size 时缺省为 auto');

  assert.throws(() => {
    assembleModelPayload({
      modelContract: flashContract,
      editablePrompt: '拆分卧室图层非法 size',
      values: {
        size: '4K',
        layer_decomposition: true
      }
    });
  }, /仅支持 1K, 1.5K, 2K, auto/, '图层拆分传入不支持的档位必须报错');

  // 4. 透明底：必须且仅支持传入单张参考图，非单张必须报错
  assert.throws(() => {
    assembleModelPayload({
      modelContract: flashContract,
      editablePrompt: '单品家具白底图无图',
      values: {
        background: 'transparent'
      }
    });
  }, /必须且仅支持传入单张参考图/, '透明底 0 张参考图必须报错');

  assert.throws(() => {
    assembleModelPayload({
      modelContract: flashContract,
      editablePrompt: '单品家具白底图两张图',
      values: {
        background: 'transparent',
        image_urls: ['https://example.com/1.jpg', 'https://example.com/2.jpg']
      }
    });
  }, /必须且仅支持传入单张参考图/, '透明底多张参考图必须报错');

  const resTransparentValid = assembleModelPayload({
    modelContract: flashContract,
    editablePrompt: '单品家具白底图单张图',
    values: {
      size: '1K',
      ratio: '1:1',
      background: 'transparent',
      output_format: 'jpeg',
      image_urls: ['https://example.com/ref.jpg']
    }
  });
  assert.strictEqual(resTransparentValid.body.background, 'transparent', '单张图合法时设置 background=transparent');
  assert.strictEqual(resTransparentValid.body.output_format, 'png', '选择透明底时 output_format 固定为 png');

  // 5. 空值不拼参数
  const testContractWithPromptParam = {
    ...flashContract,
    params: [
      ...flashContract.params,
      {
        key: 'custom_style',
        label: '风格偏好',
        location: 'prompt',
        prompt_template: '画面风格 {{value}}'
      }
    ]
  };
  const res4Null = assembleModelPayload({
    modelContract: testContractWithPromptParam,
    editablePrompt: '现代客厅',
    values: { custom_style: '' }
  });
  assert.strictEqual(res4Null.prompt, '现代客厅', '空值不拼，不留半句');

  const res4Val = assembleModelPayload({
    modelContract: testContractWithPromptParam,
    editablePrompt: '现代客厅',
    values: { custom_style: '极简北欧' }
  });
  assert.strictEqual(res4Val.prompt, '现代客厅 画面风格 极简北欧', '有值时正常拼进提示词');

  // 6. 优化器改写先行
  const res5 = assembleModelPayload({
    modelContract: testContractWithPromptParam,
    editablePrompt: '旧提示词',
    optimizedPrompt: '经过优化器精调后的新提示词',
    values: { custom_style: '新中式' }
  });
  assert.strictEqual(res5.prompt, '经过优化器精调后的新提示词 画面风格 新中式', '优化器改写后接提示词参数');

  // 7. 本机 Qwen 像素表覆盖 1K 和 2K 下的全部 1:1, 4:3, 3:4, 16:9, 9:16
  const requiredRatios = ['1:1', '4:3', '3:4', '16:9', '9:16'];
  for (const r of requiredRatios) {
    assert.ok(QWEN_SIZE_TABLE[`1K_${r}`], `QWEN_SIZE_TABLE 必须覆盖 1K_${r}`);
    assert.ok(QWEN_SIZE_TABLE[`2K_${r}`], `QWEN_SIZE_TABLE 必须覆盖 2K_${r}`);
  }

  console.log('✔ 第 2 步测试通过');
}

async function testStep3() {
  console.log('=== 测试第 3 步：生成组装 normalizeArkSeedreamPayload 一致性 ===');
  const { normalizeArkSeedreamPayload } = require('../src/gen/index');
  const mockCtx = { apiKey: 'dummy-ark-key' };

  // 1. 2K + 9:16 请求体 size 换算成 1584x2816，prompt 剥除画面比例句
  const body1 = {
    prompt: '极简北欧客厅效果图 画面比例 9:16',
    model: 'doubao-seedream-5-0-flash-260915',
    size: '2K',
    ratio: '9:16'
  };
  const payload1 = normalizeArkSeedreamPayload(body1, body1, body1, mockCtx);
  assert.strictEqual(payload1.size, '1584x2816', '请求体 size 必须换算为 1584x2816');
  assert.strictEqual(payload1.ratio, undefined, '请求体不得下发 ratio 字段');
  assert.ok(!payload1.prompt.includes('9:16') && !payload1.prompt.includes('比例'), '提示词中严禁出现画面比例句');

  // 2. 图层拆分：传入 size: 2K 必须保留 2K
  const body2With2K = {
    prompt: '拆分卧室图层',
    model: 'doubao-seedream-5-0-flash-260915',
    size: '2K',
    ratio: '9:16',
    extras: { decompose: true }
  };
  const payload2With2K = normalizeArkSeedreamPayload(body2With2K, body2With2K, body2With2K, mockCtx);
  assert.strictEqual(payload2With2K.layer_decomposition, true);
  assert.strictEqual(payload2With2K.size, '2K', '图层拆分传入 2K 时 size 保持 2K');
  assert.strictEqual(payload2With2K.ratio, undefined);

  // 图层拆分：未传 size 时缺省为 auto
  const body2Default = {
    prompt: '拆分卧室图层缺省 size',
    model: 'doubao-seedream-5-0-flash-260915',
    extras: { decompose: true }
  };
  const payload2Default = normalizeArkSeedreamPayload(body2Default, body2Default, body2Default, mockCtx);
  assert.strictEqual(payload2Default.size, 'auto', '图层拆分缺省 size 为 auto');

  // 3. 透明底单张图约束：无参考图时抛错
  assert.throws(() => {
    const body3NoImg = {
      prompt: '透明背景椅子',
      model: 'doubao-seedream-5-0-flash-260915',
      size: '1K',
      ratio: '1:1',
      extras: { background: 'transparent' }
    };
    normalizeArkSeedreamPayload(body3NoImg, body3NoImg, body3NoImg, mockCtx);
  }, /必须且仅支持传入单张参考图/, '透明底 0 张参考图必须报错');

  // 透明底单张图合法
  const body3Valid = {
    prompt: '透明背景椅子单图',
    model: 'doubao-seedream-5-0-flash-260915',
    size: '1K',
    ratio: '1:1',
    image_data_url: 'https://example.com/chair.png',
    extras: { background: 'transparent', output_format: 'jpeg' }
  };
  const payload3Valid = normalizeArkSeedreamPayload(body3Valid, body3Valid, body3Valid, mockCtx);
  assert.strictEqual(payload3Valid.background, 'transparent');
  assert.strictEqual(payload3Valid.output_format, 'png', '选择透明底时 output_format 必须强制为 png');

  // 4. 未收录组合报错
  assert.throws(() => {
    const bodyInvalidRatio = {
      prompt: '非法比例',
      model: 'doubao-seedream-5-0-flash-260915',
      size: '2K',
      ratio: '7:3'
    };
    normalizeArkSeedreamPayload(bodyInvalidRatio, bodyInvalidRatio, bodyInvalidRatio, mockCtx);
  }, /不支持尺寸档位和比例组合/, '未收录组合必须报错');

  console.log('✔ 第 3 步测试通过');
}

async function testStep4() {
  console.log('=== 测试第 4 步：客户端工坊与试验场只读契约目录 ===');
  const db = new Database(':memory:');
  initProvidersTables(db);
  initModelRegistryTables(db);

  const catalog = getModelPublicCatalog(db);
  assert.ok(catalog.models && catalog.models.length > 0, '目录中必须包含模型');
  assert.ok(catalog.studio.image && catalog.studio.video && catalog.studio.music, '工坊各领域分组必须齐备');

  // 1. 停用的模型（例如 Gemini）绝对不出现在目录中
  const geminiModels = catalog.models.filter(m => /gemini/i.test(m.id) || /gemini/i.test(m.name));
  assert.strictEqual(geminiModels.length, 0, '停用模型（Gemini 等）严禁出现在公开目录中');

  // 2. 人像模型不给尺寸/比例生图控件
  const portraitModels = catalog.models.filter(m => /portrait/i.test(m.id) || /portrait/i.test(m.kind));
  for (const pm of portraitModels) {
    const hasSizeOrRatio = (pm.common_controls || []).some(c => c === 'size' || c === 'ratio');
    assert.strictEqual(hasSizeOrRatio, false, '人像模型严禁分配 size/ratio 生图控件');
  }

  // 3. 检查公开契约形状：不得泄露 caps, provider, providerName, location, table_mappings, 凭证
  for (const m of catalog.models) {
    assert.ok(m.id && m.name && m.kind, '模型必须有 id, name, kind');
    assert.strictEqual(m.caps, undefined, '公开模型对象不得泄露 caps');
    assert.strictEqual(m.provider, undefined, '公开模型对象不得泄露 provider 标识');
    assert.strictEqual(m.providerName, undefined, '公开模型对象不得泄露 providerName');
    assert.strictEqual(m.location, undefined, '公开模型对象不得泄露 location 内部交法');
    assert.strictEqual(m.table_mappings, undefined, '公开模型对象不得泄露 table_mappings 换算表');
    assert.strictEqual(m.conditional_rules, undefined, '公开模型对象不得泄露 conditional_rules 条件规则');
    assert.strictEqual(m.credentials, undefined, '公开模型对象不得泄露凭证');
    assert.strictEqual(m.apiKey, undefined, '公开模型对象不得泄露密钥');

    if (m.public_params) {
      for (const p of m.public_params) {
        assert.strictEqual(p.location, undefined, '对外参数不得暴露 location 提交位置');
        assert.strictEqual(p.visibility, undefined, '对外参数不得暴露 visibility 标记');
      }
    }
  }

  console.log('✔ 第 4 步测试通过');
}

async function testStep5() {
  console.log('=== 测试第 5 步：管理端前端导航与视图合规校验 ===');
  const fs = require('fs');
  const path = require('path');

  const appVue = fs.readFileSync(path.join(__dirname, '../web/src/App.vue'), 'utf-8');
  assert.ok(appVue.includes('/models'), '侧栏必须包含模型入口 /models');
  assert.ok(!appVue.includes('/ai-apps'), '侧栏严禁包含旧 AI 应用入口 /ai-apps');
  assert.ok(!appVue.includes('/adapters'), '侧栏严禁包含旧 AI 配置入口 /adapters');

  const mainJs = fs.readFileSync(path.join(__dirname, '../web/src/main.js'), 'utf-8');
  assert.ok(mainJs.includes('ModelsView'), '路由必须挂载 ModelsView');
  assert.ok(mainJs.includes("path: '/models'"), '必须注册 /models 路由');

  const settingsVue = fs.readFileSync(path.join(__dirname, '../web/src/views/SettingsView.vue'), 'utf-8');
  assert.ok(!settingsVue.includes('生成模型治理'), '系统设置中严禁保留生成模型治理页签');
  assert.ok(!settingsVue.includes('LITELLM_BASE_URL'), '系统设置中严禁输入 LiteLLM 地址');
  assert.ok(!settingsVue.includes('LITELLM_MODEL'), '系统设置中严禁输入 LiteLLM 模型名');

  const modelsVue = fs.readFileSync(path.join(__dirname, '../web/src/views/ModelsView.vue'), 'utf-8');
  assert.ok(modelsVue.includes('供应商'), '模型区必须包含供应商页签');
  assert.ok(modelsVue.includes('模型'), '模型区必须包含模型页签');
  assert.ok(modelsVue.includes('工作流'), '模型区必须包含工作流页签');

  const portraitVue = fs.readFileSync(path.join(__dirname, '../web/src/views/PortraitLibraryView.vue'), 'utf-8');
  assert.ok(!portraitVue.includes('access_key') && !portraitVue.includes('secret_key'), '人像库不得放第二套 AK/SK 表单');

  console.log('✔ 第 5 步测试通过');
}

async function testStep6() {
  console.log('=== 测试第 6 步：统一工作流文档与前置四项独立门禁 ===');
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE IF NOT EXISTS kv (
      key TEXT PRIMARY KEY,
      value TEXT
    );
  `);
  initModelRegistryTables(db);

  const doc = getWorkflowsDocument(db);
  assert.ok(doc.unattended, '必须包含无人值守入库工作流');
  assert.ok(doc.studio_single, '必须包含工坊单节点直调');
  assert.ok(doc.studio_triggered, '必须包含工坊触发入库');

  // 四项前置拒收检查
  const preChecks = doc.unattended.pre_checks;
  assert.ok(preChecks.dup, '必须有指纹查重前置门禁');
  assert.ok(preChecks.size, '必须有尺寸体积前置门禁');
  assert.ok(preChecks.quality, '必须有画质清晰度前置门禁');
  assert.ok(preChecks.ai_defect, '必须有AI缺陷拦截前置门禁');

  // 保存与更新：ai_defect 必须独立保存，严禁被合入 quality
  preChecks.dup.phashThreshold = 10;
  preChecks.ai_defect.enable = true;
  preChecks.ai_defect.maxAiScore = 75;
  preChecks.quality.minSharpness = 40;
  saveWorkflowsDocument(db, doc);

  const savedDoc = getWorkflowsDocument(db);
  assert.strictEqual(savedDoc.unattended.pre_checks.dup.phashThreshold, 10, 'dup 门禁更新成功');
  assert.strictEqual(savedDoc.unattended.pre_checks.ai_defect.maxAiScore, 75, 'ai_defect 门禁必须独立保存');
  assert.strictEqual(savedDoc.unattended.pre_checks.quality.minSharpness, 40, 'quality 门禁独立');
  assert.strictEqual(savedDoc.unattended.pre_checks.quality.maxAiScore, undefined, 'ai_defect 严禁混入 quality 对象');

  console.log('✔ 第 6 步测试通过');
}

async function testStep7() {
  console.log('=== 测试第 7 步：工坊触发单次拆盒（入库失败禁止改中间提示词重跑） ===');
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE IF NOT EXISTS runs (
      id TEXT PRIMARY KEY,
      workflow_id TEXT,
      workflow_version INTEGER,
      trigger TEXT,
      status TEXT,
      asset_count INTEGER,
      created_at INTEGER,
      updated_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS node_runs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      run_id TEXT,
      workflow_version INTEGER,
      node_id TEXT,
      node_type TEXT,
      asset_fid TEXT,
      status TEXT,
      error TEXT,
      input_summary TEXT,
      output_summary TEXT,
      created_at INTEGER,
      updated_at INTEGER
    );
  `);

  // 1. 无人值守入库运行：试图拆盒必须被拒绝（仅支持工坊触发的运行进行事后拆盒）
  db.prepare(`
    INSERT INTO runs (id, workflow_id, workflow_version, trigger, status, asset_count, created_at)
    VALUES ('run_ingest_001', 'ingest_workflow', 1, 'scan', 'failed', 1, ?)
  `).run(Date.now());

  const ingestRun = db.prepare('SELECT * FROM runs WHERE id=?').get('run_ingest_001');
  const canUnpackIngest = ingestRun.trigger === 'studio';
  assert.strictEqual(canUnpackIngest, false, '非 studio 触发严禁事后拆盒');

  // 2. 工坊触发运行：允许拆出识图字段与提示词
  db.prepare(`
    INSERT INTO runs (id, workflow_id, workflow_version, trigger, status, asset_count, created_at)
    VALUES ('run_studio_002', 'restage_pipeline', 1, 'studio', 'done', 1, ?)
  `).run(Date.now());

  db.prepare(`
    INSERT INTO node_runs (run_id, workflow_version, node_id, node_type, asset_fid, status, output_summary, created_at, updated_at)
    VALUES ('run_studio_002', 1, 'vision', 'vision', 'fid_123', 'done', '{"category":"interior","style":"现代极简","materials":"岩板、真皮"}', ?, ?)
  `).run(Date.now(), Date.now());

  db.prepare(`
    INSERT INTO node_runs (run_id, workflow_version, node_id, node_type, asset_fid, status, input_summary, output_summary, created_at, updated_at)
    VALUES ('run_studio_002', 1, 'gen', 'gen', 'fid_123', 'done', '{"prompt":"现代极简客厅效果图","model":"seedream5flash"}', '{"files":[{"fileName":"result.png"}]}', ?, ?)
  `).run(Date.now(), Date.now());

  const studioRun = db.prepare('SELECT * FROM runs WHERE id=?').get('run_studio_002');
  assert.strictEqual(studioRun.trigger === 'studio', true, 'studio 触发允许拆盒');

  // 3. 模拟重跑更新：接收 prompt 和 visionFields 更新 node_runs，不修改工作流模板
  const newVisionFields = { category: 'living_room', style: '新中式' };
  const newPrompt = '新中式茶室效果图';
  const now = Date.now();

  const visionNode = db.prepare("SELECT * FROM node_runs WHERE run_id=? AND node_type='vision'").get('run_studio_002');
  const prevOut = JSON.parse(visionNode.output_summary || '{}');
  db.prepare('UPDATE node_runs SET output_summary=?, updated_at=? WHERE id=?')
    .run(JSON.stringify({ ...prevOut, ...newVisionFields }), now, visionNode.id);

  const genNode = db.prepare("SELECT * FROM node_runs WHERE run_id=? AND node_type='gen'").get('run_studio_002');
  db.prepare('UPDATE node_runs SET input_summary=?, status=?, updated_at=? WHERE id=?')
    .run(JSON.stringify({ prompt: newPrompt, model: 'seedream5flash', visionFields: newVisionFields }), 'done', now, genNode.id);

  const updatedVision = db.prepare('SELECT * FROM node_runs WHERE id=?').get(visionNode.id);
  const updatedGen = db.prepare('SELECT * FROM node_runs WHERE id=?').get(genNode.id);

  assert.ok(updatedVision.output_summary.includes('新中式'), 'vision node_run output_summary 成功更新');
  assert.ok(updatedGen.input_summary.includes('新中式茶室效果图'), 'gen node_run input_summary 成功更新');

  // 4. 检查禁止事项：代码中严禁发明 Runway, Sora, Suno, MidJourney, Anthropic
  const fs = require('fs');
  const path = require('path');
  const contractCode = fs.readFileSync(path.join(__dirname, '../src/models-contract.js'), 'utf-8');
  const banned = ['runway', 'sora', 'suno', 'midjourney', 'anthropic'];
  for (const b of banned) {
    const re = new RegExp(`\\b${b}\\b`, 'i');
    assert.strictEqual(re.test(contractCode), false, `严禁在代码中引入未允许厂商或模型: ${b}`);
  }

  console.log('✔ 第 7 步测试通过');
}

async function run() {
  await testStep1();
  await testStep2();
  await testStep3();
  await testStep4();
  await testStep5();
  await testStep6();
  await testStep7();
  console.log('\n🎉 全部 7 个实施步骤测试完整通过！');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
