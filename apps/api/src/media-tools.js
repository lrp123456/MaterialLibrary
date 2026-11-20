/**
 * 媒体处理与剪辑实用工具库 (FFmpeg Toolkit & Media Processor)
 * 提供视频智能抽帧、关键帧捕获、镜头切片、视频转码、音频分离提取与压缩。
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const crypto = require('crypto');
const { extractVideoMeta } = require('./umbra');

function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const ff = spawn('ffmpeg', ['-y', ...args]);
    let stderr = '';
    ff.stderr.on('data', (d) => { stderr += d.toString(); });
    ff.on('close', (code) => {
      if (code === 0) resolve({ success: true, stderr });
      else reject(new Error(`FFmpeg 退出代码 ${code}: ${stderr.slice(-300)}`));
    });
    ff.on('error', (err) => reject(err));
  });
}

/**
 * 抽取视频帧
 * @param {Object} opts
 * @param {string} opts.videoPath - 本地视频文件路径
 * @param {string} opts.destDir - 产物输出目录
 * @param {string} [opts.mode='interval'] - 'interval' (固定间隔秒数) 或 'keyframe' (关键帧)
 * @param {number} [opts.intervalSeconds=2] - 间隔秒数
 * @param {number} [opts.maxFrames=20] - 最多抽取帧数
 */
async function extractFrames({ videoPath, destDir, mode = 'interval', intervalSeconds = 2, maxFrames = 24 }) {
  if (!fs.existsSync(videoPath)) {
    throw new Error(`视频文件不存在: ${videoPath}`);
  }
  fs.mkdirSync(destDir, { recursive: true });
  const meta = await extractVideoMeta(videoPath).catch(() => ({ duration: 0 }));
  const duration = Number(meta.duration) || 0;

  const results = [];
  const runId = crypto.randomBytes(4).toString('hex');

  if (mode === 'keyframe') {
    // 关键帧抽取：使用 select='eq(pict_type\,I)'
    const pattern = path.join(destDir, `frame_${runId}_%03d.jpg`);
    const args = [
      '-i', videoPath,
      '-vf', "select='eq(pict_type\\,I)'",
      '-vsync', 'vfr',
      '-q:v', '2',
      '-frames:v', String(maxFrames),
      pattern
    ];
    await runFfmpeg(args);
    const files = fs.readdirSync(destDir).filter(f => f.startsWith(`frame_${runId}_`)).sort();
    for (let i = 0; i < files.length; i++) {
      const fPath = path.join(destDir, files[i]);
      const stat = fs.statSync(fPath);
      results.push({
        name: files[i],
        path: fPath,
        size: stat.size,
        timestamp: i * 2, // 估算
        dataUrl: `data:image/jpeg;base64,${fs.readFileSync(fPath).toString('base64')}`
      });
    }
  } else {
    // 按照固定秒数逐帧截取
    const step = Math.max(0.5, Number(intervalSeconds) || 2);
    const targetTimes = [];
    const maxDur = duration > 0 ? duration : 60;
    for (let t = 0; t < maxDur && targetTimes.length < maxFrames; t += step) {
      targetTimes.push(t);
    }
    if (targetTimes.length === 0) targetTimes.push(0);

    for (let i = 0; i < targetTimes.length; i++) {
      const t = targetTimes[i];
      const outName = `frame_${runId}_${String(i).padStart(3, '0')}.jpg`;
      const outPath = path.join(destDir, outName);
      try {
        await runFfmpeg([
          '-ss', String(t),
          '-i', videoPath,
          '-vframes', '1',
          '-q:v', '2',
          outPath
        ]);
        if (fs.existsSync(outPath) && fs.statSync(outPath).size > 0) {
          results.push({
            name: outName,
            path: outPath,
            size: fs.statSync(outPath).size,
            timestamp: t,
            dataUrl: `data:image/jpeg;base64,${fs.readFileSync(outPath).toString('base64')}`
          });
        }
      } catch (err) {
        // 单帧失败跳过
      }
    }
  }

  return {
    videoDuration: duration,
    frameCount: results.length,
    frames: results
  };
}

/**
 * 视频转码、格式转换、音频分离或智能压缩
 */
