const Database = require('better-sqlite3');
const path = require('path');
const os = require('os');
const fs = require('fs');

const dbPath = process.argv[2] || '/home/lrp/.dsh-material-library/material.db';
console.log('Checking database:', dbPath);
if (!fs.existsSync(dbPath)) {
  console.log('File does NOT exist!');
  process.exit(1);
}
const db = new Database(dbPath, { readonly: true });
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(t => t.name);
console.log('Tables found:', tables.length);

for (const name of ['materials', 'chat_sessions', 'chat_messages', 'studio_sessions', 'generation_tasks', 'assets']) {
  if (tables.includes(name)) {
    const count = db.prepare(`SELECT count(*) as c FROM ${name}`).get().c;
    console.log(`- ${name}: ${count} records`);
  }
}
