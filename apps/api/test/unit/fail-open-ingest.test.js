/**
 * Phase 3 验收门禁测试 1：Fail-Open 故障注入测试 (Fail-Open Ingest Test)
 *
 * 验证目标：
 * 1. 模拟特征提取/VLM 节点出现 502/超时/Sharp 抛出异常；
 * 2. 覆盖 4 个素材来源：web_upload, studio_save, app_manual, app_album_sync；
 * 3. 铁律验证：素材 visibility 100% 保持 'visible'，绝不隐藏或被拒收；
 * 4. pipeline_status 准确标记为 'partial_failed'；
 * 5. 异常正确记录上报至 error-reporter；
 * 6. 素材列表查询 (visibility = 'visible') 仍可稳定查出该素材。
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
const { BROWSE_READY_SQL } = require('../../src/asset-status');

async function run() {
  console.log('=== Phase 3 Gate 1: Fail-Open 故障注入验证 ===');

  const testDbPath = path.join(os.tmpdir(), `mls_failopen_test_${Date.now()}.db`);
  const db = new Database(testDbPath);

  db.exec(`
    CREATE TABLE assets (
      fid TEXT PRIMARY KEY,
      user_id INTEGER,
      source_type TEXT,
      visibility TEXT NOT NULL DEFAULT 'visible',
      pipeline_status TEXT NOT NULL DEFAULT 'queued',
      status TEXT DEFAULT 'ready',
      created_at INTEGER
    );
  `);

  const reportedErrors = [];
  const mockReportError = (errObj) => {
    reportedErrors.push(errObj);
  };

  const sourceTypes = ['web_upload', 'studio_save', 'app_manual', 'app_album_sync'];

  for (let i = 0; i < sourceTypes.length; i++) {
    const src = sourceTypes[i];
    const fid = `test_fid_${src}_${i}`;

    // 初始入库
    db.prepare(`
      INSERT INTO assets (fid, user_id, source_type, visibility, pipeline_status, created_at)
      VALUES (?, 1, ?, 'visible', 'queued', ?)
    `).run(fid, src, Date.now());

    // 模拟下游 VLM 节点抛出 502 网关错误或超时
    const faultyVlmHandler = async () => {
      const err = new Error(`VLM upstream 502 Bad Gateway / timeout on node ${src}`);
      err.code = 502;
      throw err;
    };

    const res = await handleIngestPipeline(
      {
        assetFid: fid,
        userId: 1,
        sourceType: src,
        vlmHandler: faultyVlmHandler
      },
      {
        db,
        reportError: mockReportError
      }
    );

    // 验证返回值
    assert.strictEqual(res.visibility, 'visible', `[Fail-Open 铁律] ${src} 在 VLM 崩溃时 visibility 必须为 visible`);
    assert.strictEqual(res.pipelineStatus, 'partial_failed', `[Fail-Open 状态] ${src} pipelineStatus 必须为 partial_failed`);
    assert.strictEqual(res.rejected, false, `${src} 绝不能被标记为 rejected`);

    // 验证数据库持久化状态
    const row = db.prepare('SELECT * FROM assets WHERE fid = ?').get(fid);
    assert.strictEqual(row.visibility, 'visible', `DB 中 ${src} visibility 必须依然为 visible`);
    assert.strictEqual(row.pipeline_status, 'partial_failed', `DB 中 ${src} pipeline_status 必须为 partial_failed`);
  }

  // 验证错误上报机制
  assert.strictEqual(reportedErrors.length, 4, '所有 4 次异常均应上报至旁路监控');
  for (const rep of reportedErrors) {
    assert.strictEqual(rep.module, 'ingest');
    assert.strictEqual(rep.errorCode, 'ERR_VLM_OR_PIPELINE');
    assert(rep.err.message.includes('502 Bad Gateway'));
  }

  // 验证素材列表查询兼容性（Fail-Open 的素材在列表查询中依然 100% 可见）
  const visibleCount = db.prepare(`SELECT COUNT(*) as c FROM assets WHERE ${BROWSE_READY_SQL.replace(/a\./g, '')}`).get().c;
  assert.strictEqual(visibleCount, 4, '4 个发生节点异常的素材全部都在列表中正常可见');

  db.close();
  try { fs.unlinkSync(testDbPath); } catch (_) {}

  console.log('✓ Phase 3 Gate 1: Fail-Open 故障注入验证全部通过！');
}

if (require.main === module) {
  run().catch((err) => {
    console.error('Fail-Open 测试失败:', err);
    process.exit(1);
  });
}

module.exports = run;
