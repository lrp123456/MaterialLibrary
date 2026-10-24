/**
 * ACE-Step 1.5，挂在 http://192.168.1.107:9000/api/music/ 。
 * POST /api/music/release_task ，再 POST /api/music/query_result。
 * task_id_list 按网关文档传 JSON 字符串。歌词留空就是纯音乐。
 * 这里默认 batch_size=1。网关不传时是 2，一次会出两首。
 */
const fs = require('fs');
const path = require('path');
const { lanFetch } = require('./lan-fetch');

function panelBase(adapter) {
  const cfg = typeof adapter.config_json === 'string'
    ? JSON.parse(adapter.config_json || '{}') : (adapter.config_json || {});
  return String(cfg.apiBase || adapter.base_url || 'http://192.168.1.107:9000').replace(/\/$/, '');
}

// ACE-Step 常驻显存 4~5GB，和本地生图（ncnn 峰值近 10GB）在同一张 16GB 卡上，
// 生图高峰并发时必然 OOM。原始报错是一整页 PyTorch 堆栈，必须收成一句能指导操作的话。
function isOom(text) {
  return /CUDA out of memory|OutOfMemoryError|HIP out of memory/i.test(String(text || ''));
}
function describeMusicFailure(e) {
  const msg = String(e?.message || e || '');
  if (isOom(msg)) return 'GPU 显存不足：本地生图任务占满了显存，请等生图队列清空后重试';
  if (e?.name === 'TimeoutError' || /aborted due to timeout/i.test(msg)) {
    return 'ACE-Step 响应超时（可能正在加载模型或排队），请稍后重试';
  }
  if (/fetch failed|ECONNREFUSED|ENOTFOUND|EAI_AGAIN/i.test(msg)) return '连不上本机 ACE-Step';
  return `ACE-Step 提交失败: ${msg}`;
}
function taskErrorText(item) {
  if (!item) return '';
  if (item.error) return String(item.error);
  if (item.message) return String(item.message);
  if (typeof item.result === 'string' && item.result.trim().startsWith('[')) {
    try {
      const arr = JSON.parse(item.result);
      const first = Array.isArray(arr) ? arr[0] : null;
      if (first?.error) return String(first.error);
    } catch (_) {}
  }
  return '';
}
async function loadState(base) {
  try {
    const res = await lanFetch(`${base}/api/music/health`, { signal: AbortSignal.timeout(5000) });
    if (!res.ok) return { reachable: true, state: null };
    const body = await res.json().catch(() => null);
    return { reachable: true, state: body?.data || body || null };
  } catch (e) {
    const timeout = e?.name === 'TimeoutError' || /aborted due to timeout/i.test(String(e?.message || ''));
    return { reachable: false, state: null, timeout };
  }
}

function splitPrompt(text, mode) {
  const raw = String(text || '').trim();
  const marked = raw.match(/【歌词】\s*([\s\S]*)$/);
  if (marked) {
    const lyrics = marked[1].trim();
    const style = raw.slice(0, marked.index).replace(/【风格】/g, '').trim();
    return { prompt: style || lyrics.slice(0, 120), lyrics };
  }
  if (mode === 'text_to_song') return { prompt: raw.slice(0, 200), lyrics: raw };
  return { prompt: raw, lyrics: '' };
}

function taskIdOf(body) {
  if (!body || typeof body !== 'object') return '';
  return body.task_id
    || body.taskId
    || body.data?.task_id
    || body.data?.taskId
    || (Array.isArray(body.data) && (body.data[0]?.task_id || body.data[0]?.taskId))
    || '';
}

function aceStatus(item) {
  const st = item && item.status;
  if (st === 1 || st === '1' || st === 'succeeded' || st === 'success' || st === 'completed') return 'done';
  if (st === 2 || st === '2' || st === 'failed' || st === 'error') return 'failed';
  return 'running';
}

function audioRefsFrom(item) {
  const refs = [];
  const push = (v) => {
    if (v && typeof v === 'string' && !refs.includes(v)) refs.push(v);
  };
  const take = (raw) => {
    if (!raw) return;
    if (typeof raw === 'string') {
      const trimmed = raw.trim();
      if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
        try { take(JSON.parse(trimmed)); return; } catch (_) {}
      }
      push(trimmed);
      return;
    }
    if (Array.isArray(raw)) {
      raw.forEach((x) => take(x && x.file ? x.file : x));
      return;
    }
    if (typeof raw === 'object') {
      (raw.audio_paths || []).forEach(push);
      push(raw.first_audio_path);
      push(raw.second_audio_path);
      push(raw.file);
    }
  };
  take(item && item.result);
  return refs;
}

