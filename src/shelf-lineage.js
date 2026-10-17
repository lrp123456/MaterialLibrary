/**
 * 素材来源板块与成图血缘。
 * 血缘在生成时写入，不事后从标签推断。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function ensureColumns(db) {
  const names = new Set(db.prepare('PRAGMA table_info(assets)').all().map((c) => c.name));
  if (!names.has('library_shelf')) {
    db.exec("ALTER TABLE assets ADD COLUMN library_shelf TEXT DEFAULT 'original'");
  }
  if (!names.has('category_locked')) {
    db.exec('ALTER TABLE assets ADD COLUMN category_locked INTEGER DEFAULT 0');
  }
  if (!names.has('lineage_json')) {
    db.exec('ALTER TABLE assets ADD COLUMN lineage_json TEXT');
  }
}

function parseLineage(raw) {
  if (!raw) return null;
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
}

function thumbUrl(fid) {
  return fid ? `/api/viewer/assets/${encodeURIComponent(fid)}/image` : '';
}

function briefAsset(db, fid) {
  if (!fid) return null;
  const row = db.prepare('SELECT fid, file_name, created_at, library_shelf, category FROM assets WHERE fid=?').get(fid);
  if (!row) return { fid, file_name: '', url: thumbUrl(fid), missing: true };
  return { ...row, url: thumbUrl(row.fid) };
}

function lineageTree(db, fid) {
  ensureColumns(db);
  const self = db.prepare(`
    SELECT fid, file_name, parent_fid, source_asset_id, lineage_json, library_shelf, category, created_at, is_ai
    FROM assets WHERE fid=?
  `).get(fid);
  if (!self) return null;
  const record = parseLineage(self.lineage_json) || {};
  const parentFid = record.parentFid || self.parent_fid || self.source_asset_id || '';
  const refFids = Array.isArray(record.refFids) ? record.refFids.filter((id) => id && id !== parentFid) : [];
  const children = db.prepare(`
    SELECT fid, file_name, created_at, library_shelf
    FROM assets
    WHERE (parent_fid=? OR source_asset_id=?) AND fid!=?
    ORDER BY created_at ASC
  `).all(fid, fid, fid).map((row) => ({ ...row, url: thumbUrl(row.fid) }));
  return {
    record: {
      thumbFid: fid,
      parentFid: parentFid || '',
      refFids,
      prompt: record.prompt || '',
      negative: record.negative || '',
      model: record.model || '',
      mode: record.mode || '',
      ratio: record.ratio || '',
      resolution: record.resolution || '',
      at: record.at || self.created_at || null,
      sessionId: record.sessionId || ''
    },
    self: { ...self, url: thumbUrl(fid) },
    parent: briefAsset(db, parentFid),
    refs: refFids.map((id) => briefAsset(db, id)),
    children
  };
}

function inheritTags(db, fromFid, toFid) {
  if (!fromFid || !toFid || fromFid === toFid) return;
  db.prepare(`
    INSERT OR IGNORE INTO asset_tags (asset_fid, tag_id, role, source, confidence, updated_at)
    SELECT ?, tag_id, role, 'inherited', confidence, ?
    FROM asset_tags
    WHERE asset_fid=? AND (source IS NULL OR source NOT IN ('human', 'manual'))
  `).run(toFid, Date.now(), fromFid);
}

function resolveInside(root, filePath) {
  const abs = path.resolve(filePath);
  const base = path.resolve(root);
  if (abs !== base && !abs.startsWith(base + path.sep)) {
    throw new Error('结果文件不在临时目录');
  }
  return abs;
}

function fileFromPreview(config, previewUrl) {
  const clean = String(previewUrl || '').split('?')[0];
  const name = path.basename(clean);
  if (!name || name === '.' || name === '..') throw new Error('结果文件无效');
  const abs = resolveInside(path.join(config.dataDir, 'cache', 'temp'), path.join(config.dataDir, 'cache', 'temp', name));
  if (!fs.existsSync(abs) || !fs.statSync(abs).isFile()) throw new Error('结果文件不在临时目录');
  return abs;
}

function fileFromDataUrl(config, dataUrl) {
  const m = String(dataUrl || '').match(/^data:([^;]+);base64,(.+)$/);
  if (!m) throw new Error('结果不是可用的图片数据');
  const ext = m[1].includes('png') ? '.png' : m[1].includes('webp') ? '.webp' : m[1].includes('mp4') ? '.mp4' : '.jpg';
  const buf = Buffer.from(m[2], 'base64');
  const dest = path.join(config.dataDir, 'cache', 'temp', `gen_${Date.now()}${ext}`);
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, buf);
  return dest;
}

async function registerGenerated(services, input = {}) {
  const { db, config } = services;
  ensureColumns(db);
  let src = '';
  if (input.previewUrl && String(input.previewUrl).includes('/api/cache/temp/')) {
    src = fileFromPreview(config, input.previewUrl);
  } else if (String(input.imageBase64 || '').startsWith('data:')) {
    src = fileFromDataUrl(config, input.imageBase64);
  } else {
    throw new Error('只能登记临时目录里的成图');
  }
  const buf = fs.readFileSync(src);
  const sha = crypto.createHash('sha256').update(buf).digest('hex');
  const existing = db.prepare('SELECT fid FROM assets WHERE sha256=?').get(sha);
  const parentFid = String(input.parentFid || '').trim();
  const refFids = [].concat(input.refFids || []).map(String).filter((id) => id && id !== parentFid);
  const now = Date.now();
  const record = {
    parentFid,
    refFids,
    prompt: String(input.prompt || ''),
    negative: String(input.negative || ''),
    model: String(input.model || ''),
    mode: String(input.mode || ''),
    ratio: String(input.ratio || ''),
    resolution: String(input.resolution || ''),
    at: now,
    sessionId: String(input.sessionId || '')
  };

  if (existing) {
    record.thumbFid = existing.fid;
    db.prepare(`
      UPDATE assets
      SET lineage_json=?, parent_fid=COALESCE(NULLIF(?, ''), parent_fid),
          source_asset_id=COALESCE(NULLIF(?, ''), source_asset_id),
          library_shelf='retouched', is_ai=1, updated_at=?
      WHERE fid=?
    `).run(JSON.stringify(record), parentFid, parentFid, now, existing.fid);
    inheritTags(db, parentFid, existing.fid);
    return { fid: existing.fid, deduped: true };
  }

  const parent = parentFid
    ? db.prepare('SELECT category, kind FROM assets WHERE fid=?').get(parentFid)
    : null;
  const ext = path.extname(src).toLowerCase();
  const kind = ext === '.mp4' || ext === '.webm' || ext === '.mov' ? 'video'
    : (ext === '.mp3' || ext === '.wav' || ext === '.m4a' ? 'audio' : 'image');
  const fid = `gen_${sha.slice(0, 24)}`;
  record.thumbFid = fid;
  let width = null;
  let height = null;
  if (kind === 'image') {
    try {
      const sharp = require('sharp');
      const meta = await sharp(buf, { failOn: 'none' }).rotate().metadata();
      width = meta.width || null;
      height = meta.height || null;
    } catch { /* 尺寸缺失不影响入库 */ }
  }
  const category = parent?.category || (kind === 'audio' ? 'music' : kind === 'video' ? 'video' : 'interior');
  db.prepare(`
    INSERT INTO assets (
      fid, kind, category, file_name, size, width, height, orientation,
      status, is_representative, is_ai, source, source_asset_id, parent_fid,
      sha256, library_shelf, lineage_json, created_at, discovered_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ready', 1, 1, 'ai', ?, ?, ?, 'retouched', ?, ?, ?, ?)
  `).run(
    fid,
    kind,
    category,
    path.basename(src),
    buf.length,
    width,
    height,
    width && height ? (height > width * 1.05 ? 'portrait' : (width > height * 1.05 ? 'landscape' : 'square')) : null,
    parentFid || null,
    parentFid || null,
    sha,
    JSON.stringify(record),
    now, now, now
  );
  const { createDerivative, setMainDerivative } = require('./derivatives');
  const deriv = await createDerivative(services, {
    assetFid: fid,
    kind: 'origin',
    srcPath: src,
    fileName: path.basename(src),
    width,
    height,
    mime: kind === 'video' ? 'video/mp4' : kind === 'audio' ? 'audio/mpeg' : 'image/jpeg',
    params: { source: 'generation', sha256: sha }
  });
  setMainDerivative(db, fid, deriv.id);
  try {
    const thumbDir = path.join(config.dataDir, 'cache', 'thumbs');
    fs.mkdirSync(thumbDir, { recursive: true });
    if (kind === 'image') fs.copyFileSync(src, path.join(thumbDir, `${fid}.jpg`));
  } catch { /* 缩略图失败仍保留原文件 */ }
  inheritTags(db, parentFid, fid);
  return { fid, deduped: false };
}

