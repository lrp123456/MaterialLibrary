const Database = require('better-sqlite3');
const db = new Database('/home/lrp/.dsh-material-library/material.db', { readonly: true });
console.log('process jobs:', db.prepare("SELECT id,status,progress,derivative_id,error FROM node_runs WHERE node_type='process' ORDER BY id DESC LIMIT 5").all());
console.log('videos:', db.prepare("SELECT status, COUNT(*) c FROM assets WHERE kind='video' GROUP BY status").all());
console.log('presets:', db.prepare('SELECT COUNT(*) c FROM presets').get());
console.log('gateway:', db.prepare("SELECT id,base_url,protocol,enabled FROM gen_adapters WHERE id='unified_gateway'").get());