async function convertVideo({ videoPath, destDir, targetFormat = 'mp4', crf = 23, extractAudio = false, cleanVocal = false }) {
  if (!fs.existsSync(videoPath)) {
    throw new Error(`视频文件不存在: ${videoPath}`);
  }
  fs.mkdirSync(destDir, { recursive: true });
  const basename = path.basename(videoPath, path.extname(videoPath));
  const runId = crypto.randomBytes(4).toString('hex');
  const fmt = String(targetFormat).toLowerCase().replace(/^\./, '');

  let outName = '';
  let args = [];

  if (extractAudio || fmt === 'mp3' || fmt === 'wav') {
    const ext = fmt === 'wav' ? 'wav' : 'mp3';
    outName = cleanVocal ? `${basename}_vocal_${runId}.${ext}` : `${basename}_audio_${runId}.${ext}`;
    const outPath = path.join(destDir, outName);
    
    // cleanVocal 深度人声分离与降噪管线：
    // 优先尝试 192.168.1.107:9000 GPU 服务端 MDX-Net (Kim_Vocal_2) + DNS64 微服务；
    // 离线或忙碌时自适应降级为本地增强型频域声场抵消滤镜链 (dialoguenhance + afftdn + speechnorm)
    let gpuSepSuccess = false;
    if (cleanVocal) {
      try {
        const { acquireGpuSlot, releaseGpuSlot, GPU_PANEL_BASE } = require('./vram-arbiter');
        const { lanFetch } = require('./gen/lan-fetch');
        const probe = await lanFetch(`${GPU_PANEL_BASE}/api/sep/system`, { signal: AbortSignal.timeout(2000) });
        if (probe.ok) {
          await acquireGpuSlot('sepvoice', { minFreeVramMb: 4000 });
          const fd = new FormData();
          fd.append('file', new Blob([fs.readFileSync(videoPath)]), path.basename(videoPath));
          fd.append('model', 'Kim_Vocal_2');
          fd.append('denoise', 'dns64');
          const subRes = await lanFetch(`${GPU_PANEL_BASE}/api/sep/separate`, { method: 'POST', body: fd, signal: AbortSignal.timeout(60000) });
          if (subRes.ok) {
            const subJson = await subRes.json();
            const taskId = subJson.task_id;
            for (let i = 0; i < 60; i++) {
              await new Promise(r => setTimeout(r, 1500));
              const tRes = await lanFetch(`${GPU_PANEL_BASE}/api/sep/tasks/${taskId}`);
              if (tRes.ok) {
                const tJson = await tRes.json();
                if (tJson.status === 'success' && tJson.files) {
                  const vocalItem = tJson.files.find(f => f.role === 'vocals') || tJson.files[0];
                  if (vocalItem) {
                    const down = await lanFetch(`${GPU_PANEL_BASE}/api/sep/file/${vocalItem.name}`);
                    if (down.ok) {
                      fs.writeFileSync(outPath, Buffer.from(await down.arrayBuffer()));
                      gpuSepSuccess = true;
                      break;
                    }
                  }
                }
              }
            }
          }
          await releaseGpuSlot('sepvoice');
        }
      } catch (_) {
        // GPU 面板不可达时自动降级
      }
    }

    if (gpuSepSuccess && fs.existsSync(outPath) && fs.statSync(outPath).size > 0) {
      return {
        outputFile: outName,
        outputPath: outPath,
        size: fs.statSync(outPath).size,
        format: ext,
        type: 'audio',
        isCleanVocal: true,
        engine: 'mdx_net_kim_vocal_2'
      };
    }

    // 本地降级：dialoguenhance 抑制伴奏 + afftdn 去底噪 + speechnorm
    const audioFilters = cleanVocal
      ? 'aformat=channel_layouts=stereo,dialoguenhance=original=0.08:enhance=2.8:voice=20,highpass=f=85,lowpass=f=7500,afftdn=nf=-25:tn=1,speechnorm=e=4:r=0.0001:l=1'
      : '';

    args = [
      '-i', videoPath,
      '-vn'
    ];
    if (audioFilters) {
      args.push('-af', audioFilters);
    }
    args.push(
      ext === 'mp3' ? '-acodec' : '-acodec',
      ext === 'mp3' ? 'libmp3lame' : 'pcm_s16le',
      '-q:a', '2',
      outPath
    );
    await runFfmpeg(args);
    return {
      outputFile: outName,
      outputPath: outPath,
      size: fs.statSync(outPath).size,
      format: ext,
      type: 'audio',
      isCleanVocal: cleanVocal
    };
  }

  if (fmt === 'gif') {
    outName = `${basename}_${runId}.gif`;
    const outPath = path.join(destDir, outName);
    args = [
      '-i', videoPath,
      '-vf', 'fps=12,scale=480:-1:flags=lanczos,split[s0][s1];[s0]palettegen[p];[s1][p]paletteuse',
      outPath
    ];
  } else {
    outName = `${basename}_transcode_${runId}.${fmt}`;
    const outPath = path.join(destDir, outName);
    args = [
      '-i', videoPath,
      '-c:v', 'libx264',
      '-crf', String(crf || 23),
      '-preset', 'fast',
      '-c:a', 'aac',
      '-b:a', '192k',
      '-movflags', '+faststart',
      outPath
    ];
  }

  const outPath = path.join(destDir, outName);
  await runFfmpeg(args);
  return {
    outputFile: outName,
    outputPath: outPath,
    size: fs.statSync(outPath).size,
    format: fmt,
    // GIF 也是从视频转出来的，但产物是图片：前端据此决定用 <image> 渲染并存入相册
    type: fmt === 'gif' ? 'image' : 'video'
  };
}

