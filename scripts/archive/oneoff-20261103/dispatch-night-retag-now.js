/**
 * 立即派发夜间 retag（2:00 已过、或定时器失败后的补跑）。
 * 用法:
 *   node scripts/dispatch-night-retag-now.js --smoke   # 只派发 reason 含 smoke 的
 *   node scripts/dispatch-night-retag-now.js --all     # 派发全部 queued 夜间任务（含全库）
 *   node scripts/dispatch-night-retag-now.js           # 默认只派发 smoke，全库需 --all
 */
const path = require('path');
const os = require('os');
const { openDb } = require('../src/db');
const tagGov = require('../src/tag-governance');

const args = process.argv.slice(2);
const wantAll = args.includes('--all');
const wantSmoke = args.includes('--smoke') || !wantAll;

const dataDir = process.env.ML_DATA_DIR || path.join(os.homedir(), '.dsh-material-library');
const db = openDb(dataDir);
tagGov.ensureGovernanceSchema(db);

const jobs = db.prepare(`
  SELECT * FROM retag_jobs WHERE schedule='night' AND status='queued' ORDER BY id ASC
`).all();
const filtered = jobs.filter((j) => {
  const isSmoke = /smoke/i.test(j.reason || '');
  if (wantAll) return true;
  return isSmoke;
});
if (!filtered.length) {
  console.log('[dispatch] 无符合条件的待派发夜间任务', {
    totalQueued: jobs.length,
    wantAll,
    hint: wantAll ? '' : '全库任务请显式加 --all'
  });
  db.close();
  process.exit(0);
}

// 只 claim 列表内的 job：先把不符合的临时标 skipped_for_now
const keep = new Set(filtered.map(j => j.id));
for (const j of jobs) {
  if (!keep.has(j.id)) {
    db.prepare("UPDATE retag_jobs SET status='hold', error='held_by_dispatch_script' WHERE id=? AND status='queued'").run(j.id);
  }
}

const claimed = tagGov.claimNightRetagJobs(db, { kick() { console.log('[dispatch] interpreter.kick()'); } });

// 恢复 hold
db.prepare("UPDATE retag_jobs SET status='queued', error=NULL WHERE status='hold' AND error='held_by_dispatch_script'").run();

console.log(JSON.stringify({ ok: true, wantAll, claimed }, null, 2));
db.close();
