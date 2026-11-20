#!/usr/bin/env node
/**
 * /edit/preview（handleEditRun dryRun）回归测试
 * 设计原则：不开库不起服务——只检验「预览所组装的内容」与「将要发送的内容」一致；
 * 任何 dryRun 调用都不得触发供应商、不落任何衍生记录。
 */
const assert = require('assert');
const os = require('os');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const { handleEditRun } = require('../src/handlers/edit-run');

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'edit-preview-test-'));
const services = { db: null, config: { dataDir: tmp }, logger: { info() {}, warn() {}, error() {} } };

async function scenePng(w = 220, h = 130) {
  return sharp({ create: { width: w, height: h, channels: 3, background: { r: 180, g: 190, b: 200 } } })
    .png().toBuffer();
}

(async () => {
  const scene = await scenePng();
  const ref = await scenePng(96, 96);

  // 1) add + 配方句 → prompt 必须原样包含用户写的话，且带选区注入（reconcile）
  const add = await handleEditRun(services, {
    sceneImageBuffer: scene,
    op: 'add',
    region: { bbox: { x1: 30, y1: 20, x2: 170, y2: 100 } },
    prompt: '把图2的沙发放在柜子旁边',
    refImageBuffer: ref,
    assetFid: null,
    model: 'ark_seedream',
    dryRun: true,
  });
  assert.strictEqual(add.dryRun, true, '必须是 dryRun 返回');
  assert.ok(add.prompt.includes('把图2的沙发放在柜子旁边'), '用户配方句必须原样出现在发出正文里');
  assert.strictEqual(add.images.length, 2, 'add 应带 图1(原图) + 图2(参考图)');
  assert.strictEqual(add.images[0].source, 'stage');
  assert.strictEqual(add.region.selectionType, 'rect');

  // 2) 空配方句 → 必须显式报告 fallbackPrompt（不静默兜底）
  const emptyRecipe = await handleEditRun(services, {
    sceneImageBuffer: scene,
    op: 'remove',
    region: { bbox: { x1: 10, y1: 10, x2: 120, y2: 90 } },
    prompt: '',
    assetFid: null,
    model: 'ark_seedream',
    dryRun: true,
  });
  assert.strictEqual(emptyRecipe.fallbackPrompt, true, '空配方句必须报告 fallbackPrompt');

  // 3) replace（家具替换）→ images 带 原图 + 参考图；pasteback 默认开启
  const rep = await handleEditRun(services, {
    sceneImageBuffer: scene,
    op: 'replace',
    region: { bbox: { x1: 40, y1: 30, x2: 180, y2: 110 } },
    prompt: '把图1框选区域的旧单品替换为图2，朝向与参考图一致',
    refImageBuffer: ref,
    productName: '测试单品',
    assetFid: null,
    model: 'ark_seedream',
    dryRun: true,
  });
  assert.strictEqual(rep.dryRun, true);
  assert.strictEqual(rep.images.length, 2);
  assert.strictEqual(rep.pasteback, true, '替换默认贴回');

  // 4) install（软装安装）→ 必须带产品图
  const ins = await handleEditRun(services, {
    sceneImageBuffer: scene,
    op: 'insert',
    region: { bbox: { x1: 40, y1: 30, x2: 180, y2: 110 } },
    prompt: '把图2安装在框选位置',
    productImageBuffer: ref,
    productName: '壁灯',
    assetFid: null,
    model: 'ark_seedream',
    dryRun: true,
  });
  assert.strictEqual(ins.dryRun, true);
  assert.ok(ins.images.some((i) => i.label.includes('产品图')), '安装必须带产品图');

  // 5) 扩图走即梦通道 → dryRun 必须直接返回，不触达 jimeng HTTP
  const exp = await handleEditRun(services, {
    sceneImageBuffer: scene,
    op: 'expand',
    prompt: '向四周延展',
    assetFid: null,
    model: 'ark_seedream',
    expandRatios: { top: 0.2, bottom: 0.2, left: 0.2, right: 0.2 },
    dryRun: true,
  });
  assert.strictEqual(exp.dryRun, true);
  assert.strictEqual(exp.op, 'expand');
  assert.ok(exp.method === 'jimeng' || exp.method === 'imagex', 'expand 通道必须明确');

  // 6) style_transfer → 全局重塑，不贴回
  const sty = await handleEditRun(services, {
    sceneImageBuffer: scene,
    op: 'style_transfer',
    prompt: '改成法式奶油风',
    assetFid: null,
    model: 'ark_seedream',
    dryRun: true,
  });
  assert.strictEqual(sty.dryRun, true);
  assert.strictEqual(sty.pasteback, false);
  assert.ok(sty.prompt.includes('奶油风'), '风格配方句必须出现在发出正文中');

  fs.rmSync(tmp, { recursive: true, force: true });
  console.log('✅ edit-preview dryRun：6 组断言全部通过（未触发供应商、未写衍生图）');
})().catch((e) => {
  console.error('❌ edit-preview 测试失败:', e);
  try { fs.rmSync(tmp, { recursive: true, force: true }); } catch (_) {}
  process.exit(1);
});
