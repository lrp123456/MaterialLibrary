/**
 * 万相 3.0 标准版（wan3.0-video）。
 * 走阿里百炼 DashScope 异步任务：
 * 提交 POST {base}/api/v1/services/aigc/video-generation/video-synthesis
 * 轮询 GET {base}/api/v1/tasks/{task_id}
 * 成功后无鉴权下载 output.video_url 到 cache/temp 并写入 files[0].remoteUrl。
 * 密钥只读 ALIBAILIAN_KEY，缺密钥发请求前直接报错。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');
const { materializeFrameUrl } = require('../frame-relay');

const WAN_IDS = new Set(['wan3_0_video', 'wan3.0-video']);
const RATIOS = new Set(['16:9', '4:3', '1:1', '3:4', '9:16', 'adaptive']);
let pollDelayMs = 10000;

function isWanModel(id) {
  return WAN_IDS.has(String(id || '').trim());
}

function missingEnvError() {
  const err = new Error('未配置 ALIBAILIAN_KEY');
  err.status = 400;
  err.statusCode = 400;
  err.code = 'alibailian_key_missing';
  return err;
}

function gatewayBase() {
  // 官方百炼网关域名是 maas.aliyuncs.com；旧代码误写成 baas.aliyun.com，
  // TLS 握手会被直接重置（fetch failed / ECONNRESET），提交与轮询全部失败。
  return String(process.env.ALIBAILIAN_BASE_URL || 'https://llm-l2i86gc5rubd2u49.cn-beijing.maas.aliyuncs.com')
    .replace(/\/+$/, '')
    .replace(/\/api\/v1$/i, '');
}

function assertWanEnv() {
  const key = String(process.env.ALIBAILIAN_KEY || '').trim();
  if (!key) throw missingEnvError();
  return { key, base: gatewayBase() };
}

function mapResolution(value) {
  const raw = String(value || '').trim().toLowerCase().replace(/_sr2x$/, '');
  if (raw.startsWith('480')) return '480P';
  if (raw.startsWith('1080')) return '1080P';
  return '720P';
}

function mapDuration(value) {
  const n = Number(value);
  if (n === -1) return -1;
  if (!Number.isFinite(n)) return 5;
  return Math.max(2, Math.min(30, Math.round(n)));
}

function mapRatio(value) {
  const raw = String(value || '').trim();
  return RATIOS.has(raw) ? raw : 'adaptive';
}

function gatewayError(json, status, fallback) {
  const raw = json?.message || json?.error?.message || json?.error || json?.code || '';
  const text = typeof raw === 'string' ? raw : '';
  const err = new Error(text || `${fallback}（HTTP ${status}）`);
  err.status = status >= 400 && status < 500 ? 400 : 502;
  return err;
}

async function publicMedia(services, raw) {
  const url = await materializeFrameUrl(services, raw, { label: '万相参考图' });
  return url || '';
}

async function buildMedia(services, input) {
  const mode = String(input.genMode || input.mode || '').trim();
  const first = input.firstFrame ? await publicMedia(services, input.firstFrame) : '';
  const last = input.lastFrame ? await publicMedia(services, input.lastFrame) : '';
  const images = [];
  for (const item of [].concat(input.imageUrls || [])) {
    const url = await publicMedia(services, item);
    if (url) images.push(url);
  }
  const useFrames = mode === 'first_last_frame' || mode === 'image_to_video' || first || last;
  if (useFrames && (first || last || images.length)) {
    const media = [];
    const head = first || images[0] || '';
    const tail = last || '';
    if (head) media.push({ type: 'first_frame', url: head });
    if (tail && tail !== head) media.push({ type: 'last_frame', url: tail });
    return media;
  }
  if (mode === 'text_to_video' || !images.length) return [];
  return images.slice(0, 5).map((url) => ({ type: 'reference_image', url }));
}

function buildSubmitBody(input, media) {
  const prompt = String(input.prompt || '').trim();
  const seconds = mapDuration(input.duration);
  const resolution = mapResolution(input.resolution || input.size);
  const ratio = mapRatio(input.ratio);

  const body = {
    model: 'wan3.0-video',
    input: {
      prompt,
    },
    parameters: {
      resolution,
      ratio,
    },
  };

  if (seconds !== -1) {
    body.parameters.duration = seconds;
  }

  if (Array.isArray(media) && media.length) {
    body.input.media = media;
  }

  return body;
}

async function createTask(env, body, { signal } = {}) {
  const url = `${env.base}/api/v1/services/aigc/video-generation/video-synthesis`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.key}`,
      'Content-Type': 'application/json',
      'X-DashScope-Async': 'enable',
    },
    body: JSON.stringify(body),
    signal: signal || AbortSignal.timeout(60000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) throw gatewayError(json, res.status, '万相提交失败');
  const taskId = json.output?.task_id || json.task_id || json.id || '';
  if (!taskId) throw new Error('万相没有返回任务号');
  return taskId;
}

async function pollTask(env, taskId, { signal } = {}) {
  const url = `${env.base}/api/v1/tasks/${encodeURIComponent(taskId)}`;
  const deadline = Date.now() + 15 * 60 * 1000;
  while (Date.now() < deadline) {
    if (signal && signal.aborted) throw new Error('任务已取消');
    if (pollDelayMs > 0) {
      await new Promise((resolve, reject) => {
        const timer = setTimeout(resolve, pollDelayMs);
        if (signal) {
          signal.addEventListener('abort', () => {
            clearTimeout(timer);
            reject(new Error('任务已取消'));
          }, { once: true });
        }
      });
    }
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${env.key}` },
      signal: signal || AbortSignal.timeout(30000),
    });
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw gatewayError(json, res.status, '万相查询失败');
    const output = json.output || {};
    const taskStatus = String(output.task_status || json.status || '').toUpperCase();
    if (taskStatus === 'SUCCEEDED' || taskStatus === 'SUCCESS' || taskStatus === 'COMPLETED') {
      const videoUrl = String(output.video_url || output.results?.video_url || '').trim();
      if (!videoUrl) throw new Error('万相任务完成但未返回 video_url');
      return videoUrl;
    }
    if (taskStatus === 'FAILED' || taskStatus === 'CANCELED' || taskStatus === 'CANCELLED') {
      const msg = output.message || output.code || json.message || '万相生成失败';
      throw new Error(`万相生成失败: ${msg}`);
    }
  }
  throw new Error('万相生成超时');
}

async function downloadPublic(url, dest, { signal } = {}) {
  const res = await fetch(url, { redirect: 'follow', signal: signal || AbortSignal.timeout(180000) });
  if (!res.ok || !res.body) throw new Error(`万相公网视频下载失败（HTTP ${res.status}）`);
  await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(dest));
  if (!fs.existsSync(dest) || fs.statSync(dest).size < 100) {
    try { fs.unlinkSync(dest); } catch { /* 半截文件丢掉 */ }
    throw new Error('万相公网视频下载失败');
  }
}

