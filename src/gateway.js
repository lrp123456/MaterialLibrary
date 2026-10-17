/**
 * 入库网关（可配置、短路）
 * 顺序（便宜 → 贵）：
 *   ① 指纹查重（sha256/md5/pHash≤阈值）
 *   ② 图像特征（过小 / 低质 / 纯色黑帧 / 黑边白边）
 *   ③ 内容判定（视觉模型，按配置提示词）
 * 命中即停，记首个原因，写 assets.status='rejected' + reject_* 字段。
 *
 * 配置存 gateway_config 表（JSON），Web 管理页可改，热生效。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

const DEFAULT_CONFIG = {
  enabled: true,
  // ① 查重
  dup: {
    enabled: true,
    phashThreshold: 8,
    checkDerivatives: true,
  },
  // ② 图像特征
  size: {
    enabled: true,
    minShortSide: 800,
    minBytes: 100 * 1024,
  },
  quality: {
    enabled: true,
    minLaplacianVar: 12,      // 越小越糊；低于此判低质
    solidColorRatio: 0.985,   // 单色占比超过则判纯色/黑帧
    barCheck: true,           // 黑边/白边检测
    barRatio: 0.06,           // 边缘带占比阈值
  },
  // ③ 内容判定
  content: {
    enabled: true,
    // 直连供应商：'' = 走 LiteLLM 聚合；可选 agnes | volcengine | gemini
    provider: '',
    model: '',                // 空=用激活的 VLM；如 agnes-3.0-flash / doubao-seed-2-1-lite-260915
    // 图像传参方式：dataUrl=base64（多数 OpenAI 兼容端点）；url=公开图片地址（Agnes 文档示例）
    imageMode: 'dataUrl',
    categories: ['interior', 'material', 'exterior', 'furniture'],
    // 文件名降权规则：命中只提高审查优先级，不直接拒
    downweightNamePatterns: ['^screen[_-]', '^current_screen', '^install_ui', '^Screenshot_', '_emu\\.png$'],
    promptTemplate: '',       // 空=用内置 gatePrompt()
  },
  // 拒收原因文案
  reasons: {
    duplicate: '重复素材',
    non_interior: '非室内设计内容',
    life_photo: '生活照/无关内容',
    low_quality: '画质不达标（模糊/纯色/黑帧）',
    too_small: '尺寸或体积过小',
    ai_defect: 'AI 产物缺陷（黑边/白边/水印/畸形）',
  },
  // 恢复原因（按拒收原因动态给选项）
  restoreReasons: {
    duplicate: ['判定错误', '非重复', '是同一稿的不同版本'],
    non_interior: ['判定错误', '这是室内图', '是设计灵感截图'],
    life_photo: ['判定错误', '是室内场景里的人像', '是设计素材'],
    low_quality: ['判定错误', '画质可用', '是细节特写'],
    too_small: ['判定错误', '尺寸可用', '样本素材'],
    ai_defect: ['判定错误', '缺陷可接受', '是设计意图'],
  },
  // AI 产物缺陷闸（只对 AI 衍生）
  aiDefect: {
    enabled: true,
    barCheck: true,
    barRatio: 0.06,
    watermarkReview: true,
  },
  keepDays: 3,
};

/** 每个 db 实例只做一次 DDL，避免被热路径反复调用打满 CPU */
const _ensured = new WeakMap();
let _cfgCache = null; // { db, json, at }

function ensureGatewayTables(db) {
  if (_ensured.get(db)) return;
  _ensured.set(db, true);
  db.exec(`
    CREATE TABLE IF NOT EXISTS gateway_config (
      id TEXT PRIMARY KEY,
      json TEXT NOT NULL,
      updated_at INTEGER
    );
    CREATE TABLE IF NOT EXISTS gateway_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      fid TEXT,
      file_name TEXT,
      action TEXT NOT NULL,        -- rejected | restored | purged | passed
      reason TEXT,
      detail TEXT,
      actor TEXT,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_gateway_events_fid ON gateway_events(fid);
    CREATE INDEX IF NOT EXISTS idx_gateway_events_at ON gateway_events(created_at);
  `);
  const cols = db.prepare('PRAGMA table_info(assets)').all().map((c) => c.name);
  const add = (name, ddl) => {
    if (!cols.includes(name)) db.exec(`ALTER TABLE assets ADD COLUMN ${name} ${ddl};`);
  };
  add('reject_reason', 'TEXT');       // duplicate | non_interior | life_photo | low_quality | too_small | ai_defect
  add('reject_detail', 'TEXT');       // JSON: {message, peerFid, dist, ...}
  add('rejected_at', 'INTEGER');
  add('restored_at', 'INTEGER');
  add('restore_reason', 'TEXT');
  add('restore_note', 'TEXT');
}

