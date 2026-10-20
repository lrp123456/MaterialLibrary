/**
 * 豆包音乐：后付费 GenSongForTime / GenBGMForTime，模型 v5.0。
 * 成功后立刻转存进音乐库，响应里不留火山临时地址。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { volcOpenApi, resolveVolcCredentials, credentialsReady } = require('./volc-openapi');
const { createDerivative, setMainDerivative } = require('./derivatives');

const HOST = 'open.volcengineapi.com';
const SERVICE = 'imagination';
const VERSION = '2024-08-12';
const PRODUCT = '素材库';

const LANGS = {
  chinese: 'Chinese',
  english: 'English',
  cantonese: 'Cantonese',
  普通话: 'Chinese',
  英文: 'English',
  粤语: 'Cantonese',
};

function musicError(message, code) {
  const e = new Error(message);
  e.code = code || 'music_invalid';
  return e;
}

function clampInt(value, min, max, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n) || n === 0) return fallback;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function normalizeLang(lang) {
  const key = String(lang || 'Chinese').trim();
  const hit = LANGS[key] || LANGS[key.toLowerCase()];
  if (!hit) throw musicError('语言仅支持 Chinese / English / Cantonese');
  return hit;
}

function implicitWatermark(jobId) {
  const id = String(jobId || 'job');
  return {
    ContentProducer: PRODUCT,
    ProduceId: id,
    ContentPropagator: PRODUCT,
    PropagateId: id,
    Enable: true,
  };
}

function buildSongBody(input) {
  const src = input || {};
  const lyrics = String(src.lyrics || '').trim();
  const prompt = String(src.prompt || '').trim();
  if (!lyrics && !prompt) throw musicError('歌曲需要提示词或歌词');
  if (lyrics && lyrics.length < 5) throw musicError('歌词至少 5 个字符');
  if (!lyrics && prompt.length < 5) throw musicError('提示词至少 5 个字符');
  const body = {
    ModelVersion: 'v5.0',
    Duration: clampInt(src.duration, 30, 240, 60),
    Lang: normalizeLang(src.lang),
    VodFormat: 'mp3',
    SkipCopyCheck: false,
    AigcWatermark: false,
    ImplicitWaterMark: implicitWatermark(src.jobId),
  };
  if (lyrics) body.Lyrics = lyrics;
  else body.Prompt = prompt;
  return body;
}

function buildBgmBody(input) {
  const src = input || {};
  const text = String(src.text || src.prompt || '').trim();
  if (!/[\u4e00-\u9fff]/.test(text)) throw musicError('纯音乐描述需要中文');
  return {
    Text: text,
    Duration: clampInt(src.duration, 30, 120, 60),
    Version: 'v5.0',
    EnableInputRewrite: false,
    AigcWatermark: false,
    ImplicitWaterMark: implicitWatermark(src.jobId),
  };
}

function interpretQuery(result) {
  const row = result || {};
  const detail = row.SongDetail || {};
  const fail = row.FailureReason || {};
  return {
    status: Number(row.Status),
    taskId: row.TaskID || '',
    audioUrl: detail.AudioUrl || '',
    failure: fail.Msg || fail.Code || '',
    duration: detail.Duration,
  };
}

function stripVendorPayload(value) {
  if (Array.isArray(value)) return value.map(stripVendorPayload);
  if (!value || typeof value !== 'object') {
    if (typeof value === 'string' && /douyinvod\.com/i.test(value)) return '';
    return value;
  }
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (/audio.?url/i.test(k)) continue;
    const next = stripVendorPayload(v);
    if (typeof next === 'string' && /douyinvod\.com/i.test(next)) continue;
    out[k] = next;
  }
  return out;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function callMusic(services, action, body, fetchImpl) {
  const cfg = resolveVolcCredentials(services, 'doubao_music');
  return volcOpenApi(cfg, {
    host: HOST,
    service: SERVICE,
    region: 'cn-beijing',
    action,
    version: VERSION,
    method: 'POST',
    body,
    fetchImpl,
    timeoutMs: 60000,
  });
}

async function downloadToFile(url, dest, fetchImpl) {
  const doFetch = fetchImpl || fetch;
  const res = await doFetch(url, { signal: AbortSignal.timeout(120000) });
  if (!res.ok) throw musicError(`音频下载失败 HTTP ${res.status}`, 'music_download');
  const ab = await res.arrayBuffer();
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.writeFileSync(dest, Buffer.from(ab));
  return dest;
}

async function rehostAudio(services, { filePath, jobId, durationS, title }) {
  const { db } = services;
  const now = Date.now();
  const sha = crypto.createHash('sha256').update(fs.readFileSync(filePath)).digest('hex');
  const fid = `music_${sha.slice(0, 24)}`;
  const fileName = `${title || '豆包音乐'}.mp3`;
  const size = fs.statSync(filePath).size;
  const existing = db.prepare('SELECT fid FROM assets WHERE fid=?').get(fid);
  if (!existing) {
    db.prepare(`
      INSERT INTO assets (
        fid, kind, file_name, size, duration_s, status,
        category, source, sha256, created_at, discovered_at, updated_at
      ) VALUES (?, 'audio', ?, ?, ?, 'ready', 'music', 'doubao_music', ?, ?, ?, ?)
    `).run(fid, fileName, size, durationS || null, sha, now, now, now);
  } else {
    db.prepare(`
      UPDATE assets
      SET kind='audio', status='ready', category='music', updated_at=?
      WHERE fid=?
    `).run(now, fid);
  }
  const deriv = await createDerivative(services, {
    assetFid: fid,
    kind: 'origin',
    srcPath: filePath,
    fileName,
    mime: 'audio/mpeg',
    durationS: durationS || null,
    params: { jobId, source: 'doubao_music' },
  });
  setMainDerivative(services, fid, deriv.id);
  return {
    fid,
    mime: 'audio/mpeg',
    previewUrl: `/api/assets/${fid}/image?raw=1&play=1`,
  };
}

/**
 * 提交并轮询，转存后返回给客户端的结果。audioUrl 不会出现在返回值里。
 */
