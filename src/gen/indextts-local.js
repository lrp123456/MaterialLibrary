/**
 * IndexTTS 2.5，挂在 http://192.168.1.107:9000/api/voice/ 。
 * POST /api/voice/tts 必须带 ref_audio 和 text。产物从 /api/voice/file/{name} 取。
 */
const fs = require('fs');
const path = require('path');
const { lanFetch } = require('./lan-fetch');

const LANGS = new Set(['ZH', 'EN', 'JA', 'ES', 'AR']);

function panelBase(adapter) {
  const cfg = typeof adapter.config_json === 'string'
    ? JSON.parse(adapter.config_json || '{}') : (adapter.config_json || {});
  return String(cfg.apiBase || adapter.base_url || 'http://192.168.1.107:9000').replace(/\/$/, '');
}

function audioName(raw) {
  const s = String(raw || '');
  const file = s.match(/\/api\/voice\/file\/([^/?#]+)/);
  if (file) return decodeURIComponent(file[1]);
  if (s && !s.includes('://') && !s.startsWith('/')) return s;
  return path.basename(s.split('?')[0]);
}

function taskStatus(task) {
  const st = task && (task.status != null ? task.status : (task.data && task.data.status));
  if (st === 1 || st === '1' || st === 'completed' || st === 'succeeded' || st === 'success' || st === 'done') return 'done';
  if (st === 2 || st === '2' || st === 'failed' || st === 'error' || st === 'cancelled') return 'failed';
  return 'running';
}

function outputNames(task) {
  const bag = task && task.data && !Array.isArray(task.data) ? { ...task, ...task.data } : (task || {});
  const names = [];
  const push = (v) => {
    const name = audioName(v);
    if (name && !names.includes(name)) names.push(name);
  };
  if (Array.isArray(bag.outputs)) bag.outputs.forEach(push);
  push(bag.output);
  push(bag.file);
  push(bag.audio);
  push(bag.wav);
  if (typeof bag.result === 'string' && !bag.result.trim().startsWith('[')) push(bag.result);
  return names;
}

async function readAudio(services, raw) {
  const { resolveAssetBuffer } = require('../ai-tasks');
  const buf = await resolveAssetBuffer(services, raw);
  return buf && buf.length ? buf : null;
}

function audioExt(raw) {
  const ext = path.extname(String(raw || '')).toLowerCase();
  if (['.wav', '.mp3', '.m4a', '.flac', '.ogg', '.aac'].includes(ext)) return ext;
  return '.wav';
}

async function runVoiceJob(services, adapter, input) {
  const { config, logger } = services;
  const base = panelBase(adapter);
  const extras = input.extras || {};
  const text = String(input.prompt || extras.text || '').trim();
  if (!text) return { ok: false, success: false, error: 'IndexTTS 需要要合成的文本', files: [] };

  const rawAudios = []
    .concat(input.audioLocalPaths || [])
    .concat(input.audioUrls || [])
    .concat(extras.audioUrls || [])
    .filter(Boolean);
  if (!rawAudios.length) {
    return { ok: false, success: false, error: 'IndexTTS 需要一段参考音频', files: [] };
  }

  const ref = await readAudio(services, rawAudios[0]);
  if (!ref) return { ok: false, success: false, error: '参考音频没有读到本地文件', files: [] };
  const emo = rawAudios[1] ? await readAudio(services, rawAudios[1]) : null;

  const lang = LANGS.has(String(extras.lang || '').toUpperCase()) ? String(extras.lang).toUpperCase() : 'ZH';
  let factor = Number(extras.duration_factor);
  if (!Number.isFinite(factor)) factor = 1;
  factor = Math.max(0.5, Math.min(2, factor));

  const form = new FormData();
  form.append('ref_audio', new Blob([ref]), `ref${audioExt(rawAudios[0])}`);
  form.append('text', text);
  form.append('lang', lang);
  form.append('duration_factor', String(factor));
  if (emo) {
    form.append('emo_audio', new Blob([emo]), `emo${audioExt(rawAudios[1])}`);
    const alpha = Number(extras.emo_alpha);
    if (Number.isFinite(alpha)) form.append('emo_alpha', String(Math.max(0, Math.min(1, alpha))));
  }

  const timeoutMs = Number(input.timeoutMs || 600000);
  let submitted;
  try {
    const res = await lanFetch(`${base}/api/voice/tts`, {
      method: 'POST',
      body: form,
      signal: AbortSignal.timeout(120000),
    });
    const txt = await res.text();
    if (!res.ok) return { ok: false, success: false, error: `IndexTTS 提交失败 HTTP ${res.status}: ${txt.slice(0, 300)}`, files: [] };
    submitted = txt ? JSON.parse(txt) : {};
  } catch (e) {
    const unreachable = e?.name === 'AbortError' || /fetch failed|ECONNREFUSED|ENOTFOUND/i.test(String(e.message || ''));
    return { ok: false, success: false, error: unreachable ? '连不上本机 IndexTTS' : `IndexTTS 提交失败: ${e.message}`, files: [] };
  }

  const taskId = submitted.task_id || submitted.id || submitted.data?.task_id;
  if (!taskId) return { ok: false, success: false, error: `IndexTTS 未返回 task_id: ${JSON.stringify(submitted).slice(0, 200)}`, files: [] };
  logger?.info?.(`[indextts] 任务已提交 ${taskId}`);

  const start = Date.now();
  let task = null;
  while (Date.now() - start < timeoutMs) {
    await new Promise((r) => setTimeout(r, 2000));
    try {
      const res = await lanFetch(`${base}/api/voice/tasks/${encodeURIComponent(taskId)}`, {
        signal: AbortSignal.timeout(30000),
      });
      if (!res.ok) continue;
      task = await res.json();
    } catch (e) {
      logger?.warn?.(`[indextts] 轮询异常: ${e.message}`);
      continue;
    }
    const st = taskStatus(task);
    if (st === 'done' || st === 'failed') break;
  }
  if (!task || taskStatus(task) !== 'done') {
    const msg = (task && (task.message || task.error)) || '未在超时内完成';
    return { ok: false, success: false, error: `IndexTTS ${task ? taskStatus(task) : 'timeout'}: ${msg}`, files: [] };
  }

  const destDir = path.join(config.dataDir, 'cache', 'temp');
  fs.mkdirSync(destDir, { recursive: true });
  const files = [];
  for (const name of outputNames(task)) {
    const res = await lanFetch(`${base}/api/voice/file/${encodeURIComponent(name)}`, {
      signal: AbortSignal.timeout(120000),
    });
    if (!res.ok) {
      logger?.warn?.(`[indextts] 产物下载失败 ${name}: HTTP ${res.status}`);
      continue;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const ext = audioExt(name);
    const out = path.join(destDir, `tts_${taskId}_${files.length}${ext}`);
    fs.writeFileSync(out, buf);
    const mime = ext === '.mp3' ? 'audio/mpeg' : 'audio/wav';
    files.push({ localPath: out, previewUrl: `/api/cache/temp/${path.basename(out)}`, mime });
  }
  if (!files.length) return { ok: false, success: false, error: 'IndexTTS 完成但无产物', files: [] };
  return { ok: true, success: true, files, taskId, elapsedMs: Date.now() - start };
}

module.exports = { runVoiceJob, taskStatus, outputNames };
