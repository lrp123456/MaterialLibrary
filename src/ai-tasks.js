/**
 * AI 任务调度：ai_tasks 表 + 异步 worker + 产物自动入库
 * 状态机：pending → running → success / failed
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const {
  getUmbraConfig,
  assetPublicUrl,
  pickOutputUrl,
  downloadToFile,
  submitUmbraRun,
  pollUmbraRun,
  buildWalkthroughBindings,
  buildTouchBindings,
  quadToBbox,
  stringifyQuad,
  toPixelPoints,
  parsePoint,
  persistTouchMask,
  extractVideoMeta,
  extractPoster,
  WALKTHROUGH_VIDEO_KEYS,
  WALKTHROUGH_POSTER_KEYS,
  TOUCH_IMAGE_KEYS
} = require('./umbra');

const { handleExpand } = require('./handlers/quick-expand');
const { handleWatermarkOrRemove } = require('./handlers/quick-watermark-remove');
const { handleInsert } = require('./handlers/quick-insert');
const { handleReplace } = require('./handlers/quick-replace');
const { handleEnhance } = require('./handlers/quick-enhance');
const { scheduleSeedanceRender } = require('./handlers/walkthrough-pipeline');
const { adapterOutputPath } = require('./handlers/adapter-io');

function buildSelection(p) {
  if (!p || typeof p !== 'object') return null;
  if (Array.isArray(p.points) && p.points.length >= 4) {
    return { quad: p.points, unit: p.coord_unit === 'px' ? 'px' : 'percent' };
  }
  if (Array.isArray(p.perspective_quad) && p.perspective_quad.length >= 4) {
    return { quad: p.perspective_quad, unit: p.coord_unit === 'px' ? 'px' : 'percent' };
  }
  if (p.x1 != null && p.y1 != null && p.x2 != null && p.y2 != null) {
    return {
      left: Number(p.x1),
      top: Number(p.y1),
      right: Number(p.x2),
      bottom: Number(p.y2),
      unit: 'px',
    };
  }
  if (p.rect_pixel) {
    const r = p.rect_pixel;
    return {
      left: Number(r.x1 ?? r.x ?? 0),
      top: Number(r.y1 ?? r.y ?? 0),
      right: Number(r.x2 ?? 0),
      bottom: Number(r.y2 ?? 0),
      unit: 'px',
    };
  }
  if (p.rect_box) {
    const b = p.rect_box;
    const x = Number(b.x ?? 0);
    const y = Number(b.y ?? 0);
    const w = Number(b.w ?? b.width ?? 0);
    const h = Number(b.h ?? b.height ?? 0);
    return { left: x, top: y, right: x + w, bottom: y + h, unit: p.coord_unit === 'percent' ? 'percent' : 'px' };
  }
  return null;
}

function viewerAssetRef(raw) {
  const s = String(raw || '').trim();
  const m = s.match(/\/api\/(?:viewer\/)?assets\/([^/?#]+)/);
  if (!m) return null;
  let derivative = '';
  try {
    derivative = new URL(s).searchParams.get('derivative') || '';
  } catch {}
  return { fid: decodeURIComponent(m[1]), derivative };
}

async function readLocalAssetImage(services, fid, derivativeId) {
  if (!fid) return null;
  const db = services.db;
  const config = services.config;
  const asset = db.prepare('SELECT * FROM assets WHERE fid=?').get(fid);
  if (!asset) return null;
  if (derivativeId) {
    try {
      const { getDerivativeById, resolveDerivativeFile } = require('./derivatives');
      const deriv = getDerivativeById(db, derivativeId);
      if (deriv && (deriv.asset_fid === fid || deriv.asset_fid === asset.fid)) {
        const p = await resolveDerivativeFile(services, deriv);
        if (p && fs.existsSync(p)) return fs.readFileSync(p);
      }
    } catch {}
  }
  const { ensureOriginalFile } = require('./originals');
  try {
    const origPath = await ensureOriginalFile(services, asset);
    if (origPath && fs.existsSync(origPath)) return fs.readFileSync(origPath);
  } catch {}
  const thumb = path.join(config.dataDir, 'cache', 'thumbs', `${fid}.jpg`);
  if (fs.existsSync(thumb)) return fs.readFileSync(thumb);
  return null;
}

async function resolveAssetBuffer(services, raw) {
  if (!raw) return null;
  const s = String(raw).trim();
  if (s.startsWith('data:image/')) {
    const parts = s.split(',');
    return Buffer.from(parts[1], 'base64');
  }
  if (fs.existsSync(s) && fs.statSync(s).isFile()) {
    return fs.readFileSync(s);
  }
  const db = services.db;
  const config = services.config;
  const asset = db.prepare('SELECT * FROM assets WHERE fid=?').get(s);
  if (asset) {
    const local = await readLocalAssetImage(services, s, '');
    if (local) return local;
  }
  const fromUrl = viewerAssetRef(s);
  if (fromUrl) {
    const local = await readLocalAssetImage(services, fromUrl.fid, fromUrl.derivative);
    if (local) return local;
  }
  const mAsset = s.match(/\/assets\/([^\/]+)\/file/);
  if (mAsset) {
    const local = await readLocalAssetImage(services, decodeURIComponent(mAsset[1]), '');
    if (local) return local;
  }
  if (/^https?:\/\//i.test(s)) {
    // 自己的素材地址已经在上面按 fid 读盘。走到这里的是外部 URL。
    // 全局代理会把 10.0.2.2 / 局域网地址也送进 Clash，undici 只抛 fetch failed。
    let dispatcher;
    try {
      const host = new URL(s).hostname;
      const localHost = host === '127.0.0.1' || host === 'localhost' || host === '::1'
        || host === '10.0.2.2'
        || /^192\.168\./.test(host) || /^10\./.test(host)
        || /^172\.(1[6-9]|2\d|3[0-1])\./.test(host);
      if (localHost) dispatcher = new (require('undici').Agent)();
    } catch {}
    let res;
    try {
      res = await fetch(s, {
        dispatcher,
        signal: AbortSignal.timeout(15000),
      });
    } catch (e) {
      const cause = e && e.cause ? (e.cause.code || e.cause.message || '') : '';
      throw new Error(`读取源图失败：${e.message}${cause ? '（' + cause + '）' : ''}`);
    }
    if (res.ok) return Buffer.from(await res.arrayBuffer());
  }
  return null;
}

const VALID_TYPES = new Set(['spatial_walkthrough', 'remove', 'insert', 'replace', 'expand', 'upscale']);
const WORKER_INTERVAL_MS = 2000;
const POLL_INTERVAL_MS = 3000;
const MAX_POLL_MS = 30 * 60 * 1000;

function newTaskId() {
  return `task_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`;
}

function rowToTask(r) {
  if (!r) return null;
  let payload = {};
  try { payload = JSON.parse(r.payload_json || '{}'); } catch {}
  let sourceFids = [];
  try { sourceFids = JSON.parse(r.source_fids_json || '[]'); } catch {}
  return {
    taskId: r.task_id,
    task_id: r.task_id,
    fid: r.fid,
    type: r.type,
    title: r.title || '',
    status: r.status,
    progress: r.progress == null ? 0 : r.progress,
    source_asset_id: r.source_asset_id || null,
    sourceFids,
    output_fid: r.output_fid || null,
    outputFid: r.output_fid || null,
    output_kind: r.output_kind || null,
    engine_run_id: r.engine_run_id || null,
    template_id: r.template_id || null,
    error: r.error || null,
    payload,
    created_by: r.created_by || null,
    created_at: r.created_at,
    updated_at: r.updated_at,
    completed_at: r.completed_at || null
  };
}

function getAiTask(db, taskId) {
  return rowToTask(db.prepare('SELECT * FROM ai_tasks WHERE task_id=?').get(taskId));
}

function listLatestByFid(db, fid, type) {
  const sql = type
    ? 'SELECT * FROM ai_tasks WHERE fid=? AND type=? ORDER BY created_at DESC, rowid DESC LIMIT 1'
    : 'SELECT * FROM ai_tasks WHERE fid=? ORDER BY created_at DESC, rowid DESC LIMIT 1';
  const row = type ? db.prepare(sql).get(fid, type) : db.prepare(sql).get(fid);
  return rowToTask(row);
}

function listAiTasks(db, { fid, status, type, limit = 20 } = {}) {
  const where = [];
  const args = [];
  if (fid) { where.push('fid=?'); args.push(fid); }
  if (status) { where.push('status=?'); args.push(status); }
  if (type) { where.push('type=?'); args.push(type); }
  const sql = `SELECT * FROM ai_tasks ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC, rowid DESC LIMIT ?`;
  return db.prepare(sql).all(...args, Math.max(1, Math.min(100, +limit || 20))).map(rowToTask);
}

/**
 * 移植自 new-chat 的朝向描述 facingDesc (随 yaw 角度分段)
 */
