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
  const row = db.prepare('SELECT fid, file_name, created_at, library_shelf, category, status FROM assets WHERE fid=?').get(fid);
  // 行不存在或已在回收站（软删）：血缘图中一律按缺失处理，不再渲染节点。
  // 软删可恢复，引用数据本身保留在 lineage_json/parent_fid 中，恢复后血缘自动回归。
  if (!row || row.status === 'deleted') return { fid, file_name: '', url: thumbUrl(fid), missing: true };
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
  const rawParentFid = record.parentFid || self.parent_fid || self.source_asset_id || '';
  const rawRefFids = Array.isArray(record.refFids) ? record.refFids.filter((id) => id && id !== rawParentFid) : [];

  // 父图/参考图若已软删（在回收站），血缘图同步隐藏，避免出现点不开的孤儿节点
  const parentBrief = rawParentFid ? briefAsset(db, rawParentFid) : null;
  const parent = parentBrief && !parentBrief.missing ? parentBrief : null;
  const parentFid = parent ? rawParentFid : '';
  const refs = rawRefFids
    .map((id) => briefAsset(db, id))
    .filter((a) => a && !a.missing);
  const refFids = refs.map((a) => a.fid);

  // 衍生（子图）：排除回收站中的资产
  const children = db.prepare(`
    SELECT fid, file_name, created_at, library_shelf
    FROM assets
    WHERE (parent_fid=? OR source_asset_id=?) AND fid!=? AND status!='deleted'
    ORDER BY created_at ASC
  `).all(fid, fid, fid).map((row) => ({ ...row, url: thumbUrl(row.fid) }));

  // 剪辑使用记录：剔除已删除素材，防止前端二次拉取详情时 404
  let editUses = Array.isArray(record.editUses) ? record.editUses : [];
  if (editUses.length) {
    const useFids = [...new Set(editUses.map((u) => u && u.fid).filter(Boolean))];
    if (useFids.length) {
      const placeholders = useFids.map(() => '?').join(',');
      const alive = new Set(
        db.prepare(`SELECT fid FROM assets WHERE fid IN (${placeholders}) AND status!='deleted'`)
          .all(...useFids)
          .map((r) => r.fid)
      );
      editUses = editUses.filter((u) => u && u.fid && alive.has(u.fid));
    }
  }

  let usedByFilms = [];
  try {
    usedByFilms = require('./editor-projects').filmsUsing(db, fid).map((row) => ({
      ...row,
      url: thumbUrl(row.fid),
    }));
  } catch { usedByFilms = []; }
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
      sessionId: record.sessionId || '',
      projectId: record.projectId || '',
      editUses
    },
    self: { ...self, url: thumbUrl(fid) },
    parent,
    refs,
    children,
    usedByFilms
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
    // BUG-003：sha256 命中存量时，原实现直接把该资产强改为
    // library_shelf='retouched', is_ai=1 —— 会把货架上原本的实拍母素材污染成 AI 图。
    // 收敛为：仅当命中对象自身已是生成图（且不是母素材本人）才刷新血缘元数据；
    // 母素材/实拍图只返回去重命中，属性一律不动。
    const existingRow = db.prepare('SELECT fid, library_shelf, is_ai FROM assets WHERE fid=?').get(existing.fid);
    const isSameAsParent = parentFid && existingRow.fid === parentFid;
    const alreadyGenerated = existingRow.library_shelf === 'retouched' || Number(existingRow.is_ai) === 1;
    if (!isSameAsParent && alreadyGenerated) {
      db.prepare(`
        UPDATE assets
        SET lineage_json=?, parent_fid=COALESCE(NULLIF(?, ''), parent_fid),
            source_asset_id=COALESCE(NULLIF(?, ''), source_asset_id),
            updated_at=?
        WHERE fid=?
      `).run(JSON.stringify(record), parentFid, parentFid, now, existing.fid);
      inheritTags(db, parentFid, existing.fid);
    }
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
  let duration = null;
  if (kind === 'image') {
    try {
      const sharp = require('sharp');
      const meta = await sharp(buf, { failOn: 'none' }).rotate().metadata();
      width = meta.width || null;
      height = meta.height || null;
    } catch { /* 尺寸缺失不影响入库 */ }
  } else if (kind === 'video') {
    try {
      const meta = await require('./umbra').extractVideoMeta(src);
      width = Number(meta.width) || null;
      height = Number(meta.height) || null;
      duration = Number(meta.duration) || null;
    } catch { /* 尺寸缺失不影响入库 */ }
  }
  const category = parent?.category || (kind === 'audio' ? 'music' : kind === 'video' ? 'video' : 'interior');
  const orientation = width && height
    ? (height > width * 1.05 ? 'portrait' : (width > height * 1.05 ? 'landscape' : 'square'))
    : null;
  db.prepare(`
    INSERT INTO assets (
      fid, kind, category, file_name, size, width, height, orientation, duration_s,
      status, is_ai, source, source_asset_id, parent_fid,
      sha256, library_shelf, lineage_json, created_at, discovered_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'ready', 1, 'ai', ?, ?, ?, 'retouched', ?, ?, ?, ?)
  `).run(
    fid,
    kind,
    category,
    path.basename(src),
    buf.length,
    width,
    height,
    orientation,
    duration,
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
  if (kind === 'video') {
    const videoTags = require('./video-tags');
    const purpose = videoTags.purposeFromText(input.prompt || '');
    if (purpose) videoTags.applyVideoPurpose(db, fid, purpose, 'job');
    try { await videoTags.ensureVideoPoster(config, fid, src); } catch { /* 海报缺失不挡住成片 */ }
    const parentHasScene = parentFid && videoTags.parentHasSceneTags(db, parentFid);
    if (!parentHasScene && services.interpreter) {
      try {
        await services.interpreter.triggerRun({ assetFids: [fid], trigger: 'video_scene' });
      } catch (err) {
        services.logger?.warn?.(`[lineage] 视频画面打标未入队 ${fid}: ${err.message}`);
      }
    }
  }
  return { fid, deduped: false };
}

