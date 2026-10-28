/**
 * 材质草稿管理与正式确认入库
 */

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
const { prefillMaterialVision } = require('./prefill');
const { isValidSurface, isValidSubclass } = require('./taxonomy');
const { cleanupExpiredDrafts } = require('./schema');

async function createMaterialDraft(services, { source, sourceId, title = '', licenseNote = '', buffer, isManual = false, attestSwatch = false }) {
  const db = services.db;
  const dataDir = services.config?.dataDir || process.env.ML_DATA_DIR;

  // 1. 启动与入口清扫 > 24 小时超期草稿
  cleanupExpiredDrafts(db, Date.now(), fs, dataDir);

  if (!buffer || buffer.length === 0) {
    const err = new Error('贴图文件为空');
    err.status = 400;
    throw err;
  }

  // 2. 长边压至 1024 JPEG
  const image = sharp(buffer);
  const metadata = await image.metadata();
  const processedBuffer = await image
    .resize(1024, 1024, { fit: 'inside', withoutEnlargement: true })
    .jpeg({ quality: 85 })
    .toBuffer();

  const processedMeta = await sharp(processedBuffer).metadata();
  const width = processedMeta.width || metadata.width || 1024;
  const height = processedMeta.height || metadata.height || 1024;

  // 3. 视觉预填与平铺色卡闸门
  const prefill = await prefillMaterialVision(processedBuffer, { title, source, tags: [] });

  // 房间照片闸门（仅限手动上传）
  if (isManual && prefill.is_flat_swatch === false) {
    const err = new Error(prefill.reject_reason || '检测到房间实景、透视或整件家具，非正射平铺贴图');
    err.status = 422;
    err.code = 'room_photo_rejected';
    throw err;
  }

  if (isManual && !prefill.success && !attestSwatch) {
    const err = new Error('视觉分析不可用，手动上传必须勾选确认正射平铺色卡承诺');
    err.status = 400;
    err.code = 'attest_swatch_required';
    throw err;
  }

  // 4. 写入临时目录与 ba_drafts
  const draftId = `draft_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const tempRel = path.posix.join('cache', 'temp', `${draftId}.jpg`);
  const fullTempPath = path.resolve(dataDir, tempRel);
  fs.mkdirSync(path.dirname(fullTempPath), { recursive: true });
  fs.writeFileSync(fullTempPath, processedBuffer);

  const now = Date.now();
  db.prepare(`
    INSERT INTO ba_drafts (id, temp_rel, source, source_id, license_note, prefill_json, is_flat_swatch, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    draftId,
    tempRel,
    source,
    sourceId || null,
    licenseNote || (source === 'polyhaven' ? 'Poly Haven, CC0' : (source === 'ambientcg' ? 'ambientCG, CC0' : 'Manual')),
    JSON.stringify(prefill),
    prefill.is_flat_swatch ? 1 : 0,
    now
  );

  return {
    draft_id: draftId,
    prefill: {
      name_cn: prefill.name_cn,
      tags: prefill.tags,
      is_flat_swatch: prefill.is_flat_swatch
    },
    width,
    height
  };
}

async function confirmMaterialDraft(services, { draftId, nameCn, tags = [], isShell = 0 }) {
  const db = services.db;
  const dataDir = services.config?.dataDir || process.env.ML_DATA_DIR;

  const draft = db.prepare('SELECT * FROM ba_drafts WHERE id=?').get(draftId);
  if (!draft) {
    const err = new Error('草稿不存在或已过期');
    err.status = 404;
    throw err;
  }

  const finalName = (nameCn || '').trim();
  if (!finalName) {
    const err = new Error('材质中文名称不可为空');
    err.status = 400;
    throw err;
  }

  const finalShell = Number(isShell) ? 1 : 0;
  const validTags = (tags || []).filter(t => t && isValidSurface(t.surface) && isValidSubclass(t.subclass));

  if (!finalShell && validTags.length === 0) {
    const err = new Error('非底色壳材质必须至少指定一个合法的装修面与子类标签');
    err.status = 400;
    throw err;
  }

  const tempFullPath = path.resolve(dataDir, draft.temp_rel);
  if (!fs.existsSync(tempFullPath)) {
    const err = new Error('草稿临时文件丢失');
    err.status = 404;
    throw err;
  }

  // 生成材质持久 ID
  const matId = `mat_${crypto.randomBytes(4).toString('hex')}`;
  const targetRel = path.posix.join('cache', 'base-library', 'materials', matId, 'basecolor.jpg');
  const targetFullPath = path.resolve(dataDir, targetRel);
  fs.mkdirSync(path.dirname(targetFullPath), { recursive: true });

  // 移动/写入文件
  fs.copyFileSync(tempFullPath, targetFullPath);
  try { fs.unlinkSync(tempFullPath); } catch {}

  const meta = await sharp(targetFullPath).metadata();
  const width = meta.width || 1024;
  const height = meta.height || 1024;
  const now = Date.now();

  const confirmTx = db.transaction(() => {
    db.prepare(`
      INSERT INTO ba_materials (id, name_cn, source, source_id, license_note, is_shell, basecolor_rel, width, height, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      matId,
      finalName,
      draft.source,
      draft.source_id,
      draft.license_note,
      finalShell,
      targetRel,
      width,
      height,
      now,
      now
    );

    const insTag = db.prepare(`
      INSERT OR IGNORE INTO ba_asset_tags (asset_kind, asset_id, surface, subclass)
      VALUES (?, ?, ?, ?)
    `);
    for (const t of validTags) {
      insTag.run('material', matId, t.surface, t.subclass);
    }

    db.prepare('DELETE FROM ba_drafts WHERE id=?').run(draftId);
  });

  confirmTx.immediate();

  return {
    id: matId,
    name_cn: finalName,
    tags: validTags,
    is_shell: Boolean(finalShell),
    thumb_url: `/api/base-library/materials/${encodeURIComponent(matId)}/basecolor`,
    source: draft.source,
    source_id: draft.source_id,
    credit: draft.license_note
  };
}

module.exports = {
  createMaterialDraft,
  confirmMaterialDraft
};
