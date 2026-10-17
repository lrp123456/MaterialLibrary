/**
 * 三天 pHash 窗口 + 导出登记。不访问网络。
 * 运行：node test/export-window.js
 */
const Database = require('better-sqlite3');
const fp = require('../src/fingerprint');
const reg = require('../src/export-registry');

const db = new Database(':memory:');
db.exec(`
  CREATE TABLE assets (
    fid TEXT, sha256 TEXT, md5 TEXT, phash TEXT, created_at INTEGER, file_name TEXT, status TEXT
  );
  CREATE TABLE derivatives (
    id INTEGER PRIMARY KEY, asset_fid TEXT, kind TEXT, phash TEXT, sha256 TEXT, md5 TEXT, created_at INTEGER
  );
`);

const now = Date.now();
const day = 86400000;
const same = '0123456789abcdef';
const other = 'fedcba9876543210';
db.prepare('INSERT INTO assets (fid, phash, created_at, status) VALUES (?, ?, ?, ?)').run('new', same, now - day, 'ready');
db.prepare('INSERT INTO assets (fid, phash, created_at, status) VALUES (?, ?, ?, ?)').run('old', other, now - 10 * day, 'ready');
db.prepare('INSERT INTO derivatives (asset_fid, kind, phash, created_at) VALUES (?, ?, ?, ?)').run('dnew', 'restage_3_4', same, now - day);
db.prepare('INSERT INTO derivatives (asset_fid, kind, phash, created_at) VALUES (?, ?, ?, ?)').run('dold', 'restage_9_16', other, now - 10 * day);
db.prepare('INSERT INTO derivatives (asset_fid, kind, phash, created_at) VALUES (?, ?, ?, ?)').run('origin', 'origin', same, now - day);

function hit(phash) {
  return fp.findFingerprintHit(db, { phash });
}

const recent = hit(same);
if (!recent || recent.fid !== 'new') {
  console.error('FAIL recent asset', recent);
  process.exit(1);
}
const aged = hit(other);
if (aged) {
  console.error('FAIL old phash should miss', aged);
  process.exit(1);
}
db.prepare('DELETE FROM assets').run();
const deriv = hit(same);
if (!deriv || deriv.fid !== 'dnew' || deriv.kind !== 'restage_3_4') {
  console.error('FAIL 3:4 window', deriv);
  process.exit(1);
}
db.prepare("DELETE FROM derivatives WHERE kind = 'restage_3_4'").run();
const originOnly = hit(same);
if (originOnly) {
  console.error('FAIL origin derivative must stay out of the window', originOnly);
  process.exit(1);
}
db.prepare('INSERT INTO derivatives (asset_fid, kind, phash, created_at) VALUES (?, ?, ?, ?)').run('editnew', 'style_transferred', same, now - day);
const editHit = hit(same);
if (!editHit || editHit.kind !== 'style_transferred') {
  console.error('FAIL recent retouch phash', editHit);
  process.exit(1);
}
const oldSha = 'c'.repeat(64);
db.prepare('INSERT INTO derivatives (asset_fid, kind, phash, sha256, created_at) VALUES (?, ?, ?, ?, ?)').run('oldedit', 'style_transferred', 'aaaaaaaaaaaaaaaa', oldSha, now - 10 * day);
const bySha = fp.findFingerprintHit(db, { sha256: oldSha, phash: 'aaaaaaaaaaaaaaaa' });
if (!bySha || bySha.reason !== 'deriv_sha256' || bySha.fid !== 'oldedit') {
  console.error('FAIL old retouch must still match sha256', bySha);
  process.exit(1);
}

const row = reg.registerExport(db, { sha256: 'a'.repeat(64), sourceFid: 'src', kind: 'edit', marker: 'MLX1|{}' });
if (!row || reg.findExportBySha(db, 'a'.repeat(64)).source_fid !== 'src') {
  console.error('FAIL registry', row);
  process.exit(1);
}
console.log('OK export window');
