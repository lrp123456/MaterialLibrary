/**
 * App 远程更新：wgt 优先，整包 APK 兜底。
 * 清单文件：data/app-update/manifest.json
 * 产物目录：data/app-update/files/
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function updateDir(config) {
  return path.join(config.dataDir || path.join(__dirname, '..', 'data'), 'app-update');
}

function manifestPath(config) {
  return path.join(updateDir(config), 'manifest.json');
}

function defaultManifest() {
  return {
    platform: 'android',
    // 当前已发布的最新版本信息；hasUpdate 由客户端 versionCode 比较得出
    latest: {
      versionCode: 100,
      versionName: '1.0.0',
      wgtVersion: '100',
      type: 'none', // none | wgt | apk
      force: false,
      note: '初始基线版本',
      url: '',
      md5: '',
      size: 0,
      publishedAt: null,
    },
    // 分环境通道：internal（内测）/ release（正式）；缺省回落 latest
    channels: {},
    // 可选：强制最低底包（低于此 versionCode 必须装 APK）
    minBaseVersionCode: 100,
    apk: {
      versionCode: 100,
      versionName: '1.0.0',
      url: '',
      md5: '',
      note: '',
    },
  };
}

function pickLatest(manifest, channel, deviceId, userAgent, clientIp) {
  const ch = String(channel || '').trim().toLowerCase();
  const dev = String(deviceId || '').trim().toLowerCase();
  const ua = String(userAgent || '').trim().toLowerCase();
  const ip = String(clientIp || '').trim().toLowerCase();
  const gray = manifest.grayscale || {};

  // 灰度测试命中逻辑：
  if (gray.active && gray.latest && gray.latest.url && gray.latest.type !== 'none') {
    let rawTargets = [];
    if (Array.isArray(gray.targetDevices)) {
      rawTargets = gray.targetDevices;
    } else if (typeof gray.targetDevices === 'string') {
      rawTargets = gray.targetDevices.split(/[,，\s]+/);
    }
    const targets = rawTargets.map((t) => String(t || '').trim().toLowerCase()).filter(Boolean);

    if (targets.length > 0) {
      // 1. 设置了白名单：必须严格命中白名单（匹配设备ID、型号、User-Agent或指定纯IP）
      const isTargetDev = targets.some((target) => {
        if (!target) return false;
        // 匹配设备型号、ADB 序列号（如 127.0.0.1:21503）或设备唯一标识
        if (dev && (dev === target || dev.includes(target) || target.includes(dev))) return true;
        // 匹配 User-Agent 中的手机型号（如 HD1910）
        if (ua && (ua === target || ua.includes(target))) return true;
        // 只有当目标是纯 IP 格式（如 <LAN_HOST>，不带端口）时才匹配客户端 IP；带端口的属于 ADB 序列号，不按 IP 泛匹配
        const isPureIp = /^(\d{1,3}\.){3}\d{1,3}$/.test(target);
        if (isPureIp && ip && (ip === target || ip.includes(target))) return true;
        return false;
      });

      if (isTargetDev) {
        return gray.latest;
      }
      // 严格拦截：未命中白名单的设备，坚决不给灰度版本！即便客户端声明了 canary 通道也不给。
      // 保证灰度范围严格限制在白名单内，绝不全局扩散！
    } else {
      // 2. 未指定白名单（留空表示所有参与尝鲜通道的设备生效）：
      // 仅当客户端显式开启/声明 canary/beta/gray 通道时才下发灰度包；
      // 普通正式版/内部默认通道设备绝不打扰，绝不全局推送！
      const isCanaryChannel = ch === 'canary' || ch === 'beta' || ch === 'gray';
      if (isCanaryChannel) {
        return gray.latest;
      }
    }
  }

  // 非灰度或未命中灰度，走常规版本（正式版）：
  // 注意：canary 通道如果没命中灰度，也回退到全量正式版 latest
  if (ch && ch !== 'canary' && ch !== 'beta' && ch !== 'gray' && manifest.channels && manifest.channels[ch] && manifest.channels[ch].latest) {
    return manifest.channels[ch].latest;
  }
  // 全局最新正式版本
  return manifest.latest || {};
}

function readManifest(config) {
  const p = manifestPath(config);
  try {
    if (fs.existsSync(p)) {
      return JSON.parse(fs.readFileSync(p, 'utf8'));
    }
  } catch (e) {
    console.warn('[app-update] manifest 读取失败', e.message);
  }
  return defaultManifest();
}

function writeManifest(config, manifest) {
  const dir = updateDir(config);
  fs.mkdirSync(dir, { recursive: true });
  fs.mkdirSync(path.join(dir, 'files'), { recursive: true });
  const p = manifestPath(config);
  fs.writeFileSync(p, JSON.stringify(manifest, null, 2), 'utf8');
  return p;
}

function fileMd5(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('md5');
    const stream = fs.createReadStream(filePath);
    stream.on('data', (d) => hash.update(d));
    stream.on('end', () => resolve(hash.digest('hex')));
    stream.on('error', reject);
  });
}

/**
 * 客户端检查更新。
 * query: platform, versionCode(包版本), wgtVersion(资源/热更版本), channel
 *
 * 版本策略（scripts/version-bump.ps1）：
 *   - 每次出包机器号 +1，buildCode = versionCode*10000+machineCode 单调递增
 *   - 人工发版时版本号 +1 且机器号清零
 *   - 只升不降：本地 build 已 ≥ 服务端则不弹（侧载/开发新包不被旧热更打扰）
 */
