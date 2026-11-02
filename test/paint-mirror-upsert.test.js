/**
 * PR6 单元测试：PaintDB 镜像 Upsert 幂等性、置顶与僵死回收
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');

const testDir = path.join(os.tmpdir(), 'dsh_paint_upsert_test_' + Date.now());
fs.mkdirSync(testDir, { recursive: true });

process.env.ML_DATA_DIR = testDir;

const { openDb } = require('../src/db');
const { ensureBaseLibrarySchema } = require('../src/base-library/schema');
const {
  deriveChineseName,
  upsertPaintDbPage,
  cleanupDeadMirrorRuns
} = require('../src/base-library/sources/paintdb');

const db = openDb(testDir);
ensureBaseLibrarySchema(db);

async function runTests() {
  console.log('=== 1. 测试中文名称派生规则 ===');
  assert.strictEqual(deriveChineseName('warm', 'white'), '暖调白色');
  assert.strictEqual(deriveChineseName('cool', 'gray'), '冷调灰色');
  assert.strictEqual(deriveChineseName(null, 'beige'), '米色');
  console.log('✅ 中文名称派生正确');

  console.log('=== 2. 测试首次镜像单页入库（不再自动置顶前 36 条） ===');
  // 模拟第一批 40 条数据
  const batch1 = [];
  for (let i = 1; i <= 40; i++) {
    batch1.push({
      code: `NP_${i}`,
      name: `Color ${i}`,
      hex: `#${String(i).padStart(6, '0')}`,
      family: 'White',
      undertone: 'Warm',
      lrv: 80,
      interior: true
    });
  }

  const written1 = await upsertPaintDbPage(db, testDir, 'nippon-paint', batch1);
  assert.strictEqual(written1, 40);

  const totalInDb = db.prepare('SELECT COUNT(*) as c FROM ba_paints WHERE brand=?').get('nippon-paint').c;
  assert.strictEqual(totalInDb, 40);

  const pinnedCount = db.prepare('SELECT COUNT(*) as c FROM ba_paints WHERE brand=? AND pinned=1').get('nippon-paint').c;
  assert.strictEqual(pinnedCount, 0, '前 36 条不再自动置顶，默认浏览序由策展集与 LRV 控制');
  console.log('✅ 首次镜像与取消自动置顶验证通过');

  console.log('=== 3. 测试二次镜像重跑：不改写 alias_zh, pinned, shell_material_id ===');
  // 人工给 NP_1 设置别名和壳
  db.prepare(`
    UPDATE ba_paints
    SET alias_zh='人工精选白', pinned=0, shell_material_id='shell_xyz'
    WHERE code='NP_1'
  `).run();

  // 重跑镜像：NP_1 改变英文名与 hex
  const batchReRun = [
    {
      code: 'NP_1',
      name: 'Color 1 Updated',
      hex: '#FFFFFF',
      family: 'White',
      undertone: 'Warm'
    }
  ];

  await upsertPaintDbPage(db, testDir, 'nippon-paint', batchReRun);
  const rowAfter = db.prepare("SELECT * FROM ba_paints WHERE code='NP_1'").get();
  assert.strictEqual(rowAfter.name_en, 'Color 1 Updated', '英文名允许随上游更新');
  assert.strictEqual(rowAfter.hex, '#FFFFFF', 'HEX 允许随上游更新');
  assert.strictEqual(rowAfter.alias_zh, '人工精选白', '重跑绝不得覆盖已有 alias_zh');
  assert.strictEqual(rowAfter.pinned, 0, '重跑绝不得重置已修改的 pinned');
  assert.strictEqual(rowAfter.shell_material_id, 'shell_xyz', '重跑绝不得清空 shell_material_id');
  console.log('✅ 镜像幂等与人工元数据保护通过');

  console.log('=== 4. 测试僵死任务回收 (超时 2 分钟置为 error) ===');
  const twoMinAgo = Date.now() - 3 * 60 * 1000;
  db.prepare(`
    INSERT INTO ba_mirror_runs (brand, offset, written, state, error, updated_at)
    VALUES ('dulux', 50, 50, 'running', NULL, ?)
    ON CONFLICT(brand) DO UPDATE SET state='running', updated_at=excluded.updated_at
  `).run(twoMinAgo);

  cleanupDeadMirrorRuns(db);
  const duluxRun = db.prepare("SELECT * FROM ba_mirror_runs WHERE brand='dulux'").get();
  assert.strictEqual(duluxRun.state, 'error');
  assert.strictEqual(duluxRun.error, 'mirror_timeout');
  console.log('✅ 僵死镜像回收通过');

  console.log('\n🎉 PR6 paint-mirror-upsert 全部测试通过！');
}

runTests().catch(err => {
  console.error('测试失败:', err);
  process.exit(1);
});