function facingDesc(deg, objName = '该单品') {
  const d = ((Math.round(Number(deg) || 0) % 360) + 360) % 360;
  if (d <= 22 || d >= 338) return `正面朝向观察者，可清楚看到${objName}正面、主要结构和双侧细节`;
  if (d <= 67) return `右前侧斜向摆放，可同时看到${objName}正面、右侧面和部分背面细节`;
  if (d <= 112) return `右侧面朝向观察者，可完整看到${objName}右侧轮廓和厚度`;
  if (d <= 157) return `右后侧斜向摆放，可看到${objName}背面、右侧面细节`;
  if (d <= 202) return `背面朝向观察者，主要看到${objName}背面结构`;
  if (d <= 247) return `左后侧斜向摆放，可看到${objName}背面、左侧面细节`;
  if (d <= 292) return `左侧面朝向观察者，可完整看到${objName}左侧轮廓和厚度`;
  return `左前侧斜向摆放，可同时看到${objName}正面、左侧面和部分背面细节`;
}

/**
 * 组装 Seedream 5.0 Pro 精准修改提示词 (只由素材库服务拼)
 */
function buildSeedreamPrecisionPrompt({
  type,
  box1Tag,
  box2Tag = '<bbox>0 0 999 999</bbox>',
  productName = '该单品',
  yaw = 0,
  isWatermark = false,
  customPrompt = ''
}) {
  if (type === 'insert') {
    return `将图2 ${box2Tag} 主体框中的该单品(${productName})安装到图1 ${box1Tag} 选区框，该处原本没有这个物体，贴着所涂的表面。严格保持图1的相机机位、视角、透视与光影，除新安装的物体及其接触阴影外，图1的其余像素全部保持不变。超写实室内实拍质感，不要添加水印、文字或标注框。`;
  }
  if (type === 'replace') {
    const fDesc = facingDesc(yaw, productName);
    return `将图2 ${box2Tag} 主体框中的该单品(${productName})放到图1 ${box1Tag} 选区框，换掉框内原有物体。从观察者视角看，${fDesc}。单品绕垂直于地面的 Y 轴摆放、四脚贴地、禁止悬浮，带自然接触阴影。严格保持图1的相机机位、视角、透视与光影，除新换物体及其阴影外，图1的其余像素全部保持不变。超写实室内实拍质感，不要添加水印、文字或标注框。`;
  }
  if (type === 'remove') {
    if (isWatermark) return '';
    return `去掉图1 ${box1Tag} 选区框内的物体、投影和接触面痕迹，按周围环境纹理与材质自然补全。严格保持图1原有透视、光影与未框选区域完好不变，无接缝无残留痕迹。不要添加水印、文字或标注框。`;
  }
  return customPrompt || '';
}

