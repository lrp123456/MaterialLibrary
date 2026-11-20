/**
 * 替换原图（覆盖但保留历史版本，可一键还原）。
 *
 * 流程与 src/api.js 现有资产链路保持一致：
 * 1. 引用检查：被剪辑工程引用且非 force -> 409 referenced_by_clip_projects；
 * 2. ensureOriginalFile 解析真源 -> 先备份原文件到 cache/originals/history 并写 derivatives(kind='history')；
 * 3. 覆盖原文件、重算 sha256、更新 assets 的 sha256/size/width/height/orientation；
 *    sha256 撞到其它已有素材 -> 409 duplicate_sha256（保去重语义）；
 * 4. 重建缩略图 / 预览（复用 derivatives.js:64-65 / :198-234 与 stream-upload.js:514-575 的能力）；
 * 5. restoreAssetVersion 走同一流程，且会先把当前版本再存一份 history。
 */
'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { ensureOriginalFile } = require('./originals');
const { ensurePreviewJpeg } = require('./derivatives');
const { assetsUsedByProjects } = require('./clip-snapshots');

function httpError(message, status, code) {
  const e = new Error(message);
  e.status = status;
  e.statusCode = status;
  e.code = code;
  return e;
}

function safeName(fid) {
  return String(fid).replace(/[^A-Za-z0-9_~.-]/g, '_');
}

/**
 * 覆盖原图后必须清掉该素材「所有」渲染档缓存：thumbs / grid / preview 的 jpg、webp，
 * 以及按 derivativeId 命名的 `fid_<id>.*` 变体。
 *
 * 踩过的坑：这里以前只删 thumbs 和 preview/fid_*，漏了 grid/*.webp。
 * 浏览器 Accept 带 image/webp 时，列表与详情一直拿到旧原图生成的 webp，
 * 于是「裁剪并替换原图」后看到的仍是原图（磁盘上的原图其实已经是裁剪后的图）。
 */
function clearAssetRenditionCaches(config, fid) {
  const safeFid = safeName(fid);
  for (const sub of ['cache/thumbs', 'cache/grid', 'cache/preview']) {
    const dir = path.join(config.dataDir, sub);
    let names = [];
    try { names = fs.readdirSync(dir); } catch (_) { continue; }
    for (const name of names) {
      if (name === `${safeFid}.jpg` || name === `${safeFid}.webp` || name.startsWith(`${safeFid}_`)) {
        try { fs.unlinkSync(path.join(dir, name)); } catch (_) {}
      }
    }
  }
}

/** 重建缩略图 / 预览：先删旧产物，再按新原图重生成。 */
async function rebuildDerivativeViews(services, fid, originalPath, fileBuffer) {
  const { db, config } = services;
  const thumbsDir = path.join(config.dataDir, 'cache', 'thumbs');
  const previewDir = path.join(config.dataDir, 'cache', 'preview');
  fs.mkdirSync(thumbsDir, { recursive: true });
  fs.mkdirSync(previewDir, { recursive: true });

  // 所有渲染档先整体失效（含 webp 与 derivative 变体），否则旧图会继续被浏览器命中
  clearAssetRenditionCaches(config, fid);

  // 缩略图：对齐 derivatives.js:64-65 的清理 + stream-upload.js:514-575 的 sharp 512 生成
  const thumbPath = path.join(thumbsDir, `${fid}.jpg`);
  try { if (fs.existsSync(thumbPath)) fs.unlinkSync(thumbPath); } catch (_) {}
  try {
    await require('sharp')(fileBuffer, { failOn: 'none' })
      .rotate()
      .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 82 })
      .toFile(thumbPath);
  } catch (e) {
    (services.logger || console).warn?.(`[asset-replace] 缩略图重建失败: ${e.message}`);
  }

  // 预览：旧预览已在 clearAssetRenditionCaches 里整体清掉，这里逐个按新原图重生成
  let derivs = [];
  try {
    derivs = db.prepare("SELECT * FROM derivatives WHERE asset_fid=? AND kind != 'history'").all(fid) || [];
  } catch (_) {}
  if (!derivs.length) derivs = [{ id: 'origin', mime: 'image/jpeg', kind: 'origin' }];
  for (const d of derivs) {
    // 每个衍生版本按自己的文件出预览；只有取不到衍生文件时才退回新原图
    const src = (d.storage_ref && fs.existsSync(d.storage_ref)) ? d.storage_ref : originalPath;
    try { await ensurePreviewJpeg(services, fid, d, src); } catch (_) {}
  }
  // 旧预览/缩略哈希已失效，清掉让 ensurePreviewJpeg 的异步登记重新写入
  try {
    db.prepare('UPDATE assets SET preview_sha256=NULL, preview_md5=NULL, thumb_sha256=NULL, thumb_md5=NULL WHERE fid=?')
      .run(fid);
  } catch (_) {}
}