/**
 * 按镜头切换或固定秒数把长视频切成短片段。
 * scene_detect 用 ffmpeg scene 分数找切点；找不到切点时改按固定时长切。
 */
async function sliceVideoScenes({
  videoPath,
  destDir,
  sliceMode = 'scene_detect',
  sceneThreshold = 0.3,
  clipDurationSec = 5,
  maxClips = 12,
}) {
  if (!fs.existsSync(videoPath)) {
    throw new Error(`视频文件不存在: ${videoPath}`);
  }
  fs.mkdirSync(destDir, { recursive: true });
  const meta = await extractVideoMeta(videoPath).catch(() => ({ duration: 0 }));
  const duration = Number(meta.duration) || 15;
  const runId = crypto.randomBytes(4).toString('hex');
  const clips = [];

  let cutPoints = [0];
  if (sliceMode === 'scene_detect') {
    try {
      const { stderr } = await runFfmpeg([
        '-i', videoPath,
        '-vf', `select='gt(scene,${Number(sceneThreshold) || 0.3})',showinfo`,
        '-f', 'null',
        '-'
      ]);
      const re = /pts_time:([0-9.]+)/g;
      let m;
      while ((m = re.exec(stderr)) !== null) {
        const pt = Number(m[1]);
        if (pt - cutPoints[cutPoints.length - 1] >= 1.5) {
          cutPoints.push(pt);
        }
      }
    } catch (_) {}
  }

  if (cutPoints.length <= 1) {
    const step = Math.max(2, Number(clipDurationSec) || 5);
    for (let t = step; t < duration; t += step) {
      cutPoints.push(t);
    }
  }
  cutPoints.push(duration);

  const count = Math.min(maxClips, cutPoints.length - 1);
  for (let i = 0; i < count; i++) {
    const start = Number(cutPoints[i].toFixed(2));
    const segDur = Number(Math.max(1.0, cutPoints[i + 1] - start).toFixed(2));
    const outName = `slice_${runId}_${String(i).padStart(3, '0')}.mp4`;
    const outPath = path.join(destDir, outName);
    try {
      await runFfmpeg([
        '-ss', String(start),
        '-t', String(segDur),
        '-i', videoPath,
        '-c:v', 'libx264',
        '-preset', 'fast',
        '-crf', '23',
        '-c:a', 'aac',
        '-movflags', '+faststart',
        outPath
      ]);
      if (fs.existsSync(outPath) && fs.statSync(outPath).size > 0) {
        clips.push({
          index: i + 1,
          name: outName,
          path: outPath,
          start,
          duration: segDur,
          size: fs.statSync(outPath).size,
        });
      }
    } catch (_) {}
  }

  return {
    videoDuration: duration,
    sliceMode,
    clipCount: clips.length,
    clips,
  };
}

