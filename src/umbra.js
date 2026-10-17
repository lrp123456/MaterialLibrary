/**
 * KX2BFK_umbra_quick 引擎客户端
 * 契约：docs/bff_mapping_contract_walkthrough_touch.md
 *   POST {base}/api/v1/creation/public/templates/:id/runs
 *   GET  {base}/api/v1/creation/public/runs/:id
 * 鉴权：Authorization: Bearer <UMBRA_TOKEN>
 *
 * 注：选区的几何与栅格化已抽到 maskBuilder.js（通用，不依赖本引擎）。
 * 本文件保留同名再导出，历史调用方无需改动。
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { generateMediaToken } = require('./auth');
const maskBuilder = require('./maskBuilder');

const DEFAULT_BASE = process.env.UMBRA_BASE_URL || 'http://127.0.0.1:3001';
const DEFAULT_TOKEN = process.env.UMBRA_TOKEN || process.env.CREATION_PUBLIC_TOKEN || '';
const API_PREFIX = '/api/v1/creation/public';

const TEMPLATE_KEYS = {
  walkthrough: 'TPL_WALKTHROUGH',
  touch: 'TPL_TOUCH_EDITOR'
};

function resolveKv(db, key) {
  try {
    const row = db.prepare('SELECT value FROM kv WHERE key=?').get(key);
    return row?.value || null;
  } catch {
    return null;
  }
}

function getUmbraConfig(db) {
  const base = (resolveKv(db, 'umbra_base_url') || DEFAULT_BASE).replace(/\/+$/, '');
  const token = DEFAULT_TOKEN;
  const publicBase = (resolveKv(db, 'bff_public_base') || process.env.BFF_PUBLIC_BASE || '').replace(/\/+$/, '');
  const templates = {
    walkthrough: resolveKv(db, TEMPLATE_KEYS.walkthrough) || process.env.TPL_WALKTHROUGH || '',
    touch: resolveKv(db, TEMPLATE_KEYS.touch) || process.env.TPL_TOUCH_EDITOR || ''
  };
  return { base, token, publicBase, templates };
}

function mapEngineStatus(status) {
  const s = String(status || '').toLowerCase();
  if (s === 'succeeded' || s === 'success' || s === 'completed' || s === 'done') return 'success';
  if (s === 'failed' || s === 'error' || s === 'canceled' || s === 'cancelled') return 'failed';
  if (s === 'running') return 'running';
  return 'pending';
}

function resolveTemplateId(db, type) {
  const cfg = getUmbraConfig(db);
  if (type === 'spatial_walkthrough') {
    return { templateId: cfg.templates.walkthrough, kind: 'walkthrough' };
  }
  return { templateId: cfg.templates.touch, kind: 'touch' };
}

/** 把 fid 拼成引擎可拉取的 BFF 对外 URL（需配置 BFF_PUBLIC_BASE） */
function assetPublicUrl(config, db, fid, { longLived = true } = {}) {
  const cfg = getUmbraConfig(db);
  const base = cfg.publicBase || config.bffPublicBase || '';
  if (!base) {
    throw new Error('未配置 BFF_PUBLIC_BASE，引擎无法拉取源图');
  }
  const token = generateMediaToken(fid, longLived ? 3600 * 6 : 900);
  return `${base}/api/viewer/assets/${encodeURIComponent(fid)}/image?media_token=${encodeURIComponent(token)}&raw=1`;
}

