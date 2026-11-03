const path = require('path');
const os = require('os');
const { openDb } = require('../src/db');
const dataDir = process.env.ML_DATA_DIR || path.join(os.homedir(), '.dsh-material-library');
const db = openDb(dataDir);
const run = db.prepare(
  "SELECT id, status, asset_count, success_count, failed_count, error FROM runs WHERE trigger='style_retag_smoke' ORDER BY created_at DESC LIMIT 1"
).get();
const nr = db.prepare(
  "SELECT status, COUNT(*) c FROM node_runs WHERE run_id LIKE 'smoke_style_%' GROUP BY status"
).all();
const tags = db.prepare(`
  SELECT at.asset_fid, t.dimension, t.dir, t.label, at.source, at.confidence
  FROM asset_tags at
  JOIN tag_dict t ON t.id = at.tag_id
  WHERE at.asset_fid IN (
    SELECT asset_fid FROM node_runs WHERE run_id LIKE 'smoke_style_%'
  ) AND t.dimension IN ('style_atom','wood_style')
  ORDER BY at.asset_fid, t.dimension
`).all();
console.log(JSON.stringify({ run, nodeRunStatus: nr, tags }, null, 2));
db.close();
