/**
 * 视频模型模式契约与智能自适应门禁测试
 * 验证：
 * 1. 默认选中模式为全能参考 (omni_reference)
 * 2. 避免自动选中首尾帧 (first_last_frame)，首尾帧只能手动选中
 * 3. 图参考模式 (image_to_video) 完全取消
 * 4. 视频模型统一仅提供三种模式：文生视频、全能参考、首尾帧
 */
const assert = require('assert');
const {
  DEFAULT_MODEL_CONTRACTS,
  buildSchemaForContract,
} = require('../src/models-contract');
const {
  inferOptimalWorkflowAndParams,
} = require('../web-pro/src/utils/model-protocol');

const VIDEO_MODELS = ['seedance2_0', 'seedance2_5', 'wan3_0_video', 'agnes_video_2_5_flash'];

// 1. 契约定义与 buildSchemaForContract 验证
for (const modelId of VIDEO_MODELS) {
  const contract = DEFAULT_MODEL_CONTRACTS.find((m) => m.id === modelId);
  assert(contract, `必须存在契约 ${modelId}`);

  // 模式列表必须只有 3 种
  const modeIds = (contract.modes || []).map((m) => m.id);
  assert.deepStrictEqual(
    modeIds,
    ['text_to_video', 'omni_reference', 'first_last_frame'],
    `${modelId} 契约模式必须仅包含 text_to_video, omni_reference, first_last_frame`
  );
  assert(!modeIds.includes('image_to_video'), `${modelId} 绝对不能包含已取消的 image_to_video`);

  const schema = buildSchemaForContract(contract);
  assert(schema, `buildSchemaForContract 必须成功生成 ${modelId}`);
  assert.strictEqual(schema.defaultMode, 'omni_reference', `${modelId} 默认模式必须为 omni_reference`);

  const schemaModeIds = schema.modes.map((m) => m.id);
  assert.deepStrictEqual(
    schemaModeIds,
    ['text_to_video', 'omni_reference', 'first_last_frame'],
    `${modelId} Schema 模式列表必须仅包含 [text_to_video, omni_reference, first_last_frame]`
  );

  const omniMode = schema.modes.find((m) => m.id === 'omni_reference');
  assert.strictEqual(omniMode.label, '全能参考', `${modelId} omni_reference 显示名必须为「全能参考」`);
}

// 2. 契约 params 中的 mode 参数枚举与默认值
for (const modelId of ['seedance2_0', 'seedance2_5', 'wan3_0_video']) {
  const contract = DEFAULT_MODEL_CONTRACTS.find((m) => m.id === modelId);
  const modeParam = (contract.params || []).find((p) => p && p.key === 'mode');
  if (modeParam) {
    assert.strictEqual(modeParam.default, 'omni_reference', `${modelId} params.mode 默认值必须为 omni_reference`);
    assert(!modeParam.options.includes('image_to_video'), `${modelId} params.mode 选项绝不能包含 image_to_video`);
    assert(modeParam.options.includes('omni_reference'), `${modelId} params.mode 选项必须包含 omni_reference`);
    assert(modeParam.options.includes('first_last_frame'), `${modelId} params.mode 选项必须包含 first_last_frame`);
    assert(modeParam.options.includes('text_to_video'), `${modelId} params.mode 选项必须包含 text_to_video`);
  }
}

// 3. inferOptimalWorkflowAndParams 自动化调度验证
const seedanceSchema = buildSchemaForContract(
  DEFAULT_MODEL_CONTRACTS.find((m) => m.id === 'seedance2_0')
);

// 3.1 零图状态下的调度：默认全能参考
const flow0 = inferOptimalWorkflowAndParams({
  referenceTray: [],
  currentModality: 'video',
  currentGenMode: '',
  currentSchema: seedanceSchema,
  currentParams: {},
});
assert.strictEqual(flow0.targetGenMode, 'omni_reference', '零图默认模式必须为 omni_reference');

// 3.2 挂载 1 张图状态下的调度：切入全能参考，严禁切入图参考
const frame1 = { name: '图1', url: 'http://example.com/1.jpg', naturalWidth: 1080, naturalHeight: 1920 };
const flow1 = inferOptimalWorkflowAndParams({
  referenceTray: [frame1],
  currentModality: 'video',
  currentGenMode: 'omni_reference',
  currentSchema: seedanceSchema,
  currentParams: {},
});
assert.strictEqual(flow1.targetGenMode, 'omni_reference', '1 张图必须切入全能参考 (omni_reference)');

// 3.3 核心要求：挂载 2 张图时，绝不能自动切入首尾帧！必须依然为全能参考！
const frame2 = { name: '图2', url: 'http://example.com/2.jpg', naturalWidth: 1080, naturalHeight: 1920 };
const flow2 = inferOptimalWorkflowAndParams({
  referenceTray: [frame1, frame2],
  currentModality: 'video',
  currentGenMode: 'omni_reference',
  currentSchema: seedanceSchema,
  currentParams: {},
});
assert.strictEqual(
  flow2.targetGenMode,
  'omni_reference',
  '挂载 2 张图时绝不能自动切到首尾帧，必须保持全能参考！'
);

// 3.4 首尾帧只能手动去选：当用户手动选择了首尾帧，调度必须予以保持
const flowManualFirstLast = inferOptimalWorkflowAndParams({
  referenceTray: [frame1, frame2],
  currentModality: 'video',
  currentGenMode: 'first_last_frame',
  currentSchema: seedanceSchema,
  currentParams: {},
});
assert.strictEqual(
  flowManualFirstLast.targetGenMode,
  'first_last_frame',
  '用户手动选中的首尾帧模式必须予以保持'
);

// 3.5 用户手动选中文生视频且无图时，保持文生视频
const flowManualT2V = inferOptimalWorkflowAndParams({
  referenceTray: [],
  currentModality: 'video',
  currentGenMode: 'text_to_video',
  currentSchema: seedanceSchema,
  currentParams: {},
});
assert.strictEqual(flowManualT2V.targetGenMode, 'text_to_video', '手动选中文生视频且无图时保持文生视频');

// 4. 数据库升级与自动修复验证 (initModelRegistryTables / seedStoredContract)
const Database = require('better-sqlite3');
const db = new Database(':memory:');
const { initModelRegistryTables, getUnifiedSchemasMap } = require('../src/models-contract');
initModelRegistryTables(db);

const unifiedMap = getUnifiedSchemasMap(db, { ttlMs: 0 });
for (const modelId of VIDEO_MODELS) {
  const s = unifiedMap[modelId];
  assert(s, `统一映射表中必须包含 ${modelId}`);
  assert.strictEqual(s.defaultMode, 'omni_reference', `统一映射表中 ${modelId} defaultMode 必须为 omni_reference`);
  assert.deepStrictEqual(
    s.modes.map((m) => m.id),
    ['text_to_video', 'omni_reference', 'first_last_frame'],
    `统一映射表中 ${modelId} 模式列表必须为三种`
  );
}
db.close();

console.log('✅ 视频模型契约与三种模式调度断言全部通过！');