async function extractCleanVocal({ videoPath, destDir, targetFormat = 'mp3' }) {
  return convertVideo({
    videoPath,
    destDir,
    targetFormat,
    extractAudio: true,
    cleanVocal: true
  });
}

const BROWSER_VIDEO_CODECS = new Set(['h264', 'avc', 'avc1', 'vp8', 'vp9', 'av1', 'av01']);

/** Chromium 在多数 Windows 上没有 HEVC 硬解。10-bit / 非 4:2:0 的 H.264 同样画不出来。 */
function browserCanPlayVideo(meta) {
  const codec = String(meta?.codec || '').toLowerCase();
  if (!BROWSER_VIDEO_CODECS.has(codec)) return false;
  const pix = String(meta?.pixFmt || '').toLowerCase();
  if (pix && pix !== 'yuv420p' && pix !== 'yuvj420p') return false;
  return true;
}

function parseRate(raw) {
  if (raw == null || raw === '' || raw === '0/0') return 0;
  const s = String(raw);
  if (s.includes('/')) {
    const [a, b] = s.split('/').map(Number);
    if (b) return a / b;
  }
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function gopSecondsFromPts(pts) {
  const nums = (pts || []).map(Number).filter((n) => Number.isFinite(n)).sort((a, b) => a - b);
  const deltas = [];
  for (let i = 1; i < nums.length; i++) {
    const d = nums[i] - nums[i - 1];
    if (d > 0.05 && d < 30) deltas.push(d);
  }
  if (!deltas.length) return 2;
  deltas.sort((a, b) => a - b);
  return Math.round(deltas[Math.floor(deltas.length / 2)] * 1000) / 1000;
}

/** 把时间对齐到它所在 GOP 的关键帧起点。 */
function gopStartFor(time, gopSec, duration = 0) {
  const g = Math.max(0.25, Number(gopSec) || 2);
  const t = Math.max(0, Number(time) || 0);
  let start = Math.floor((t + 1e-4) / g) * g;
  if (duration > 0 && start >= duration) {
    start = Math.floor(Math.max(0, duration - 0.001) / g) * g;
  }
  return Math.round(start * 1000) / 1000;
}

function frameIndexInGop(time, gopStart, fps, count = 0) {
  const rate = Number(fps) > 0 ? Number(fps) : 30;
  let idx = Math.round((Math.max(0, Number(time) || 0) - Number(gopStart || 0)) * rate);
  if (!Number.isFinite(idx) || idx < 0) idx = 0;
  if (count > 0) idx = Math.min(count - 1, idx);
  return idx;
}

function scaleFilter(maxEdge) {
  const edge = Math.max(64, Math.min(1920, Math.round(Number(maxEdge) || 960)));
  return `scale=${edge}:${edge}:force_original_aspect_ratio=decrease`;
}

function runFfprobe(args) {
  return new Promise((resolve, reject) => {
    const ff = spawn('ffprobe', args);
    let out = '';
    let err = '';
    ff.stdout.on('data', (d) => { out += d.toString(); });
    ff.stderr.on('data', (d) => { err += d.toString(); });
    ff.on('close', (code) => {
      if (code === 0) resolve(out);
      else reject(new Error(`ffprobe 退出代码 ${code}: ${err.slice(-300)}`));
    });
    ff.on('error', reject);
  });
}

async function probeVideo(videoPath, { keyframes = false } = {}) {
  if (!fs.existsSync(videoPath)) throw new Error(`视频文件不存在: ${videoPath}`);
  const raw = await runFfprobe([
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=codec_name,width,height,avg_frame_rate,r_frame_rate,pix_fmt,duration,nb_frames',
    '-show_entries', 'format=duration',
    '-of', 'json',
    videoPath,
  ]);
  const j = JSON.parse(raw || '{}');
  const st = (j.streams && j.streams[0]) || {};
  const fmt = j.format || {};
  const fps = parseRate(st.avg_frame_rate) || parseRate(st.r_frame_rate) || 30;
  const duration = Number(st.duration || fmt.duration) || 0;
  let gopSec = 2;
  if (keyframes) {
    try {
      const csv = await runFfprobe([
        '-v', 'error',
        '-select_streams', 'v:0',
        '-skip_frame', 'nokey',
        '-show_entries', 'frame=pts_time',
        '-read_intervals', '%8',
        '-of', 'csv=p=0',
        videoPath,
      ]);
      gopSec = gopSecondsFromPts(csv.split(/\s+/).map((s) => s.trim()).filter(Boolean));
    } catch (_) {}
  }
  const meta = {
    codec: String(st.codec_name || ''),
    pixFmt: String(st.pix_fmt || ''),
    width: Number(st.width) || 0,
    height: Number(st.height) || 0,
    fps: Math.round(fps * 1000) / 1000,
    duration,
    frames: Number(st.nb_frames) || (duration && fps ? Math.round(duration * fps) : 0),
    gopSec,
    hasAudio: false,
  };
  try {
    const audioCsv = await runFfprobe([
      '-v', 'error',
      '-select_streams', 'a:0',
      '-show_entries', 'stream=codec_type',
      '-of', 'csv=p=0',
      videoPath,
    ]);
    meta.hasAudio = /audio/.test(audioCsv);
  } catch (_) {}
  meta.browserPlayable = browserCanPlayVideo(meta);
  return meta;
}

const proxyJobs = new Map();

function browserProxyFileName(videoPath) {
  const st = fs.statSync(videoPath);
  const id = crypto.createHash('sha1')
    .update(`${path.resolve(videoPath)}|${Math.round(st.mtimeMs)}|${st.size}|h264-1280-g15-v1`)
    .digest('hex')
    .slice(0, 20);
  return `bp_${id}.mp4`;
}

function describeBrowserProxy(videoPath, destDir) {
  const fileName = browserProxyFileName(videoPath);
  const dest = path.join(destDir, fileName);
  let ready = false;
  try {
    ready = fs.existsSync(dest) && fs.statSync(dest).size > 1024;
  } catch (_) {}
  return { ready, fileName, path: dest };
}

function proxySidecarPath(proxyPath) {
  return `${proxyPath}.json`;
}

function readProxySidecar(proxyPath) {
  try {
    const raw = fs.readFileSync(proxySidecarPath(proxyPath), 'utf8');
    const j = JSON.parse(raw);
    if (j && j.source && j.source.width && j.source.duration) return j;
  } catch (_) {}
  return null;
}

function writeProxySidecar(proxyPath, source, proxyMeta) {
  const body = {
    source: {
      codec: source.codec || '',
      pixFmt: source.pixFmt || '',
      width: source.width || 0,
      height: source.height || 0,
      fps: source.fps || 0,
      duration: source.duration || 0,
      gopSec: source.gopSec || 2,
      frames: source.frames || 0,
      browserPlayable: false,
    },
    proxy: {
      codec: proxyMeta.codec || 'h264',
      width: proxyMeta.width || 0,
      height: proxyMeta.height || 0,
      fps: proxyMeta.fps || 0,
      duration: proxyMeta.duration || 0,
    },
  };
  fs.writeFileSync(proxySidecarPath(proxyPath), JSON.stringify(body));
  return body;
}

/** 已有代理立刻返回；没有则在后台转，不挡住首帧。 */
function kickBrowserProxy(videoPath, destDir, opts = {}) {
  const described = describeBrowserProxy(videoPath, destDir);
  if (described.ready) return described;
  if (!proxyJobs.has(described.path)) {
    ensureBrowserProxy(videoPath, { destDir, ...opts }).catch((err) => {
      console.warn('[media-tools] 后台 H.264 代理失败:', err.message);
    });
  }
  return { ready: false, fileName: described.fileName, path: described.path };
}

/**
 * 打开抽帧。代理已缓存时只读 sidecar，不探原片、不抽帧，把时间留给 <video> 起播。
 * 没有代理时只启动后台转码，不再并行抽 GOP（那会把机器打满，代理更慢）。
 */
async function openScrubSession(videoPath, { proxyDir } = {}) {
  const described = proxyDir ? describeBrowserProxy(videoPath, proxyDir) : { ready: false, fileName: '' };
  if (described.ready) {
    let side = readProxySidecar(described.path);
    if (!side) {
      const [source, proxyMeta] = await Promise.all([
        probeVideo(videoPath),
        probeVideo(described.path),
      ]);
      side = writeProxySidecar(described.path, source, proxyMeta);
    }
    return {
      meta: { ...side.source, browserPlayable: false },
      preview: null,
      proxy: { ready: true, fileName: described.fileName, path: described.path },
    };
  }
  const meta = await probeVideo(videoPath);
  let proxy = { ready: false, fileName: '' };
  if (!meta.browserPlayable && proxyDir) {
    proxy = kickBrowserProxy(videoPath, proxyDir);
  }
  return { meta, preview: null, proxy };
}

const origJobs = new Map();

/** 从原片解出这一帧的全分辨率 JPEG（q=2）。同一帧并发共享一次解码。 */
async function readOriginalJpeg(videoPath, { cacheRoot, time = 0, gopSec = 2, fps = 30, duration = 0 } = {}) {
  if (!cacheRoot) throw new Error('缺少原画缓存目录');
  const rate = Number(fps) > 0 ? Number(fps) : 30;
  const frame = Math.max(0, Math.round((Number(time) || 0) * rate));
  const st = fs.statSync(videoPath);
  const id = crypto.createHash('sha1')
    .update(`${path.resolve(videoPath)}|${Math.round(st.mtimeMs)}|${st.size}|orig|${frame}`)
    .digest('hex')
    .slice(0, 24);
  const dest = path.join(cacheRoot, 'orig', `${id}.jpg`);
  if (fs.existsSync(dest) && fs.statSync(dest).size > 0) return fs.readFileSync(dest);
  if (origJobs.has(dest)) return origJobs.get(dest);
  const job = (async () => {
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    if (fs.existsSync(dest) && fs.statSync(dest).size > 0) return fs.readFileSync(dest);
    const gopStart = gopStartFor(time, gopSec, duration);
    const offset = Math.max(0, (Number(time) || 0) - gopStart);
    try {
      await runFfmpeg([
        '-ss', String(gopStart),
        '-i', videoPath,
        '-ss', offset.toFixed(3),
        '-frames:v', '1',
        '-an',
        '-q:v', '2',
        '-update', '1',
        dest,
      ]);
    } catch (err) {
      try { fs.unlinkSync(dest); } catch (_) {}
      throw err;
    }
    if (!fs.existsSync(dest) || fs.statSync(dest).size <= 0) throw new Error('原画帧抽出失败');
    return fs.readFileSync(dest);
  })();
  origJobs.set(dest, job);
  try {
    return await job;
  } finally {
    origJobs.delete(dest);
  }
}

/**
 * 把浏览器解不了的片子转成短 GOP 的 H.264 代理，只转一次并缓存。
 * 之后切帧走 <video> 硬解，不再每帧启动 ffmpeg。
 */
async function ensureBrowserProxy(videoPath, { destDir, maxEdge = 1280 } = {}) {
  if (!destDir) throw new Error('缺少代理输出目录');
  const fileName = browserProxyFileName(videoPath);
  const dest = path.join(destDir, fileName);
  if (fs.existsSync(dest) && fs.statSync(dest).size > 1024) {
    const source = await probeVideo(videoPath);
    const meta = await probeVideo(dest);
    return { proxied: true, fileName, path: dest, source, meta };
  }
  if (proxyJobs.has(dest)) return proxyJobs.get(dest);

  let settle;
  const gate = new Promise((resolve, reject) => { settle = { resolve, reject }; });
  proxyJobs.set(dest, gate);

  const job = (async () => {
    const source = await probeVideo(videoPath);
    if (source.browserPlayable) {
      return { proxied: false, source, meta: source };
    }
    const finish = async () => {
      const meta = await probeVideo(dest);
      return { proxied: true, fileName, path: dest, source, meta };
    };
    if (fs.existsSync(dest) && fs.statSync(dest).size > 1024) return finish();
    fs.mkdirSync(destDir, { recursive: true });
    if (fs.existsSync(dest) && fs.statSync(dest).size > 1024) return finish();
    // 扩展名必须是 .mp4，否则 ffmpeg 猜不出封装器（.part 会直接失败）
    const part = `${dest}.writing.mp4`;
    const edge = Math.max(480, Math.min(1920, Math.round(Number(maxEdge) || 1280)));
    const args = [
      '-i', videoPath,
      '-map', '0:v:0',
      '-vf', scaleFilter(edge),
      '-c:v', 'libx264',
      '-preset', 'veryfast',
      '-crf', '22',
      '-pix_fmt', 'yuv420p',
      '-g', '15',
      '-keyint_min', '15',
      '-movflags', '+faststart',
    ];
    if (source.hasAudio) args.push('-map', '0:a:0', '-c:a', 'aac', '-b:a', '128k');
    else args.push('-an');
    args.push(part);
    try {
      await runFfmpeg(args);
      if (!fs.existsSync(part) || fs.statSync(part).size < 1024) {
        throw new Error('H.264 代理文件为空');
      }
      fs.renameSync(part, dest);
    } catch (err) {
      try { fs.unlinkSync(part); } catch (_) {}
      throw err;
    }
    const result = await finish();
    try { writeProxySidecar(dest, result.source, result.meta); } catch (_) {}
    return result;
  })();
  job.then(settle.resolve, settle.reject);
  try {
    return await gate;
  } finally {
    if (proxyJobs.get(dest) === gate) proxyJobs.delete(dest);
  }
}

const gopJobs = new Map();

function listGopJpegs(dir) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir)
    .filter((name) => /^f_\d+\.jpg$/i.test(name))
    .sort()
    .map((name) => path.join(dir, name));
}

