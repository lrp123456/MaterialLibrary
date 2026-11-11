/**
 * NAS 本地素材库：\\<NAS_HOST>\文件服务\ai_video\material
 * WSL 挂载点默认 /mnt/synology/material，可用 ML_NAS_DIR 覆盖。
 */
const fs = require('fs');
const path = require('path');

const DEFAULT_NAS = '/mnt/synology/material';

/**
 * 跨平台 WSL 路径映射：在 Windows 下将 Linux /mnt 路径转为可通过 UNC 访问的路径
 */
function toPlatformNasPath(p) {
  if (!p || typeof p !== 'string') return p;
  if (process.platform === 'win32') {
    if (p.startsWith('/mnt/') || p.startsWith('\\mnt\\')) {
      const normalized = p.replace(/\\/g, '/');
      const uncCandidates = [
        `//wsl.localhost/smu${normalized}`,
        `//wsl$/smu${normalized}`,
        `\\\\wsl.localhost\\smu${normalized.replace(/\//g, '\\')}`
      ];
      for (const unc of uncCandidates) {
        if (fs.existsSync(unc)) return unc;
      }
      return uncCandidates[0];
    }
  }
  return p;
}

function nasMaterialDir(config) {
  const envDir = process.env.ML_NAS_DIR;
  if (envDir) return toPlatformNasPath(envDir);

  if (config?.nasDir) {
    const candidate = toPlatformNasPath(config.nasDir);
    if (fs.existsSync(candidate)) return candidate;
    return config.nasDir;
  }

  if (process.platform === 'win32') {
    const unc1 = '//wsl.localhost/smu/mnt/synology/material';
    if (fs.existsSync(unc1)) return unc1;
    const unc2 = '//wsl$/smu/mnt/synology/material';
    if (fs.existsSync(unc2)) return unc2;
  }

  const dir = (config?.dataDir && path.join(config.dataDir, 'nas_material'))
    || DEFAULT_NAS;
  try { fs.mkdirSync(dir, { recursive: true }); } catch {}
  return dir;
}

/** 分片目录，避免单目录数十万文件 */
function shardPath(base, fid) {
  const s = String(fid || '').replace(/[^A-Za-z0-9]/g, '_');
  const a = (s.slice(0, 2) || 'xx').toLowerCase();
  const b = (s.slice(2, 4) || 'xx').toLowerCase();
  return path.join(base, a, b);
}

function nasOriginalPath(config, fid, fileName) {
  const base = nasMaterialDir(config);
  const ext = (path.extname(fileName || '') || '.jpg').toLowerCase();
  const dir = shardPath(base, fid);
  fs.mkdirSync(dir, { recursive: true });
  return path.join(dir, `${fid}${ext}`);
}

function findNasOriginal(config, fid) {
  const base = nasMaterialDir(config);
  const dir = shardPath(base, fid);
  if (!fs.existsSync(dir)) return null;
  try {
    const hit = fs.readdirSync(dir).find(f => f.startsWith(String(fid).slice(0, 40)) || f.includes(String(fid).slice(0, 24)));
    if (hit) return path.join(dir, hit);
  } catch {}
  return null;
}

function nasDateOriginalPath(config, { fileName, date, hash = '', deviceId = '' } = {}) {
  const base = nasMaterialDir(config);
  const ts = Number(date) || Date.now();
  const d = new Date(ts < 1e12 ? ts * 1000 : ts);
  const yyyy = String(d.getFullYear() || new Date().getFullYear());
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  
  const targetDir = path.join(base, yyyy, mm);
  fs.mkdirSync(targetDir, { recursive: true });

  const rawName = path.basename(fileName || 'file');
  const ext = (path.extname(rawName) || '').toLowerCase();
  const nameWithoutExt = path.basename(rawName, ext).replace(/[\\/:*?"<>|]/g, '_').trim() || 'media';
  
  let candidateName = `${nameWithoutExt}${ext}`;
  let candidatePath = path.join(targetDir, candidateName);

  // 若存在同名文件且非当前文件，追加短哈希防冲突覆盖
  if (fs.existsSync(candidatePath) && hash) {
    const shortHash = String(hash).slice(0, 8);
    if (!nameWithoutExt.endsWith(shortHash)) {
      candidateName = `${nameWithoutExt}_${shortHash}${ext}`;
      candidatePath = path.join(targetDir, candidateName);
    }
  }

  return {
    dir: targetDir,
    fileName: candidateName,
    fullPath: candidatePath,
    relPath: path.relative(base, candidatePath).replace(/\\/g, '/')
  };
}

function createNasWriteStream(targetPath) {
  const dir = path.dirname(targetPath);
  fs.mkdirSync(dir, { recursive: true });
  return fs.createWriteStream(targetPath);
}

function nasAvailable() {
  const dir = process.env.ML_NAS_DIR || DEFAULT_NAS;
  try {
    fs.accessSync(dir, fs.constants.W_OK);
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  toPlatformNasPath,
  nasMaterialDir,
  nasOriginalPath,
  nasDateOriginalPath,
  createNasWriteStream,
  findNasOriginal,
  nasAvailable,
  DEFAULT_NAS,
};

