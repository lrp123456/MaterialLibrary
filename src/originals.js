/**
 * 原图真源：NAS material → cache/originals → origin 本地衍生 → 夸克下载（写入 NAS）。
 * 禁止把 512 缩略图当原图。
 */
const fs = require('fs');
const path = require('path');
const { Quark } = require('./quark');
const { resolveDerivativeFile } = require('./derivatives');
const { nasMaterialDir, nasOriginalPath, findNasOriginal } = require('./nasstore');

const ORIGIN_EXTS = ['.jpg', '.jpeg', '.png', '.webp', '.heic', '.heif', '.bmp'];

function originalsDir(config) {
  const dir = path.join(config.dataDir, 'cache', 'originals');
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function findCachedOriginal(config, fid) {
  const nas = findNasOriginal(config, fid);
  if (nas) return nas;
  const dir = originalsDir(config);
  for (const ext of ORIGIN_EXTS) {
    const p = path.join(dir, `${fid}${ext}`);
    if (fs.existsSync(p)) return p;
  }
  try {
    const prefix = String(fid).slice(0, 24);
    const hit = fs.readdirSync(dir).find(f => f.includes(prefix));
    if (hit) return path.join(dir, hit);
  } catch {}
  return null;
}

function canonicalOriginalPath(config, asset) {
  return nasOriginalPath(config, asset.fid, asset.file_name || '.jpg');
}

/**
 * 保证本地有一份可给质检/生图用的原文件，返回绝对路径。
 */
async function ensureOriginalFile(services, asset) {
  const { db, config } = services;
  if (!asset) throw new Error('缺少资产');

  const cached = findCachedOriginal(config, asset.fid);
  if (cached) return cached;

  const origin = db.prepare(`
    SELECT * FROM derivatives WHERE asset_fid=? AND kind='origin' ORDER BY id DESC LIMIT 1
  `).get(asset.fid);

  if (origin) {
    const resolved = await resolveDerivativeFile(services, origin);
    if (resolved && fs.existsSync(resolved)) {
      const dest = canonicalOriginalPath(config, asset);
      if (path.resolve(resolved) !== path.resolve(dest)) {
        try {
          fs.copyFileSync(resolved, dest);
          return dest;
        } catch {
          return resolved;
        }
      }
      return resolved;
    }
  }

  const localLike = origin?.storage_type === 'local_cache'
    || origin?.storage_type === 'nas'
    || asset.source === 'upload'
    || asset.source === 'harmony'
    || asset.source === 'sync'
    || asset.source === 'nas';
  if (localLike) {
    throw new Error('本地原图不存在');
  }

  const quarkFid = (origin && origin.storage_type === 'quark' && origin.storage_ref)
    ? origin.storage_ref
    : asset.fid;
  const dest = canonicalOriginalPath(config, asset);
  const dlDir = path.dirname(dest);
  fs.mkdirSync(dlDir, { recursive: true });
  const quark = new Quark(config.cliPath);
  const dl = await quark.download(quarkFid, dlDir);
  const downloaded = path.join(dlDir, dl.fileName || path.basename(dest));
  if (fs.existsSync(downloaded) && path.resolve(downloaded) !== path.resolve(dest)) {
    fs.renameSync(downloaded, dest);
  }
  if (!fs.existsSync(dest)) {
    throw new Error('夸克下载未写入本地原图');
  }
  return dest;
}

module.exports = {
  originalsDir,
  findCachedOriginal,
  canonicalOriginalPath,
  ensureOriginalFile,
  nasMaterialDir,
};
