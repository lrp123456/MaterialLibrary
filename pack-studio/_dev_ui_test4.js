/**
 * _dev_ui_test4.js · 第四轮：纯坐标 + 截图驱动
 *
 * 为什么不用 uiautomator：uni-app App 端跑在 Weex/原生 WebView 里，
 * 大部分 view 不进无障碍树（实测 dump 出来 0 个节点）。只能靠截图 + 固定坐标。
 * 屏幕 720x1280。
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
let N = 200;
function shot(name) {
  N++;
  const f = path.join(SHOTS, N + '_' + name + '.png');
  try {
    sh('screencap -p /sdcard/_s.png');
    fs.writeFileSync(f, adb(['exec-out', 'cat', '/sdcard/_s.png'], 'buffer'));
    sh('rm -f /sdcard/_s.png');
    console.log('   📷 ' + path.basename(f));
    return f;
  } catch (e) { console.log('   📷 失败'); return ''; }
}
function tap(x, y, tag) { sh(`input tap ${x} ${y}`); console.log(`   👆 ${tag} @${x},${y}`); sleep(1200); }
function swipe(x1, y1, x2, y2, ms) { sh(`input swipe ${x1} ${y1} ${x2} ${y2} ${ms || 300}`); }

function logD(tag) {
  const b = adb(['logcat', '-d', '-v', 'time'], 'utf8');
  const f = path.join(SHOTS, 'logcat_' + tag + '.txt');
  fs.writeFileSync(f, b, 'utf8');
  const L = b.split(/\r?\n/).filter((l) => /JSException|no such column|HTTP 500|ViewerApi|UniError|AppUpdater/.test(l));
  console.log('   📄 ' + path.basename(f) + ' 命中 ' + L.length);
  L.slice(0, 12).forEach((l) => console.log('      ' + l.slice(0, 190)));
  return L;
}

(async () => {
  console.log('══════ A. 回顶按钮（坐标法）══════\n');
  sh(`am force-stop ${PKG}`); adb(['logcat', '-c']); sleep(1500);
  sh(`am start -n ${PKG}/io.dcloud.PandoraEntryActivity -a android.intent.action.MAIN -c android.intent.category.LAUNCHER`);
  sleep(13000);
  shot('A0_top');

  // 记录滚动前右上角区域像素（回顶按钮初始 opacity 0.28，几乎不可见）
  console.log('滚动前 → 截图 A0_top，回顶按钮应在 top≈69px right≈14px 但几乎透明');

  console.log('\n上滑 5 次（每次 750px）…');
  for (let i = 0; i < 5; i++) { swipe(360, 1000, 360, 250, 200); sleep(450); }
  sleep(1500);
  shot('A1_scrolled');
  console.log('   截图 A1_scrolled —— 回顶按钮应完全不透明地出现在右上角');

  // 点击回顶（top:96rpx, right:20rpx, 尺寸约 72rpx → 720宽: 96*0.72=69, 20*0.72=14, 72*0.72=52）
  // 中心约 (720-14-26, 96+26) = (680, 96+?) → 实测按 top≈96 中心 y≈122
  console.log('\n点击回顶按钮 @680,122');
  tap(680, 122, '回顶');
  sleep(2200);
  shot('A2_after_backtop');
  console.log('   截图 A2_after_backtop —— 应回到列表顶部（第一张卡片完整可见、日期分组在顶部）');

  console.log('\n══════ B. 分类下拉 → 回收站 ══════\n');
  // 「图片 ▾」在 y≈139, x≈57
  tap(57, 139, '分类下拉「图片▾」');
  sleep(1500);
  shot('B0_cat_dropdown');
  console.log('   截图 B0_cat_dropdown');

  // 回收站在下拉里。上一轮实测点它之后进入了回收站且 tab 变成「回收站▾」，
  // 说明它在 x≈75, y≈139 附近。用同一位置验证。
  console.log('\n   已知上一轮点 (75,139) 进入了回收站 —— 先截图确认下拉布局');
  tap(75, 139, '下拉第一项');
  sleep(3000);
  shot('B1_after_first_item');
  console.log('   截图 B1_after_first_item');

  logD('A_B');

  console.log('\n══════ C. 素材详情 → 删除 ══════\n');
  // 先回素材库：点 tab「素材库」在 (238, 64)
  tap(238, 64, '顶部「素材库」tab');
  sleep(2500);
  shot('C0_back_to_lib');
  console.log('   截图 C0_back_to_lib');

  // 点第一张素材卡中心 (162, 510)
  tap(162, 510, '第一张素材卡');
  sleep(4500);
  shot('C1_detail');
  console.log('   截图 C1_detail —— 素材详情页');

  logD('C');
  console.log('\n完成。截图: ' + SHOTS);
})().catch((e) => console.log('FATAL ' + e.message));
