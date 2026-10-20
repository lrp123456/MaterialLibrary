/**
 * 声明式资源包（转场 / 特效 / 文字模板 / LUT / 贴纸 / 素材包）。
 *
 * 设计约束：
 * - 不执行任何第三方代码，只读 manifest + shader + 图片；
 * - 清单校验失败一律拒绝加载，并在接口里返回具体原因；
 * - 包目录固定为 <dataDir>/clip-packs/<id>/，id 必须与目录名一致；
 * - 文件访问做路径包含校验，杜绝 ../ 穿越。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PACK_TYPES = new Set(['effect', 'transition', 'textTemplate', 'lut', 'sticker', 'assetPack']);
const PARAM_TYPES = new Set(['number', 'boolean', 'color', 'enum', 'string', 'vec2']);
const LICENSE_TYPES = new Set(['internal', 'cc0', 'cc-by', 'commercial', 'unknown']);
const ID_RE = /^[a-z0-9]+(\.[a-z0-9][a-z0-9-]*)+$/;
const KEY_RE = /^[a-zA-Z][a-zA-Z0-9_]{0,31}$/;
const SEMVER_RE = /^\d+\.\d+\.\d+$/;

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function packsDir(config) {
  const dir = process.env.CLIP_PACKS_DIR
    ? path.resolve(process.env.CLIP_PACKS_DIR)
    : path.join(config.dataDir, 'clip-packs');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function ensurePackTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS clip_packs (
      id            TEXT PRIMARY KEY,
      type          TEXT NOT NULL,
      version       TEXT NOT NULL,
      name_zh       TEXT,
      manifest_json TEXT NOT NULL,
      content_hash  TEXT NOT NULL,
      dir           TEXT NOT NULL,
      enabled       INTEGER NOT NULL DEFAULT 1,
      installed_at  INTEGER NOT NULL,
      updated_at    INTEGER NOT NULL
    );
  `);
}

function isSafeRelPath(p) {
  if (typeof p !== 'string' || !p) return false;
  if (p.startsWith('/') || p.startsWith('\\')) return false;
  if (/^[a-zA-Z]:/.test(p)) return false;
  const parts = p.split(/[\\/]/);
  return !parts.includes('..');
}

/** 与 rust/crates/effects/src/pipeline.rs 的 shader_defs 保持同步。 */
const BUILTIN_SHADERS = new Set(['gaussian-blur', 'glow', 'sharpen', 'skin-smooth']);
const SHADER_ID_RE = /^[a-z0-9][a-z0-9-]*$/;

function isShaderRef(s) {
  if (typeof s !== 'string' || !s) return false;
  if (SHADER_ID_RE.test(s)) return true; // 内置 shader id
  if (!isSafeRelPath(s)) return false;
  return /\.(wgsl|glsl|frag)$/.test(s); // 包内文件（需重编 wasm 才能真正生效）
}

