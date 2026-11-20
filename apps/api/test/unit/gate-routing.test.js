/**
 * Phase 3 验收门禁测试 2：多源门禁分流与相册轻量质检测试 (Gate Routing Test)
 *
 * 验证目标：
 * 1. web_upload, studio_save, app_manual 强行绕过 QC 门禁节点：
 *    即使带有纯黑或重复标志，仍绝对保持 visibility = 'visible'；
 * 2. app_album_sync 默认入库为 visibility = 'visible'；
 * 3. 仅当 app_album_sync 命中高置信度拒收规则（纯黑 / 完全重复）时，才转移至 rejected_box；
 * 4. 拒收后管道状态正确同步更新至数据库与事件总线。
 */
const assert = require('assert');
const path = require('path');
const os = require('os');
const fs = require('fs');

// 隔离外部 Redis
const pubsub = require('../../../worker/src/pubsub');
pubsub.publishEvent = async () => true;

const Database = require('better-sqlite3');
const { handleIngestPipeline } = require('../../../worker/src/queues/ingest');

async function run() {
  console.log('=== Phase 3 Gate 2: 多源门禁分流与相册质检测试 ===');

  const testDbPath = path.join(os.tmpdir(), `mls_gate_test_${Date.now()}.db`);
  const db = new Database(testDbPath);

  db.exec(`
    CREATE TABLE assets (
      fid TEXT PRIMARY KEY,
      user_id INTEGER,
      source_type TEXT,
      visibility TEXT NOT NULL DEFAULT 'visible',
      pipeline_status TEXT NOT NULL DEFAULT 'queued',
      created_at INTEGER
    );
  `);

  // 1. 测试主动源 (web_upload, studio_save, app_manual) 即使图片全黑或重复也绝不拒收
  const bypassSources = ['web_upload', 'studio_save', 'app_manual'];
  for (const src of bypassSources) {
    const fid = `bypass_${src}`;
    db.prepare(`
      INSERT INTO assets (fid, user_id, source_type, visibility, pipeline_status, created_at)
      VALUES (?, 1, ?, 'visible', 'queued', ?)
    `).run(fid, src, Date.now());

    const res = await handleIngestPipeline(
      {
        assetFid: fid,
        userId: 1,
        sourceType: src,
        isPureBlack: true,
        isDuplicate: true
      },
      { db }
    );

    assert.strictEqual(res.visibility, 'visible', `${src} 必须绕过门禁保持 visible`);
    assert.strictEqual(res.pipelineStatus, 'done', `${src} 处理状态应为 done`);
    assert.strictEqual(res.rejected, false, `${src} 绝不能被拒收`);

    const row = db.prepare('SELECT visibility FROM assets WHERE fid = ?').get(fid);
    assert.strictEqual(row.visibility, 'visible');
  }

  // 2. 测试 app_album_sync 正常图片顺利入库
  {
    const fid = 'album_normal_1';
    db.prepare(`
      INSERT INTO assets (fid, user_id, source_type, visibility, pipeline_status, created_at)
      VALUES (?, 1, 'app_album_sync', 'visible', 'queued', ?)
    `).run(fid, Date.now());

    const res = await handleIngestPipeline(
      {
        assetFid: fid,
        userId: 1,
        sourceType: 'app_album_sync',
        isPureBlack: false,
        isDuplicate: false
      },
      { db }
    );

    assert.strictEqual(res.visibility, 'visible');
    assert.strictEqual(res.pipelineStatus, 'done');
    assert.strictEqual(res.rejected, false);

    const row = db.prepare('SELECT visibility FROM assets WHERE fid = ?').get(fid);
    assert.strictEqual(row.visibility, 'visible');
  }

  // 3. 测试 app_album_sync 纯黑图片命中高置信度拒收
  {
    const fid = 'album_pure_black_1';
    db.prepare(`
      INSERT INTO assets (fid, user_id, source_type, visibility, pipeline_status, created_at)
      VALUES (?, 1, 'app_album_sync', 'visible', 'queued', ?)
    `).run(fid, Date.now());

    const res = await handleIngestPipeline(
      {
        assetFid: fid,
        userId: 1,
        sourceType: 'app_album_sync',
        isPureBlack: true,
        isDuplicate: false
      },
      { db }
    );

    assert.strictEqual(res.visibility, 'rejected_box', '相册同步全黑图必须进入 rejected_box');
    assert.strictEqual(res.pipelineStatus, 'done');
    assert.strictEqual(res.rejected, true);

    const row = db.prepare('SELECT visibility FROM assets WHERE fid = ?').get(fid);
    assert.strictEqual(row.visibility, 'rejected_box');
  }

  // 4. 测试 app_album_sync 完全重复图片命中拒收
  {
    const fid = 'album_duplicate_1';
    db.prepare(`
      INSERT INTO assets (fid, user_id, source_type, visibility, pipeline_status, created_at)
      VALUES (?, 1, 'app_album_sync', 'visible', 'queued', ?)
    `).run(fid, Date.now());

    const res = await handleIngestPipeline(
      {
        assetFid: fid,
        userId: 1,
        sourceType: 'app_album_sync',
        isPureBlack: false,
        isDuplicate: true
      },
      { db }
    );

    assert.strictEqual(res.visibility, 'rejected_box', '相册同步完全重复图必须进入 rejected_box');
    assert.strictEqual(res.pipelineStatus, 'done');
    assert.strictEqual(res.rejected, true);

    const row = db.prepare('SELECT visibility FROM assets WHERE fid = ?').get(fid);
    assert.strictEqual(row.visibility, 'rejected_box');
  }

  db.close();
  try { fs.unlinkSync(testDbPath); } catch (_) {}

  console.log('✓ Phase 3 Gate 2: 多源门禁分流与相册质检测试全部通过！');
}

if (require.main === module) {
  run().catch((err) => {
    console.error('门禁分流测试失败:', err);
    process.exit(1);
  });
}

module.exports = run;
