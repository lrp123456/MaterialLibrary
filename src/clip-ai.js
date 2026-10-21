/**
 * 剪辑板块的 AI 任务（字幕 / 抠像 / 美颜精修 / 瘦脸）。
 *
 * 为什么不复用 src/ai-tasks.js 的队列：
 * 那边的 AiTaskWorker 直接 SELECT status='pending' 取任务且没有 type 过滤，
 * 两个 worker 抢同一张表会互相吃任务。所以这里独立开 clip_ai_jobs。
 *
 * 引擎接入方式（Runner 契约）：
 *   把 <type>.js 放进 <dataDir>/clip-ai-runners/，导出：
 *     module.exports = async ({ inputPath, params, workDir, job }) => ({
 *       result?: any,        // 结构化结果，例如字幕 segments
 *       outputPath?: string, // 产出文件（会被复制到 workDir/output/）
 *     })
 *   没有 runner 时任务直接失败并给出明确原因，不会静默成功。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { listVoices, prepareTtsParams, runTtsJob, ttsReady } = require('./clip-ai-tts');

const JOB_TYPES = new Set([
  'subtitle', 'matting', 'beauty_pro', 'face_reshape', 'upscale',
  'tts', 'scene-split', 'vocal-separate',
]);
const MAX_INPUT_BYTES = 512 * 1024 * 1024;

// 内置引擎：不需要 <dataDir>/clip-ai-runners/<type>.js，直接在当前进程里跑。
// 签名与外部 runner 一致（多一个 services），产出同样由 worker 落库。
const BUILTIN_RUNNERS = { tts: runTtsJob };

function sendJson(res, status, data) {
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function readBody(req, limit = 4 * 1024 * 1024) {
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

function ensureAiTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS clip_ai_jobs (
      id          TEXT PRIMARY KEY,
      type        TEXT NOT NULL,
      fid         TEXT NOT NULL,
      status      TEXT NOT NULL DEFAULT 'pending',
      progress    INTEGER NOT NULL DEFAULT 0,
      stage       TEXT,
      params_json TEXT NOT NULL DEFAULT '{}',
      result_json TEXT,
      output_fid  TEXT,
      output_path TEXT,
      error       TEXT,
      created_by  INTEGER NOT NULL DEFAULT 0,
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL,
      started_at  INTEGER,
      finished_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_clip_ai_fid ON clip_ai_jobs(fid, created_at DESC);
  `);
}

function runnersDir(config) {
  const dir = process.env.CLIP_AI_RUNNERS_DIR
    ? path.resolve(process.env.CLIP_AI_RUNNERS_DIR)
    : path.join(config.dataDir, 'clip-ai-runners');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function workRoot(config) {
  const dir = path.join(config.dataDir, 'clip-ai-jobs');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function rowToJob(r) {
  if (!r) return null;
  let params = {};
  let result = null;
  try { params = JSON.parse(r.params_json || '{}'); } catch { params = {}; }
  try { result = r.result_json ? JSON.parse(r.result_json) : null; } catch { result = null; }
  return {
    id: r.id,
    type: r.type,
    fid: r.fid,
    status: r.status,
    progress: Number(r.progress) || 0,
    stage: r.stage || '',
    params,
    result,
    outputFid: r.output_fid || null,
    outputUrl: r.output_path ? `/editor-api/ai/jobs/${r.id}/output` : null,
    error: r.error || '',
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    startedAt: r.started_at,
    finishedAt: r.finished_at,
  };
}

function getJob(db, id) {
  return rowToJob(db.prepare('SELECT * FROM clip_ai_jobs WHERE id=?').get(id));
}

function listJobs(db, { fid, status, limit = 30 } = {}) {
  const where = [];
  const args = [];
  if (fid) { where.push('fid=?'); args.push(fid); }
  if (status) { where.push('status=?'); args.push(status); }
  const sql = `SELECT * FROM clip_ai_jobs ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY created_at DESC LIMIT ?`;
  args.push(Math.min(200, Math.max(1, Number(limit) || 30)));
  return db.prepare(sql).all(...args).map(rowToJob);
}

function createJob(db, { type, fid, params, createdBy = 0 }) {
  const id = `job_${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;
  const now = Date.now();
  db.prepare(`
    INSERT INTO clip_ai_jobs (id, type, fid, status, progress, params_json, created_by, created_at, updated_at)
    VALUES (?,?,?,'pending',0,?,?,?,?)
  `).run(id, type, fid, JSON.stringify(params || {}), createdBy, now, now);
  return getJob(db, id);
}

function updateJob(db, id, patch) {
  const fields = [];
  const args = [];
  for (const [k, v] of Object.entries(patch)) {
    fields.push(`${k}=?`);
    args.push(v);
  }
  fields.push('updated_at=?');
  args.push(Date.now(), id);
  db.prepare(`UPDATE clip_ai_jobs SET ${fields.join(', ')} WHERE id=?`).run(...args);
}

async function loadRunner(config, type) {
  const file = path.join(runnersDir(config), `${type}.js`);
  if (!fs.existsSync(file)) return null;
  // 每次重新 require 会让内存里的旧模块失效；这里按 mtime 做缓存键。
  const key = `${file}:${fs.statSync(file).mtimeMs}`;
  if (!loadRunner.cache) loadRunner.cache = new Map();
  if (loadRunner.cache.has(key)) return loadRunner.cache.get(key);
  delete require.cache[require.resolve(file)];
  const mod = require(file);
  const run = typeof mod === 'function' ? mod : mod && mod.run;
  if (typeof run !== 'function') throw new Error(`runner ${type}.js 必须导出函数或 { run }`);
  loadRunner.cache.set(key, run);
  return run;
}

let workerTimer = null;
let working = false;

function startWorker(services, { intervalMs = 2000 } = {}) {
  if (workerTimer) return;
  const { db, config } = services;
  ensureAiTables(db);

  const tick = async () => {
    if (working) return;
    const row = db.prepare(
      "SELECT * FROM clip_ai_jobs WHERE status='pending' ORDER BY created_at ASC LIMIT 1",
    ).get();
    if (!row) return;
    working = true;
    const jobDir = path.join(workRoot(config), row.id);
    const inputDir = path.join(jobDir, 'input');
    const outputDir = path.join(jobDir, 'output');
    fs.mkdirSync(inputDir, { recursive: true });
    fs.mkdirSync(outputDir, { recursive: true });

    try {
      updateJob(db, row.id, { status: 'running', stage: '准备输入', progress: 5, started_at: Date.now() });

      // 内置引擎不需要 runner 文件；外部引擎没有 runner 时直接失败。
      const builtin = BUILTIN_RUNNERS[row.type] || null;
      const run = builtin ? null : await loadRunner(config, row.type);
      if (!run && !builtin) {
        throw new Error(
          `引擎未配置：缺少 ${path.join(runnersDir(config), row.type + '.js')}。` +
          `请放入 runner 后重启服务（契约见 src/clip-ai.js 顶部注释）。`,
        );
      }

      // 内置引擎的输入由它自己解析（TTS 的参考音频可能来自音色库，不是素材 fid）。
      let inputPath = null;
      if (!builtin) {
        const { resolveAssetBuffer } = require('./ai-tasks');
        const buf = await resolveAssetBuffer(services, row.fid);
        if (!buf) throw new Error(`读不到源素材：${row.fid}`);
        if (buf.length > MAX_INPUT_BYTES) {
          throw new Error(`源素材 ${(buf.length / 1024 / 1024).toFixed(0)} MB 超过 ${MAX_INPUT_BYTES / 1024 / 1024} MB 上限`);
        }
        inputPath = path.join(inputDir, `source${guessExt(row.fid)}`);
        fs.writeFileSync(inputPath, buf);
      }

      updateJob(db, row.id, { stage: '执行引擎', progress: 20 });

      const started = Date.now();
      const params = JSON.parse(row.params_json || '{}');
      const jobMeta = { id: row.id, type: row.type, fid: row.fid };
      const onProgress = (p, stage) => {
        try {
          updateJob(db, row.id, {
            progress: Math.max(0, Math.min(99, Math.round(Number(p) || 0))),
            ...(stage ? { stage: String(stage).slice(0, 80) } : {}),
          });
        } catch { /* 进度写失败不影响主流程 */ }
      };
      const payload = { params, workDir: jobDir, outputDir, job: jobMeta, onProgress };
      const out = (builtin
        ? await builtin({ services, ...payload })
        : await run({ inputPath, ...payload })) || {};

      let outputPath = null;
      if (out.outputPath && fs.existsSync(out.outputPath)) {
        const name = path.basename(out.outputPath);
        outputPath = path.join(outputDir, name);
        fs.copyFileSync(out.outputPath, outputPath);
      }

      updateJob(db, row.id, {
        status: 'done',
        progress: 100,
        stage: '完成',
        result_json: out.result == null ? null : JSON.stringify(out.result),
        output_path: outputPath,
        finished_at: Date.now(),
        error: null,
      });
      console.log(`[clip-ai] ${row.id} ${row.type} 完成，用时 ${Date.now() - started}ms`);
    } catch (e) {
      updateJob(db, row.id, {
        status: 'failed',
        progress: 100,
        stage: '失败',
        error: (e && e.message ? e.message : String(e)).slice(0, 800),
        finished_at: Date.now(),
      });
      console.warn(`[clip-ai] ${row.id} ${row.type} 失败：${e && e.message}`);
    } finally {
      working = false;
    }
  };

  workerTimer = setInterval(() => { tick().catch(() => {}); }, intervalMs);
  if (workerTimer.unref) workerTimer.unref();
  console.log(`[clip-ai] worker 已启动，runner 目录：${runnersDir(config)}`);
}

