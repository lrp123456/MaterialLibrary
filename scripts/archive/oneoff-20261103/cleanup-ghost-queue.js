const path = require('path');
const os = require('os');
const { openDb } = require('../src/db');

const dataDir = process.env.ML_DATA_DIR || path.join(os.homedir(), '.dsh-material-library');
const db = openDb(dataDir);

console.log('[cleanup] 开始清理孤儿/僵尸任务...');

const tx = db.transaction(() => {
  // 1. 取消属于已删除或已排除资产的待处理任务
  const rNodeRuns = db.prepare(`
    UPDATE node_runs
    SET status = 'cancelled', error = 'asset_deleted_or_excluded', updated_at = ?
    WHERE status IN ('queued', 'running')
      AND asset_fid IN (
        SELECT fid FROM assets WHERE status IN ('deleted', 'excluded', 'rejected')
      )
  `).run(Date.now());
  console.log(`[cleanup] 取消失效资产的 node_runs: ${rNodeRuns.changes} 条`);

  // 2. 取消旧的膨胀全库重评任务 (16230条的无意义任务)
  const rRetagJobs = db.prepare(`
    UPDATE retag_jobs
    SET status = 'cancelled', error = 'cancelled_due_to_unfiltered_deleted_assets'
    WHERE status IN ('queued', 'dispatched')
      AND queued_count > 10000
  `).run();
  console.log(`[cleanup] 取消膨胀的 retag_jobs: ${rRetagJobs.changes} 条`);

  // 3. 取消对应的 runs
  const rRuns = db.prepare(`
    UPDATE runs
    SET status = 'cancelled', error = 'cancelled_due_to_unfiltered_deleted_assets', finished_at = ?
    WHERE trigger = 'dict_retag' AND status IN ('queued', 'running') AND asset_count > 10000
  `).run(Date.now());
  console.log(`[cleanup] 取消膨胀的 runs: ${rRuns.changes} 条`);
});

tx();

// 汇总当前剩余队列
const queuedNodeRuns = db.prepare(`
  SELECT nr.node_type, a.status AS asset_status, COUNT(*) AS count
  FROM node_runs nr
  JOIN assets a ON nr.asset_fid = a.fid
  WHERE nr.status = 'queued'
  GROUP BY nr.node_type, a.status
`).all();

const activeJobs = db.prepare(`
  SELECT id, status, schedule, reason, queued_count, error
  FROM retag_jobs
  WHERE status IN ('queued', 'dispatched')
`).all();

console.log('[cleanup] 当前真实队列中的有效任务:');
console.log(JSON.stringify({ queuedNodeRuns, activeJobs }, null, 2));

db.close();
