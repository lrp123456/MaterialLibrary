/**
 * App 发布状态只读聚合：
 *  - 正式数据平面（WSL）app-update/manifest.json：全量指针 + 灰度指针 + 设备白名单
 *  - pack-studio/state：wgt 版本号机最近一次打包/推送动作
 *  - Windows test 数据平面的 manifest（若存在）
 * 纯读取，不提供任何变更动作（发布变更只走 pack-studio / 服务端管理接口）。
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const bc = require('../../branch-channel');
const wsl = require('./wsl');

const ROOT = bc.ROOT;

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (_) {
    return null;
  }
}

function briefPointer(p) {
  if (!p) return null;
  return {
    versionCode: p.versionCode,
    wgtVersion: p.wgtVersion || String(p.versionCode || ''),
    versionName: p.versionName,
    type: p.type,
    force: Boolean(p.force),
    note: p.note || '',
    size: p.size || 0,
    publishedAt: p.publishedAt || null,
    url: p.url || '',
    md5: p.md5 || '',
  };
}

/** 读 WSL 正式库 manifest（发行版未运行时给 reachable:false，绝不抛错） */
function readProdManifest() {
  const file = path.join(wsl.PROD_DATA_UNC, 'app-update', 'manifest.json');
  if (!wsl.distroRunning()) return { reachable: false, file, manifest: null };
  const manifest = readJson(file);
  return { reachable: true, file, manifest };
}

/** Windows 侧 test 通道自己的 manifest（一般不发布，存在才返回） */
function readChannelManifest(laneKey) {
  const lane = bc.LANES[laneKey];
  if (!lane || lane.key === 'prod') return null;
  const file = path.join(lane.dataDir, 'app-update', 'manifest.json');
  const manifest = readJson(file);
  return manifest ? { file, manifest } : null;
}

function readPackState() {
  const dir = path.join(ROOT, 'pack-studio', 'state');
  const version = readJson(path.join(dir, 'wgt-version.json'));
  const historyRaw = readJson(path.join(dir, 'pack-history.json'));
  const history = Array.isArray(historyRaw) ? historyRaw : [];
  const last = history.length ? history[history.length - 1] : null;
  return {
    dir,
    version: version
      ? {
          lastIssued: version.lastIssued,
          versionName: version.versionName,
          versionCode: version.versionCode,
          machineCode: version.machineCode,
          lastBuildCode: version.lastBuildCode,
        }
      : null,
    lastAction: last
      ? { time: last.time || null, action: last.action || '', note: (last.note || '').slice(0, 120) }
      : null,
    historyCount: history.length,
  };
}

/**
 * 汇总。warnings 给面板/CLI 直接展示：
 *  - canary 指针领先全量（灰度中）
 *  - 版本号机编号与 manifest 不一致（打包了但没推 / 推了别的版本）
 *  - 白名单为空却 active
 */
function collectAppRelease() {
  const warnings = [];
  const prod = readProdManifest();
  const manifest = prod.manifest;

  const full = manifest ? briefPointer(manifest.latest) : null;
  const internal =
    manifest && manifest.channels && manifest.channels.internal
      ? briefPointer(manifest.channels.internal.latest)
      : null;
  const grayscale =
    manifest && manifest.grayscale
      ? {
          active: Boolean(manifest.grayscale.active),
          latest: briefPointer(manifest.grayscale.latest),
          targetDevices: Array.isArray(manifest.grayscale.targetDevices)
            ? manifest.grayscale.targetDevices
            : [],
          publishedAt: manifest.grayscale.publishedAt || null,
        }
      : { active: false, latest: null, targetDevices: [] };

  if (manifest && grayscale.active) {
    if (!grayscale.latest) {
      warnings.push('灰度处于 active，但没有灰度版本指针');
    } else if (!grayscale.targetDevices.length) {
      warnings.push('灰度处于 active，但设备白名单为空（没有任何设备会收到灰度包）');
    }
    if (full && grayscale.latest && grayscale.latest.versionCode > full.versionCode) {
      warnings.push(
        `灰度 ${grayscale.latest.versionCode} 领先全量 ${full.versionCode}（灰度验证中，待 promote）`
      );
    }
  }

  const pack = readPackState();
  if (pack.version && full && pack.version.lastIssued < full.versionCode) {
    warnings.push(
      `版本号机 lastIssued=${pack.version.lastIssued} 落后线上全量 ${full.versionCode}（可能在别处出包）`
    );
  }

  return {
    reachable: prod.reachable,
    manifestFile: prod.file,
    platform: (manifest && manifest.platform) || null,
    minBaseVersionCode: (manifest && manifest.minBaseVersionCode) || null,
    full,
    internal,
    grayscale,
    pack,
    testChannel: readChannelManifest('test'),
    warnings,
  };
}

module.exports = { collectAppRelease, readJson };
