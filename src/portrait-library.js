/**
 * 方舟私域虚拟人像库。只记录本系统提交的素材，火山来拉签名地址。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
const { resolveVolcCredentials, credentialsReady, volcOpenApi } = require('./volc-openapi');
const {
  FETCH_TTL_MS,
  assertPublicHttpsBase,
  validateImageMeta,
  signFetchToken,
  verifyFetchToken,
  newNonce,
} = require('./portrait-contract');

const ARK_HOST = 'ark.cn-beijing.volcengineapi.com';
const ARK_SERVICE = 'ark';
const ARK_VERSION = '2024-01-01';
const CONSENT_KIND = 'portrait_ownership';
const INGEST_EXT = new Set(['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif', '.bmp']);

const MIME = {
  jpeg: 'image/jpeg',
  jpg: 'image/jpeg',
  png: 'image/png',
  webp: 'image/webp',
  bmp: 'image/bmp',
  tiff: 'image/tiff',
  gif: 'image/gif',
  heic: 'image/heic',
  heif: 'image/heif',
};

function ensureSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS portrait_groups (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      name TEXT NOT NULL,
      volc_group_id TEXT,
      project_name TEXT NOT NULL,
      created_by INTEGER,
      created_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS portrait_assets (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      group_id INTEGER NOT NULL,
      source_fid TEXT,
      volc_asset_id TEXT,
      name TEXT,
      status TEXT NOT NULL,
      error TEXT,
      fetch_nonce TEXT NOT NULL,
      fetch_exp INTEGER,
      created_by INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS user_consents (
      user_id INTEGER NOT NULL,
      kind TEXT NOT NULL,
      accepted_at INTEGER NOT NULL,
      PRIMARY KEY (user_id, kind)
    );
  `);
}

function kvGet(db, key) {
  try {
    const row = db.prepare('SELECT value FROM kv WHERE key=?').get(key);
    return (row && row.value) || '';
  } catch {
    return '';
  }
}

function rawPublicBase(services) {
  const dedicated = process.env.ASSET_PUBLIC_BASE || kvGet(services.db, 'asset_public_base');
  if (dedicated) return dedicated;
  return kvGet(services.db, 'bff_public_base') || process.env.BFF_PUBLIC_BASE || '';
}

function projectName(services) {
  return process.env.ARK_ASSET_PROJECT || kvGet(services.db, 'ark_asset_project') || 'default';
}

function fetchSecret(services) {
  if (process.env.MLS_FETCH_SECRET) return process.env.MLS_FETCH_SECRET;
  const existing = kvGet(services.db, 'portrait_fetch_secret');
  if (existing) return existing;
  const gen = crypto.randomBytes(32).toString('hex');
  try {
    services.db.prepare('INSERT INTO kv (key, value) VALUES (?, ?)').run('portrait_fetch_secret', gen);
    return gen;
  } catch {
    return gen;
  }
}

function volcReadiness(services) {
  const cfg = resolveVolcCredentials(services, 'volc_portrait');
  const credentials = credentialsReady(cfg);
  let publicBaseOk = false;
  let publicBaseReason = '';
  try {
    assertPublicHttpsBase(rawPublicBase(services));
    publicBaseOk = true;
  } catch (e) {
    publicBaseReason = e.message;
  }
  return {
    credentials,
    publicBaseOk,
    portraitReady: credentials && publicBaseOk,
    reason: credentials ? (publicBaseOk ? null : publicBaseReason) : '未配置火山 AK/SK',
    portraitReason: credentials ? (publicBaseOk ? null : publicBaseReason) : '未配置火山 AK/SK',
  };
}

function assertPortraitReady(services) {
  const ready = volcReadiness(services);
  if (!ready.credentials) {
    const e = new Error(ready.reason);
    e.code = 'volc_unconfigured';
    throw e;
  }
  if (!ready.publicBaseOk) {
    const e = new Error(ready.portraitReason);
    e.code = 'public_base';
    throw e;
  }
  return ready;
}

async function arkCall(services, action, body, volc) {
  if (typeof volc === 'function') return volc(action, body);
  const cfg = resolveVolcCredentials(services, 'volc_portrait');
  return volcOpenApi(cfg, {
    host: ARK_HOST,
    service: ARK_SERVICE,
    region: 'cn-beijing',
    action,
    version: ARK_VERSION,
    method: 'POST',
    body,
    timeoutMs: 60000,
  });
}

function hasConsent(db, userId) {
  if (!userId) return false;
  const row = db.prepare(
    'SELECT user_id FROM user_consents WHERE user_id=? AND kind=?'
  ).get(Number(userId), CONSENT_KIND);
  return !!row;
}

function acceptConsent(db, userId) {
  ensureSchema(db);
  if (!userId) {
    const e = new Error('需要登录后再确认权属');
    e.code = 'consent_required';
    throw e;
  }
  db.prepare(`
    INSERT INTO user_consents (user_id, kind, accepted_at)
    VALUES (?, ?, ?)
    ON CONFLICT(user_id, kind) DO UPDATE SET accepted_at=excluded.accepted_at
  `).run(Number(userId), CONSENT_KIND, Date.now());
  return { accepted: true };
}

function requireConsent(db, userId) {
  ensureSchema(db);
  if (!hasConsent(db, userId)) {
    const e = new Error('请先确认虚拟人像的权属与合规条件');
    e.code = 'consent_required';
    throw e;
  }
}

function assetFile(config, fid, fileName) {
  const dir = path.join(config.dataDir, 'cache', 'originals');
  const exts = [];
  if (fileName) {
    const ext = path.extname(fileName);
    if (ext) exts.push(ext);
  }
  for (const ext of ['.jpg', '.jpeg', '.png', '.webp', '.bmp', '.gif', '.tif', '.tiff', '.heic', '.heif']) {
    if (!exts.includes(ext)) exts.push(ext);
  }
  for (const ext of exts) {
    const abs = path.join(dir, `${fid}${ext}`);
    if (fs.existsSync(abs)) return abs;
  }
  return null;
}

async function readImageMeta(buffer, fileName) {
  let meta;
  try {
    meta = await sharp(buffer, { failOn: 'none' }).rotate().metadata();
  } catch (e) {
    const err = new Error(`无法读取图片: ${e.message || '格式不受支持'}`);
    err.code = 'image_invalid';
    throw err;
  }
  if (!meta || !meta.width || !meta.height) {
    const err = new Error('无法读取图片尺寸');
    err.code = 'image_invalid';
    throw err;
  }
  return validateImageMeta({
    width: meta.width,
    height: meta.height,
    bytes: buffer.length,
    fileName,
    mime: meta.format ? `image/${meta.format}` : '',
  });
}

function storeUpload(services, buffer, fileName) {
  const ext = path.extname(fileName || '').toLowerCase() || '.jpg';
  if (INGEST_EXT.has(ext)) {
    const ingest = require('./ingest');
    return ingest.ingestBuffer(services, {
      buffer,
      fileName: fileName || `portrait${ext}`,
      source: 'portrait_library',
    }).then((saved) => {
      services.db.prepare("UPDATE assets SET category='portrait', updated_at=? WHERE fid=?")
        .run(Date.now(), saved.fid);
      return saved.fid;
    });
  }
  const sha = crypto.createHash('sha256').update(buffer).digest('hex');
  const fid = `local_${sha.slice(0, 24)}`;
  const destName = `${fid}${ext}`;
  const abs = path.join(services.config.dataDir, 'cache', 'originals', destName);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, buffer);
  const now = Date.now();
  const hit = services.db.prepare('SELECT fid FROM assets WHERE fid=?').get(fid);
  if (!hit) {
    services.db.prepare(`
      INSERT INTO assets (
        fid, kind, file_name, size, status, source, sha256, category,
        created_at, discovered_at, updated_at
      ) VALUES (?, 'image', ?, ?, 'discovered', 'portrait_library', ?, 'portrait', ?, ?, ?)
    `).run(fid, fileName || destName, buffer.length, sha, now, now, now);
  } else {
    services.db.prepare("UPDATE assets SET category='portrait', updated_at=? WHERE fid=?").run(now, fid);
  }
  return Promise.resolve(fid);
}

function publicFetchUrl(services, assetRow) {
  const base = assertPublicHttpsBase(rawPublicBase(services));
  const token = signFetchToken({
    id: assetRow.id,
    exp: assetRow.fetch_exp,
    nonce: assetRow.fetch_nonce,
    secret: fetchSecret(services),
  });
  return `${base}/api/portrait-library/fetch/${token}`;
}

function rotateNonce(db, id) {
  const nonce = newNonce();
  db.prepare('UPDATE portrait_assets SET fetch_nonce=?, updated_at=? WHERE id=?')
    .run(nonce, Date.now(), id);
  return nonce;
}

function markTerminal(db, id, status, error) {
  db.prepare(`
    UPDATE portrait_assets
    SET status=?, error=?, fetch_nonce=?, updated_at=?
    WHERE id=?
  `).run(status, error || null, newNonce(), Date.now(), id);
}

function toPublicAsset(row) {
  return {
    id: row.id,
    groupId: row.group_id,
    sourceFid: row.source_fid,
    volcAssetId: row.volc_asset_id || '',
    name: row.name || '',
    status: row.status,
    error: row.error || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

async function refreshAsset(services, row, volc) {
  if (!row || row.status === 'Active' || row.status === 'Failed') return row;
  const now = Date.now();
  if (row.fetch_exp && row.fetch_exp < now) {
    markTerminal(services.db, row.id, 'Failed', '火山未在签名有效期内拉取该文件');
    return services.db.prepare('SELECT * FROM portrait_assets WHERE id=?').get(row.id);
  }
  if (!row.volc_asset_id) return row;
  let info;
  try {
    info = await arkCall(services, 'GetAsset', {
      Id: row.volc_asset_id,
      ProjectName: projectName(services),
    }, volc);
  } catch {
    return row;
  }
  const status = info && info.Status;
  if (status === 'Active') {
    markTerminal(services.db, row.id, 'Active', null);
  } else if (status === 'Failed') {
    const msg = (info && (info.Error || info.Message)) || '火山处理失败';
    markTerminal(services.db, row.id, 'Failed', typeof msg === 'string' ? msg : '火山处理失败');
  }
  return services.db.prepare('SELECT * FROM portrait_assets WHERE id=?').get(row.id);
}

async function listLibrary(services, volc) {
  ensureSchema(services.db);
  const pending = services.db.prepare(
    "SELECT * FROM portrait_assets WHERE status='Processing'"
  ).all();
  for (const row of pending) {
    await refreshAsset(services, row, volc);
  }
  const groups = services.db.prepare(
    'SELECT * FROM portrait_groups ORDER BY id DESC'
  ).all();
  return groups.map((g) => ({
    id: g.id,
    name: g.name,
    volcGroupId: g.volc_group_id,
    projectName: g.project_name,
    createdBy: g.created_by,
    createdAt: g.created_at,
    assets: services.db.prepare(
      'SELECT * FROM portrait_assets WHERE group_id=? ORDER BY id ASC'
    ).all(g.id).map(toPublicAsset),
  }));
}

async function createGroup(services, { name, description, userId, volc }) {
  ensureSchema(services.db);
  requireConsent(services.db, userId);
  assertPortraitReady(services);
  const label = String(name || '').trim();
  if (!label) {
    const e = new Error('请填写角色名称');
    e.code = 'invalid';
    throw e;
  }
  const project = projectName(services);
  const result = await arkCall(services, 'CreateAssetGroup', {
    Name: label,
    Description: description || '',
    GroupType: 'AIGC',
    ProjectName: project,
  }, volc);
  const volcId = result && (result.Id || result.id);
  if (!volcId) {
    const e = new Error('CreateAssetGroup 未返回素材组 Id');
    e.code = 'volc_error';
    throw e;
  }
  const now = Date.now();
  const inserted = services.db.prepare(`
    INSERT INTO portrait_groups (name, volc_group_id, project_name, created_by, created_at)
    VALUES (?, ?, ?, ?, ?)
  `).run(label, volcId, project, userId || null, now);
  return {
    id: Number(inserted.lastInsertRowid),
    name: label,
    volcGroupId: volcId,
    projectName: project,
  };
}

async function addAsset(services, { groupId, fid, buffer, fileName, name, userId, volc }) {
  ensureSchema(services.db);
  requireConsent(services.db, userId);
  assertPortraitReady(services);
  const group = services.db.prepare('SELECT * FROM portrait_groups WHERE id=?').get(Number(groupId));
  if (!group) {
    const e = new Error('素材组不存在');
    e.code = 'not_found';
    throw e;
  }
  let sourceFid = fid ? String(fid) : '';
  let bytes = buffer;
  let label = fileName || name || '';
  if (sourceFid) {
    const asset = services.db.prepare('SELECT fid, file_name FROM assets WHERE fid=?').get(sourceFid);
    if (!asset) {
      const e = new Error('源图片不存在');
      e.code = 'fid_missing';
      throw e;
    }
    const abs = assetFile(services.config, sourceFid, asset.file_name);
    if (!abs) {
      const e = new Error('源图片文件不在本地');
      e.code = 'fid_missing';
      throw e;
    }
    bytes = fs.readFileSync(abs);
    label = label || asset.file_name || path.basename(abs);
    services.db.prepare("UPDATE assets SET category='portrait', updated_at=? WHERE fid=?")
      .run(Date.now(), sourceFid);
  } else if (bytes && bytes.length) {
    label = label || 'portrait.jpg';
    sourceFid = await storeUpload(services, bytes, label);
  } else {
    const e = new Error('请上传图片或指定已有素材');
    e.code = 'invalid';
    throw e;
  }
  const meta = await readImageMeta(bytes, label);
  const now = Date.now();
  const nonce = newNonce();
  const exp = now + FETCH_TTL_MS;
  const inserted = services.db.prepare(`
    INSERT INTO portrait_assets (
      group_id, source_fid, volc_asset_id, name, status, error,
      fetch_nonce, fetch_exp, created_by, created_at, updated_at
    ) VALUES (?, ?, '', ?, 'Processing', NULL, ?, ?, ?, ?, ?)
  `).run(group.id, sourceFid, name || label, nonce, exp, userId || null, now, now);
  const localId = Number(inserted.lastInsertRowid);
  const row = services.db.prepare('SELECT * FROM portrait_assets WHERE id=?').get(localId);
  let url;
  try {
    url = publicFetchUrl(services, row);
  } catch (e) {
    markTerminal(services.db, localId, 'Failed', e.message);
    throw e;
  }
  try {
    const created = await arkCall(services, 'CreateAsset', {
      GroupId: group.volc_group_id,
      URL: url,
      AssetType: 'Image',
      Name: name || label || '',
      ProjectName: group.project_name || projectName(services),
    }, volc);
    const volcId = created && (created.Id || created.id);
    if (!volcId) throw new Error('CreateAsset 未返回素材 Id');
    services.db.prepare('UPDATE portrait_assets SET volc_asset_id=?, updated_at=? WHERE id=?')
      .run(volcId, Date.now(), localId);
  } catch (e) {
    markTerminal(services.db, localId, 'Failed', e.message);
    throw e;
  }
  const saved = services.db.prepare('SELECT * FROM portrait_assets WHERE id=?').get(localId);
  return toPublicAsset(saved);
}

function canDelete(row, user) {
  if (!user) return false;
  if (user.role === 'admin') return true;
  return Number(row.created_by) === Number(user.id);
}

async function deleteAsset(services, { id, user, volc }) {
  ensureSchema(services.db);
  const row = services.db.prepare('SELECT * FROM portrait_assets WHERE id=?').get(Number(id));
  if (!row) {
    const e = new Error('素材不存在');
    e.code = 'not_found';
    throw e;
  }
  if (!canDelete(row, user)) {
    const e = new Error('只有上传者或管理员可以删除');
    e.code = 'forbidden';
    throw e;
  }
  if (row.volc_asset_id) {
    await arkCall(services, 'DeleteAsset', {
      Id: row.volc_asset_id,
      ProjectName: projectName(services),
    }, volc);
  }
  rotateNonce(services.db, row.id);
  services.db.prepare('DELETE FROM portrait_assets WHERE id=?').run(row.id);
  return { id: row.id, deleted: true };
}

async function deleteGroup(services, { id, user, volc }) {
  ensureSchema(services.db);
  const group = services.db.prepare('SELECT * FROM portrait_groups WHERE id=?').get(Number(id));
  if (!group) {
    const e = new Error('素材组不存在');
    e.code = 'not_found';
    throw e;
  }
  if (!canDelete(group, user)) {
    const e = new Error('只有创建者或管理员可以删除素材组');
    e.code = 'forbidden';
    throw e;
  }
  if (group.volc_group_id) {
    await arkCall(services, 'DeleteAssetGroup', {
      Id: group.volc_group_id,
      ProjectName: group.project_name || projectName(services),
    }, volc);
  }
  const assets = services.db.prepare('SELECT id FROM portrait_assets WHERE group_id=?').all(group.id);
  for (const asset of assets) rotateNonce(services.db, asset.id);
  services.db.prepare('DELETE FROM portrait_assets WHERE group_id=?').run(group.id);
  services.db.prepare('DELETE FROM portrait_groups WHERE id=?').run(group.id);
  return { id: group.id, deleted: true };
}

function loadActivePortraits(db, ids) {
  ensureSchema(db);
  const list = Array.isArray(ids) ? ids : [];
  const out = [];
  for (const raw of list) {
    const row = db.prepare(`
      SELECT a.*, g.name AS group_name
      FROM portrait_assets a
      JOIN portrait_groups g ON g.id = a.group_id
      WHERE a.id=?
    `).get(Number(raw));
    if (!row) {
      const e = new Error('人像不在本系统素材库中');
      e.code = 'portrait_missing';
      throw e;
    }
    if (row.status !== 'Active' || !row.volc_asset_id) {
      const e = new Error('虚拟人像尚未入库完成，不能用于视频');
      e.code = 'portrait_not_active';
      throw e;
    }
    out.push({
      id: row.id,
      name: row.group_name,
      groupName: row.group_name,
      volc_asset_id: row.volc_asset_id,
    });
  }
  return out;
}

function serveFetch(services, token, res) {
  ensureSchema(services.db);
  const data = verifyFetchToken(token, fetchSecret(services));
  const gone = () => {
    res.writeHead(410, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: '素材地址已失效' }));
  };
  if (!data) return gone();
  const row = services.db.prepare('SELECT * FROM portrait_assets WHERE id=?').get(data.id);
  if (!row || row.fetch_nonce !== data.nonce || row.status !== 'Processing') return gone();
  if (!row.fetch_exp || row.fetch_exp < Date.now() || data.exp < Date.now()) return gone();
  const asset = row.source_fid
    ? services.db.prepare('SELECT file_name FROM assets WHERE fid=?').get(row.source_fid)
    : null;
  const abs = row.source_fid ? assetFile(services.config, row.source_fid, asset && asset.file_name) : null;
  if (!abs) return gone();
  const buf = fs.readFileSync(abs);
  const ext = path.extname(abs).slice(1).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Content-Length': buf.length,
    'Cache-Control': 'private, max-age=60',
  });
  res.end(buf);
  return true;
}

function httpError(res, sendJson, err) {
  const code = err && err.code;
  const status = code === 'forbidden' ? 403
    : code === 'not_found' || code === 'fid_missing' ? 404
      : code === 'consent_required' ? 403
        : 400;
  return sendJson(res, status, { success: false, error: err.message, code: code || 'error' });
}

async function handlePortraitApi(services, req, res, pathname, ctx) {
  if (!pathname.startsWith('/portrait-library')) return false;
  const { sendJson, parseBody, sessionUser, isAdmin } = ctx;
  const user = sessionUser
    ? { id: sessionUser.id, role: isAdmin ? 'admin' : sessionUser.role, username: sessionUser.username }
    : null;

  const fetchMatch = pathname.match(/^\/portrait-library\/fetch\/([^/]+)$/);
  if (fetchMatch && req.method === 'GET') {
    serveFetch(services, decodeURIComponent(fetchMatch[1]), res);
    return true;
  }

  if (!user) {
    sendJson(res, 401, { error: '未登录或会话已过期' });
    return true;
  }
  ensureSchema(services.db);

  try {
    if (pathname === '/portrait-library/catalog' && req.method === 'GET') {
      const data = await listMergedCatalog(services);
      sendJson(res, 200, { success: true, data });
      return true;
    }
    if (pathname === '/portrait-library' && req.method === 'GET') {
      const groups = await listLibrary(services);
      sendJson(res, 200, {
        success: true,
        data: { consented: hasConsent(services.db, user.id), groups },
      });
      return true;
    }
    if (pathname === '/portrait-library/consent' && req.method === 'GET') {
      sendJson(res, 200, { success: true, data: { accepted: hasConsent(services.db, user.id) } });
      return true;
    }
    if (pathname === '/portrait-library/consent' && req.method === 'POST') {
      const body = await parseBody(req);
      if (!body || body.accepted !== true) {
        sendJson(res, 400, { success: false, error: '需要确认三项权属条件' });
        return true;
      }
      sendJson(res, 200, { success: true, data: acceptConsent(services.db, user.id) });
      return true;
    }
    if (pathname === '/portrait-library/groups' && req.method === 'POST') {
      const body = await parseBody(req);
      const group = await createGroup(services, {
        name: body.name,
        description: body.description,
        userId: user.id,
      });
      sendJson(res, 200, { success: true, data: group });
      return true;
    }
    const addMatch = pathname.match(/^\/portrait-library\/groups\/(\d+)\/assets$/);
    if (addMatch && req.method === 'POST') {
      const ct = String(req.headers['content-type'] || '');
      let fid = '';
      let buffer = null;
      let fileName = '';
      let name = '';
      if (ct.includes('multipart/form-data')) {
        const ingest = require('./ingest');
        const buf = await ingest.readRequestBuffer(req, 30 * 1024 * 1024);
        const parsed = ingest.parseMultipart(buf, ct);
        const file = (parsed.files || []).find((f) => f.name === 'file') || (parsed.files || [])[0];
        if (!file) {
          sendJson(res, 400, { success: false, error: '缺少 file' });
          return true;
        }
        buffer = file.data;
        fileName = file.filename || 'portrait.jpg';
        name = parsed.fields.name || fileName;
      } else {
        const body = await parseBody(req);
        fid = body.fid || '';
        name = body.name || '';
      }
      const asset = await addAsset(services, {
        groupId: Number(addMatch[1]),
        fid,
        buffer,
        fileName,
        name,
        userId: user.id,
      });
      sendJson(res, 200, { success: true, data: asset });
      return true;
    }
    const delAsset = pathname.match(/^\/portrait-library\/assets\/(\d+)$/);
    if (delAsset && req.method === 'DELETE') {
      const out = await deleteAsset(services, { id: Number(delAsset[1]), user });
      sendJson(res, 200, { success: true, data: out });
      return true;
    }
    const delGroup = pathname.match(/^\/portrait-library\/groups\/(\d+)$/);
    if (delGroup && req.method === 'DELETE') {
      const out = await deleteGroup(services, { id: Number(delGroup[1]), user });
      sendJson(res, 200, { success: true, data: out });
      return true;
    }
  } catch (err) {
    httpError(res, sendJson, err);
    return true;
  }
  sendJson(res, 404, { error: '未知的人像库接口' });
  return true;
}

function remoteItemsFrom(payload) {
  const root = payload && (payload.Result || payload.result || payload);
  const list = (root && (root.Items || root.items || root.Assets || root.assets)) || [];
  return Array.isArray(list) ? list : [];
}

async function listRemoteAssets(services) {
  const project = projectName(services);
  const out = [];
  for (const groupType of ['AIGC', 'LivenessFace']) {
    let page = 1;
    while (page <= 20) {
    const payload = await arkCall(services, 'ListAssets', {
      ProjectName: project,
      Filter: { GroupType: groupType },
      PageNumber: page,
      PageSize: 50,
    });
    const batch = remoteItemsFrom(payload);
    for (const item of batch) {
      const id = item.Id || item.id || '';
      if (!id) continue;
      out.push({
        id,
        name: item.Name || item.name || id,
        url: item.URL || item.Url || item.url || '',
        status: item.Status || item.status || '',
        groupId: item.GroupId || item.groupId || '',
      });
    }
    if (batch.length < 50) break;
      page += 1;
    }
  }
  return out;
}

function ensureLibraryFid(db) {
  const cols = db.prepare('PRAGMA table_info(portrait_assets)').all().map((c) => c.name);
  if (!cols.includes('library_fid')) {
    db.exec('ALTER TABLE portrait_assets ADD COLUMN library_fid TEXT');
  }
}

async function listMergedCatalog(services) {
  ensureSchema(services.db);
  ensureLibraryFid(services.db);
  try { require('./favorites').ensureFavoriteColumn(services.db); } catch (_) {}
  let locals = [];
  try {
    locals = services.db.prepare(`
      SELECT fid, file_name, width, height, created_at
      FROM assets
      WHERE category='portrait' AND status='ready'
        AND COALESCE(source, '') != 'portrait_redraw_carrier'
      ORDER BY COALESCE(created_at, 0) DESC
    `).all();
  } catch (_) {
    locals = [];
  }
  const pending = services.db.prepare("SELECT * FROM portrait_assets WHERE status='Processing'").all();
  for (const row of pending) {
    try { await refreshAsset(services, row); } catch (_) {}
  }
  const links = services.db.prepare('SELECT * FROM portrait_assets').all();
  const byFid = new Map();
  for (const row of links) {
    const key = row.library_fid || row.source_fid;
    if (key && row.volc_asset_id) byFid.set(key, row);
  }
  let remote = [];
  let remoteError = '';
  try {
    remote = await listRemoteAssets(services);
  } catch (e) {
    remoteError = e.message || '火山列表不可用';
  }
  const seenVolc = new Set();
  const items = [];
  for (const asset of locals) {
    const link = byFid.get(asset.fid);
    const volcId = link ? link.volc_asset_id : '';
    if (volcId) seenVolc.add(volcId);
    const redraw = services.db.prepare(
      "SELECT id, kind, width, height FROM derivatives WHERE asset_fid=? AND kind='portrait_redraw' ORDER BY id DESC LIMIT 1"
    ).get(asset.fid);
    const derivativeId = redraw ? redraw.id : 0;
    items.push({
      fid: asset.fid,
      fileName: asset.file_name || asset.fid,
      width: (redraw && redraw.width) || asset.width || 0,
      height: (redraw && redraw.height) || asset.height || 0,
      place: volcId ? 'both' : 'local',
      placeLabel: volcId ? '两边都有' : '仅本地',
      volcAssetId: volcId || '',
      volcStatus: link ? link.status : '',
      derivativeId,
      derivativeKind: redraw ? redraw.kind : '',
      previewUrl: `/api/viewer/assets/${encodeURIComponent(asset.fid)}/image?local=1${derivativeId ? `&derivative=${derivativeId}` : ''}`,
      createdAt: asset.created_at || 0,
    });
  }
  for (const item of remote) {
    if (seenVolc.has(item.id)) continue;
    items.push({
      fid: '',
      fileName: item.name,
      width: 0,
      height: 0,
      place: 'volc',
      placeLabel: '仅火山',
      volcAssetId: item.id,
      previewUrl: item.url,
      status: item.status,
      createdAt: 0,
    });
  }
  return { items, remoteError };
}

async function replaceUploadedPortrait(services, { fid, buffer, fileName, name, user }) {
  ensureSchema(services.db);
  const userId = user && user.id;
  if (!hasConsent(services.db, userId)) {
    const err = new Error('上传火山人像库前需要先确认权属');
    err.code = 'consent_required';
    throw err;
  }
  let group = services.db.prepare('SELECT * FROM portrait_groups ORDER BY id ASC LIMIT 1').get();
  if (!group) {
    const created = await createGroup(services, { name: '默认人像', userId });
    group = services.db.prepare('SELECT * FROM portrait_groups WHERE id=?').get(created.id);
  }
  ensureLibraryFid(services.db);
  const previous = services.db.prepare(
    'SELECT * FROM portrait_assets WHERE library_fid=? OR source_fid=? ORDER BY id DESC'
  ).all(fid, fid);
  const carrierFid = `prd_${crypto.randomBytes(8).toString('hex')}`;
  const abs = path.join(services.config.dataDir, 'cache', 'originals', `${carrierFid}.jpg`);
  fs.mkdirSync(path.dirname(abs), { recursive: true });
  fs.writeFileSync(abs, buffer);
  const now = Date.now();
  const sha = crypto.createHash('sha256').update(buffer).digest('hex');
  services.db.prepare(`
    INSERT INTO assets (
      fid, kind, file_name, size, status, source, sha256, category,
      created_at, discovered_at, updated_at
    ) VALUES (?, 'image', ?, ?, 'ready', 'portrait_redraw_carrier', ?, 'portrait', ?, ?, ?)
  `).run(carrierFid, fileName || 'portrait.jpg', buffer.length, sha, now, now, now);
  const uploaded = await addAsset(services, {
    groupId: group.id,
    fid: carrierFid,
    name: name || fileName || 'portrait',
    userId,
  });
  services.db.prepare("UPDATE assets SET category='portrait', updated_at=? WHERE fid=?").run(Date.now(), fid);
  services.db.prepare('UPDATE portrait_assets SET library_fid=? WHERE id=?').run(fid, uploaded.id);
  let latest = services.db.prepare('SELECT * FROM portrait_assets WHERE id=?').get(uploaded.id);
  for (let i = 0; i < 6 && latest && latest.status === 'Processing'; i += 1) {
    await new Promise((resolve) => setTimeout(resolve, 3000));
    latest = await refreshAsset(services, latest);
  }
  const warnings = [];
  for (const old of previous) {
    if (Number(old.id) === Number(uploaded.id)) continue;
    try {
      await deleteAsset(services, { id: old.id, user: user || { id: userId, role: 'admin' } });
    } catch (e) {
      warnings.push(e.message);
    }
  }
  return { ...uploaded, status: latest && latest.status, sourceFid: fid, warnings };
}

module.exports = {
  ensureSchema,
  volcReadiness,
  hasConsent,
  acceptConsent,
  listLibrary,
  listMergedCatalog,
  createGroup,
  addAsset,
  deleteAsset,
  deleteGroup,
  loadActivePortraits,
  serveFetch,
  handlePortraitApi,
  refreshAsset,
  publicFetchUrl,
  replaceUploadedPortrait,
};
