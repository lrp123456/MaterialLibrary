/**
 * 魔搭 ModelScope 云端 Qwen-Image 2.1（API-Inference 异步任务）
 *
 * 定位：与 `qwenimage_local`（局域网 ncnn-vulkan）**同模型、不同算力**。
 *   本机 GPU 排队或关机时走这条云端通道，交付形态与其它协议一致。
 *
 * 官方流程（2026-10 核对 model 页示例）：
 *   1. POST {base}/v1/images/generations
 *      header: Authorization: Bearer <Token>
 *              X-ModelScope-Async-Mode: true
 *      body  : { model, prompt, image_url?: string[], size?, seed?, negative_prompt? }
 *      → { task_id }
 *   2. GET  {base}/v1/tasks/{task_id}
 *      header: X-ModelScope-Task-Type: image_generation
 *      → { task_status: PENDING|RUNNING|SUCCEED|FAILED, output_images: [url], errors? }
 *   3. 下载 output_images[*] 落盘到 data/cache/temp
 *
 * 关键事实：
 *   - `image_url` **接受 data URI**（官方模型页给的是 `image_to_data_uri()`），
 *     所以素材库里的本地原图不必先传 OSS，直接内联即可。公网 https 地址也照收。
 *   - 传 1 张是图像编辑，传多张是「图一 + 图二」式的多图编辑；不传是文生图。
 *   - 不同模型对 steps / guidance 的接受度不一致（Turbo 蒸馏版尤其），
 *     默认**只发官方示例里出现过的字段**，其余通过适配器 config 显式开启。
 *
 * 协议：qwenimage_modelscope
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
const { fetchNet, describeFetchError, isPreSendError } = require('./net-retry');
const { compactRefBuffer } = require('./qwenimage-local');

const DEFAULT_MODEL = 'Qwen/Qwen-Image-2.1-Turbo';

/** 基址归一：适配器可能填 https://api-inference.modelscope.cn 或 .../v1 或 .../v1/ */
function msBase(baseUrl) {
  const raw = String(baseUrl || 'https://api-inference.modelscope.cn').trim().replace(/\/+$/, '');
  return raw.endsWith('/v1') ? raw.slice(0, -3) : raw;
}
const submitUrl = (baseUrl) => `${msBase(baseUrl)}/v1/images/generations`;
const taskUrl = (baseUrl, taskId) => `${msBase(baseUrl)}/v1/tasks/${encodeURIComponent(taskId)}`;

/** 尺寸对齐 16（Qwen-Image 走 8× VAE + 2× patch），并夹到模型可接受区间 */
function snapSize(n, fallback) {
  const v = Math.round(Number(n));
  if (!Number.isFinite(v) || v <= 0) return fallback;
  return Math.max(512, Math.min(2048, Math.round(v / 16) * 16));
}

/**
 * 尺寸优先级：
 *   1. extras.size 已是 "WxH"（契约换算表产物 / 调用方直传）
 *   2. 显式 width + height
 *   3. 尺寸档（1K/2K）× 宽高比，与 models-contract 的 QWEN_SIZE_TABLE 保持同值
 *   4. 1024×1024
 * @returns {string} "WxH"
 */
const SIZE_TABLE = {
  '1K_1:1': [1024, 1024], '1K_4:3': [1152, 864], '1K_3:4': [864, 1152],
  '1K_16:9': [1280, 720], '1K_9:16': [720, 1280], '1K_3:2': [1248, 832], '1K_2:3': [832, 1248],
  '2K_1:1': [1536, 1536], '2K_4:3': [1536, 1152], '2K_3:4': [1152, 1536],
  '2K_16:9': [1920, 1080], '2K_9:16': [1080, 1920], '2K_3:2': [1872, 1248], '2K_2:3': [1248, 1872],
};

function resolveSize(input = {}) {
  const extras = input.extras || {};
  const direct = String(extras.size || input.size || '').trim();
  const m = direct.match(/^(\d{3,5})\s*[xX×]\s*(\d{3,5})$/);
  if (m) return `${snapSize(m[1], 1024)}x${snapSize(m[2], 1024)}`;

  const w = Number(extras.width || input.width);
  const h = Number(extras.height || input.height);
  if (Number.isFinite(w) && Number.isFinite(h) && w > 0 && h > 0) {
    return `${snapSize(w, 1024)}x${snapSize(h, 1024)}`;
  }

  const ratio = String(extras.ratio || input.ratio || '1:1');
  const tierHint = String(extras.sizeTier || input.sizeTier || '').toUpperCase();
  const tierFromSize = /^(\d(?:\.\d)?K)$/.exec(direct.toUpperCase());
  const tier = tierHint === '2K' || (tierFromSize && tierFromSize[1] === '2K') ? '2K' : '1K';
  const hit = SIZE_TABLE[`${tier}_${ratio}`];
  if (hit) return `${hit[0]}x${hit[1]}`;
  return '1024x1024';
}

