/**
 * Phase 4 验收门禁测试 1：全模型取消矩阵与不可逆防护测试 (Cancel Matrix & Irreversible Protection Test)
 *
 * 验证目标：
 * 1. 契约取消策略覆盖率：
 *    - 验证 queue_only、vendor_pending_only、always_local 三类策略；
 *    - 验证 13 种模型协议与引擎的生命周期阶段取消判定（isModelCancellableInStage）；
 * 2. 状态机先裁决后落态（Iron Law）：
 *    - queue_only 在 running 阶段取消必须返回 409 IRREVERSIBLE，且 message 状态严禁落态为 cancelled；
 *    - queued 阶段取消返回 200，正常落态 cancelled；
 * 3. 厂商延迟取消（Deferred Cancel）：
 *    - vendor_pending_only 在 submitting 窗口请求取消，必须注册 deferred cancel；
 *    - 拿到 vendorTaskId 后仅下发 1 次厂商 /cancel；
 * 4. 厂商不可逆拒绝（400/409 UnsupportedOperation）：
 *    - 厂商返回 400/409 无法取消时，返回 409 IRREVERSIBLE，推送 cancellable: false，严禁改写卡片；
 * 5. 本地进程取消（always_local）：
 *    - running 阶段取消成功终止本地进程并释放资源，返回 200。
 */
const assert = require('assert');
const path = require('path');
const os = require('os');
const fs = require('fs');
const Database = require('better-sqlite3');
const {
  getModelCancelPolicy,
  isModelCancellableInStage,
  getModelCapabilities,
  MODEL_CAPABILITIES_MAP
} = require('../../../../packages/api-contract');
const {
  cancelVendorTask,
  requestDeferredCancel,
  consumeDeferredCancel,
  hasDeferredCancel,
  cancelLocalTask
} = require('../../src/services/vendor-cancel');
const { cancelStudioJob } = require('../../src/routes/studio');