function setManualTag(db, fid, dimension, tagKey) {
  ensureColumns(db);
  const dim = String(dimension || '').trim();
  const key = String(tagKey || '').trim();
  const allowed = ['space', 'furniture_item', 'furniture_craft', 'pose', 'character', 'shot_type', 'clothing_category', 'season'];
  if (!allowed.includes(dim)) {
    const err = new Error('这个维度不能在详情里改');
    err.code = 400;
    throw err;
  }
  const tag = db.prepare(`
    SELECT id, dir, label FROM tag_dict
    WHERE dimension=? AND deprecated=0 AND (dir=? OR label=?)
  `).get(dim, key, key);
  if (!tag) {
    const err = new Error('词表里没有这项');
    err.code = 400;
    throw err;
  }
  const old = db.prepare(`
    SELECT at.tag_id FROM asset_tags at
    JOIN tag_dict t ON t.id = at.tag_id
    WHERE at.asset_fid=? AND t.dimension=?
  `).all(fid, dim);
  const del = db.prepare('DELETE FROM asset_tags WHERE asset_fid=? AND tag_id=?');
  for (const row of old) del.run(fid, row.tag_id);
  db.prepare(`
    INSERT INTO asset_tags (asset_fid, tag_id, role, source, confidence, updated_at)
    VALUES (?, ?, '', 'manual', 1, ?)
  `).run(fid, tag.id, Date.now());
  return { dir: tag.dir, label: tag.label };
}

function setManualSpace(db, fid, spaceKey) {
  return setManualTag(db, fid, 'space', spaceKey);
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
    WHERE asset_fid=? AND (source IS NULL OR source NOT IN ('human', 'manual', 'job'))
  `).run(fid);
  db.prepare("UPDATE assets SET status='discovered', updated_at=? WHERE fid=?").run(Date.now(), fid);
  return { fid, categoryLocked: !!hit.category_locked };
}

module.exports = {
  ensureColumns,
  lineageTree,
  registerGenerated,
  inheritTags,
  setManualSpace,
  setManualTag,
  requeueRetag
};
