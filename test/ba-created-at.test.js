const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { openDb } = require('../src/db');
const { upsertCreationCard } = require('../src/ba-resource');

const testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dsh_ba_created_at_'));
const db = openDb(testDir);

try {
  const record = {
    id: '99901',
    context: '现代极简客厅落地窗渲染',
    type: 'video',
    url: 'https://img.naite.cc/videos/sample.mp4',
    createTime: '2026-10-22 17:00:27',
    info: JSON.stringify({
      ratio: '9:16',
      resolution: '480p',
      duration: '15',
      modelId: 'doubao-seedance-2-0-260128',
      referenceImages: ['https://img.naite.cc/product/sample_ref.jpg']
    })
  };

  const id = upsertCreationCard(db, record);
  assert.strictEqual(id, 'ba_99901', 'id 应该为 ba_99901');

  const row = db.prepare('SELECT * FROM creation_templates WHERE id=?').get(id);
  assert(row, '应该成功插入 creation_templates 记录');

  const expectedTs = new Date('2026-10-22 17:00:27').getTime();
  assert.strictEqual(row.created_at, expectedTs, `created_at 应该与 record.createTime 一致: ${expectedTs}, 实际: ${row.created_at}`);
  assert.strictEqual(row.type, 'video', 'type 应该为 video');
  assert.strictEqual(row.aspect_ratio, '9:16', 'aspect_ratio 应该为 9:16');

  // 测试再次 upsert 是否保留/正确更新 created_at
  const recordUpdate = {
    ...record,
    context: '现代极简客厅落地窗渲染（已微调）',
    createTime: '2026-10-22 17:00:27'
  };
  const id2 = upsertCreationCard(db, recordUpdate);
  assert.strictEqual(id2, 'ba_99901');
  const row2 = db.prepare('SELECT * FROM creation_templates WHERE id=?').get(id2);
  assert.strictEqual(row2.created_at, expectedTs, '再次 upsert 应保留真实创建时间戳');
  assert.strictEqual(row2.prompt, '现代极简客厅落地窗渲染（已微调）');

  console.log('✅ upsertCreationCard 时间戳解析与持久化测试完全通过');
} finally {
  try { db.close(); } catch {}
  try { fs.rmSync(testDir, { recursive: true, force: true }); } catch {}
}
