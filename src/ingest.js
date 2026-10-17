/**
 * 直连入库：浏览器 / 鸿蒙把原文件交给服务端，不再经过夸克。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
const { createDerivative, setMainDerivative } = require('./derivatives');
const { originalsDir } = require('./originals');
const { calculateOriginOrientation } = require('./ratio');

const MAX_BYTES = 80 * 1024 * 1024;
const ALLOWED = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif', '.bmp']);

function getBackupSettings(db, config) {
  let raw = {};
  try {
    raw = JSON.parse(db.prepare("SELECT value FROM kv WHERE key='backup_settings'").get()?.value || '{}');
  } catch {
    raw = {};
  }
  const quarkFid = raw.quarkFid != null ? String(raw.quarkFid).trim() : '';
  return {
    nasDir: raw.nasDir || '',
    quarkFid,
    enabled: raw.enabled !== false,
    effectiveQuarkFid: quarkFid || config?.systemFid || config?.rootFid || ''
  };
}

function resolveQuarkBackupFid(settings, config) {
  return (settings?.quarkFid || '').trim() || config?.systemFid || config?.rootFid || '';
}

function saveBackupSettings(db, patch, config) {
  const cur = getBackupSettings(db, config);
  const stored = {
    nasDir: patch.nasDir != null ? String(patch.nasDir).trim() : (cur.nasDir || ''),
    quarkFid: patch.quarkFid != null ? String(patch.quarkFid).trim() : (cur.quarkFid || ''),
    enabled: patch.enabled != null ? !!patch.enabled : (cur.enabled !== false)
  };
  db.prepare(`
    INSERT INTO kv (key, value) VALUES ('backup_settings', ?)
    ON CONFLICT(key) DO UPDATE SET value = excluded.value
  `).run(JSON.stringify(stored));
  return getBackupSettings(db, config);
}

function parseMultipart(buffer, contentType) {
  const m = String(contentType || '').match(/boundary=(?:"([^"]+)"|([^;]+))/i);
  if (!m) throw new Error('缺少 multipart boundary');
  const boundary = Buffer.from('--' + (m[1] || m[2]).trim());
  const fields = {};
  const files = [];
  let start = buffer.indexOf(boundary);
  while (start >= 0) {
    const after = start + boundary.length;
    if (buffer[after] === 0x2d && buffer[after + 1] === 0x2d) break;
    const next = buffer.indexOf(boundary, after);
    if (next < 0) break;
    let hs = after;
    if (buffer[hs] === 0x0d && buffer[hs + 1] === 0x0a) hs += 2;
    const headerEnd = buffer.indexOf(Buffer.from('\r\n\r\n'), hs);
    if (headerEnd < 0 || headerEnd > next) {
      start = next;
      continue;
    }
    const header = buffer.slice(hs, headerEnd).toString('utf8');
    let bodyEnd = next;
    if (bodyEnd >= 2 && buffer[bodyEnd - 2] === 0x0d && buffer[bodyEnd - 1] === 0x0a) bodyEnd -= 2;
    const body = buffer.slice(headerEnd + 4, bodyEnd);
    const nameM = header.match(/name="([^"]+)"/i);
    const fileM = header.match(/filename="([^"]*)"/i);
    const ctM = header.match(/Content-Type:\s*([^\r\n]+)/i);
    const name = nameM?.[1] || '';
    if (fileM) {
      files.push({ name, filename: fileM[1], mime: (ctM?.[1] || '').trim(), data: body });
    } else {
      fields[name] = body.toString('utf8');
    }
    start = next;
  }
  return { fields, files };
}

function readRequestBuffer(req, limit = MAX_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let rejected = false;
    req.on('data', c => {
      if (rejected) return;
      size += c.length;
      if (size > limit) {
        rejected = true;
        const mb = Math.round(limit / (1024 * 1024));
        reject(new Error(`上传文件体积超过限制 (${mb}MB)`));
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      if (!rejected) resolve(Buffer.concat(chunks));
    });
    req.on('error', err => {
      if (!rejected) reject(err);
    });
  });
}

async function normalizeImageBuffer(buffer, fileName) {
  const ext = path.extname(fileName || '').toLowerCase();
  if (ext === '.heic' || ext === '.heif') {
    const out = await sharp(buffer, { failOn: 'none' }).rotate().jpeg({ quality: 92 }).toBuffer();
    return { buffer: out, fileName: path.basename(fileName, ext) + '.jpg', mime: 'image/jpeg' };
  }
  return {
    buffer,
    fileName: fileName || 'image.jpg',
    mime: ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg'
  };
}

async function ingestBuffer(services, {
  buffer,
  fileName,
  source = 'upload',
  clientAssetId = null,
  takenAt = null,
  category = null,
  manualTags = null,
  shelf = null
}) {
  const { db, config, interpreter } = services;
  if (!buffer || !buffer.length) throw new Error('空文件');

  const ext = path.extname(fileName || '.jpg').toLowerCase() || '.jpg';
  if (!ALLOWED.has(ext)) throw new Error(`不支持的文件类型: ${ext}`);

  const sha = crypto.createHash('sha256').update(buffer).digest('hex');
  const clientId = clientAssetId ? String(clientAssetId).trim() : '';
  if (clientId) {
    const hit = db.prepare('SELECT fid FROM assets WHERE client_asset_id = ?').get(clientId);
    if (hit) return { fid: hit.fid, deduped: true, reason: 'client_asset_id' };
  }
  const shaHit = db.prepare('SELECT fid FROM assets WHERE sha256 = ?').get(sha);
  if (shaHit) return { fid: shaHit.fid, deduped: true, reason: 'sha256' };
  try {
    const { findExportBySha } = require('./export-registry');
    const exp = findExportBySha(db, sha);
    if (exp) {
      return {
        fid: exp.source_fid || '',
        deduped: true,
        rejected: true,
        reason: 'export_registry',
      };
    }
  } catch (e) {
    console.warn('[ingest] export registry check failed:', e.message);
  }

  const isDirectUpload = source !== 'auto_sync';
  const { normalizeCategory } = require('./gate-route');
  const normalizedCategory = normalizeCategory(category);
  const targetCategory = normalizedCategory && normalizedCategory !== 'none' ? normalizedCategory : 'interior';
  const isFinished = targetCategory === 'finished';
  const initialStatus = isFinished ? 'ready' : 'discovered';

  // 非室内素材/截图 UI：自动同步时直接拒绝入库（手动直传及成品库不拦截）
  if (!isDirectUpload) {
    const fn = String(fileName || '');
    if (/^(screen[_-]|current_screen|install_ui)/i.test(fn) ||
        /^Screenshot_/i.test(fn) ||
        /_emu\.png$/i.test(fn)) {
      return {
        fid: '',
        deduped: true,
        reason: 'non_interior_ui',
        rejected: true,
      };
    }
  }
  // 导出标记：本端保存到相册的 MLX1|* 文件，禁止再入库
  try {
    const { extractExportTag } = require('./export-tag');
    const tag = extractExportTag(buffer);
    if (tag && (tag.fid || tag.kind)) {
      const target = tag.fid || '';
      const existing = target ? db.prepare('SELECT fid FROM assets WHERE fid = ?').get(target) : null;
      return {
        fid: existing ? existing.fid : target,
        deduped: true,
        reason: 'export_tag',
        exportTag: tag,
      };
    }
  } catch (e) {
    console.warn('[ingest] export-tag check failed:', e.message);
  }

  // 网关流水线：①指纹查重 ②图像特征（过小/低质/黑边） ③内容判定留给工作流 GateNode
  let ingestFp = null
  let gatewayVerdict = null
  try {
    const fpApi = require('./fingerprint');
    fpApi.ensureFingerprintColumns(db);
    ingestFp = await fpApi.computeFingerprints(buffer, fileName);
    const gw = require('./gateway');
    gatewayVerdict = await gw.evaluate(services, {
      buffer,
      fileName,
      fid: `local_${sha.slice(0, 24)}`,
      isVideo: false,
      isAiProduct: source === 'ai' || source === 'restage' || !!clientAssetId && /^ai_/.test(String(clientAssetId)),
      isManualUpload: isDirectUpload,
    });
    if (gatewayVerdict && gatewayVerdict.pass === false) {
      return {
        fid: '',
        deduped: true,
        rejected: true,
        reason: gatewayVerdict.reason,
        stage: gatewayVerdict.stage,
        detail: gatewayVerdict.detail || {},
      };
    }
    const fpHit = fpApi.findFingerprintHit(
      db,
      { md5: ingestFp.md5, sha256: ingestFp.sha256, phash: ingestFp.phash },
      {}
    );
    if (fpHit && fpHit.hit) {
      return {
        fid: fpHit.fid,
        deduped: true,
        reason: fpHit.reason,
        derivativeId: fpHit.derivativeId || null,
        matchedKind: fpHit.kind || null,
      };
    }
  } catch (e) {
    console.warn('[ingest] gateway check failed (continue):', e.message);
  }

  const normalized = await normalizeImageBuffer(buffer, fileName);
  const fid = `local_${sha.slice(0, 24)}`;
  const now = Date.now();

  originalsDir(config);
  const destName = `${fid}${path.extname(normalized.fileName) || '.jpg'}`;
  const absPath = path.join(config.dataDir, 'cache', 'originals', destName);
  fs.writeFileSync(absPath, normalized.buffer);

  let width = null;
  let height = null;
  try {
    const meta = await sharp(normalized.buffer, { failOn: 'none' }).rotate().metadata();
    width = meta.width || null;
    height = meta.height || null;
  } catch { /* ignore */ }

  const originOrientation = calculateOriginOrientation(width, height);

  db.prepare(`
    INSERT INTO assets (
      fid, kind, category, file_name, size, width, height, orientation, origin_orientation,
      status, is_representative, source, sha256, client_asset_id, created_at, discovered_at, updated_at
    ) VALUES (?, 'image', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    fid,
    targetCategory,
    normalized.fileName,
    normalized.buffer.length,
    width,
    height,
    height && width && height > width * 1.05 ? 'portrait' : (width > height * 1.05 ? 'landscape' : 'square'),
    originOrientation,
    initialStatus,
    isFinished ? 1 : 0,
    source,
    sha,
    clientId || null,
    takenAt || now,
    now,
    now
  );

  const relPath = path.join('cache', 'originals', destName);
  const deriv = await createDerivative(services, {
    assetFid: fid,
    kind: 'origin',
    srcPath: absPath,
    fileName: normalized.fileName,
    width,
    height,
    mime: normalized.mime,
    params: { source, sha256: sha }
  });
  // createDerivative copies to cache/derivatives; origin should point at originals
  db.prepare("UPDATE derivatives SET storage_type='local_cache', storage_ref=? WHERE id=?").run(relPath, deriv.id);
  setMainDerivative(db, fid, deriv.id);
  if (shelf && ['original', 'retouched', 'finished'].includes(String(shelf))) {
    try {
      require('./shelf-lineage').ensureColumns(db);
      db.prepare('UPDATE assets SET library_shelf=? WHERE fid=?').run(String(shelf), fid);
    } catch (e) {
      console.warn('[ingest] shelf:', e.message);
    }
  }

  // 写入指纹，供后续入库与 9:16/3:4 衍生对照
  try {
    const fpApi = require('./fingerprint');
    if (ingestFp) {
      fpApi.saveAssetFingerprints(db, fid, {
        md5: ingestFp.md5,
        sha256: sha,
        phash: ingestFp.phash,
      });
      fpApi.saveDerivativeFingerprints(db, deriv.id, {
        md5: ingestFp.md5,
        sha256: sha,
        phash: ingestFp.phash,
      });
    }
  } catch (e) {
    console.warn('[ingest] save fingerprints failed:', e.message);
  }

  // 手动标签录入（若有）
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
      console.warn('[ingest] 手动打标解析异常:', e.message);
    }
  }

  let queued = null;
  if (interpreter && !isFinished) {
    queued = await interpreter.triggerRun({
      workflowId: 'default',
      assetFids: [fid],
      trigger: manualTags ? `ingest:${source}:manual` : `ingest:${source}`
    });
  }

  let backup = null;
  try {
    const row = db.prepare('SELECT * FROM assets WHERE fid=?').get(fid);
    backup = await backupAsset(services, row);
  } catch (e) {
    backup = { skipped: false, quarkError: e.message };
  }

  return { fid, deduped: false, derivativeId: deriv.id, queued, originalPath: absPath, backup };
}

async function backupAsset(services, asset) {
  const { db, config, logger } = services;
  const settings = getBackupSettings(db);
  if (settings.enabled === false) {
    return { skipped: true, reason: 'backup_disabled' };
  }
  const { ensureOriginalFile } = require('./originals');
  const src = await ensureOriginalFile(services, asset);
  const out = { nas: null, quark: null };

  if (settings.nasDir) {
    try {
      fs.mkdirSync(settings.nasDir, { recursive: true });
      const dest = path.join(settings.nasDir, path.basename(src));
      fs.copyFileSync(src, dest);
      out.nas = dest;
    } catch (e) {
      logger?.warn?.(`[backup] NAS 复制失败: ${e.message}`);
      out.nasError = e.message;
    }
  }

  const quarkFid = resolveQuarkBackupFid(settings, config);
  if (quarkFid) {
    try {
      const { Quark } = require('./quark');
      const quark = new Quark(config.cliPath);
      const res = await quark.upload(src, quarkFid);
      out.quark = res;
      out.quarkFid = quarkFid;
    } catch (e) {
      logger?.warn?.(`[backup] 夸克上传失败: ${e.message}`);
      out.quarkError = e.message;
    }
  }

  if (!settings.nasDir && !quarkFid) {
    return { skipped: true, reason: 'no_backup_slot' };
  }
  return { skipped: false, ...out };
}

module.exports = {
  MAX_BYTES,
  getBackupSettings,
  saveBackupSettings,
  resolveQuarkBackupFid,
  parseMultipart,
  readRequestBuffer,
  ingestBuffer,
  backupAsset
};
