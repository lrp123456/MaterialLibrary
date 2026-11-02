/**
 * 级联多组模型回退策略（生图 + Gemini/VLM）与宽容入库-垃圾站流转深度测试套件
 */
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

const testDir = path.join(os.tmpdir(), 'dsh_cascade_test_' + Date.now());
fs.mkdirSync(testDir, { recursive: true });
process.env.ML_DATA_DIR = testDir;

const { openDb } = require('../src/db');
const db = openDb(testDir);
const vlm = require('../src/vlm');
const nodes = require('../src/nodes/index.js');
const streamUpload = require('../src/stream-upload.js');
const assetsDelete = require('../src/assets-delete.js');

async function runTests() {
  console.log('=== 1. 测试 VLM 与 Gemini 级联多组模型回退 ===');

  // 1.1 测试 buildVisionChain 模型候选链构造
  const geminiChain = vlm.buildVisionChain('gemini-2.5-flash');
  assert.strictEqual(geminiChain[0], 'gemini-2.5-flash');
  assert(geminiChain.includes('agnes-3.0-flash'), 'Gemini 链应包含 agnes-3.0-flash 备选');
  assert(geminiChain.includes('workflow_vision'), 'Gemini 链应包含 workflow_vision 备选');
  assert(geminiChain.includes('workflow_vision_low'), 'Gemini 链应包含 workflow_vision_low 备选');
  console.log('✅ Gemini 模型候选链构造通过:', geminiChain);

  // 1.2 测试 isVlmFallbackableError 错误类型识别
  assert(vlm.isVlmFallbackableError(new Error('VLM HTTP 403: Your API key was reported as leaked')), '应识别 403 leaked key');
  assert(vlm.isVlmFallbackableError(new Error('The Gemini API free tier is not available for this project')), '应识别 free tier unavailable');
  assert(vlm.isVlmFallbackableError(new Error('VLM HTTP 429: rate_limit_exceeded')), '应识别 429 限流');
  assert(vlm.isVlmFallbackableError(new Error('VLM HTTP 503: Service Unavailable')), '应识别 503 服务不可用');
  assert(vlm.isVlmFallbackableError(new Error('The operation was aborted due to timeout')), '应识别超时');
  assert(vlm.isVlmFallbackableError(new Error('TypeError: fetch failed')), '应识别网络连接失败');
  assert(!vlm.isVlmFallbackableError(new Error('VLM 返回非 JSON: invalid text')), '非网络/配额的解析错误不应被判定为回退型');
  console.log('✅ isVlmFallbackableError 全类型识别通过');

  // 1.3 测试 chatVision 级联切换：模拟 Gemini 403 leaked 自动降级到备选模型
  const attemptedModels = [];
  const origChatVisionOnce = vlm.chatVisionOnce;
  try {
    vlm.chatVisionOnce = async (opts) => {
      attemptedModels.push(opts.model);
      if (/gemini/i.test(opts.model)) {
        throw new Error('VLM HTTP 403: Your API key was reported as leaked');
      }
      if (opts.model === 'agnes-3.0-flash') {
        return { is_material: true, category: 'interior', reason: '测试室内场景' };
      }
      throw new Error(`Unexpected model: ${opts.model}`);
    };

    const res = await vlm.chatVision({
      baseUrl: 'http://127.0.0.1:4000',
      apiKey: 'test-key',
      model: 'gemini-2.5-flash',
      prompt: '识别场景',
      images: ['fake-base64']
    });

    assert.strictEqual(res.is_material, true);
    assert.strictEqual(res.category, 'interior');
    assert.deepStrictEqual(attemptedModels, ['gemini-2.5-flash', 'agnes-3.0-flash']);
    console.log('✅ Gemini 遭遇 403 泄露自动平滑级联回退到 Agnes 验证通过！尝试顺序:', attemptedModels);
  } finally {
    vlm.chatVisionOnce = origChatVisionOnce;
  }

  console.log('\n=== 2. 测试生图模型级联多组回退（429 限流不掐断后续通道） ===');
  // 构造模拟 services 与适配器
  db.prepare(`
    INSERT OR REPLACE INTO gen_adapters (id, kind, enabled, builtin, label, protocol, base_url, config_json)
    VALUES 
      ('agnes_image', 'image', 1, 1, 'Agnes 生图', 'agnes', 'http://127.0.0.1:8001', '{"defaultModel":"agnes-flux"}'),
      ('qwenimage_local', 'image', 1, 1, 'QwenImage 本地', 'openai', 'http://127.0.0.1:8002', '{}')
  `).run();

  // 创建测试原始资产与参考图文件
  const testOrigDir = path.join(testDir, 'cache', 'originals');
  fs.mkdirSync(testOrigDir, { recursive: true });
  const testRefPath = path.join(testOrigDir, 'local_test_cascade_asset.jpg');
  fs.writeFileSync(testRefPath, 'dummy jpeg content');

  const testAsset = {
    fid: 'local_test_cascade_asset',
    file_name: 'test.jpg',
    width: 1080,
    height: 1920,
    category: 'interior',
    has_watermark: 0,
    main_derivative_id: null
  };
  db.prepare(`
    INSERT OR REPLACE INTO assets (fid, file_name, width, height, category, status, source, sha256, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, 'ready', 'upload', 'fake_sha256_cascade', ?, ?)
  `).run(testAsset.fid, testAsset.file_name, testAsset.width, testAsset.height, testAsset.category, Date.now(), Date.now());

  // 模拟 executeAdapter：agnes_image 报 429 限流，qwenimage_local 成功返回产物
  const adapterAttempts = [];
  const testTempDir = path.join(testDir, 'cache', 'temp');
  fs.mkdirSync(testTempDir, { recursive: true });
  const fakeGenOutput = path.join(testTempDir, 'gen_output_34.jpg');
  fs.writeFileSync(fakeGenOutput, 'fake output image');

  const services = {
    db,
    config: { dataDir: testDir },
    logger: { info() {}, warn() {}, error() {} },
    executeAdapter: async (svc, adapter, params) => {
      adapterAttempts.push(adapter.id);
      if (adapter.id === 'agnes_image') {
        // 模拟上游返回 429 频控异常
        const err = new Error('HTTP 429: rate_limit_exceeded (请登录platform进行实名认证以获取更高rpm)');
        throw err;
      }
      if (adapter.id === 'qwenimage_local') {
        return {
          ok: true,
          files: [{ localPath: fakeGenOutput, width: 810, height: 1080 }]
        };
      }
      throw new Error('未知的适配器: ' + adapter.id);
    }
  };

  const res = await nodes.executeRestageDual(services, {
    adapterId: 'agnes_image',
    ratios: ['3:4'],
    sizePreset: '720p',
    retryTimes: 1
  }, testAsset, {});

  assert.strictEqual(res.success, true, '即使主通道 429，也应通过备用通道成功');
  assert.strictEqual(res.output.restaged, true);
  assert.deepStrictEqual(adapterAttempts, ['agnes_image', 'qwenimage_local']);
  console.log('✅ 主通道 429 限流未打断链路，自动级联回退到 QwenImage 成功产出！尝试顺序:', adapterAttempts);

  console.log('\n=== 3. 测试宽容入库策略（Store-First, Gate-Later） ===');
  // 3.1 用户上传黑名单素材，入库阶段先不拦截、不物理删除，状态为 ready
  const uploadDir = path.join(testDir, 'cache', 'temp_upload');
  fs.mkdirSync(uploadDir, { recursive: true });
  const dummyFilePath = path.join(uploadDir, 'blacklisted_test.jpg');
  fs.writeFileSync(dummyFilePath, 'dummy blacklisted content');

  const blSha256 = 'bl_sha256_' + Date.now();
  // 写入黑名单
  assetsDelete.addBlacklist(db, [{ kind: 'sha256', value: blSha256 }], { reason: 'user_delete' });

  const ingestRes = await streamUpload.registerMediaAsset(services, {
    filePath: dummyFilePath,
    fileName: 'blacklisted_test.jpg',
    sha256: blSha256,
    size: 100,
    clientAssetId: 'client_001',
    source: 'sync'
  });

  assert(ingestRes && ingestRes.fid, '黑名单素材应成功入库生成 fid');
  const storedAsset = db.prepare('SELECT status, file_name FROM assets WHERE fid=?').get(ingestRes.fid);
  assert.strictEqual(storedAsset.status, 'ready', '入库初始状态应为 ready（用户立即可见）');
  console.log('✅ 宽容入库通过：黑名单素材成功建行入库且初始状态为 ready');

  // 3.2 模拟工作流 Gate 节点执行：触发后判定黑名单，移入垃圾站（status = rejected）
  const gateRes = await nodes.executeGate(services, {}, {
    fid: ingestRes.fid,
    sha256: blSha256,
    file_name: 'blacklisted_test.jpg',
    size: 100,
    client_asset_id: 'client_001'
  }, {});

  assert.strictEqual(gateRes.excluded, true, 'Gate 节点应判定排除');
  assert.strictEqual(gateRes.rejectReason, 'blacklisted');

  // 模拟解释器处理 excluded: true（落回收站）
  assetsDelete.softDeleteAsset(services, ingestRes.fid, {
    deletedBy: 'interpreter-gate',
    reason: 'gate_reject',
    disposeSource: 'gate_blacklist',
    disposeDetail: '黑名单拦截'
  });

  const rejectedAsset = db.prepare('SELECT status, reject_reason FROM assets WHERE fid=?').get(ingestRes.fid);
  assert(rejectedAsset.status === 'rejected' || rejectedAsset.status === 'deleted', '工作流判定后应移入垃圾站/回收站');
  console.log('✅ 工作流后置判定通过：Gate 成功将黑名单素材移入垃圾站/回收站，状态变为:', rejectedAsset.status);

  // 3.3 测试截图/UI 文件入库与 Gate 流转
  const uiFilePath = path.join(uploadDir, 'Screenshot_2026_test.png');
  fs.writeFileSync(uiFilePath, 'dummy screenshot content');
  const uiSha256 = 'ui_sha256_' + Date.now();

  const uiIngest = await streamUpload.registerMediaAsset(services, {
    filePath: uiFilePath,
    fileName: 'Screenshot_2026_test.png',
    sha256: uiSha256,
    size: 200,
    source: 'sync'
  });

  assert(uiIngest && uiIngest.fid, '截图素材应成功建行入库');
  const uiAsset = db.prepare('SELECT status FROM assets WHERE fid=?').get(uiIngest.fid);
  assert.strictEqual(uiAsset.status, 'ready', '截图入库初始状态同样为 ready');

  // 触发 Gate 节点
  const uiGate = await nodes.executeGate(services, {}, {
    fid: uiIngest.fid,
    sha256: uiSha256,
    file_name: 'Screenshot_2026_test.png',
    size: 200
  }, {});

  assert.strictEqual(uiGate.excluded, true);
  assert.strictEqual(uiGate.rejectReason, 'non_interior_ui');
  console.log('✅ 截图/UI 素材入库不拦截、工作流判定移入垃圾站验证通过！');

  console.log('\n🎉 所有级联回退与宽容入库核心测试全部顺利通过！');
}

runTests().catch((err) => {
  console.error('❌ 测试失败:', err);
  process.exit(1);
});
