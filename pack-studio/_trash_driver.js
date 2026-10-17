/**
 * _trash_driver.js · 在 node 侧用 node:sqlite 驱动真实的 assets-delete.js
 *
 * 为什么不用 better-sqlite3：那份 native 模块是按另一个 Node ABI 编译的
 * （ERR_DLOPEN_FAILED / "not a valid Win32 application"）。
 * node:sqlite 是内置模块，Node 22.5+ 可用，行为与 better-sqlite3 一致（同样的 prepare/all/get）。
 */
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const AD = require('C:\\Users\\lrp\\DevEcoStudioProjects\\MaterialLibraryServer\\src\\assets-delete.js');

const db = new DatabaseSync(':memory:');

// 关键：assets 表不含 tags_text —— 与生产一致
db.exec(`
  CREATE TABLE assets (
    fid TEXT PRIMARY KEY, file_name TEXT, size INTEGER, sha256 TEXT,
    client_asset_id TEXT, status TEXT, error_note TEXT, reject_reason TEXT,
    reject_detail TEXT, kind TEXT, origin_orientation TEXT,
    origin_width INTEGER, origin_height INTEGER, source TEXT, created_at INTEGER
  );
  CREATE TABLE asset_tags (asset_fid TEXT, tag_id INTEGER);
  CREATE TABLE tag_dict (id INTEGER PRIMARY KEY, label TEXT, dimension TEXT);
  CREATE TABLE derivatives (asset_fid TEXT, kind TEXT);
  CREATE TABLE asset_trash (
    id INTEGER PRIMARY KEY AUTOINCREMENT, fid TEXT, file_name TEXT, size INTEGER,
    trash_rel TEXT, deleted_at INTEGER, deleted_by TEXT, dispose_source TEXT, dispose_detail TEXT
  );
`);

const now = Date.now();
db.prepare(`INSERT INTO assets (fid,file_name,size,sha256,status,kind,origin_width,origin_height,source,created_at)
            VALUES (?,?,?,?,?,?,?,?,?,?)`)
  .run('fid_test_001', 'test.jpg', 1024, 'abc', 'active', 'image', 800, 600, 'local', now);
db.prepare('INSERT INTO tag_dict (id,label,dimension) VALUES (?,?,?)').run(1, '混搭', 'style');
db.prepare('INSERT INTO asset_tags (asset_fid,tag_id) VALUES (?,?)').run('fid_test_001', 1);
db.prepare('INSERT INTO derivatives (asset_fid,kind) VALUES (?,?)').run('fid_test_001', 'origin');
db.prepare(`INSERT INTO asset_trash (fid,file_name,size,trash_rel,deleted_at,deleted_by,dispose_source)
            VALUES (?,?,?,?,?,?,?)`)
  .run('fid_test_001', 'test.jpg', 1024, '', now, 'admin', 'user_delete');

const services = { db, config: { dataDir: __dirname } };

let pass = 0, fail = 0;
function check(name, fn) {
  try {
    const r = fn();
    console.log('  [PASS] ' + name + (r ? '  ' + r : ''));
    pass++;
  } catch (e) {
    console.log('  [FAIL] ' + name + '  -> ' + e.message);
    fail++;
  }
}

console.log('  assets 列: ' + db.prepare('PRAGMA table_info(assets)').all().map((c) => c.name).join(', '));
try {
  db.prepare('SELECT a.tags_text FROM assets a').all();
  console.log('  ? 旧 SQL 未报错');
} catch (e) {
  console.log('  [PASS] 旧 SQL 复现 bug: ' + e.message);
}

check('listTrash() 有数据且 tagsText 已聚合', () => {
  const r = AD.listTrash(services, { page: 1, pageSize: 10 });
  if (r.total < 1) throw new Error('total=' + r.total);
  const it = r.items[0];
  if (it.fid !== 'fid_test_001') throw new Error('fid=' + it.fid);
  return `total=${r.total} fid=${it.fid} label=${it.disposeLabel} tagsText='${it.tagsText}' remainingHours=${it.remainingHours}`;
});
check('tagsText 取自 asset_tags + tag_dict', () => {
  const v = AD.listTrash(services, { page: 1, pageSize: 10 }).items[0].tagsText;
  if (v !== '混搭') throw new Error(`期望 '混搭' 实际 '${v}'`);
  return "tagsText='混搭'";
});
check('getTrashDetail() 有数据', () => {
  const d = AD.getTrashDetail(services, 'fid_test_001');
  if (!d || d.fid !== 'fid_test_001') throw new Error('返回不对');
  return `fid=${d.fid} label=${d.disposeLabel} criterion='${String(d.disposeCriterion || '').slice(0, 30)}' tagsText='${d.tagsText}' restoreReady=${d.restoreReady}`;
});
check('不存在的 fid 抛 not_found', () => {
  try { AD.getTrashDetail(services, 'no_such'); }
  catch (e) { if (e.code !== 'not_found') throw new Error('code=' + e.code); return 'code=not_found'; }
  throw new Error('应抛错但没抛');
});
check('按来源过滤 source=user_delete', () => {
  const r = AD.listTrash(services, { page: 1, pageSize: 10, source: 'user_delete' });
  return '命中 ' + r.total;
});
check('不匹配来源返回空', () => {
  const r = AD.listTrash(services, { page: 1, pageSize: 10, source: 'gateway_reject' });
  if (r.total !== 0) throw new Error('total=' + r.total);
  return 'source=gateway_reject 命中 0';
});
check('标签表缺失时不崩（老库兼容）', () => {
  // 只缺 asset_tags / tag_dict，其余 assets 列保持与生产一致
  const db2 = new DatabaseSync(':memory:');
  db2.exec(`CREATE TABLE assets (fid TEXT PRIMARY KEY, file_name TEXT, size INTEGER, sha256 TEXT,
              client_asset_id TEXT, status TEXT, error_note TEXT, reject_reason TEXT, reject_detail TEXT,
              kind TEXT, origin_orientation TEXT, origin_width INTEGER, origin_height INTEGER,
              source TEXT, created_at INTEGER);
            CREATE TABLE derivatives (asset_fid TEXT, kind TEXT);`);
  const s2 = { db: db2, config: { dataDir: __dirname } };
  const r = AD.listTrash(s2, { page: 1, pageSize: 10 });
  if (r.total !== 0) throw new Error('total=' + r.total);
  return 'total=0（无 asset_tags/tag_dict 也不抛错）';
});

console.log(`\n  结果: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
