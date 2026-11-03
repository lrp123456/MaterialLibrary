const { openDb } = require('../src/db');
const { prepareExportableBuffer, registerVisibleImageHashes, extractExportTag } = require('../src/export-tag');

function run() {
  const db = openDb('./data');

  // 1. 构造每次唯一的测试 JPEG Buffer
  const crypto = require('crypto');
  const uniqueTail = crypto.randomBytes(8);
  const rawBuf = Buffer.concat([
    Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01, 0x00, 0x00, 0x01, 0x00, 0x01, 0x00, 0x00]),
    uniqueTail
  ]);
  const fid = 'ML_BATCH_A_TEST_' + Date.now();

  const tagged = prepareExportableBuffer(db, rawBuf, { fid, variant: 'clean_9_16' });
  const tag = extractExportTag(tagged);

  if (!tag || tag.fid !== fid) {
    console.error('FAIL: tag extraction failed, got:', tag);
    process.exit(1);
  }

  const regRows = db.prepare('SELECT variant, source_fid FROM export_registry WHERE source_fid = ?').all(fid);
  if (regRows.length < 2) {
    console.error('FAIL: export_registry should record both raw and tagged buffers, got', regRows.length);
    process.exit(1);
  }

  console.log('PASS: Batch A verified! tag.fid=' + tag.fid + ', export_registry count=' + regRows.length);
  process.exit(0);
}

run();