function audioFetchUrl(base, ref) {
  const s = String(ref || '');
  if (/^https?:\/\//i.test(s)) return s;
  if (s.startsWith('/api/music/')) return `${base}${s}`;
  if (s.startsWith('/v1/audio')) return `${base}/api/music${s}`;
  return `${base}/api/music/v1/audio?path=${encodeURIComponent(s)}`;
}

async function runMusicJob(services, adapter, input) {
  const { config, logger } = services;
  const base = panelBase(adapter);
  const extras = input.extras || {};
  const mode = String(input.genMode || extras.mode || extras.genMode || 'text_to_bgm');
  const parts = splitPrompt(input.prompt || extras.prompt || '', mode);
  if (!parts.prompt) return { ok: false, success: false, error: 'ACE-Step 需要风格提示词', files: [] };

  const body = { prompt: parts.prompt, batch_size: 1 };
  if (parts.lyrics) body.lyrics = parts.lyrics;
  const duration = Number(extras.audio_duration || extras.duration || input.durationSec);
  if (Number.isFinite(duration) && duration > 0) body.audio_duration = duration;
  const steps = Number(extras.inference_steps);
  if (Number.isFinite(steps) && steps > 0) body.inference_steps = steps;
  const seed = extras.seed != null ? Number(extras.seed) : (input.seed != null ? Number(input.seed) : null);
  if (Number.isFinite(seed) && seed >= 0) body.seed = seed;
  const batch = Number(extras.batch_size);
  if (Number.isFinite(batch)) body.batch_size = Math.max(1, Math.min(4, Math.round(batch)));

  const timeoutMs = Number(input.timeoutMs || 600000);
  const health = await loadState(base);
  if (!health.reachable) {
    // 面板按需挂载：服务被闲置回收后 /api/music/health 必然连不上，
    // 不能据此拒绝——直接提交，面板会在排队放行时把服务拉起来。
    logger?.info?.('[acestep] 健康检查不可达，仍提交（面板会按需拉起并排队）');
  }
  // models_initialized=false 只表示当前空闲未驻留；首次 release_task 才会加载模型（面板提示 1~3 分钟）。
  // 因此不能据此拒绝请求，只能放宽提交超时，避免把"冷启动"误判成"不可用"。
  const coldStart = !health.reachable || health.state?.models_initialized === false;
  if (coldStart) logger?.info?.('[acestep] 模型未驻留，提交后将冷启动加载（预计 1~3 分钟）');
  let submitted;
  try {
    const res = await lanFetch(`${base}/api/music/release_task`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      // 面板统一排队：提交可能等待前面的任务跑完，给足 30 分钟
      signal: AbortSignal.timeout(30 * 60 * 1000),
    });
    const txt = await res.text();
    if (!res.ok) return { ok: false, success: false, error: `ACE-Step 提交失败 HTTP ${res.status}: ${txt.slice(0, 300)}`, files: [] };
    submitted = txt ? JSON.parse(txt) : {};
  } catch (e) {
    return { ok: false, success: false, error: describeMusicFailure(e), files: [] };
  }
  if (submitted.code && Number(submitted.code) !== 200 && !taskIdOf(submitted)) {
    return { ok: false, success: false, error: submitted.error || `ACE-Step 提交失败: ${JSON.stringify(submitted).slice(0, 200)}`, files: [] };
  }
  const taskId = taskIdOf(submitted);
  if (!taskId) return { ok: false, success: false, error: `ACE-Step 未返回 task_id: ${JSON.stringify(submitted).slice(0, 200)}`, files: [] };
  logger?.info?.(`[acestep] 任务已提交 ${taskId}`);

  const start = Date.now();
  let item = null;
  while (Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 3000));
    try {
      const res = await lanFetch(`${base}/api/music/query_result`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ task_id_list: JSON.stringify([taskId]) }),
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) continue;
      const queried = await res.json();
      const list = Array.isArray(queried.data) ? queried.data : (Array.isArray(queried) ? queried : []);
      item = list.find((row) => String(row.task_id || row.taskId || '') === String(taskId)) || list[0] || null;
    } catch (e) {
      logger?.warn?.(`[acestep] 轮询异常: ${e.message}`);
      continue;
    }
    const st = aceStatus(item);
    if (st === 'done' || st === 'failed') break;
  }
  if (!item || aceStatus(item) !== 'done') {
    const detail = taskErrorText(item);
    if (isOom(detail)) {
      return { ok: false, success: false, error: 'GPU 显存不足：本地生图任务占满了显存，请等生图队列清空后重试', files: [] };
    }
    const msg = detail || '未在超时内完成';
    return { ok: false, success: false, error: `ACE-Step ${item ? aceStatus(item) : 'timeout'}: ${msg.slice(0, 300)}`, files: [] };
  }

  const destDir = path.join(config.dataDir, 'cache', 'temp');
  fs.mkdirSync(destDir, { recursive: true });
  const files = [];
  for (const ref of audioRefsFrom(item)) {
    const url = audioFetchUrl(base, ref);
    const res = await lanFetch(url, { signal: AbortSignal.timeout(120000) });
    if (!res.ok) {
      logger?.warn?.(`[acestep] 产物下载失败 ${url}: HTTP ${res.status}`);
      continue;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const ext = /\.wav(\?|$)/i.test(ref) ? '.wav' : (/\.flac(\?|$)/i.test(ref) ? '.flac' : '.mp3');
    const out = path.join(destDir, `ace_${taskId}_${files.length}${ext}`);
    fs.writeFileSync(out, buf);
    const mime = ext === '.wav' ? 'audio/wav' : (ext === '.flac' ? 'audio/flac' : 'audio/mpeg');
    files.push({ localPath: out, previewUrl: `/api/cache/temp/${path.basename(out)}`, mime });
  }
  if (!files.length) return { ok: false, success: false, error: 'ACE-Step 完成但无产物', files: [] };
  return { ok: true, success: true, files, taskId, elapsedMs: Date.now() - start };
}

module.exports = { runMusicJob, splitPrompt, audioFetchUrl, audioRefsFrom, aceStatus, taskIdOf };
