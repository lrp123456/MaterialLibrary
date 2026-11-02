/**
 * Ba 资源分页拉取。搜索必须带关键词，不能整库列举。
 * 文件进入素材库，来源记为 ba。不写创作库卡片。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const TOKEN_TTL_MS = (10080 - 60) * 60 * 1000;
const MAX_PAGES = 100;
const MAX_BYTES = 200 * 1024 * 1024;
let tokenCache = { base: '', token: '', exp: 0 };

function readConfig() {
  return {
    base: String(process.env.BA_RESOURCE_BASE || '').trim().replace(/\/+$/, ''),
    username: String(process.env.BA_RESOURCE_USER || '').trim(),
    password: String(process.env.BA_RESOURCE_PASSWORD || '').trim(),
  };
}

function ensureLedger(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ba_resources (
      remote_id TEXT PRIMARY KEY,
      type TEXT,
      url TEXT,
      context TEXT,
      info TEXT,
      create_time TEXT,
      fid TEXT,
      status TEXT,
      error TEXT,
      updated_at INTEGER
    );
  `);
  const cols = db.prepare('PRAGMA table_info(assets)').all().map((col) => col.name);
  if (!cols.includes('source_note')) {
    db.exec('ALTER TABLE assets ADD COLUMN source_note TEXT');
  }
}

function joinUrl(base, pathname) {
  const root = base.endsWith('/') ? base : `${base}/`;
  const rel = String(pathname || '').replace(/^\/+/, '');
  return new URL(rel, root).toString();
}

function assertHttpUrl(raw) {
  let url;
  try {
    url = new URL(String(raw || ''));
  } catch {
    throw new Error('资源地址无效');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error('资源地址只接受 http 或 https');
  }
  return url.toString();
}

async function login(config, fetchImpl) {
  const res = await fetchImpl(joinUrl(config.base, '/login'), {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username: config.username, password: config.password }),
    signal: AbortSignal.timeout(20000),
  });
  const json = await res.json().catch(() => ({}));
  const msg = String(json.msg || json.message || '');
  if (/验证码/.test(msg)) {
    const err = new Error('Ba 登录需要验证码，这一轮已停止');
    err.code = 'captcha';
    throw err;
  }
  if (!res.ok || json.code !== 200 || !json.token) {
    throw new Error(msg || 'Ba 登录失败');
  }
  tokenCache = { base: config.base, token: json.token, exp: Date.now() + TOKEN_TTL_MS };
  return json.token;
}

async function getToken(config, fetchImpl, force) {
  if (!force && tokenCache.token && tokenCache.base === config.base && tokenCache.exp > Date.now()) {
    return tokenCache.token;
  }
  return login(config, fetchImpl);
}

function sniffKind(buffer, url, declaredType) {
  const declared = String(declaredType || '').toLowerCase();
  if (declared === 'video' || declared.includes('video')) return 'video';
  if (buffer.length >= 12 && buffer.slice(4, 8).toString() === 'ftyp') return 'video';
  if (buffer.length >= 4 && buffer[0] === 0x1a && buffer[1] === 0x45 && buffer[2] === 0xdf && buffer[3] === 0xa3) return 'video';
  if (/\.(mp4|mov|webm|mkv|m4v)(\?|#|$)/i.test(url)) return 'video';
  return 'image';
}

function fileNameFor(url, kind) {
  try {
    const base = path.basename(new URL(url).pathname);
    if (base && base.includes('.') && base.length < 180) return base;
  } catch { /* 用默认名 */ }
  return kind === 'video' ? 'ba-resource.mp4' : 'ba-resource.jpg';
}

