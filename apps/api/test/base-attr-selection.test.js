/**
 * base_attr 没有选区时不得调用生图适配器。
 */

const assert = require('assert');
const sharp = require('sharp');
const { handleEditRun } = require('../src/handlers/edit-run');

async function run() {
  const buf = await sharp({
    create: { width: 16, height: 16, channels: 3, background: '#ffffff' }
  }).jpeg().toBuffer();
  let message = '';
  try {
    await handleEditRun({}, { op: 'base_attr', sceneImageBuffer: buf });
  } catch (err) {
    message = err.message || '';
  }
  assert.ok(message.includes('未指定有效选区'), message || '应当抛出未指定有效选区');
  assert.ok(!message.includes('适配器'), message);
  console.log('base_attr selection guard ok');
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