async function runMusicJob(services, {
  kind,
  params,
  jobId,
  fetchImpl,
  pollIntervalMs = 3000,
  maxWaitMs = 10 * 60 * 1000,
  onProgress,
} = {}) {
  const cfg = resolveVolcCredentials(services, 'doubao_music');
  if (!credentialsReady(cfg)) throw musicError('未配置火山 AK/SK', 'volc_unconfigured');
  const p = params || {};
  const song = kind === 'song';
  const body = song
    ? buildSongBody({
      lyrics: p.songInputKind === 'lyrics' ? (p.lyrics || p.prompt || '') : (p.lyrics || ''),
      prompt: p.songInputKind === 'lyrics' ? '' : (p.prompt || ''),
      lang: p.lang,
      duration: p.duration,
      jobId,
    })
    : buildBgmBody({ prompt: p.prompt || p.text, duration: p.duration, jobId });
  const action = song ? 'GenSongForTime' : 'GenBGMForTime';
  const created = await callMusic(services, action, body, fetchImpl);
  const taskId = created && (created.TaskID || created.taskId);
  if (!taskId) throw musicError('豆包音乐未返回任务 ID', 'music_failed');

  const started = Date.now();
  let last = null;
  while (Date.now() - started < maxWaitMs) {
    if (onProgress) onProgress(Math.min(90, 20 + Math.floor((Date.now() - started) / 4000)));
    const queried = await callMusic(services, 'QuerySong', { TaskID: taskId }, fetchImpl);
    last = interpretQuery(queried);
    if (last.status === 2 && last.audioUrl) break;
    if (last.status === 3) {
      throw musicError(last.failure || '豆包音乐生成失败', 'music_failed');
    }
    await sleep(pollIntervalMs);
  }
  if (!last || last.status !== 2 || !last.audioUrl) {
    throw musicError('豆包音乐在等待时间内没有完成', 'music_timeout');
  }
  const tempDir = path.join(services.config.dataDir, 'cache', 'temp');
  const tempFile = path.join(tempDir, `${jobId}.mp3`);
  await downloadToFile(last.audioUrl, tempFile, fetchImpl);
  const file = await rehostAudio(services, {
    filePath: tempFile,
    jobId,
    durationS: last.duration || body.Duration,
    title: song ? '豆包歌曲' : '豆包纯音乐',
  });
  try { fs.unlinkSync(tempFile); } catch { /* 临时文件清掉即可 */ }
  const result = {
    status: 'done',
    kind: 'audio',
    progress: 100,
    files: [file],
    taskId,
  };
  const packed = JSON.stringify(result);
  if (/douyinvod|AudioUrl/i.test(packed)) {
    throw musicError('转存结果仍包含火山音频地址', 'music_leak');
  }
  return stripVendorPayload(result);
}

function musicKindFrom(entryId, params) {
  const p = params || {};
  const mode = String(p.mode || '');
  const model = String(p.model || '');
  if (entryId === 'music.song' || mode === 'text_to_song' || /song/i.test(model)) return 'song';
  return 'bgm';
}

module.exports = {
  HOST,
  buildSongBody,
  buildBgmBody,
  interpretQuery,
  stripVendorPayload,
  runMusicJob,
  musicKindFrom,
  rehostAudio,
};
