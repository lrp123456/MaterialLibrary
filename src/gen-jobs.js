/**
 * gen_jobs 队列的数据访问层（独立于 ai_tasks，后者 worker 单 busy + LIMIT 1 串行）。
 * 只负责入队 / 查询，执行由 src/gen-jobs-worker.js 负责。
 */
'use strict';

const crypto = require('crypto');

function idempotencyKeyFor(payload) {
  const p = payload || {};
  const refs = p.imageUrls || p.image || p.refs || [];
  const raw = [
    p.userId == null ? '' : p.userId,
    p.sessionId || '',
    p.prompt || '',
    p.model || '',
    typeof (p.params || p.extras || {}) === 'object' ? JSON.stringify(p.params || p.extras || {}) : String(p.params || p.extras || ''),
    JSON.stringify(refs),
    p.clientRequestId || '',
  ].map((x) => String(x == null ? '' : x)).join('|');
  return crypto.createHash('sha256').update(raw).digest('hex');
}

/**
 * 入队；相同幂等键直接返回已有 jobId（INSERT ... ON CONFLICT DO NOTHING）。
 * @returns {{jobId:string, status:string, created:boolean}}
 */
function enqueueGenJob(db, payload) {
  const p = payload || {};
  const key = idempotencyKeyFor(p);
  const jobId = 'gj_' + Date.now().toString(36) + '_' + crypto.randomBytes(5).toString('hex');
  const now = Date.now();
  const modality = String(p.modality || 'image');
  const model = String(p.model || '');
  const userId = p.userId == null ? 0 : Number(p.userId);
  const sessionId = String(p.sessionId || '');
  const payloadJson = JSON.stringify(p);

  const r = db.prepare(`
    INSERT INTO gen_jobs (
      job_id, user_id, session_id, modality, model, payload_json,
      status, progress, result_json, error_json, attempt, idempotency_key,
      created_at, updated_at, started_at, completed_at
    ) VALUES (?, ?, ?, ?, ?, ?, 'queued', 0, NULL, NULL, 0, ?, ?, ?, NULL, NULL)
    ON CONFLICT(idempotency_key) DO NOTHING
  `).run(jobId, userId, sessionId, modality, model, payloadJson, key, now, now);

  if (r.changes === 1) return { jobId, status: 'queued', created: true };
  const existing = db.prepare('SELECT job_id, status FROM gen_jobs WHERE idempotency_key=?').get(key);
  return {
    jobId: existing ? existing.job_id : jobId,
    status: existing ? existing.status : 'queued',
    created: false,
  };
}

function getGenJob(db, jobId) {
  return db.prepare('SELECT * FROM gen_jobs WHERE job_id=?').get(String(jobId || '')) || null;
}

function listGenJobs(db, { sessionId, userId } = {}) {
  const uid = userId == null ? null : Number(userId);
  if (sessionId) {
    if (uid != null) {
      return db.prepare('SELECT * FROM gen_jobs WHERE session_id=? AND user_id=? ORDER BY created_at DESC LIMIT 100')
        .all(String(sessionId), uid);
    }
    return db.prepare('SELECT * FROM gen_jobs WHERE session_id=? ORDER BY created_at DESC LIMIT 100')
      .all(String(sessionId));
  }
  if (uid != null) {
    return db.prepare('SELECT * FROM gen_jobs WHERE user_id=? ORDER BY created_at DESC LIMIT 100')
      .all(uid);
  }
  return db.prepare('SELECT * FROM gen_jobs ORDER BY created_at DESC LIMIT 100').all();
}

function cancelGenJob(db, jobId, userId) {
  const row = getGenJob(db, jobId);
  if (!row) {
    const err = new Error('任务不存在');
    err.status = 404;
    throw err;
  }
  if (userId != null && Number(row.user_id) !== Number(userId)) {
    const err = new Error('无权取消该任务');
    err.status = 403;
    throw err;
  }
  if (['succeeded', 'failed', 'cancelled'].includes(row.status)) {
    return { success: false, status: row.status, message: '任务已结束，无法取消' };
  }
  const now = Date.now();
  db.prepare("UPDATE gen_jobs SET status='cancelled', updated_at=?, completed_at=? WHERE job_id=?")
    .run(now, now, jobId);
  return { success: true, status: 'cancelled', job: { ...row, status: 'cancelled' } };
}

module.exports = {
  idempotencyKeyFor,
  enqueueGenJob,
  getGenJob,
  listGenJobs,
  cancelGenJob,
};
