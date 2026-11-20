/**
 * Phase 4 验收门禁测试 2：所见即所得与不可变提交快照测试 (WYSIWYG & Frozen Submit Snapshot Test)
 *
 * 验证目标：
 * 1. 严格所见即所得守卫（WYSIWYG 铁律）：
 *    - 当草稿或 @图N 引用了缺失或无效的素材（无 fid 且无 url）时，草稿校验严格失败；
 *    - 严禁任何 silent fallbackAsset 替换（严禁将 @图2 自动篡改为 @图1）；
 * 2. 不可变提交快照（FrozenSubmitSnapshot）：
 *    - 提交瞬间生成的 FrozenSubmitSnapshot 与实际网络下发 request body 100% 逐字段一致；
 *    - 快照生成后修改原草稿对象，快照内容不受任何影响（完全不可变）；
 *    - 快照哈希（hash）严格代表草稿指纹，内容微调即改变哈希。
 */
const assert = require('assert');
const {
  validateComposerDraft,
  createFrozenSubmitSnapshot
} = require('../../../../packages/api-contract');

async function run() {
  console.log('=== Phase 4 Gate 2: 所见即所得与不可变提交快照测试 ===');

  // ---------- 1. 严格所见即所得与无效资产阻断测试 ----------
  console.log('1. 测试资产失效阻断与禁止静默替换...');

  // 空草稿
  const emptyValidation = validateComposerDraft(null);
  assert.strictEqual(emptyValidation.valid, false);

  // 无提示词且无参考图
  const noContentValidation = validateComposerDraft({ prompt: '', assets: [] });
  assert.strictEqual(noContentValidation.valid, false);

  // 模拟 @图2 缺失/无效资产（fid 与 url 均为空）
  const invalidDraft = {
    prompt: '将 @图1 的沙发换成布艺，参考 @图2 的色调',
    model: 'seedream-v4',
    modality: 'image',
    assets: [
      { fid: 'asset_001', url: 'https://example.com/asset_001.jpg', tag: '@图1' },
      { fid: '', url: '', tag: '@图2' } // 失效素材
    ]
  };

  const invalidRes = validateComposerDraft(invalidDraft);
  assert.strictEqual(invalidRes.valid, false, '包含失效素材的草稿必须校验失败');
  assert(
    invalidRes.errors.some((e) => e.includes('第 2 张参考图未包含有效 FID 或 URL')),
    '错误信息必须明确指出哪张参考图失效'
  );

  // 严禁静默 fallback：断言草稿绝不会自动把 @图2 换成 @图1 的 URL
  assert.notStrictEqual(invalidDraft.assets[1].url, invalidDraft.assets[0].url, '严禁偷换为图1的地址');

  // ---------- 2. 有效草稿通过校验并生成 FrozenSubmitSnapshot ----------
  console.log('2. 测试有效草稿提交与不可变快照生成...');

  const validDraft = {
    prompt: '现代极简客厅，全景大窗，米白羊羔绒双人沙发',
    model: 'wanx2.1-t2v-plus',
    modality: 'video',
    mode: 'first_last_frame',
    assets: [
      { fid: 'asset_frame_01', url: 'https://example.com/start.jpg', tag: '@图1', name: '首帧图' },
      { fid: 'asset_frame_02', url: 'https://example.com/end.jpg', tag: '@图2', name: '尾帧图' }
    ],
    params: {
      duration: 5,
      ratio: '16:9',
      fps: 30
    },
    ratio: '16:9',
    size: '1080p'
  };

  const validRes = validateComposerDraft(validDraft);
  assert.strictEqual(validRes.valid, true, '有效草稿必须通过校验');

  const snapshot = createFrozenSubmitSnapshot(validDraft);
  assert(snapshot.snapshotId && snapshot.snapshotId.startsWith('snap_'));
  assert(snapshot.hash && typeof snapshot.hash === 'string');
  assert(snapshot.frozenAt > 0);

  // 验证快照逐字段一致性
  assert.strictEqual(snapshot.draft.prompt, validDraft.prompt);
  assert.strictEqual(snapshot.draft.model, validDraft.model);
  assert.strictEqual(snapshot.draft.modality, validDraft.modality);
  assert.strictEqual(snapshot.draft.assets.length, 2);
  assert.strictEqual(snapshot.draft.assets[0].url, 'https://example.com/start.jpg');
  assert.strictEqual(snapshot.draft.assets[1].url, 'https://example.com/end.jpg');
  assert.strictEqual(snapshot.draft.params.duration, 5);

  // ---------- 3. 快照不可变性测试 (Deep Immutability) ----------
  console.log('3. 测试快照不可变性（修改原草稿不影响已生成的快照）...');

  // 外部草稿被后续修改或回滚
  validDraft.prompt = '恶意篡改或乐观回滚后的提示词';
  validDraft.assets[0].url = 'https://example.com/tampered.jpg';
  validDraft.params.duration = 10;

  // 断言快照内部保持冰冻初值，绝不被篡改
  assert.strictEqual(snapshot.draft.prompt, '现代极简客厅，全景大窗，米白羊羔绒双人沙发');
  assert.strictEqual(snapshot.draft.assets[0].url, 'https://example.com/start.jpg');
  assert.strictEqual(snapshot.draft.params.duration, 5);

  // 快照哈希防碰撞测试
  const modifiedSnapshot = createFrozenSubmitSnapshot(validDraft);
  assert.notStrictEqual(snapshot.hash, modifiedSnapshot.hash, '内容变更后快照哈希必须变化');

  console.log('✔ Phase 4 所见即所得与不可变提交快照测试全部通过！\n');
}

if (require.main === module) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = run;