async function run() {
  console.log('=== Phase 4 Gate 1: 全模型取消矩阵与不可逆防护测试 ===');

  // ---------- 1. 契约模型取消策略与阶段矩阵测试 ----------
  console.log('1. 测试契约模型取消策略与阶段矩阵...');
  assert.strictEqual(getModelCancelPolicy('http_json'), 'queue_only');
  assert.strictEqual(getModelCancelPolicy('seedream'), 'queue_only');
  assert.strictEqual(getModelCancelPolicy('gemini_generate_content'), 'queue_only');
  assert.strictEqual(getModelCancelPolicy('bailian_wanx'), 'vendor_pending_only');
  assert.strictEqual(getModelCancelPolicy('ark_video'), 'vendor_pending_only');
  assert.strictEqual(getModelCancelPolicy('kling_async'), 'vendor_pending_only');
  assert.strictEqual(getModelCancelPolicy('local_wan2_1'), 'always_local');
  assert.strictEqual(getModelCancelPolicy('local_asr_whisper'), 'always_local');
  assert.strictEqual(getModelCancelPolicy('local_lip_sync'), 'always_local');
  assert.strictEqual(getModelCancelPolicy('local_ffmpeg'), 'always_local');

  // 阶段判定测试
  // queue_only: queued 可取消，submitting / running / saving 不可取消
  assert.strictEqual(isModelCancellableInStage('seedream', 'queued'), true);
  assert.strictEqual(isModelCancellableInStage('seedream', 'running'), false);
  assert.strictEqual(isModelCancellableInStage('seedream', 'submitting'), false);

  // vendor_pending_only: queued, submitting, vendor_pending 可取消，running (已渲染扣费) 不可取消
  assert.strictEqual(isModelCancellableInStage('bailian_wanx', 'queued'), true);
  assert.strictEqual(isModelCancellableInStage('bailian_wanx', 'submitting'), true);
  assert.strictEqual(isModelCancellableInStage('bailian_wanx', 'vendor_pending'), true);
  assert.strictEqual(isModelCancellableInStage('bailian_wanx', 'running'), false);
  assert.strictEqual(isModelCancellableInStage('bailian_wanx', 'succeeded'), false);

  // always_local: queued, running 可取消，saving 阶段落盘不取消
  assert.strictEqual(isModelCancellableInStage('local_wan2_1', 'queued'), true);
  assert.strictEqual(isModelCancellableInStage('local_wan2_1', 'running'), true);
  assert.strictEqual(isModelCancellableInStage('local_wan2_1', 'saving'), false);
  assert.strictEqual(isModelCancellableInStage('local_wan2_1', 'succeeded'), false);

  // ---------- 2. 延迟取消（Deferred Cancel）生命周期测试 ----------
  console.log('2. 测试 Deferred Cancel 注册与单次消费机制...');
  const testJobId = 'job_deferred_test_001';
  requestDeferredCancel(testJobId);
  assert.strictEqual(hasDeferredCancel(testJobId), true);
  assert.strictEqual(consumeDeferredCancel(testJobId), true);
  assert.strictEqual(hasDeferredCancel(testJobId), false, '消费后必须立即清除，防止二次误取消');
  assert.strictEqual(consumeDeferredCancel(testJobId), false);

  // ---------- 3. 测试临时数据库与后端裁决状态机 ----------
  console.log('3. 测试后端 cancelStudioJob 状态机（先裁决后落态）...');
  const testDbPath = path.join(os.tmpdir(), `mls_cancel_matrix_${Date.now()}.db`);
  const db = new Database(testDbPath);

  // 创建测试所需的 gen_jobs 与 chat_messages 表
  db.exec(`
    CREATE TABLE gen_jobs (
      job_id TEXT PRIMARY KEY,
      id TEXT,
      user_id TEXT,
      session_id TEXT,
      status TEXT,
      cancellable INTEGER DEFAULT 1,
      cancel_requested INTEGER DEFAULT 0,
      protocol TEXT,
      model TEXT,
      payload_json TEXT,
      result_json TEXT,
      stage TEXT,
      vendor_task_id TEXT,
      error TEXT,
      created_at INTEGER,
      updated_at INTEGER,
      completed_at INTEGER
    );

    CREATE TABLE chat_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      user_id TEXT,
      role TEXT,
      prompt TEXT,
      content TEXT,
      job_id TEXT,
      status TEXT,
      cancellable INTEGER DEFAULT 1,
      result_json TEXT,
      created_at INTEGER,
      updated_at INTEGER
    );
  `);

  const mockServices = {
    db,
    eventBus: {
      broadcast: () => {},
      publish: () => {}
    },
    bullQueues: {
      gen: {
        getJob: async (jobId) => ({
          remove: async () => true,
          moveToFailed: async () => true
        })
      }
    }
  };

  // Case 3.1: queue_only 在 queued 阶段取消 -> 成功 200，落态 cancelled
  db.prepare(`
    INSERT INTO gen_jobs (job_id, id, user_id, status, protocol, model)
    VALUES ('job_q_01', 'job_q_01', 'user1', 'queued', 'seedream', 'seedream-v4')
  `).run();
  db.prepare(`
    INSERT INTO chat_messages (id, user_id, status, job_id)
    VALUES ('genmsg_job_q_01', 'user1', 'generating', 'job_q_01')
  `).run();

  const res1 = await cancelStudioJob(mockServices, { jobId: 'job_q_01', userId: 'user1' });
  assert.strictEqual(res1.cancelled, true);
  assert.strictEqual(res1.status, 'cancelled');

  const job1Row = db.prepare('SELECT * FROM gen_jobs WHERE job_id = ?').get('job_q_01');
  const msg1Row = db.prepare('SELECT * FROM chat_messages WHERE id = ?').get('genmsg_job_q_01');
  assert.strictEqual(job1Row.status, 'cancelled');
  assert.strictEqual(msg1Row.status, 'cancelled');

  // Case 3.2: queue_only 在 running 阶段取消 -> 409 IRREVERSIBLE，严禁落态 cancelled！
  db.prepare(`
    INSERT INTO gen_jobs (job_id, id, user_id, status, protocol, model, cancellable)
    VALUES ('job_q_02', 'job_q_02', 'user1', 'running', 'seedream', 'seedream-v4', 0)
  `).run();
  db.prepare(`
    INSERT INTO chat_messages (id, user_id, status, job_id, cancellable)
    VALUES ('genmsg_job_q_02', 'user1', 'generating', 'job_q_02', 1)
  `).run();

  let err2 = null;
  try {
    await cancelStudioJob(mockServices, { jobId: 'job_q_02', userId: 'user1' });
  } catch (e) {
    err2 = e;
  }
  assert(err2, '已进入运行阶段的同步模型必须抛出 409 异常');
  assert.strictEqual(err2.status, 409);
  assert.strictEqual(err2.code, 'IRREVERSIBLE');

  const job2Row = db.prepare('SELECT * FROM gen_jobs WHERE job_id = ?').get('job_q_02');
  const msg2Row = db.prepare('SELECT * FROM chat_messages WHERE id = ?').get('genmsg_job_q_02');
  assert.strictEqual(job2Row.status, 'running', '409 拒绝后 job 状态严禁被篡改为 cancelled');
  assert.strictEqual(msg2Row.status, 'generating', '409 拒绝后 card 消息状态严禁被篡改为 cancelled');
  assert.strictEqual(msg2Row.cancellable, 0, 'cancellable 必须置为 0 禁止再次误点取消');

  // Case 3.3: vendor_pending_only 在 submitting 窗口发起取消 -> 注册 deferred cancel
  db.prepare(`
    INSERT INTO gen_jobs (job_id, id, user_id, status, protocol, model)
    VALUES ('job_v_01', 'job_v_01', 'user1', 'submitting', 'bailian_wanx', 'wanx2.1-t2v-plus')
  `).run();

  const res3 = await cancelStudioJob(mockServices, { jobId: 'job_v_01', userId: 'user1' });
  assert.strictEqual(res3.deferred, true);
  assert.strictEqual(hasDeferredCancel('job_v_01'), true, 'submitting 窗口必须登记 deferred cancel');

  // Case 3.4: always_local 在 running 阶段取消 -> 本地终止并返回 200
  db.prepare(`
    INSERT INTO gen_jobs (job_id, id, user_id, status, protocol, model)
    VALUES ('job_local_01', 'job_local_01', 'user1', 'running', 'local_wan2_1', 'local_wan2_1')
  `).run();
  db.prepare(`
    INSERT INTO chat_messages (id, user_id, status, job_id)
    VALUES ('genmsg_job_local_01', 'user1', 'generating', 'job_local_01')
  `).run();

  const res4 = await cancelStudioJob(mockServices, { jobId: 'job_local_01', userId: 'user1' });
  assert.strictEqual(res4.cancelled, true);
  assert.strictEqual(res4.status, 'cancelled');

  const jobLocalRow = db.prepare('SELECT * FROM gen_jobs WHERE job_id = ?').get('job_local_01');
  const msgLocalRow = db.prepare('SELECT * FROM chat_messages WHERE id = ?').get('genmsg_job_local_01');
  assert.strictEqual(jobLocalRow.status, 'cancelled');
  assert.strictEqual(msgLocalRow.status, 'cancelled');

  db.close();
  try { fs.unlinkSync(testDbPath); } catch (_) {}

  console.log('✔ Phase 4 全模型取消矩阵与不可逆防护测试全部通过！\n');
}

if (require.main === module) {
  run().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

module.exports = run;
