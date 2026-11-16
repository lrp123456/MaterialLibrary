/**
 * 生成完成后的自动超分。
 * 模型原片先留在本机，再按视觉智能的文件 URL 处理上传到上海临时 OSS。
 * 上传失败、任务失败或超时都返回原片和一句原因，不抛给播放器。
 */
const fs = require('fs');
const path = require('path');
const auth = require('../auth');
const { downloadRemoteToTemp } = require('../shelf-lineage');
const { processVideoSuperResolution } = require('./aliyun-video-sr');

function resolvePublicBase(services) {
  let kv = '';
  try {
    kv = services.db?.prepare('SELECT value FROM kv WHERE key=?').get('bff_public_base')?.value || '';
  } catch { /* kv 缺失时继续看环境变量 */ }
  return String(kv || process.env.BFF_PUBLIC_BASE || process.env.PUBLIC_BASE_URL || services.config?.bffPublicBase || '').replace(/\/+$/, '');
}

function publicVendorUrl(value) {
  const url = String(value || '').trim();
  if (!/^https:\/\//i.test(url)) return '';
  if (/\/api\/cache\/temp\//i.test(url)) return '';
  return url;
}

function chooseFetchUrl(local, vendorUrl) {
  return publicVendorUrl(vendorUrl) || publicVendorUrl(local?.vendorUrl) || '';
}

function tokenizedTempUrl(services, fileName) {
  const base = resolvePublicBase(services);
  if (!base) {
    const err = new Error('未配置公网地址，超分服务拉不到片子');
    err.code = 'public_base_missing';
    throw err;
  }
  const name = path.basename(fileName);
  const token = auth.generateMediaToken(auth.tempMediaSubject(name), 6 * 3600, services.config?.dataDir);
  return `${base}/api/cache/temp/${encodeURIComponent(name)}?media_token=${encodeURIComponent(token)}`;
}

async function localizePreview(services, previewUrl) {
  const preview = String(previewUrl || '').trim();
  if (!preview) throw new Error('没有可超分的视频');
  const tempDir = path.join(services.config.dataDir, 'cache', 'temp');
  fs.mkdirSync(tempDir, { recursive: true });
  if (/\/api\/cache\/temp\//i.test(preview)) {
    const name = path.basename(preview.split('?')[0]);
    const abs = path.join(tempDir, name);
    if (!name || !fs.existsSync(abs) || !fs.statSync(abs).isFile()) {
      throw new Error('临时文件已清理，请重新生成');
    }
    return { localPath: abs, previewUrl: `/api/cache/temp/${name}`, vendorUrl: '' };
  }
  if (/^https?:\/\//i.test(preview)) {
    const localPath = await downloadRemoteToTemp(services.config, preview);
    return {
      localPath,
      previewUrl: `/api/cache/temp/${path.basename(localPath)}`,
      vendorUrl: preview,
    };
  }
  throw new Error('没有可超分的视频');
}

function srReason(err) {
  const msg = String(err?.message || err || '').trim();
  if (!msg) return '超分失败，已改播模型原片';
  if (/未配置 ALIYUN_ACCESS_KEY/.test(msg)) return '未配置阿里云密钥，已改播模型原片';
  if (/超时/.test(msg)) return '超分超时，已改播模型原片';
  if (/失败|拉不到|公网|HTTP/.test(msg)) return msg.length > 80 ? '超分失败，已改播模型原片' : msg;
  return '超分失败，已改播模型原片';
}

async function superResolveFromPreview(services, previewUrl, vendorUrl, { onStage } = {}) {
  // 非上海地址不能直接当 VideoUrl。vendorUrl 不交给超分，只用已经落地的本地文件。
  void vendorUrl;
  let local;
  try {
    local = await localizePreview(services, previewUrl);
  } catch (err) {
    return { ok: false, modelVideoUrl: String(previewUrl || ''), error: srReason(err), timing: null };
  }
  try {
    const sr = await processVideoSuperResolution('', {
      localPath: local.localPath,
      outputDir: path.join(services.config.dataDir, 'cache', 'temp'),
      maxWaitMs: 5 * 60 * 1000,
      onStage,
    });
    const name = path.basename(sr.localPath || '');
    if (!name) throw new Error('超分结果没有落盘');
    const t = sr.timing || {};
    console.log(
      `[video-sr] 超分完成 jobId=${sr.jobId || '-'} 总用时=${fmtSec(t.totalMs)}` +
      `（上传 ${fmtSec(t.uploadMs)} / 提交 ${fmtSec(t.submitMs)} / 云端处理 ${fmtSec(t.processingMs)} / 下载 ${fmtSec(t.downloadMs)}）`
    );
    return {
      ok: true,
      modelVideoUrl: local.previewUrl,
      srVideoUrl: `/api/cache/temp/${name}`,
      timing: sr.timing || null,
    };
  } catch (err) {
    console.warn(`[video-sr] 超分失败，改播模型原片：${srReason(err)}`);
    return { ok: false, modelVideoUrl: local.previewUrl, error: srReason(err), timing: null };
  }
}

function fmtSec(ms) {
  return `${(Number(ms || 0) / 1000).toFixed(1)}s`;
}

module.exports = {
  resolvePublicBase,
  chooseFetchUrl,
  superResolveFromPreview,
};