function mimeOf(filePath) {
  const ext = path.extname(String(filePath || '')).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.webp') return 'image/webp';
  return 'image/jpeg';
}

/** 读本地文件 → Buffer */
function readLocal(filePath) {
  try {
    const p = String(filePath || '');
    if (!p || !fs.existsSync(p) || !fs.statSync(p).isFile()) return null;
    return fs.readFileSync(p);
  } catch {
    return null;
  }
}

/**
 * 参考图归一成 `image_url` 数组元素。
 * - 本地路径 → 压缩后 data URI
 * - data URI   → 过大的压缩后重建，小的原样
 * - 公网 https → 原样交给云端拉取（本机/内网地址云端拉不到，改走本地读取或直接丢弃）
 */
async function toImageUrl(raw, { logger, maxEdge = 1536 } = {}) {
  const s = String(raw || '').trim();
  if (!s) return null;

  if (s.startsWith('data:image/')) {
    const comma = s.indexOf(',');
    if (comma === -1) return null;
    const buf = Buffer.from(s.slice(comma + 1), 'base64');
    if (!buf.length) return null;
    // 云端接受 data URI，但几 MB 的 base64 会显著拖慢提交；超过 1.2MB 先压一轮
    if (buf.length <= 1.2 * 1024 * 1024) return s;
    const compact = await compactRefBuffer(buf, maxEdge);
    if (!compact || compact.length >= buf.length) return s;
    return `data:${await sniffMime(compact, s.slice(5, comma))};base64,${compact.toString('base64')}`;
  }

  if (/^https?:\/\//i.test(s)) {
    let host = '';
    try { host = new URL(s).hostname.toLowerCase(); } catch { return null; }
    const priv = host === 'localhost' || /^127\./.test(host) || /^10\./.test(host)
      || /^192\.168\./.test(host) || /^172\.(1[6-9]|2\d|3[0-1])\./.test(host);
    if (!priv) return s;
    // 内网/本机地址云端拉不到：当作相对资源再走一次本地读取
    const local = readLocal(s);
    if (!local) {
      logger?.warn?.(`[modelscope-qwen] 参考图是内网地址，云端无法拉取，已跳过: ${s.slice(0, 120)}`);
      return null;
    }
    const compact = (await compactRefBuffer(local, maxEdge)) || local;
    return `data:${mimeOf(s)};base64,${compact.toString('base64')}`;
  }

  const buf = readLocal(s);
  if (!buf) return null;
  const compact = (await compactRefBuffer(buf, maxEdge)) || buf;
  return `data:${mimeOf(s)};base64,${compact.toString('base64')}`;
}

/** 压缩后可能换了格式，以 sharp 识别结果为准，识别失败才信声明 */
async function sniffMime(buf, declared) {
  try {
    const m = await sharp(buf, { failOn: 'none' }).metadata();
    if (m && m.format) return m.format === 'jpg' ? 'image/jpeg' : `image/${m.format}`;
  } catch {}
  const d = String(declared || '').split(';')[0].trim();
  return /^image\/(png|jpeg|webp)$/.test(d) ? d : 'image/png';
}

/** 收集参考图（本地路径优先，其次 imageUrls），最多 maxRefs 张 */
async function collectRefs(input, { services, logger, maxRefs = 3 } = {}) {
  const { resolveAssetBuffer } = require('../ai-tasks');
  const seeds = []
    .concat(Array.isArray(input.imageLocalPaths) ? input.imageLocalPaths : [])
    .concat(Array.isArray(input.imageUrls) ? input.imageUrls : [])
    .filter(Boolean);

  const urls = [];
  for (const raw of seeds) {
    if (urls.length >= maxRefs) break;
    let url = await toImageUrl(raw, { logger });
    if (!url && logger) logger.warn(`[modelscope-qwen] 参考图无法读取，跳过: ${String(raw).slice(0, 160)}`);
    if (!url) {
      // 兜底：交给资产解析器（遮罩 / 资产 fid / 缓存文件等）
      try {
        const buf = await resolveAssetBuffer(services, raw);
        if (buf && buf.length) {
          const compact = (await compactRefBuffer(buf, 1536)) || buf;
          url = `data:${await sniffMime(compact, 'image/png')};base64,${compact.toString('base64')}`;
        }
      } catch (_) {}
    }
    if (url) urls.push(url);
  }
  return urls;
}

