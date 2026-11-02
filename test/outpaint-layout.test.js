const assert = require('assert');

async function main() {
  const { computeOutpaintNorm } = await import('../src/outpaint-layout.mjs');

function side(occupancy) {
  return computeOutpaintNorm({
    nativeW: 720,
    nativeH: 1280,
    targetRatio: '16:9',
    occupancy
  });
}

const at70 = side(0.7);
const at40 = side(0.4);
const at90 = side(0.9);
const at82 = side(0.82);

assert.ok(at40.leftPct > at70.leftPct && at70.leftPct > at90.leftPct, '占比越低，左右延展越大');
for (const row of [at70, at40, at90, at82]) {
  const aspect = row.innerW / row.innerH;
  assert.ok(Math.abs(aspect - 720 / 1280) < 0.001, '原图宽高比保持不变');
  assert.ok(row.innerH <= row.canvasH + 1e-9 && row.innerW <= row.canvasW + 1e-9);
}
assert.ok(Math.abs(at82.leftPct - 143) < 4, `0.82 应接近 143%，实际 ${at82.leftPct}`);
assert.notStrictEqual(at70.leftPct, at82.leftPct);

const shifted = computeOutpaintNorm({
  nativeW: 720,
  nativeH: 1280,
  targetRatio: '16:9',
  occupancy: 0.7,
  offsetX: 0.2,
  offsetY: -0.1
});
assert.ok(shifted.left >= 0 && shifted.left + shifted.innerW <= shifted.canvasW + 1e-6);

console.log('outpaint-layout ok', {
  p40: at40.leftPct,
  p70: at70.leftPct,
  p90: at90.leftPct,
  p82: at82.leftPct
});
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