function getConfig(db) {
  // 5s 内存缓存：避免热路径反复读表 + 反复 DDL
  if (_cfgCache && _cfgCache.db === db && Date.now() - _cfgCache.at < 5000) {
    return _cfgCache.json;
  }
  ensureGatewayTables(db);
  let merged = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
  try {
    const row = db.prepare("SELECT json FROM gateway_config WHERE id='default'").get();
    if (row && row.json) {
      merged = deepMerge(DEFAULT_CONFIG, JSON.parse(row.json));
    }
  } catch (_) {}
  _cfgCache = { db, json: merged, at: Date.now() };
  return merged;
}

function setConfig(db, patch, { actor = '' } = {}) {
  ensureGatewayTables(db);
  const cur = getConfig(db);
  const next = deepMerge(cur, patch || {});
  db.prepare(`
    INSERT INTO gateway_config (id, json, updated_at) VALUES ('default', ?, ?)
    ON CONFLICT(id) DO UPDATE SET json=excluded.json, updated_at=excluded.updated_at
  `).run(JSON.stringify(next), Date.now());
  _cfgCache = { db, json: next, at: Date.now() };
  logEvent(db, { action: 'config_update', reason: 'gateway_config', detail: JSON.stringify(patch || {}), actor });
  return next;
}

function deepMerge(base, patch) {
  if (Array.isArray(patch)) return patch.slice();
  if (patch && typeof patch === 'object') {
    const out = { ...(base && typeof base === 'object' ? base : {}) };
    for (const [k, v] of Object.entries(patch)) {
      out[k] = deepMerge(out[k], v);
    }
    return out;
  }
  return patch === undefined ? base : patch;
}

