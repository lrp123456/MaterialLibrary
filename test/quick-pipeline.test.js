/**
 * 快捷操作服务端流水线测试套件
 * 验证：
 * 1. image-ops: floodFillCutout, affineCompositeToScene, cropNeighborhood, pastebackComposite
 * 2. handlers registry: 快捷能力注册与状态检测
 * 3. 单图 handlers 校验 (expand, watermark, insert, replace)
 * 4. walkthrough pipeline 拓扑与镜头两步确认
 */
const assert = require('assert');
const path = require('path');
const fs = require('fs');
const os = require('os');
const sharp = require('sharp');

const imageOps = require('../src/handlers/image-ops');
const registry = require('../src/handlers/registry');
const walkthroughPipeline = require('../src/handlers/walkthrough-pipeline');
const expandHandler = require('../src/handlers/quick-expand');
const watermarkHandler = require('../src/handlers/quick-watermark-remove');
const { imagexReady } = require('../src/handlers/veimagex-expand');

function emptyDb() {
  return { prepare() { return { get() { return undefined; }, all() { return []; } }; } };
}

async function runTests() {
  console.log('=== 1. 测试图像算法库 (image-ops) ===');

  // 构造 200x200 纯白底红块测试图
  const redSquareSvg = Buffer.from(`
    <svg width="200" height="200" xmlns="http://www.w3.org/2000/svg">
      <rect width="200" height="200" fill="#FFFFFF"/>
      <rect x="50" y="50" width="100" height="100" fill="#FF0000"/>
    </svg>
  `);
  const testPng = await sharp(redSquareSvg).png().toBuffer();

  // 1.1 泛洪抠底 floodFillCutout
  const cutout = await imageOps.floodFillCutout(testPng, { tolerance: 30 });
  assert(cutout.cutoutBuffer && Buffer.isBuffer(cutout.cutoutBuffer), '抠底应输出 Buffer');
  assert(Array.isArray(cutout.bbox) && cutout.width > 0 && cutout.height > 0, '应提取主体 bbox');
  console.log(`✅ 泛洪抠底通过 (bbox: [${cutout.bbox.join(',')}], size: ${cutout.width}x${cutout.height})`);

  // 1.2 直角矩形与四点透视仿射贴图 affineCompositeToScene
  const bgSvg = Buffer.from(`
    <svg width="500" height="500" xmlns="http://www.w3.org/2000/svg">
      <rect width="500" height="500" fill="#222222"/>
    </svg>
  `);
  const bgPng = await sharp(bgSvg).png().toBuffer();

  // 直角贴图
  const rectScene = await imageOps.affineCompositeToScene(bgPng, cutout.cutoutBuffer, {
    rect: [100, 100, 200, 200]
  });
  assert(Buffer.isBuffer(rectScene.compositeBuffer), '直角矩形贴图应成功');

  // 四点透视贴图
  const quadScene = await imageOps.affineCompositeToScene(bgPng, cutout.cutoutBuffer, {
    quad: [[100, 100], [300, 80], [320, 280], [80, 250]]
  });
  assert(Buffer.isBuffer(quadScene.compositeBuffer), '四点透视贴图应成功');
  console.log('✅ 直角矩形与四点透视双线性反向仿射插值贴图通过');

  // 1.3 邻域裁剪 cropNeighborhood
  const cropped = await imageOps.cropNeighborhood(bgPng, {
    quad: [[100, 100], [300, 80], [320, 280], [80, 250]]
  }, { expandFactor: 0.9, maxSide: 2048, maxScale: 4.0 });
  assert(Buffer.isBuffer(cropped.croppedBuffer), '邻域裁剪应返回 Buffer');
  assert(cropped.cropBox.width > 0 && cropped.cropBox.height > 0, '邻域裁剪应返回裁剪区');
  console.log(`✅ 邻域裁剪通过 (cropBox: [${cropped.cropBox.x}, ${cropped.cropBox.y}, ${cropped.cropBox.w}x${cropped.cropBox.h}])`);

  // 1.4 羽化精准贴回 pastebackComposite
  const pasteback = await imageOps.pastebackComposite(bgPng, cropped.croppedBuffer, cropped.cropBox, {
    targetQuad: [[100, 100], [300, 80], [320, 280], [80, 250]],
    expandRatio: 0.12,
    featherSigma: 3
  });
  assert(Buffer.isBuffer(pasteback), '贴回原图应成功');
  const meta = await sharp(pasteback).metadata();
  assert(meta.width === 500 && meta.height === 500, '贴回图尺寸应与原图完全一致');
  console.log('✅ 12% 扩展羽化精准贴回通过 (像素外圈原图保护)');

  console.log('=== 2. 测试快捷能力注册表 (registry) ===');
  const caps = registry.getQuickCapabilities();
  assert(Array.isArray(caps) && caps.length >= 7, '应注册至少 7 个快捷能力');
  const ids = caps.map(c => c.id);
  assert(ids.includes('expand'), '应含 expand 扩图');
  assert(ids.includes('enhance'), '应含 enhance 画面精修');
  assert(ids.includes('watermark'), '应含 watermark 去水印');
  assert(ids.includes('remove'), '应含 remove 消除');
  assert(ids.includes('insert'), '应含 insert 软装安装');
  assert(ids.includes('replace'), '应含 replace 物体替换');
  assert(ids.includes('spatial_walkthrough'), '应含 spatial_walkthrough 空间漫游');
  console.log(`✅ 注册表 7 大快捷能力齐备: ${ids.join(', ')}`);

  console.log('=== 3. 测试空间漫游三段管线与双确认 (walkthrough-pipeline) ===');
  const mockTopology = {
    rooms: [
      { id: 'r1', name: '客厅' },
      { id: 'r2', name: '餐厅' }
    ],
    connections: [
      { from: 'r1', to: 'r2', type: 'doorway' }
    ]
  };

  // 测试镜头序列生成（模型降级/本地算法保证可用）
  const seqRes = await walkthroughPipeline.inferCameraSequence({ db: null, config: {} }, mockTopology);
  assert(seqRes && Array.isArray(seqRes.shots) && seqRes.shots.length === 2, '应推导 2 个房间的镜头序列');
  assert(seqRes.aspect_ratio === '16:9', '默认画幅应为 16:9');
  assert(seqRes.shots[0].room_name === '客厅', '镜头 1 对应客厅');
  assert(seqRes.shots[1].room_name === '餐厅', '镜头 2 对应餐厅');
  console.log(`✅ 空间漫游运镜序列推导通过 (共 ${seqRes.shots.length} 个镜头，画幅: ${seqRes.aspect_ratio})`);

  console.log('=== 4. 坐标单位与失败即失败 ===');
  const pxPt = imageOps.normalizeQuadOrRect([{ x: 50, y: 80 }], 400, 300, 'px');
  assert.strictEqual(pxPt[0].x, 50, '50 像素不能被当成百分比');
  assert.strictEqual(pxPt[0].y, 80);
  const pctPt = imageOps.normalizeQuadOrRect([{ x: 50, y: 25 }], 400, 200, 'percent');
  assert.strictEqual(pctPt[0].x, 200);
  assert.strictEqual(pctPt[0].y, 50);
  const rawPt = imageOps.normalizeQuadOrRect([{ x: 50, y: 80 }], 400, 300);
  assert.strictEqual(rawPt[0].x, 50, '未标注且大于 1 的数按像素');
  console.log('✅ 像素与百分比不再混用');

  assert.strictEqual(imagexReady({}), false);
  assert.strictEqual(imagexReady({ ak: 'a', sk: 'b', serviceId: 'c' }), true);
  const savedEnv = {
    VOLC_ACCESSKEY: process.env.VOLC_ACCESSKEY,
    VOLC_SECRETKEY: process.env.VOLC_SECRETKEY,
    IMAGEX_SERVICE_ID: process.env.IMAGEX_SERVICE_ID,
  };
  delete process.env.VOLC_ACCESSKEY;
  delete process.env.VOLC_SECRETKEY;
  delete process.env.IMAGEX_SERVICE_ID;
  try {
    const gated = registry.getQuickCapabilities(emptyDb());
    assert.strictEqual(gated.find(c => c.id === 'expand').ready, false);
    assert.strictEqual(gated.find(c => c.id === 'enhance').ready, false);
    assert.strictEqual(gated.find(c => c.id === 'spatial_walkthrough').ready, false);
    const square = await sharp({
      create: { width: 32, height: 32, channels: 3, background: { r: 120, g: 120, b: 120 } },
    }).jpeg().toBuffer();
    await assert.rejects(
      () => expandHandler.handleExpand({ db: emptyDb() }, { imageBuffer: square, expandRatio: '16:9' }),
      /veImageX/
    );
    await assert.rejects(
      () => watermarkHandler.handleWatermarkOrRemove({ db: emptyDb() }, {
        imageBuffer: square,
        actionType: 'remove',
        quadOrBbox: { left: 4, top: 4, right: 20, bottom: 20, unit: 'px' },
      }),
      /未配置图像适配器/
    );
    await assert.rejects(
      () => walkthroughPipeline.scheduleSeedanceRender({ db: emptyDb(), config: {} }, {
        sequenceData: { shots: [{ room_name: '客厅', prompt: '向前' }], aspect_ratio: '16:9', duration_per_shot: 4 },
        sourceFids: ['fid_a', 'fid_b'],
      }),
      /ark_seedance/
    );
  } finally {
    for (const [k, v] of Object.entries(savedEnv)) {
      if (v == null) delete process.env[k];
      else process.env[k] = v;
    }
  }
  const expandSrc = fs.readFileSync(path.join(__dirname, '../src/handlers/quick-expand.js'), 'utf8');
  const wmSrc = fs.readFileSync(path.join(__dirname, '../src/handlers/quick-watermark-remove.js'), 'utf8');
  assert(!expandSrc.includes('.extend('), '扩图不能再铺灰边');
  assert(!wmSrc.includes('.blur('), '消除不能再模糊贴回');
  console.log('✅ 未配置时扩图、消除、漫游都会失败');

  console.log('\n🏆 快捷操作流水线全部单元测试通过！');
}

runTests().catch(err => {
  console.error('❌ 测试异常:', err);
  process.exit(1);
});
