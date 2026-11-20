/**
 * 创作库私有文件与分区/回收的数据层。
 *
 * 配方（创作库作品）的源图与产物必须和素材库分开：
 * - 复制到 <dataDir>/creation-library/<tplId>/ 下，只属于这条配方；
 * - 不写 assets 表、不落 cache/originals，素材库列表永远看不到这些副本；
 * - 素材库原件被删/回收不影响配方；
 * - 配方删除只是软删（creation_templates.deleted_at），文件留在原处，
 *   恢复时原样回来；只有显式清空回收才删文件。
 */
const fs = require('fs');
const path = require('path');

const MEDIA_ROOT = 'creation-library';
const ORIGIN_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.gif', '.heic', '.heif', '.bmp'];

let schemaEnsured = new WeakSet();

function ensureCreationLibrarySchema(db) {
  if (schemaEnsured.has(db)) return;
  schemaEnsured.add(db);
  try { db.exec('ALTER TABLE creation_templates ADD COLUMN section_id TEXT;'); } catch (e) {}
  try { db.exec('ALTER TABLE creation_templates ADD COLUMN pin_order INTEGER;'); } catch (e) {}
  try { db.exec('ALTER TABLE creation_templates ADD COLUMN pinned_at INTEGER;'); } catch (e) {}
  try { db.exec('ALTER TABLE creation_templates ADD COLUMN deleted_at INTEGER;'); } catch (e) {}
  try { db.exec('ALTER TABLE creation_templates ADD COLUMN trashed_section_id TEXT;'); } catch (e) {}
  try { db.exec('ALTER TABLE creation_templates ADD COLUMN media_dir TEXT;'); } catch (e) {}
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS creation_sections (
        id TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        name TEXT NOT NULL,
        sort_order INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_creation_sections_user ON creation_sections(user_id, sort_order);
      CREATE INDEX IF NOT EXISTS idx_creation_tpl_section ON creation_templates(section_id, pin_order);
    `);
  } catch (e) {}
}

function dataDirOf(services) {
  return (services && services.config && services.config.dataDir)
    || process.env.ML_DATA_DIR
    || path.join(require('os').homedir(), '.dsh-material-library');
}

function safeKey(id) {
  return String(id || '').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 96);
}

function mediaDirFor(services, tplId) {
  return path.join(dataDirOf(services), MEDIA_ROOT, safeKey(tplId));
}

function relMediaDir(tplId) {
  return `${MEDIA_ROOT}/${safeKey(tplId)}`;
}

function mediaUrl(tplId, kind, idx) {
  return `/api/creation-templates/${encodeURIComponent(String(tplId))}/media/${kind}/${idx}`;
}

function extFromPath(p) {
  const ext = path.extname(String(p || '')).toLowerCase();
  return ext && ext.length <= 6 ? ext : '';
}

function extFromMagic(buf, fallback) {
  if (!buf || !buf.length) return fallback || '.bin';
  if (buf[0] === 0x89 && buf[1] === 0x50) return '.png';
  if (buf[0] === 0xff && buf[1] === 0xd8) return '.jpg';
  if (buf[0] === 0x47 && buf[1] === 0x49) return '.gif';
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[8] === 0x57) return '.webp';
  if (buf[0] === 0x66 && buf[1] === 0x74 && buf[2] === 0x79 && buf[3] === 0x70) return '.mp4';
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) return '.webm';
  return fallback || '.bin';
}

function dataUrlBuffer(raw) {
  const m = String(raw || '').match(/^data:([^;,]+)?(?:;[^,]*)?,(.*)$/s);
  if (!m) return null;
  const mime = m[1] || '';
  let body = m[2] || '';
  let ext = '.bin';
  if (mime.startsWith('image/png')) ext = '.png';
  else if (mime.startsWith('image/jpeg')) ext = '.jpg';
  else if (mime.startsWith('image/webp')) ext = '.webp';
  else if (mime.startsWith('image/gif')) ext = '.gif';
  else if (mime.startsWith('video/mp4')) ext = '.mp4';
  else if (mime.startsWith('video/webm')) ext = '.webm';
  else if (mime.startsWith('audio/mpeg')) ext = '.mp3';
  else if (mime.startsWith('audio/wav')) ext = '.wav';
  const isBase64 = /;base64/.test(String(raw.slice(0, Math.min(80, raw.length))));
  if (!isBase64) body = decodeURIComponent(body);
  const buf = Buffer.from(body, isBase64 ? 'base64' : 'utf8');
  return { buffer: buf, ext: extFromMagic(buf, ext) };
}

function cacheTempPath(services, pathname) {
  const name = String(pathname || '').replace(/^\/api\/cache\/temp\//, '').split('/').pop();
  if (!name || name.includes('..')) return '';
  const p = path.join(dataDirOf(services), 'cache', 'temp', name);
  return fs.existsSync(p) && fs.statSync(p).isFile() ? p : '';
}

function fidFromViewerUrl(raw) {
  const m = String(raw || '').match(/\/api\/(?:viewer\/)?assets\/([^/?#]+)/);
  return m ? decodeURIComponent(m[1]) : '';
}

/**
 * 把配方里的一个 URL 解析成可复制的本地路径或 Buffer。
 * 失败返回 null（调用方保留旧 URL，不阻塞保存）。
 */
async function resolveCopySource(services, raw) {
  const s = String(raw || '').trim();
  if (!s) return null;
  if (s.startsWith('data:')) {
    const d = dataUrlBuffer(s);
    return d ? { buffer: d.buffer, ext: d.ext } : null;
  }
  let pathname = s;
  let isHttp = false;
  if (/^https?:\/\//i.test(s)) {
    isHttp = true;
    try { pathname = new URL(s).pathname; } catch { pathname = s; }
  }
  const temp = cacheTempPath(services, pathname);
  if (temp) return { path: temp, ext: extFromPath(temp) };

  const fid = fidFromViewerUrl(s) || (services.db && services.db.prepare('SELECT fid FROM assets WHERE fid=?').get(s) ? s : '');
  if (fid && services.db) {
    const asset = services.db.prepare('SELECT * FROM assets WHERE fid=?').get(fid);
    if (asset) {
      // 视频封面优先走真实封面，否则回退缩略图
      if (/\/poster(?:$|[?#])/.test(s) || /\/thumb(?:$|[?#])/.test(s)) {
        const thumbs = ['cache/thumbs/' + fid + '.jpg', 'cache/thumbs/' + fid + '.png'];
        for (const rel of thumbs) {
          const p = path.join(dataDirOf(services), rel);
          if (fs.existsSync(p) && fs.statSync(p).size > 200) return { path: p, ext: extFromPath(p) };
        }
        if (asset.poster_path) {
          const p = path.isAbsolute(asset.poster_path) ? asset.poster_path : path.join(dataDirOf(services), asset.poster_path);
          if (fs.existsSync(p)) return { path: p, ext: extFromPath(p) };
        }
        return null;
      }
      try {
        const { ensureOriginalFile } = require('./originals');
        const p = await ensureOriginalFile(services, asset);
        if (p && fs.existsSync(p)) return { path: p, ext: extFromPath(p) };
      } catch (e) {}
    }
  }

  // 兜底：resolveAssetBuffer 覆盖 data URL、受控本地路径、cache/temp、fid、viewer 与 http（带 SSRF 防护）
  try {
    const { resolveAssetBuffer } = require('./ai-tasks');
    const buf = await resolveAssetBuffer(services, s);
    if (buf && buf.length) return { buffer: buf, ext: extFromMagic(buf, isHttp ? extFromPath(pathname) : extFromPath(pathname)) };
  } catch (e) {}
  return null;
}

function writeDest(src, destNoExt) {
  fs.mkdirSync(path.dirname(destNoExt), { recursive: true });
  const dest = destNoExt + (src.ext || '.bin');
  try { if (fs.existsSync(dest)) fs.unlinkSync(dest); } catch {}
  if (src.path) {
    fs.copyFileSync(src.path, dest);
  } else if (src.buffer) {
    fs.writeFileSync(dest, src.buffer);
  } else {
    return '';
  }
  return dest;
}

/**
 * 把源图/产物/封面复制到配方私有目录，并改写 JSON 里的 URL。
 * 单个失败只保留原 URL；返回 { originImages, resultImages, mediaDir }。
 */
async function copyTemplateMedia(services, tplId, originImages, resultImages) {
  const oi = Array.isArray(originImages) ? originImages.map((x) => (x && typeof x === 'object' ? { ...x } : x)) : [];
  const ri = Array.isArray(resultImages) ? resultImages.map((x) => (x && typeof x === 'object' ? { ...x } : x)) : [];
  let copied = 0;

  for (let i = 0; i < oi.length; i++) {
    const item = oi[i];
    const url = typeof item === 'string' ? item : (item && item.url);
    const src = await resolveCopySource(services, url);
    if (!src) continue;
    const dest = writeDest(src, path.join(mediaDirFor(services, tplId), 'origin', String(i)));
    if (!dest) continue;
    const next = mediaUrl(tplId, 'origin', i);
    if (typeof item === 'string') oi[i] = next;
    else item.url = next;
    copied++;
  }

  for (let i = 0; i < ri.length; i++) {
    const item = ri[i];
    if (!item || typeof item !== 'object') continue;
    const url = item.url;
    const src = await resolveCopySource(services, url);
    if (src) {
      const dest = writeDest(src, path.join(mediaDirFor(services, tplId), 'result', String(i)));
      if (dest) {
        item.url = mediaUrl(tplId, 'result', i);
        copied++;
      }
    }
    if (item.poster) {
      const psrc = await resolveCopySource(services, item.poster);
      if (psrc) {
        const pdest = writeDest(psrc, path.join(mediaDirFor(services, tplId), 'poster', String(i)));
        if (pdest) {
          item.poster = mediaUrl(tplId, 'poster', i);
          copied++;
        }
      }
    }
  }

  return {
    originImages: oi,
    resultImages: ri,
    mediaDir: copied > 0 ? relMediaDir(tplId) : null,
  };
}

/** 路由用：校验并返回私有文件绝对路径（kind ∈ origin/result/poster，idx 非负整数） */
function templateMediaFile(services, tplId, kind, idx) {
  if (!['origin', 'result', 'poster'].includes(kind)) return '';
  const n = Number(idx);
  if (!Number.isInteger(n) || n < 0 || n > 999) return '';
  const dir = path.join(mediaDirFor(services, tplId), kind);
  if (!fs.existsSync(dir)) return '';
  let files = [];
  try { files = fs.readdirSync(dir); } catch { return ''; }
  const hit = files.find((f) => f.startsWith(String(n) + '.'));
  if (!hit) return '';
  return path.join(dir, hit);
}

function removeTemplateMedia(services, tplId) {
  const dir = mediaDirFor(services, tplId);
  try { fs.rmSync(dir, { recursive: true, force: true }); } catch (e) {}
}

function mimeForFile(p) {
  const ext = extFromPath(p);
  if (ext === '.mp4') return 'video/mp4';
  if (ext === '.webm') return 'video/webm';
  if (ext === '.mp3') return 'audio/mpeg';
  if (ext === '.wav') return 'audio/wav';
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.gif') return 'image/gif';
  if (ext === '.heic' || ext === '.heif') return 'image/heic';
  return 'image/jpeg';
}

/**
 * 存量补拷：只扫未删除、尚未私有化的配方。
 * 已失效的老地址保留原样并标记 media_dir（避免无限重试）。
 */
async function backfillCreationMedia(services, { limit = 200, concurrency = 2 } = {}) {
  ensureCreationLibrarySchema(services.db);
  const rows = services.db.prepare(`
    SELECT * FROM creation_templates
    WHERE deleted_at IS NULL AND media_dir IS NULL
    ORDER BY created_at ASC LIMIT ?
  `).all(Math.max(1, Math.min(1000, Number(limit) || 200)));
  if (!rows.length) return { scanned: 0, copied: 0 };

  let cursor = 0;
  let copiedRows = 0;
  async function worker() {
    while (cursor < rows.length) {
      const row = rows[cursor++];
      try {
        let oi = [];
        let ri = [];
        try { oi = JSON.parse(row.origin_images || '[]'); } catch {}
        try { ri = JSON.parse(row.result_images || '[]'); } catch {}
        const out = await copyTemplateMedia(services, row.id, oi, ri);
        const maxRow = services.db.prepare('SELECT MAX(updated_at) AS m FROM creation_templates').get();
        const updatedAt = Math.max(Date.now(), Number(maxRow?.m || 0) + 1);
        services.db.prepare(`
          UPDATE creation_templates
          SET origin_images=?, result_images=?, media_dir=?, updated_at=?
          WHERE id=? AND deleted_at IS NULL
        `).run(JSON.stringify(out.originImages), JSON.stringify(out.resultImages), out.mediaDir || relMediaDir(row.id), updatedAt, row.id);
        if (out.mediaDir) copiedRows++;
      } catch (e) {
        // 失败也标记 media_dir，避免每次启动都重试同一条死链
        try { services.db.prepare('UPDATE creation_templates SET media_dir=? WHERE id=? AND deleted_at IS NULL').run(relMediaDir(row.id), row.id); } catch {}
      }
    }
  }
  const workers = Array.from({ length: Math.max(1, Math.min(4, concurrency)) }, () => worker());
  await Promise.all(workers);
  return { scanned: rows.length, copied: copiedRows };
}

module.exports = {
  MEDIA_ROOT,
  ensureCreationLibrarySchema,
  mediaDirFor,
  relMediaDir,
  mediaUrl,
  copyTemplateMedia,
  resolveCopySource,
  templateMediaFile,
  removeTemplateMedia,
  mimeForFile,
  backfillCreationMedia,
};