async function checkUpdate(config, query = {}) {
  const clientCode = Number(query.versionCode || 0);
  const clientWgtRaw = String(query.wgtVersion || query.versionCode || '0');
  const clientWgt = Number(clientWgtRaw.replace(/[^\d]/g, '') || 0) || clientCode;
  // 客户端本地“最新已拥有”的构建号：包版本与资源版本取大
  const clientMax = Math.max(clientCode, clientWgt);
  const platform = String(query.platform || 'android');
  const channel = String(query.channel || 'internal');
  const deviceId = String(query.deviceId || '');
  const userAgent = String(query.userAgent || '');
  const clientIp = String(query.clientIp || '');
  const manifest = readManifest(config);
  if (manifest.platform && manifest.platform !== platform && platform !== 'android') {
    return { hasUpdate: false, reason: 'platform_mismatch' };
  }

  const latest = pickLatest(manifest, channel, deviceId, userAgent, clientIp);
  const latestCode = Number(latest.versionCode || 0);
  const latestWgt = Number(String(latest.wgtVersion || latestCode || '0').replace(/[^\d]/g, '') || 0) || latestCode;
  const serverMax = Math.max(latestCode, latestWgt);
  const forceBase = Number(manifest.minBaseVersionCode || 0);

  // 底包过旧：必须整包
  if (forceBase > 0 && clientCode > 0 && clientCode < forceBase) {
    const apk = manifest.apk || {};
    return {
      hasUpdate: true,
      type: 'apk',
      force: true,
      versionCode: apk.versionCode || latestCode,
      versionName: apk.versionName || latest.versionName,
      note: apk.note || '当前安装包过旧，请升级完整安装包',
      url: apk.url || latest.url,
      md5: apk.md5 || latest.md5 || '',
      size: apk.size || latest.size || 0,
    };
  }

  // 只升不降：本地包/资源已持平或更新 → 不弹
  if (serverMax > 0 && clientMax >= serverMax) {
    return {
      hasUpdate: false,
      latestVersionName: latest.versionName,
      latestVersionCode: latestCode,
      reason: 'local_up_to_date',
    };
  }

  // 若更新包地址为空或类型为 none，不判定为有更新
  if (!latest.url || latest.type === 'none') {
    return { hasUpdate: false, latestVersionName: latest.versionName, latestVersionCode: latestCode };
  }

  // 热更：只比资源号；整包：只比包号
  const wgtNewer = latestWgt > clientWgt;
  const codeNewer = latestCode > clientCode;

  let type = latest.type === 'apk' ? 'apk' : 'wgt';
  if (type === 'apk' && !codeNewer && !wgtNewer) {
    return { hasUpdate: false, latestVersionName: latest.versionName, latestVersionCode: latestCode };
  }
  if (type === 'wgt' && !wgtNewer) {
    // 资源未更新但包号更旧且服务端给了整包 → 降级为整包提示
    if (codeNewer && manifest.apk && manifest.apk.url) {
      type = 'apk';
    } else {
      return { hasUpdate: false, latestVersionName: latest.versionName, latestVersionCode: latestCode };
    }
  }

  return {
    hasUpdate: true,
    type,
    force: Boolean(latest.force) && clientMax < serverMax,
    versionCode: latestCode,
    versionName: latest.versionName,
    wgtVersion: latestWgt,
    note: latest.note || '',
    url: (type === 'apk' && manifest.apk && manifest.apk.url) ? manifest.apk.url : (latest.url || ''),
    md5: (type === 'apk' && manifest.apk && manifest.apk.md5) ? manifest.apk.md5 : (latest.md5 || ''),
    size: (type === 'apk' && manifest.apk && manifest.apk.size) ? manifest.apk.size : (latest.size || 0),
    publishedAt: latest.publishedAt || null,
  };
}