/**
 * 图2参考图主体边缘泛洪检测外接矩形 (返回 0-999 格式 "x1 y1 x2 y2")
 */
async function detectSubjectBbox(refUrlOrPath, config) {
  if (!refUrlOrPath) return '0 0 999 999';
  const sharp = require('sharp');
  try {
    let buf = null;
    const s = String(refUrlOrPath).trim();
    if (s.startsWith('data:image/')) {
      const comma = s.indexOf(',');
      if (comma >= 0) buf = Buffer.from(s.slice(comma + 1), 'base64');
    } else if (fs.existsSync(s) && fs.statSync(s).isFile()) {
      buf = fs.readFileSync(s);
    } else if (s.includes('/api/viewer/assets/') || s.includes('/api/assets/')) {
      const m = s.match(/\/api\/(?:viewer\/)?assets\/([^/?#]+)/);
      if (m && config?.dataDir) {
        const fid = decodeURIComponent(m[1]);
        const thumb = path.join(config.dataDir, 'cache', 'thumbs', `${fid}.jpg`);
        if (fs.existsSync(thumb)) buf = fs.readFileSync(thumb);
      }
    } else if (/^https?:\/\//i.test(s)) {
      const res = await fetch(s, { signal: AbortSignal.timeout(10000) });
      if (res.ok) buf = Buffer.from(await res.arrayBuffer());
    }

    if (!buf) return '0 0 999 999';

    const img = sharp(buf, { failOn: 'none' });
    const meta = await img.metadata();
    const w = meta.width;
    const h = meta.height;
    if (!w || !h) return '0 0 999 999';

    const targetW = 256;
    const targetH = Math.max(1, Math.round((h / w) * 256));
    const { data, info } = await img
      .resize(targetW, targetH, { fit: 'fill' })
      .ensureAlpha()
      .raw()
      .toBuffer({ resolveWithObject: true });

    const tw = info.width;
    const th = info.height;

    // 采样四角判断是否透明底
    const corners = [0, (tw - 1) * 4, (th - 1) * tw * 4, ((th - 1) * tw + (tw - 1)) * 4];
    let isTransparent = true;
    for (const c of corners) {
      if (data[c + 3] > 15) {
        isTransparent = false;
        break;
      }
    }

    let minX = tw, minY = th, maxX = -1, maxY = -1;

    if (isTransparent) {
      for (let y = 0; y < th; y++) {
        for (let x = 0; x < tw; x++) {
          const idx = (y * tw + x) * 4;
          if (data[idx + 3] > 20) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }
    } else {
      // 纯色/灰底泛洪
      const bgR = Math.round((data[0] + data[(tw - 1) * 4]) / 2);
      const bgG = Math.round((data[1] + data[(tw - 1) * 4 + 1]) / 2);
      const bgB = Math.round((data[2] + data[(tw - 1) * 4 + 2]) / 2);

      const visited = new Uint8Array(tw * th);
      const queue = [];
      const colorDistSq = (idx) => {
        const dr = data[idx] - bgR;
        const dg = data[idx + 1] - bgG;
        const db = data[idx + 2] - bgB;
        return dr * dr + dg * dg + db * db;
      };
      const THRESH_SQ = 35 * 35;

      for (let x = 0; x < tw; x++) {
        queue.push(x);
        queue.push((th - 1) * tw + x);
      }
      for (let y = 1; y < th - 1; y++) {
        queue.push(y * tw);
        queue.push(y * tw + tw - 1);
      }

      for (let i = 0; i < queue.length; i++) {
        visited[queue[i]] = 1;
      }

      let qHead = 0;
      while (qHead < queue.length) {
        const curr = queue[qHead++];
        const cx = curr % tw;
        const cy = Math.floor(curr / tw);
        const neighbors = [
          cy > 0 ? curr - tw : -1,
          cy < th - 1 ? curr + tw : -1,
          cx > 0 ? curr - 1 : -1,
          cx < tw - 1 ? curr + 1 : -1
        ];
        for (const n of neighbors) {
          if (n >= 0 && visited[n] === 0) {
            if (colorDistSq(n * 4) <= THRESH_SQ) {
              visited[n] = 1;
              queue.push(n);
            }
          }
        }
      }

      for (let y = 0; y < th; y++) {
        for (let x = 0; x < tw; x++) {
          const idx = y * tw + x;
          if (visited[idx] === 0) {
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }
    }

    if (minX > maxX || minY > maxY) return '0 0 999 999';

    const padX = Math.round((maxX - minX) * 0.02);
    const padY = Math.round((maxY - minY) * 0.02);
    minX = Math.max(0, minX - padX);
    minY = Math.max(0, minY - padY);
    maxX = Math.min(tw - 1, maxX + padX);
    maxY = Math.min(th - 1, maxY + padY);

    const normX1 = Math.min(999, Math.max(0, Math.round((minX / (tw - 1)) * 999)));
    const normY1 = Math.min(999, Math.max(0, Math.round((minY / (th - 1)) * 999)));
    const normX2 = Math.min(999, Math.max(0, Math.round((maxX / (tw - 1)) * 999)));
    const normY2 = Math.min(999, Math.max(0, Math.round((maxY / (th - 1)) * 999)));

    if (normX2 <= normX1 || normY2 <= normY1) return '0 0 999 999';
    return `${normX1} ${normY1} ${normX2} ${normY2}`;
  } catch (e) {
    return '0 0 999 999';
  }
}

/**
 * 入队 AI 任务。兼容客户端自带 task_id。
 */
function enqueueAiTask(db, {
  fid,
  type,
  taskId = null,
  title = '',
  sourceFids = null,
  payload = {},
  createdBy = 'viewer'
}) {
  if (!fid) throw new Error('缺少 fid');

  let effectiveType = String(type || '').trim().toLowerCase();
  let effectivePayload = { ...(payload || {}) };
  if (effectiveType === 'watermark') {
    effectiveType = 'remove';
    effectivePayload.sub_mode = 'watermark';
  } else if (effectiveType === 'enhance') {
    effectiveType = 'upscale';
  }

  if (!effectiveType || !VALID_TYPES.has(effectiveType)) throw new Error(`不支持的 type: ${type}`);

  const asset = db.prepare('SELECT fid, kind, file_name FROM assets WHERE fid=?').get(fid);
  if (!asset) throw new Error('资产不存在');

  let tid = taskId && String(taskId).trim() ? String(taskId).trim() : newTaskId();
  if (!/^task_[A-Za-z0-9_-]{3,64}$/.test(tid)) tid = newTaskId();

  const exists = db.prepare('SELECT task_id FROM ai_tasks WHERE task_id=?').get(tid);
  if (exists) {
    // 客户端 task_id 冲突：服务端另造，保证幂等提交不炸
    tid = newTaskId();
  }

  // 多源：路径 fid = 主素材；ordered_fids 保留全量
  let fids = [];
  if (Array.isArray(sourceFids) && sourceFids.length) {
    fids = sourceFids.map(s => (typeof s === 'string' ? s : s?.fid)).filter(Boolean);
  } else if (Array.isArray(effectivePayload?.ordered_fids)) {
    fids = effectivePayload.ordered_fids.map(s => (typeof s === 'string' ? s : s?.fid)).filter(Boolean);
  }
  if (!fids.includes(fid)) fids.unshift(fid);

  const now = Date.now();
  const titleFinal = title || defaultTitle(effectiveType, fids.length);

  db.prepare(`
    INSERT INTO ai_tasks (
      task_id, fid, type, title, status, progress,
      source_asset_id, source_fids_json, payload_json,
      created_by, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'pending', 0, ?, ?, ?, ?, ?, ?)
  `).run(
    tid, fid, effectiveType, titleFinal,
    fid,
    JSON.stringify(fids),
    JSON.stringify(effectivePayload),
    createdBy, now, now
  );

  return getAiTask(db, tid);
}

function defaultTitle(type, n = 1) {
  if (type === 'spatial_walkthrough') return `室内全景漫游 (${n}个空间)`;
  if (type === 'remove') return '精准消除';
  if (type === 'insert') return '透视安装';
  if (type === 'expand') return '智能扩图';
  if (type === 'replace') return '物品替换';
  if (type === 'upscale') return '高清放大';
  return 'AI 精修';
}

function updateTask(db, taskId, fields) {
  const keys = Object.keys(fields);
  if (!keys.length) return;
  const sets = keys.map(k => `${k}=?`).join(', ');
  db.prepare(`UPDATE ai_tasks SET ${sets}, updated_at=? WHERE task_id=?`)
    .run(...keys.map(k => fields[k]), Date.now(), taskId);
}

function failTask(db, taskId, error) {
  updateTask(db, taskId, {
    status: 'failed',
    error: String(error || '未知错误'),
    completed_at: Date.now()
  });
}

function completeTask(db, taskId, { outputFid, outputKind }) {
  updateTask(db, taskId, {
    status: 'success',
    progress: 100,
    output_fid: outputFid || null,
    output_kind: outputKind || null,
    error: null,
    completed_at: Date.now()
  });
}

/** 客户端/管理端可见的公开字段 */
function toPublicTask(t) {
  if (!t) return null;
  return {
    taskId: t.taskId,
    task_id: t.task_id,
    fid: t.fid,
    type: t.type,
    title: t.title,
    status: t.status,
    progress: t.progress,
    source_asset_id: t.source_asset_id,
    output_fid: t.output_fid,
    outputFid: t.output_fid,
    output_kind: t.output_kind,
    error: t.error,
    engine_run_id: t.engine_run_id,
    created_at: t.created_at,
    updated_at: t.updated_at,
    completed_at: t.completed_at
  };
}

/**
 * 执行一个 pending 任务：绑定源图 URL → 提交引擎 →（由 worker 轮询）
 * 提交失败直接落 failed，HTTP 层仍返回 200。
 */
async function startAiTask(services, task) {
  const { db, config, logger } = services;
  const t = typeof task === 'string' ? getAiTask(db, task) : task;
  if (!t) return { success: false, error: 'task_missing' };
  if (t.status !== 'pending' && t.status !== 'running') {
    return { success: true, task: t, skipped: true };
  }

  updateTask(db, t.taskId, { status: 'running', progress: 5 });

  try {
    const fids = t.sourceFids?.length ? t.sourceFids : [t.fid];
    const targetFid = t.fid || t.asset_fid;
    const p = t.payload || {};
    const type = t.type;

    // 1. 空间漫游 (多图三段流水线调度)
    if (type === 'spatial_walkthrough') {
      if (fids.length < 2 || fids.length > 6) {
        throw new Error('漫游需要 2 到 6 张空间照片');
      }
      updateTask(db, t.taskId, { progress: 15 });
      const result = await scheduleSeedanceRender(services, {
        sequenceData: p.sequence_data || p,
        sourceFids: fids,
        taskId: t.taskId,
      });
      const videoPath = adapterOutputPath(result);
      if (!videoPath) throw new Error('Seedance 未返回成片');
      const tempDir = path.join(config.dataDir, 'cache', 'temp');
      fs.mkdirSync(tempDir, { recursive: true });
      const meta = await extractVideoMeta(videoPath);
      let posterLocal = path.join(tempDir, `ai_walk_${t.taskId}_poster.jpg`);
      const posterOk = await extractPoster(videoPath, posterLocal);
      if (!posterOk) posterLocal = null;
      const newFid = `ai_${t.taskId}`;
      const out = await ingestAiVideo(services, {
        fid: newFid,
        srcPath: videoPath,
        posterSrc: posterLocal,
        sourceAssetId: t.source_asset_id || t.fid,
        type,
        taskId: t.taskId,
        width: meta.width,
        height: meta.height,
        durationS: meta.duration,
        size: fs.statSync(videoPath).size,
      });
      completeTask(db, t.taskId, { outputFid: out.fid, outputKind: 'video' });
      logger?.info?.(`[ai-tasks] ${t.taskId} 漫游成片入库 fid=${out.fid}`);
      return { success: true, task: getAiTask(db, t.taskId), outputFid: out.fid };
    }

    // 2. 单图操作 (收齐输入，由本地专用 Handler 计算与模型调用，贴回原图后直接入库)
    updateTask(db, t.taskId, { progress: 30 });
    const sceneBuffer = await resolveAssetBuffer(services, p.image || targetFid);
    if (!sceneBuffer) {
      throw new Error(`无法读取源图像素: ${targetFid}`);
    }

    const quadOrBbox = buildSelection(p);

    let outBuffer = null;

    if (type === 'expand') {
      outBuffer = await handleExpand(services, {
        imageBuffer: sceneBuffer,
        expandRatio: p.expand_ratio || p.expandRatio || p.ratio || '16:9',
        prompt: p.prompt || '',
        seed: p.seed ?? -1,
      });
    } else if (type === 'remove' || type === 'watermark') {
      if (!quadOrBbox) throw new Error('未指定有效选区');
      outBuffer = await handleWatermarkOrRemove(services, {
        imageBuffer: sceneBuffer,
        actionType: (type === 'watermark' || p.sub_mode === 'watermark') ? 'watermark' : 'remove',
        quadOrBbox,
        pasteback: p.pasteback !== false && String(p.pasteback) !== 'false',
      });
    } else if (type === 'insert') {
      const prodRef = p.product_fid || p.ref_image_url || p.subject_url || p.subject;
      const productBuffer = await resolveAssetBuffer(services, prodRef);
      if (!productBuffer) {
        throw new Error('增（软装安装）未获取到二维单品图');
      }
      if (!quadOrBbox) throw new Error('未指定有效选区');
      outBuffer = await handleInsert(services, {
        sceneImageBuffer: sceneBuffer,
        productImageBuffer: productBuffer,
        quadOrBbox,
        mode: p.mode || 'B',
        productName: p.product_name || '该单品',
      });
    } else if (type === 'replace') {
      const refImage = p.ref_image_url || p.snapshot_data_url || p.subject_url;
      if (p.glb_fid && refImage && !String(refImage).startsWith('data:image/')) {
        const ref = String(refImage);
        const gid = String(p.glb_fid);
        if (ref === gid || ref.includes(`/assets/${encodeURIComponent(gid)}`) || ref.includes(`/assets/${gid}`)) {
          throw new Error('替换参考图必须是固定机位截图，不能用模型缩略图');
        }
      }
      const refBuffer = await resolveAssetBuffer(services, refImage);
      if (!refBuffer) {
        throw new Error('改（物体替换）未获取到固定机位 3D 参考图');
      }
      if (!quadOrBbox) throw new Error('未指定有效选区');
      outBuffer = await handleReplace(services, {
        sceneImageBuffer: sceneBuffer,
        fixedCameraRefBuffer: refBuffer,
        glbFid: p.glb_fid || null,
        yaw: Number(p.yaw ?? p.orientation ?? 0),
        productName: p.product_name || '该单品',
        quadOrBbox,
        pasteback: p.pasteback !== false && String(p.pasteback) !== 'false',
      });
    } else if (type === 'upscale' || type === 'enhance') {
      outBuffer = await handleEnhance(services, { imageBuffer: sceneBuffer });
    } else {
      throw new Error(`未实现的快捷操作: ${type}`);
    }

    if (!outBuffer) {
      throw new Error(`任务 ${type} 处理未产出有效图像`);
    }

    // 3. 产物直接入库为衍生图 (Derivative)，完成任务闭环
    const tempDir = path.join(config.dataDir, 'cache', 'temp');
    fs.mkdirSync(tempDir, { recursive: true });
    const outFileName = `ai_${type}_${t.taskId}.jpg`;
    const outPath = path.join(tempDir, outFileName);
    fs.writeFileSync(outPath, outBuffer);

    const { createDerivative } = require('./derivatives');
    const deriv = await createDerivative(services, {
      assetFid: t.fid,
      kind: `ai_${type}`,
      srcPath: outPath,
      fileName: outFileName,
      mime: 'image/jpeg',
      params: {
        ai_task_id: t.taskId,
        type,
        pipeline: 'direct_handler',
      }
    });

    completeTask(db, t.taskId, { outputFid: String(deriv.id), outputKind: 'derivative' });
    logger?.info?.(`[ai-tasks] ${t.taskId} 本地流水线执行成功 derivative #${deriv.id}`);
    return { success: true, task: getAiTask(db, t.taskId), derivativeId: deriv.id };
  } catch (e) {
    failTask(db, t.taskId, e.message);
    logger?.warn?.(`[ai-tasks] ${t.taskId} 任务执行失败: ${e.message}`);
    return { success: false, error: e.message, task: getAiTask(db, t.taskId) };
  }
}

/**
 * 轮询引擎；成功后下载产物并入库。
 */
async function pollAndIngest(services, task) {
  const { db, config, logger } = services;
  const t = task;
  if (!t?.engine_run_id) return { success: false, error: 'no_engine_run' };

  let remote;
  try {
    remote = await pollUmbraRun(db, t.engine_run_id);
  } catch (e) {
    // 网络抖动：保留 running，下次再试
    return { success: false, error: e.message, retry: true };
  }

  if (remote.progress != null) {
    updateTask(db, t.taskId, { progress: Math.max(10, Math.min(99, remote.progress)) });
  }

  if (remote.status === 'failed') {
    failTask(db, t.taskId, remote.error || '引擎任务失败');
    return { success: false, error: remote.error };
  }
  if (remote.status !== 'success') {
    return { success: true, pending: true, progress: remote.progress };
  }

  // 引擎成功 → 下载并入库
  try {
    const outputs = remote.outputs || {};
    const tempDir = path.join(config.dataDir, 'cache', 'temp');
    fs.mkdirSync(tempDir, { recursive: true });

    if (t.type === 'spatial_walkthrough') {
      const videoUrl = pickOutputUrl(outputs, WALKTHROUGH_VIDEO_KEYS);
      if (!videoUrl) throw new Error('引擎成功但无成片 URL');
      const videoName = `ai_walk_${t.taskId}.mp4`;
      const videoPath = path.join(tempDir, videoName);
      await downloadToFile(videoUrl, videoPath, { timeoutMs: 180000, token: getUmbraConfig(db).token });

      let posterLocal = null;
      const posterUrl = pickOutputUrl(outputs, WALKTHROUGH_POSTER_KEYS);
      if (posterUrl) {
        posterLocal = path.join(tempDir, `ai_walk_${t.taskId}_poster.jpg`);
        try {
          await downloadToFile(posterUrl, posterLocal, { timeoutMs: 60000, token: getUmbraConfig(db).token });
        } catch { posterLocal = null; }
      }
      if (!posterLocal) {
        posterLocal = path.join(tempDir, `ai_walk_${t.taskId}_poster.jpg`);
        const ok = await extractPoster(videoPath, posterLocal);
        if (!ok) posterLocal = null;
      }

      const meta = await extractVideoMeta(videoPath);
      const size = fs.statSync(videoPath).size;
      const newFid = `ai_${t.taskId}`;
      const out = await ingestAiVideo(services, {
        fid: newFid,
        srcPath: videoPath,
        posterSrc: posterLocal,
        sourceAssetId: t.source_asset_id || t.fid,
        type: t.type,
        taskId: t.taskId,
        width: meta.width,
        height: meta.height,
        durationS: meta.duration,
        size
      });
      completeTask(db, t.taskId, { outputFid: out.fid, outputKind: 'video' });
      logger?.info?.(`[ai-tasks] ${t.taskId} 成片入库 fid=${out.fid}`);
      return { success: true, task: getAiTask(db, t.taskId), outputFid: out.fid };
    }

    // 图片精修 → 母素材 derivative
    const imgUrl = pickOutputUrl(outputs, TOUCH_IMAGE_KEYS);
    if (!imgUrl) throw new Error('引擎成功但无精修图 URL');
    const imgName = `ai_${t.type}_${t.taskId}.jpg`;
    const imgPath = path.join(tempDir, imgName);
    await downloadToFile(imgUrl, imgPath, { timeoutMs: 120000, token: getUmbraConfig(db).token });

    const { createDerivative } = require('./derivatives');
    const deriv = await createDerivative(services, {
      assetFid: t.fid,
      kind: `ai_${t.type}`,
      srcPath: imgPath,
      fileName: `${t.type}_${t.taskId}.jpg`,
      mime: 'image/jpeg',
      params: {
        ai_task_id: t.taskId,
        type: t.type,
        engine_run_id: t.engine_run_id
      }
    });
    completeTask(db, t.taskId, { outputFid: String(deriv.id), outputKind: 'derivative' });
    logger?.info?.(`[ai-tasks] ${t.taskId} 精修完成 derivative #${deriv.id}`);
    return { success: true, task: getAiTask(db, t.taskId), derivativeId: deriv.id };
  } catch (e) {
    failTask(db, t.taskId, `产物入库失败: ${e.message}`);
    logger?.warn?.(`[ai-tasks] ${t.taskId} 入库失败: ${e.message}`);
    return { success: false, error: e.message };
  }
}

/**
 * walkthrough 成片写入 assets 表。
 */
async function ingestAiVideo(services, {
  fid, srcPath, posterSrc, sourceAssetId, type, taskId,
  width, height, durationS, size
}) {
  const { db, config } = services;
  const relDir = path.join('cache', 'ai_videos');
  const absDir = path.join(config.dataDir, relDir);
  fs.mkdirSync(absDir, { recursive: true });
  const relPath = path.join(relDir, `${fid}.mp4`);
  const absPath = path.join(config.dataDir, relPath);
  if (srcPath !== absPath) fs.copyFileSync(srcPath, absPath);

  let posterRel = null;
  if (posterSrc && fs.existsSync(posterSrc)) {
    const posterDir = path.join(config.dataDir, 'cache', 'ai_posters');
    fs.mkdirSync(posterDir, { recursive: true });
    posterRel = path.join('cache', 'ai_posters', `${fid}.jpg`);
    const posterAbs = path.join(config.dataDir, posterRel);
    if (posterSrc !== posterAbs) fs.copyFileSync(posterSrc, posterAbs);
  }

  const now = Date.now();
  const fileName = `AI漫游_${taskId}.mp4`;
  const status = 'ready';

  db.prepare(`
    INSERT INTO assets (
      fid, kind, file_name, size, width, height, orientation, duration_s,
      status, is_ai, source_asset_id, poster_path, source,
      is_representative, has_watermark, in_managed_zone,
      created_at, discovered_at, updated_at
    ) VALUES (?, 'video', ?, ?, ?, ?, ?, ?, ?, 1, ?, ?, 'ai', 1, 0, 0, ?, ?, ?)
  `).run(
    fid, fileName, size || null, width || null, height || null,
    (width && height) ? (width >= height ? 'landscape' : 'portrait') : null,
    durationS || null,
    status, sourceAssetId || null, posterRel,
    now, now, now
  );

  // origin derivative 指向本地成片
  const r = db.prepare(`
    INSERT INTO derivatives (asset_fid, kind, storage_type, storage_ref, file_name, width, height, mime, duration_s, params, created_at)
    VALUES (?, 'origin', 'local_cache', ?, ?, ?, ?, 'video/mp4', ?, ?, ?)
  `).run(
    fid, relPath, fileName, width || null, height || null, durationS || null,
    JSON.stringify({ ai_task_id: taskId, type, source_asset_id: sourceAssetId }),
    now
  );
  db.prepare('UPDATE assets SET main_derivative_id=? WHERE fid=?').run(r.lastInsertRowid, fid);

  // 缩略图
  if (posterRel) {
    const thumbDir = path.join(config.dataDir, 'cache', 'thumbs');
    fs.mkdirSync(thumbDir, { recursive: true });
    try {
      fs.copyFileSync(path.join(config.dataDir, posterRel), path.join(thumbDir, `${fid}.jpg`));
    } catch {}
  }

  return { fid, derivativeId: r.lastInsertRowid, posterRel };
}

class AiTaskWorker {
  constructor(services) {
    this.services = services;
    this.timer = null;
    this.busy = false;
  }

  start(intervalMs = WORKER_INTERVAL_MS) {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.tick().catch(e => this.services.logger?.warn?.(`[ai-task-worker] ${e.message}`));
    }, intervalMs);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick() {
    if (this.busy) return;
    this.busy = true;
    try {
      const { db } = this.services;

      // 1. 取 pending 启动
      const pending = db.prepare(`
        SELECT * FROM ai_tasks WHERE status='pending' ORDER BY created_at ASC LIMIT 1
      `).get();
      if (pending) {
        await startAiTask(this.services, rowToTask(pending));
        return;
      }

      // 2. 取 running 轮询（engine_run_id 已有）
      const running = db.prepare(`
        SELECT * FROM ai_tasks WHERE status='running' AND engine_run_id IS NOT NULL
        ORDER BY updated_at ASC LIMIT 1
      `).get();
      if (running) {
        const t = rowToTask(running);
        // 超时保护
        if (Date.now() - (t.created_at || 0) > MAX_POLL_MS) {
          failTask(db, t.taskId, '引擎任务超时');
          return;
        }
        await pollAndIngest(this.services, t);
      }
    } finally {
      this.busy = false;
    }
  }
}

module.exports = {
  VALID_TYPES,
  newTaskId,
  getAiTask,
  listLatestByFid,
  listAiTasks,
  enqueueAiTask,
  startAiTask,
  pollAndIngest,
  ingestAiVideo,
  toPublicTask,
  rowToTask,
  AiTaskWorker,
  updateTask,
  failTask,
  completeTask,
  facingDesc,
  buildSeedreamPrecisionPrompt,
  resolveAssetBuffer,
  buildSelection,
};