/** 手写校验器：只覆盖 manifest schema 里真正会出错的约束，错误信息可读。 */
function validateManifest(m, dirName) {
  const errs = [];
  const push = (msg) => errs.push(msg);

  if (!m || typeof m !== 'object') return ['manifest 不是对象'];
  if (m.schemaVersion !== 1) push(`schemaVersion 必须是 1，实际为 ${JSON.stringify(m.schemaVersion)}`);
  if (typeof m.id !== 'string' || !ID_RE.test(m.id)) push('id 必须是反向域名式（如 com.mls.effect.glow）');
  else if (dirName && m.id !== dirName) push(`id 必须与目录名一致（目录=${dirName}，manifest=${m.id}）`);
  if (!PACK_TYPES.has(m.type)) push(`type 必须是 ${[...PACK_TYPES].join(' / ')} 之一`);
  if (!m.name || typeof m.name.zh !== 'string' || !m.name.zh.trim()) push('name.zh 必填');
  if (typeof m.version !== 'string' || !SEMVER_RE.test(m.version)) push('version 必须是 x.y.z');
  if (!m.license || !LICENSE_TYPES.has(m.license.type)) push(`license.type 必须是 ${[...LICENSE_TYPES].join(' / ')} 之一`);
  if (!m.license || typeof m.license.source !== 'string' || !m.license.source.trim()) push('license.source 必填（来源说明）');
  if (m.preview && !isSafeRelPath(m.preview)) push('preview 必须是包内相对路径');

  if (Array.isArray(m.params)) {
    const keys = new Set();
    for (const p of m.params) {
      if (!p || typeof p !== 'object') { push('params 项必须是对象'); continue; }
      if (typeof p.key !== 'string' || !KEY_RE.test(p.key)) push(`参数 key 非法：${p.key}`);
      else if (keys.has(p.key)) push(`参数 key 重复：${p.key}`);
      else keys.add(p.key);
      if (!PARAM_TYPES.has(p.type)) push(`参数 ${p.key} 的 type 非法`);
      if (!p.label || typeof p.label.zh !== 'string') push(`参数 ${p.key} 缺少 label.zh`);
      if (p.type === 'enum' && (!Array.isArray(p.options) || !p.options.length)) push(`参数 ${p.key} 为 enum 但缺少 options`);
      if (p.type === 'number') {
        if (typeof p.default !== 'number') push(`参数 ${p.key} 缺少数值 default`);
        if (typeof p.min !== 'number' || typeof p.max !== 'number') push(`参数 ${p.key} 缺少 min/max`);
      }
    }
  } else if (m.params !== undefined) {
    push('params 必须是数组');
  }

  const needsRender = m.type === 'effect' || m.type === 'transition';
  if (needsRender) {
    if (!m.render || !Array.isArray(m.render.passes) || !m.render.passes.length) {
      push(`${m.type} 必须提供 render.passes`);
    } else {
      for (const pass of m.render.passes) {
        if (!pass || typeof pass.shader !== 'string') push('render.passes[].shader 必填');
        else if (!isShaderRef(pass.shader)) push(`shader 引用非法：${pass.shader}（内置 id 或包内 .wgsl/.glsl/.frag）`);
      }
    }
  }
  if (m.type === 'transition' && (!m.transition || typeof m.transition !== 'object')) push('transition 类型必须提供 transition 配置');
  if (m.type === 'textTemplate' && (!m.textTemplate || typeof m.textTemplate !== 'object')) push('textTemplate 类型必须提供 textTemplate 配置');
  if (m.type === 'lut') {
    if (!m.lut || ![17, 25, 32, 33, 64].includes(m.lut.size)) push('lut.size 必须是 17/25/32/33/64');
  }
  if ((m.type === 'sticker' || m.type === 'assetPack')) {
    if (!Array.isArray(m.assets) || !m.assets.length) push(`${m.type} 必须提供 assets[]`);
    else for (const a of m.assets) {
      if (!a || !isSafeRelPath(a.path)) push(`assets[].path 非法：${a && a.path}`);
      if (!a || !['image', 'video', 'audio', 'sticker', 'font'].includes(a.kind)) push(`assets[].kind 非法：${a && a.kind}`);
    }
  }

  return errs;
}

/** 内容哈希：目录内所有文件的相对路径 + 内容，排序后 sha256。 */
function hashDir(dir) {
  const files = [];
  const walk = (rel) => {
    const abs = path.join(dir, rel);
    for (const name of fs.readdirSync(abs)) {
      const childRel = rel ? path.join(rel, name) : name;
      const st = fs.statSync(path.join(dir, childRel));
      if (st.isDirectory()) walk(childRel);
      else files.push(childRel);
    }
  };
  walk('');
  files.sort();
  const h = crypto.createHash('sha256');
  for (const f of files) {
    h.update(f);
    h.update(fs.readFileSync(path.join(dir, f)));
  }
  return { hash: h.digest('hex'), files };
}