function pickOutputUrl(outputs, keys) {
  if (!outputs || typeof outputs !== 'object') return null;
  for (const k of keys) {
    if (outputs[k] && typeof outputs[k] === 'string' && /^https?:\/\//i.test(outputs[k])) {
      return outputs[k];
    }
  }
  // 宽松：任意含 video/poster 的 key
  for (const [k, v] of Object.entries(outputs)) {
    if (typeof v === 'string' && /^https?:\/\//i.test(v)) {
      const lk = k.toLowerCase();
      if (keys.some(x => lk.includes(x.toLowerCase()))) return v;
    }
  }
  // 兜底：第一个 http(s) 字符串
  for (const v of Object.values(outputs)) {
    if (typeof v === 'string' && /^https?:\/\//i.test(v)) return v;
  }
  return null;
}

const WALKTHROUGH_VIDEO_KEYS = ['out_video', 'walkthrough成片', 'outVideo', 'video'];
const WALKTHROUGH_POSTER_KEYS = ['out_poster', '漫游海报', 'outPoster', 'poster'];
const TOUCH_IMAGE_KEYS = ['out_image', 'outImage', 'image', 'result'];

async function downloadToFile(url, destPath, { timeoutMs = 180000, token } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  const res = await fetch(url, {
    headers,
    signal: AbortSignal.timeout(timeoutMs)
  });
  if (!res.ok) throw new Error(`下载产物失败 HTTP ${res.status}: ${url.slice(0, 120)}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.writeFileSync(destPath, buf);
  return destPath;
}

/**
 * 提交引擎 run。失败抛错（连接失败/模板未配/HTTP 错误）。
 * @returns {{ runId: string, templateId: string, status: string }}
 */
async function submitUmbraRun(db, { type, bindings }) {
  const cfg = getUmbraConfig(db);
  if (!cfg.token) throw new Error('未配置 UMBRA_TOKEN / CREATION_PUBLIC_TOKEN');
  const { templateId } = resolveTemplateId(db, type);
  if (!templateId) throw new Error(`未配置 template_id（type=${type}）；请在 kv 写入 ${type === 'spatial_walkthrough' ? TEMPLATE_KEYS.walkthrough : TEMPLATE_KEYS.touch}`);

  const url = `${cfg.base}${API_PREFIX}/templates/${encodeURIComponent(templateId)}/runs`;
  let res;
  try {
    res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${cfg.token}`
      },
      body: JSON.stringify({ bindings }),
      signal: AbortSignal.timeout(15000)
    });
  } catch (e) {
    throw new Error(`引擎不可达 ${cfg.base}: ${e.message}`);
  }
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch {
    throw new Error(`引擎响应非 JSON HTTP ${res.status}: ${text.slice(0, 200)}`);
  }
  if (!res.ok || data.success === false) {
    throw new Error(data.error || `引擎提交失败 HTTP ${res.status}`);
  }
  const runId = data.data?.id;
  if (!runId) throw new Error(`引擎未返回 run id: ${text.slice(0, 200)}`);
  return {
    runId,
    templateId,
    status: mapEngineStatus(data.data?.status) || 'pending'
  };
}

/**
 * 查询引擎 run 状态。
 * @returns {{ status, progress, outputs, error }}
 */
async function pollUmbraRun(db, runId) {
  const cfg = getUmbraConfig(db);
  if (!cfg.token) throw new Error('未配置 UMBRA_TOKEN / CREATION_PUBLIC_TOKEN');
  const url = `${cfg.base}${API_PREFIX}/runs/${encodeURIComponent(runId)}`;
  let res;
  try {
    res = await fetch(url, {
      headers: { Authorization: `Bearer ${cfg.token}` },
      signal: AbortSignal.timeout(15000)
    });
  } catch (e) {
    throw new Error(`引擎轮询不可达: ${e.message}`);
  }
  const text = await res.text();
  let data;
  try { data = JSON.parse(text); } catch {
    throw new Error(`引擎轮询响应非 JSON HTTP ${res.status}`);
  }
  if (!res.ok || data.success === false) {
    throw new Error(data.error || `引擎轮询失败 HTTP ${res.status}`);
  }
  const d = data.data || {};
  return {
    status: mapEngineStatus(d.status),
    progress: typeof d.progress === 'number' ? Math.max(0, Math.min(100, Math.round(d.progress))) : null,
    outputs: d.outputs || {},
    error: d.error || null
  };
}

/** 构造 spatial_walkthrough bindings */
function buildWalkthroughBindings({ imageUrls, cameraStyle, aspectRatio, sceneDuration, spaces }) {
  const images = (imageUrls || []).filter(Boolean);
  if (images.length < 2) throw new Error('spatial_walkthrough 至少需要 2 张空间图');
  if (images.length > 6) throw new Error('spatial_walkthrough 最多 6 张空间图');
  const bindings = { images };
  if (spaces) bindings.spaces = Array.isArray(spaces) ? spaces.join(',') : String(spaces);
  if (cameraStyle) bindings.camera_style = String(cameraStyle);
  if (aspectRatio) bindings.aspect_ratio = String(aspectRatio);
  if (sceneDuration != null && sceneDuration !== '') bindings.scene_duration = String(sceneDuration);
  return bindings;
}

