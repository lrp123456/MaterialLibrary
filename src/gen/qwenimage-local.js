/**
 * 本地 QwenImage 适配器（ncnn-vulkan 版 Qwen2.1-Image）
 *
 * 定位：**Agnes 的并行补充与降级通道**，不是替代。
 *   1. Agnes 失败（TLS 断连 / 429 / 503）时自动降级到本机，重试不留在异常态
 *   2. 一次性灌入多张、Agnes 排队处理不完时，本机并行消化剩余任务
 *
 * 已知事实（实测）：
 *   - 管理台挂载 GPU 面板 **9000** 的 `/api/qw/generate` 与 `/api/qw/tasks/{id}`，它代理同一套任务。
 *   - 基址不是 :9000 时仍走裸端口的 `/api/generate` 与 `/api/tasks/{id}`（8003）。
 *   - `POST` **必须用 multipart/form-data**；用 application/json 必得 422。
 *   - 参考图字段是 `refs`（可重复提交，base64 或文件均可）
 *   - 发给 Qwen 的宽高对齐到 32 的倍数。交付图仍由 calibrateGeneratedImage 拉回 1080p 预设。
 *   - 产物在面板 `GET /product/qw/<name>` 取
 *   - **固定开销 ~85~90s/张**（每次独立子进程、模型重新加载，结束即退出），
 *     steps 从 8 提到 20 只多花 ~5s。所以耗时由「张数」而非「步数」决定。
 *
 * 协议：qwenimage_local
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
const { lanFetch } = require('./lan-fetch');

/** 文生图对齐 16，带参考图的编辑对齐 32。0 表示调用方没给尺寸。 */
function snapMultiple(n, multiple) {
  const v = Math.round(Number(n));
  const step = multiple === 16 ? 16 : 32;
  if (!Number.isFinite(v) || v <= 0) return 0;
  return Math.max(step, Math.round(v / step) * step);
}

function snapMultipleOf32(n) {
  return snapMultiple(n, 32);
}

function qwenRoutes(baseUrl) {
  const base = String(baseUrl || '').replace(/\/$/, '');
  const onPanel = /:9000(?:\/|$)/.test(base);
  return {
    submit: `${base}${onPanel ? '/api/qw/generate' : '/api/generate'}`,
    task: (taskId) => `${base}${onPanel ? '/api/qw/tasks/' : '/api/tasks/'}${encodeURIComponent(taskId)}`,
  };
}

/**
 * 参考图瘦身：长边超过 maxEdge 时等比缩小并转 JPEG q88。
 * 解析失败（非图片）时返回 null，调用方回退原图。
 */
async function compactRefBuffer(buf, maxEdge = 1536) {
  try {
    const img = sharp(buf, { failOn: 'none' });
    const meta = await img.metadata();
    if (!meta || !meta.width || !meta.height) return null;
    const longest = Math.max(meta.width, meta.height);
    let chain = img;
    if (longest > maxEdge) chain = chain.resize({ width: meta.width >= meta.height ? maxEdge : null, height: meta.height > meta.width ? maxEdge : null, withoutEnlargement: true });
    // 已经足够小且为 JPEG/WebP：重编码没有收益，原样保留
    if (longest <= maxEdge && (meta.format === 'jpeg' || meta.format === 'webp')) return null;
    if (meta.hasAlpha) {
      // 蒙版/透明参考保留 alpha（压平白底会破坏编辑选区），仅缩放不改格式
      return longest > maxEdge ? await chain.png({ compressionLevel: 9 }).toBuffer() : null;
    }
    return await chain.flatten({ background: '#ffffff' }).jpeg({ quality: 88, mozjpeg: true }).toBuffer();
  } catch {
    return null;
  }
}

/** 把本地图片文件读成 base64（ncnn-vulkan 的 refs 接受内联 base64） */
async function imageFileToBase64(filePath) {
  const buf = fs.readFileSync(filePath);
  const ext = path.extname(filePath).toLowerCase();
  const mime = ext === '.png' ? 'image/png'
    : ext === '.webp' ? 'image/webp'
    : 'image/jpeg';
  return `data:${mime};base64,${buf.toString('base64')}`;
}

/**
 * 提交生成任务。
 * @returns {{task_id:string}}
 */
