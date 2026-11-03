const path = require('path');
const os = require('os');
const { openDb } = require('../src/db');
const dataDir = process.env.ML_DATA_DIR || path.join(os.homedir(), '.dsh-material-library');
const db = openDb(dataDir);
const q = db.prepare(`
  SELECT nr.run_id, nr.asset_fid, nr.status, nr.error
  FROM node_runs nr
  WHERE nr.node_type='tag' AND nr.status='queued'
`).all();
const jobs = db.prepare(`
  SELECT id, status, schedule, reason, queued_count, error FROM retag_jobs ORDER BY id DESC LIMIT 8
`).all();
const runs = db.prepare(`
  SELECT id, trigger, status, asset_count, error FROM runs ORDER BY created_at DESC LIMIT 5
`).all();
console.log(JSON.stringify({ queuedTag: q, jobs, runs }, null, 2));
db.close();
