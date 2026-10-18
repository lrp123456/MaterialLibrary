/**
 * 四阶段全链路重构与零黑盒治理综合验收测试 (Stage 1 ~ Stage 4 End-to-End Verification)
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const Database = require('better-sqlite3');

const root = path.join(__dirname, '..');

async function testStage1SSOTAndEnvSecrets() {
  console.log('=== Stage 1: 验证单一事实源 (SSOT) 与 .env 统一密钥中枢 ===');
  const db = new Database(':memory:');
  const {
    initModelRegistryTables,
    getModelContractsList,
    saveModelContractData,
    getModelPublicCatalog,
    schemaFor,
    MODEL_SCHEMAS,
  } = require(path.join(root, 'src/models-contract'));
  const modelSchemasProxy = require(path.join(root, 'src/model-schemas'));

  initModelRegistryTables(db);

  // 1. 验证 model-schemas.js 已无硬编码字典，完全代理自 models-contract.js
  const msCode = fs.readFileSync(path.join(root, 'src/model-schemas.js'), 'utf-8');
  assert.ok(msCode.split('\n').length < 60, 'src/model-schemas.js 必须为轻量动态代理层，不得保留数百行硬编码副本');
  assert.strictEqual(modelSchemasProxy.MODEL_SCHEMAS.seedream5pro.polishId, 'seedream5pro');
  assert.strictEqual(modelSchemasProxy.MODEL_SCHEMAS.seedream5lite.polishId, 'seedream5lite');

  // 2. 验证在管理台修改模型契约参数后，getModelPublicCatalog(db).schemas 实时反映修改（真正 SSOT）
  const s25 = getModelContractsList(db).models.find(m => m.id === 'seedance2_5');
  assert.ok(s25, '必须存在 seedance2_5 契约');
  assert.strictEqual(s25.converter, 'ark-seedance-video');
  assert.strictEqual(s25.slots.images, 30);

  const customParams = [
    ...s25.params,
    {
      key: 'motion_bucket_id',
      label: '运动幅度档位',
      type: 'number',
      default: 127,
      min: 1,
      max: 255,
      visibility: 'public',
      location: 'body',
      body_field: 'motion_bucket_id',
    },
  ];
  saveModelContractData(db, {
    ...s25,
    converter: 'ark-seedance-video',
    failover_model_id: 'seedance2_0',
    params: customParams,
  });

  const pubCat = getModelPublicCatalog(db);
  assert.ok(pubCat.schemas && pubCat.schemas.seedance2_5, '公开目录必须下发动态派生的 schemas');
  const dynCommon = pubCat.schemas.seedance2_5.common;
  assert.ok(dynCommon.some(f => f.key === 'motion_bucket_id' && f.default === 127), '修改契约后客户端 Schema 必须立即同步出现新参数');

  const dynamicSchema = schemaFor({ id: 'seedance2_5' }, db);
  assert.ok(dynamicSchema.common.some(f => f.key === 'motion_bucket_id'), 'schemaFor(model, db) 必须实时读取 DB 契约');

  // 3. 验证 .env 统一密钥中枢读写与脱敏
  const { parseEnvContent, inspectEnvKey, writeEnvUpdates } = require(path.join(root, 'src/env-secrets'));
  const tmpEnv = path.join(os.tmpdir(), `test-env-${Date.now()}.env`);
  fs.writeFileSync(tmpEnv, '# Comment line\nARK_API_KEY=sk-init-1111\n', 'utf-8');
  const parsed = parseEnvContent(fs.readFileSync(tmpEnv, 'utf-8'));
  assert.strictEqual(parsed.map.get('ARK_API_KEY'), 'sk-init-1111');

  writeEnvUpdates({ ARK_API_KEY: 'sk-updated-9999', GROQ_API_KEY: 'gsk-new-8888' }, tmpEnv);
  const afterContent = fs.readFileSync(tmpEnv, 'utf-8');
  assert.ok(afterContent.includes('ARK_API_KEY=sk-updated-9999'), '.env 已有键必须原位更新');
  assert.ok(afterContent.includes('GROQ_API_KEY=gsk-new-8888'), '.env 新增键必须追加');

  const inspected = inspectEnvKey('ARK_API_KEY');
  assert.strictEqual(inspected.has_value, true);
  assert.strictEqual(inspected.tail, '9999');
  assert.ok(!JSON.stringify(inspected).includes('sk-updated-9999'), 'inspectEnvKey 严禁泄露明文密钥');
  try { fs.unlinkSync(tmpEnv); } catch (_) {}

  console.log('✔ Stage 1 验收通过');
}

async function testStage2UnifiedTranslatorAndConverters() {
  console.log('=== Stage 2: 验证双向统一转译器、专用媒体转换器与熔断器 ===');
  const {
    DEFAULT_MODEL_CONTRACTS,
    assembleModelPayload,
  } = require(path.join(root, 'src/models-contract'));
  const {
    setDeepField,
    normalizeCanonicalInput,
    evaluateModelRules,
    compileModelDialect,
  } = require(path.join(root, 'src/unified-translator'));
  const {
    ProviderCircuitBreaker,
    convertArkSeedreamRequest,
    normalizeArkSeedreamResponse,
    convertAgnesImageRequest,
    convertArkSeedanceVideoRequest,
    convertAgnesVideoRequest,
    buildArkFileUploadMeta,
    previewUnifiedConversion,
  } = require(path.join(root, 'src/converters'));

  // 1. 深层路径写入验证 (Agnes Image extra_body.response_format & Seedream optimize_prompt_options.mode)
  const agnesImgContract = DEFAULT_MODEL_CONTRACTS.find(m => m.id === 'agnes_image_2_5_flash');
  const agnesAssembled = assembleModelPayload({
    modelContract: agnesImgContract,
    values: { size: '2K', ratio: '16:9', response_format: 'b64_json' },
    editablePrompt: '现代客厅设计',
  });
  assert.strictEqual(agnesAssembled.body.extra_body?.response_format, 'b64_json', 'deep body_field 必须自动展开为嵌套对象 extra_body.response_format');

  // 2. Seedream 5.0 Pro 换算表、图层拆分与极速提示优化 (fast) 验证
  const proContract = DEFAULT_MODEL_CONTRACTS.find(m => m.id === 'seedream5pro');
  const proNormal = assembleModelPayload({
    modelContract: proContract,
    values: { size: '2K', ratio: '16:9', 'optimize_prompt_options.mode': 'fast' },
    editablePrompt: '轻奢主卧',
  });
  assert.strictEqual(proNormal.body.size, '2816x1584', 'Seedream 5.0 Pro 关闭图层拆分时必须查换算表得到 2816x1584');
  assert.strictEqual(proNormal.body.optimize_prompt_options?.mode, 'fast', 'Seedream 5.0 Pro 必须支持 fast 极速优化模式');

  const proDecomp = assembleModelPayload({
    modelContract: proContract,
    values: { layer_decomposition: true, size: 'auto', ratio: '16:9' },
    editablePrompt: '拆解沙发与背景图层',
    images: ['https://example.com/room.jpg'],
  });
  assert.strictEqual(proDecomp.body.size, 'auto', 'Seedream 5.0 Pro 开启图层拆分时 size 必须支持 auto');
  assert.strictEqual(proDecomp.body.ratio, undefined, 'Seedream 5.0 Pro 开启图层拆分时 ratio 不得下发');

  // 3. Seedream 5.0 多图层响应分解归一化 (normalizeArkSeedreamResponse)
  const mockArkDecompRes = {
    data: [
      { url: 'https://example.com/layer0_bg.png', width: 2048, height: 2048 },
      { url: 'https://example.com/layer1_sofa.png', width: 2048, height: 2048 },
      { url: 'https://example.com/layer2_lamp.png', width: 2048, height: 2048 },
    ],
  };
  const layerStack = normalizeArkSeedreamResponse(mockArkDecompRes, { layerDecomposition: true });
  assert.strictEqual(layerStack.kind, 'layer_stack');
  assert.strictEqual(layerStack.count, 3);
  assert.strictEqual(layerStack.layers[0].role, 'background');
  assert.strictEqual(layerStack.layers[1].role, 'foreground_1');

  // 4. Seedance 2.0 / 2.5 多模态 content[] 数组转换与模式条件锁
  const s25Contract = DEFAULT_MODEL_CONTRACTS.find(m => m.id === 'seedance2_5');
  const s25Preview = previewUnifiedConversion({
    contract: s25Contract,
    canonicalInput: {
      prompt: '镜头推进穿过客厅 @图片1 进入阳台 @图片2',
      mode: 'first_last_frame',
      params: { resolution: '1080p', duration: 8, ratio: '16:9', generate_audio: true },
      refs: {
        images: ['https://example.com/start.jpg', 'https://example.com/end.jpg'],
        videos: [],
        audios: [],
      },
    },
  });
  assert.strictEqual(s25Preview.payload.ratio, 'adaptive', 'first_last_frame 模式必须自动将 ratio 锁定为 adaptive');
  assert.strictEqual(s25Preview.payload.content[1].role, 'first_frame');
  assert.strictEqual(s25Preview.payload.content[2].role, 'last_frame');

  // 5. Agnes Video 2.5 Flash 类型强转 (seconds -> String, size -> 720P)
  const agnesVidReq = convertAgnesVideoRequest({
    contract: DEFAULT_MODEL_CONTRACTS.find(m => m.id === 'agnes_video_2_5_flash'),
    prompt: '展示 <Picture 1> 空间漫游',
    mode: 'first_last_frame',
    values: { seconds: 5, size: '720p', aspect_ratio: '16:9' },
    images: ['https://example.com/f1.jpg', 'https://example.com/f2.jpg'],
  });
  assert.strictEqual(agnesVidReq.seconds, '5', 'Agnes Video seconds 必须强转为字符串 "5"');
  assert.strictEqual(agnesVidReq.size, '720P', 'Agnes Video size 必须规范化为大写 "720P"');
  assert.strictEqual(agnesVidReq.first_frame_image, 'https://example.com/f1.jpg');
  assert.strictEqual(agnesVidReq.last_frame_image, 'https://example.com/f2.jpg');

  // 6. Ark Files API 7天过期时间与视频抽帧预处理构造
  const fileMeta = buildArkFileUploadMeta({ purpose: 'user_data', ttlDays: 7, videoFps: 2 });
  assert.strictEqual(fileMeta.purpose, 'user_data');
  assert.strictEqual(fileMeta.preprocess_configs?.video?.fps, 2);
  assert.ok(fileMeta.expire_at > Math.floor(Date.now() / 1000) + 6 * 86400);

  // 7. CC-Switch 风格熔断器状态机测试
  const cb = new ProviderCircuitBreaker({ failureThreshold: 2, openDurationMs: 50 });
  assert.strictEqual(cb.canPass('volc_ark'), true);
  cb.recordFailure('volc_ark', 'HTTP 502 Bad Gateway');
  assert.strictEqual(cb.canPass('volc_ark'), true);
  cb.recordFailure('volc_ark', 'HTTP 503 Service Unavailable');
  assert.strictEqual(cb.canPass('volc_ark'), false, '连续失败达到阈值后必须进入 OPEN 熔断状态');
  await new Promise(r => setTimeout(r, 65));
  assert.strictEqual(cb.canPass('volc_ark'), true, '冷却窗口过后必须进入 HALF_OPEN 允许探测');
  cb.recordSuccess('volc_ark');
  assert.strictEqual(cb.snapshot()['volc_ark'].state, 'CLOSED', '探测成功后必须恢复 CLOSED');

  console.log('✔ Stage 2 验收通过');
}

async function testStage3AndStage4FrontendsAndSyntax() {
  console.log('=== Stage 3 & Stage 4: 验证客户端与管理台组件、协议及全仓语法零错误 ===');

  // 1. 检查 Stage 3 新增/升级的客户端文件
  const protocolPath = path.join(root, 'web-pro/src/utils/model-protocol.js');
  const paramBarPath = path.join(root, 'web-pro/src/components/DynamicModelParamBar.vue');
  const chatStudioPath = path.join(root, 'web-pro/src/views/studio/ChatStudio.vue');
  assert.ok(fs.existsSync(protocolPath), '必须存在 web-pro/src/utils/model-protocol.js');
  assert.ok(fs.existsSync(paramBarPath), '必须存在 web-pro/src/components/DynamicModelParamBar.vue');

  const chatStudioCode = fs.readFileSync(chatStudioPath, 'utf-8');
  assert.ok(chatStudioCode.includes('DynamicModelParamBar'), 'ChatStudio.vue 必须挂载 DynamicModelParamBar 组件');
  assert.ok(chatStudioCode.includes('msg.layerStack'), 'ChatStudio.vue 必须支持 Seedream 5.0 图层分解栈展示');
  assert.ok(chatStudioCode.includes('STUDIO_SKILLS_REGISTRY'), 'ChatStudio.vue 必须支持 ZCode 风格 Skills 挂载');
  assert.ok(chatStudioCode.includes('视频|音频'), 'ChatStudio.vue 必须支持 @视频N 与 @音频N 混排标签解析');

  // 2. 检查 Stage 4 管理台 ModelsView.vue 零黑盒控件
  const modelsViewPath = path.join(root, 'web/src/views/ModelsView.vue');
  const modelsViewCode = fs.readFileSync(modelsViewPath, 'utf-8');
  assert.ok(modelsViewCode.includes('openEnvSecretsDrawer'), 'ModelsView.vue 必须包含 .env 统一密钥中枢抽屉');
  assert.ok(modelsViewCode.includes('editingModel.converter'), 'ModelsView.vue 必须包含专用协议转换器选择器');
  assert.ok(modelsViewCode.includes('editingModel.failover_model_id'), 'ModelsView.vue 必须包含熔断故障转移备选模型选择器');
  assert.ok(modelsViewCode.includes('addModelParamRow'), 'ModelsView.vue 必须包含全量参数契约矩阵可视化编辑器');
  assert.ok(modelsViewCode.includes('runModelConvertPreview'), 'ModelsView.vue 必须包含统一转译器与协议载荷实时预览');

  // 3. 编译级语法扫描：检查所有修改过的 Node.js 模块可无错加载与语法解析
  const jsFilesToCheck = [
    'src/env-secrets.js',
    'src/env-keys.js',
    'src/unified-translator.js',
    'src/converters/index.js',
    'src/models-contract.js',
    'src/model-schemas.js',
    'src/studio-catalog.js',
    'src/gen-governance.js',
    'src/gen/index.js',
    'src/lab.js',
    'src/providers.js',
    'src/vlm.js',
    'src/api.js',
  ];
  for (const rel of jsFilesToCheck) {
    const full = path.join(root, rel);
    const code = fs.readFileSync(full, 'utf-8');
    new vm.Script(code, { filename: rel });
    require(full);
  }

  console.log('✔ Stage 3 & Stage 4 验收通过');
}

async function run() {
  await testStage1SSOTAndEnvSecrets();
  await testStage2UnifiedTranslatorAndConverters();
  await testStage3AndStage4FrontendsAndSyntax();
  console.log('\n🎉 四阶段全链路架构升级与零黑盒治理综合验收测试 100% 通过！');
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
