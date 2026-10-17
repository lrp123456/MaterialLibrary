/**
 * 离线验证 snapshotPointer / rollbackPointer 的参数组装与保护逻辑。
 * **不连任何真实服务器**：全部用本地假 HTTP 服务，验证到点即止。
 *
 * 验证点：
 *  1. 探测参数必须是 versionCode=0&wgtVersion=0（否则拿不到 url）
 *  2. 快照字段与服务端 checkUpdate 返回对齐（url/versionCode/wgtVersion/...）
 *  3. 快照落盘到 state/push-snapshots/latest-<channel>.json
 *  4. 拿不到 url 时必须抛错中止（不能静默推）
 *  5. 回滚走 POST /api/app/body（body 传参，不是 query）
 *  6. 401 时快照即失败 → 推送被拦住
 */
const http = require('http');
const fs = require('fs');
const path = require('path');

const { snapshotPointer, rollbackPointer } = require('./lib/push-update.js');

let pass = 0;
let fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('  PASS  ' + name); }
  else { fail++; console.log('  FAIL  ' + name + (extra ? '  <- ' + extra : '')); }
}

let seenUrl = '';
let seenBody = null;
let seenMethod = '';
let server = null;

function startFake(port) {
  return new Promise((resolve) => {
    server = http.createServer((req, res) => {
      seenUrl = req.url;
      seenMethod = req.method;
      let b = '';
      req.on('data', (c) => (b += c));
      req.on('end', () => {
        seenBody = b;
        if (req.method === 'GET') {
          // 模拟服务端 checkUpdate：完整指针含 url
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(
            JSON.stringify({
              success: true,
              data: {
                hasUpdate: true,
                type: 'wgt',
                versionCode: 2030005,
                versionName: '1.0.3',
                wgtVersion: '2030005',
                note: '线上原来的包',
                url: 'http://fake/api/app/update/files/app-2030005-ok.wgt',
              },
            })
          );
        } else {
          res.writeHead(200, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ success: true, data: { restored: true } }));
        }
      });
    });
    server.listen(port, '127.0.0.1', resolve);
  });
}

(async () => {
  await startFake(39117);
  const base = 'http://127.0.0.1:39117';

  console.log('\n=== 1. 快照：探测参数与字段 ===');
  const snap = await snapshotPointer({ server: base, token: 'tk', channel: 'internal', onLog: () => {} });
  check('探测用 versionCode=0&wgtVersion=0', /versionCode=0/.test(seenUrl) && /wgtVersion=0/.test(seenUrl), seenUrl);
  check('探测带 channel', /channel=internal/.test(seenUrl), seenUrl);
  check('快照拿到 url', snap.url === 'http://fake/api/app/update/files/app-2030005-ok.wgt', snap.url);
  check('快照 fileName 从 url 解析', snap.fileName === 'app-2030005-ok.wgt', snap.fileName);
  check('快照 versionCode 为数字', snap.versionCode === 2030005, String(snap.versionCode));
  check('快照 wgtVersion 为字符串', snap.wgtVersion === '2030005', snap.wgtVersion);
  check('快照 type=wgt', snap.type === 'wgt', snap.type);
  check('快照记录了 note', snap.note === '线上原来的包', snap.note);

  console.log('\n=== 2. 快照落盘 ===');
  const sf = path.join(__dirname, 'state', 'push-snapshots', 'latest-internal.json');
  check('快照文件已落盘', fs.existsSync(sf), sf);
  if (fs.existsSync(sf)) {
    const j = JSON.parse(fs.readFileSync(sf, 'utf8'));
    check('落盘内容含 url', j.url === snap.url, j.url);
    check('落盘含 at 时间戳', !!j.at, j.at);
  }

  console.log('\n=== 3. 回滚：路由与传参方式 ===');
  const rb = await rollbackPointer({ server: base, token: 'tk', channel: 'internal', snapshot: snap, onLog: () => {} });
  check('回滚成功', rb.ok === true, rb.error);
  check('回滚用 POST /api/app/update', seenMethod === 'POST' && /\/api\/app\/update$/.test(seenUrl), seenMethod + ' ' + seenUrl);
  check('不是 /publish（旧写法的坑）', !/publish/.test(seenUrl), seenUrl);
  let body = {};
  try { body = JSON.parse(seenBody); } catch (e) {}
  check('回滚参数在 body 里', body && body.url === snap.url, seenBody);
  check('回滚带原 wgtVersion', body.wgtVersion === '2030005', body.wgtVersion);
  check('回滚带原 versionCode', body.versionCode === 2030005, body.versionCode);
  check('回滚备注标注 [回滚]', /^\[回滚\]/.test(body.note || ''), body.note);
  check('回滚 type 保持原样', body.type === 'wgt', body.type);

  console.log('\n=== 4. 保护：拿不到 url 必须抛错 ===');
  // 换成「本地已是最新」的假服务端：那条分支不返回 url
  await new Promise((r) => server.close(r));
  await new Promise((resolve) => {
    server = http.createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      // 复刻 app-update.js:133 local_up_to_date 分支：没有 url
      res.end(JSON.stringify({ success: true, data: { hasUpdate: false, latestVersionName: '1.0.3', latestVersionCode: 2030005 } }));
    });
    server.listen(39118, '127.0.0.1', resolve);
  });
  let threw = null;
  try {
    await snapshotPointer({ server: 'http://127.0.0.1:39118', token: 'tk', channel: 'internal', onLog: () => {} });
  } catch (e) { threw = e; }
  check('无 url 时抛错（阻止推送）', !!threw, threw ? '' : '没有抛错 —— 会静默推出去');
  check('错误信息说明是无法建立回滚基线', threw && /无法建立回滚基线/.test(threw.message), threw ? threw.message : '');

  console.log('\n=== 5. 保护：HTTP 失败也必须抛错 ===');
  await new Promise((r) => server.close(r));
  await new Promise((resolve) => {
    server = http.createServer((req, res) => { res.writeHead(503); res.end('busy'); });
    server.listen(39119, '127.0.0.1', resolve);
  });
  let threw2 = null;
  try {
    await snapshotPointer({ server: 'http://127.0.0.1:39119', token: 'tk', channel: 'internal', onLog: () => {} });
  } catch (e) { threw2 = e; }
  check('HTTP 503 时抛错', !!threw2, threw2 ? '' : '没抛错');
  check('错误含 HTTP 503', threw2 && /503/.test(threw2.message), threw2 ? threw2.message : '');

  await new Promise((r) => server.close(r));

  console.log('\n========================================');
  console.log('  PASS ' + pass + ' / FAIL ' + fail);
  console.log('========================================');
  process.exit(fail ? 1 : 0);
})().catch((e) => {
  console.error('测试脚本自身异常:', e);
  try { server.close(); } catch (_) {}
  process.exit(1);
});