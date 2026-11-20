/**
 * 全库一份收藏。原图留在原来的库，收藏页按 favorited_at 倒序。
 */

// PERF-05：按 db 实例缓存列自检，避免 queryAssets 每次请求都跑 PRAGMA。
const favoriteColumnCache = new WeakMap();

function ensureFavoriteColumn(db) {
  if (favoriteColumnCache.get(db)) return;
  favoriteColumnCache.set(db, true);
  const cols = db.prepare('PRAGMA table_info(assets)').all().map((c) => c.name);
  if (!cols.includes('favorited_at')) {
    db.exec('ALTER TABLE assets ADD COLUMN favorited_at INTEGER');
  }
}

function setFavorite(db, fid, on) {
  ensureFavoriteColumn(db);
  const row = db.prepare('SELECT fid, status, favorited_at FROM assets WHERE fid=?').get(fid);
  if (!row) {
    const err = new Error('素材不存在');
    err.code = 'not_found';
    throw err;
  }
  if (row.status === 'deleted' || row.status === 'excluded') {
    const err = new Error('回收站里的图不能收藏');
    err.code = 'bad_request';
    throw err;
  }
  const targetOn = on === undefined ? !row.favorited_at : !!on;
  const favoritedAt = targetOn ? Date.now() : null;
  db.prepare('UPDATE assets SET favorited_at=?, updated_at=? WHERE fid=?').run(favoritedAt, Date.now(), fid);
  return { fid, favoritedAt, favorited: !!favoritedAt };
}

module.exports = { ensureFavoriteColumn, setFavorite };
