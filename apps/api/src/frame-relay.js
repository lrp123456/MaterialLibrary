/**
 * 帧中继 (Frame Relay)
 * -------------------
 * Agnes Video / Seedance 等云端视频接口要求 first_frame / last_frame / images
 * 必须是「公网可拉取」的 http(s) URL，而创作工坊为了会话可移植会把本地上传图、
 * 素材库缩略图、blob 转成 data:image/...;base64 或 /api/... 相对路径。
 *
 * 本模块把这些引用统一落盘到 dataDir/cache/frames/<sha256>.<ext>，再签发带
 * HMAC 与有效期的公网 URL：
 *
 *   ${BFF_PUBLIC_BASE}/api/viewer/frames/<frameId>.<ext>?media_token=<hmac>
 *
 * /frames 路由不依赖会话（供应商云端没有我们的 Cookie），只认 media_token，
 * 与 /api/viewer/assets/:fid/image?media_token=... 的免登设计一致。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const auth = require('./auth');

const FRAME_TTL_MS = 6 * 3600 * 1000; // 文件寿命：6 小时（供应商一般在提交后数分钟内拉取）
const TOKEN_TTL_SECONDS = 6 * 3600;
const MAX_BYTES = 25 * 1024 * 1024;
const MIME_EXT = {
  'image/jpeg': '.jpg',
  'image/jpg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'image/bmp': '.bmp',
  'audio/mpeg': '.mp3',
  'audio/mp3': '.mp3',
  'audio/wav': '.wav',
  'audio/x-wav': '.wav',
  'audio/aac': '.aac',
  'audio/flac': '.flac',
  'video/mp4': '.mp4',
};
const EXT_MIME = {
  '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png',
  '.webp': 'image/webp', '.gif': 'image/gif', '.bmp': 'image/bmp',
  '.mp3': 'audio/mpeg', '.wav': 'audio/wav', '.aac': 'audio/aac',
  '.flac': 'audio/flac', '.mp4': 'video/mp4',
};

function framesDir(config) {
  const dir = path.join(config.dataDir, 'cache', 'frames');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function resolvePublicBase(services) {
  const db = services.db;
  let kv = '';
  try {
    kv = db.prepare('SELECT value FROM kv WHERE key=?').get('bff_public_base')?.value || '';
  } catch (_) { /* kv 表缺失时忽略 */ }
  const base = String(kv || process.env.BFF_PUBLIC_BASE || services.config?.bffPublicBase || '').replace(/\/+$/, '');
  return base;
}

function isHttpUrl(u) {
  return typeof u === 'string' && /^https?:\/\//i.test(u.trim());
}

