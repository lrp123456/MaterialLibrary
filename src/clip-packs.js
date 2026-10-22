/**
 * 声明式资源包（转场 / 特效 / 文字模板 / LUT / 贴纸 / 素材包 / 能力插件 operation）。
 *
 * 设计约束：
 * - 不执行任何第三方代码，只读 manifest + shader + 图片；
 * - operation 包只声明能力（runner 标识 + 输入输出 + 参数），执行体固定在
 *   <dataDir>/clip-ai-runners/<runner>.js，包目录里放什么都不会被执行；
 * - 清单校验失败一律拒绝加载，并在接口里返回具体原因；
 * - 包目录固定为 <dataDir>/clip-packs/<id>/，id 必须与目录名一致；
 * - 文件访问做路径包含校验，杜绝 ../ 穿越。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const PACK_TYPES = new Set(['effect', 'transition', 'textTemplate', 'lut', 'sticker', 'assetPack', 'operation']);
const PARAM_TYPES = new Set(['number', 'boolean', 'color', 'enum', 'string', 'vec2']);
const LICENSE_TYPES = new Set(['internal', 'cc0', 'cc-by', 'commercial', 'unknown']);
/** operation 的输入种类：与 schema 的 enum 一致。 */
const OPERATION_INPUTS = new Set(['video', 'audio', 'image', 'text']);
const ID_RE = /^[a-z0-9]+(\.[a-z0-9][a-z0-9-]*)+$/;
const KEY_RE = /^[a-zA-Z][a-zA-Z0-9_]{0,31}$/;
const SEMVER_RE = /^\d+\.\d+\.\d+$/;
/** runner 只做标识：单段小写标识符，不允许路径分隔符，因此不可能指向包内文件。 */
const RUNNER_RE = /^[a-z0-9][a-z0-9-]*$/;
const OUTPUT_RE = /^[a-z][a-z0-9-]*$/;

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function packsDir(config) {
  const primary = process.env.CLIP_PACKS_DIR
    ? path.resolve(process.env.CLIP_PACKS_DIR)
    : path.join(config.dataDir, 'clip-packs');
  // 自愈：主目录缺失/为空时回退到仓库内的 data/clip-packs。
  // 历史坑：.env 里的 CLIP_PACKS_DIR 写的是 Windows 路径，Linux 后端
  // path.resolve 成无效相对路径 → 扫描结果恒空（表现为"资源包不在"）。
  const fallback = path.join(__dirname, '..', 'data', 'clip-packs');
  const usable = (dir) => {
    try {
      return fs.existsSync(dir) && fs.readdirSync(dir).some((n) => !n.startsWith('.'));
    } catch {
      return false;
    }
  };
  const dir = usable(primary) ? primary : fallback;
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
const BUILTIN_SHADERS = new Set([
  'gaussian-blur',
  'glow',
  'sharpen',
  'skin-smooth',
  'grade',
  'warp',
  'channel',
]);
const SHADER_ID_RE = /^[a-z0-9][a-z0-9-]*$/;

function isShaderRef(s) {
  if (typeof s !== 'string' || !s) return false;
  if (SHADER_ID_RE.test(s)) return true; // 内置 shader id
  if (!isSafeRelPath(s)) return false;
  return /\.(wgsl|glsl|frag)$/.test(s); // 包内文件（需重编 wasm 才能真正生效）
}

/** 参数声明校验（顶层 params 与 operation.params 共用同一套规则）。 */
function validateParamList(list, label) {
  const errs = [];
  if (!Array.isArray(list)) return [`${label} 必须是数组`];
  const keys = new Set();
  for (const p of list) {
    if (!p || typeof p !== 'object') { errs.push(`${label} 项必须是对象`); continue; }
    const name = typeof p.key === 'string' ? p.key : String(p.key);
    if (typeof p.key !== 'string' || !KEY_RE.test(p.key)) errs.push(`${label} key 非法：${p.key}`);
    else if (keys.has(p.key)) errs.push(`${label} key 重复：${p.key}`);
    else keys.add(p.key);
    if (!PARAM_TYPES.has(p.type)) errs.push(`参数 ${name} 的 type 非法`);
    if (!p.label || typeof p.label.zh !== 'string') errs.push(`参数 ${name} 缺少 label.zh`);
    if (p.type === 'enum' && (!Array.isArray(p.options) || !p.options.length)) errs.push(`参数 ${name} 为 enum 但缺少 options`);
    if (p.type === 'number') {
      if (typeof p.default !== 'number') errs.push(`参数 ${name} 缺少数值 default`);
      if (typeof p.min !== 'number' || typeof p.max !== 'number') errs.push(`参数 ${name} 缺少 min/max`);
    }
  }
  return errs;
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

  if (m.params !== undefined) errs.push(...validateParamList(m.params, 'params'));

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
  if (m.type === 'transition') {
    if (!m.transition || typeof m.transition !== 'object') {
      push('transition 类型必须提供 transition 配置');
    } else {
      // 转场走 compositor 的 transition pass：shader 固定为 "transition"，
      // mode 必须是 transition.wgsl 已实现的 0..11。
      const passes = (m.render && Array.isArray(m.render.passes)) ? m.render.passes : [];
      if (passes.length && passes[0].shader !== 'transition') {
        push(`transition 类型的 render.passes[0].shader 必须是 "transition"，实际为 ${passes[0].shader}`);
      }
      const mode = m.transition.mode;
      if (mode !== undefined) {
        if (!Number.isInteger(mode) || mode < 0 || mode > 11) {
          push(`transition.mode 必须是 0..11 的整数，实际为 ${JSON.stringify(mode)}`);
        }
      }
      if (m.transition.defaultDuration !== undefined) {
        if (typeof m.transition.defaultDuration !== 'number' || m.transition.defaultDuration <= 0) {
          push('transition.defaultDuration 必须是正数（秒）');
        }
      }
      // uniforms.mode 与 transition.mode 必须一致，避免"面板显示 A、实际渲染 B"
      const uniformMode = passes[0] && passes[0].uniforms && passes[0].uniforms.mode;
      if (uniformMode !== undefined) {
        if (typeof uniformMode !== 'string') {
          push('render.passes[0].uniforms.mode 必须是字符串（数字字面量或 $param）');
        } else if (!/^\$[a-zA-Z]/.test(uniformMode)) {
          const parsed = Number.parseFloat(uniformMode);
          if (!Number.isFinite(parsed)) push(`uniforms.mode 无法解析为数字：${uniformMode}`);
          else if (mode !== undefined && Math.trunc(parsed) !== mode) {
            push(`uniforms.mode(${uniformMode}) 与 transition.mode(${mode}) 不一致`);
          }
        }
      }
    }
  }
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
  // operation：只登记能力，不执行包内代码。runner 是标识，执行体固定在同名服务端文件。
  if (m.type === 'operation') {
    const op = m.operation;
    if (!op || typeof op !== 'object' || Array.isArray(op)) {
      push('operation 类型必须提供 operation 配置');
    } else {
      if (typeof op.runner !== 'string' || !RUNNER_RE.test(op.runner)) {
        push(`operation.runner 必填，且必须匹配 ^[a-z0-9][a-z0-9-]*$（实际为 ${JSON.stringify(op.runner)}）`);
      }
      if (!Array.isArray(op.input) || !op.input.length) {
        push('operation.input 必须是非空数组');
      } else {
        for (const kind of op.input) {
          if (!OPERATION_INPUTS.has(kind)) {
            push(`operation.input 项非法：${JSON.stringify(kind)}（可选 ${[...OPERATION_INPUTS].join(' / ')}）`);
          }
        }
      }
      if (typeof op.output !== 'string' || !OUTPUT_RE.test(op.output)) {
        push(`operation.output 必填，且必须匹配 ^[a-z][a-z0-9-]*$（实际为 ${JSON.stringify(op.output)}）`);
      }
      if (op.params !== undefined) errs.push(...validateParamList(op.params, 'operation.params'));
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
    let items = listPacks(db, { enabledOnly });
    // 自愈：表空 = 从未成功扫描登记（目录换过/被清过），自动扫一次再返回。
    // 不再依赖用户手动点「重新加载资源包」。
    if (items.length === 0) {
      try { scanPacks(db, config); } catch (_) { /* 扫描失败保持空表 */ }
      items = listPacks(db, { enabledOnly });
    }
    sendJson(res, 200, { items });
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
