/**
 * _dev_ui_test2.js · 第二轮：真实点击交互测试
 *  720x1280 分辨率（前面按 1080x2400 算的坐标全错）
 *  A. 打开「图片 ▾」分类下拉 → 验证「回收站」入口存在 → 进入回收站
 *  B. 回顶按钮：上滑 → 出现 → 点击 → 回到顶部
 *  C. 删除：进入详情 → 删除 → 列表即时移除 → 回收站出现记录与原因
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ADB = 'C:\\Users\\lrp\\Downloads\\HBuilderX\\plugins\\launcher-tools\\tools\\adbs\\adb.exe';
const S = '127.0.0.1:21503';
const PKG = 'lrp.aibum';
const SHOTS = path.join('C:\\Users\\lrp\\DevEcoStudioProjects\\MaterialLibraryServer\\pack-studio', '_shots');
if (!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS, { recursive: true });

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
function adb(a, e) { return execFileSync(ADB, ['-s', S, ...a], { encoding: e || 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 120000 }); }
function sh(c) { try { return adb(['shell', c]).trim(); } catch (e) { return ''; } }

let N = 0;
function shot(name) {
  N++;
  const f = path.join(SHOTS, String(N).padStart(2, '0') + '_' + name + '.png');
  try {
    sh('screencap -p /sdcard/_s.png');
    fs.writeFileSync(f, adb(['exec-out', 'cat', '/sdcard/_s.png'], 'buffer'));
    sh('rm -f /sdcard/_s.png');
    console.log('   📷 ' + path.basename(f));
  } catch (e) { console.log('   📷 失败 ' + e.message.split('\n')[0]); }
  return f;
}
function ui() {
  sh('rm -f /sdcard/_ui.xml');
  sh('uiautomator dump /sdcard/_ui.xml 2>/dev/null');
  const xml = sh('cat /sdcard/_ui.xml');
  if (!xml || xml.indexOf('<hierarchy') < 0) return [];
  const out = [];
  const re = /<node[^>]*?>/g; let m;
  while ((m = re.exec(xml))) {
    const s = m[0];
    const at = (k) => { const r = new RegExp(k + '="([^"]*)"'); const mm = s.match(r); return mm ? mm[1] : ''; };
    const b = at('bounds').match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
    out.push({
      text: at('text'), desc: at('content-desc'), cls: at('class'), bounds: at('bounds'),
      x: b ? +b[1] : 0, y: b ? +b[2] : 0, w: b ? +b[3] - +b[1] : 0, h: b ? +b[4] - +b[2] : 0,
    });
  }
  return out;
}
const label = (n) => n.text || n.desc || n.cls;
const texts = (ns) => ns.filter((n) => n.text || n.desc).map(label);
function find(ns, kw) { return ns.find((n) => (n.text || '').includes(kw) || (n.desc || '').includes(kw)); }
function tapNode(n, tag) {
  if (!n) { console.log('   ✗ ' + tag + ' 找不到'); return false; }
  const cx = n.x + Math.floor(n.w / 2), cy = n.y + Math.floor(n.h / 2);
  sh(`input tap ${cx} ${cy}`);
  console.log(`   👆 ${tag}: "${label(n)}" @${cx},${cy}`);
  return true;
}
function tapXY(x, y, tag) { sh(`input tap ${x} ${y}`); console.log(`   👆 ${tag} @${x},${y}`); }
function swipe(x1, y1, x2, y2, ms) { sh(`input swipe ${x1} ${y1} ${x2} ${y2} ${ms || 300}`); }
function logD(tag) {
  const b = adb(['logcat', '-d', '-v', 'time'], 'utf8');
  const f = path.join(SHOTS, 'logcat_' + tag + '.txt');
  fs.writeFileSync(f, b, 'utf8');
  const L = b.split(/\r?\n/).filter((l) => /JSException|AppUpdater|ViewerApi|ViewerCache|HomeLibrary|UniError|报错|异常/.test(l));
  console.log('   📄 ' + path.basename(f) + ' 命中 ' + L.length);
  L.slice(0, 20).forEach((l) => console.log('      ' + l));
}
const size = (() => {
  const m = sh('wm size').match(/(\d+)x(\d+)/);
  return m ? { w: +m[1], h: +m[2] } : { w: 720, h: 1280 };
})();
console.log('屏幕: ' + size.w + 'x' + size.h + '\n');

(async () => {
  console.log('══════ 步骤 1：打开「图片 ▾」分类下拉 ══════');
  let ns = ui();
  const catBtn = find(ns, '图片');
  tapNode(catBtn, '分类下拉');
  sleep(1500);
  shot('cat_dropdown');
  ns = ui();
  const opts = ns.filter((n) => n.y > 100 && n.y < 700 && (n.text || n.desc));
  console.log('下拉里的选项:');
  opts.forEach((n) => console.log('   ' + label(n) + ` @${n.x},${n.y} ${n.w}x${n.h}`));

  const allTabs = ['全部', '图片', '视频', '音频', '精修图', '回收站'];
  console.log('\n分类项检查:');
  allTabs.forEach((k) => {
    const f = find(ns, k);
    console.log((f ? '   ✓ ' : '   ✗ ') + k + (f ? ` @${f.x},${f.y}` : ' 未找到'));
  });

  console.log('\n══════ 步骤 2：进入回收站 ══════');
  const trash = find(ns, '回收站');
  if (tapNode(trash, '回收站')) {
    sleep(3000);
    shot('trash_tab');
    ns = ui();
    console.log('回收站页可见文本:');
    texts(ns).slice(0, 40).forEach((t) => console.log('   ' + t));
    const srcBar = ns.filter((n) => /全部|手动|自动|过期|清理/.test(label(n)) && n.y < 500);
    console.log('\n来源筛选条: ' + (srcBar.length ? srcBar.map(label).join(' | ') : '(无 —— 回收站为空或筛选条未显示)'));
  }

  console.log('\n══════ 步骤 3：回顶按钮 ══════');
  // 回到素材库
  const back = find(ns, '图片') || find(ns, '全部');
  if (back) { tapNode(back, '切回素材库'); sleep(2000); }

  console.log('   上滑 5 次…');
  for (let i = 0; i < 5; i++) { swipe(360, 950, 360, 300, 220); sleep(400); }
  sleep(1000);
  shot('scrolled');
  ns = ui();
  // 回顶按钮是纯 view + ↑ 文本，可能没有 content-desc
  const up = ns.filter((n) => /↑|回顶|top/i.test((n.text || '') + (n.desc || '')));
  console.log('   回顶按钮候选: ' + (up.length ? up.map((n) => `${label(n)}@${n.x},${n.y} ${n.w}x${n.h}`).join(' | ') : '(未在无障碍树中找到，可能未渲染)'));

  // 从截图右上角区域找：top:96rpx right:20rpx → 720宽下 rpx=0.72 → top≈69px, right≈14px
  console.log('   右上角区域元素 (y<200, x>600):');
  ns.filter((n) => n.y < 200 && n.x > 600 && (n.text || n.desc || n.cls)).forEach((n) =>
    console.log('      ' + n.clc + ' "' + label(n) + `" @${n.x},${n.y} ${n.w}x${n.h}`));

  logD('step3');
  console.log('\n完成。截图目录: ' + SHOTS);
})().catch((e) => console.log('FATAL ' + e.message + '\n' + (e.stack || '')));
