/**
 * P0 契约修复（App 全端改版落码第一段）静态门禁。
 *
 * 这些缺口横跨 uni-app 客户端（无 Node 运行时，无法在此直接执行）
 * 与服务端路由；沿用 gap-closure.test.js 的做法，对源码做精确锚点断言，
 * 保证“改过了”在后续重构中不会静默回退。
 *
 * 对应计划缺口：1 画幅多选 / 3 缓存键同源 / 4 详情消费 derivId /
 * 5 derivId 全链路 / 7 回收站逐项 + purge 保持 admin / 8 载荷补齐。
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

function sliceBetween(src, startMark, endMark) {
  const i = src.indexOf(startMark);
  assert.ok(i >= 0, `缺少锚点：${startMark}`);
  const j = src.indexOf(endMark, i + startMark.length);
  assert.ok(j >= 0, `缺少结束锚点：${endMark}`);
  return src.slice(i, j);
}

function main() {
  const api = read('src/api.js');

  // ── 缺口1：画幅多选提交数组/逗号串，后端按 OR + restage 子查询展开 ──
  const orientBlock = sliceBetween(api, 'if (orientation) {', '// q 为 keyword 的短别名');
  assert.ok(/String\(orientation\)\.split\(','\)/.test(orientBlock), '画幅参数必须支持逗号多值');
  assert.ok(orientBlock.includes("restage_9_16"), '9:16 需并入方案衍生子查询');
  assert.ok(orientBlock.includes("restage_3_4"), '3:4 需并入方案衍生子查询');
  assert.ok(orientBlock.includes("orientConds.join(' OR ')"), '多画幅必须按 OR 展开而非单值比较');

  // ── 缺口3：缓存键与实际请求序列化同源 ──
  const cache = read('app-uniapp/src/service/ViewerCache.js');
  assert.ok(cache.includes('export function buildAssetsQuery'), '必须导出统一的查询序列化器');
  assert.ok(
    cache.includes("'list:' + buildAssetsQuery(opts).filter(Boolean).join('&')"),
    'makeListKey 必须直接复用 buildAssetsQuery'
  );
  const apiSvc = read('app-uniapp/src/service/ViewerApi.js');
  assert.ok(apiSvc.includes('buildAssetsQuery'), '请求层必须复用同一序列化器');
  assert.ok(apiSvc.includes('const query = buildAssetsQuery(opts)'), 'fetchAssets 查询必须由 buildAssetsQuery 生成');

  // ── 缺口4：详情消费 derivId，按方案 ID 定位 ──
  const detail = read('app-uniapp/src/pages/detail/detail.vue');
  assert.ok(detail.includes('requestedDerivId'), '详情必须保存请求的方案 ID');
  assert.ok(detail.includes('decodeParam(opts.derivId)'), '详情 onLoad 必须读取 derivId');
  assert.ok(
    detail.includes('Number(t.derivativeId) === Number(this.requestedDerivId)'),
    '详情必须按 derivativeId 精确定位方案，不能按 kind 折叠'
  );
  const browse = read('app-uniapp/src/pages/browse/browse.vue');
  assert.ok(browse.includes("'&derivId='"), '浏览跳详情必须透传当前封面方案 ID');

  // ── 缺口5：editor→handoff→home→/edit/run 全链路透传 derivId ──
  const handoff = read('app-uniapp/src/common/handoff.js');
  assert.ok(handoff.includes('sourceDerivId'), '交接层必须携带 sourceDerivId');
  assert.ok(handoff.includes('pasteback'), '交接层必须携带精准贴回开关');
  const editor = read('app-uniapp/src/pages/editor/editor.vue');
  assert.ok(editor.includes('this.derivId = opts.derivId'), '选区编辑器必须读取 derivId');
  assert.ok(editor.includes('derivId: this.derivId'), '选区编辑器交接必须带上 derivId');
  const home = read('app-uniapp/src/pages/home/home.vue');
  assert.ok(home.includes('mediaUrl(payload.sourceFid, payload.sourceDerivId || 0)'), '创作页必须按方案挂载底图');
  assert.ok(home.includes('derivId: p.sourceDerivId || undefined'), '编辑请求体必须带 derivId');
  const editArgs = sliceBetween(api, 'const buildEditRunArgs', 'if (pathname === \'/edit/run\'');
  assert.ok(editArgs.includes('const requestedDerivId = b.derivId'), 'buildEditRunArgs 必须接收 derivId');
  assert.ok(editArgs.includes('getDerivativeById'), '必须按 ID 取方案行');
  assert.ok(editArgs.includes('resolveDerivativeFile'), '必须解析方案文件而非永远原图');
  assert.ok(editArgs.includes('deriv.asset_fid === asset.fid'), '方案必须属于同一素材，杜绝跨素材注入');
  assert.ok(editArgs.includes('sourceDerivId: requestedDerivId'), '下游需要可追踪的源方案 ID');

  // ── 缺口7：回收站逐项结果 + purge 保持 admin-only ──
  assert.ok(apiSvc.includes('export async function purgeTrashAsset'), 'purge 必须导出（此前导入未导出会 TypeError）');
  const purgeFn = sliceBetween(apiSvc, 'export async function purgeTrashAsset', 'export ');
  assert.ok(purgeFn.includes('adminRequest'), 'purge 走 admin 网关（/api/*），不得进 viewer 白名单降权');
  const bp = sliceBetween(browse, 'confirmRestore(fids, items)', 'confirmPurge(fids)');
  assert.ok(bp.includes('restored'), '批量恢复必须读取 restored 逐项结果');
  assert.ok(bp.includes('failed'), '批量恢复必须读取 failed 逐项结果');
  const trashDetail = read('app-uniapp/src/pages/trash-detail/trash-detail.vue');
  assert.ok(trashDetail.includes('.failed'), '回收站详情必须处理逐项失败');
  // 服务端 purge 仍保留 admin 守卫，不为移动端便利降权
  assert.ok(api.includes("if (!isAdmin) return sendJson(res, 403"), 'purge 服务端必须保持 admin-only');

  // ── 缺口8：quick 贴回开关 / 增强“本地”明示依赖 / chat 引用进载荷 ──
  for (const f of ['insert', 'remove', 'replace', 'watermark']) {
    const q = read(`app-uniapp/src/pages/quick/${f}.vue`);
    assert.ok(q.includes('pasteback: this.pasteback'), `${f}.vue 必须把精准贴回开关送入交接`);
    assert.ok(q.includes('derivId: this.derivId'), `${f}.vue 必须透传 derivId`);
  }
  const enhance = read('app-uniapp/src/pages/quick/enhance.vue');
  assert.ok(enhance.includes('需原生插件'), '增强“本地”档必须明示原生插件依赖，不伪装本地执行');
  assert.ok(enhance.includes('dep-tip'), '增强页必须展示依赖说明');
  assert.ok(home.includes('this.domain === \'chat\' && imageUrls.length) base.images = imageUrls'), '对话模态参考图必须以 images 上车');
  const chatRoute = sliceBetween(api, "if (pathname === '/gen/chat'", 'return sendJson(res, 200');
  assert.ok(chatRoute.includes('images: b.images'), '对话路由必须读取 images');
  assert.ok(chatRoute.includes('videoUrls: b.videoUrls'), '对话路由必须把视频引用交给执行层');

  console.log('✔ P0 App 契约修复验收通过（缺口 1/3/4/5/7/8）');
}

try {
  main();
} catch (err) {
  console.error(err);
  process.exit(1);
}