async function submitJob({ baseUrl, prompt, negative, width, height, steps, cfg, seed, refs, model, timeoutMs, logger }) {
  const form = new FormData();
  const qwenModel = model === 'turbo' ? 'turbo' : 'base';
  const attached = (refs || []).filter(Boolean).slice(0, 10);
  form.append('prompt', String(prompt || ''));
  const cfgNum = cfg == null ? 1 : Number(cfg);
  if (negative && cfgNum > 1) form.append('negative', String(negative));
  const snappedW = snapMultiple(width, attached.length ? 32 : 16);
  const snappedH = snapMultiple(height, attached.length ? 32 : 16);
  if (snappedW) form.append('width', String(snappedW));
  if (snappedH) form.append('height', String(snappedH));
  // 实测：本机 ncnn 版步数 8→20 只多约 5s（耗时主要是每张图重新加载模型 ~85s + 像素量），
  // 20 步质量/指令遵循更好，保留 20 为默认。
  const stepNum = qwenModel === 'turbo' ? 8 : steps;
  if (stepNum) form.append('steps', String(stepNum));
  if (cfg != null) form.append('cfg', String(cfg));
  if (seed != null && Number(seed) !== -1) form.append('seed', String(seed));
  form.append('batch', '1');
  form.append('model', qwenModel);
  for (const r of attached) {
    if (!r) continue;
    if (Buffer.isBuffer(r)) {
      form.append('refs', new Blob([r], { type: 'image/jpeg' }), 'ref.jpg');
    } else if (String(r).startsWith('data:')) {
      const b64 = String(r).split(',')[1] || '';
      form.append('refs', new Blob([Buffer.from(b64, 'base64')], { type: 'image/jpeg' }), 'ref.jpg');
    } else if (fs.existsSync(String(r)) && fs.statSync(String(r)).isFile()) {
      const b64 = await imageFileToBase64(r);
      const buf = Buffer.from(b64.split(',')[1], 'base64');
      form.append('refs', new Blob([buf], { type: 'image/jpeg' }), path.basename(String(r)));
    }
  }

  const url = qwenRoutes(baseUrl).submit;
  const res = await lanFetch(url, {
    method: 'POST',
    body: form,
    signal: AbortSignal.timeout(Math.min(timeoutMs || 60000, 120000)),
  });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`QwenImage 提交失败 HTTP ${res.status}: ${txt.slice(0, 300)}`);
  }
  return res.json();
}

/** 查询任务状态 */
async function fetchTask(baseUrl, taskId, timeoutMs = 30000) {
  const url = qwenRoutes(baseUrl).task(taskId);
  const res = await lanFetch(url, { signal: AbortSignal.timeout(timeoutMs) });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`QwenImage 查询失败 HTTP ${res.status}: ${txt.slice(0, 200)}`);
  }
  return res.json();
}