function setManualSpace(db, fid, spaceKey) {
  ensureColumns(db);
  const key = String(spaceKey || '').trim();
  const tag = db.prepare(`
    SELECT id, dir, label FROM tag_dict
    WHERE dimension='space' AND deprecated=0 AND (dir=? OR label=?)
  `).get(key, key);
  if (!tag) {
    const err = new Error('空间标签不存在');
    err.code = 400;
    throw err;
  }
  const old = db.prepare(`
    SELECT at.tag_id FROM asset_tags at
    JOIN tag_dict t ON t.id = at.tag_id
    WHERE at.asset_fid=? AND t.dimension='space'
  `).all(fid);
  const del = db.prepare('DELETE FROM asset_tags WHERE asset_fid=? AND tag_id=?');
  for (const row of old) del.run(fid, row.tag_id);
  db.prepare(`
    INSERT INTO asset_tags (asset_fid, tag_id, role, source, confidence, updated_at)
    VALUES (?, ?, '', 'manual', 1, ?)
  `).run(fid, tag.id, Date.now());
  return { dir: tag.dir, label: tag.label };
}

function requeueRetag(db, fid) {
  ensureColumns(db);
  const hit = db.prepare('SELECT fid, category_locked FROM assets WHERE fid=?').get(fid);
  if (!hit) {
    const err = new Error('素材不存在');
    err.code = 404;
    throw err;
  }
  db.prepare(`
    DELETE FROM asset_tags
    WHERE asset_fid=? AND (source IS NULL OR source NOT IN ('human', 'manual'))
  `).run(fid);
  db.prepare("UPDATE assets SET status='discovered', updated_at=? WHERE fid=?").run(Date.now(), fid);
  return { fid, categoryLocked: !!hit.category_locked };
}

module.exports = {
  ensureColumns,
  lineageTree,
  registerGenerated,
  setManualSpace,
  requeueRetag
};
