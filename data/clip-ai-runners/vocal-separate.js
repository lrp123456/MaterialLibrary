/**
 * 人声分离 runner（Demucs）。
 *
 * 契约见 src/clip-ai.js 顶部：入参 { inputPath, params, workDir, outputDir, job, onProgress }，
 * 出参 { result?: any, outputPath?: string }。worker 会把 outputPath 复制到 <job>/output/。
 *
 * 外部依赖（不在 npm 里，需要人工准备）：
 *   python -m pip install demucs
 * 首次运行会自动下载模型权重（htdemucs 约 300MB），所以超时给到 20 分钟。
 * 选 demucs 而不是 audio-separator：它一条命令就能产出 vocals.wav，不需要指定模型文件名。
 * 解释器可用 CLIP_PYTHON 覆盖；模型可用 params.model 或 CLIP_DEMUCS_MODEL 覆盖。
 */
const fs = require('fs');
const path = require('path');
const { execFile } = require('child_process');

const PYTHON = process.env.CLIP_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const DEFAULT_MODEL = process.env.CLIP_DEMUCS_MODEL || 'htdemucs';
const TIMEOUT_MS = Number(process.env.CLIP_VOCAL_SEPARATE_TIMEOUT_MS || 20 * 60 * 1000);

function tail(s, n = 400) {
  const t = String(s || '').trim();
  return t.length > n ? `…${t.slice(-n)}` : t;
}

function runPython(args, timeoutMs) {
  return new Promise((resolve, reject) => {
    execFile(PYTHON, args, { timeout: timeoutMs, windowsHide: true, maxBuffer: 16 * 1024 * 1024 }, (err, stdout, stderr) => {
      if (err) { err.stdout = stdout; err.stderr = stderr; reject(err); return; }
      resolve({ stdout: String(stdout || ''), stderr: String(stderr || '') });
    });
  });
}

/** demucs 产物目录是 <outRoot>/<model>/<track>/<stem>.wav，track 名可能被它清洗过，直接按文件名找。 */
function findStem(dir, target, depth = 0) {
  if (depth > 3) return null;
  let names = [];
  try { names = fs.readdirSync(dir); } catch { return null; }
  for (const name of names) {
    const p = path.join(dir, name);
    let st = null;
    try { st = fs.statSync(p); } catch { continue; }
    if (st.isFile() && name === target) return p;
  }
  for (const name of names) {
    const p = path.join(dir, name);
    try { if (!fs.statSync(p).isDirectory()) continue; } catch { continue; }
    const hit = findStem(p, target, depth + 1);
    if (hit) return hit;
  }
  return null;
}

module.exports = async ({ inputPath, params, workDir, outputDir, onProgress }) => {
  const model = String((params && params.model) || DEFAULT_MODEL);
  const outRoot = path.join(workDir, 'demucs');
  fs.mkdirSync(outRoot, { recursive: true });

  onProgress?.(10, '人声分离');

  const started = Date.now();
  try {
    await runPython([
      '-m', 'demucs',
      '--two-stems', 'vocals',
      '-n', model,
      '-o', outRoot,
      inputPath,
    ], TIMEOUT_MS);
  } catch (e) {
    const stderr = String(e.stderr || '');
    if (e.code === 'ENOENT') {
      throw new Error(`未找到 python 解释器（${PYTHON}）：人声分离依赖 Demucs，请 pip install demucs，或用 CLIP_PYTHON 指定解释器`);
    }
    if (/No module named ['"]?(demucs|torch|torchaudio)/i.test(stderr)) {
      throw new Error('未安装 demucs，请 pip install demucs');
    }
    if (e.killed || e.signal === 'SIGTERM') {
      throw new Error(`人声分离超时（${Math.round(TIMEOUT_MS / 1000)} 秒）：${tail(stderr) || '无输出'}`);
    }
    throw new Error(`人声分离失败（退出码 ${e.code}）：${tail(stderr) || tail(e.stdout) || e.message}`);
  }

  onProgress?.(90, '收集产出');
  const vocalsPath = findStem(outRoot, 'vocals.wav');
  if (!vocalsPath) {
    throw new Error(`人声分离完成但没找到 vocals.wav（模型 ${model}）：产物目录 ${outRoot}`);
  }
  // Demucs --two-stems vocals 同时产出 no_vocals.wav（伴奏/背景音）。
  // 两份都收进 output/，前端按文件名取，分别落到「人声」「背景音」两条轨。
  const accompPath = findStem(outRoot, 'no_vocals.wav');
  const files = [];
  for (const src of [vocalsPath, accompPath].filter(Boolean)) {
    const dst = path.join(outputDir, path.basename(src));
    fs.copyFileSync(src, dst);
    files.push(path.basename(src));
  }

  return {
    outputPath: vocalsPath,
    result: {
      vocalsPath,
      accompanimentPath: accompPath,
      files,
      model,
      elapsedMs: Date.now() - started,
    },
  };
};
