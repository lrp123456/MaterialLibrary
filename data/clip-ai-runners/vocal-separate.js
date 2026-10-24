/**
 * 人声分离 runner —— 走 GPU 机上的分离服务（不再是 WSL 里的 CPU Demucs）。
 *
 * 契约见 src/clip-ai.js 顶部：入参 { inputPath, params, workDir, outputDir, job, onProgress }，
 * 出参 { result?, outputPath? }。worker 会把 outputPath 复制到 <job>/output/。
 *
 * 上游服务：http://192.168.1.107:9000/api/sep/（wbpanel 别名 → :8006 sepvoice.service）
 *   POST   /separate        multipart 提交，返回 task_id
 *   GET    /tasks/{id}      status/progress/stage/files
 *   DELETE /tasks/{id}      取消（真的 kill 推理子进程组）
 *   GET    /file/{name}     下载产物
 *   GET    /system          探活
 *
 * params：
 *   engine        'uvr' | 'demucs'（默认 uvr；model 传 htdemucs* 时自动切 demucs）
 *   model         服务白名单里的模型文件名，默认 BS-RoFormer 12.97
 *   start/duration  按秒裁剪，只分离时间轴上选中的片段（0/缺省＝整条素材）
 *   normalize     是否峰值归一化，默认 true
 *   outputFormat  WAV | FLAC | MP3，默认 WAV
 *   opts          透传给 audio-separator 的高级参数（chunk_length、crossfade_overlap…）
 *
 * 用 CLIP_GPU_PANEL_BASE 覆盖服务地址。
 */
const fs = require('fs');
const path = require('path');

const BASE = String(process.env.CLIP_GPU_PANEL_BASE || 'http://192.168.1.107:9000').replace(/\/$/, '');
const API = `${BASE}/api/sep`;
const TIMEOUT_MS = Number(process.env.CLIP_VOCAL_SEPARATE_TIMEOUT_MS || 25 * 60 * 1000);
const DEFAULT_MODEL = 'model_bs_roformer_ep_317_sdr_12.9755.ckpt';

/**
 * 局域网直连，绕开 Clash。runner 会被同步到数据目录，
 * 不能靠仓库内的相对路径 require，所以这里自带一份。
 */
function lanFetch(url, opts = {}) {
  try {
    const host = new URL(url).hostname;
    const local = /^192\.168\.|^10\.|^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
      || host === 'localhost' || host === '127.0.0.1';
    if (local) return fetch(url, { ...opts, dispatcher: new (require('undici').Agent)() });
  } catch (_) { /* undici 不可用就退回全局 fetch */ }
  return fetch(url, opts);
}

function tail(s, n = 400) {
  const t = String(s || '').trim();
  return t.length > n ? `…${t.slice(-n)}` : t;
}

const ROLE_NAMES = {
  vocals: 'vocals.wav',
  no_vocals: 'no_vocals.wav',
  backing_vocals: 'backing_vocals.wav',
  drums: 'drums.wav',
  bass: 'bass.wav',
  other: 'other.wav',
};

/** 读 16bit PCM wav 算 RMS 电平（dBFS）：用来告诉用户"这条轨里到底还有没有东西"。 */
function measureWavDb(file) {
  let b = null;
  try { b = fs.readFileSync(file); } catch { return null; }
  if (b.length < 44 || b.toString('ascii', 0, 4) !== 'RIFF') return null;
  let off = 12, fmt = null, dataOff = null, dataLen = 0;
  while (off + 8 <= b.length) {
    const id = b.toString('ascii', off, off + 4);
    const len = b.readUInt32LE(off + 4);
    if (id === 'fmt ') fmt = { ch: b.readUInt16LE(off + 10), bits: b.readUInt16LE(off + 22) };
    else if (id === 'data') { dataOff = off + 8; dataLen = len; }
    off += 8 + len + (len % 2);
  }
  if (!fmt || fmt.bits !== 16 || dataOff === null) return null;
  const n = Math.floor(Math.min(dataLen, b.length - dataOff) / 2);
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const v = b.readInt16LE(dataOff + i * 2) / 32768;
    sum += v * v;
  }
  if (n === 0) return null;
  return 20 * Math.log10(Math.sqrt(sum / n) + 1e-9);
}

async function submit({ inputPath, params }) {
  const requested = String(params.model || DEFAULT_MODEL);
  const engine = String(params.engine || (requested.startsWith('htdemucs') ? 'demucs' : 'uvr')).toLowerCase();
  const buffer = fs.readFileSync(inputPath);
  const form = new FormData();
  form.append('audio', new Blob([new Uint8Array(buffer)]), path.basename(inputPath));
  form.append('engine', engine);
  form.append('model', requested);
  form.append('stems', String(Number(params.stems) === 4 ? 4 : 2));
  form.append('start', String(Math.max(0, Number(params.start) || 0)));
  form.append('duration', String(Math.max(0, Number(params.duration) || 0)));
  form.append('normalize', String(params.normalize === undefined ? true : !!params.normalize));
  form.append('output_format', String(params.outputFormat || 'WAV'));
  form.append('opts', JSON.stringify(params.opts && typeof params.opts === 'object' ? params.opts : {}));

  const res = await lanFetch(`${API}/separate`, {
    method: 'POST', body: form,
    // 面板统一排队：提交要等前面的任务跑完，给足 30 分钟
    headers: { 'X-GPU-Priority': 'high' },
    signal: AbortSignal.timeout(30 * 60 * 1000),
  });
  const text = await res.text();
  if (!res.ok) {
    let parsed = null;
    try { parsed = JSON.parse(text); } catch { /* 代理挂了会返回 HTML */ }
    throw new Error(
      `分离服务拒绝任务 (HTTP ${res.status})：${tail(parsed?.error || text, 300)}`,
    );
  }
  const json = text ? JSON.parse(text) : {};
  if (!json.task_id) throw new Error(`分离服务没返回 task_id：${tail(text, 200)}`);
  return { taskId: json.task_id, engine, model: json.model || requested };
}

