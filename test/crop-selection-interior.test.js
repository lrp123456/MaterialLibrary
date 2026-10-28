/**
 * 选区内部裁切单元测试 (cropSelectionInterior)
 * 验证：矩形提取、多边形外接矩形、280~1568 范围适配、极端长宽比 (>5.6) 延展
 */

const assert = require('assert');
const sharp = require('sharp');
const { cropSelectionInterior } = require('../src/handlers/image-ops');

async function runTests() {
  console.log('=== 1. 测试矩形选区内部裁切 ===');
  // 创建 1000x800 测试图
  const baseImg = await sharp({
    create: { width: 1000, height: 800, channels: 3, background: { r: 120, g: 150, b: 200 } }
  }).jpeg().toBuffer();

  const rectSel = {
    type: 'rect',
    norm: { x: 0.2, y: 0.2, w: 0.4, h: 0.5 } // 400 x 400
  };
  const crop1 = await cropSelectionInterior(baseImg, rectSel);
  const m1 = await sharp(crop1).metadata();
  assert.strictEqual(m1.format, 'jpeg', '输出必须为 JPEG');
  assert.strictEqual(m1.width, 400, '宽度保持 400');
  assert.strictEqual(m1.height, 400, '高度保持 400');
  console.log('✅ 矩形选区裁切正常');

  console.log('=== 2. 测试多边形选区外接矩形内部裁切 ===');
  const polySel = {
    type: 'polygon',
    norm_points: [
      { x: 0.1, y: 0.1 },
      { x: 0.7, y: 0.2 },
      { x: 0.6, y: 0.6 },
      { x: 0.2, y: 0.5 }
    ] // 外接矩形: x: 0.1~0.7 (w=0.6 -> 600px), y: 0.1~0.6 (h=0.5 -> 500px)
  };
  const crop2 = await cropSelectionInterior(baseImg, polySel);
  const m2 = await sharp(crop2).metadata();
  assert.strictEqual(m2.format, 'jpeg');
  assert.strictEqual(m2.width, 600, '外接矩形宽 600');
  assert.strictEqual(m2.height, 400, '外接矩形高 400 (800 * 0.5)');
  console.log('✅ 多边形选区外接矩形裁切正常');

  console.log('=== 3. 测试短边 < 280 放大到 280 ===');
  const smallSel = {
    type: 'rect',
    norm: { x: 0.1, y: 0.1, w: 0.1, h: 0.05 } // 100 x 40, ar = 2.5 <= 5.6, short = 40 < 280
  };
  const crop3 = await cropSelectionInterior(baseImg, smallSel);
  const m3 = await sharp(crop3).metadata();
  assert.strictEqual(m3.height, 280, '短边必须放大至 280');
  assert.strictEqual(m3.width, 700, '长边按比例放大至 700 (280 * 2.5)');
  console.log('✅ 短边不足 280 放大适配正常');

  console.log('=== 4. 测试长边 > 1568 缩小到 1568 ===');
  const bigImg = await sharp({
    create: { width: 3000, height: 2000, channels: 3, background: { r: 50, g: 80, b: 100 } }
  }).jpeg().toBuffer();
  const bigSel = {
    type: 'rect',
    norm: { x: 0, y: 0, w: 0.8, h: 0.6 } // 2400 x 1200, ar = 2.0 <= 5.6, long = 2400 > 1568
  };
  const crop4 = await cropSelectionInterior(bigImg, bigSel);
  const m4 = await sharp(crop4).metadata();
  assert.strictEqual(m4.width, 1568, '长边必须缩至 1568');
  assert.strictEqual(m4.height, 784, '短边按比例缩小至 784 (1568 / 2)');
  console.log('✅ 长边超出 1568 缩小适配正常');

  console.log('=== 5. 测试高长宽比 (> 5.6) 边缘像素延展至 280 ===');
  const stripSel = {
    type: 'rect',
    norm: { x: 0, y: 0, w: 0.8, h: 0.02 } // 2400 x 40, ar = 60 > 5.6
  };
  const crop5 = await cropSelectionInterior(bigImg, stripSel);
  const m5 = await sharp(crop5).metadata();
  assert.strictEqual(m5.width, 1568, '长边必须先收到 1568');
  assert.strictEqual(m5.height, 280, '短边必须延展补齐到 280');
  assert.ok(m5.width * m5.height <= 2458624, '总像素不得超过上限');
  assert.ok(m5.width * m5.height >= 78400, '总像素不得低于下限');
  console.log('✅ 高长宽比边缘像素延展正常');

  console.log('\n🎉 cropSelectionInterior 单元测试全部通过！');
}

runTests().catch((err) => {
  console.error('测试失败:', err);
  process.exit(1);
});