/** 构造 touch_photo_editor bindings */
function buildTouchBindings({ imageUrl, mode, bbox, ratio, strategy, maskUrl, subjectUrl, prompt, promptEn, subMode, pasteback, quad }) {
  if (!imageUrl) throw new Error('touch_photo_editor 缺少 image URL');
  const m = String(mode || '').toLowerCase();
  if (!['remove', 'insert', 'replace', 'expand', 'upscale'].includes(m)) {
    throw new Error(`不支持的 mode: ${mode}`);
  }
  const bindings = {
    image: imageUrl,
    mode: m
  };
  if (maskUrl) bindings.mask = String(maskUrl);
  if (subjectUrl) bindings.subject = String(subjectUrl);
  if (bbox) bindings.bbox = String(bbox);
  if (ratio) bindings.ratio = String(ratio);
  if (strategy) bindings.strategy = String(strategy);
  if (prompt) bindings.prompt = String(prompt);
  if (promptEn) bindings.prompt_en = String(promptEn);
  if (subMode) bindings.sub_mode = String(subMode);
  if (quad) bindings.quad = String(quad);
  if (pasteback !== undefined) {
    bindings.pasteback = pasteback === true || String(pasteback) === 'true';
  }
  return bindings;
}

function extractVideoMeta(videoPath) {
  return new Promise((resolve) => {
    const args = [
      '-v', 'error',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height,duration',
      '-show_entries', 'format=duration,size',
      '-of', 'json',
      videoPath
    ];
    const ff = spawn('ffprobe', args);
    let out = '';
    let err = '';
    ff.stdout.on('data', d => { out += d; });
    ff.stderr.on('data', d => { err += d; });
    ff.on('close', () => {
      try {
        const j = JSON.parse(out || '{}');
        const st = j.streams?.[0] || {};
        const fmt = j.format || {};
        const duration = Number(st.duration || fmt.duration) || null;
        const width = Number(st.width) || null;
        const height = Number(st.height) || null;
        const size = Number(fmt.size) || null;
        resolve({ duration, width, height, size });
      } catch {
        resolve({ duration: null, width: null, height: null, size: null });
      }
    });
    ff.on('error', () => resolve({ duration: null, width: null, height: null, size: null }));
  });
}

function extractPoster(videoPath, posterPath) {
  return new Promise((resolve) => {
    fs.mkdirSync(path.dirname(posterPath), { recursive: true });
    const tryAt = (ss, onFail) => {
      const ff = spawn('ffmpeg', ['-y', '-ss', ss, '-i', videoPath, '-vframes', '1', '-q:v', '2', posterPath]);
      ff.on('close', code => {
        if (code === 0 && fs.existsSync(posterPath) && fs.statSync(posterPath).size > 0) resolve(true);
        else onFail();
      });
      ff.on('error', () => resolve(false));
    };
    tryAt('00:00:00.5', () => tryAt('00:00:00', () => resolve(false)));
  });
}

module.exports = {
  getUmbraConfig,
  resolveTemplateId,
  mapEngineStatus,
  assetPublicUrl,
  pickOutputUrl,
  downloadToFile,
  submitUmbraRun,
  pollUmbraRun,
  buildWalkthroughBindings,
  buildTouchBindings,
  extractVideoMeta,
  extractPoster,
  WALKTHROUGH_VIDEO_KEYS,
  WALKTHROUGH_POSTER_KEYS,
  TOUCH_IMAGE_KEYS,
  // —— 以下原属本文件，已迁至 maskBuilder.js，再导出以保持兼容 ——
  aiMaskDir: maskBuilder.aiMaskDir,
  maskPublicUrl: maskBuilder.maskPublicUrl,
  resolveMaskFile: maskBuilder.resolveMaskFile,
  rasterizeTouchMask: maskBuilder.rasterizeTouchMask,
  persistTouchMask: maskBuilder.persistTouchMask,
  persistUploadedBuffer: maskBuilder.persistUploadedBuffer,
  quadToBbox: maskBuilder.quadToBbox,
  stringifyQuad: maskBuilder.stringifyQuad,
  toPixelPoints: maskBuilder.toPixelPoints,
  parsePoint: maskBuilder.parsePoint,
};