/**
 * 抽出一个 GOP 的预览 JPEG（约 1 秒）。同一目录并发请求共享同一次 ffmpeg。
 * 返回已落盘的帧路径，第 0 张对应 gopStart。
 */
async function ensureGopPreview(videoPath, { cacheRoot, gopStart, gopSec, maxEdge = 960 } = {}) {
  if (!cacheRoot) throw new Error('缺少帧缓存目录');
  const st = fs.statSync(videoPath);
  const edge = Math.max(64, Math.min(1920, Math.round(Number(maxEdge) || 960)));
  const id = crypto.createHash('sha1')
    .update(`${path.resolve(videoPath)}|${st.mtimeMs}|${st.size}|${edge}|${gopStart}|${gopSec}`)
    .digest('hex')
    .slice(0, 24);
  const dir = path.join(cacheRoot, id);
  const ready = listGopJpegs(dir);
  if (ready.length) return ready;

  if (gopJobs.has(dir)) return gopJobs.get(dir);
  const job = (async () => {
    fs.mkdirSync(dir, { recursive: true });
    const again = listGopJpegs(dir);
    if (again.length) return again;
    const pattern = path.join(dir, 'f_%04d.jpg');
    try {
      await runFfmpeg([
        '-ss', String(gopStart),
        '-i', videoPath,
        '-t', String(Math.max(0.2, Number(gopSec) || 2)),
        '-an',
        '-vf', scaleFilter(edge),
        '-q:v', '5',
        pattern,
      ]);
    } catch (err) {
      try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
      throw err;
    }
    const files = listGopJpegs(dir);
    if (!files.length) throw new Error('FFmpeg 没有抽出任何预览帧');
    return files;
  })();
  gopJobs.set(dir, job);
  try {
    return await job;
  } finally {
    gopJobs.delete(dir);
  }
}

