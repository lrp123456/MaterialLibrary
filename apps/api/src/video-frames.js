/**
 * 视频抽帧：海报 + 0/25/50/75% 关键帧，供对话理解与入库 gate/tag。
 */
const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const { extractPoster, extractVideoMeta } = require('./umbra');

function isVideoFile(p) {
  return /\.(mp4|mov|webm|mkv|m4v)$/i.test(String(p || ''));
}

function extractAt(videoPath, destPath, ss) {
  return new Promise((resolve) => {
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    const ff = spawn('ffmpeg', ['-y', '-ss', String(ss), '-i', videoPath, '-vframes', '1', '-q:v', '2', destPath]);
    ff.on('close', (code) => {
      resolve(code === 0 && fs.existsSync(destPath) && fs.statSync(destPath).size > 0);
    });
    ff.on('error', () => resolve(false));
  });
}

function toDataUrl(filePath) {
  const buf = fs.readFileSync(filePath);
  return `data:image/jpeg;base64,${buf.toString('base64')}`;
}

async function extractVideoFrames(videoPath, destDir, { prefix = 'vid', percents = [0, 25, 50, 75] } = {}) {
  if (!videoPath || !fs.existsSync(videoPath)) return [];
  fs.mkdirSync(destDir, { recursive: true });
  const meta = await extractVideoMeta(videoPath);
  const duration = Number(meta.duration) || 0;
  const frames = [];
  for (const pct of percents) {
    const out = path.join(destDir, `${prefix}_f${pct}.jpg`);
    let ok = false;
    if (pct === 0) {
      ok = await extractPoster(videoPath, out);
    } else {
      const ss = duration > 0 ? Math.max(0.05, (duration * pct) / 100) : Number(pct) * 0.08;
      ok = await extractAt(videoPath, out, ss);
    }
    if (ok) frames.push({ path: out, percent: pct, dataUrl: toDataUrl(out) });
  }
  return frames;
}

async function downloadIfRemote(url, destPath) {
  if (!url) return null;
  if (!/^https?:\/\//i.test(String(url))) {
    return fs.existsSync(url) ? url : null;
  }
  const res = await fetch(url, { signal: AbortSignal.timeout(60000) });
  if (!res.ok) throw new Error(`下载视频失败 HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  fs.mkdirSync(path.dirname(destPath), { recursive: true });
  fs.writeFileSync(destPath, buf);
  return destPath;
}

async function framesFromVideoRef(ref, destDir, prefix) {
  const local = await downloadIfRemote(ref, path.join(destDir, `${prefix}_src.mp4`));
  if (!local) return [];
  return extractVideoFrames(local, destDir, { prefix });
}

module.exports = {
  isVideoFile,
  extractVideoFrames,
  framesFromVideoRef,
  downloadIfRemote,
};
