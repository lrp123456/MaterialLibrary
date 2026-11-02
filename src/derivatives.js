/**
 * 衍生血缘管理 (Derivatives Management)
 * 统一管理原图 (origin)、去水印版 (clean)、9:16重构图 (restage_9_16)、3:4重构图 (restage_3_4)、生成视频 (gen_video)
 */
const path = require('path');
const fs = require('fs');
const { Quark } = require('./quark');

function getDerivatives(db, assetFid) {
  return db.prepare('SELECT * FROM derivatives WHERE asset_fid = ? ORDER BY id ASC').all(assetFid);
}

function getDerivativeById(db, id) {
  return db.prepare('SELECT * FROM derivatives WHERE id = ?').get(id);
}

function markKindRecast(db, assetFid, kind, exceptId = null) {
  if (!db || !assetFid || !kind) return 0;
  const rows = db.prepare('SELECT id, params FROM derivatives WHERE asset_fid = ? AND kind = ?').all(assetFid, kind);
  let n = 0;
  for (const row of rows) {
    if (exceptId && Number(row.id) === Number(exceptId)) continue;
    let p = {};
    if (row.params) {
      try {
        p = typeof row.params === 'string' ? JSON.parse(row.params) : (row.params || {});
      } catch {
        p = {};
      }
    }
    if (p.recast === true) continue;
    p.recast = true;
    db.prepare('UPDATE derivatives SET params = ? WHERE id = ?').run(JSON.stringify(p), row.id);
    n++;
  }
  return n;
}

function setMainDerivative(servicesOrDb, assetFid, derivativeId) {
  const db = servicesOrDb.db || servicesOrDb;
  db.prepare('UPDATE assets SET main_derivative_id = ?, updated_at = ? WHERE fid = ?')
    .run(derivativeId, Date.now(), assetFid);
  const config = servicesOrDb.config;
  if (config?.dataDir) {
    try {
      const thumb = path.join(config.dataDir, 'cache', 'thumbs', `${assetFid}.jpg`);
      if (fs.existsSync(thumb)) fs.unlinkSync(thumb);
    } catch {}
  }
}

