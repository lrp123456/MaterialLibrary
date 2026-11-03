const path = require('path');
const os = require('os');
const { openDb } = require('../src/db');
const dataDir = process.env.ML_DATA_DIR || path.join(os.homedir(), '.dsh-material-library');
const db = openDb(dataDir);
const jobs = db.prepare(
  "SELECT id, schedule, status, estimated, queued_count, reason, options FROM retag_jobs ORDER BY id DESC LIMIT 5"
).all();
console.log(JSON.stringify(jobs, null, 2));
db.close();
