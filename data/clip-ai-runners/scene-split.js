/**
 * 镜头检测 runner（PySceneDetect）。
 *
 * 契约见 src/clip-ai.js 顶部：入参 { inputPath, params, workDir, outputDir, job, onProgress }，
 * 出参 { result?: any, outputPath?: string }。
 *
 * 外部依赖（不在 npm 里，需要人工准备）：
 *   python -m pip install "scenedetect[opencv]"
 * 解释器可用 CLIP_PYTHON 覆盖（默认 Windows 用 python，其它平台用 python3）。
 *
 * 为什么用 python API 而不是 scenedetect CLI：
 *   CLI 在 0.6 / 0.7 之间把 list-scenes 的时间列从 mm:ss 改成了秒，CSV 列名也变过；
 *   python API 这边自己打印 JSON，解析最稳。
 */
const { execFile } = require('child_process');

const PYTHON = process.env.CLIP_PYTHON || (process.platform === 'win32' ? 'python' : 'python3');
const TIMEOUT_MS = Number(process.env.CLIP_SCENE_SPLIT_TIMEOUT_MS || 10 * 60 * 1000);

const PY_SCRIPT = `
import json, sys
path, threshold, min_len = sys.argv[1], float(sys.argv[2]), float(sys.argv[3])
try:
    from scenedetect import open_video, SceneManager, AdaptiveDetector
except Exception as e:
    sys.stderr.write("IMPORT_ERROR: %s" % e)
    sys.exit(3)
video = open_video(path)
fps = float(video.frame_rate or 0) or 30.0
sm = SceneManager()
sm.add_detector(AdaptiveDetector(
    adaptive_threshold=threshold,
    min_scene_len=max(1, int(round(min_len * fps))),
))
sm.detect_scenes(video, show_progress=False)
cuts = []
for start, _end in sm.get_scene_list():
    t = float(start.get_seconds())
    if t > 0.001:
        cuts.append(round(t, 3))
sys.stdout.write("RESULT:" + json.dumps({"cuts": cuts, "fps": fps}))
`;

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

module.exports = async ({ inputPath, params, onProgress }) => {
  const threshold = Number(params && params.threshold);
  const minSceneLen = Number(params && params.minSceneLen);
  const thr = Number.isFinite(threshold) && threshold > 0 ? threshold : 27;
  const minLen = Number.isFinite(minSceneLen) && minSceneLen >= 0 ? minSceneLen : 0.6;

  onProgress?.(10, '镜头检测');

  let out;
  try {
    out = await runPython(['-c', PY_SCRIPT, inputPath, String(thr), String(minLen)], TIMEOUT_MS);
  } catch (e) {
    const stderr = String(e.stderr || '');
    if (e.code === 'ENOENT') {
      throw new Error(`未找到 python 解释器（${PYTHON}）：镜头检测依赖 PySceneDetect，请 pip install scenedetect[opencv]，或用 CLIP_PYTHON 指定解释器`);
    }
    if (/IMPORT_ERROR|No module named ['"]?scenedetect/i.test(stderr)) {
      throw new Error('未安装 scenedetect，请 pip install scenedetect[opencv]');
    }
    if (e.killed || e.signal === 'SIGTERM') {
      throw new Error(`镜头检测超时（${Math.round(TIMEOUT_MS / 1000)} 秒）：${tail(stderr) || '无输出'}`);
    }
    throw new Error(`镜头检测失败（退出码 ${e.code}）：${tail(stderr) || tail(e.stdout) || e.message}`);
  }

  const line = out.stdout.split(/\r?\n/).find((l) => l.startsWith('RESULT:'));
  if (!line) {
    throw new Error(`镜头检测没有输出结果：${tail(out.stdout) || tail(out.stderr) || 'stdout 为空'}`);
  }
  let parsed;
  try {
    parsed = JSON.parse(line.slice('RESULT:'.length));
  } catch (e) {
    throw new Error(`镜头检测结果解析失败：${e.message}`);
  }
  const cuts = Array.isArray(parsed.cuts) ? parsed.cuts.filter((x) => Number.isFinite(x)) : [];

  onProgress?.(95, '写出结果');
  return {
    result: {
      cuts,
      detector: 'adaptive',
      threshold: thr,
      minSceneLen: minLen,
      fps: Number(parsed.fps) || null,
    },
  };
};
