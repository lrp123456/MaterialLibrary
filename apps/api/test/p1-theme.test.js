/**
 * P1 视觉语言门禁：主题令牌模块 + 三页接线 + 返回键关弹层。
 *
 * theme.js 可在 Node 下直接执行（无 uni 时回退默认暖色、storage 写入为 no-op），
 * 页面接线仍用精确锚点断言，防止后续重构把主题打回死代码。
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const root = path.join(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');

function main() {
  const theme = require('../app-uniapp/src/common/theme');

  // ── 调色板：暖色为默认，冷灰可切，颜色值来自冻结原型 ──
  assert.strictEqual(theme.DEFAULT_THEME, 'warm');
  assert.deepStrictEqual(theme.THEME_KEYS.sort(), ['cool', 'warm']);
  assert.strictEqual(theme.PALETTES.warm.bg, '#F2EEE6');
  assert.strictEqual(theme.PALETTES.warm.accent, '#0A6CFF');
  assert.strictEqual(theme.PALETTES.cool.bg, '#F1F4F8');

  // ── 动效 token：三条曲线与三档时长 ──
  assert.strictEqual(theme.MOTION.easeOut, 'cubic-bezier(.23,1,.32,1)');
  assert.strictEqual(theme.MOTION.easeInOut, 'cubic-bezier(.77,0,.175,1)');
  assert.strictEqual(theme.MOTION.easeDrawer, 'cubic-bezier(.32,.72,0,1)');
  assert.deepStrictEqual(
    [theme.MOTION.fast, theme.MOTION.base, theme.MOTION.slow],
    [140, 220, 320]
  );
  assert.deepStrictEqual(theme.RADIUS, { topbar: '30px', card: '12px', sheet: '24px', pill: '999px' });
  assert.strictEqual(theme.SPACE.waterfall, '8px');

  // ── CSS 变量：warm/cool 各自成组，切换后立即生效 ──
  const warm = theme.cssVars('warm');
  const cool = theme.cssVars('cool');
  assert.strictEqual(warm['--bg'], '#F2EEE6');
  assert.strictEqual(cool['--bg'], '#F1F4F8');
  assert.strictEqual(warm['--accent'], '#0A6CFF');
  assert.strictEqual(warm['--cardr'], '12px');
  assert.strictEqual(warm['--topr'], '30px');
  assert.strictEqual(warm['--gap'], '8px');
  assert.strictEqual(warm['--ease-drawer'], 'cubic-bezier(.32,.72,0,1)');
  assert.ok(warm['--glass-bg'].startsWith('rgba('), '玻璃底必须是不透明可叠的 rgba');

  assert.strictEqual(theme.themeState.name, 'warm', '无持久化时默认暖色');
  theme.setTheme('cool');
  assert.strictEqual(theme.currentVars()['--bg'], '#F1F4F8', '切换主题后 currentVars 必须跟随');
  theme.setTheme('dark');
  assert.strictEqual(theme.currentVars()['--bg'], '#F1F4F8', '未注册主题名必须被忽略');
  theme.setTheme('warm');

  // ── 页面接线：根节点注入变量，样式消费 token ──
  for (const rel of [
    'app-uniapp/src/pages/browse/browse.vue',
    'app-uniapp/src/pages/detail/detail.vue',
    'app-uniapp/src/pages/settings/settings.vue',
  ]) {
    const src = read(rel);
    assert.ok(src.includes(':style="themeStyle"'), `${rel} 根节点必须绑定 themeStyle`);
    assert.ok(src.includes("from '../../common/theme'"), `${rel} 必须从公共主题模块取色`);
    assert.ok(src.includes('currentVars()'), `${rel} themeStyle 必须返回 currentVars()`);
    assert.ok(/var\(--bg/.test(src), `${rel} 必须用 var(--bg) 消费底色`);
  }

  const settings = read('app-uniapp/src/pages/settings/settings.vue');
  assert.ok(settings.includes("key: 'warm'") && settings.includes("key: 'cool'"), '设置页必须提供暖色/冷灰两档');
  assert.ok(settings.includes('setTheme(name)'), '设置页切换必须调用 setTheme 持久化');

  // ── 返回栈：两页返回键优先关闭弹层 ──
  const browse = read('app-uniapp/src/pages/browse/browse.vue');
  const browseBack = browse.slice(browse.indexOf('onBackPress()'));
  assert.ok(browseBack.includes('this.filterDrawerOpen'), '浏览页返回键必须能关筛选抽屉');
  assert.ok(browseBack.includes('this.showMediaTypeMenu'), '浏览页返回键必须能关类型气泡');
  const detail = read('app-uniapp/src/pages/detail/detail.vue');
  const detailBack = detail.slice(detail.indexOf('onBackPress()'));
  assert.ok(detailBack.includes('this.lightboxVisible'), '详情页返回键必须能关大图预览');

  console.log('✔ P1 视觉语言验收通过（主题令牌 + 三页接线 + 返回栈）');
}

try {
  main();
} catch (err) {
  console.error(err);
  process.exit(1);
}