/**
 * 提交任务。
 * @returns {Promise<{task_id:string, raw:object}>}
 */
async function submitJob({ baseUrl, apiKey, model, prompt, negative, refs, size, seed, timeoutMs, logger }) {
  if (!apiKey) {
    throw new Error('[ModelScope] 缺少 Access Token：请在 .env 配置 MODELSCOPE_API_KEY，或在管理台「魔搭社区」接入点填写密钥');
  }
  if (!String(prompt || '').trim()) {
    throw new Error('[ModelScope] prompt 为必填参数且不能为空');
  }

  const body = { model: model || DEFAULT_MODEL, prompt: String(prompt).trim() };
  if (negative) body.negative_prompt = String(negative).slice(0, 2000);
  if (size) body.size = size;
  if (refs.length) body.image_url = refs.slice(0, 3);
  if (seed != null && Number(seed) >= 0) body.seed = Math.floor(Number(seed)) % 2147483647;

  const res = await fetchNet(submitUrl(baseUrl), {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'X-ModelScope-Async-Mode': 'true',
    },
    body: JSON.stringify(body),
  }, { timeoutMs: 90000, what: '魔搭生图提交', retryOn: isPreSendError });

  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`魔搭生图提交失败 HTTP ${res.status}: ${txt.slice(0, 300)}`);
  }
  const data = await res.json().catch(() => ({}));
  const taskId = data.task_id || data.taskId || data.id || (data.data && data.data.task_id);
  if (!taskId) {
    throw new Error(`魔搭生图未返回 task_id: ${JSON.stringify(data).slice(0, 240)}`);
  }
  logger?.info?.(`[modelscope-qwen] 任务已提交 ${taskId}（${model || DEFAULT_MODEL}，${size || '默认尺寸'}，参考图 ${refs.length} 张）`);
  return { task_id: taskId, raw: data };
}

/** 查询任务 */
async function fetchTask({ baseUrl, apiKey, taskId, timeoutMs = 30000 }) {
  const res = await fetchNet(taskUrl(baseUrl, taskId), {
    method: 'GET',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'X-ModelScope-Task-Type': 'image_generation',
    },
  }, { timeoutMs, attempts: 2, what: '魔搭任务查询' });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`魔搭任务查询失败 HTTP ${res.status}: ${txt.slice(0, 200)}`);
  }
  return res.json();
}

