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

/**
 * 百炼任务时间戳是北京时间字符串 "2026-11-11 13:47:25.452"，不带时区，
 * 显式按 +08:00 解析，避免服务器时区不是东八区时算错渲染耗时。
 */
function parseWanTaskTime(value) {
  const s = String(value || '').trim();
  if (!s) return null;
  const ms = Date.parse(s.replace(' ', 'T') + '+08:00');
  return Number.isFinite(ms) ? ms : null;
}

/**
 * 渲染期进度曲线：15% 起步，渐近压到 82% 封顶（88% 留给下载、100% 由终态写）。
 * 参考时间常数 240s：4 分钟约到 50%，9 分钟约 73%，与万相实测 6–10 分钟对齐。
 */
function renderingProgress(waitedMs) {
  const pct = 15 + 67 * (1 - Math.exp(-Math.max(0, waitedMs) / 240000));
  return Math.min(82, Math.round(pct));
}

function fmtSec(ms) {
  return `${(Number(ms || 0) / 1000).toFixed(1)}s`;
}

function emitStage(onStage, stage) {
  if (typeof onStage !== 'function') return;
  try { onStage(stage); } catch (e) { console.warn('[wan-video] 阶段回调失败:', e.message); }
}

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

const { directDispatcher } = require('../gen/net-retry');

async function pollTask(env, taskId, { signal, onStage, submittedAt } = {}) {
  const url = `${env.base}/api/v1/tasks/${encodeURIComponent(taskId)}`;
  const deadline = Date.now() + 15 * 60 * 1000;
  const waitBase = submittedAt || Date.now();
  let consecutiveErrors = 0;
  let lastNetworkErr = null;
  let polls = 0;

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

    let res;
    try {
      res = await fetch(url, {
        headers: { Authorization: `Bearer ${env.key}` },
        signal: signal || AbortSignal.timeout(30000),
      });
      consecutiveErrors = 0;
    } catch (e) {
      lastNetworkErr = e;
      consecutiveErrors++;
      console.warn(`[wan-video] 轮询任务 ${taskId} 网络抖动 (${consecutiveErrors}/5): ${e.message}`);
      if (consecutiveErrors >= 5) {
        throw new Error(`万相轮询网络中断: ${e.message}`);
      }
      continue;
    }

    polls++;
    const json = await res.json().catch(() => ({}));
    if (!res.ok) throw gatewayError(json, res.status, '万相查询失败');
    const output = json.output || {};
    const taskStatus = String(output.task_status || json.status || '').toUpperCase();
    if (taskStatus === 'SUCCEEDED' || taskStatus === 'SUCCESS' || taskStatus === 'COMPLETED') {
      const videoUrl = String(output.video_url || output.results?.video_url || '').trim();
      if (!videoUrl) throw new Error('万相任务完成但未返回 video_url');
      const submitMs = parseWanTaskTime(output.submit_time);
      const scheduledMs = parseWanTaskTime(output.scheduled_time);
      const endMs = parseWanTaskTime(output.end_time);
      return {
        videoUrl,
        polls,
        detectedAt: Date.now(),
        upstream: {
          submit_time: output.submit_time || null,
          scheduled_time: output.scheduled_time || null,
          end_time: output.end_time || null,
          submitMs,
          scheduledMs,
          endMs,
          // 纯云端渲染耗时（百炼官方时间戳），拿不到时为 null，由调用方退回本地计时
          renderMs: submitMs != null && endMs != null ? endMs - submitMs : null,
          queueMs: submitMs != null && scheduledMs != null ? scheduledMs - submitMs : null,
        },
      };
    }
    if (taskStatus === 'FAILED' || taskStatus === 'CANCELED' || taskStatus === 'CANCELLED') {
      const msg = output.message || output.code || json.message || '万相生成失败';
      throw new Error(`万相生成失败: ${msg}`);
    }
    emitStage(onStage, {
      key: 'wan_rendering',
      label: '万相云端渲染中',
      progress: renderingProgress(Date.now() - waitBase),
      detail: { polls, waitedMs: Date.now() - waitBase, taskStatus: taskStatus || 'RUNNING' },
    });
  }
  throw new Error('万相生成超时');
}

