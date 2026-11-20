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
  ].map((x) => String(x == null ? '' : x)).join('|');
  return crypto.createHash('sha256').update(raw).digest('hex');
}

/**
 * 入队；相同幂等键直接返回已有 jobId（INSERT ... ON CONFLICT DO NOTHING）。
 * @returns {{jobId:string, status:string, created:boolean}}
 */
function insertQueued(db, payload, key) {
  const p = payload || {};
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
  return { jobId, changes: r.changes };
}

function enqueueGenJob(db, payload) {
  const p = payload || {};
  const key = idempotencyKeyFor(p);
  const modality = String(p.modality || 'image');
  const sessionId = String(p.sessionId || '');

  const run = db.transaction(() => {
    // 同一会话已有排队或运行中的视频时，不再开第二条云端任务。
    if (modality === 'video' && sessionId) {
      const inflight = db.prepare(`
        SELECT job_id, status FROM gen_jobs
        WHERE session_id=? AND modality='video' AND status IN ('queued','running')
        ORDER BY created_at DESC LIMIT 1
      `).get(sessionId);
      if (inflight) {
        return { jobId: inflight.job_id, status: inflight.status, created: false, locked: true };
      }
    }

    const first = insertQueued(db, p, key);
    if (first.changes === 1) return { jobId: first.jobId, status: 'queued', created: true };

    const existing = db.prepare('SELECT job_id, status FROM gen_jobs WHERE idempotency_key=?').get(key);
    if (!existing) return { jobId: first.jobId, status: 'queued', created: false };
    if (existing.status === 'queued' || existing.status === 'running') {
      return { jobId: existing.job_id, status: existing.status, created: false };
    }

    // 已结束的同键让出，重新生成才能再入队。
    db.prepare('UPDATE gen_jobs SET idempotency_key=? WHERE job_id=? AND idempotency_key=?')
      .run(`${key}:done:${existing.job_id}`, existing.job_id, key);
    const second = insertQueued(db, p, key);
    if (second.changes === 1) return { jobId: second.jobId, status: 'queued', created: true };
    const again = db.prepare('SELECT job_id, status FROM gen_jobs WHERE idempotency_key=?').get(key);
    return {
      jobId: again ? again.job_id : second.jobId,
      status: again ? again.status : 'queued',
      created: false,
    };
  });
  return run();
}

/**
 * 超时仍在 running 的任务：已有上游任务号的视频只重新排队并继续轮询，不增加尝试次数。
 * 没有任务号的按原逻辑耗一次重试，超过上限标失败。
 */
function recoverStaleGenJobs(db, { now = Date.now(), staleMs = 15 * 60 * 1000, maxAttempts = 3 } = {}) {
  let rows = [];
  try {
    rows = db.prepare(`
      SELECT job_id, attempt, modality, payload_json
      FROM gen_jobs
      WHERE status='running' AND started_at < ?
    `).all(now - staleMs);
  } catch (_) {
    return { scanned: 0, resumed: 0, requeued: 0, failed: 0 };
  }
  let resumed = 0;
  let requeued = 0;
  let failed = 0;
  for (const r of rows) {
    let payload = {};
    try { payload = JSON.parse(r.payload_json || '{}'); } catch (_) {}
    const hasVendor = String(r.modality || '') === 'video' && String(payload.vendorTaskId || '').trim();
    try {
      if (hasVendor) {
        const changed = db.prepare(`
          UPDATE gen_jobs SET status='queued', started_at=NULL, updated_at=?
          WHERE job_id=? AND status='running'
        `).run(now, r.job_id);
        if (changed.changes === 1) resumed++;
        continue;
      }
      const nextAttempt = Number(r.attempt || 0) + 1;
      if (nextAttempt > maxAttempts) {
        const changed = db.prepare(`
          UPDATE gen_jobs SET status='failed', error_json=?, updated_at=?, completed_at=?
          WHERE job_id=? AND status='running'
        `).run(JSON.stringify({ message: '任务超时重试次数过多' }), now, now, r.job_id);
        if (changed.changes === 1) failed++;
      } else {
        const changed = db.prepare(`
          UPDATE gen_jobs SET status='queued', attempt=?, started_at=NULL, updated_at=?
          WHERE job_id=? AND status='running'
        `).run(nextAttempt, now, r.job_id);
        if (changed.changes === 1) requeued++;
      }
    } catch (e) {
      console.warn('[gen-jobs] 僵尸回收失败:', e.message);
    }
  }
  return { scanned: rows.length, resumed, requeued, failed };
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
  const upd = db.prepare("UPDATE gen_jobs SET status='cancelled', updated_at=?, completed_at=? WHERE job_id=? AND status IN ('queued','running')")
    .run(now, now, jobId);
  if (upd.changes === 0) {
    const latest = getGenJob(db, jobId);
    return { success: false, status: latest ? latest.status : row.status, message: '任务已结束，无法取消' };
  }
  return { success: true, status: 'cancelled', job: { ...row, status: 'cancelled' } };
}

module.exports = {
  idempotencyKeyFor,
  enqueueGenJob,
  recoverStaleGenJobs,
  getGenJob,
  listGenJobs,
  cancelGenJob,
};
