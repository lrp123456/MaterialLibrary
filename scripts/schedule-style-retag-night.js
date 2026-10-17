/**
 * 登记「今晚 2:00 全库风格重评」夜间任务。
 * 维度：style_atom（多选）+ wood_style（组内单选可空）。
 *
 * 用法:
 *   node scripts/schedule-style-retag-night.js
 *   node scripts/schedule-style-retag-night.js --hour 2 --minute 0
 *   node scripts/schedule-style-retag-night.js --now   # 立即入队（调试）
 */
const path = require('path');
const os = require('os');
const { openDb } = require('../src/db');
const tagGov = require('../src/tag-governance');
const { setRuntimeConfig, getRuntimeConfig } = require('../src/runtime-config');

const args = process.argv.slice(2);
const flag = (name) => args.includes(`--${name}`);
const num = (name, dft) => {
  const i = args.indexOf(`--${name}`);
  if (i >= 0 && args[i + 1] != null && Number.isFinite(Number(args[i + 1]))) return Number(args[i + 1]);
  return dft;
};

const hour = num('hour', 2);
const minute = num('minute', 0);
const runNow = flag('now');

const dataDir = process.env.ML_DATA_DIR || path.join(os.homedir(), '.dsh-material-library');
const db = openDb(dataDir);
tagGov.ensureGovernanceSchema(db);

// 夜间时刻写入 runtime_config（服务端定时器会热读）
setRuntimeConfig(db, { retag_night_hour: hour, retag_night_minute: minute });
const cfg = getRuntimeConfig(db);
console.log('[schedule] 夜间时刻已设为', `${cfg.retag_night_hour}:${String(cfg.retag_night_minute).padStart(2, '0')}`);

// 已有同日未派发的全库风格任务则不重复登记
const existing = db.prepare(`
  SELECT id, status, schedule, created_at FROM retag_jobs
  WHERE schedule='night' AND status='queued'
    AND dimensions LIKE '%style_atom%'
`).all();
if (existing.length && !runNow) {
  console.log('[schedule] 已存在待派发夜间风格任务，跳过重复登记:', existing);
  db.close();
  process.exit(0);
}

const dims = ['style_atom', 'wood_style'];
const r = tagGov.enqueueDimensionRetag(db, {
  dimensions: dims,
  schedule: runNow ? 'now' : 'night',
  all: true,
  actor: 'schedule-style-retag',
  reason: 'style_tree_v2_full_library',
  interpreter: runNow ? { kick() {} } : undefined
});

console.log(JSON.stringify({
  ok: true,
  schedule: runNow ? 'now' : 'night',
  fireAt: runNow ? 'immediate' : `next ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')} (若今日该时刻已过，则明日生效)`,
  ...r,
  note: 'style_atom=多选, wood_style=组内单选可空；需 MaterialLibraryServer 在跑才能消化队列'
}, null, 2));

db.close();