/** 拉取产物并落盘到 dataDir */
async function downloadOutputs({ productBase, outputs, destDir, prefix, logger }) {
  const files = [];
  fs.mkdirSync(destDir, { recursive: true });
  for (const name of (outputs || [])) {
    if (!name) continue;
    const url = `${String(productBase).replace(/\/$/, '')}/product/qw/${encodeURIComponent(name)}`;
    const res = await lanFetch(url, { signal: AbortSignal.timeout(120000) });
    if (!res.ok) {
      logger?.warn?.(`[qwenimage] 产物下载失败 ${name}: HTTP ${res.status}`);
      continue;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const out = path.join(destDir, `${prefix}_${name}`);
    fs.writeFileSync(out, buf);
    let meta = { mime: 'image/png' };
    try {
      const m = await sharp(out).metadata();
      meta = { width: m.width, height: m.height, mime: 'image/png' };
    } catch {}
    files.push({ localPath: out, mime: meta.mime, width: meta.width, height: meta.height });
    logger?.info?.(`[qwenimage] 产物已落盘 ${out} (${meta.width}x${meta.height})`);
  }
  return files;
}

/**
 * 完整流程：提交 → 轮询 → 下载。
 * 与其他协议一致，返回 { ok, success, files, error? }。
 */
async function runImageJob(services, adapter, input) {
  const { config, logger } = services;
  const cfg = typeof adapter.config_json === 'string'
    ? JSON.parse(adapter.config_json) : (adapter.config_json || {});

  const baseUrl = cfg.apiBase || adapter.base_url || 'http://192.168.1.107:9000';
  const productBase = cfg.productBase || baseUrl.replace(/:\d+$/, ':9000');
  const destDir = path.join(config.dataDir, 'cache', 'temp');
  const timeoutMs = Number(cfg.timeoutMs || input.timeoutMs || 600000);
  const pollIntervalMs = Number(cfg.pollIntervalMs || 3000);

  // 参考图：与其它协议一致，imageLocalPaths 优先
  const rawRefs = []
    .concat(input.imageLocalPaths || [])
    .concat(input.imageUrls || [])
    .filter(Boolean);
  const { resolveAssetBuffer } = require('../ai-tasks');
  const resolved = await Promise.all(rawRefs.map(async (raw) => {
    try {
      return await resolveAssetBuffer(services, raw);
    } catch (e) {
      logger?.warn?.(`[qwenimage] 参考图读取失败: ${e.message}`);
      return null;
    }
  }));
  const refs = [];
  for (let i = 0; i < resolved.length; i++) {
    let buf = resolved[i];
    if (buf && buf.length) {
      // 传输优化：参考图长边压到 1536（生成分辨率本就 ≤2K，更大的参考图只会增加
      // multipart 体积与面板解码时间，不带来质量收益）。JPEG q88 通常 3~8 倍压缩。
      const compact = await compactRefBuffer(buf);
      if (compact && compact.length < buf.length) {
        logger?.info?.(`[qwenimage] 参考图 #${i + 1} 压缩 ${(buf.length / 1024 / 1024).toFixed(1)}MB → ${(compact.length / 1024 / 1024).toFixed(2)}MB`);
        buf = compact;
      }
      refs.push(buf);
    } else {
      logger?.warn?.(`[qwenimage] 参考图没有落到本地文件: ${String(rawRefs[i]).slice(0, 180)}`);
    }
  }

  const extras = input.extras || {};
  const seed = cfg.fixedSeed != null
    ? Number(cfg.fixedSeed)
    : (input.seed != null ? Number(input.seed) : (extras.seed != null ? Number(extras.seed) : Math.floor(Math.random() * 2147483647)));
  const qwenModel = extras.qwen_model === 'turbo' || extras.model === 'turbo' ? 'turbo' : 'base';

  let submitted;
  const tSubmitStart = Date.now();
  try {
    submitted = await submitJob({
      baseUrl,
      prompt: input.prompt,
      negative: input.negativePrompt || extras.negative || cfg.negative || '',
      width: input.width || extras.width,
      height: input.height || extras.height,
      steps: Number(cfg.steps || 20),
      cfg: Number(cfg.cfgScale != null ? cfg.cfgScale : 1.0),
      seed,
      refs,
      model: qwenModel,
      timeoutMs,
      logger,
    });
  } catch (e) {
    logger?.warn?.(`[qwenimage] 提交异常: ${e.message}`);
    const unreachable = e?.name === 'AbortError' || e?.cause?.code === 'ECONNREFUSED'
      || /fetch failed|ECONNREFUSED|ENOTFOUND|EHOSTUNREACH|ECONNRESET/i.test(String(e.message || ''));
    const error = unreachable ? '连不上本机 Qwen 生图地址' : `QwenImage 提交失败: ${e.message}`;
    return { ok: false, success: false, error, files: [] };
  }

  const taskId = submitted.task_id || submitted.id;
  if (!taskId) {
    return { ok: false, success: false, error: `QwenImage 未返回 task_id: ${JSON.stringify(submitted).slice(0, 200)}`, files: [] };
  }
  logger?.info?.(`[qwenimage] 任务已提交 ${taskId}（${input.width}x${input.height} seed=${seed}，提交含传输 ${Date.now() - tSubmitStart}ms，参考图 ${refs.length} 张），轮询中`);

  // 轮询
  const start = Date.now();
  let lastStatus = '';
  let pendingMs = 0;
  let task = null;
  while (Date.now() - start < timeoutMs) {
    await new Promise(r => setTimeout(r, pollIntervalMs));
    try {
      task = await fetchTask(baseUrl, taskId);
    } catch (e) {
      logger?.warn?.(`[qwenimage] 轮询异常（继续重试）: ${e.message}`);
      continue;
    }
    const st = task.status || '';
    if (st !== lastStatus) {
      if (st === 'processing' && lastStatus === 'pending') {
        pendingMs = Date.now() - start;
        logger?.info?.(`[qwenimage] ${taskId} 排队等待 ${(pendingMs / 1000).toFixed(0)}s 后开始处理`);
      }
      logger?.info?.(`[qwenimage] ${taskId} → ${st} ${task.progress || 0}% ${task.message || ''}`);
      lastStatus = st;
    }
    if (st === 'completed' || st === 'failed' || st === 'error' || st === 'cancelled') break;
  }

  if (!task || task.status !== 'completed') {
    const st = task ? task.status : 'timeout';
    return { ok: false, success: false, error: `QwenImage ${st}: ${(task && task.message) || '未在超时内完成'}`, files: [] };
  }

  let files;
  const tDlStart = Date.now();
  try {
    files = await downloadOutputs({
      productBase,
      outputs: task.outputs,
      destDir,
      prefix: `qwen_${taskId}`,
      logger,
    });
    logger?.info?.(`[qwenimage] 产物下载 ${files.length} 张耗时 ${Date.now() - tDlStart}ms`);
  } catch (e) {
    return { ok: false, success: false, error: `QwenImage 产物下载失败: ${e.message}`, files: [] };
  }
  if (!files.length) {
    return { ok: false, success: false, error: 'QwenImage 完成但无产物', files: [] };
  }

  return { ok: true, success: true, files, taskId, seed, elapsedMs: Date.now() - start, panelElapsedSec: Number(task.elapsed) || null };
}

module.exports = { runImageJob, submitJob, fetchTask, downloadOutputs, imageFileToBase64, snapMultipleOf32, snapMultiple, qwenRoutes, compactRefBuffer };
