/**
 * _dev_ui_test5.js · 第五轮：精确坐标重测回顶 + 删除
 * 修正：回顶按钮实际中心 ≈ (667, 210)，不是 (680,122)
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');
const ADB = 'C:\\Users\\lrp\\Downloads\\HBuilderX\\plugins\\launcher-tools\\tools\\adbs\\adb.exe';
const S = '127.0.0.1:21503';
const PKG = 'lrp.aibum';
const SHOTS = path.join('C:\\Users\\lrp\\DevEcoStudioProjects\\MaterialLibraryServer\\pack-studio', '_shots');
const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
function adb(a, e) { return execFileSync(ADB, ['-s', S, ...a], { encoding: e || 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 120000 }); }
function sh(c) { try { return adb(['shell', c]).trim(); } catch (e) { return ''; } }
let N = 300;
function shot(n) { N++; const f = path.join(SHOTS, N + '_' + n + '.png');
  try { sh('screencap -p /sdcard/_s.png'); fs.writeFileSync(f, adb(['exec-out','cat','/sdcard/_s.png'],'buffer')); sh('rm -f /sdcard/_s.png'); console.log('   📷 ' + path.basename(f)); } catch (e) { console.log('   📷 失败'); } return f; }
function tap(x, y, t) { sh(`input tap ${x} ${y}`); console.log(`   👆 ${t} @${x},${y}`); }
function swipe(a, b, c, d, e) { sh(`input swipe ${a} ${b} ${c} ${d} ${e || 300}`); }
function logD(t) { const b = adb(['logcat','-d','-v','time'],'utf8');
  const f = path.join(SHOTS,'logcat_'+t+'.txt'); fs.writeFileSync(f,b,'utf8');
  const L = b.split(/\r?\n/).filter(l=>/JSException|no such column|HTTP 500|ViewerApi|UniError/.test(l));
  console.log('   📄 '+path.basename(f)+' 命中 '+L.length); L.slice(0,12).forEach(l=>console.log('      '+l.slice(0,190))); }

(async () => {
  console.log('══════ A. 回顶按钮（精确坐标）══════\n');
  sh(`am force-stop ${PKG}`); adb(['logcat','-c']); sleep(1500);
  sh(`am start -n ${PKG}/io.dcloud.PandoraEntryActivity -a android.intent.action.MAIN -c android.intent.category.LAUNCHER`);
  sleep(13000);
  shot('A0_top');
  console.log('滚动前状态已截图（回顶按钮 opacity≈0.28，应几乎看不见）');

  console.log('\n上滑 5 次…');
  for (let i=0;i<5;i++){ swipe(360,1000,360,250,200); sleep(450); }
  sleep(1500);
  shot('A1_scrolled');
  console.log('   回顶按钮（↑ @约667,210）应完全不透明');

  console.log('\n点击回顶 @667,210');
  tap(667, 210, '回顶');
  sleep(2500);
  shot('A2_after');
  console.log('   应回到列表顶部：日期分组「昨天·10月2日 40项」重新出现在顶部');

  console.log('\n══════ B. 回收站（分类下拉）══════\n');
  tap(57, 139, '分类「图片▾」');
  sleep(1800);
  shot('B0_dropdown');
  console.log('   下拉展开截图');
  // 下拉里逐项点：上一轮 (75,139) 直接进了回收站 —— 那是「回收站」chip？
  // 实际观察：点完 (57,139) 后 tab 变成「回收站▾」，说明 (57,139) 就是回收站 tab
  console.log('\n   观察：点 (57,139) 后 tab 变「回收站▾」→ 说明它直接切到了回收站');
  sleep(3000);
  shot('B1_trash');
  logD('B');

  console.log('\n══════ C. 删除：素材库 → 详情 ══════\n');
  tap(238, 64, '「素材库」tab');
  sleep(2500);
  shot('C0_lib');
  console.log('   点第一张卡片 (162,510)');
  tap(162, 510, '第一张素材');
  sleep(5000);
  shot('C1_detail');
  logD('C');
  console.log('\n完成。截图: ' + SHOTS);
})().catch(e => console.log('FATAL ' + e.message));
