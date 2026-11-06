/**
 * 抽帧代理的纯函数：浏览器能不能播、GOP 对齐。
 * 不连生产库，不转用户的片子。
 */
const assert = require('assert');
const { browserCanPlayVideo, gopStartFor, frameIndexInGop, gopSecondsFromPts } = require('../src/media-tools');

function main() {
  assert.strictEqual(browserCanPlayVideo({ codec: 'h264', pixFmt: 'yuv420p' }), true);
  assert.strictEqual(browserCanPlayVideo({ codec: 'hevc', pixFmt: 'yuv420p' }), false, 'HEVC 不能交给浏览器实时切帧');
  assert.strictEqual(browserCanPlayVideo({ codec: 'h264', pixFmt: 'yuv420p10le' }), false, '10-bit 不能当可播放');
  assert.strictEqual(browserCanPlayVideo({ codec: 'prores', pixFmt: 'yuv422p10le' }), false);

  assert.strictEqual(gopSecondsFromPts([0, 2, 4, 6]), 2);
  assert.strictEqual(gopStartFor(16.4, 2, 32.08), 16);
  assert.strictEqual(gopStartFor(0, 2, 32), 0);
  assert.strictEqual(gopStartFor(32.05, 2, 32.08), 32);
  assert.strictEqual(frameIndexInGop(16.5, 16, 60, 120), 30);
  assert.strictEqual(frameIndexInGop(17.99, 16, 60, 120), 119);

  console.log('media-tools-frame ok');
}

main();
