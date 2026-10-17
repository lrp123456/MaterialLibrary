const Database = require('better-sqlite3');
const db = new Database('/home/lrp/.dsh-material-library/material.db');
const r = db.prepare("DELETE FROM node_runs WHERE node_type='process' AND status='failed'").run();
console.log('cleared failed process jobs', r.changes);
db.close();
