const path = require('path');
const os = require('os');
const { openDb } = require('../src/db');
const dataDir = process.env.ML_DATA_DIR || path.join(os.homedir(), '.dsh-material-library');
const db = openDb(dataDir);
const fids = [
  '~1T2NL7dp5vbkD77c2PyA0k9pTbl5Bm5WXrriI3mhM-TBFnvRu7Jap6NphifdXGkgbAo7fTw19fk6rD1D_8fucDU',
  '~1SBbJPAuWazAKnY3c_z5XTSjajA1jkt8RGPjIENCV6pgm0iGLKW_S3SHSmgHfmGq-wHlwhqClOWVPda0z3Bdfxg',
  '~1O8cTUYob6LcFbtbF0w5P_qPGhWbqqsHsUywUArmT1DaH_AgSjCSFvwCed0QrrSko0rkDoWDeuIwghoyde0u6Wc'
];
const tags = db.prepare(`
  SELECT at.asset_fid, t.dimension, t.dir, t.label, at.source, at.confidence
  FROM asset_tags at JOIN tag_dict t ON t.id=at.tag_id
  WHERE at.asset_fid IN (?,?,?) AND t.dimension IN ('style_atom','wood_style')
`).all(...fids);
const nr = db.prepare(`
  SELECT run_id, status, error, COUNT(*) c FROM node_runs
  WHERE asset_fid IN (?,?,?) AND node_type='tag'
  GROUP BY run_id, status, error
`).all(...fids);
console.log(JSON.stringify({ tags, nodeRuns: nr }, null, 2));
db.close();
