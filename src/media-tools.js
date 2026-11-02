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
    type: 'video'
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

module.exports = {
  runFfmpeg,
  extractFrames,
  sliceVideoScenes,
  convertVideo,
  extractCleanVocal,
};