async function createDerivative(services, {
  assetFid,
  kind,
  srcPath,
  fileName,
  width,
  height,
  mime = 'image/jpeg',
  durationS = null,
  params = {},
  uploadToQuark = false
}) {
  if (services && services.sandbox) {
    return {
      id: null,
      assetFid,
      asset_fid: assetFid,
      kind,
      width: width || null,
      height: height || null,
      mime,
      sandbox: true,
      strategy: 'sandbox_no_write',
    };
  }
  const { db, config, logger } = services;
  const ext = path.extname(fileName || srcPath || '.jpg') || (mime.includes('video') ? '.mp4' : '.jpg');
  const relPath = path.join('cache', 'derivatives', `${kind}_${assetFid}_${Date.now()}${ext}`);
  const absPath = path.join(config.dataDir, relPath);

  fs.mkdirSync(path.dirname(absPath), { recursive: true });

  if (srcPath && srcPath !== absPath) {
    fs.copyFileSync(srcPath, absPath);
  }

  let storageType = 'local_cache';
  let storageRef = relPath;

  if (uploadToQuark && config.systemFid) {
    try {
      const quark = new Quark(config.cliPath);
      const res = await quark.upload(absPath, config.systemFid);
      if (res && res.fid) {
        storageType = 'quark';
        storageRef = res.fid;
      }
    } catch (e) {
      logger?.warn?.(`[derivatives] 上传夸克 _system 失败，保留本地缓存: ${e.message}`);
    }
  }

  const now = Date.now();
  // 衍生指纹：便于后续入库与 9:16/3:4 导出比对
  let fp = {};
  try {
    const { computeFingerprints, ensureFingerprintColumns, saveDerivativeFingerprints } = require('./fingerprint');
    ensureFingerprintColumns(db);
    if (fs.existsSync(absPath) && (mime || '').startsWith('image/')) {
      fp = await computeFingerprints(fs.readFileSync(absPath), fileName || path.basename(absPath));
    }
  } catch (e) {
    console.warn('[derivatives] fingerprint failed:', e.message);
  }

  const r = db.prepare(`
    INSERT INTO derivatives (
      asset_fid, kind, storage_type, storage_ref, file_name,
      width, height, mime, duration_s, params, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    assetFid,
    kind,
    storageType,
    storageRef,
    fileName || path.basename(absPath),
    width || null,
    height || null,
    mime,
    durationS,
    params ? JSON.stringify(params) : null,
    now
  );

  try {
    if (fp.md5 || fp.phash || fp.sha256) {
      const { saveDerivativeFingerprints } = require('./fingerprint');
      saveDerivativeFingerprints(db, r.lastInsertRowid, {
        md5: fp.md5 || null,
        sha256: fp.sha256 || null,
        phash: fp.phash || null,
      });
    }
  } catch (_) {}

  // 保证全量衍生图注册到 export_registry 并回写 derivatives 表字段
  try {
    const { registerVisibleImageHashes } = require('./export-tag');
    registerVisibleImageHashes(db, {
      filePath: absPath,
      sourceFid: assetFid,
      variant: kind,
      exportedBy: 'derivative',
    });
    if (fp.sha256 || fp.md5) {
      db.prepare('UPDATE derivatives SET sha256 = COALESCE(?, sha256), md5 = COALESCE(?, md5), phash = COALESCE(?, phash), file_size = COALESCE(?, file_size) WHERE id = ?')
        .run(fp.sha256 || null, fp.md5 || null, fp.phash || null, fs.existsSync(absPath) ? fs.statSync(absPath).size : null, r.lastInsertRowid);
    }
  } catch (_) {}

  return {
    id: r.lastInsertRowid,
    asset_fid: assetFid,
    kind,
    storage_type: storageType,
    storage_ref: storageRef,
    file_name: fileName,
    width,
    height,
    mime,
    duration_s: durationS,
    localPath: absPath,
    created_at: now,
    md5: fp.md5 || null,
    phash: fp.phash || null,
  };
}

async function ensurePreviewJpeg(services, fid, derivative, filePath) {
  const { config } = services;
  if (!filePath || !fs.existsSync(filePath)) return null;
  if ((derivative?.mime || '').includes('video') || derivative?.kind === 'gen_video') return null;
  const previewDir = path.join(config.dataDir, 'cache', 'preview');
  fs.mkdirSync(previewDir, { recursive: true });
  const dest = path.join(previewDir, `${fid}_${derivative.id}.jpg`);
  if (!fs.existsSync(dest)) {
    const sharp = require('sharp');
    await sharp(filePath, { failOn: 'none' })
      .rotate()
      .resize(1280, 1280, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 78 })
      .toFile(dest);
  }

  if (dest && fs.existsSync(dest) && services?.db) {
    // 预览图哈希登记放后台：不影响首字节返回
    setImmediate(() => {
      try {
        const { registerVisibleImageHashes } = require('./export-tag');
        const h = registerVisibleImageHashes(services.db, {
          filePath: dest,
          sourceFid: fid,
          variant: derivative?.id ? `preview_${derivative.id}` : 'preview_origin',
          exportedBy: 'preview_cache',
        });
        if (h) {
          services.db.prepare('UPDATE assets SET preview_sha256 = COALESCE(preview_sha256, ?), preview_md5 = COALESCE(preview_md5, ?) WHERE fid = ?')
            .run(h.sha256, h.md5, fid);
        }
      } catch (_) {}
    });
  }

  return dest;
}

/**
 * 网格档缩略图 (256px)：App 列表专用。
 * 相比 1280px 预览图体积约小 30 倍，列表滚动不再拉大图。
 */
async function ensureGridJpeg(services, fid, filePath, derivativeOrId) {
  const { config } = services;
  if (!fid || !filePath || !fs.existsSync(filePath)) return null;
  const gridDir = path.join(config.dataDir, 'cache', 'grid');
  fs.mkdirSync(gridDir, { recursive: true });
  const derivId = (derivativeOrId && typeof derivativeOrId === 'object') ? derivativeOrId.id : derivativeOrId;
  const destName = derivId ? `${fid}_${derivId}.jpg` : `${fid}.jpg`;
  const dest = path.join(gridDir, destName);
  if (!fs.existsSync(dest)) {
    const sharp = require('sharp');
    await sharp(filePath, { failOn: 'none' })
      .rotate()
      .resize(256, 256, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 72 })
      .toFile(dest);
  }
  return dest;
}

/** 从已有 512px thumb 派生出 256px 网格图，避免为同一素材再解一次原图 */
async function ensureGridFromThumb(thumbPath, gridPath) {
  if (!thumbPath || !fs.existsSync(thumbPath)) return null;
  if (gridPath && fs.existsSync(gridPath)) return gridPath;
  try {
    if (gridPath) fs.mkdirSync(path.dirname(gridPath), { recursive: true });
    const sharp = require('sharp');
    await sharp(thumbPath, { failOn: 'none' })
      .resize(256, 256, { fit: 'inside', withoutEnlargement: true })
      .jpeg({ quality: 72 })
      .toFile(gridPath);
    return gridPath;
  } catch (e) {
    console.warn('[derivatives] 网格档派生失败:', e && e.message);
    return null;
  }
}

/**
 * 预览档 WebP 格式 (1280px，质量 80)
 */
async function ensurePreviewWebp(services, fid, derivativeOrFilePath, maybeFilePath) {
  const { config } = services;
  let derivative = null;
  let filePath = null;
  if (typeof derivativeOrFilePath === 'string') {
    filePath = derivativeOrFilePath;
  } else {
    derivative = derivativeOrFilePath;
    filePath = maybeFilePath;
  }
  if (!filePath || !fs.existsSync(filePath)) return null;
  if ((derivative?.mime || '').includes('video') || derivative?.kind === 'gen_video') return null;
  const previewDir = path.join(config.dataDir, 'cache', 'preview');
  fs.mkdirSync(previewDir, { recursive: true });
  const destName = derivative?.id ? `${fid}_${derivative.id}.webp` : `${fid}.webp`;
  const dest = path.join(previewDir, destName);
  if (!fs.existsSync(dest)) {
    const sharp = require('sharp');
    await sharp(filePath, { failOn: 'none' })
      .rotate()
      .resize(1280, 1280, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 80 })
      .toFile(dest);
  }
  return dest;
}

/**
 * 网格档 WebP (256px，质量 75)：App / 现代浏览器专用
 */
async function ensureGridWebp(services, fid, filePath, derivativeOrId) {
  const { config } = services;
  if (!fid || !filePath || !fs.existsSync(filePath)) return null;
  const gridDir = path.join(config.dataDir, 'cache', 'grid');
  fs.mkdirSync(gridDir, { recursive: true });
  const derivId = (derivativeOrId && typeof derivativeOrId === 'object') ? derivativeOrId.id : derivativeOrId;
  const destName = derivId ? `${fid}_${derivId}.webp` : `${fid}.webp`;
  const dest = path.join(gridDir, destName);
  if (!fs.existsSync(dest)) {
    const sharp = require('sharp');
    await sharp(filePath, { failOn: 'none' })
      .rotate()
      .resize(256, 256, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 75 })
      .toFile(dest);
  }
  return dest;
}

/** 从已有 512px thumb 或 256px jpeg 派生出 256px webp 网格图 */
async function ensureGridWebpFromThumb(sourcePath, webpPath) {
  if (!sourcePath || !fs.existsSync(sourcePath)) return null;
  if (webpPath && fs.existsSync(webpPath)) return webpPath;
  try {
    if (webpPath) fs.mkdirSync(path.dirname(webpPath), { recursive: true });
    const sharp = require('sharp');
    await sharp(sourcePath, { failOn: 'none' })
      .resize(256, 256, { fit: 'inside', withoutEnlargement: true })
      .webp({ quality: 75 })
      .toFile(webpPath);
    return webpPath;
  } catch (e) {
    console.warn('[derivatives] WebP 网格档派生失败:', e && e.message);
    return null;
  }
}


async function resolveDerivativeFile(services, derivative) {
  const { config } = services;
  if (!derivative) return null;

  if (derivative.storage_type === 'nas') {
    const { nasMaterialDir } = require('./nasstore');
    const abs = path.isAbsolute(derivative.storage_ref)
      ? derivative.storage_ref
      : path.join(nasMaterialDir(config), derivative.storage_ref);
    if (fs.existsSync(abs)) return abs;
  }

  if (derivative.storage_type === 'local_cache') {
    const abs = path.isAbsolute(derivative.storage_ref)
      ? derivative.storage_ref
      : path.join(config.dataDir, derivative.storage_ref);
    if (fs.existsSync(abs)) return abs;
  }

  if (derivative.storage_type === 'quark') {
    // NAS 本地库优先
    try {
      const { findNasOriginal, nasOriginalPath } = require('./nasstore');
      const nasHit = findNasOriginal(config, derivative.asset_fid);
      if (nasHit && fs.existsSync(nasHit)) return nasHit;
    } catch {}

    // 检查本地 originals 缓存
    const origDir = path.join(config.dataDir, 'cache', 'originals');
    fs.mkdirSync(origDir, { recursive: true });
    const ext = path.extname(derivative.file_name || '.jpg') || '.jpg';
    const localCached = path.join(origDir, `${derivative.asset_fid}${ext}`);
    if (fs.existsSync(localCached)) return localCached;

    const altCached = path.join(origDir, `${derivative.asset_fid}_${derivative.file_name || 'image.jpg'}`);
    if (fs.existsSync(altCached)) return altCached;

    // 任意以 fid 开头的本地文件（下载工具命名不一致时）
    try {
      const prefix = String(derivative.asset_fid).slice(0, 32);
      const hit = fs.readdirSync(origDir).find(f => f.includes(prefix));
      if (hit) return path.join(origDir, hit);
    } catch {}

    // 优先用同资产已落地的 local_cache 衍生图，避免现场拉夸克
    try {
      const { db } = services;
      const local = db.prepare(`
        SELECT storage_ref FROM derivatives
        WHERE asset_fid=? AND storage_type='local_cache' AND storage_ref IS NOT NULL
        ORDER BY id DESC LIMIT 1
      `).get(derivative.asset_fid);
      if (local?.storage_ref) {
        const abs = path.isAbsolute(local.storage_ref)
          ? local.storage_ref
          : path.join(config.dataDir, local.storage_ref);
        if (fs.existsSync(abs)) return abs;
      }
    } catch {}

    // 未命中则下载到本地（优先 NAS，不可用则落到 cache/originals）
    const { nasOriginalPath, nasAvailable } = require('./nasstore');
    const destDir = nasAvailable()
      ? path.dirname(nasOriginalPath(config, derivative.asset_fid, derivative.file_name || 'image.jpg'))
      : origDir;
    const destPath = path.join(destDir, `${derivative.asset_fid}${ext}`);

    fs.mkdirSync(destDir, { recursive: true });
    const quark = new Quark(config.cliPath);
    const dl = await quark.download(derivative.storage_ref, destDir);
    const downloaded = path.join(destDir, dl.fileName || path.basename(destPath));
    if (fs.existsSync(downloaded) && path.resolve(downloaded) !== path.resolve(destPath)) {
      try { fs.renameSync(downloaded, destPath); } catch {}
    }
    const finalPath = fs.existsSync(destPath) ? destPath : (fs.existsSync(downloaded) ? downloaded : null);
    if (finalPath) return finalPath;
  }

  return null;
}

module.exports = {
  getDerivatives,
  getDerivativeById,
  setMainDerivative,
  markKindRecast,
  createDerivative,
  resolveDerivativeFile,
  ensurePreviewJpeg,
  ensureGridJpeg,
  ensureGridFromThumb,
  ensurePreviewWebp,
  ensureGridWebp,
  ensureGridWebpFromThumb
};

