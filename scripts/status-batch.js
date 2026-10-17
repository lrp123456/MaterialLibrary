const { openDb } = require('../src/db');
const os = require('os');
const path = require('path');
const db = openDb(path.join(os.homedir(), '.dsh-material-library'));
console.log('tag_status', db.prepare("SELECT status, COUNT(*) c FROM node_runs WHERE node_type='tag' GROUP BY status").all());
console.log('colors_basic', db.prepare("SELECT COUNT(*) c FROM asset_colors WHERE basic_color IS NOT NULL AND basic_color!=''").get());
console.log('runs_tail', db.prepare("SELECT id, trigger, status, asset_count FROM runs ORDER BY id DESC LIMIT 3").all());
db.close();