async function readPreviewFrame(videoPath, { cacheRoot, time = 0, gopSec = 2, fps = 30, maxEdge = 960, duration = 0 } = {}) {
  const gopStart = gopStartFor(time, gopSec, duration);
  const files = await ensureGopPreview(videoPath, { cacheRoot, gopStart, gopSec, maxEdge });
  const index = frameIndexInGop(time, gopStart, fps, files.length);
  return {
    buffer: fs.readFileSync(files[index]),
    index,
    gopStart,
    count: files.length,
    time: gopStart + index / (Number(fps) > 0 ? Number(fps) : 30),
  };
}

/** 胶片条用：关键帧级快速抽一张小图，不解码整个 GOP。 */
async function grabFastThumb(videoPath, { time = 0, maxEdge = 320, destPath } = {}) {
  if (!destPath) throw new Error('缺少缩略图输出路径');
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  await runFfmpeg([
    '-ss', String(Math.max(0, Number(time) || 0)),
    '-i', videoPath,
    '-frames:v', '1',
    '-an',
    '-vf', scaleFilter(maxEdge),
    '-q:v', '6',
    '-update', '1',
    destPath,
  ]);
  if (!fs.existsSync(destPath) || fs.statSync(destPath).size <= 0) {
    throw new Error('缩略图抽出失败');
  }
  return fs.readFileSync(destPath);
}