async function performReplace(services, fid, fileBuffer, { force = false } = {}) {
  const { db, config } = services;
  if (!Buffer.isBuffer(fileBuffer) || !fileBuffer.length) {
    throw httpError('缺少有效的图片数据', 400, 'invalid_image');
  }
  const asset = db.prepare('SELECT * FROM assets WHERE fid=?').get(fid);
  if (!asset) throw httpError('素材不存在', 404, 'not_found');

  // 1. 引用检查（与 assets-delete.js:225-244 同语义）
  if (!force) {
    let used = [];
    try { used = assetsUsedByProjects(db, fid) || []; } catch (_) {}
    if (used.length) {
      throw httpError(
        `素材被 ${used.length} 个剪辑工程引用，替换需显式 force=true`,
        409,
        'referenced_by_clip_projects',
      );
    }
  }

  // 2. 真源解析
  const originalPath = await ensureOriginalFile(services, asset);
  if (!originalPath || !fs.existsSync(originalPath)) {
    throw httpError('本地原图不存在', 404, 'original_missing');
  }

  let meta;
  try {
    meta = await require('sharp')(fileBuffer, { failOn: 'none' }).rotate().metadata();
  } catch (e) {
    throw httpError('新图片不是有效的图像文件: ' + e.message, 400, 'invalid_image');
  }
  if (!meta.width || !meta.height) throw httpError('无法解析新图片尺寸', 400, 'invalid_image');

  const newSha = crypto.createHash('sha256').update(fileBuffer).digest('hex');
  const dup = db.prepare('SELECT fid FROM assets WHERE sha256=? AND fid<>? LIMIT 1').get(newSha, fid);
  if (dup) throw httpError(`新图片与已有素材 ${dup.fid} 重复`, 409, 'duplicate_sha256');

  // 3. 备份原文件 + 写 derivatives(kind='history') 记录
  const oldBuffer = fs.readFileSync(originalPath);
  const oldSha = crypto.createHash('sha256').update(oldBuffer).digest('hex');
  const historyDir = path.join(config.dataDir, 'cache', 'originals', 'history');
  fs.mkdirSync(historyDir, { recursive: true });
  const ts = Date.now();
  const ext = path.extname(originalPath) || '.jpg';
  const historyPath = path.join(historyDir, `${safeName(fid)}_${ts}${ext}`);
  fs.copyFileSync(originalPath, historyPath);

  const versionId = db.prepare(`
    INSERT INTO derivatives (
      asset_fid, kind, storage_type, storage_ref, file_name,
      width, height, mime, sha256, params, created_at
    ) VALUES (?, 'history', 'local_cache', ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    fid,
    historyPath,
    path.basename(historyPath),
    Number(asset.width) || null,
    Number(asset.height) || null,
    'image/jpeg',
    oldSha,
    JSON.stringify({ sha256: oldSha, originalPath, replacedAt: ts, size: oldBuffer.length }),
    ts,
  ).lastInsertRowid;

  // 4. 覆盖原文件 + 更新 assets 指纹与尺寸
  fs.writeFileSync(originalPath, fileBuffer);
  const width = meta.width;
  const height = meta.height;
  const orientation = height > width * 1.05 ? 'portrait' : (width > height * 1.05 ? 'landscape' : 'square');
  try {
    db.prepare('UPDATE assets SET sha256=?, size=?, width=?, height=?, orientation=?, updated_at=? WHERE fid=?')
      .run(newSha, fileBuffer.length, width, height, orientation, ts, fid);
  } catch (e) {
    // UNIQUE(sha256) 兜底：恢复原文件，保证磁盘与库一致
    try { fs.writeFileSync(originalPath, oldBuffer); } catch (_) {}
    if (/UNIQUE|constraint/i.test(String(e.message || ''))) {
      throw httpError('新图片与已有素材重复', 409, 'duplicate_sha256');
    }
    throw e;
  }

  // 5. 重建缩略图 / 预览
  await rebuildDerivativeViews(services, fid, originalPath, fileBuffer);

  return { success: true, fid, versionId: Number(versionId) };
}

/** 覆盖原图（保留历史版本）。 */
function replaceAssetImage(services, fid, fileBuffer, { force = false } = {}) {
  return performReplace(services, fid, fileBuffer, { force });
}

/** 还原到指定历史版本：读取 history 文件内容，走同一替换流程（内部会再把当前版本存一份 history）。 */
async function restoreAssetVersion(services, fid, versionId) {
  const { db } = services;
  // versionId 为空 = 还原「最近一次替换前的版本」：前端「还原上一版本」不传 id。
  const asNum = Number(versionId);
  const missing = versionId === undefined || versionId === null || versionId === ''
    || !Number.isFinite(asNum) || asNum <= 0;
  const row = missing
    ? db.prepare("SELECT * FROM derivatives WHERE asset_fid=? AND kind='history' ORDER BY id DESC LIMIT 1").get(fid)
    : db.prepare("SELECT * FROM derivatives WHERE id=? AND asset_fid=? AND kind='history'").get(asNum, fid);
  if (!row) throw httpError('历史版本不存在', 404, 'version_not_found');
  const p = row.storage_ref;
  if (!p || !fs.existsSync(p)) throw httpError('历史版本文件已丢失', 404, 'version_file_missing');
  const buf = fs.readFileSync(p);
  return performReplace(services, fid, buf, { force: true });
}

module.exports = {
  replaceAssetImage,
  restoreAssetVersion,
  // 供回归测试直接验证「覆盖原图后所有渲染档缓存都被清掉」
  clearAssetRenditionCaches,
};
