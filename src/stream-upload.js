/**
 * 流式直传与大文件分片服务 (Stream & Chunked Upload to NAS)
 * - 纯流式管道传输，单文件支持数 GB 大视频，杜绝内存溢出 (OOM)；
 * - 自动按时间线归档至 NAS /mnt/synology/material/YYYY/MM/；
 * - 自动生成缩略图：sharp（图片）、ffmpeg（视频截取封面）；
 * - 自动入库与派发 AI 解释器打标。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');
const sharp = require('sharp');
const { nasDateOriginalPath, createNasWriteStream, nasMaterialDir } = require('./nasstore');
const { createDerivative, setMainDerivative } = require('./derivatives');
const { calculateOriginOrientation } = require('./ratio');

const VIDEO_EXTS = new Set(['.mp4', '.mov', '.avi', '.mkv', '.webm', '.m4v', '.3gp', '.wmv', '.flv']);
const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif', '.bmp', '.gif', '.tiff']);

function isVideoFile(fileName) {
  const ext = (path.extname(fileName || '') || '').toLowerCase();
  return VIDEO_EXTS.has(ext);
}

function getChunkDir(config, uploadId) {
  const safeId = String(uploadId).replace(/[^a-zA-Z0-9_-]/g, '_');
  const d = path.join(config.dataDir, 'cache', 'upload_chunks', safeId);
  fs.mkdirSync(d, { recursive: true });
  return d;
}

/**
 * 抽取视频第一秒海报帧
 */
function extractVideoThumbnail(videoPath, thumbPath) {
  return new Promise((resolve) => {
    fs.mkdirSync(path.dirname(thumbPath), { recursive: true });
    // 先尝试 -ss 00:00:01，若视频极短则可能在 0 秒
    const ff = spawn('ffmpeg', [
      '-y',
      '-ss', '00:00:01',
      '-i', videoPath,
      '-vframes', '1',
      '-q:v', '2',
      thumbPath
    ]);

    ff.on('close', (code) => {
      if (code === 0 && fs.existsSync(thumbPath) && fs.statSync(thumbPath).size > 0) {
        return resolve(true);
      }
      // 重试从 0 秒提取
      const ffRetry = spawn('ffmpeg', [
        '-y',
        '-ss', '00:00:00',
        '-i', videoPath,
        '-vframes', '1',
        '-q:v', '2',
        thumbPath
      ]);
      ffRetry.on('close', (c2) => {
        resolve(c2 === 0 && fs.existsSync(thumbPath) && fs.statSync(thumbPath).size > 0);
      });
      ffRetry.on('error', () => resolve(false));
    });

    ff.on('error', (err) => {
      console.warn('[stream-upload] ffmpeg 未安装或启动失败，视频封面待后续补充:', err.message);
      resolve(false);
    });
  });
}

/**
 * 流式接收文件并同时计算 SHA-256，写入临时文件
 */
function streamToTempFile(readableStream, tempPath) {
  return new Promise((resolve, reject) => {
    fs.mkdirSync(path.dirname(tempPath), { recursive: true });
    const writeStream = fs.createWriteStream(tempPath);
    const hash = crypto.createHash('sha256');
    let totalBytes = 0;

    readableStream.on('data', (chunk) => {
      hash.update(chunk);
      totalBytes += chunk.length;
    });

    readableStream.pipe(writeStream);

    writeStream.on('finish', () => {
      resolve({
        sha256: hash.digest('hex'),
        size: totalBytes
      });
    });

    writeStream.on('error', (err) => {
      try { fs.unlinkSync(tempPath); } catch {}
      reject(err);
    });

    readableStream.on('error', (err) => {
      try { fs.unlinkSync(tempPath); } catch {}
      reject(err);
    });
  });
}

/**
 * 将已落盘的媒体文件入库、生成缩略图、注册衍生图并触发工作流
 */
