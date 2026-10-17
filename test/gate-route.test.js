/**
 * 闸门种类路由、回收站捞回、收藏排序。不访问网络。
 * 运行：node test/gate-route.test.js
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const Database = require('better-sqlite3');
const { routeGate, classifyTrashRecovery, GATE_PROMPT, promptIncludesLibraries } = require('../src/gate-route');
const { setFavorite } = require('../src/favorites');
const assetsDelete = require('../src/assets-delete');

let failed = 0;
function check(name, cond, extra) {
  if (cond) console.log('ok', name);
  else {
    failed += 1;
    console.error('FAIL', name, extra === undefined ? '' : extra);
  }
}

const interiorFalse = routeGate({
  is_material: false,
  category: 'interior',
  reason: '展示了客厅与厨房相连的室内空间整体效果。',
});
check('室内且布尔值为假仍留下', interiorFalse.keep === true && interiorFalse.category === 'interior');

const interior2 = routeGate({
  is_material: false,
  category: 'interior',
  reason: '展示了完整的室内空间，包含厨房岛台、客厅沙发及格栅天花板设计。',
});
check('岛台客厅仍留下', interior2.keep && interior2.category === 'interior');

check('截图丢掉', routeGate({ is_material: false, category: 'none', reason: '该图为APP界面截图' }).keep === false);
check('服装种类留下', routeGate({ is_material: false, category: 'clothing', reason: '穿搭' }).keep === true);
check('提示词含服装和人像', promptIncludesLibraries(GATE_PROMPT));

const samples = [
  ['none', '这是一张服装穿搭广告图，主体是人物服装，不属于室内设计或建筑素材。', 'clothing'],
  ['none', '图片主体是服装和个人美妆用品，属于商品穿搭广告图，与室内设计或建筑设计无关。', 'clothing'],
  ['none', '图片主体为人物穿搭展示，属于服饰商品广告或个人穿搭，不属于室内设计素材', 'clothing'],
  ['interior', '展示了客厅与厨房相连的室内空间整体效果。', 'interior'],
  ['none', '该图为APP界面截图，不属于室内/建筑设计参考素材范畴', null],
  ['none', '这是一张人像自拍', 'portrait'],
];
for (const [cat, reason, library] of samples) {
  const got = classifyTrashRecovery(cat, reason);
  check(`捞回 ${library || '留在回收站'}`, got.library === library, got);
}
check('穿着展示不进人人像', classifyTrashRecovery('none', '图片主体为人物穿搭展示').library === 'clothing');
check('室内恢复要重构', classifyTrashRecovery('interior', '客厅').restage === true);
check('服装不自动重构', classifyTrashRecovery('none', '服装穿搭').restage === false);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-rehome-'));
const trashFile = path.join(dir, 'trash-interior.jpg');
const clothFile = path.join(dir, 'trash-cloth.jpg');
const shotFile = path.join(dir, 'trash-shot.jpg');
fs.writeFileSync(trashFile, 'interior');
fs.writeFileSync(clothFile, 'cloth');
fs.writeFileSync(shotFile, 'shot');
const db = new Database(path.join(dir, 't.db'));
db.exec(`
  CREATE TABLE assets (
    fid TEXT PRIMARY KEY, status TEXT, category TEXT, file_name TEXT,
    sha256 TEXT, size INTEGER, updated_at INTEGER, favorited_at INTEGER
  );
  CREATE TABLE node_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    asset_fid TEXT, node_type TEXT, status TEXT, output_summary TEXT
  );
`);
assetsDelete.ensureTables(db);
function seed(fid, file, category, reason) {
  db.prepare('INSERT INTO assets (fid, status, category, file_name, size) VALUES (?, ?, ?, ?, 10)')
    .run(fid, 'deleted', 'interior', fid + '.jpg');
  db.prepare(`INSERT INTO asset_trash (fid, file_name, trash_rel, deleted_at, dispose_source, dispose_detail)
    VALUES (?, ?, ?, ?, 'gate_reject', ?)`).run(fid, fid + '.jpg', file, Date.now(), reason);
  db.prepare(`INSERT INTO node_runs (asset_fid, node_type, status, output_summary) VALUES (?, 'gate', 'done', ?)`)
    .run(fid, JSON.stringify({ excluded: true, category, reason }));
}
seed('a1', trashFile, 'interior', '展示了客厅与厨房相连的室内空间整体效果。');
seed('c1', clothFile, 'none', '这是一张服装穿搭广告图，主体是人物服装');
seed('s1', shotFile, 'none', '该图为APP界面截图');

const services = { db, config: { dataDir: dir }, logger: { info() {}, warn() {} } };
const out = assetsDelete.rehomeGateRejects(services);
check('室内被捞回', out.restored.some((r) => r.fid === 'a1' && r.library === 'interior'), out);
check('服装被捞回且不重构', out.restored.some((r) => r.fid === 'c1' && r.library === 'clothing' && r.restage === false));
check('截图留在回收站', out.kept.some((r) => r.fid === 's1'));
const a1 = db.prepare('SELECT status, category FROM assets WHERE fid=?').get('a1');
check('室内恢复后待重构', a1.status === 'processing' && a1.category === 'interior', a1);
const again = assetsDelete.rehomeGateRejects(services);
check('重复执行不再捞室内', !again.restored.some((r) => r.fid === 'a1'));

setFavorite(db, 'a1', true);
db.prepare('UPDATE assets SET favorited_at=? WHERE fid=?').run(1000, 'a1');
setFavorite(db, 'c1', true);
const t2 = db.prepare('SELECT favorited_at FROM assets WHERE fid=?').get('c1').favorited_at;
const order = db.prepare('SELECT fid FROM assets WHERE favorited_at IS NOT NULL ORDER BY favorited_at DESC').all().map((r) => r.fid);
check('后收藏的在前', order[0] === 'c1' && t2 > 1000, order);
setFavorite(db, 'c1', false);
setFavorite(db, 'c1', true);
const order2 = db.prepare('SELECT fid FROM assets WHERE favorited_at IS NOT NULL ORDER BY favorited_at DESC').all().map((r) => r.fid);
check('取消再收藏后排到最前', order2[0] === 'c1', order2);
let blocked = false;
try { setFavorite(db, 's1', true); } catch (e) { blocked = /回收站/.test(e.message); }
check('回收站不能收藏', blocked);

if (failed) {
  console.error(failed + ' failed');
  process.exit(1);
}
console.log('all passed');