function logEvent(db, { fid = '', fileName = '', action, reason = '', detail = '', actor = '' }) {
  try {
    ensureGatewayTables(db);
    db.prepare(`
      INSERT INTO gateway_events (fid, file_name, action, reason, detail, actor, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(fid || '', fileName || '', action, reason || '', detail || '', actor || '', Date.now());
  } catch (_) {}
}

// ---------------- ② 图像特征 ----------------

function hammingHex(a, b) {
  if (!a || !b || a.length !== b.length) return 64;
  let d = 0;
  for (let i = 0; i < a.length; i++) {
    d += bitCount(parseInt(a[i], 16) ^ parseInt(b[i], 16));
  }
  return d;
}
function bitCount(n) {
  let c = 0;
  while (n) {
    c += n & 1;
    n >>= 1;
  }
  return c;
}

/** 边缘纯色带（黑边/白边/letterbox）检测 */
async function detectBars(buffer, { barRatio = 0.06 } = {}) {
  try {
    const sharp = require('sharp');
    const meta = await sharp(buffer, { failOn: 'none' }).rotate().metadata();
    const w = meta.width || 0;
    const h = meta.height || 0;
    if (!w || !h) return null;
    const { data, info } = await sharp(buffer, { failOn: 'none' })
      .rotate()
      .greyscale()
      .raw()
      .toBuffer({ resolveWithObject: true });
    const W = info.width;
    const H = info.height;
    const at = (x, y) => data[y * W + x];
    const rowMean = (y) => {
      let s = 0;
      for (let x = 0; x < W; x++) s += at(x, y);
      return s / W;
    };
    const colMean = (x) => {
      let s = 0;
      for (let y = 0; y < H; y++) s += at(x, y);
      return s / H;
    };
    const limit = Math.floor(H * barRatio);
    let topBars = 0;
    for (let y = 0; y < limit; y++) {
      const m = rowMean(y);
      if (m < 24 || m > 231) topBars++;
    }
    let bottomBars = 0;
    for (let y = H - limit; y < H; y++) {
      const m = rowMean(y);
      if (m < 24 || m > 231) bottomBars++;
    }
    const limitX = Math.floor(W * barRatio);
    let leftBars = 0;
    for (let x = 0; x < limitX; x++) {
      const m = colMean(x);
      if (m < 24 || m > 231) leftBars++;
    }
    let rightBars = 0;
    for (let x = W - limitX; x < W; x++) {
      const m = colMean(x);
      if (m < 24 || m > 231) rightBars++;
    }
    const vertical = limit > 0 && (topBars + bottomBars) >= limit * 1.6;
    const horizontal = limitX > 0 && (leftBars + rightBars) >= limitX * 1.6;
    return { vertical, horizontal, topBars, bottomBars, leftBars, rightBars, W, H };
  } catch (_) {
    return null;
  }
}

/** 模糊度 + 单色占比 */
async function detectQuality(buffer) {
  try {
    const sharp = require('sharp');
    const { data, info } = await sharp(buffer, { failOn: 'none' })
      .rotate()
      .greyscale()
      .resize(256, 256, { fit: 'fill' })
      .raw()
      .toBuffer({ resolveWithObject: true });
    const w = info.width;
    const h = info.height;
    const at = (x, y) => data[y * w + x];
    const vals = [];
    const hist = new Array(256).fill(0);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) hist[at(x, y)]++;
    }
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        vals.push(at(x - 1, y) + at(x + 1, y) + at(x, y - 1) + at(x, y + 1) - 4 * at(x, y));
      }
    }
    const mean = vals.reduce((a, b) => a + b, 0) / (vals.length || 1);
    const lapVar = vals.reduce((a, b) => a + (b - mean) ** 2, 0) / (vals.length || 1);
    const total = w * h;
    const maxBin = Math.max(...hist);
    const solidRatio = maxBin / total;
    return { lapVar, solidRatio };
  } catch (_) {
    return null;
  }
}

// ---------------- 主流程 ----------------

/**
 * 判定一张图是否应入库。
 * @returns {Promise<{pass:boolean, reason?:string, detail?:object, stage?:string}>}
 */
async function evaluate(services, { buffer, fileName = '', fid = '', isVideo = false, isAiProduct = false, isManualUpload = false } = {}) {
  const { db } = services;
  const cfg = getConfig(db);
  if (!cfg.enabled) return { pass: true, stage: 'disabled' };

  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  const md5 = crypto.createHash('md5').update(buffer).digest('hex');

  // ① 指纹查重
  if (cfg.dup && cfg.dup.enabled) {
    const dup = checkDuplicate(services, { buffer, sha256, md5, fileName, fid, isVideo, cfg });
    if (dup) return { pass: false, stage: 'dup', reason: 'duplicate', detail: dup };
  }

  // 手动直传/成品库：指纹查重后直接放行
  if (isManualUpload) {
    return { pass: true, stage: 'manual_upload' };
  }

  // AI 产物：跳过内容判定，只走缺陷闸
  if (isAiProduct) {
    if (cfg.aiDefect && cfg.aiDefect.enabled) {
      const bar = await detectBars(buffer, { barRatio: cfg.aiDefect.barRatio });
      if (bar && (bar.vertical || bar.horizontal)) {
        return {
          pass: false,
          stage: 'ai_defect',
          reason: 'ai_defect',
          detail: { message: bar.vertical ? '检测到上下黑/白边' : '检测到左右黑/白边', bar },
        };
      }
    }
    return { pass: true, stage: 'ai_product' };
  }

  if (isVideo) {
    return { pass: true, stage: 'video' };
  }

  // ② 图像特征
  if (cfg.size && cfg.size.enabled) {
    const meta = await safeMeta(buffer);
    const shortSide = meta ? Math.min(meta.width || 0, meta.height || 0) : 0;
    if (shortSide && shortSide < cfg.size.minShortSide) {
      return {
        pass: false,
        stage: 'size',
        reason: 'too_small',
        detail: { message: `短边 ${shortSide}px < ${cfg.size.minShortSide}px`, shortSide },
      };
    }
    if (buffer.length < cfg.size.minBytes) {
      return {
        pass: false,
        stage: 'size',
        reason: 'too_small',
        detail: { message: `体积 ${Math.round(buffer.length / 1024)}KB < ${Math.round(cfg.size.minBytes / 1024)}KB`, bytes: buffer.length },
      };
    }
  }

  if (cfg.quality && cfg.quality.enabled) {
    const q = await detectQuality(buffer);
    if (q) {
      if (q.solidRatio >= cfg.quality.solidColorRatio) {
        return {
          pass: false,
          stage: 'quality',
          reason: 'low_quality',
          detail: { message: `单色占比 ${(q.solidRatio * 100).toFixed(1)}%（疑似纯色/黑帧）`, solidRatio: q.solidRatio },
        };
      }
      if (q.lapVar < cfg.quality.minLaplacianVar) {
        return {
          pass: false,
          stage: 'quality',
          reason: 'low_quality',
          detail: { message: `清晰度不足（Laplacian ${q.lapVar.toFixed(1)}）`, lapVar: q.lapVar },
        };
      }
    }
    if (cfg.quality.barCheck) {
      const bar = await detectBars(buffer, { barRatio: cfg.quality.barRatio });
      if (bar && bar.vertical && bar.horizontal) {
        return {
          pass: false,
          stage: 'quality',
          reason: 'low_quality',
          detail: { message: '检测到上下+左右大范围黑/白边', bar },
        };
      }
    }
  }

  // ③ 内容判定（由工作流 GateNode 执行，这里只标注降权）
  const nameHit = (cfg.content.downweightNamePatterns || []).some((p) => {
    try {
      return new RegExp(p, 'i').test(fileName);
    } catch (_) {
      return false;
    }
  });
  return { pass: true, stage: 'content', downweight: nameHit };
}

async function safeMeta(buffer) {
  try {
    const sharp = require('sharp');
    return await sharp(buffer, { failOn: 'none' }).rotate().metadata();
  } catch (_) {
    return null;
  }
}

function checkDuplicate(services, { buffer, sha256, md5, fileName, fid, isVideo, cfg }) {
  const { db } = services;
  if (!isVideo) {
    try {
      const err = new Error('skip');
      void err;
    } catch (_) {}
  }
  // 精确哈希
  try {
    const hit = db.prepare("SELECT fid, file_name FROM assets WHERE sha256 = ? AND status != 'deleted' AND fid != ? LIMIT 1").get(sha256, fid || '');
    if (hit) return { peerFid: hit.fid, peerName: hit.file_name, kind: 'sha256', dist: 0 };
  } catch (_) {}
  try {
    const hit = db.prepare("SELECT fid, file_name FROM assets WHERE md5 = ? AND status != 'deleted' AND fid != ? LIMIT 1").get(md5, fid || '');
    if (hit) return { peerFid: hit.fid, peerName: hit.file_name, kind: 'md5', dist: 0 };
  } catch (_) {}
  // 衍生哈希
  try {
    const hit = db.prepare(`
      SELECT d.asset_fid AS fid, d.kind AS kind FROM derivatives d
      WHERE (d.sha256 = ? OR d.md5 = ?) AND d.asset_fid != ? LIMIT 1
    `).get(sha256, md5, fid || '');
    if (hit) return { peerFid: hit.fid, peerKind: hit.kind, kind: 'deriv_hash', dist: 0 };
  } catch (_) {}
  try {
    const { findExportBySha } = require('./export-registry');
    const exp = findExportBySha(db, sha256);
    if (exp) return { peerFid: exp.source_fid || '', peerName: exp.kind || 'export', kind: 'export_registry', dist: 0 };
  } catch (_) {}

  if (!cfg.dup.checkDerivatives) return null;

  // pHash
  let phash = '';
  try {
    const qc = require('./qc');
    const info = qc.inspectSync ? qc.inspectSync(buffer) : null;
    if (info && info.phash) phash = info.phash;
  } catch (_) {}
  if (!phash) return null;

  const th = Number(cfg.dup.phashThreshold) || 8;
  const since = Date.now() - 3 * 24 * 60 * 60 * 1000;
  try {
    const rows = db.prepare("SELECT fid, file_name, phash FROM assets WHERE phash IS NOT NULL AND phash != '' AND created_at >= ? AND fid != ?").all(since, fid || '');
    let best = null;
    for (const r of rows) {
      const d = hammingHex(phash, r.phash);
      if (d <= th && (!best || d < best.dist)) best = { peerFid: r.fid, peerName: r.file_name, kind: 'phash', dist: d };
    }
    if (best) return best;
  } catch (_) {}
  try {
    const { PHASH_WINDOW_DERIV_KINDS } = require('./fingerprint');
    const drows = db.prepare(`SELECT asset_fid AS fid, kind, phash FROM derivatives WHERE phash IS NOT NULL AND phash != '' AND kind IN (${PHASH_WINDOW_DERIV_KINDS.map(() => '?').join(',')}) AND created_at >= ? AND asset_fid != ?`).all(...PHASH_WINDOW_DERIV_KINDS, since, fid || '');
    let best = null;
    for (const r of drows) {
      const d = hammingHex(phash, r.phash);
      if (d <= th && (!best || d < best.dist)) best = { peerFid: r.fid, peerKind: r.kind, kind: 'deriv_phash', dist: d };
    }
    if (best) return best;
  } catch (_) {}
  return null;
}

/**
 * 把资产置为拒收，并落入回收站。
 *
 * 网关拒收同样进回收站（2026-10-02 状态统一机制）：AI/网关的判定可能误判，
 * 给 14 天窗口让用户能翻案，而不是直接消失。
 * 传 services（含 config.dataDir）才能真正把文件移到 trash 目录；
 * 只传 db 时退化为仅改状态（兼容既有调用）。
 *
 * disposeSource 必须按实际调用方区分（2026-10-03 实测修复）：
 * 本函数既被内容网关调用，也被 gate 节点调用（detail.model==='gate'）。
 * 此前硬编码 'gateway_reject'，导致「AI 闸门判定非素材」在回收站里
 * 被标成「网关拒收」——判定标准与保留窗口都错了（用户看到的是
 * "入库网关内容审核未通过"，实际是 AI 视觉闸门判的）。
 * 现在按 detail.model 归类，且 gate 优先于 gateway。
 */
function markRejected(dbOrServices, fid, { reason, detail = {}, fileName = '' } = {}) {
  const db = dbOrServices && dbOrServices.db ? dbOrServices.db : dbOrServices;
  const services = dbOrServices && dbOrServices.db ? dbOrServices : null;
  ensureGatewayTables(db);
  const now = Date.now();
  const message = detail && detail.message ? detail.message : reason;
  // 来源判定：gate 节点传入 model:'gate' → AI 闸门判定；其余为内容网关拒收
  const isGate = String((detail && detail.model) || '').toLowerCase() === 'gate';
  const disposeSource = isGate ? 'gate_reject' : 'gateway_reject';
  db.prepare(`
    UPDATE assets SET status='rejected', reject_reason=?, reject_detail=?, rejected_at=?,
      error_note=?, restored_at=NULL, restore_reason=NULL, updated_at=?
    WHERE fid=?
  `).run(reason, JSON.stringify(detail || {}), now, message, now, fid);
  logEvent(db, { fid, fileName, action: 'rejected', reason, detail: JSON.stringify(detail || {}) });

  // 落回收站：让拒收素材可查看判定原因、可恢复
  if (services) {
    try {
      require('./assets-delete').softDeleteAsset(services, fid, {
        deletedBy: isGate ? 'interpreter-gate' : 'gateway',
        reason: disposeSource,
        disposeSource,
        disposeDetail: message,
      });
    } catch (e) {
      // 素材可能已不在表内或已删除，不阻断主流程
    }
  }
  return { fid, status: 'rejected', reason, rejectedAt: now };
}

module.exports = {
  DEFAULT_CONFIG,
  ensureGatewayTables,
  getConfig,
  setConfig,
  evaluate,
  markRejected,
  detectBars,
  detectQuality,
  checkDuplicate,
  hammingHex,
  logEvent,
};