async function registerMediaAsset(services, {
  filePath,
  fileName,
  sha256,
  size,
  dateModified = null,
  clientAssetId = null,
  clientThumbBuffer = null,
  source = 'sync',
  category = null,
  manualTags = null,
  shelf = null
}) {
  const { db, config, logger, interpreter } = services;
  const isVideo = isVideoFile(fileName);
  const fid = `local_${sha256.slice(0, 24)}`;
  const now = Date.now();

  // 0. 全局黑名单：用户已删除的素材禁止再次入库
  try {
    const { isBlacklisted, itemKeyOf } = require('./assets-delete');
    if (isBlacklisted(db, { sha256, itemKey: itemKeyOf(fileName, size), clientAssetId })) {
      logger?.info?.(`[stream-upload] 黑名单拦截 sha=${sha256.slice(0, 12)} name=${fileName}`);
      try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (_) {}
      const err = new Error('该素材已被删除并加入黑名单，拒绝入库');
      err.code = 'blacklisted';
      throw err;
    }
  } catch (e) {
    if (e.code === 'blacklisted') throw e;
  }

  // 0a. 非室内素材/截图 UI
  {
    const fn = String(fileName || '');
    if (/^(screen[_-]|current_screen|install_ui)/i.test(fn) || /^Screenshot_/i.test(fn) || /_emu\.png$/i.test(fn)) {
      logger?.info?.(`[stream-upload] 非室内/UI 截图拒绝入库 name=${fileName}`);
      try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (_) {}
      const err = new Error('截图/UI 素材，拒绝入库');
      err.code = 'non_interior_ui';
      throw err;
    }
  }
  // 0b. 导出标记（MLX1）：本端保存到相册的文件，拒绝再次入库
  try {
    const { extractExportTag } = require('./export-tag');
    const fd = fs.openSync(filePath, 'r');
    let tagBuf;
    try {
      tagBuf = Buffer.alloc(Math.min(65536, size || 65536));
      fs.readSync(fd, tagBuf, 0, tagBuf.length, 0);
    } finally {
      fs.closeSync(fd);
    }
    const tag = extractExportTag(tagBuf);
    if (tag && (tag.fid || tag.kind)) {
      logger?.info?.(`[stream-upload] 导出标记拦截 name=${fileName} fid=${tag.fid || ''} kind=${tag.kind || ''}`);
      try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (_) {}
      const err = new Error('本端导出件，拒绝重复入库');
      err.code = 'export_tag';
      throw err;
    }
  } catch (e) {
    if (e.code === 'export_tag') throw e;
  }

  // 0c. ML_SAVED_ 文件名识别拦截（本端保存素材）
  if (/^ML_SAVED_/i.test(String(fileName || ''))) {
    logger?.info?.(`[stream-upload] ML_SAVED_ 文件名拦截 name=${fileName}`);
    try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (_) {}
    const err = new Error('本端导出件（文件名包含 ML_SAVED_），拒绝重复入库');
    err.code = 'export_saved_name';
    throw err;
  }

  // 0d. 检查 export_registry、预览图/缩略图以及全部衍生图绝对哈希
  try {
    const regHit = db.prepare('SELECT source_fid, variant FROM export_registry WHERE sha256 = ? OR (md5 IS NOT NULL AND md5 = ?) LIMIT 1').get(sha256, sha256);
    if (regHit) {
      logger?.info?.(`[stream-upload] export_registry 绝对查重拦截 sha=${sha256.slice(0, 12)} fid=${regHit.source_fid}`);
      try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (_) {}
      return { fid: regHit.source_fid, deduped: true, reason: 'export_registry', sha256, matchedKind: regHit.variant };
    }

    const derivHit = db.prepare('SELECT asset_fid, kind FROM derivatives WHERE sha256 = ? OR (md5 IS NOT NULL AND md5 = ?) LIMIT 1').get(sha256, sha256);
    if (derivHit) {
      logger?.info?.(`[stream-upload] 衍生图绝对查重拦截 sha=${sha256.slice(0, 12)} fid=${derivHit.asset_fid}`);
      try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (_) {}
      return { fid: derivHit.asset_fid, deduped: true, reason: 'duplicate_of_derivative', sha256, matchedKind: derivHit.kind };
    }

    const visHit = db.prepare('SELECT fid FROM assets WHERE preview_sha256 = ? OR preview_md5 = ? OR thumb_sha256 = ? OR thumb_md5 = ? LIMIT 1').get(sha256, sha256, sha256, sha256);
    if (visHit) {
      logger?.info?.(`[stream-upload] 可见缓存图绝对查重拦截 sha=${sha256.slice(0, 12)} fid=${visHit.fid}`);
      try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (_) {}
      return { fid: visHit.fid, deduped: true, reason: 'visible_cache_duplicate', sha256 };
    }
  } catch (_) {}

  // 1. 去重检查：若同 sha256 已存在，直接返回
  try {
    const { findExportBySha } = require('./export-registry');
    const exp = findExportBySha(db, sha256);
    if (exp) {
      logger?.info?.(`[stream-upload] 导出登记拦截 sha=${String(sha256).slice(0, 12)} fid=${exp.source_fid || ''}`);
      try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (_) {}
      const err = new Error('本端导出件，拒绝重复入库');
      err.code = 'export_registry';
      throw err;
    }
  } catch (e) {
    if (e.code === 'export_registry') throw e;
  }
  const existing = db.prepare('SELECT fid, client_asset_id FROM assets WHERE sha256 = ?').get(sha256);
  // 1b. 指纹去重（MD5 + pHash），覆盖已在库的 9:16/3:4 衍生
  let streamFp = null;
  if (!existing && !isVideo) {
    try {
      const fpApi = require('./fingerprint');
      fpApi.ensureFingerprintColumns(db);
      const buf = fs.readFileSync(filePath);
      streamFp = await fpApi.computeFingerprints(buf, fileName);
      const fpHit = fpApi.findFingerprintHit(
        db,
        { md5: streamFp.md5, sha256: streamFp.sha256, phash: streamFp.phash },
        { exactOnly: true }
      );
      if (fpHit && fpHit.hit) {
        logger?.info?.(`[stream-upload] 指纹命中跳过入库 ${fpHit.reason} → ${fpHit.fid} (${fpHit.kind || ''})`);
        try { if (fs.existsSync(filePath)) fs.unlinkSync(filePath); } catch (_) {}
        return {
          fid: fpHit.fid,
          deduped: true,
          reason: fpHit.reason,
          derivativeId: fpHit.derivativeId || null,
          sha256,
          matchedKind: fpHit.kind || null,
        };
      }
    } catch (e) {
      logger?.warn?.(`[stream-upload] fingerprint check failed: ${e.message}`);
    }
  }
  if (existing) {
    logger?.info?.(`[stream-upload] 资产已存在，直接复用 fid: ${existing.fid}`);
    // 补齐同哈希副本别名记录，终结快照对账循环重传
    try {
      const aliasKey = `${fileName}|${size}`;
      db.prepare(`
        INSERT OR IGNORE INTO asset_aliases (fid, item_key, client_asset_id, file_name, size, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(existing.fid, aliasKey, clientAssetId || null, fileName, size, now);

      if (!existing.client_asset_id && clientAssetId) {
        db.prepare('UPDATE assets SET client_asset_id = ? WHERE fid = ?').run(clientAssetId, existing.fid);
      }
    } catch (e) {
      logger?.warn?.(`[stream-upload] 登记别名警告: ${e.message}`);
    }

    // 关键：立即清理临时文件，杜绝磁盘泄漏
    try {
      if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
    } catch (_) {}

    return { fid: existing.fid, deduped: true, sha256 };
  }

  // 2. 年月归档路径
  const nasInfo = nasDateOriginalPath(config, {
    fileName,
    date: dateModified || now,
    hash: sha256
  });

  // 如果当前文件不在目标 NAS 路径，移动/复制过去
  if (path.resolve(filePath) !== path.resolve(nasInfo.fullPath)) {
    try {
      fs.renameSync(filePath, nasInfo.fullPath);
    } catch {
      fs.copyFileSync(filePath, nasInfo.fullPath);
      try { fs.unlinkSync(filePath); } catch {}
    }
  }

  const thumbsDir = path.join(config.dataDir, 'cache', 'thumbs');
  fs.mkdirSync(thumbsDir, { recursive: true });
  const thumbPath = path.join(thumbsDir, `${fid}.jpg`);

  let width = null;
  let height = null;
  let orientation = null;

  if (isVideo) {
    // 优先使用前端上传的客户端本地快速缩略图
    if (clientThumbBuffer && clientThumbBuffer.length > 0) {
      try {
        await sharp(clientThumbBuffer).jpeg({ quality: 80 }).toFile(thumbPath);
      } catch {}
    }
    // 若尚未生成缩略图，调用 ffmpeg 截取
    if (!fs.existsSync(thumbPath)) {
      await extractVideoThumbnail(nasInfo.fullPath, thumbPath);
    }
  } else {
    // 图片文件：读取 metadata 并生成 512 缩略图
    try {
      const imgInstance = sharp(nasInfo.fullPath, { failOn: 'none' }).rotate();
      const meta = await imgInstance.metadata();
      width = meta.width || null;
      height = meta.height || null;
      if (width && height) {
        orientation = height > width * 1.05 ? 'portrait' : (width > height * 1.05 ? 'landscape' : 'square');
      }
      // 生成缩略图
      await imgInstance
        .resize(512, 512, { fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 82 })
        .toFile(thumbPath);
    } catch (e) {
      logger?.warn?.(`[stream-upload] sharp 生成缩略图异常: ${e.message}`);
      if (clientThumbBuffer) {
        try { fs.writeFileSync(thumbPath, clientThumbBuffer); } catch {}
      }
    }
  }

  const originOrientation = calculateOriginOrientation(width, height);
  const mediaKind = isVideo ? 'video' : 'image';
  const takenAt = dateModified ? (Number(dateModified) < 1e12 ? Number(dateModified) * 1000 : Number(dateModified)) : now;
  const isDirectAppUpload = source === 'app_upload' || source === 'manual' || source === 'upload';
  const { normalizeCategory } = require('./gate-route');
  const normalizedCategory = normalizeCategory(category);
  const targetCategory = isVideo
    ? 'video'
    : (normalizedCategory && normalizedCategory !== 'none' ? normalizedCategory : 'interior');
  const isFinished = targetCategory === 'finished';
  const initialStatus = (isVideo || isDirectAppUpload || isFinished) ? 'ready' : 'discovered';

  // 3. 写入 assets 表
  db.prepare(`
    INSERT INTO assets (
      fid, kind, category, file_name, size, width, height, orientation, origin_orientation,
      status, source, sha256, client_asset_id, thumb_url,
      auth_state, auth_matched_at,
      created_at, discovered_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'live', ?, ?, ?, ?)
    ON CONFLICT(fid) DO UPDATE SET
      category=COALESCE(excluded.category, assets.category),
      file_name=excluded.file_name, size=excluded.size,
      status=CASE WHEN excluded.status='ready' THEN 'ready' ELSE assets.status END,
      updated_at=excluded.updated_at
  `).run(
    fid,
    mediaKind,
    targetCategory,
    nasInfo.fileName,
    size,
    width,
    height,
    orientation,
    originOrientation,
    initialStatus,
    source,
    sha256,
    clientAssetId || null,
    `/api/thumbs/${fid}.jpg`,
    now,
    takenAt,
    now,
    now
  );


  // 4. 插入 derivatives 表
  const ext = (path.extname(nasInfo.fileName) || '').toLowerCase();
  const mime = isVideo ? `video/${ext.slice(1) || 'mp4'}` : (ext === '.png' ? 'image/png' : 'image/jpeg');

  const deriv = await createDerivative(services, {
    assetFid: fid,
    kind: 'origin',
    srcPath: null, // 已在 NAS
    fileName: nasInfo.fileName,
    width,
    height,
    mime,
    params: { source, sha256, path: nasInfo.relPath }
  });

  // 设置存储类型为 nas，storage_ref 存相对路径（如 2026/09/xxx.jpg）
  db.prepare("UPDATE derivatives SET storage_type='nas', storage_ref=? WHERE id=?")
    .run(nasInfo.relPath, deriv.id);
  setMainDerivative(db, fid, deriv.id);

  // 写入指纹（md5/phash），供后续入库与衍生对照
  try {
    if (streamFp) {
      const fpApi = require('./fingerprint');
      fpApi.saveAssetFingerprints(db, fid, {
        md5: streamFp.md5,
        sha256,
        phash: streamFp.phash,
      });
      fpApi.saveDerivativeFingerprints(db, deriv.id, {
        md5: streamFp.md5,
        sha256,
        phash: streamFp.phash,
      });
    }
  } catch (e) {
    logger?.warn?.(`[stream-upload] save fingerprints failed: ${e.message}`);
  }

  // 记录主别名及原始文件名映射
  try {
    const mainKey = `${nasInfo.fileName}|${size}`;
    db.prepare(`
      INSERT OR IGNORE INTO asset_aliases (fid, item_key, client_asset_id, file_name, size, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run(fid, mainKey, clientAssetId || null, nasInfo.fileName, size, now);

    if (fileName && fileName !== nasInfo.fileName) {
      const rawKey = `${fileName}|${size}`;
      db.prepare(`
        INSERT OR IGNORE INTO asset_aliases (fid, item_key, client_asset_id, file_name, size, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(fid, rawKey, clientAssetId || null, fileName, size, now);
    }
  } catch (_) {}

  // 4b. 手动标签录入（若有）
  if (manualTags && !isFinished) {
    try {
      let tagObj = typeof manualTags === 'string' ? JSON.parse(manualTags) : manualTags;
      if (typeof tagObj === 'object' && tagObj !== null) {
        for (const [dim, val] of Object.entries(tagObj)) {
          if (!val) continue;
          const vals = Array.isArray(val) ? val : [val];
          for (const v of vals) {
            const row = db.prepare('SELECT id, dir, label FROM tag_dict WHERE dimension=? AND (dir=? OR label=?)').get(dim, v, v);
            if (row) {
              db.prepare(`
                INSERT INTO asset_tags (asset_fid, tag_id, source, confidence, updated_at)
                VALUES (?, ?, 'human', 1.0, ?)
                ON CONFLICT(asset_fid, tag_id, role) DO UPDATE SET source='human', confidence=1.0, updated_at=excluded.updated_at
              `).run(fid, row.id, Date.now());
            }
          }
        }
      }
    } catch (e) {
      logger?.warn?.(`[stream-upload] 手动打标解析异常: ${e.message}`);
    }
  }

  // 视频、用户App主动上传或成品库：立即标记为 ready 可浏览（否则停在 discovered 等待AI打标）
  if (isVideo || isDirectAppUpload || isFinished) {
    db.prepare(`
      UPDATE assets SET status='ready', updated_at=? WHERE fid=?
    `).run(Date.now(), fid);
  }

  // 货架归属：编辑器导出/备份等入口通过 shelf 直接指定成品库等货架
  const shelfName = ['original', 'retouched', 'finished'].includes(String(shelf || ''))
    ? String(shelf)
    : null;
  if (shelfName) {
    try {
      db.prepare('UPDATE assets SET library_shelf=?, updated_at=? WHERE fid=?')
        .run(shelfName, Date.now(), fid);
    } catch (e) {
      logger?.warn?.(`[stream-upload] 写入货架失败: ${e.message}`);
    }
  }

  // 5. 触发 AI 工作流解释器（成品库不打标）
  let queued = null;
  if (interpreter && !isVideo && !isFinished) {
    try {
      queued = await interpreter.triggerRun({
        workflowId: 'default',
        assetFids: [fid],
        trigger: manualTags ? `sync:${source}:manual` : `sync:${source}`
      });
    } catch (e) {
      logger?.warn?.(`[stream-upload] 触发打标工作流跳过: ${e.message}`);
    }
  }

  return {
    fid,
    deduped: false,
    mediaKind,
    fileName: nasInfo.fileName,
    nasPath: nasInfo.fullPath,
    relPath: nasInfo.relPath,
    size,
    sha256,
    derivativeId: deriv.id,
    queued
  };
}

/**
 * 处理单文件直传（octet-stream 或 multipart/form-data）
 */
async function handleDirectUpload(services, req, {
  fileName = '',
  dateModified = null,
  clientAssetId = null,
  clientThumbBuffer = null,
  source = 'sync',
  shelf = null
} = {}) {
  const { config } = services;
  const ct = (req && req.headers && req.headers['content-type']) || '';
  const tempDir = path.join(config.dataDir, 'cache', 'temp_upload');
  fs.mkdirSync(tempDir, { recursive: true });
  const tempFile = path.join(tempDir, `tmp_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`);

  let targetFileName = fileName || (req && req.headers && req.headers['x-filename']) || 'upload.jpg';
  let targetDateModified = dateModified || (req && req.headers && req.headers['x-date-modified']) || null;
  let targetClientAssetId = clientAssetId || (req && req.headers && req.headers['x-client-asset-id']) || null;
  let targetThumbBuffer = clientThumbBuffer || null;
  let targetSource = source || (req && req.headers && req.headers['x-source']) || 'sync';
  let targetCategory = (req && req.headers && req.headers['x-category']) || null;
  let targetManualTags = (req && req.headers && req.headers['x-manual-tags']) || null;
  let targetShelf = (req && req.headers && req.headers['x-shelf']) || null;


  let sha256 = '';
  let size = 0;

  if (ct.includes('multipart/form-data')) {
    const { parseMultipart, readRequestBuffer } = require('./ingest');
    // 最大单次 multipart 2048MB (2GB)，支持手机直接直传超大高清视频
    const buf = await readRequestBuffer(req, 2048 * 1024 * 1024);
    const { fields, files } = parseMultipart(buf, ct);
    const file = files.find(f => f.name === 'file') || files[0];
    if (!file) throw new Error('缺少 file 字段');

    targetFileName = file.filename || fields.filename || targetFileName;
    if (fields.date_modified || fields.taken_at) {
      targetDateModified = fields.date_modified || fields.taken_at;
    }
    if (fields.client_asset_id) {
      targetClientAssetId = fields.client_asset_id;
    }
    if (fields.source) {
      targetSource = fields.source;
    }
    if (fields.category) {
      targetCategory = fields.category;
    }
    if (fields.manual_tags) {
      targetManualTags = fields.manual_tags;
    }
    if (fields.shelf) {
      targetShelf = fields.shelf;
    }
    fs.writeFileSync(tempFile, file.data);
    sha256 = crypto.createHash('sha256').update(file.data).digest('hex');
    size = file.data.length;

    const thumbFile = files.find(f => f.name === 'thumb');
    if (thumbFile) {
      targetThumbBuffer = thumbFile.data;
    }
  } else {
    // 流式处理 application/octet-stream 或 image/* 或 video/*
    const streamRes = await streamToTempFile(req, tempFile);
    sha256 = streamRes.sha256;
    size = streamRes.size;
  }

  // 解码 URI 编码文件名
  try { targetFileName = decodeURIComponent(targetFileName); } catch {}

  try {
    return await registerMediaAsset(services, {
      filePath: tempFile,
      fileName: targetFileName,
      sha256,
      size,
      dateModified: targetDateModified,
      clientAssetId: targetClientAssetId,
      clientThumbBuffer: targetThumbBuffer,
      source: targetSource,
      category: targetCategory,
      manualTags: targetManualTags,
      shelf: targetShelf
    });
  } finally {
    try {
      if (fs.existsSync(tempFile)) fs.unlinkSync(tempFile);
    } catch (_) {}
  }
}

/**
 * 接收大文件单个分片
 */
async function handleChunkUpload(services, req, {
  uploadId,
  chunkIndex,
  totalChunks
}) {
  const { config } = services;
  if (!uploadId || chunkIndex === undefined || chunkIndex === null || chunkIndex === '' || !totalChunks) {
    throw new Error('缺少 uploadId、chunkIndex 或 totalChunks 参数');
  }

  const chunkDir = getChunkDir(config, uploadId);
  const chunkFile = path.join(chunkDir, `part_${String(chunkIndex).padStart(6, '0')}`);

  const ct = (req && req.headers && req.headers['content-type']) || '';
  if (ct.includes('multipart/form-data')) {
    // uni.uploadFile 始终以 multipart 提交分片
    const { parseMultipart, readRequestBuffer } = require('./ingest');
    const buf = await readRequestBuffer(req, 64 * 1024 * 1024);
    const { files } = parseMultipart(buf, ct);
    const file = files.find(f => f.name === 'file') || files[0];
    if (!file || !file.data) throw new Error('缺少分片数据');
    fs.writeFileSync(chunkFile, file.data);
  } else {
    await new Promise((resolve, reject) => {
      const ws = fs.createWriteStream(chunkFile);
      req.pipe(ws);
      ws.on('finish', resolve);
      ws.on('error', reject);
      req.on('error', reject);
    });
  }

  const parts = fs.readdirSync(chunkDir).filter(f => f.startsWith('part_'));

  return {
    uploadId,
    chunkIndex: Number(chunkIndex),
    totalChunks: Number(totalChunks),
    receivedChunks: parts.length
  };
}

/**
 * 完成大文件所有分片并合并写入 NAS
 */
async function handleCompleteChunkUpload(services, {
  uploadId,
  fileName,
  totalChunks,
  dateModified = null,
  clientAssetId = null,
  source = 'sync'
}) {
  const { config } = services;
  const chunkDir = getChunkDir(config, uploadId);
  const parts = fs.readdirSync(chunkDir).filter(f => f.startsWith('part_')).sort();

  if (parts.length < Number(totalChunks)) {
    throw new Error(`分片不完整：已收到 ${parts.length}/${totalChunks}`);
  }

  const tempDir = path.join(config.dataDir, 'cache', 'temp_upload');
  fs.mkdirSync(tempDir, { recursive: true });
  const mergedPath = path.join(tempDir, `merged_${uploadId}_${Date.now()}`);

  const hash = crypto.createHash('sha256');
  let totalSize = 0;
  const outWs = fs.createWriteStream(mergedPath);

  for (const part of parts) {
    const partPath = path.join(chunkDir, part);
    const buf = fs.readFileSync(partPath);
    hash.update(buf);
    totalSize += buf.length;
    outWs.write(buf);
  }

  await new Promise((resolve) => outWs.end(resolve));

  const sha256 = hash.digest('hex');

  // 清理临时分片
  try {
    for (const part of parts) {
      fs.unlinkSync(path.join(chunkDir, part));
    }
    fs.rmdirSync(chunkDir);
  } catch {}

  return await registerMediaAsset(services, {
    filePath: mergedPath,
    fileName,
    sha256,
    size: totalSize,
    dateModified,
    clientAssetId,
    source
  });
}

module.exports = {
  handleDirectUpload,
  handleChunkUpload,
  handleCompleteChunkUpload,
  registerMediaAsset,
  extractVideoThumbnail
};
