/**
 * 端侧本地模型目录（服务端只提供元数据与下载，推理在客户端 NCNN）。
 * 对齐 API_CONTRACT.md §10。
 */
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');

const RUNTIME = 'ncnn';

/** 内置目录真相：客户端内置包以这些 id/version 对齐 */
const CATALOG = [
  {
    id: 'edge_sam_mobile',
    name: 'EdgeSAM (encoder+decoder NCNN)',
    task: 'segment',
    format: 'ncnn',
    quant: 'fp16',
    inputSize: 1024,
    version: '1.0.0',
    // onnx2ncnn 自 chongzhou/EdgeSAM ONNX；encoder 22MB + decoder 16MB
    fileName: 'edge_sam_encoder.param',
    companionFile: 'edge_sam_encoder.bin',
    extraFiles: {
      decoderParam: 'edge_sam_decoder.param',
      decoderBin: 'edge_sam_decoder.bin',
    },
    sizeBytes: 21976744,
    builtin: false,
    prompts: ['point', 'box'],
    outputs: ['mask_png', 'polygon'],
    exclusiveGroup: 'seg',
    priority: 10,
    desc: '点选/框选交互抠图；encoder+decoder 双网，需原生 NCNN so',
    source: 'https://huggingface.co/chongzhou/EdgeSAM + onnx2ncnn',
  },
  {
    id: 'realesrgan_x4_ncnn',
    name: 'Real-ESRGAN AnimeVideo x4 (NCNN)',
    task: 'upscale',
    scale: 4,
    format: 'ncnn',
    quant: 'fp16',
    maxSide: 1024,
    tile: 256,
    version: '1.0.0',
    // 已从 Real-ESRGAN ncnn-vulkan 包解压
    fileName: 'realesr-animevideov3-x4.param',
    companionFile: 'realesr-animevideov3-x4.bin',
    sizeBytes: 1247368,
    builtin: true,
    exclusiveGroup: 'upscale',
    priority: 5,
    desc: '离线分块 4x 超分（轻量 animevideov3，约 1.2MB bin）',
    source: 'https://github.com/xinntao/Real-ESRGAN/releases',
  },
  {
    id: 'realesrgan_x4plus_ncnn',
    name: 'Real-ESRGAN x4plus (NCNN)',
    task: 'upscale',
    scale: 4,
    format: 'ncnn',
    quant: 'fp32',
    maxSide: 1024,
    tile: 256,
    version: '1.0.0',
    fileName: 'realesrgan-x4plus.param',
    companionFile: 'realesrgan-x4plus.bin',
    sizeBytes: 33424520,
    builtin: false,
    exclusiveGroup: 'upscale',
    priority: 1,
    desc: '更强 4x，体积大（约 33MB），建议在线升级',
    source: 'https://github.com/xinntao/Real-ESRGAN/releases',
  },
];

function modelsDir(config) {
  // 优先使用仓库内 data/local-models（便于开发分发）
  const projectDir = path.join(__dirname, '../data/local-models');
  if (fs.existsSync(projectDir)) return projectDir;
  const dataDir = config?.dataDir
    || process.env.ML_DATA_DIR
    || path.join(require('os').homedir(), '.dsh-material-library');
  return path.join(dataDir, 'local-models');
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const h = crypto.createHash('sha256');
    const s = fs.createReadStream(filePath);
    s.on('error', reject);
    s.on('data', (c) => h.update(c));
    s.on('end', () => resolve(h.digest('hex')));
  });
}

function modelFilePath(config, id) {
  const hit = CATALOG.find((m) => m.id === id);
  if (!hit) return null;
  return path.join(modelsDir(config), hit.fileName);
}

/**
 * @returns {{runtime: string, models: Array, generatedAt: number}}
 */
async function listLocalModels(config) {
  const dir = modelsDir(config);
  const models = [];
  for (const m of CATALOG) {
    const fp = path.join(dir, m.fileName);
    let sizeBytes = m.sizeBytes || 0;
    let sha256 = '';
    let onDisk = false;
    try {
      if (fs.existsSync(fp)) {
        const st = fs.statSync(fp);
        sizeBytes = st.size;
        onDisk = true;
        sha256 = await sha256File(fp);
        // companion bin 一并计入
        if (m.companionFile) {
          const cfp = path.join(dir, m.companionFile);
          if (fs.existsSync(cfp)) {
            sizeBytes += fs.statSync(cfp).size;
          }
        }
        if (m.extraFiles) {
          for (const fn of Object.values(m.extraFiles)) {
            const efp = path.join(dir, fn);
            if (fs.existsSync(efp)) sizeBytes += fs.statSync(efp).size;
          }
        }
      }
    } catch (_) {}
    models.push({
      ...m,
      sizeBytes,
      sha256,
      onServerDisk: onDisk,
      downloadUrl: `/api/viewer/lab/local-models/${m.id}/download`,
    });
  }
  return {
    runtime: RUNTIME,
    models,
    generatedAt: Date.now(),
  };
}

function findLocalModel(id) {
  return CATALOG.find((m) => m.id === id) || null;
}

/**
 * @returns {{meta: object, filePath: string}|null}
 * @param {string} asset 'param' | 'bin' | ''（默认 param）
 */
function resolveDownload(config, id, asset = '') {
  const meta = findLocalModel(id);
  if (!meta) return null;
  const dir = modelsDir(config);
  let fileName = meta.fileName;
  if (asset === 'bin' && meta.companionFile) fileName = meta.companionFile;
  const filePath = path.join(dir, fileName);
  if (!filePath || !fs.existsSync(filePath)) return null;
  return { meta, filePath, fileName };
}

/** 服务端就绪：目录可下发；文件可能尚未放置（builtin 包在客户端） */
function isReady(config) {
  try {
    fs.mkdirSync(modelsDir(config), { recursive: true });
  } catch (_) {}
  return true;
}

module.exports = {
  RUNTIME,
  CATALOG,
  modelsDir,
  listLocalModels,
  findLocalModel,
  resolveDownload,
  modelFilePath,
  isReady,
};
