/**
 * 工程文件导出/导入（.mlsclip）。
 *
 * 定位：单文件工程包，用于备份、换机打开，以及后续交给桌面版做 4K120 离线导出。
 *
 * 包结构（见 docs/clip/功能补全-执行方案.md 第 7 节）：
 *   manifest.json   格式/版本/创建时间/工程 id/名称/是否含媒体
 *   project.json    工程全量（编辑器 storage 的序列化结果，兼容现有 schema）
 *   assets.json     素材清单：fid / 名称 / 大小 / sha256 / mime / 是否内嵌
 *   media/          可选内嵌媒体，命名 <fid>.<ext>
 *
 * 约定：
 * - 默认不内嵌媒体，只留清单；勾选"包含媒体"才把原文件塞进包里；
 * - 单个素材 >500MB 强制不内嵌，并在 warnings 里点名；
 * - 导入缺素材**不算失败**，把缺失项返回给前端提示用户补齐；
 * - 导出是同步的：写完 zip 直接返回 downloadUrl，不为了异步而异步。
 *
 * 素材字节只在导出/导入时流式读写，不会整包进内存（zip 模块负责分块压缩）。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const { ZipWriter, openZip, hashFile } = require('./clip-zip');
const { ensureTables: ensureProjectTables } = require('./editor-projects');

const FORMAT = 'mlsclip';
const VERSION = 1;
/** 单个素材超过这个体积就不内嵌（放进包里会撑爆浏览器下载与临时空间）。 */
const MAX_EMBED_BYTES = 500 * 1024 * 1024;
/** 导入包上限：再大就不是"工程文件"而是素材仓库了。 */
const UPLOAD_LIMIT = 8 * 1024 * 1024 * 1024;
/** 导出包临时保留 1 小时；导入解出的媒体保留 6 小时（够前端下载完）。 */
const EXPORT_TTL_MS = 60 * 60 * 1000;
const IMPORT_TTL_MS = 6 * 60 * 60 * 1000;

const MIME_BY_EXT = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.mkv': 'video/x-matroska',
  '.webm': 'video/webm',
  '.avi': 'video/x-msvideo',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.flac': 'audio/flac',
  '.ogg': 'audio/ogg',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
  '.bmp': 'image/bmp',
  '.svg': 'image/svg+xml',
  '.heic': 'image/heic',
};

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req, limit = 32 * 1024 * 1024) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > limit) {
        reject(Object.assign(new Error('请求体过大'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

/** 上传的 zip 直接落盘，不进内存。 */
function streamToFile(req, dest, limit = UPLOAD_LIMIT) {
  return new Promise((resolve, reject) => {
    const stated = Number(req.headers['content-length']) || 0;
    if (stated > limit) {
      reject(Object.assign(new Error('工程包过大'), { status: 413 }));
      req.destroy();
      return;
    }
    const out = fs.createWriteStream(dest);
    let size = 0;
    let settled = false;
    const fail = (err) => {
      if (settled) return;
      settled = true;
      out.destroy();
      req.destroy();
      reject(err);
    };
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limit) {
        fail(Object.assign(new Error('工程包过大'), { status: 413 }));
        return;
      }
      if (!out.write(chunk)) {
        req.pause();
        out.once('drain', () => req.resume());
      }
    });
    req.on('error', (e) => fail(e));
    out.on('error', (e) => fail(e));
    req.on('end', () => {
      out.end();
    });
    out.on('finish', () => {
      if (settled) return;
      settled = true;
      resolve({ size });
    });
  });
}

function makeId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;
}

function formatBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n >= 1024 * 1024 * 1024) return `${(n / (1024 * 1024 * 1024)).toFixed(2)}GB`;
  if (n >= 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)}MB`;
  return `${Math.max(1, Math.round(n / 1024))}KB`;
}

/** 只留安全字符：这个值会进 zip 条目名与磁盘路径。 */
function safeSegment(value, fallback = 'clip') {
  const raw = String(value == null ? '' : value).trim();
  const cleaned = raw
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/^[._]+/, '')
    .slice(0, 120);
  return cleaned || fallback;
}

/** 下载文件名：保留中文（工程名基本都是中文），只去掉路径分隔符与非法字符。 */
function safeFilename(value, fallback = 'project') {
  const raw = String(value == null ? '' : value).trim();
  const cleaned = raw
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/^[.\s]+/, '')
    .replace(/[.\s]+$/, '')
    .slice(0, 120);
  return cleaned || fallback;
}

function mimeFor({ mime, name, kind }) {
  if (mime && typeof mime === 'string' && mime.includes('/')) return mime;
  const ext = path.extname(String(name || '')).toLowerCase();
  if (MIME_BY_EXT[ext]) return MIME_BY_EXT[ext];
  if (kind === 'video') return 'video/mp4';
  if (kind === 'audio') return 'audio/mpeg';
  if (kind === 'image') return 'image/jpeg';
  return 'application/octet-stream';
}

/** 素材扩展名：文件名优先，其次按 mime 猜，最后 .bin。 */
function extFor({ name, mime }) {
  const ext = path.extname(String(name || '')).toLowerCase();
  if (/^\.[a-z0-9]{1,5}$/.test(ext)) return ext;
  const m = String(mime || '');
  if (m.startsWith('video/')) return '.mp4';
  if (m.startsWith('audio/')) return '.m4a';
  if (m.startsWith('image/')) return '.png';
  return '.bin';
}

function dirs(config) {
  const root = path.join(config.dataDir, 'mlsclip');
  const dir = {
    root,
    exports: path.join(root, 'exports'),
    imports: path.join(root, 'imports'),
    uploads: path.join(root, 'uploads'),
  };
  for (const d of Object.values(dir)) fs.mkdirSync(d, { recursive: true });
  return dir;
}

/** 清掉过期临时物；顺手做，失败不影响主流程。 */
function pruneOld(target, ttlMs) {
  try {
    const now = Date.now();
    for (const name of fs.readdirSync(target)) {
      const full = path.join(target, name);
      try {
        const st = fs.statSync(full);
        if (now - st.mtimeMs > ttlMs) fs.rmSync(full, { recursive: true, force: true });
      } catch {
        /* 单个删不掉忽略 */
      }
    }
  } catch {
    /* 目录不存在忽略 */
  }
}

function assertInside(root, target) {
  const rel = path.relative(root, target);
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) {
    throw Object.assign(new Error('路径越界'), { status: 400 });
  }
  return target;
}

/**
 * 找到素材的本地原文件。只走本地/NAS，读不到再试一次 ensureOriginalFile
 * （它可能会触发夸克下载，失败就当没有原文件，清单里标 embedded=false）。
 */
async function resolveAssetPath(services, asset) {
  const { findCachedOriginal, ensureOriginalFile } = require('./originals');
  try {
    const cached = findCachedOriginal(services.config, asset.fid);
    if (cached && fs.existsSync(cached)) return cached;
  } catch {
    /* 忽略 */
  }
  try {
    const p = await ensureOriginalFile(services, asset);
    if (p && fs.existsSync(p)) return p;
  } catch {
    /* 原文件不可用：导出仍继续，只是没有 sha256 与内嵌 */
  }
  return null;
}

function normalizeAssets(raw) {
  if (!Array.isArray(raw)) return [];
  const seen = new Map();
  for (const item of raw) {
    const fid = typeof item === 'string' ? item : item && item.fid;
    if (!fid || typeof fid !== 'string') continue;
    if (seen.has(fid)) continue;
    seen.set(fid, {
      fid,
      name: item && typeof item.name === 'string' ? item.name : '',
      mime: item && typeof item.mime === 'string' ? item.mime : '',
      size: Number(item && item.size) || 0,
    });
  }
  return [...seen.values()];
}

function validateProject(project) {
  if (!project || typeof project !== 'object' || Array.isArray(project)) {
    throw Object.assign(new Error('project.json 结构不合法'), { status: 400 });
  }
  const meta = project.metadata;
  if (!meta || typeof meta !== 'object') {
    throw Object.assign(new Error('project.json 缺少 metadata（不是剪辑工程包）'), { status: 400 });
  }
  if (project.scenes != null && !Array.isArray(project.scenes)) {
    throw Object.assign(new Error('project.json 的 scenes 必须是数组'), { status: 400 });
  }
}

// ---------------- 导出 ----------------

async function handleExport(services, req, res, rawProjectId) {
  const { db, config } = services;
  const body = JSON.parse((await readBody(req, 64 * 1024 * 1024)).toString('utf8') || '{}');
  const project = body.project;
  validateProject(project);

  const projectId = String(rawProjectId || project.metadata.id || '').slice(0, 120);
  const projectName = String(body.name || project.metadata.name || '未命名工程').slice(0, 120);
  const includeMedia = body.includeMedia === true;
  const assets = normalizeAssets(body.assets);

  // 与云端快照同一套语义：清单里的 fid 必须真实存在，否则换机打开就是黑块。
  const assetStmt = db.prepare('SELECT * FROM assets WHERE fid=?');
  const missing = assets.filter((a) => !assetStmt.get(a.fid)).map((a) => a.fid);
  if (missing.length) {
    throw Object.assign(new Error(`有 ${missing.length} 个素材未入库，请先上传`), {
      status: 400,
      missing,
    });
  }

  const { exports: exportDir, uploads } = dirs(config);
  pruneOld(exportDir, EXPORT_TTL_MS);
  pruneOld(uploads, EXPORT_TTL_MS);

  const jobId = makeId('export');
  const filePath = path.join(exportDir, `${jobId}.mlsclip`);
  const warnings = [];
  const writer = new ZipWriter(filePath);

  try {
    // 先写媒体：sha256 与大小在压缩时顺手算出来，省一次全量读盘。
    const assetManifest = [];
    for (const item of assets) {
      const row = assetStmt.get(item.fid) || {};
      const name = item.name || row.file_name || item.fid;
      const mime = mimeFor({ mime: item.mime || row.mime, name, kind: row.kind });
      const entry = {
        fid: item.fid,
        name,
        size: Number(row.size) || Number(item.size) || 0,
        sha256: '',
        mime,
        embedded: false,
      };

      const localPath = await resolveAssetPath(services, row);
      if (!localPath) {
        warnings.push(`素材「${name}」原文件不可用，只记录了清单`);
        assetManifest.push(entry);
        continue;
      }

      const stat = fs.statSync(localPath);
      entry.size = stat.size;
      const ext = extFor({ name: name || row.file_name, mime });

      if (includeMedia && stat.size > MAX_EMBED_BYTES) {
        warnings.push(`素材「${name}」${formatBytes(stat.size)} 超过 500MB，未内嵌`);
      } else if (includeMedia) {
        const written = writer.addFile(`media/${safeSegment(item.fid)}${ext}`, localPath);
        entry.sha256 = written.sha256;
        entry.size = written.size;
        entry.embedded = true;
        assetManifest.push(entry);
        continue;
      }

      // 不内嵌：库里有 sha256 就复用，没有才读一遍文件
      entry.sha256 = typeof row.sha256 === 'string' && /^[0-9a-f]{64}$/i.test(row.sha256)
        ? row.sha256
        : hashFile(localPath).sha256;
      assetManifest.push(entry);
    }

    const embeddedCount = assetManifest.filter((a) => a.embedded).length;
    const manifest = {
      format: FORMAT,
      version: VERSION,
      createdAt: new Date().toISOString(),
      editorVersion: String(body.editorVersion || '').slice(0, 40),
      projectId: projectId || String(project.metadata.id || ''),
      name: projectName,
      hasMedia: embeddedCount > 0,
    };

    writer.addJson('manifest.json', manifest);
    // project.json 原样存序列化结果（含 mediaFidMap），导入端据此重建 mediaId → fid
    writer.addBuffer('project.json', Buffer.from(JSON.stringify(project), 'utf8'));
    writer.addJson('assets.json', assetManifest);

    const written = writer.close();
    const filename = `${safeFilename(projectName, 'project')}.mlsclip`;
    sendJson(res, 200, {
      ok: true,
      jobId,
      downloadUrl: `/editor-api/projects/exports/${jobId}?name=${encodeURIComponent(filename)}`,
      filename,
      size: written.size,
      warnings,
      assets: assetManifest.length,
      embedded: embeddedCount,
    });
  } catch (e) {
    writer.abort();
    fs.rmSync(filePath, { force: true });
    throw e;
  }
}

/** 下载导出好的包。要带 token，所以前端是 fetch 成 blob 再交给浏览器保存。 */
function serveExport(services, req, res, jobId, url) {
  const { exports: exportDir } = dirs(services.config);
  pruneOld(exportDir, EXPORT_TTL_MS);
  const filePath = path.join(exportDir, `${jobId}.mlsclip`);
  if (!fs.existsSync(filePath)) {
    sendJson(res, 404, { error: '导出包不存在或已过期（有效期 1 小时）' });
    return;
  }
  const rawName = url.searchParams.get('name') || 'project.mlsclip';
  const filename = /\.mlsclip$/i.test(rawName) ? rawName : `${rawName}.mlsclip`;
  const displayName = safeFilename(filename, 'project.mlsclip');
  const stat = fs.statSync(filePath);
  res.writeHead(200, {
    'Content-Type': 'application/zip',
    'Content-Length': stat.size,
    // filename= 给老浏览器（只能是 ASCII），filename*= 给现代浏览器保留中文
    'Content-Disposition': `attachment; filename="${safeSegment(displayName, 'project.mlsclip')}"; filename*=UTF-8''${encodeURIComponent(displayName)}`,
    'Cache-Control': 'no-store',
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  fs.createReadStream(filePath).pipe(res);
}

// ---------------- 导入 ----------------

/** 在 zip 里找某个 fid 的内嵌媒体（media/<fid>.<ext>）。 */
function findMediaEntry(zip, fid) {
  const target = String(fid);
  const safe = safeSegment(target);
  return (
    zip.names.find((n) => {
      if (!n.startsWith('media/')) return false;
      const base = path.posix.basename(n);
      const stem = base.includes('.') ? base.slice(0, base.lastIndexOf('.')) : base;
      // 导出时条目名会过一遍 safeSegment，读回来两种形态都认
      return stem === target || stem === safe;
    }) || null
  );
}

async function handleImport(services, req, res) {
  const { db, config } = services;
  const { imports: importRoot, uploads } = dirs(config);
  pruneOld(importRoot, IMPORT_TTL_MS);
  pruneOld(uploads, EXPORT_TTL_MS);

  const importId = makeId('import');
  const uploadPath = path.join(uploads, `${importId}.zip`);
  let projectId = '';
  try {
    const { size: uploadSize } = await streamToFile(req, uploadPath);
    if (!uploadSize) throw Object.assign(new Error('没有收到工程包内容'), { status: 400 });

    const zip = openZip(uploadPath);
    const manifest = zip.readJson('manifest.json');
    if (!manifest || typeof manifest !== 'object') {
      throw Object.assign(new Error('缺少 manifest.json，不是 .mlsclip 工程包'), { status: 400 });
    }
    if (manifest.format !== FORMAT) {
      throw Object.assign(new Error(`不是 .mlsclip 工程包（format=${String(manifest.format)}）`), {
        status: 400,
      });
    }
    const version = Number(manifest.version);
    if (!Number.isFinite(version) || version < 1) {
      throw Object.assign(new Error('manifest.json 的版本号不合法'), { status: 400 });
    }
    if (version > VERSION) {
      throw Object.assign(
        new Error(`工程包版本 ${version} 高于当前服务端支持的 ${VERSION}，请先升级服务端`),
        { status: 400 },
      );
    }

    const project = zip.readJson('project.json');
    validateProject(project);

    const rawAssetsJson = zip.readJson('assets.json');
    const rawAssets = Array.isArray(rawAssetsJson) ? rawAssetsJson : [];
    const rawByFid = new Map(
      rawAssets.filter((a) => a && a.fid).map((a) => [String(a.fid), a]),
    );
    const assets = normalizeAssets(
      rawAssets.map((a) => ({
        fid: a && a.fid,
        name: a && typeof a.name === 'string' ? a.name : '',
        mime: a && typeof a.mime === 'string' ? a.mime : '',
        size: Number(a && a.size) || 0,
      })),
    );

    const missing = [];
    const media = [];
    const warnings = [];
    const mediaDir = path.join(importRoot, importId, 'media');
    const assetStmt = db.prepare('SELECT * FROM assets WHERE fid=?');

    for (const item of assets) {
      const raw = rawByFid.get(item.fid) || {};
      const name = item.name || raw.name || item.fid;
      // 库里已有这个 fid：本机直接能播，不需要下载，也不必期望内嵌
      if (assetStmt.get(item.fid)) continue;

      let provided = false;
      if (raw.embedded === true) {
        const entryName = findMediaEntry(zip, item.fid);
        if (!entryName) {
          warnings.push(`素材「${name}」标记为内嵌，但包内找不到 media 文件`);
        } else {
          const buf = zip.read(entryName);
          const sha = crypto.createHash('sha256').update(buf).digest('hex');
          if (raw.sha256 && /^[0-9a-f]{64}$/i.test(raw.sha256) && raw.sha256.toLowerCase() !== sha) {
            warnings.push(`素材「${name}」校验值不一致，文件可能被改动过`);
          }
          fs.mkdirSync(mediaDir, { recursive: true });
          const fileName = safeSegment(path.posix.basename(entryName), `${safeSegment(item.fid)}.bin`);
          const dest = assertInside(mediaDir, path.join(mediaDir, fileName));
          fs.writeFileSync(dest, buf);
          media.push({
            fid: item.fid,
            name,
            mime: item.mime || mimeFor({ name: fileName }),
            size: buf.length,
            sha256: sha,
            url: `/editor-api/projects/imports/${importId}/media/${encodeURIComponent(fileName)}`,
          });
          provided = true;
        }
      }
      if (!provided) missing.push({ fid: item.fid, name });
    }

    // 服务端也留一份工程记录：换机/换端后仍是同一份数据，便于再导出
    const now = Date.now();
    projectId = makeId('proj');
    const projectName = String(manifest.name || project.metadata.name || '导入的工程').slice(0, 120);
    const normalized = {
      ...project,
      metadata: {
        ...project.metadata,
        id: projectId,
        name: projectName,
        updatedAt: new Date(now).toISOString(),
      },
    };
    ensureProjectTables(db);
    db.prepare(`
      INSERT INTO editor_projects (id, name, data, created_at, updated_at, rev)
      VALUES (?, ?, ?, ?, ?, 1)
    `).run(projectId, projectName, JSON.stringify(normalized), now, now);

    sendJson(res, 200, {
      ok: true,
      projectId,
      name: projectName,
      project: normalized,
      missing,
      media,
      warnings,
      assets: assets.length,
    });
  } catch (e) {
    if (!projectId) fs.rmSync(path.join(importRoot, importId), { recursive: true, force: true });
    throw e;
  } finally {
    fs.rmSync(uploadPath, { force: true });
  }
}

/** 导入解出的内嵌媒体，供前端逐个下载后登记到本地素材库。 */
function serveImportMedia(services, req, res, importId, fileName) {
  const { imports: importRoot } = dirs(services.config);
  const mediaDir = path.join(importRoot, importId, 'media');
  const target = path.join(mediaDir, path.basename(decodeURIComponent(fileName)));
  if (!fs.existsSync(target) || !fs.statSync(target).isFile()) {
    sendJson(res, 404, { error: '素材不存在或已过期（有效期 6 小时）' });
    return;
  }
  const stat = fs.statSync(target);
  res.writeHead(200, {
    'Content-Type': MIME_BY_EXT[path.extname(target).toLowerCase()] || 'application/octet-stream',
    'Content-Length': stat.size,
    'Cache-Control': 'no-store',
  });
  if (req.method === 'HEAD') {
    res.end();
    return;
  }
  fs.createReadStream(target).pipe(res);
}

/**
 * 路由。返回 true 表示已处理；未命中交回 editor-projects。
 *   POST /editor-api/projects/:id/export
 *   GET  /editor-api/projects/exports/:jobId?name=
 *   POST /editor-api/projects/import
 *   GET  /editor-api/projects/imports/:importId/media/:file
 */
async function handleProjectFileApi(services, req, res, url) {
  const p = url.pathname;
  const isRead = req.method === 'GET' || req.method === 'HEAD';

  if (p === '/editor-api/projects/import' && req.method === 'POST') {
    await handleImport(services, req, res);
    return true;
  }

  const exportMatch = /^\/editor-api\/projects\/([^/]+)\/export$/.exec(p);
  if (exportMatch && req.method === 'POST') {
    await handleExport(services, req, res, decodeURIComponent(exportMatch[1]));
    return true;
  }

  const downloadMatch = /^\/editor-api\/projects\/exports\/([A-Za-z0-9_-]{6,64})$/.exec(p);
  if (downloadMatch && isRead) {
    serveExport(services, req, res, downloadMatch[1], url);
    return true;
  }

  const mediaMatch = /^\/editor-api\/projects\/imports\/([A-Za-z0-9_-]{6,64})\/media\/([^/]+)$/.exec(p);
  if (mediaMatch && isRead) {
    serveImportMedia(services, req, res, mediaMatch[1], mediaMatch[2]);
    return true;
  }

  return false;
}

module.exports = {
  handleProjectFileApi,
  MAX_EMBED_BYTES,
  FORMAT,
  VERSION,
};
