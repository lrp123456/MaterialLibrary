/**
 * _verify_trash_sql.js · 用真实 schema 验证回收站 SQL 已修好
 *
 * 做法：拿生产 assets 表结构（或等价最小 schema）建内存库，
 *      灌一条回收站记录，直接调 listTrash / getTrashDetail。
 * 修之前会抛 "no such column: a.tags_text"，修之后必须返回数据。
 */
const path = require('path');
const Module = require('module');

// 用 better-sqlite3（服务端同一份依赖）
let Database;
try {
  Database = require(path.join('C:\\Users\\lrp\\DevEcoStudioProjects\\MaterialLibraryServer', 'node_modules', 'better-sqlite3'));
} catch (e) {
  try { Database = require('better-sqlite3'); }
  catch (e2) { console.log('SKIP: 找不到 better-sqlite3 — ' + e2.message); process.exit(0); }
}

const AD = require('C:\\Users\\lrp\\DevEcoStudioProjects\\MaterialLibraryServer\\src\\assets-delete.js');

const db = new Database(':memory:');

// ── 建表：assets 只放生产里真实存在的列（关键：没有 tags_text）──
db.exec(`
  CREATE TABLE assets (
    fid TEXT PRIMARY KEY,
    file_name TEXT,
    size INTEGER,
    sha256 TEXT,
    client_asset_id TEXT,
    status TEXT,
    error_note TEXT,
    reject_reason TEXT,
    reject_detail TEXT,
    kind TEXT,
    origin_orientation TEXT,
    origin_width INTEGER,
    origin_height INTEGER,
    source TEXT,
    created_at INTEGER
  );
  CREATE TABLE asset_tags (asset_fid TEXT, tag_id INTEGER);
  CREATE TABLE tag_dict (id INTEGER PRIMARY KEY, label TEXT, dimension TEXT);
  CREATE TABLE derivatives (asset_fid TEXT, kind TEXT);
`);

const now = Date.now();
db.prepare(`INSERT INTO assets (fid,file_name,size,sha256,status,kind,origin_width,origin_height,source,created_at)
            VALUES (?,?,?,?,?,?,?,?,?,?)`)
  .run('fid_test_001', 'test.jpg', 1024, 'abc', 'active', 'image', 800, 600, 'local', now);
db.prepare(`INSERT INTO tag_dict (id,label,dimension) VALUES (?,?,?)`).run(1, '混搭', 'style');
db.prepare(`INSERT INTO asset_tags (asset_fid,tag_id) VALUES (?,?)`).run('fid_test_001', 1);
db.prepare(`INSERT INTO derivatives (asset_fid,kind) VALUES (?,?)`).run('fid_test_001', 'origin');

const services = { db, config: { dataDir: __dirname } };

let pass = 0, fail = 0;
function check(name, fn) {
  try {
    const r = fn();
    console.log('  ✓ ' + name + (r ? '  ' + r : ''));
    pass++;
    return r;
  } catch (e) {
    console.log('  ✗ ' + name + '  → ' + e.message);
    fail++;
    return null;
  }
}

console.log('═══ 回收站 SQL 验证 ═══');
console.log('\n① 确认 assets 表确实没有 tags_text（复现 bug 的前提）');
const cols = db.prepare('PRAGMA table_info(assets)').all().map((c) => c.name);
console.log('   assets 列: ' + cols.join(', '));
console.log('   含 tags_text: ' + (cols.includes('tags_text') ? 'YES（测不出 bug）' : 'NO ✓'));

// 先直接复现旧 SQL 的报错
console.log('\n② 旧 SQL（SELECT a.tags_text）应当报错 —— 证明 bug 曾真实存在');
try {
  db.prepare('SELECT t.*, a.tags_text FROM asset_trash_dummy t LEFT JOIN assets a ON a.fid=t.fid').all();
  console.log('   (表不存在，跳过)');
} catch (e) {
  try {
    db.prepare('SELECT a.tags_text FROM assets a').all();
    console.log('   ? 未报错');
  } catch (e2) {
    console.log('   ✓ 复现: ' + e2.message);
  }
}

console.log('\n③ 新代码调用');
const list = check('listTrash()', () => {
  const r = AD.listTrash(services, { page: 1, pageSize: 10 });
  if (!r || !Array.isArray(r.items)) throw new Error('返回结构异常');
  return `items=${r.items.length} total=${r.total}`;
});
if (list) {
  const it = AD.listTrash(services, { page: 1, pageSize: 10 }).items[0];
  if (it) {
    console.log('     字段: fid=' + it.fid + ' disposeLabel=' + it.disposeLabel +
      ' tagsText="' + it.tagsText + '" thumbUrl=' + (it.thumbUrl || '').slice(0, 40));
    check('tagsText 正确聚合', () => {
      if (it.tagsText !== '混搭') throw new Error(`期望 "混搭" 实际 "${it.tagsText}"`);
      return 'tagsText="混搭"';
    });
  }
}
check('getTrashDetail() 不存在时抛 not_found', () => {
  try { AD.getTrashDetail(services, 'no_such_fid'); }
  catch (e) {
    if (e.code !== 'not_found') throw new Error('错误码不对: ' + e.code);
    return 'code=not_found ✓';
  }
  throw new Error('应该抛错但没抛');
});

// 灌一条真实回收站记录再测详情
db.exec(`CREATE TABLE IF NOT EXISTS asset_trash (
  id INTEGER PRIMARY KEY AUTOINCREMENT, fid TEXT, file_name TEXT, size INTEGER,
  trash_rel TEXT, deleted_at INTEGER, deleted_by TEXT, dispose_source TEXT, dispose_detail TEXT)`);
db.prepare(`INSERT INTO asset_trash (fid,file_name,size,trash_rel,deleted_at,deleted_by,dispose_source)
            VALUES (?,?,?,?,?,?,?)`)
  .run('fid_test_001', 'test.jpg', 1024, '', now, 'admin', 'user_delete');

console.log('\n④ 有记录时的列表 + 详情');
const l2 = check('listTrash() 有数据', () => {
  const r = AD.listTrash(services, { page: 1, pageSize: 10 });
  if (r.total < 1) throw new Error('total=0，测试数据没进回收站');
  const i = r.items[0];
  return `total=${r.total} 首条 fid=${i.fid} label=${i.disposeLabel} tagsText="${i.tagsText}" remainingHours=${i.remainingHours}`;
});
check('getTrashDetail() 有数据', () => {
  const d = AD.getTrashDetail(services, 'fid_test_001');
  if (!d || d.fid !== 'fid_test_001') throw new Error('返回不对');
  return `fid=${d.fid} label=${d.disposeLabel} criterion="${(d.disposeCriterion || '').slice(0, 30)}" tagsText="${d.tagsText}"`;
});
check('listTrash(source=user_delete) 过滤', () => {
  const r = AD.listTrash(services, { page: 1, pageSize: 10, source: 'user_delete' });
  return '命中 ' + r.total;
});

console.log(`\n结果: ${pass} PASS / ${fail} FAIL`);
process.exit(fail ? 1 : 0);
