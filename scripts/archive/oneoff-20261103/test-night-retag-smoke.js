/**
 * 夜间任务链路冒烟：登记 3 张旧图的 night job → claimNightRetagJobs 派发 → 检查 node_runs。
 * 不跑全库。用法: node scripts/test-night-retag-smoke.js
 */
const path = require('path');
const os = require('os');
const { openDb } = require('../src/db');
const tagGov = require('../src/tag-governance');

const dataDir = process.env.ML_DATA_DIR || path.join(os.homedir(), '.dsh-material-library');
const db = openDb(dataDir);
tagGov.ensureGovernanceSchema(db);

const rows = db.prepare(`
  SELECT a.fid, a.file_name FROM assets a
  WHERE a.kind='image'
    AND a.status IN ('ready','ready_with_flags','tagging_done','gating_passed','qc')
  ORDER BY COALESCE(a.discovered_at, a.created_at, 0) ASC
  LIMIT 3
`).all();
if (!rows.length) {
  console.error('[night-smoke] 无候选');
  process.exit(1);
}
const fids = rows.map(r => r.fid);
console.log('[night-smoke] 候选', rows.map(r => r.file_name));

// 1) 登记 night job（指定 fid，非全库）
const reg = tagGov.enqueueDimensionRetag(db, {
  dimensions: ['style_atom', 'wood_style'],
  schedule: 'night',
  all: false,
  fids,
  actor: 'night-smoke',
  reason: 'night_path_smoke'
});
console.log('[night-smoke] 已登记 night job', reg.runId, 'estimated=', reg.estimated);

// 2) 模拟定时器 claim（dispatch 脚本同一入口）
const claimed = tagGov.claimNightRetagJobs(db, { kick() { console.log('[night-smoke] kick'); } });
console.log('[night-smoke] claim 结果', JSON.stringify(claimed, null, 2));

// 3) 检查是否入队
const nr = db.prepare(`
  SELECT run_id, status, COUNT(*) c FROM node_runs
  WHERE asset_fid IN (${fids.map(() => '?').join(',')})
    AND node_type='tag'
  GROUP BY run_id, status
`).all(...fids);
const jobs = db.prepare(`
  SELECT id, status, schedule, reason, queued_count, options FROM retag_jobs
  WHERE reason IN ('night_path_smoke','style_tree_v2_full_library')
  ORDER BY id DESC LIMIT 5
`).all();
console.log(JSON.stringify({ ok: true, nodeRuns: nr, jobs }, null, 2));
db.close();
