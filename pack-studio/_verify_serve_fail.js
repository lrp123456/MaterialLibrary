/**
 * 真实服务进程中的编译失败验收：
 * 服务以 FAULT_INJECT=bad-import 启动，每次编译都会在隔离副本里注入 import 错误。
 * 期望：如实报错、退出码非 0、零出包、running 正常释放（不卡死）。
 */
const http = require('http');
const fs = require('fs');

function req(method, p, body) {
  return new Promise((resolve, reject) => {
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const r = http.request(
      { host: '127.0.0.1', port: 3789, path: p, method, headers: data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {} },
      (res) => {
        let d = '';
        res.on('data', (c) => (d += c));
        res.on('end', () => {
          try { resolve({ status: res.statusCode, json: JSON.parse(d) }); }
          catch (e) { resolve({ status: res.statusCode, text: d }); }
        });
      }
    );
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

let pass = 0, fail = 0;
function check(name, cond, extra) {
  console.log((cond ? '  [PASS] ' : '  [FAIL] ') + name + (extra ? '  ' + extra : ''));
  cond ? pass++ : fail++;
}

(async () => {
  const pkgDir = 'C:\\Users\\lrp\\DevEcoStudioProjects\\AlbumSyncUniAppX\\dist\\release\\wgt';
  const snap = () => {
    try { return fs.readdirSync(pkgDir).filter((f) => f.endsWith('.wgt')).sort(); }
    catch (e) { return []; }
  };
  const before = snap();
  console.log('出包目录现有 wgt: ' + before.length + ' 个');

  console.log('\n=== 触发一次必然失败的编译+出包 ===');
  const r = await req('POST', '/api/run', { action: 'pack-wgt', note: '故障验收' });
  check('请求已受理', r.status === 200, JSON.stringify(r.json));

  let sawRunning = false, done = false;
  const t0 = Date.now();
  while (Date.now() - t0 < 300000) {
    const s = await req('GET', '/api/status');
    if (s.json.running) sawRunning = true;
    else if (sawRunning) { done = true; break; }
    await new Promise((x) => setTimeout(x, 1500));
  }
  check('任务走到终态（未卡死）', done);

  const log = (await req('GET', '/api/log')).json.log || '';
  check('日志含「编译失败 · 已中止」横幅', /编译失败 · 已中止/.test(log));
  check('日志含真实编译错误 Could not resolve',
    /Could not resolve/.test(log),
    (log.match(/Could not resolve[^\n]*/) || [''])[0].trim());
  check('日志明示不会用旧产物', /不会使用旧产物打包|绝不/.test(log));
  check('日志明示未产出 wgt、未推送', /未产出任何 wgt/.test(log));

  const after = snap();
  check('零出包（wgt 数量未增加）', after.length === before.length,
    before.length + ' -> ' + after.length);
  const st = await req('GET', '/api/status');
  check('lastBuild 未被伪造为成功', !st.json.lastBuild || st.json.lastBuild.exitCode !== 0,
    st.json.lastBuild ? 'exit=' + st.json.lastBuild.exitCode : 'null');

  console.log('\n--- 日志尾部 ---');
  console.log(log.split('\n').slice(-26).join('\n'));

  console.log('\n结果: ' + pass + ' PASS / ' + fail + ' FAIL');
  process.exitCode = fail ? 1 : 0;
})().catch((e) => { console.error('异常', e); process.exitCode = 1; });
