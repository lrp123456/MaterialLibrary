const { spawn, execFileSync } = require('child_process');
const adb = 'C:\\Users\\lrp\\Downloads\\HBuilderX\\plugins\\launcher-tools\\tools\\adbs\\adb.exe';
const serial = '3EV0225225010722';
const apkRemote = '/data/local/tmp/album-current.apk';

function sh(args, timeout = 8000) {
  try {
    return execFileSync(adb, ['-s', serial, ...args], { encoding: 'utf8', timeout, windowsHide: true });
  } catch (e) {
    return (e.stdout || '') + (e.stderr || '') + e.message;
  }
}

function tap(x, y) {
  sh(['shell', 'input', 'tap', String(x), String(y)]);
  console.log('tap', x, y);
}

function ui() {
  sh(['shell', 'uiautomator', 'dump', '/data/local/tmp/_ui.xml']);
  return sh(['shell', 'cat', '/data/local/tmp/_ui.xml']);
}

async function main() {
  console.log('start pm install in background');
  const child = spawn(adb, ['-s', serial, 'shell', 'pm', 'install', '-r', '-d', '-t', apkRemote], { windowsHide: true });
  child.stdout.on('data', (d) => process.stdout.write('[pm] ' + d));
  child.stderr.on('data', (d) => process.stdout.write('[pm!] ' + d));

  for (let i = 0; i < 40; i++) {
    await new Promise((r) => setTimeout(r, 1500));
    const pathOut = sh(['shell', 'pm', 'path', 'lrp.aibum']);
    if (pathOut.includes('package:')) {
      console.log('INSTALLED', pathOut.trim());
      break;
    }
    const xml = ui();
    if (xml.includes('hidden_card_checkbox') || xml.includes('继续安装')) {
      console.log('dialog iter', i);
      if (!/hidden_card_checkbox"[^>]*checked="true"/.test(xml) && !/checked="true"[^>]*hidden_card_checkbox/.test(xml)) {
        const m = xml.match(/hidden_card_checkbox"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
        if (m) {
          const cx = Math.round((+m[1] + +m[3]) / 2);
          const cy = Math.round((+m[2] + +m[4]) / 2);
          tap(cx, cy);
          await new Promise((r) => setTimeout(r, 800));
        } else {
          tap(147, 2180);
        }
      }
      const xml2 = ui();
      const enabled = /hidden_card_install_button_continue"[^>]*enabled="true"/.test(xml2)
        || /enabled="true"[^>]*hidden_card_install_button_continue/.test(xml2);
      const bm = xml2.match(/hidden_card_install_button_continue"[^>]*bounds="\[(\d+),(\d+)\]\[(\d+),(\d+)\]"/);
      if (bm) {
        const cx = Math.round((+bm[1] + +bm[3]) / 2);
        const cy = Math.round((+bm[2] + +bm[4]) / 2);
        if (enabled || xml2.includes('继续安装')) {
          tap(cx, cy);
        }
      } else {
        tap(658, 2544);
      }
    }
    if (child.exitCode !== null && i > 2) {
      console.log('pm exited', child.exitCode);
      console.log(sh(['shell', 'pm', 'path', 'lrp.aibum']));
      break;
    }
  }

  await new Promise((r) => setTimeout(r, 3000));
  console.log('final path:', sh(['shell', 'pm', 'path', 'lrp.aibum']).trim());
}

main();
