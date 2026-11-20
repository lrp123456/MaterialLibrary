/**
 * 本机 QwenImage 适配器传输优化回归：
 * - 参考图长边 >1536 时等比缩小并转 JPEG（multipart 体积显著下降）
 * - 小图原样返回（null，调用方回退原图）
 * - 带 alpha 的 PNG 不被压平成白底
 */
const assert = require('assert');
const sharp = require('sharp');
const qw = require('../src/gen/qwenimage-local');

async function main() {
  const big = await sharp({ create: { width: 3000, height: 2000, channels: 3, background: '#7fa1c3' } })
    .png().toBuffer();
  const compact = await qw.compactRefBuffer(big);
  assert.ok(Buffer.isBuffer(compact), '大图必须返回压缩后的 Buffer');
  const meta = await sharp(compact).metadata();
  assert.strictEqual(meta.format, 'jpeg');
  assert.strictEqual(meta.width, 1536);
  assert.strictEqual(meta.height, 1024);
  assert.ok(compact.length < big.length, '压缩后必须更小');

  const small = await sharp({ create: { width: 800, height: 600, channels: 3, background: '#fff' } })
    .jpeg().toBuffer();
  assert.strictEqual(await qw.compactRefBuffer(small), null, '小于阈值的图不处理');

  const alphaPng = await sharp({ create: { width: 2000, height: 1000, channels: 4, background: { r: 0, g: 0, b: 0, alpha: 0 } } })
    .png().toBuffer();
  const alphaOut = await qw.compactRefBuffer(alphaPng);
  const am = await sharp(alphaOut).metadata();
  assert.strictEqual(am.format, 'png', '带透明通道的参考图必须保留 PNG（蒙版不能被白底压平）');
  assert.strictEqual(am.hasAlpha, true);
  assert.strictEqual(am.width, 1536);

  assert.strictEqual(await qw.compactRefBuffer(Buffer.from('not an image')), null, '非图片返回 null');
  console.log('✔ qwenimage-local 传输优化验收通过');
}

main().catch((e) => { console.error(e); process.exit(1); });