function sniffMime(buf, hint = '') {
  if (buf.length >= 12) {
    const hex = buf.slice(0, 12).toString('hex');
    if (hex.startsWith('ffd8ff')) return 'image/jpeg';
    if (hex.startsWith('89504e470d0a1a0a')) return 'image/png';
    if (buf.slice(0, 4).toString('ascii') === 'RIFF' && buf.slice(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
    if (hex.startsWith('47494638')) return 'image/gif';
    if (hex.startsWith('424d')) return 'image/bmp';
    if (hex.slice(8, 16) === '66747970') return 'video/mp4';
    if (buf[0] === 0x49 && buf[1] === 0x44 && buf[2] === 0x33) return 'audio/mpeg';
  }
  const m = String(hint).match(/data:([\w.+-]+\/[\w.+-]+)/i);
  if (m) return m[1].toLowerCase();
  return MIME_EXT[String(hint).toLowerCase()] ? String(hint).toLowerCase() : 'image/jpeg';
}

function decodeDataUrl(raw) {
  const m = String(raw).match(/^data:([\w.+-]+\/[\w.+-]+)?(;[\w=]+)*,([\s\S]*)$/i);
  if (!m) return null;
  const mime = (m[1] || 'image/jpeg').toLowerCase();
  const isB64 = String(m[2] || '').includes('base64') || /^[A-Za-z0-9+/=\s]+$/.test(m[3].slice(0, 64));
  let buf;
  try {
    buf = isB64 ? Buffer.from(m[3], 'base64') : Buffer.from(decodeURIComponent(m[3]));
  } catch (_) {
    return null;
  }
  if (!buf.length) return null;
  return { buf, mime: sniffMime(buf, mime) };
}

let lastSweep = 0;
function sweepFrames(config) {
  const now = Date.now();
  if (now - lastSweep < 10 * 60 * 1000) return; // 每个进程最多 10 分钟扫一次
  lastSweep = now;
  try {
    const dir = framesDir(config);
    for (const name of fs.readdirSync(dir)) {
      const fp = path.join(dir, name);
      try {
        const st = fs.statSync(fp);
        if (st.isFile() && now - st.mtimeMs > FRAME_TTL_MS) fs.unlinkSync(fp);
      } catch (_) { /* 跳过单个失败文件 */ }
    }
  } catch (_) { /* 忽略清理错误 */ }
}

/**
 * 把一张参考帧落盘，返回 frameId（不含扩展名）。
 */
function persistBuffer(config, buf, mime) {
  if (!buf || !buf.length) throw new Error('参考帧为空');
  if (buf.length > MAX_BYTES) {
    throw new Error(`参考帧过大（${Math.round(buf.length / 1024 / 1024)}MB > 25MB），请压缩后再试`);
  }
  const ext = MIME_EXT[mime] || '.jpg';
  const frameId = crypto.createHash('sha256').update(buf).digest('hex').slice(0, 32);
  const file = `${frameId}${ext}`;
  const fp = path.join(framesDir(config), file);
  if (!fs.existsSync(fp)) fs.writeFileSync(fp, buf);
  else fs.utimesSync(fp, new Date(), new Date());
  sweepFrames(config);
  return { frameId, ext, mime: EXT_MIME[ext] || mime, bytes: buf.length };
}

/**
 * 从相对路径 / 受控本地路径解析出 buffer。
 * 覆盖：/api/(viewer/)?assets/:fid/image(优先原图/缩略图)、/api/cache/temp/:f、
 *      /api/(viewer/)?ai/masks/:id、受控目录绝对路径。
 */
function readLocalRef(services, raw) {
  const { config, db } = services;
  const s = String(raw).trim();

  // 1. 受控目录绝对路径
  if (!s.startsWith('/') && !/^https?:|^data:/i.test(s)) {
    try {
      const os = require('os');
      const roots = [config.dataDir, process.env.ML_DATA_DIR, path.join(os.homedir(), '.dsh-material-library')];
      const resolved = path.resolve(s);
      const allowed = roots.filter(Boolean).map((r) => path.resolve(r))
        .some((r) => resolved === r || resolved.startsWith(r + path.sep));
      if (allowed && fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
        return { buf: fs.readFileSync(resolved), mime: EXT_MIME[path.extname(resolved).toLowerCase()] || 'image/jpeg' };
      }
    } catch (_) { /* fall through */ }
  }

  // 2. 素材库原图相对路径（缩略图也可，供应商只做首帧参考）
  const mAsset = s.match(/\/api\/(?:viewer\/)?assets\/([^/?#]+)/);
  if (mAsset) {
    const fid = decodeURIComponent(mAsset[1]);
    // 优先缓存原图
    const originals = path.join(config.dataDir, 'cache', 'originals');
    try {
      const hit = fs.readdirSync(originals).find((n) => n.startsWith(fid));
      if (hit) {
        const fp = path.join(originals, hit);
        return { buf: fs.readFileSync(fp), mime: EXT_MIME[path.extname(hit).toLowerCase()] || 'image/jpeg' };
      }
    } catch (_) { /* fall through */ }
    // 退而求其次：缩略图
    const thumb = path.join(config.dataDir, 'cache', 'thumbs', `${fid}.jpg`);
    if (fs.existsSync(thumb)) return { buf: fs.readFileSync(thumb), mime: 'image/jpeg' };
    // derivatives
    try {
      const row = db.prepare("SELECT storage_ref FROM derivatives WHERE asset_fid=? AND kind='origin' LIMIT 1").get(fid);
      if (row?.storage_ref) {
        const fp = path.isAbsolute(row.storage_ref)
          ? row.storage_ref
          : path.join(config.dataDir, row.storage_ref);
        if (fs.existsSync(fp)) {
          return { buf: fs.readFileSync(fp), mime: EXT_MIME[path.extname(fp).toLowerCase()] || 'image/jpeg' };
        }
      }
    } catch (_) { /* fall through */ }
  }

  // 3. AI 遮罩
  const mMask = s.match(/\/api\/(?:viewer\/)?ai\/masks\/([^/?#]+)/);
  if (mMask) {
    try {
      const { resolveMaskFile } = require('./umbra');
      const mp = resolveMaskFile(config, decodeURIComponent(mMask[1]));
      if (mp && fs.existsSync(mp)) {
        return { buf: fs.readFileSync(mp), mime: EXT_MIME[path.extname(mp).toLowerCase()] || 'image/png' };
      }
    } catch (_) { /* fall through */ }
  }

  // 4. 临时缓存
  const mTemp = s.match(/\/api\/cache\/temp\/([^/?#]+)/);
  if (mTemp) {
    const fp = path.join(config.dataDir, 'cache', 'temp', path.basename(decodeURIComponent(mTemp[1])));
    if (fs.existsSync(fp)) {
      return { buf: fs.readFileSync(fp), mime: EXT_MIME[path.extname(fp).toLowerCase()] || 'image/jpeg' };
    }
  }

  return null;
}

/**
 * 通过本机回环拉取相对路径（带不带 media_token 都行：回环请求带不上会话时，
 * 对缩略图/原图尽量走 readLocalRef 直读；直读不到再回环 HTTP）。
 */
async function fetchLoopback(services, raw) {
  const { config } = services;
  const s = String(raw).trim();
  if (!s.startsWith('/')) return null;
  const url = `http://127.0.0.1:${config.port || 30001}${s}`;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) return null;
    const ab = await r.arrayBuffer();
    const buf = Buffer.from(ab);
    return { buf, mime: sniffMime(buf, r.headers.get('content-type') || '') };
  } catch (_) {
    return null;
  }
}

/**
 * 把任意参考帧引用转换为公网 URL。
 * - http(s) 原样透传
 * - data: / 相对路径 / 受控本地路径 → 落盘 cache/frames 并签发 media_token
 * 解析失败时抛出带 code 的错误，供上层给出可操作提示。
 */
async function materializeFrameUrl(services, raw, { label = '参考帧' } = {}) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (!s || s === 'undefined' || s === 'null') return null;

  if (isHttpUrl(s)) return s; // 已是公网/外网 URL，直接透传

  // blob: 只存在于浏览器内存，正常情况下前端已转成 data:；到这里说明前端漏转
  if (s.startsWith('blob:')) {
    const e = new Error(`${label}仍是浏览器临时地址（blob:），请重新上传该图片`);
    e.code = 'frame_blob';
    throw e;
  }

  let decoded = null;
  if (s.startsWith('data:')) {
    decoded = decodeDataUrl(s);
    if (!decoded) {
      const e = new Error(`${label}数据格式无法解析（data URL 损坏），请重新上传`);
      e.code = 'frame_bad_data_url';
      throw e;
    }
  } else {
    decoded = readLocalRef(services, s);
    if (!decoded && s.startsWith('/')) decoded = await fetchLoopback(services, s);
    if (!decoded) {
      const e = new Error(`${label}无法读取（既不是公网 URL，也未能从本机素材库解析），请改用可公网访问的图片地址或重新上传`);
      e.code = 'frame_unresolved';
      throw e;
    }
  }

  const saved = persistBuffer(services.config, decoded.buf, decoded.mime);

  // ★ 优先策略：如果启用了阿里云 OSS，优先直传 OSS 生成标准 443 HTTPS 访问 URL，杜绝非标准端口 30001 被第三方模型拦截
  try {
    const oss = require('./oss');
    if (oss.isOssEnabled(services)) {
      const ossKey = `ai-frames/${saved.frameId}${saved.ext}`;
      const ossRes = await oss.uploadBuffer(decoded.buf, {
        key: ossKey,
        contentType: decoded.mime || 'image/jpeg',
        services
      });
      if (ossRes && ossRes.url) {
        console.log(`[frame-relay] 参考帧已成功上传至阿里云 OSS (443端口): ${ossRes.url}`);
        return ossRes.url;
      }
    }
  } catch (ossErr) {
    console.warn(`[frame-relay] OSS 极速上传遇到问题，回退至本地 BFF 代理: ${ossErr.message}`);
  }

  const base = resolvePublicBase(services);
  if (!base) {
    const e = new Error('未配置公网访问地址（BFF_PUBLIC_BASE）或 OSS，视频云端无法拉取首帧/尾帧。请在「设置 → 运行时配置」填写可公网访问的地址，或改用文生视频');
    e.code = 'public_base_missing';
    throw e;
  }
  // 公网基址指向本机/内网时提前给出可操作错误（允许 http 公网 IP，仅拒绝私网/回环）
  try {
    const { isPrivateHost } = require('./portrait-contract');
    const u = new URL(base);
    if (!['http:', 'https:'].includes(u.protocol) || isPrivateHost(u.hostname)) {
      const e2 = new Error('配置的公网访问地址（BFF_PUBLIC_BASE）指向本机或内网，视频云端无法拉取。请改成可公网访问的地址');
      e2.code = 'public_base_private';
      throw e2;
    }
    // Agnes/火山等云端拉取端通常只放行 80/443：非标准端口很可能被判「素材 URL 无法下载」
    const portWarn = (u.protocol === 'http:' && u.port && u.port !== '80')
      || (u.protocol === 'https:' && u.port && u.port !== '443');
    if (portWarn) {
      console.warn(`[frame-relay] BFF_PUBLIC_BASE 使用了非标准端口 ${u.port}，视频云端可能无法拉取（多数厂商仅放行 80/443）。建议挂 443/80 反向代理。`);
    }
  } catch (err) {
    if (err.code === 'public_base_private') throw err;
    const e = new Error(`公网访问地址无效（BFF_PUBLIC_BASE=${base}），请在「设置 → 运行时配置」中修正`);
    e.code = 'public_base_private';
    throw e;
  }

  const token = auth.generateMediaToken(`frame:${saved.frameId}`, TOKEN_TTL_SECONDS, services.config.dataDir);
  // token 放在路径中段、文件名留在末段：供应商按扩展名做媒体嗅探（query/path 末尾非 .jpg 会被判为「不支持的媒体格式」）
  return `${base}/api/viewer/frames/${encodeURIComponent(token)}/${encodeURIComponent(saved.frameId + saved.ext)}`;
}

/**
 * 批量转换，去重并保留顺序。
 */
async function materializeFrameUrls(services, list, opts) {
  const out = [];
  const seen = new Set();
  for (const item of list || []) {
    const u = await materializeFrameUrl(services, item, opts);
    if (u && !seen.has(u)) {
      seen.add(u);
      out.push(u);
    }
  }
  return out;
}

function frameFileFor(config, frameFile) {
  const name = path.basename(String(frameFile || ''));
  if (!/^[a-f0-9]{32,64}\.(jpg|jpeg|png|webp|gif|bmp|mp3|wav|aac|flac|mp4)$/i.test(name)) return null;
  const fp = path.join(framesDir(config), name);
  return fs.existsSync(fp) ? fp : null;
}

/**
 * 免登公网帧读取：仅认 media_token（HMAC: frame:<frameId>）。
 * 返回 true 表示已响应。
 */
function serveFrame(services, req, res, frameFile, mediaToken) {
  const fp = frameFileFor(services.config, frameFile);
  if (!fp || !mediaToken) {
    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: '帧不存在或已过期' }));
    return true;
  }
  const frameId = path.basename(fp).replace(/\.[^.]+$/, '');
  if (!auth.verifyMediaToken(`frame:${frameId}`, mediaToken, services.config.dataDir)) {
    res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: '帧访问令牌无效或已过期' }));
    return true;
  }
  // 文件寿命兜底
  try {
    const st = fs.statSync(fp);
    if (Date.now() - st.mtimeMs > FRAME_TTL_MS + 3600 * 1000) {
      res.writeHead(410, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({ error: '帧已过期，请重新生成' }));
      return true;
    }
  } catch (_) { /* ignore */ }
  const ext = path.extname(fp).toLowerCase();
  const mime = EXT_MIME[ext] || 'application/octet-stream';
  try {
    const buf = fs.readFileSync(fp);
    res.writeHead(200, {
      'Content-Type': mime,
      'Content-Length': buf.length,
      'Cache-Control': 'public, max-age=21600',
      'Accept-Ranges': 'bytes',
    });
    if (req.method === 'HEAD') return res.end();
    res.end(buf);
  } catch (_) {
    res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify({ error: '帧读取失败' }));
  }
  return true;
}

module.exports = {
  materializeFrameUrl,
  materializeFrameUrls,
  readLocalRef,
  serveFrame,
  resolvePublicBase,
  framesDir,
};
