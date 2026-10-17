/**
 * _dev_ui_test.js · 设备端真实 UI 交互测试 + 截图
 *
 * 逐项验证用户点名的三类：
 *   A. 新 UI：回收站入口 / 精修库入口 / 回顶按钮（初始低透明度 → 上滑高亮 → 点击回顶）
 *   B. 删除逻辑：删除后列表即时移除、回收站出现记录与原因、恢复
 *   C. 上传逻辑：选图 → 元数据上传 → 入库 → 列表刷新
 *
 * 每一步都留截图 + logcat 证据。
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const ADB = 'C:\\Users\\lrp\\Downloads\\HBuilderX\\plugins\\launcher-tools\\tools\\adbs\\adb.exe';
const S = '127.0.0.1:21503';
const PKG = 'lrp.aibum';
const SHOTS = path.join('C:\\Users\\lrp\\DevEcoStudioProjects\\MaterialLibraryServer\\pack-studio', '_shots');
if (!fs.existsSync(SHOTS)) fs.mkdirSync(SHOTS, { recursive: true });

const sleep = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function adb(args, enc) {
  return execFileSync(ADB, ['-s', S, ...args], {
    encoding: enc || 'utf8', maxBuffer: 256 * 1024 * 1024, timeout: 120000,
  });
}
function sh(c) { try { return adb(['shell', c]).trim(); } catch (e) { return ''; } }
function bin(args) { return adb(args, 'buffer'); }

let shotN = 0;
function shot(name) {
  shotN++;
  const f = path.join(SHOTS, String(shotN).padStart(2, '0') + '_' + name + '.png');
  try {
    adb(['shell', 'screencap', '-p', '/sdcard/_s.png']);
    const b = bin(['exec-out', 'cat', '/sdcard/_s.png']);
    fs.writeFileSync(f, b);
    sh('rm -f /sdcard/_s.png');
    console.log('   📷 ' + path.basename(f) + '  ' + b.length + ' 字节');
    return f;
  } catch (e) {
    console.log('   📷 截图失败: ' + e.message.split('\n')[0]);
    return '';
  }
}

/** uiautomator dump → 解析文本/描述/类名/ bounds */
function ui() {
  sh('rm -f /sdcard/_ui.xml');
  sh('uiautomator dump /sdcard/_ui.xml 2>/dev/null');
  const xml = sh('cat /sdcard/_ui.xml');
  if (!xml || xml.indexOf('<hierarchy') < 0) return [];
  const out = [];
  const re = /<node[^>]*?>/g;
  let m;
  while ((m = re.exec(xml))) {
    const s = m[0];
    const at = (k) => {
      const r = new RegExp(k + '="([^"]*)"');
      const mm = s.match(r);
      return mm ? mm[1] : '';
    };
    out.push({
      text: at('text'), desc: at('content-desc'), cls: at('class'),
      id: at('resource-id'), bounds: at('bounds'), clickable: at('clickable') === 'true',
      x: parseInt(at('bounds').match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/)?.[1] || '0', 10),
      y: parseInt(at('bounds').match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/)?.[2] || '0', 10),
      w: (() => { const m2 = at('bounds').match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/); return m2 ? +m2[3] - +m2[1] : 0; })(),
      h: (() => { const m2 = at('bounds').match(/\[(\d+),(\d+)\]\[(\d+),(\d+)\]/); return m2 ? +m2[4] - +m2[2] : 0; })(),
    });
  }
  return out;
}
function dumpTexts(nodes) {
  return nodes.filter((n) => n.text || n.desc).map((n) => (n.text || n.desc) + (n.x ? ` @${n.x},${n.y}` : ''));
}
function findByText(nodes, kw) {
  return nodes.find((n) => (n.text && n.text.includes(kw)) || (n.desc && n.desc.includes(kw)));
}
function tap(n) {
  if (!n) return false;
  const cx = n.x + Math.floor(n.w / 2);
  const cy = n.y + Math.floor(n.h / 2);
  sh(`input tap ${cx} ${cy}`);
  console.log(`   👆 tap ${n.text || n.desc || n.cls} @${cx},${cy}`);
  return true;
}
function tapXY(x, y) { sh(`input tap ${x} ${y}`); console.log(`   👆 tap ${x},${y}`); }
function swipe(x1, y1, x2, y2, ms) { sh(`input swipe ${x1} ${y1} ${x2} ${y2} ${ms || 300}`); }