/**
 * 管理端：发布更新元数据。
 * body: { versionCode, versionName, wgtVersion, type, force, note, url, md5, size, minBaseVersionCode, apk? }
 */
function publishUpdate(config, body = {}) {
  const manifest = readManifest(config);
  const channel = String(body.channel || '').trim();
  const baseLatest = (channel && manifest.channels?.[channel]?.latest) || manifest.latest || {};
  const type = body.type === 'apk' ? 'apk' : body.type === 'wgt' ? 'wgt' : body.type === 'none' ? 'none' : baseLatest.type || 'wgt';
  const latest = {
    versionCode: Number(body.versionCode || (baseLatest.versionCode || 0) + 1),
    versionName: String(body.versionName || ''),
    wgtVersion: String(body.wgtVersion || body.versionCode || ''),
    type,
    force: Boolean(body.force),
    note: String(body.note || ''),
    url: String(body.url || ''),
    md5: String(body.md5 || ''),
    size: Number(body.size || 0),
    publishedAt: Date.now(),
  };
  if (!latest.versionName) latest.versionName = `1.0.${Math.max(0, latest.versionCode - 100)}`;

  const releaseMode = String(body.releaseMode || '').toLowerCase(); // 'canary' | 'full'
  const isCanary = releaseMode === 'canary' || channel === 'canary';

  if (isCanary) {
    if (!manifest.channels) manifest.channels = {};
    manifest.channels.canary = { latest };
    let targets = [];
    if (Array.isArray(body.targetDevices)) {
      targets = body.targetDevices.map((s) => String(s || '').trim()).filter(Boolean);
    } else if (typeof body.targetDevices === 'string' && body.targetDevices.trim()) {
      targets = body.targetDevices.split(/[,，\s]+/).map((s) => s.trim()).filter(Boolean);
    }
    manifest.grayscale = {
      active: true,
      targetDevices: targets,
      latest,
      publishedAt: Date.now(),
    };
  } else {
    // 全量发布：写全局 latest（兼容全部常规客户端）
    manifest.latest = latest;
    if (channel) {
      if (!manifest.channels) manifest.channels = {};
      manifest.channels[channel] = { ...(manifest.channels[channel] || {}), latest };
    }
    // 若原先处于灰度状态且被全量覆盖，标记灰度转正
    if (manifest.grayscale && manifest.grayscale.latest && String(manifest.grayscale.latest.wgtVersion) === String(latest.wgtVersion)) {
      manifest.grayscale.active = false;
      manifest.grayscale.promotedAt = Date.now();
    }
  }

  if (body.minBaseVersionCode != null) {
    manifest.minBaseVersionCode = Number(body.minBaseVersionCode);
  }
  if (body.apk && typeof body.apk === 'object') {
    manifest.apk = { ...manifest.apk, ...body.apk };
  }
  writeManifest(config, manifest);
  return manifest;
}

