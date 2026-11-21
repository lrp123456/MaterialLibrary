const fs = require('fs');
const path = require('path');

const dbPath = 'C:\\Users\\lrp\\.dsh-material-library\\material.db';
require('./shims/better-sqlite3-win.js');
const Database = require('better-sqlite3');
const db = new Database(dbPath, { readonly: true });

console.log('=== 最近 10 条 chat_messages ===');
try {
  const msgs = db.prepare('SELECT id, session_id, role, substr(content, 1, 100) as content_cut, metadata, created_at FROM chat_messages ORDER BY created_at DESC LIMIT 10').all();
  console.table(msgs);
} catch (e) {
  console.log('chat_messages err:', e.message);
}

console.log('\n=== 最近 5 个 chat_sessions ===');
try {
  const sessions = db.prepare('SELECT * FROM chat_sessions ORDER BY updated_at DESC LIMIT 5').all();
  console.table(sessions);
} catch (e) {
  console.log('chat_sessions err:', e.message);
}

console.log('\n=== 最近 10 个 gen_jobs ===');
try {
  const jobs = db.prepare('SELECT id, status, model, substr(prompt, 1, 80) as prompt_cut, created_at FROM gen_jobs ORDER BY created_at DESC LIMIT 10').all();
  console.table(jobs);
} catch (e) {
  console.log('gen_jobs err:', e.message);
}

console.log('\n=== 最近 10 个 assets ===');
try {
  const assets = db.prepare('SELECT fid, kind, title, created_at, source_type, source_note FROM assets ORDER BY created_at DESC LIMIT 10').all();
  console.table(assets);
} catch (e) {
  console.log('assets err:', e.message);
}