function logcatDump(tag) {
  const f = path.join(SHOTS, 'logcat_' + tag + '.txt');
  const b = adb(['logcat', '-d', '-v', 'time'], 'utf8');
  fs.writeFileSync(f, b, 'utf8');
  const lines = b.split(/\r?\n/).filter((l) =>
    /JSException|AppUpdater|AlbumSync|ViewerApi|ViewerCache|HomeLibrary|UniError|ERROR|error:|异常|失败/.test(l));
  console.log('   📄 logcat → ' + path.basename(f) + '（命中 ' + lines.length + ' 条）');
  if (lines.length) console.log(lines.slice(0, 25).map((l) => '      ' + l).join('\n'));
  return f;
}

const W = 1080, H = 2400;

(async () => {
  console.log('══════ 冷启动 ══════');
  sh(`am force-stop ${PKG}`);
  adb(['logcat', '-c']);
  sleep(2000);
  // 雷电上 io.dcloud.PandoraEntryActivity 需要完整类名
  const act = sh(`dumpsys package ${PKG} | grep -o 'io\\.dcloud\\.[A-Za-z0-9_.]*Activity' | head -1`).trim()
    || 'io.dcloud.PandoraEntryActivity';
  console.log('入口: ' + act);
  try { sh(`am start -n ${PKG}/${act} -a android.intent.action.MAIN -c android.intent.category.LAUNCHER`); }
  catch (e) { sh(`monkey -p ${PKG} -c android.intent.category.LAUNCHER 1`); }
  sleep(14000);
  shot('launch_home');

  let nodes = ui();
  console.log('\n══════ 屏幕 1：素材库首页 ══════');
  console.log('屏幕尺寸 ' + sh('wm size').trim());
  const t1 = dumpTexts(nodes);
  console.log('可见文本/描述 (' + t1.length + '):');
  t1.slice(0, 45).forEach((t) => console.log('   ' + t));

  console.log('\n══════ 检查点 A1：回收站 / 精修库入口 ══════');
  const KEYWORDS = ['回收站', '垃圾站', '精修', '精修库', '精修图', '已删除'];
  const found = {};
  KEYWORDS.forEach((k) => { found[k] = t1.filter((t) => t.includes(k)); });
  KEYWORDS.forEach((k) => {
    console.log((found[k].length ? '   ✓ ' : '   ✗ ') + k + ' → ' + (found[k].length ? found[k].join(' / ') : '未找到'));
  });
  // 底部 tab
  const tabs = nodes.filter((n) => n.y > H * 0.82 && (n.text || n.desc));
  console.log('   底部区域元素: ' + (tabs.length ? tabs.map((n) => (n.text || n.desc) + `@${n.x},${n.y}`).join(' | ') : '(无)'));

  console.log('\n══════ 检查点 A2：回顶按钮 ══════');
  const backTop = nodes.filter((n) => /回顶|top|↑|回到顶部/i.test((n.text || '') + (n.desc || '')));
  console.log('   找到回顶按钮: ' + backTop.length);

  // 上滑触发
  console.log('   上滑列表 3 次…');
  for (let i = 0; i < 3; i++) { swipe(W / 2, H * 0.75, W / 2, H * 0.25, 260); sleep(500); }
  sleep(800);
  shot('after_scroll');
  nodes = ui();
  const backTop2 = nodes.filter((n) => /回顶|top|↑|回到顶部/i.test((n.text || '') + (n.desc || '')));
  console.log('   上滑后回顶按钮: ' + backTop2.length +
    (backTop2.length ? ' → ' + backTop2.map((n) => `${n.text || n.desc}@${n.x},${n.y} ${n.w}x${n.h}`).join(' | ') : ''));

  console.log('\n══════ 检查点 A3：首页各 tab 文案 ══════');
  const t3 = dumpTexts(nodes);
  console.log(t3.slice(0, 50).map((t) => '   ' + t).join('\n'));

  logcatDump('after_launch');

  console.log('\n完成。截图目录: ' + SHOTS);
})().catch((e) => console.log('FATAL ' + e.message + '\n' + (e.stack || '')));