async function generateWanVideo(services, input = {}, { signal } = {}) {
  const env = assertWanEnv(services);
  const prompt = String(input.prompt || '').trim();
  const media = await buildMedia(services, input);
  if (!prompt && !media.length) {
    const err = new Error('请填写提示词，或上传一张参考图');
    err.status = 400;
    throw err;
  }
  const body = buildSubmitBody(input, media);
  const taskId = await createTask(env, body, { signal });
  const remoteUrl = await pollTask(env, taskId, { signal });
  if (!remoteUrl) throw new Error('万相生成失败：未获取到公网地址');

  const tempDir = path.join(services.config.dataDir, 'cache', 'temp');
  fs.mkdirSync(tempDir, { recursive: true });
  const name = `wan_${String(taskId).replace(/[^\w.-]/g, '').slice(0, 40) || crypto.randomBytes(4).toString('hex')}.mp4`;
  const dest = path.join(tempDir, name);

  await downloadPublic(remoteUrl, dest, { signal });

  const previewUrl = `/api/cache/temp/${path.basename(dest)}`;
  return {
    ok: true,
    success: true,
    resolution: body.parameters?.resolution || mapResolution(input.resolution),
    seconds: body.parameters?.duration !== undefined ? body.parameters.duration : mapDuration(input.duration),
    videoUrl: previewUrl,
    files: [{
      previewUrl,
      url: previewUrl,
      localPath: dest,
      remoteUrl,
      mime: 'video/mp4',
    }],
  };
}

function setPollDelay(ms) {
  pollDelayMs = Number(ms) || 0;
}

module.exports = {
  isWanModel,
  assertWanEnv,
  mapResolution,
  mapDuration,
  mapRatio,
  buildSubmitBody,
  generateWanVideo,
  setPollDelay,
};