/** 下载产物到 tempDir */
async function downloadOutputs({ urls, destDir, prefix, timeoutMs = 180000, logger }) {
  const files = [];
  fs.mkdirSync(destDir, { recursive: true });
  for (let i = 0; i < (urls || []).length; i++) {
    const url = urls[i];
    if (!url) continue;
    const res = await fetchNet(url, {}, { timeoutMs, what: '魔搭产物下载' });
    if (!res.ok) {
      logger?.warn?.(`[modelscope-qwen] 产物下载失败 #${i + 1}: HTTP ${res.status}`);
      continue;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const name = `${prefix}_${i}.png`;
    const out = path.join(destDir, name);
    fs.writeFileSync(out, buf);
    let meta = { mime: 'image/png' };
    try {
      const m = await sharp(out).metadata();
      meta = { width: m.width, height: m.height, mime: m.format === 'jpeg' ? 'image/jpeg' : 'image/png' };
    } catch {}
    files.push({
      localPath: out,
      previewUrl: `/api/cache/temp/${name}`,
      mime: meta.mime,
      width: meta.width,
      height: meta.height,
    });
    logger?.info?.(`[modelscope-qwen] 产物已落盘 ${out} (${meta.width || '?'}x${meta.height || '?'}, ${(buf.length / 1024).toFixed(0)}KB)`);
  }
  return files;
}

/**
 * 完整流程：提交 → 轮询 → 下载。
 * 与其它协议一致，返回 { ok, success, files, error? }。
 */
async function runImageJob(services, adapter, input) {
  const { config, logger } = services;
  const cfg = typeof adapter.config_json === 'string'
    ? JSON.parse(adapter.config_json || '{}')
    : (adapter.config_json || {});
  const secrets = typeof adapter.secrets_json === 'string'
    ? JSON.parse(adapter.secrets_json || '{}')
    : (adapter.secrets_json || {});

  const baseUrl = cfg.apiBase || adapter.base_url || 'https://api-inference.modelscope.cn';
  const model = cfg.defaultModel || DEFAULT_MODEL;
  const timeoutMs = Number(input.timeoutMs || cfg.timeoutMs || 600000);
  const pollIntervalMs = Number(cfg.pollIntervalMs || 5000);
  const destDir = path.join(config.dataDir, 'cache', 'temp');

  // 钥匙：优先适配器显式配置 → 接入点解析结果（executeAdapterInner 已注入 input.__apiKey）
  let apiKey = input.__apiKey || cfg.apiKey || secrets.apiKey || process.env.MODELSCOPE_API_KEY || '';
  if (!apiKey) {
    try {
      const { resolveProviderApiKey } = require('../providers');
      apiKey = resolveProviderApiKey(services.db, adapter, secrets) || '';
    } catch (_) {}
  }
  if (!apiKey) {
    return {
      ok: false, success: false, files: [],
      error: '[ModelScope] 未配置 Access Token：请在 .env 填 MODELSCOPE_API_KEY=ms-xxx 后重启服务，或在管理台「魔搭社区 (ModelScope)」接入点填密钥',
    };
  }

  const extras = input.extras || {};
  const refs = await collectRefs(input, { services, logger, maxRefs: Number(cfg.maxRefs || 3) });
  const size = cfg.sendSize === false ? '' : resolveSize(input);
  const seed = extras.seed != null ? Number(extras.seed) : (input.seed != null ? Number(input.seed) : null);

  let submitted;
  try {
    submitted = await submitJob({
      baseUrl,
      apiKey,
      model,
      prompt: input.prompt,
      negative: input.negativePrompt || extras.negative_prompt || extras.negative || '',
      refs,
      size,
      seed,
      logger,
    });
  } catch (e) {
    logger?.warn?.(`[modelscope-qwen] 提交异常: ${describeFetchError(e)}`);
    return { ok: false, success: false, files: [], error: e.message };
  }

  const taskId = submitted.task_id;
  const start = Date.now();
  let task = null;
  let lastStatus = '';

  while (Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, pollIntervalMs));
    try {
      task = await fetchTask({ baseUrl, apiKey, taskId });
    } catch (e) {
      // 任务已在云端排队/渲染，单次查询抖动不判死
      logger?.warn?.(`[modelscope-qwen] 轮询异常（继续重试）: ${e.message}`);
      continue;
    }
    const st = String(task.task_status || task.status || '').toUpperCase();
    if (st !== lastStatus) {
      logger?.info?.(`[modelscope-qwen] ${taskId} → ${st}${task.progress ? ` ${task.progress}` : ''}`);
      lastStatus = st;
    }
    if (st === 'SUCCEED' || st === 'SUCCEEDED' || st === 'SUCCESS') break;
    if (st === 'FAILED' || st === 'FAIL' || st === 'ERROR' || st === 'CANCELED' || st === 'CANCELLED') {
      const detail = task.errors || task.error || task.message || task.error_message || '';
      const msg = typeof detail === 'string' ? detail : JSON.stringify(detail).slice(0, 300);
      return { ok: false, success: false, files: [], taskId, error: `魔搭生图失败: ${msg || '未知原因'}` };
    }
  }

  const finalStatus = String((task && (task.task_status || task.status)) || '').toUpperCase();
  if (!['SUCCEED', 'SUCCEEDED', 'SUCCESS'].includes(finalStatus)) {
    return {
      ok: false, success: false, files: [], taskId,
      error: `魔搭生图超时（${Math.round(timeoutMs / 1000)}s，最后状态 ${finalStatus || 'unknown'}），任务 ID: ${taskId}`,
    };
  }

  const urls = []
    .concat(Array.isArray(task.output_images) ? task.output_images : [])
    .concat(task.output_image ? [task.output_image] : [])
    .filter(Boolean);

  if (!urls.length) {
    return { ok: false, success: false, files: [], taskId, error: '魔搭任务成功但未返回 output_images' };
  }

  let files = [];
  try {
    files = await downloadOutputs({
      urls,
      destDir,
      prefix: `msqwen_${taskId}_${crypto.randomBytes(3).toString('hex')}`,
      logger,
    });
  } catch (e) {
    return { ok: false, success: false, files: [], taskId, error: `魔搭产物下载失败: ${e.message}` };
  }
  if (!files.length) {
    return { ok: false, success: false, files: [], taskId, error: '魔搭任务完成但产物全部下载失败' };
  }

  return {
    ok: true,
    success: true,
    taskId,
    files,
    raw: task,
    elapsedMs: Date.now() - start,
  };
}

module.exports = {
  runImageJob,
  submitJob,
  fetchTask,
  downloadOutputs,
  resolveSize,
  toImageUrl,
  collectRefs,
  msBase,
  submitUrl,
  taskUrl,
  DEFAULT_MODEL,
};
