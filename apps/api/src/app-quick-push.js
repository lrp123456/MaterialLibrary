/**
 * 一键「快捷推送」：在已发布清单上打 force 标记，客户端下次检查立即弹窗。
 * body: { channel?, force?, note? }
 * 不重新打包——打包在 Windows 侧用 pack-and-push.ps1；本接口负责「立刻推给手机」。
 */
function forcePush(config, body = {}) {
  const appUpdate = require('./app-update');
  const manifest = appUpdate.readManifest(config);
  const channel = String(body.channel || 'internal').trim();
  const latest = (manifest.channels?.[channel]?.latest) || manifest.latest;
  if (!latest || !latest.url || latest.type === 'none') {
    const err = new Error('尚无可推送的更新包，请先上传 wgt/apk');
    err.code = 'no_package';
    throw err;
  }
  const patched = {
    ...latest,
    force: body.force !== false,
    note: body.note || latest.note || '有新版本，请立即更新',
    publishedAt: Date.now(),
  };
  return appUpdate.publishUpdate(config, {
    versionCode: patched.versionCode,
    versionName: patched.versionName,
    wgtVersion: patched.wgtVersion,
    type: patched.type,
    force: patched.force,
    note: patched.note,
    url: patched.url,
    md5: patched.md5,
    size: patched.size,
    channel,
  });
}

module.exports = { forcePush };