/**
 * 胶片条：按时间均匀抽 count 张小图。优先走调用方给的可硬解代理，避免和预览 video 抢寻帧。
 */
async function readFilmstrip(videoPath, { count = 12, maxEdge = 280, cacheRoot, duration = 0 } = {}) {
  if (!cacheRoot) throw new Error('缺少胶片缓存目录');
  const n = Math.max(4, Math.min(24, Math.round(Number(count) || 12)));
  const edge = Math.max(80, Math.min(480, Math.round(Number(maxEdge) || 280)));
  const dur = Math.max(0.1, Number(duration) || (await probeVideo(videoPath)).duration || 1);
  const st = fs.statSync(videoPath);
  const id = crypto.createHash('sha1')
    .update(`${path.resolve(videoPath)}|${Math.round(st.mtimeMs)}|${st.size}|strip|${n}|${edge}|${dur.toFixed(3)}`)
    .digest('hex')
    .slice(0, 20);
  const dir = path.join(cacheRoot, `strip_${id}`);
  fs.mkdirSync(dir, { recursive: true });
  const times = [];
  for (let i = 0; i < n; i++) {
    times.push(Math.max(0, Math.min(dur - 0.04, ((i + 0.5) * dur) / n)));
  }
  let cursor = 0;
  const buffers = new Array(n);
  const worker = async () => {
    while (cursor < n) {
      const i = cursor++;
      const dest = path.join(dir, `f_${String(i).padStart(2, '0')}.jpg`);
      if (!fs.existsSync(dest) || fs.statSync(dest).size <= 0) {
        await grabFastThumb(videoPath, { time: times[i], maxEdge: edge, destPath: dest });
      }
      buffers[i] = fs.readFileSync(dest);
    }
  };
  await Promise.all([worker(), worker(), worker(), worker()]);
  return times.map((time, i) => ({ time, buffer: buffers[i] }));
}