async function downloadPublic(url, dest, { signal } = {}) {
  const attempts = 3;
  let lastErr = null;

  for (let i = 1; i <= attempts; i++) {
    if (signal && signal.aborted) throw new Error('任务已取消');
    // 第 1 次直连（国内 OSS 直连更稳定快），第 2 次走原默认，第 3 次直连
    const useDirect = i !== 2;
    try {
      // 若上次残留未下完的半截文件，先清理干净
      if (fs.existsSync(dest)) {
        try { fs.unlinkSync(dest); } catch {}
      }

      const res = await fetch(url, {
        redirect: 'follow',
        ...(useDirect ? { dispatcher: directDispatcher() } : null),
        signal: signal || AbortSignal.timeout(300000), // 5分钟大视频下载保护
      });

      if (!res.ok || !res.body) {
        throw new Error(`万相公网视频下载响应异常（HTTP ${res.status}）`);
      }

      await pipeline(Readable.fromWeb(res.body), fs.createWriteStream(dest));

      if (fs.existsSync(dest) && fs.statSync(dest).size >= 100) {
        return; // 下载成功且大小合法
      }
      throw new Error('万相公网视频下载未落盘或文件过小');
    } catch (e) {
      lastErr = e;
      try { fs.unlinkSync(dest); } catch {}
      console.warn(`[wan-video] 产物下载第 ${i}/${attempts} 次失败 (${useDirect ? '直连' : '代理'}): ${e.message}`);
      if (i < attempts) {
        await new Promise((r) => setTimeout(r, 2000 * i));
      }
    }
  }

  throw new Error(`万相公网视频下载失败（重试 ${attempts} 次）: ${lastErr?.message || '未知传输异常'}`);
}

async function generateWanVideo(services, input = {}, { signal, onStage } = {}) {
  const env = assertWanEnv(services);
  const t0 = Date.now();
  const prompt = String(input.prompt || '').trim();

  emitStage(onStage, { key: 'wan_prepare', label: '准备参考图并上传 OSS', progress: 12 });
  const media = await buildMedia(services, input);
  const prepareMs = Date.now() - t0;
  if (!prompt && !media.length) {
    const err = new Error('请填写提示词，或上传一张参考图');
    err.status = 400;
    throw err;
  }
  const body = buildSubmitBody(input, media);
  let taskId = '';
  try {
    emitStage(onStage, { key: 'wan_submit', label: '提交万相视频任务', progress: 15 });
    const tBeforeSubmit = Date.now();
    taskId = await createTask(env, body, { signal });
    const tAfterSubmit = Date.now();
    const submitMs = tAfterSubmit - tBeforeSubmit;
    console.log(`[wan-video] 任务已提交 taskId=${taskId} 参考图=${media.length} 张 提交用时=${fmtSec(submitMs)}`);

    const polled = await pollTask(env, taskId, { signal, onStage, submittedAt: tAfterSubmit });
    const { videoUrl: remoteUrl, polls, detectedAt, upstream } = polled;
    if (!remoteUrl) throw new Error('万相生成失败：未获取到公网地址');
    if (upstream?.renderMs != null) {
      console.log(`[wan-video] 云端渲染完成 taskId=${taskId} 上游渲染=${fmtSec(upstream.renderMs)}` +
        `（轮询 ${polls} 次，发现延迟=${upstream.endMs != null ? fmtSec(Math.max(0, detectedAt - upstream.endMs)) : '未知'}）`);
    } else {
      console.log(`[wan-video] 轮询确认任务成功 taskId=${taskId} 轮询 ${polls} 次 本地等待=${fmtSec(detectedAt - tAfterSubmit)}`);
    }

    emitStage(onStage, { key: 'wan_download', label: '下载模型原片', progress: 88 });
    const tempDir = path.join(services.config.dataDir, 'cache', 'temp');
    fs.mkdirSync(tempDir, { recursive: true });
    const name = `wan_${String(taskId).replace(/[^\w.-]/g, '').slice(0, 40) || crypto.randomBytes(4).toString('hex')}.mp4`;
    const dest = path.join(tempDir, name);

    const tBeforeDownload = Date.now();
    await downloadPublic(remoteUrl, dest, { signal });
    const downloadMs = Date.now() - tBeforeDownload;
    const sizeMb = fs.existsSync(dest) ? fs.statSync(dest).size / 1048576 : 0;
    console.log(`[wan-video] 原片下载完成 taskId=${taskId} ${sizeMb.toFixed(1)}MB 用时=${fmtSec(downloadMs)}`);

    const previewUrl = `/api/cache/temp/${path.basename(dest)}`;
    return {
      ok: true,
      success: true,
      taskId,
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
      // 阶段计时：renderUpstreamMs 是百炼官方纯渲染耗时；renderLocalMs 含轮询发现延迟，作兜底
      timing: {
        prepareMs,
        submitMs,
        renderLocalMs: detectedAt - tAfterSubmit,
        renderUpstreamMs: upstream?.renderMs ?? null,
        upstreamQueueMs: upstream?.queueMs ?? null,
        pollCount: polls,
        pollDetectMs: upstream?.endMs != null ? Math.max(0, detectedAt - upstream.endMs) : null,
        downloadMs,
        totalMs: Date.now() - t0,
        upstream: {
          submit_time: upstream?.submit_time || null,
          scheduled_time: upstream?.scheduled_time || null,
          end_time: upstream?.end_time || null,
        },
      },
    };
  } catch (err) {
    if (taskId && !err.taskId) err.taskId = taskId;
    throw err;
  }
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
  parseWanTaskTime,
  renderingProgress,
};