function scanPacks(db, config) {
  ensurePackTables(db);
  const root = packsDir(config);
  const results = [];

  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const id = entry.name;
    const dir = path.join(root, id);
    const manifestPath = path.join(dir, 'manifest.json');

    if (!fs.existsSync(manifestPath)) {
      results.push({ id, ok: false, errors: ['缺少 manifest.json'] });
      continue;
    }

    let manifest;
    try {
      manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    } catch (e) {
      results.push({ id, ok: false, errors: [`manifest.json 解析失败：${e.message}`] });
      continue;
    }

    const errors = validateManifest(manifest, id);
    if (errors.length) {
      results.push({ id, ok: false, errors });
      // 校验失败的包要下线，避免编辑器加载到半成品
      db.prepare('UPDATE clip_packs SET enabled=0, updated_at=? WHERE id=?').run(Date.now(), id);
      continue;
    }

    const { hash, files } = hashDir(dir);
    const now = Date.now();
    db.prepare(`
      INSERT INTO clip_packs (id, type, version, name_zh, manifest_json, content_hash, dir, enabled, installed_at, updated_at)
      VALUES (?,?,?,?,?,?,?,1,?,?)
      ON CONFLICT(id) DO UPDATE SET
        type=excluded.type, version=excluded.version, name_zh=excluded.name_zh,
        manifest_json=excluded.manifest_json, content_hash=excluded.content_hash,
        dir=excluded.dir, enabled=1, updated_at=excluded.updated_at
    `).run(id, manifest.type, manifest.version, manifest.name.zh, JSON.stringify(manifest), hash, dir, now, now);

    results.push({ id, ok: true, version: manifest.version, type: manifest.type, hash, files: files.length });
  }

  return results;
}

function listPacks(db, { enabledOnly = true } = {}) {
  ensurePackTables(db);
  const sql = enabledOnly
    ? 'SELECT * FROM clip_packs WHERE enabled=1 ORDER BY type, name_zh'
    : 'SELECT * FROM clip_packs ORDER BY type, name_zh';
  return db.prepare(sql).all().map((r) => ({
    id: r.id,
    type: r.type,
    version: r.version,
    nameZh: r.name_zh,
    manifest: JSON.parse(r.manifest_json),
    contentHash: r.content_hash,
    enabled: !!r.enabled,
    updatedAt: r.updated_at,
  }));
}

function contentTypeFor(file) {
  const ext = path.extname(file).toLowerCase();
  if (ext === '.wgsl' || ext === '.glsl' || ext === '.frag') return 'text/plain; charset=utf-8';
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.svg') return 'image/svg+xml';
  if (ext === '.json') return 'application/json; charset=utf-8';
  return 'application/octet-stream';
}

async function handlePacks(services, req, res, url) {
  const { db, config } = services;
  ensurePackTables(db);
  const p = url.pathname;

  if (p === '/editor-api/packs' && req.method === 'GET') {
    const enabledOnly = url.searchParams.get('all') !== '1';
    sendJson(res, 200, { items: listPacks(db, { enabledOnly }) });
    return true;
  }

  if (p === '/editor-api/packs/reload' && req.method === 'POST') {
    const results = scanPacks(db, config);
    const failed = results.filter((r) => !r.ok);
    sendJson(res, 200, {
      ok: failed.length === 0,
      total: results.length,
      failed: failed.length,
      results,
    });
    return true;
  }

  const fileMatch = /^\/editor-api\/packs\/([^/]+)\/file$/.exec(p);
  if (fileMatch && req.method === 'GET') {
    const id = decodeURIComponent(fileMatch[1]);
    const rel = url.searchParams.get('path') || '';
    if (!isSafeRelPath(rel)) {
      sendJson(res, 400, { error: '非法文件路径' });
      return true;
    }
    const root = packsDir(config);
    const packDir = path.join(root, id);
    const abs = path.join(packDir, rel);
    const relCheck = path.relative(packDir, abs);
    if (!relCheck || relCheck.startsWith('..') || path.isAbsolute(relCheck)) {
      sendJson(res, 400, { error: '路径越界' });
      return true;
    }
    if (!fs.existsSync(abs) || fs.statSync(abs).isDirectory()) {
      sendJson(res, 404, { error: '文件不存在' });
      return true;
    }
    const buf = fs.readFileSync(abs);
    res.writeHead(200, {
      'Content-Type': contentTypeFor(abs),
      'Content-Length': buf.length,
      'Cache-Control': 'public, max-age=300',
    });
    res.end(buf);
    return true;
  }

  return false;
}

module.exports = {
  ensurePackTables,
  scanPacks,
  listPacks,
  validateManifest,
  handlePacks,
  packsDir,
};
