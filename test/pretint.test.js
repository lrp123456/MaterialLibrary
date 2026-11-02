/**
 * 预染色：明度残差，禁止通道除法爆成纯白或霓虹。
 */

const assert = require('assert');
const sharp = require('sharp');
const { preTintBasecolor, residualGain, tintRel } = require('../src/base-library/pretint');

function meanRgb(data) {
  let r = 0; let g = 0; let b = 0;
  const n = data.length / 3;
  for (let i = 0; i < data.length; i += 3) {
    r += data[i]; g += data[i + 1]; b += data[i + 2];
  }
  return { r: r / n, g: g / n, b: b / n, n };
}

function variance(data) {
  const m = meanRgb(data);
  let acc = 0;
  for (let i = 0; i < data.length; i += 3) {
    acc += (data[i] - m.r) ** 2;
  }
  return acc / (data.length / 3);
}

async function rawOf(buf) {
  return sharp(buf).removeAlpha().raw().toBuffer({ resolveWithObject: true });
}

async function textured(width, height, base, spot) {
  const buf = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const src = x < width / 2 ? base : spot;
      const i = y * width + x;
      buf[i * 3] = src[0];
      buf[i * 3 + 1] = src[1];
      buf[i * 3 + 2] = src[2];
    }
  }
  return sharp(buf, { raw: { width, height, channels: 3 } }).png().toBuffer();
}

async function run() {
  const gain = residualGain(243, 230, 212);
  assert.ok(gain.k >= 0.35 && gain.k <= 0.85);
  assert.ok(gain.cap < 20, '奶油色余量必须压住高光');

  const wood = await textured(32, 32, [40, 28, 18], [180, 140, 90]);
  const cream = await preTintBasecolor(wood, '#F3E6D4');
  const creamRaw = await rawOf(cream);
  const creamMean = meanRgb(creamRaw.data);
  assert.ok(Math.abs(creamMean.r - 243) < 8, `cream R ${creamMean.r}`);
  assert.ok(Math.abs(creamMean.g - 230) < 8, `cream G ${creamMean.g}`);
  assert.ok(Math.abs(creamMean.b - 212) < 8, `cream B ${creamMean.b}`);
  assert.ok(variance(creamRaw.data) > 1, '奶油染色后纹理还在');
  for (let i = 0; i < creamRaw.data.length; i += 3) {
    assert.ok(!(creamRaw.data[i] === 255 && creamRaw.data[i + 1] === 255 && creamRaw.data[i + 2] === 255));
    assert.ok(creamRaw.data[i + 2] < 250, '弱蓝通道不得爆成 255');
  }

  const ink = await preTintBasecolor(wood, '#222325');
  const inkRaw = await rawOf(ink);
  const inkMean = meanRgb(inkRaw.data);
  assert.ok(Math.abs(inkMean.r - 0x22) < 8);
  assert.ok(variance(inkRaw.data) > 0.5);
  let zeros = 0;
  for (let i = 0; i < inkRaw.data.length; i++) if (inkRaw.data[i] === 0) zeros++;
  assert.ok(zeros < inkRaw.data.length * 0.05, '深色不得整片贴死 0');

  const midSrc = await textured(24, 24, [30, 30, 30], [180, 180, 180]);
  const mid = await preTintBasecolor(midSrc, '#808080');
  const midMean = meanRgb((await rawOf(mid)).data);
  assert.ok(Math.abs(midMean.r - 128) < 2, `mid R ${midMean.r}`);
  assert.ok(Math.abs(midMean.g - 128) < 2, `mid G ${midMean.g}`);
  assert.ok(Math.abs(midMean.b - 128) < 2, `mid B ${midMean.b}`);

  assert.throws(() => tintRel('../etc', 'AABBCC'));
  assert.strictEqual(tintRel('mat_oak', '#aabbcc').rel, 'cache/base-library/tint/mat_oak_AABBCC.jpg');
  console.log('pretint ok');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