function promoteCanary(config) {
  const manifest = readManifest(config);
  const canaryLatest = (manifest.channels && manifest.channels.canary && manifest.channels.canary.latest)
    || (manifest.grayscale && manifest.grayscale.latest);
  if (!canaryLatest || !canaryLatest.url) {
    throw new Error('当前没有可转正的灰度版本');
  }
  manifest.latest = { ...canaryLatest, publishedAt: Date.now() };
  if (!manifest.channels) manifest.channels = {};
  manifest.channels.internal = { latest: manifest.latest };
  manifest.channels.release = { latest: manifest.latest };
  if (manifest.grayscale) {
    manifest.grayscale.active = false;
    manifest.grayscale.promotedAt = Date.now();
  }
  writeManifest(config, manifest);
  return manifest;
}

function revokeCanary(config) {
  const manifest = readManifest(config);
  if (manifest.channels && manifest.channels.canary) {
    delete manifest.channels.canary;
  }
  if (manifest.grayscale) {
    manifest.grayscale.active = false;
    manifest.grayscale.revokedAt = Date.now();
  }
  writeManifest(config, manifest);
  return manifest;
}

function getUpdateState(config) {
  const manifest = readManifest(config);
  const canary = (manifest.channels && manifest.channels.canary && manifest.channels.canary.latest)
    || (manifest.grayscale && manifest.grayscale.latest)
    || null;
  return {
    latest: manifest.latest || null,
    canary,
    grayscale: manifest.grayscale || { active: false, targetDevices: [] },
    channels: manifest.channels || {},
  };
}

/**
 * 管理端：上传 wgt/apk 文件并更新清单。
 * file: { originalname/path, buffer 或已落盘 tmpPath }
 */
async function publishFile(config, { fileName, tmpPath, buffer, fields = {} }) {
  const dir = updateDir(config);
  const filesDir = path.join(dir, 'files');
  fs.mkdirSync(filesDir, { recursive: true });
  const safeName = String(fileName || `app-${Date.now()}.wgt`).replace(/[^\w.\-]/g, '_');
  const dest = path.join(filesDir, safeName);
  if (buffer) {
    fs.writeFileSync(dest, buffer);
  } else if (tmpPath && fs.existsSync(tmpPath)) {
    fs.copyFileSync(tmpPath, dest);
  } else {
    throw new Error('缺少文件内容');
  }
  const md5 = await fileMd5(dest);
  const size = fs.statSync(dest).size;
  const type = safeName.endsWith('.apk') ? 'apk' : 'wgt';
  const url = `/api/app/update/files/${safeName}`;
  const manifest = publishUpdate(config, {
    ...fields,
    type,
    md5,
    size,
    url,
    channel: fields.channel || undefined,
    releaseMode: fields.releaseMode || undefined,
    targetDevices: fields.targetDevices || undefined,
  });
  return { manifest, file: { name: safeName, url, md5, size } };
}

function resolveUpdateFilePath(config, name) {
  const filesDir = path.join(updateDir(config), 'files');
  const safe = path.basename(String(name || ''));
  const p = path.join(filesDir, safe);
  if (!p.startsWith(filesDir)) return null;
  return fs.existsSync(p) ? p : null;
}

module.exports = {
  checkUpdate,
  pickLatest,
  publishUpdate,
  publishFile,
  promoteCanary,
  revokeCanary,
  getUpdateState,
  readManifest,
  writeManifest,
  resolveUpdateFilePath,
  updateDir,
  defaultManifest,
};
