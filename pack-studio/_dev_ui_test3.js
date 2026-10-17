/**
 * _dev_ui_test3.js · 第三轮：回顶按钮 + 删除逻辑 实测
 * 已知：回收站接口 500（服务端 SQL bug 已修，待部署），本轮聚焦不依赖它的功能
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
let N = 100;
function shot(name) {
  N++;
  const f = path.join(SHOTS, N + '_' + name + '.png');
  try {
    sh('screencap -p /sdcard/_s.png');
    fs.writeFileSync(f, adb(['exec-out', 'cat', '/sdcard/_s.png'], 'buffer'));
    sh('rm -f /sdcard/_s.png');
    console.log('   📷 ' + path.basename(f));
  } catch (e) { console.log('   📷 失败'); }
  return f;
}
function ui() {
  sh('rm -f /sdcard/_ui.xml');
  sh('uiautomator dump /sdcard/_ui.xml 2>/dev/null');
  const xml = sh('cat /sdcard/_ui.xml');
  if (!xml || xml.indexOf('<hierarchy') < 0) return [];
  const out = []; const re = /<node[^>]*?>/g; let m;
  while ((m = re.exec(xml))) {
    const s = m[0];
    const at = (k) => { const r = new RegExp(k + '="([^"]*)"'); const mm = s.match(r); return mm ? mm[1] : ''; };
    const b = at('bounds').match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/);
    out.push({ text: at('text'), desc: at('content-desc'), cls: at('class'),
      x: b ? +b[1] : 0, y: b ? +b[2] : 0, w: b ? +b[3] - +b[1] : 0, h: b ? +b[4] - +b[2] : 0 });
  }
  return out;
}
const label = (n) => n.text || n.desc || n.cls;
function find(ns, kw) { return ns.find((n) => (n.text || '').includes(kw) || (n.desc || '').includes(kw)); }
function tapNode(n, tag) {
  if (!n) { console.log('   ✗ ' + tag + ' 找不到'); return false; }
  const cx = n.x + Math.floor(n.w / 2), cy = n.y + Math.floor(n.h / 2);
  sh(`input tap ${cx} ${cy}`); console.log(`   👆 ${tag} "${label(n)}" @${cx},${cy}`); return true;
}
function swipe(x1, y1, x2, y2, ms) { sh(`input swipe ${x1} ${y1} ${x2} ${y2} ${ms || 300}`); }
function logD(tag) {
  const b = adb(['logcat', '-d', '-v', 'time'], 'utf8');
  const f = path.join(SHOTS, 'logcat_' + tag + '.txt');
  fs.writeFileSync(f, b, 'utf8');
  const L = b.split(/\r?\n/).filter((l) => /JSException|ViewerApi|ViewerCache|HomeLibrary|UniError|no such column|500|报错/.test(l));
  console.log('   📄 ' + path.basename(f) + ' 命中 ' + L.length);
  L.slice(0, 15).forEach((l) => console.log('      ' + l.slice(0, 200)));
}

(async () => {
  console.log('══════ 重启到素材库 ══════');
  sh(`am force-stop ${PKG}`);
  adb(['logcat', '-c']);
  sleep(1500);
  sh(`am start -n ${PKG}/io.dcloud.PandoraEntryActivity -a android.intent.action.MAIN -c android.intent.category.LAUNCHER`);
  sleep(13000);
  shot('lib_top');

  let ns = ui();
  console.log('\n首屏文本（前 20）:');
  ns.filter((n) => n.text || n.desc).slice(0, 20).forEach((n) => console.log('   ' + label(n) + ` @${n.x},${n.y}`));

  // 先记录列表项数量（用于删除测试）
  const before = ns.filter((n) => /昨天|今天|\d+ 项|精修图 ·/.test(label(n)));
  console.log('\n分组/素材标记: ' + before.slice(0, 8).map(label).join(' | '));

  console.log('\n══════ 测试：回顶按钮 ══════');
  console.log('初始状态（未滚动）应不可见或极低透明度');
  // top:96rpx right:20rpx → 720宽: 96rpx≈69px(top), right≈14px
  const scanTopRight = (tag) => {
    const c = ui().filter((n) => n.y >= 40 && n.y <= 140 && n.x >= 560 && n.w <= 120 && n.w > 0);
    console.log('   ' + tag + ' 右上角小元素: ' + (c.length ? c.map((n) => `${n.cls.split('.').pop()} "${label(n)}" @${n.x},${n.y} ${n.w}x${n.h}`).join(' | ') : '(无)'));
    return c;
  };
  scanTopRight('滚动前');
  shot('backtop_before');

  console.log('\n   上滑 4 次…');
  for (let i = 0; i < 4; i++) { swipe(360, 950, 360, 250, 200); sleep(400); }
  sleep(1200);
  const after = scanTopRight('滚动后');
  shot('backtop_after');
  const bt = after.find((n) => /↑|回顶|top/i.test(label(n)));
  console.log('   ' + (bt ? '✓ 回顶按钮已出现: ' + label(bt) + ` @${bt.x},${bt.y} ${bt.w}x${bt.h}` : '✗ 回顶按钮未在无障碍树中出现'));

  if (bt) {
    console.log('\n   点击回顶…');
    tapNode(bt, '回顶');
    sleep(1800);
    shot('backtop_clicked');
    const top = ui().filter((n) => /昨天|今天|精修图 ·/.test(label(n))).slice(0, 3);
    console.log('   回顶后首屏: ' + top.map(label).join(' | '));
  }

  console.log('\n══════ 测试：删除逻辑 ══════');
  console.log('进入第一个素材详情');
  // 素材卡是 image view，点击图片区域
  const img = ui().find((n) => n.y > 300 && n.y < 1100 && n.w > 200 && n.h > 200);
  if (img) {
    tapNode(img, '第一张素材卡');
    sleep(4000);
    shot('detail');
    ns = ui();
    console.log('详情页文本:');
    ns.filter((n) => n.text || n.desc).slice(0, 30).forEach((n) => console.log('   ' + label(n) + ` @${n.x},${n.y}`));
    const del = ns.find((n) => /删除|移除|回收站|更多/.test(label(n)));
    console.log('\n   删除相关按钮: ' + (ns.filter((n) => /删除|移除|回收站/.test(label(n))).map(label).join(' | ') || '(未找到)'));
    if (del) {
      tapNode(del, '删除');
      sleep(2000);
      shot('after_delete_click');
      const confirm = ui().find((n) => /确定|确认|删除|取消/.test(label(n)));
      console.log('   弹窗: ' + (confirm ? label(confirm) : '(无弹窗)'));
    }
  } else {
    console.log('   ✗ 没找到素材卡');
  }

  logD('round3');
  console.log('\n完成。截图目录: ' + SHOTS);
})().catch((e) => console.log('FATAL ' + e.message));
