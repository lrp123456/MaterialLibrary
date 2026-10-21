/**
 * 剪辑板块的 TTS 通道（文本转语音）。
 *
 * 复用创作板块已经跑通的 IndexTTS 2.5 客户端（src/gen/indextts-local.js）。
 * 那个文件由创作板块维护，这里不改它：只构造一个最小 adapter 传进去，
 * panelBase() 只读 config_json.apiBase / base_url，别的字段不参与。
 *
 * 参考音频解析顺序：refFid（素材库里的音频）> voiceId（音色库 <dataDir>/voices/<id>/ref.wav）。
 * 音色库布局：
 *   <id>/ref.wav     参考音频，10~15 秒最合适
 *   <id>/meta.json   { name, lang, tags, license, source }
 *
 * 任务走 clip_ai_jobs（type='tts'），由 src/clip-ai.js 的内置引擎分支执行，
 * 前端轮询 /editor-api/ai/jobs/:id，与字幕 / 抠像等任务同一套交互。
 */
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const LANGS = new Set(['ZH', 'EN', 'JA', 'ES', 'AR']);
const DEFAULT_LANG = 'ZH';
const MAX_TEXT_LEN = 5000;
const DEFAULT_TIMEOUT_MS = 10 * 60 * 1000;

function voicesDir(config) {
  return path.join(config.dataDir, 'voices');
}

/** 扫描音色库；目录不存在返回空数组，不报错。 */
function listVoices(config) {
  const dir = voicesDir(config);
  if (!fs.existsSync(dir)) return [];
  const items = [];
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return []; }
  for (const name of names) {
    const root = path.join(dir, name);
    try { if (!fs.statSync(root).isDirectory()) continue; } catch { continue; }
    let meta = {};
    try { meta = JSON.parse(fs.readFileSync(path.join(root, 'meta.json'), 'utf8') || '{}'); } catch { meta = {}; }
    const hasRef = fs.existsSync(path.join(root, 'ref.wav'));
    items.push({
      id: name,
      name: String(meta.name || name),
      lang: String(meta.lang || '').toUpperCase(),
      tags: Array.isArray(meta.tags) ? meta.tags.map(String) : [],
      license: String(meta.license || ''),
      source: String(meta.source || ''),
      hasRef,
    });
  }
  items.sort((a, b) => a.name.localeCompare(b.name, 'zh'));
  return items;
}

/**
 * 找一个可用的 IndexTTS 适配器。仓库里 gen_adapters 由 providers.ensureLocalAudioAdapters 播种，
 * 正常环境一定有；表缺失（如测试库）或未启用时返回 null，让上层给「引擎未配置」。
 */
function pickAdapter(db) {
  try {
    const row = db.prepare(
      "SELECT id, protocol, base_url, config_json FROM gen_adapters " +
      "WHERE (id='indextts_local' OR protocol='indextts_local') AND enabled=1 LIMIT 1",
    ).get();
    if (!row) return null;
    return {
      id: row.id,
      protocol: row.protocol || 'indextts_local',
      base_url: row.base_url || '',
      config_json: row.config_json || '{}',
    };
  } catch {
    return null;
  }
}

function ttsReady(db) {
  return !!pickAdapter(db);
}

function normalizeLang(raw) {
  const s = String(raw || '').trim();
  if (!s) return DEFAULT_LANG;
  const head = s.split(/[-_]/)[0].toUpperCase();
  return LANGS.has(head) ? head : null;
}

// 只允许单层目录名：不允许斜杠，路径穿越就无从谈起。
function validVoiceId(id) {
  return /^[A-Za-z0-9][A-Za-z0-9_.-]*$/.test(id);
}

/** 提交前的参数校验；返回 { error } 或 { params }。 */
function prepareTtsParams(services, body) {
  const text = String(body.text || '').trim();
  if (!text) return { error: { status: 400, message: '缺少要合成的文本 text' } };
  if (text.length > MAX_TEXT_LEN) {
    return { error: { status: 400, message: `text 过长（${text.length} 字，上限 ${MAX_TEXT_LEN} 字），请分段合成` } };
  }

  const lang = normalizeLang(body.lang);
  if (lang == null) {
    return { error: { status: 400, message: `不支持的语言：${body.lang}（可选 ${[...LANGS].join(' / ')}）` } };
  }

  let durationFactor = Number(body.durationFactor);
  if (body.durationFactor != null && !Number.isFinite(durationFactor)) {
    return { error: { status: 400, message: `durationFactor 必须是数字：${body.durationFactor}` } };
  }
  if (!Number.isFinite(durationFactor)) durationFactor = 1;
  durationFactor = Math.max(0.5, Math.min(2, durationFactor));

  const refFid = String(body.refFid || '').trim();
  const voiceId = String(body.voiceId || '').trim();
  if (!refFid && !voiceId) {
    return { error: { status: 400, message: '没有参考音频：请提供 refFid（素材库音频）或 voiceId（音色库）' } };
  }

  if (refFid) {
    let asset = null;
    try { asset = services.db.prepare('SELECT fid FROM assets WHERE fid=?').get(refFid); } catch { asset = null; }
    if (!asset) return { error: { status: 404, message: '参考音频素材不存在' } };
  } else {
    if (!validVoiceId(voiceId)) {
      return { error: { status: 400, message: `voiceId 非法：${voiceId}` } };
    }
    const refPath = path.join(voicesDir(services.config), voiceId, 'ref.wav');
    if (!fs.existsSync(refPath)) {
      return { error: { status: 400, message: `音色 ${voiceId} 缺少 ref.wav（应在 ${refPath}）` } };
    }
  }

  const emoFid = String(body.emoFid || '').trim();
  if (emoFid) {
    let emo = null;
    try { emo = services.db.prepare('SELECT fid FROM assets WHERE fid=?').get(emoFid); } catch { emo = null; }
    if (!emo) return { error: { status: 404, message: '情感参考音频素材不存在' } };
  }

  return {
    params: {
      text,
      lang,
      // refFid 优先；同时给了 voiceId 时忽略后者，避免「以为用了音色库其实用了素材」的歧义。
      refFid: refFid || '',
      voiceId: refFid ? '' : voiceId,
      emoFid,
      durationFactor,
    },
  };
}

