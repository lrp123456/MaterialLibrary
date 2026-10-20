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
  let submitted;
  try {
    const res = await lanFetch(`${base}/api/music/release_task`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(120000),
    });
    const txt = await res.text();
    if (!res.ok) return { ok: false, success: false, error: `ACE-Step 提交失败 HTTP ${res.status}: ${txt.slice(0, 300)}`, files: [] };
    submitted = txt ? JSON.parse(txt) : {};
  } catch (e) {
    const unreachable = e?.name === 'AbortError' || /fetch failed|ECONNREFUSED|ENOTFOUND/i.test(String(e.message || ''));
    return { ok: false, success: false, error: unreachable ? '连不上本机 ACE-Step' : `ACE-Step 提交失败: ${e.message}`, files: [] };
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
    const msg = (item && (item.error || item.message)) || '未在超时内完成';
    return { ok: false, success: false, error: `ACE-Step ${item ? aceStatus(item) : 'timeout'}: ${msg}`, files: [] };
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