async function downloadResource(url, fetchImpl) {
  const safe = assertHttpUrl(url);
  const res = await fetchImpl(safe, { signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`下载失败 HTTP ${res.status}`);
  const len = Number(res.headers?.get?.('content-length') || 0);
  if (len > MAX_BYTES) throw new Error('资源超过 200MB');
  const buffer = Buffer.from(await res.arrayBuffer());
  if (!buffer.length) throw new Error('空文件');
  if (buffer.length > MAX_BYTES) throw new Error('资源超过 200MB');
  return buffer;
}

async function searchPage(config, fetchImpl, token, { keyword, type, current, size }) {
  const url = new URL(joinUrl(config.base, '/resource/v1/search'));
  url.searchParams.set('keyword', keyword);
  url.searchParams.set('type', type);
  url.searchParams.set('current', String(current));
  url.searchParams.set('size', String(size));
  const res = await fetchImpl(url.toString(), {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(30000),
  });
  const json = await res.json().catch(() => ({}));
  if (res.status === 401 || json.code === 401) {
    const err = new Error('token 失效');
    err.code = 'unauthorized';
    throw err;
  }
  if (!res.ok || json.code !== 200) {
    throw new Error(json.msg || 'Ba 搜索失败');
  }
  const data = json.data || {};
  return {
    records: Array.isArray(data.records) ? data.records : [],
    pages: Number(data.pages) || 1,
    current: Number(data.current) || current,
  };
}

function upsertLedger(db, row) {
  db.prepare(`
    INSERT INTO ba_resources (remote_id, type, url, context, info, create_time, fid, status, error, updated_at)
    VALUES (@remote_id, @type, @url, @context, @info, @create_time, @fid, @status, @error, @updated_at)
    ON CONFLICT(remote_id) DO UPDATE SET
      type=excluded.type,
      url=excluded.url,
      context=excluded.context,
      info=excluded.info,
      create_time=excluded.create_time,
      fid=COALESCE(excluded.fid, ba_resources.fid),
      status=excluded.status,
      error=excluded.error,
      updated_at=excluded.updated_at
  `).run(row);
}

function rememberNote(db, fid, context) {
  if (!fid) return;
  const row = db.prepare('SELECT source, category_locked FROM assets WHERE fid=?').get(fid);
  if (!row || row.source !== 'ba' || row.category_locked) return;
  db.prepare('UPDATE assets SET source_note=?, updated_at=? WHERE fid=?').run(String(context || ''), Date.now(), fid);
}

async function fileIntoLibrary(services, { buffer, fileName, remoteId, context, kind }) {
  const { db, config } = services;
  try { require('./shelf-lineage').ensureColumns(db); } catch { /* 老库缺列时下面的插入会说明原因 */ }
  const sha = crypto.createHash('sha256').update(buffer).digest('hex');
  const clientId = `ba:${remoteId}`;
  const byClient = db.prepare('SELECT fid FROM assets WHERE client_asset_id=?').get(clientId);
  if (byClient) return { fid: byClient.fid, deduped: true };
  const bySha = db.prepare('SELECT fid FROM assets WHERE sha256=?').get(sha);
  if (bySha) return { fid: bySha.fid, deduped: true };

  if (kind === 'image') {
    const { ingestBuffer } = require('./ingest');
    const result = await ingestBuffer(services, {
      buffer,
      fileName,
      source: 'ba',
      clientAssetId: clientId,
      sourceNote: context,
    });
    return result || { fid: '', deduped: false };
  }

  const ext = path.extname(fileName).toLowerCase() || '.mp4';
  const fid = `ba_${sha.slice(0, 24)}`;
  const now = Date.now();
  const destDir = path.join(config.dataDir, 'cache', 'originals');
  fs.mkdirSync(destDir, { recursive: true });
  const absPath = path.join(destDir, `${fid}${ext}`);
  fs.writeFileSync(absPath, buffer);
  let duration = null;
  let width = null;
  let height = null;
  try {
    const meta = await require('./umbra').extractVideoMeta(absPath);
    duration = Number(meta.duration) || null;
    width = Number(meta.width) || null;
    height = Number(meta.height) || null;
  } catch { /* 时长缺失不影响入库 */ }
  const orientation = width && height
    ? (height > width * 1.05 ? 'portrait' : (width > height * 1.05 ? 'landscape' : 'square'))
    : null;
  db.prepare(`
    INSERT INTO assets (
      fid, kind, category, file_name, size, width, height, orientation, duration_s, status, is_ai, source,
      sha256, client_asset_id, source_note, library_shelf, created_at, discovered_at, updated_at
    ) VALUES (?, 'video', 'video', ?, ?, ?, ?, ?, ?, 'discovered', 0, 'ba', ?, ?, ?, 'original', ?, ?, ?)
  `).run(fid, fileName, buffer.length, width, height, orientation, duration, sha, clientId, String(context || ''), now, now, now);
  const { createDerivative, setMainDerivative } = require('./derivatives');
  const deriv = await createDerivative(services, {
    assetFid: fid,
    kind: 'origin',
    srcPath: absPath,
    fileName,
    mime: 'video/mp4',
    params: { source: 'ba', sha256: sha },
  });
  setMainDerivative(db, fid, deriv.id);
  try {
    await require('./video-tags').ensureVideoPoster(config, fid, absPath);
  } catch { /* 海报失败仍可入库，闸门会再试 */ }
  if (services.interpreter) {
    try {
      await services.interpreter.triggerRun({ assetFids: [fid], trigger: 'ingest:ba' });
    } catch (err) {
      services.logger?.warn?.(`[ba] 视频打标未入队 ${fid}: ${err.message}`);
    }
  }
  return { fid, deduped: false };
}

async function pullBaResources(services, opts = {}) {
  const keyword = String(opts.keyword || '').trim();
  const type = String(opts.type || '').trim() || 'all';
  const size = Math.max(1, Math.min(50, Number(opts.size) || 20));
  if (!keyword) {
    const err = new Error('关键词不能为空');
    err.code = 400;
    throw err;
  }
  const config = readConfig();
  if (!config.base || !config.username || !config.password) {
    const err = new Error('未配置 BA_RESOURCE_BASE、BA_RESOURCE_USER、BA_RESOURCE_PASSWORD');
    err.code = 400;
    throw err;
  }
  const fetchImpl = opts.fetchImpl || fetch;
  const ingestFile = opts.ingestFile || fileIntoLibrary;
  const db = services.db;
  ensureLedger(db);
  let token = await getToken(config, fetchImpl, false);
  const summary = { pulled: 0, filed: 0, skipped: 0, failed: 0, cards: 0, errors: [], truncated: false };

  for (let current = 1; current <= MAX_PAGES; current += 1) {
    let page;
    try {
      page = await searchPage(config, fetchImpl, token, { keyword, type, current, size });
    } catch (err) {
      if (err.code === 'unauthorized' && current) {
        token = await getToken(config, fetchImpl, true);
        page = await searchPage(config, fetchImpl, token, { keyword, type, current, size });
      } else {
        throw err;
      }
    }
    if (!page.records.length) break;
    for (const record of page.records) {
      const remoteId = String(record.id ?? '').trim();
      if (!remoteId) continue;
      summary.pulled += 1;
      const now = Date.now();
      const known = db.prepare('SELECT fid FROM ba_resources WHERE remote_id=?').get(remoteId);
      if (known?.fid) {
        upsertLedger(db, {
          remote_id: remoteId,
          type: String(record.type || type),
          url: String(record.url || ''),
          context: String(record.context || ''),
          info: String(record.info || ''),
          create_time: String(record.createTime || ''),
          fid: known.fid,
          status: 'ok',
          error: '',
          updated_at: now,
        });
        rememberNote(db, known.fid, record.context);
        if (upsertCreationCard(db, record)) summary.cards += 1;
        summary.skipped += 1;
        continue;
      }
      try {
        const url = String(record.url || '');
        const buffer = await downloadResource(url, fetchImpl);
        const kind = sniffKind(buffer, url, record.type);
        const filed = await ingestFile(services, {
          buffer,
          fileName: fileNameFor(url, kind),
          remoteId,
          context: String(record.context || ''),
          kind,
        });
        if (filed?.rejected || !filed?.fid) {
          throw new Error(filed?.reason || '未入库');
        }
        rememberNote(db, filed.fid, record.context);
        upsertLedger(db, {
          remote_id: remoteId,
          type: String(record.type || kind),
          url,
          context: String(record.context || ''),
          info: String(record.info || ''),
          create_time: String(record.createTime || ''),
          fid: filed.fid,
          status: 'ok',
          error: '',
          updated_at: now,
        });
        if (upsertCreationCard(db, record)) summary.cards += 1;
        if (filed.deduped) summary.skipped += 1;
        else summary.filed += 1;
      } catch (err) {
        summary.failed += 1;
        if (summary.errors.length < 10) summary.errors.push({ id: remoteId, error: err.message });
        upsertLedger(db, {
          remote_id: remoteId,
          type: String(record.type || ''),
          url: String(record.url || ''),
          context: String(record.context || ''),
          info: String(record.info || ''),
          create_time: String(record.createTime || ''),
          fid: null,
          status: 'error',
          error: String(err.message || '失败').slice(0, 300),
          updated_at: now,
        });
      }
    }
    if (current >= page.pages) break;
    if (current === MAX_PAGES) summary.truncated = true;
  }
  return summary;
}

function ensureCreationColumns(db) {
  const add = (sql) => { try { db.exec(sql); } catch { /* 已有 */ } };
  add("ALTER TABLE creation_templates ADD COLUMN type TEXT DEFAULT 'image'");
  add("ALTER TABLE creation_templates ADD COLUMN space TEXT DEFAULT ''");
  add("ALTER TABLE creation_templates ADD COLUMN style TEXT DEFAULT ''");
  add("ALTER TABLE creation_templates ADD COLUMN is_pinned INTEGER DEFAULT 0");
  add("ALTER TABLE creation_templates ADD COLUMN use_count INTEGER DEFAULT 0");
  add("ALTER TABLE creation_templates ADD COLUMN purpose TEXT DEFAULT ''");
  add("ALTER TABLE creation_templates ADD COLUMN channel TEXT DEFAULT 'studio'");
}

function parseInfo(raw) {
  if (!raw) return {};
  if (typeof raw === 'object') return raw;
  try { return JSON.parse(String(raw)); } catch { return {}; }
}

function upsertCreationCard(db, record) {
  const remoteId = String(record?.id ?? '').trim();
  const prompt = String(record?.context || '').trim();
  if (!remoteId || !prompt) return '';
  ensureCreationColumns(db);
  const info = parseInfo(record.info);
  const typeRaw = String(record.type || 'image').toLowerCase();
  const type = typeRaw.includes('video') ? 'video' : typeRaw.includes('audio') ? 'audio' : 'image';
  const id = `ba_${remoteId}`;
  const refs = (Array.isArray(info.referenceImages) ? info.referenceImages : [])
    .filter(Boolean)
    .map((url) => ({ url: String(url) }));
  const result = record.url ? [{ url: String(record.url) }] : [];
  const ratio = String(info.ratio || (type === 'video' ? '9:16' : '16:9'));
  const purpose = require('./video-tags').purposeFromText(prompt);
  const title = prompt.replace(/\s+/g, ' ').slice(0, 24);
  const params = {
    channel: 'ba',
    model: info.modelId || '',
    ratio,
    resolution: info.resolution || '',
    duration: info.duration || '',
    remoteId,
  };
  const now = Date.now();
  let createdAt = now;
  if (record?.createTime) {
    const raw = String(record.createTime).trim();
    const parsed = new Date(raw).getTime() || new Date(raw.replace(' ', 'T')).getTime();
    if (!Number.isNaN(parsed) && parsed > 0) {
      createdAt = parsed;
    }
  }
  const existing = db.prepare('SELECT id FROM creation_templates WHERE id=?').get(id);
  if (existing) {
    db.prepare(`
      UPDATE creation_templates
      SET prompt=?, aspect_ratio=?, origin_images=?, result_images=?, params_json=?, type=?,
          purpose=CASE WHEN purpose IS NULL OR purpose='' THEN ? ELSE purpose END,
          channel='ba',
          created_at=CASE WHEN ? > 0 THEN ? ELSE created_at END,
          updated_at=?
      WHERE id=?
    `).run(prompt, ratio, JSON.stringify(refs), JSON.stringify(result), JSON.stringify(params), type, purpose, createdAt, createdAt, now, id);
    return id;
  }
  db.prepare(`
    INSERT INTO creation_templates (
      id, user_id, title, prompt, aspect_ratio, origin_images, result_images, params_json, tags,
      type, space, style, purpose, channel, is_pinned, use_count, created_at, updated_at
    ) VALUES (?, 1, ?, ?, ?, ?, ?, ?, ?, ?, '', '', ?, 'ba', 0, 0, ?, ?)
  `).run(
    id, title, prompt, ratio, JSON.stringify(refs), JSON.stringify(result), JSON.stringify(params),
    JSON.stringify(['ba', type]), type, purpose, createdAt, now
  );
  return id;
}

const CATALOG_KEYWORDS = ['的', '图', '生', '视', '一', '我', '帮', '室', '内', '风', '片', '像', '家', '客', '装', '画', '照', '景', '空', '间', '墙', '灯', '门', '窗', '沙', '发', '桌', '椅', '柜', '床'];

async function syncBaCreationCatalog(services, opts = {}) {
  const keywords = Array.isArray(opts.keywords) && opts.keywords.length ? opts.keywords : CATALOG_KEYWORDS;
  const type = String(opts.type || 'all');
  const size = Math.max(1, Math.min(50, Number(opts.size) || 50));
  const config = readConfig();
  if (!config.base || !config.username || !config.password) {
    const err = new Error('未配置 BA_RESOURCE_BASE、BA_RESOURCE_USER、BA_RESOURCE_PASSWORD');
    err.code = 400;
    throw err;
  }
  const fetchImpl = opts.fetchImpl || fetch;
  const db = services.db;
  ensureLedger(db);
  let token = await getToken(config, fetchImpl, false);
  const seen = new Set();
  const summary = { keywords: keywords.length, seen: 0, cards: 0, image: 0, video: 0, failed: 0, truncated: false };
  for (const keyword of keywords) {
    for (let current = 1; current <= MAX_PAGES; current += 1) {
      let page;
      try {
        page = await searchPage(config, fetchImpl, token, { keyword, type, current, size });
      } catch (err) {
        if (err.code === 'unauthorized') {
          token = await getToken(config, fetchImpl, true);
          page = await searchPage(config, fetchImpl, token, { keyword, type, current, size });
        } else {
          summary.failed += 1;
          break;
        }
      }
      if (!page.records.length) break;
      for (const record of page.records) {
        const remoteId = String(record.id ?? '').trim();
        if (!remoteId || seen.has(remoteId)) continue;
        seen.add(remoteId);
        try {
          if (upsertCreationCard(db, record)) {
            summary.cards += 1;
            const kind = String(record.type || '').toLowerCase();
            if (kind.includes('video')) summary.video += 1;
            else summary.image += 1;
          }
        } catch {
          summary.failed += 1;
        }
      }
      if (current >= page.pages) break;
      if (current === MAX_PAGES) summary.truncated = true;
    }
  }
  summary.seen = seen.size;
  return summary;
}

function resetTokenCache() {
  tokenCache = { base: '', token: '', exp: 0 };
}

module.exports = {
  readConfig,
  pullBaResources,
  sniffKind,
  assertHttpUrl,
  resetTokenCache,
  fileIntoLibrary,
  upsertCreationCard,
  syncBaCreationCatalog,
};