/** 读 WAV 头算时长（IndexTTS 产物通常是 wav，够用；解析不了交给 ffprobe）。 */
function wavDurationMs(file) {
  let fd = null;
  try {
    fd = fs.openSync(file, 'r');
    const head = Buffer.alloc(64 * 1024);
    const n = fs.readSync(fd, head, 0, head.length, 0);
    const buf = head.subarray(0, n);
    if (buf.length < 44 || buf.toString('ascii', 0, 4) !== 'RIFF' || buf.toString('ascii', 8, 12) !== 'WAVE') return null;
    let off = 12;
    let byteRate = 0;
    let dataSize = 0;
    while (off + 8 <= buf.length) {
      const id = buf.toString('ascii', off, off + 4);
      const size = buf.readUInt32LE(off + 4);
      if (id === 'fmt ' && off + 8 + 12 <= buf.length) {
        byteRate = buf.readUInt32LE(off + 8 + 8);
      } else if (id === 'data') {
        dataSize = size;
        break;
      }
      off += 8 + size + (size % 2);
    }
    if (!byteRate || !dataSize) return null;
    return Math.round((dataSize / byteRate) * 1000);
  } catch {
    return null;
  } finally {
    if (fd != null) { try { fs.closeSync(fd); } catch { /* 忽略 */ } }
  }
}

function ffprobeDurationMs(file) {
  const bin = process.env.FFPROBE_PATH || 'ffprobe';
  return new Promise((resolve) => {
    execFile(bin, [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      file,
    ], { timeout: 8000, windowsHide: true }, (err, stdout) => {
      if (err) { resolve(null); return; }
      const sec = Number(String(stdout || '').trim());
      resolve(Number.isFinite(sec) && sec > 0 ? Math.round(sec * 1000) : null);
    });
  });
}

async function probeDurationMs(file) {
  const wav = wavDurationMs(file);
  if (wav != null) return wav;
  return ffprobeDurationMs(file);
}

/**
 * 内置引擎入口，签名与 runner 契约一致（src/clip-ai.js 的 BUILTIN_RUNNERS）。
 * params 来自 prepareTtsParams 的返回值。
 */
async function runTtsJob({ services, params, onProgress }) {
  const p = params || {};
  const text = String(p.text || '').trim();
  if (!text) throw new Error('缺少要合成的文本 text');

  const adapter = pickAdapter(services.db);
  if (!adapter) {
    throw new Error('引擎未配置：gen_adapters 里没有启用的 IndexTTS 适配器（id=indextts_local）。请先在创作板块配置引擎地址后重试。');
  }

  let refInput = String(p.refFid || '').trim();
  if (!refInput) {
    const voiceId = String(p.voiceId || '').trim();
    if (!voiceId) throw new Error('没有参考音频：refFid 与 voiceId 都为空');
    const refPath = path.join(voicesDir(services.config), voiceId, 'ref.wav');
    if (!fs.existsSync(refPath)) throw new Error(`音色 ${voiceId} 缺少 ref.wav（应在 ${refPath}）`);
    refInput = refPath;
  }

  const audioLocalPaths = [refInput];
  if (p.emoFid) audioLocalPaths.push(String(p.emoFid));

  // 懒加载：测试可整体替换这个模块，且避免创作板块的依赖在启动时就拉起来。
  const { runVoiceJob } = require('./gen/indextts-local');

  onProgress?.(20, '提交合成任务');
  const out = await runVoiceJob(services, adapter, {
    prompt: text,
    extras: {
      text,
      lang: p.lang || DEFAULT_LANG,
      duration_factor: p.durationFactor,
    },
    audioLocalPaths,
    timeoutMs: DEFAULT_TIMEOUT_MS,
  });
  if (!out || out.ok !== true || !Array.isArray(out.files) || !out.files.length) {
    throw new Error((out && out.error) || 'IndexTTS 没有返回产物');
  }

  const f = out.files[0];
  onProgress?.(90, '写入产物');
  const durationMs = await probeDurationMs(f.localPath);
  return {
    // 由 clip-ai 复制到 <job>/output/，前端也可直接播 previewUrl
    outputPath: f.localPath,
    result: { ok: true, url: f.previewUrl, localPath: f.localPath, durationMs },
  };
}

module.exports = {
  listVoices,
  voicesDir,
  pickAdapter,
  ttsReady,
  prepareTtsParams,
  runTtsJob,
  probeDurationMs,
};