function guessExt(fid) {
  const m = String(fid).match(/\.(mp4|mov|webm|mkv|mp3|wav|m4a|png|jpg|jpeg|webp)$/i);
  return m ? `.${m[1].toLowerCase()}` : '.bin';
}

/**
 * 路由：
 * POST /editor-api/ai/jobs            { type, fid, params }
 * GET  /editor-api/ai/jobs/:id
 * GET  /editor-api/ai/jobs?fid=&status=
 * POST /editor-api/ai/jobs/:id/cancel
 * GET  /editor-api/ai/jobs/:id/output
 * GET  /editor-api/ai/capabilities
 * POST /editor-api/ai/tts             { text, lang, refFid | voiceId, emoFid?, durationFactor? }
 * POST /editor-api/ai/scene-split     { fid, params? }
 * POST /editor-api/ai/vocal-separate  { fid, params? }
 * GET  /editor-api/ai/voices
 */
async function handleAiJobs(services, req, res, url) {
  const { db, config } = services;
  ensureAiTables(db);
  startWorker(services);
  const p = url.pathname;

  if (p === '/editor-api/ai/capabilities' && req.method === 'GET') {
    const dir = runnersDir(config);
    const items = [...JOB_TYPES].map((type) => ({
      type,
      // tts 是内置引擎，就绪与否看适配器；其余看 runner 文件。
      ready: type === 'tts' ? ttsReady(db) : fs.existsSync(path.join(dir, `${type}.js`)),
    }));
    sendJson(res, 200, { items });
    return true;
  }

  if (p === '/editor-api/ai/voices' && req.method === 'GET') {
    sendJson(res, 200, { items: listVoices(config) });
    return true;
  }

  // TTS：参数在此校验，真正的合成由 worker 的内置引擎执行（type='tts'）。
  if (p === '/editor-api/ai/tts' && req.method === 'POST') {
    const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    const checked = prepareTtsParams(services, body);
    if (checked.error) {
      sendJson(res, checked.error.status, { error: checked.error.message });
      return true;
    }
    const job = createJob(db, { type: 'tts', fid: checked.params.refFid || '', params: checked.params });
    sendJson(res, 200, { ok: true, jobId: job.id, job });
    return true;
  }

  // 镜头检测 / 人声分离：都是「一个素材进、一个任务出」，投递逻辑一样。
  const submitMatches = {
    '/editor-api/ai/scene-split': 'scene-split',
    '/editor-api/ai/vocal-separate': 'vocal-separate',
  };
  if (submitMatches[p] && req.method === 'POST') {
    const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    const fid = String(body.fid || '');
    if (!fid) { sendJson(res, 400, { error: '缺少 fid' }); return true; }
    const asset = db.prepare('SELECT fid FROM assets WHERE fid=?').get(fid);
    if (!asset) { sendJson(res, 404, { error: '素材不存在' }); return true; }
    // 兼容 params 嵌套与顶层平铺两种写法（前端面板通常直接平铺）。
    const params = { ...(body.params || {}) };
    for (const key of ['threshold', 'minSceneLen', 'model']) {
      if (body[key] != null) params[key] = body[key];
    }
    const job = createJob(db, { type: submitMatches[p], fid, params });
    sendJson(res, 200, { ok: true, jobId: job.id, job });
    return true;
  }

  if (p === '/editor-api/ai/jobs' && req.method === 'GET') {
    sendJson(res, 200, {
      items: listJobs(db, {
        fid: url.searchParams.get('fid') || undefined,
        status: url.searchParams.get('status') || undefined,
        limit: url.searchParams.get('limit') || undefined,
      }),
    });
    return true;
  }

  if (p === '/editor-api/ai/jobs' && req.method === 'POST') {
    const body = JSON.parse((await readBody(req)).toString('utf8') || '{}');
    const type = String(body.type || '');
    if (!JOB_TYPES.has(type)) {
      sendJson(res, 400, { error: `不支持的 AI 任务类型：${type || '(空)'}` });
      return true;
    }
    const fid = String(body.fid || '');
    if (!fid) { sendJson(res, 400, { error: '缺少 fid' }); return true; }
    const asset = db.prepare('SELECT fid FROM assets WHERE fid=?').get(fid);
    if (!asset) { sendJson(res, 404, { error: '素材不存在' }); return true; }
    const job = createJob(db, { type, fid, params: body.params || {} });
    sendJson(res, 200, { job });
    return true;
  }

  const outputMatch = /^\/editor-api\/ai\/jobs\/([^/]+)\/output$/.exec(p);
  if (outputMatch && req.method === 'GET') {
    const job = getJob(db, decodeURIComponent(outputMatch[1]));
    if (!job || !job.outputUrl) { sendJson(res, 404, { error: '没有产出文件' }); return true; }
    const row = db.prepare('SELECT output_path FROM clip_ai_jobs WHERE id=?').get(job.id);
    const abs = row.output_path;
    if (!abs || !fs.existsSync(abs)) { sendJson(res, 404, { error: '产出文件已清理' }); return true; }
    const buf = fs.readFileSync(abs);
    const name = path.basename(abs);
    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': buf.length,
      'Content-Disposition': `attachment; filename="${encodeURIComponent(name)}"`,
    });
    res.end(buf);
    return true;
  }

  const cancelMatch = /^\/editor-api\/ai\/jobs\/([^/]+)\/cancel$/.exec(p);
  if (cancelMatch && req.method === 'POST') {
    const id = decodeURIComponent(cancelMatch[1]);
    const job = getJob(db, id);
    if (!job) { sendJson(res, 404, { error: '任务不存在' }); return true; }
    if (job.status === 'done' || job.status === 'failed') {
      sendJson(res, 409, { error: '任务已结束，无法取消' });
      return true;
    }
    updateJob(db, id, { status: 'canceled', stage: '已取消', finished_at: Date.now() });
    sendJson(res, 200, { ok: true });
    return true;
  }

  const jobMatch = /^\/editor-api\/ai\/jobs\/([^/]+)$/.exec(p);
  if (jobMatch && req.method === 'GET') {
    const job = getJob(db, decodeURIComponent(jobMatch[1]));
    if (!job) { sendJson(res, 404, { error: '任务不存在' }); return true; }
    sendJson(res, 200, { job });
    return true;
  }

  return false;
}

module.exports = {
  ensureAiTables,
  handleAiJobs,
  startWorker,
  JOB_TYPES,
  runnersDir,
};