async function poll(taskId, { onProgress, isCanceled }) {
  const deadline = Date.now() + TIMEOUT_MS;
  let last = -1;
  for (;;) {
    if (isCanceled?.()) {
      await lanFetch(`${API}/tasks/${encodeURIComponent(taskId)}`, {
        method: 'DELETE', signal: AbortSignal.timeout(10000),
      }).catch(() => {});
      throw Object.assign(new Error('已取消'), { canceled: true });
    }
    if (Date.now() > deadline) throw new Error(`人声分离超时（${Math.round(TIMEOUT_MS / 60000)} 分钟）`);
    await new Promise((r) => setTimeout(r, 1500));
    let task = null;
    try {
      const res = await lanFetch(`${API}/tasks/${encodeURIComponent(taskId)}`, {
        signal: AbortSignal.timeout(30000),
      });
      if (res.ok) task = await res.json();
    } catch { continue; }
    if (!task) continue;
    const pct = Math.max(0, Math.min(100, Number(task.progress) || 0));
    if (pct !== last) {
      last = pct;
      // 服务侧 0–88 是真实推理进度，映射到 runner 的 20–88，别冲掉 worker 的前置阶段。
      onProgress?.(20 + Math.round(pct * 0.68), task.stage || '分离中');
    }
    if (task.status === 'success') return task;
    if (task.status === 'failed' || task.status === 'cancelled') {
      throw new Error(`人声分离${task.status === 'cancelled' ? '已取消' : '失败'}：${tail(task.error || '无错误信息', 300)}`);
    }
  }
}

async function download(name, role, outputDir) {
  const res = await lanFetch(`${API}/file/${encodeURIComponent(name)}`, {
    signal: AbortSignal.timeout(300000),
  });
  if (!res.ok) throw new Error(`产物 ${name} 下载失败 HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  // 落盘名只认服务给的 role：远端文件名是 {task_id}_no_vocals.wav，
  // 拿最后一段下划线后的 token 反推会把 no_vocals 读成 vocals，两条轨会互相覆盖。
  const local = ROLE_NAMES[role] || path.basename(name);
  const dst = path.join(outputDir, local);
  fs.writeFileSync(dst, buf);
  return dst;
}

module.exports = async ({ inputPath, params, outputDir, onProgress, isCanceled }) => {
  const started = Date.now();
  fs.mkdirSync(outputDir, { recursive: true });
  onProgress?.(10, '提交到 GPU 分离服务');

  const { taskId, engine, model } = await submit({ inputPath, params });
  const task = await poll(taskId, { onProgress, isCanceled });

  onProgress?.(90, '回收产物');
  const files = [];
  const byRole = {};
  for (const item of task.files || []) {
    const dst = await download(item.name, item.role, outputDir);
    const name = path.basename(dst);
    files.push(name);
    byRole[item.role] = name;
  }
  if (!byRole.vocals) throw new Error(`分离完成但没有 vocals 产物（任务 ${taskId}）`);

  const vocalsPath = path.join(outputDir, byRole.vocals);
  const accompPath = byRole.no_vocals ? path.join(outputDir, byRole.no_vocals) : null;

  /**
   * 两条轨的电平差是「这次分离有没有意义」的唯一客观依据：
   * 素材本身只有旁白时（屏幕录制很常见），背景轨会比人声轨低十几二十 dB，
   * 听感上就是「人声轨跟原声一模一样」。不报出来的话只会被当成 bug。
   */
  const vocalsDb = measureWavDb(vocalsPath);
  const backgroundDb = accompPath ? measureWavDb(accompPath) : null;
  let note = '';
  if (vocalsDb !== null && backgroundDb !== null) {
    const gap = vocalsDb - backgroundDb;
    if (gap > 12) note = `背景轨比人声轨低 ${gap.toFixed(0)}dB：这段素材基本只有人声，没有可分的背景音乐`;
    else if (gap < -12) note = `人声轨比背景轨低 ${Math.abs(gap).toFixed(0)}dB：素材以音乐为主，人声占比很小`;
  }

  return {
    outputPath: vocalsPath,
    result: {
      vocalsPath,
      accompanimentPath: accompPath,
      files,
      engine,
      model,
      taskId,
      stems: {
        vocalsDb: vocalsDb === null ? null : Number(vocalsDb.toFixed(1)),
        backgroundDb: backgroundDb === null ? null : Number(backgroundDb.toFixed(1)),
      },
      note,
      elapsedMs: Date.now() - started,
    },
  };
};

let probeCache = null;

/** 能力探测：面板的「就绪」必须反映 GPU 服务真的可达，而不是 runner 文件在不在。 */
module.exports.probe = async () => {
  if (probeCache && Date.now() - probeCache.at < 30 * 1000) return probeCache.value;
  let value;
  try {
    const res = await lanFetch(`${API}/system`, { signal: AbortSignal.timeout(6000) });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const json = await res.json();
    value = json.cuda
      ? { ready: true, detail: `GPU 分离服务就绪（${json.gpu || 'CUDA'}，排队 ${json.queue || 0}）` }
      : { ready: true, detail: 'GPU 分离服务在线，但未检测到 CUDA（会退回 CPU，速度很慢）' };
  } catch (e) {
    value = {
      ready: false,
      error: `连不上 GPU 分离服务（${API}）：${tail(e.message, 160)}。请确认 naite@192.168.1.107 上 systemctl --user status sepvoice 正在运行`,
    };
  }
  probeCache = { at: Date.now(), value };
  return value;
};
