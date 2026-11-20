const fs = require('fs');
const path = require('path');
const { Quark } = require('./quark');

function toEpochMs(v) {
  const n = Number(v) || 0;
  if (!n) return 0;
  return n < 1e12 ? n * 1000 : n;
}

function readArtifact(p) {
  if (!p || !fs.existsSync(p)) return null;
  return fs.readFileSync(p, 'utf8').split(/\r?\n/)
    .map(l => l.trim()).filter(Boolean)
    .map(l => { try { return JSON.parse(l); } catch { return null; } })
    .filter(Boolean);
}

async function cacheThumbnail(url, targetPath) {
  if (!url || fs.existsSync(targetPath)) return;
  try {
    const res = await fetch(url, { redirect: 'follow', signal: AbortSignal.timeout(30000) });
    if (!res.ok) return;
    const buf = Buffer.from(await res.arrayBuffer());
    fs.writeFileSync(targetPath, buf);
  } catch (e) {}
}

async function runScan(services, { manual = false } = {}) {
  const { db, config, logger } = services;
  const { applyGovernance } = require('./governance');
  const quark = new Quark(config.cliPath);
  const rootFid = config.rootFid;
  const now = Date.now();

  const thumbsDir = path.join(config.dataDir, 'cache', 'thumbs');
  fs.mkdirSync(thumbsDir, { recursive: true });

  // CLI 1.0.19：size 为单页 1-100，内部自动分页；keyword 必填
  const imgs = await quark.searchImages({ size: 100, keyword: '图片' });
  const allImgs = readArtifact(imgs.artifactPath) || imgs.fileList;

  let newImg = 0, known = 0;

  const insOriginDeriv = db.prepare(`
    INSERT INTO derivatives (asset_fid, kind, storage_type, storage_ref, file_name, created_at)
    VALUES (?, 'origin', 'quark', ?, ?, ?)
  `);
  const setMainDeriv = db.prepare('UPDATE assets SET main_derivative_id = ? WHERE fid = ?');

  for (const file of allImgs) {
    const chain = (file.path || '').split(',').filter(Boolean);
    const inZone = chain.includes(rootFid) ? 1 : 0;
    const existing = db.prepare('SELECT fid, status, main_derivative_id FROM assets WHERE fid=?').get(file.fid);

    const thumbLocal = path.join(thumbsDir, `${file.fid}.jpg`);
    if (file.big_thumbnail) {
      cacheThumbnail(file.big_thumbnail, thumbLocal);
      try {
        if (fs.existsSync(thumbLocal)) {
          const { registerVisibleImageHashes } = require('./export-tag');
          const th = registerVisibleImageHashes(db, { filePath: thumbLocal, sourceFid: file.fid, variant: 'thumb', exportedBy: 'sync' });
          if (th) {
            db.prepare('UPDATE assets SET thumb_sha256 = COALESCE(thumb_sha256, ?), thumb_md5 = COALESCE(thumb_md5, ?) WHERE fid = ?')
              .run(th.sha256, th.md5, file.fid);
          }
        }
      } catch (_) {}
    }

    if (existing) {
      db.prepare(`
        UPDATE assets SET parent_fid=?, file_name=?, size=?, thumb_url=?, thumb_fetched_at=?,
                    in_managed_zone=?, updated_at=? WHERE fid=?
      `).run(file.parent_fid || null, file.filename, file.size || null,
             file.big_thumbnail || null, now, inZone, now, file.fid);
      known++;
    } else {
      db.prepare(`
        INSERT INTO assets
        (fid, kind, parent_fid, file_name, size, status, thumb_url, thumb_fetched_at,
         in_managed_zone, created_at, discovered_at, updated_at)
        VALUES (?, 'image', ?, ?, ?, 'discovered', ?, ?, ?, ?, ?, ?)
      `).run(file.fid, file.parent_fid || null, file.filename, file.size || null,
             file.big_thumbnail || null, now, inZone,
             file.created_at ? Number(file.created_at) : null, now, now);

      const r = insOriginDeriv.run(file.fid, file.fid, file.filename, now);
      setMainDeriv.run(r.lastInsertRowid, file.fid);
      newImg++;
    }
  }

  const gov = applyGovernance(db, now, config.dataDir || null);
  if (gov.live || gov.revoked || gov.frozen || gov.frozenRevoked || gov.revived) {
    logger?.info?.(`[sync] 治理对账: live=${gov.live} revoked=${gov.revoked} frozen=${gov.frozen} frozen_revoked=${gov.frozenRevoked} revived=${gov.revived}`);
  }

  // 扫描末尾分批解冻视频，让其进入 VLM/海报管线
  let unfrozen = 0;
  try {
    const { unfreezeVideos } = require('./process');
    unfrozen = unfreezeVideos(db, 50);
    if (unfrozen) logger?.info?.(`[sync] 本轮解冻视频 ${unfrozen} 个`);
  } catch (e) {
    logger?.warn?.(`[sync] 视频解冻跳过: ${e.message}`);
  }

  db.prepare("INSERT OR REPLACE INTO kv(key,value) VALUES('last_scan',?)")
    .run(JSON.stringify({ at: now, manual, total: imgs.total, newImages: newImg, governance: gov, unfrozenVideos: unfrozen }));

  const stats = {
    totalImages: imgs.total,
    fetchedImages: allImgs.length,
    newImages: newImg,
    known,
    governance: gov,
    unfrozenVideos: unfrozen,
    discoveredImages: db.prepare("SELECT COUNT(*) c FROM assets WHERE status='discovered' AND kind='image'").get().c
  };

  logger?.info?.(`[material-library] 扫描完成: 图片总数 ${imgs.total}，新增 ${newImg}，待入库 ${stats.discoveredImages}`);
  return stats;
}

module.exports = { runScan, toEpochMs };
