/**
 * 紧急撤销全库重评入队，只保留冒烟小任务。
 * 用法: node scripts/cancel-full-retag-queue.js
 */
const path = require('path');
const os = require('os');
const { openDb } = require('../src/db');

const dataDir = process.env.ML_DATA_DIR || path.join(os.homedir(), '.dsh-material-library');
const db = openDb(dataDir);

const runs = db.prepare(`
  SELECT id, asset_count FROM runs
  WHERE trigger='dict_retag' AND status IN ('queued','running')
`).all();
console.log('[cancel] 候选 runs', runs);

const smokeFidsSql = `
  SELECT asset_fid FROM node_runs WHERE run_id LIKE 'smoke_style_%'
  UNION
  SELECT asset_fid FROM node_runs WHERE run_id IN (
    SELECT run_id FROM retag_jobs WHERE reason='night_path_smoke'
  )
`;

const tx = db.transaction(() => {
  // 把非冒烟的 tag 入队标成 cancelled
  const r = db.prepare(`
    UPDATE node_runs SET status='cancelled', error='cancelled_before_full_retag', updated_at=?
    WHERE node_type='tag' AND status='queued'
      AND asset_fid NOT IN (${smokeFidsSql})
  `).run(Date.now());
  console.log('[cancel] cancelled node_runs', r.changes);

  const r2 = db.prepare(`
    UPDATE runs SET status='cancelled', error='cancelled_before_full_retag', finished_at=?
    WHERE trigger='dict_retag' AND status IN ('queued','running')
  `).run(Date.now());
  console.log('[cancel] cancelled runs', r2.changes);

  // 全库 night/now 任务改 cancelled，保留 smoke
  const r3 = db.prepare(`
    UPDATE retag_jobs SET status='cancelled', error='user_requested_smoke_only'
    WHERE reason='style_tree_v2_full_library' AND status IN ('queued','dispatched')
  `).run();
  console.log('[cancel] cancelled retag_jobs', r3.changes);
});
tx();

const left = db.prepare(`
  SELECT status, COUNT(*) c FROM node_runs WHERE node_type='tag' AND status='queued' GROUP BY status
`).all();
console.log(JSON.stringify({ ok: true, stillQueuedTag: left }, null, 2));
db.close();