/** 原画导出：从上一个关键帧精确解码到目标时间，输出 PNG。 */
async function grabFullPng(videoPath, { time = 0, gopSec = 2, duration = 0, destPath } = {}) {
  if (!destPath) throw new Error('缺少原画输出路径');
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  const gopStart = gopStartFor(time, gopSec, duration);
  const offset = Math.max(0, (Number(time) || 0) - gopStart);
  await runFfmpeg([
    '-ss', String(gopStart),
    '-i', videoPath,
    '-ss', offset.toFixed(3),
    '-frames:v', '1',
    '-an',
    '-c:v', 'png',
    '-update', '1',
    destPath,
  ]);
  if (!fs.existsSync(destPath) || fs.statSync(destPath).size <= 0) {
    throw new Error('原画帧抽出失败');
  }
  return fs.readFileSync(destPath);
}

module.exports = {
  runFfmpeg,
  extractFrames,
  sliceVideoScenes,
  convertVideo,
  extractCleanVocal,
  browserCanPlayVideo,
  gopSecondsFromPts,
  gopStartFor,
  frameIndexInGop,
  probeVideo,
  readPreviewFrame,
  grabFastThumb,
  grabFullPng,
  ensureBrowserProxy,
  browserProxyFileName,
  describeBrowserProxy,
  kickBrowserProxy,
  openScrubSession,
  readOriginalJpeg,
  readFilmstrip,
};
