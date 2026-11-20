/**
 * P2 验收：收藏 / 素材架 / 只看收藏 / 真瀑布流 / 日期气泡 / 全选反选 /
 * 详情左滑右滑切换 / 大图手势。
 *
 * 全部为静态契约 + 纯函数断言：不启动服务、不碰生产数据。
 * 服务端只校验 viewer 白名单包含素材架移动，且处理器仍是 isViewerOrAdmin。
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

function main() {
  // ── 查询序列化：只看收藏必须进查询串，否则缓存会串味 ──
  global.uni = {
    getStorageSync() { return ''; },
    setStorageSync() {},
    removeStorageSync() {},
  };
  const { buildAssetsQuery } = require('../app-uniapp/src/service/ViewerCache');
  const plain = buildAssetsQuery({ page: 1 }).join('&');
  const fav = buildAssetsQuery({ page: 1, onlyFavorite: true }).join('&');
  assert.ok(!plain.includes('only_favorite'), '默认不应带 only_favorite');
  assert.ok(fav.includes('only_favorite=1'), '只看收藏必须发 only_favorite=1');

  // ── 资产映射：收藏时间与素材架字段（源文件契约，assetMap 依赖打包器解析）──
  const assetMap = read('app-uniapp/src/common/assetMap.js');
  assert.ok(assetMap.includes('favoritedAt: r.favorited_at ? coerceAssetTs(r.favorited_at) : 0'), '收藏时间必须做秒/毫秒归一');
  assert.ok(assetMap.includes("libraryShelf: r.library_shelf || 'original'"), '素材架必须映射且默认原素材');

  // ── 浏览页：收藏 Tab / 快捷筛选 / 批选 / 瀑布流 / 日期气泡 ──
  const browse = read('app-uniapp/src/pages/browse/browse.vue');
  assert.ok(browse.includes("{ key: 'favorite', label: '收藏'"), '必须有一级收藏 Tab');
  assert.ok(browse.includes("@click=\"setShelf('retouched')\"") && browse.includes("@click=\"setShelf('finished')\""), '快捷筛选必须能切精修/成品');
  assert.ok(browse.includes('@click="toggleOnlyFavorite"'), '必须有只看收藏开关');
  assert.ok(browse.includes('shelf: this.shelfFilter') && browse.includes('onlyFavorite: this.onlyFavorite'), '两个筛选维度必须进列表查询');
  assert.ok(browse.includes('setAssetFavorite(item.fid, next)'), '卡片收藏必须走服务端接口');
  assert.ok(browse.includes('moveAssetShelf('), '长按必须能把素材移入精修/成品架');
  assert.ok(browse.includes('selectAllVisible') && browse.includes('invertSelection'), '批量栏必须支持全选与反选');
  assert.ok(browse.includes('const cols = [{ id: \'l\''), '分组必须拆成两列');
  assert.ok(browse.includes('g.columns = cols'), '分组必须挂载瀑布流列数据');
  assert.ok(browse.includes('v-for="col in g.columns"'), '模板必须按列渲染');
  assert.ok(browse.includes('measureGroupOffsets') && browse.includes('.date-group'), '必须测量分组位置驱动日期气泡');
  assert.ok(browse.includes('date-bubble'), '必须有滚动日期气泡');
  assert.ok(browse.includes("uni.setStorageSync('detail_nav_fids'"), '进入详情必须写入左右滑动上下文');

  // ── 详情页：收藏 / 素材架 / 上下张切换 ──
  const detail = read('app-uniapp/src/pages/detail/detail.vue');
  assert.ok(detail.includes('setAssetFavorite(this.item.fid, next)'), '详情收藏必须走服务端接口');
  assert.ok(detail.includes('shelfLabel') && detail.includes('onShelfTap'), '详情必须能查看并切换素材架');
  assert.ok(detail.includes('moveAssetShelf(this.item.fid'), '素材架切换必须持久化');
  assert.ok(detail.includes('@touchstart="onHeroTouchStart"') && detail.includes('@touchend="onHeroTouchEnd"'), '主图必须支持左右滑切换');
  assert.ok(detail.includes('goSibling') && detail.includes('switchToAsset'), '上下张切换必须原地替换资产');
  assert.ok(detail.includes('hero-arrow'), '必须提供可点的左右箭头');

  // ── 大图：手势不再和单击抢事件 ──
  const lb = read('app-uniapp/src/components/RefLightbox.vue');
  assert.ok(!lb.includes('class="lb-stage" @click="toggleZoom"'), '图片舞台不能再绑定单击缩放');
  assert.ok(lb.includes('_pinching'), '双指缩放期间必须屏蔽滑动/点击误判');
  assert.ok(lb.includes('dy > 90'), '未放大时下滑关闭');
  assert.ok(lb.includes('280'), '单击缩放需要 280ms 双击判定窗口');

  // ── 服务端：素材架移动对 viewer 开放，但仍是登录守卫（未降低权限）──
  const api = read('src/api.js');
  assert.ok(api.includes("['POST', /^\\/assets\\/shelf$/]"), 'viewer 白名单必须包含素材架移动');
  const shelfHandler = api.slice(api.indexOf("pathname === '/assets/shelf'"));
  assert.ok(shelfHandler.includes('isViewerOrAdmin'), '素材架处理器必须保持登录守卫');

  console.log('✔ P2 浏览/详情验收通过（收藏·素材架·瀑布流·日期气泡·切图·手势）');
}

try {
  main();
} catch (err) {
  console.error(err);
  process.exit(1);
}
