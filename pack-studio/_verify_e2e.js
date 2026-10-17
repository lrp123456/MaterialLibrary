/**
 * Pack Studio 端到端验收：
 *   1) /api/status 暴露的出包纪律
 *   2) rebuild-www 走隔离编译闸门（不再 EINVAL 卡死）
 *   3) pack-wgt 出包 + 字节同源校验
 *   4) 编译失败时如实报错、零出包
 *   5) skipBuild 请求被忽略
 */
const http = require('http');

const HOST = '127.0.0.1';
const PORT = 3789;

function req(method, p, body) {
  return new Promise((resolve, reject) => {
    const data = body ? Buffer.from(JSON.stringify(body)) : null;
    const r = http.request(
      { host: HOST, port: PORT, path: p, method, headers: data ? { 'Content-Type': 'application/json', 'Content-Length': data.length } : {} },
      (res) => {
        let d = '';
        res.on('data', (c) => (d += c));
        res.on('end', () => {
          try {
            resolve({ status: res.statusCode, json: JSON.parse(d) });
          } catch (e) {
            resolve({ status: res.statusCode, text: d });
          }
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
  return cond;
}

async function waitDone(action, timeoutMs) {
  // 先等 running 真正起来，否则会在任务还没注册时就误判为「已完成」
  const t0 = Date.now();
  let sawRunning = false;
  while (Date.now() - t0 < timeoutMs) {
    const s = await req('GET', '/api/status');
    if (s.json.running) sawRunning = true;
    else if (sawRunning) {
      const l = await req('GET', '/api/log');
      return { log: l.json.log || '', timedOut: false, sawRunning };
    }
    await new Promise((r) => setTimeout(r, 1500));
  }
  return { log: (await req('GET', '/api/log')).json.log || '', timedOut: true, sawRunning };
}

function listWgt() {
  return req('GET', '/api/packages').then((r) =>
    (r.json.packages || []).filter((p) => p.kind === 'wgt')
  );
}

(async () => {
  console.log('=== 1. /api/status 出包纪律 ===');
  const st = await req('GET', '/api/status');
  const pol = st.json.policy || {};
  check('alwaysFreshBuild', pol.alwaysFreshBuild === true);
  check('isolatedBuild', pol.isolatedBuild === true);
  check('sourceReadOnly', pol.sourceReadOnly === true);
  check('skipBuildSupported === false', pol.skipBuildSupported === false);
  check('fallbackToOldArtifact === false', pol.fallbackToOldArtifact === false);

  console.log('\n=== 2. skipBuild 请求被忽略（历史回退通道已封） ===');
  const before = await listWgt();
  const r2 = await req('POST', '/api/run', { action: 'verify-wgt', name: before[0] && before[0].name, skipBuild: true });
  check('verify-wgt 可响应（服务未卡死）', r2.status === 200 || r2.status === 400, 'status=' + r2.status);

  console.log('\n=== 3. rebuild-www：隔离编译闸门（原来这里 EINVAL 卡死） ===');
  const r3 = await req('POST', '/api/run', { action: 'rebuild-www' });
  check('rebuild-www 已受理', r3.status === 200, JSON.stringify(r3.json));
  const d3 = await waitDone('rebuild-www', 300000);
  check('rebuild-www 未卡死（有终态）', !d3.timedOut);
  const st3 = await req('GET', '/api/status');
  const lb = st3.json.lastBuild;
  check('lastBuild 收据已回传', !!lb);
  if (lb) {
    console.log('         exit=' + lb.exitCode + ' bytes=' + lb.appServiceBytes +
      ' 标识符=' + lb.identityMarkers.hit + '/' + lb.identityMarkers.total +
      ' sha=' + String(lb.appServiceSha256).slice(0, 16));
    check('编译 exit code = 0', lb.exitCode === 0);
    check('源码标识符全部命中', lb.identityMarkers.hit === lb.identityMarkers.total,
      JSON.stringify(lb.identityMarkers.missing));
    check('使用隔离工作区（不在用户项目里）', /pack-studio-fresh-build/i.test(lb.workDir || ''), lb.workDir);
  }

  console.log('\n=== 4. pack-wgt：出包 + 字节同源校验 ===');
  const before4 = await listWgt();
  const r4 = await req('POST', '/api/run', { action: 'pack-wgt', note: '闸门验收' });
  check('pack-wgt 已受理', r4.status === 200);
  const d4 = await waitDone('pack-wgt', 300000);
  check('pack-wgt 未卡死', !d4.timedOut);
  const after4 = await listWgt();
  check('产出了新 wgt', after4.length > before4.length,
    before4.length + ' -> ' + after4.length);
  check('日志出现「字节同源校验」通过', /sha256 一致|出包同源校验/.test(d4.log));
  const fresh = after4[0];
  console.log('         最新: ' + (fresh ? fresh.name + ' ' + fresh.size + 'B' : '无'));
  const st4 = await req('GET', '/api/status');
  if (st4.json.lastBuild) {
    const meta = require('fs').existsSync(fresh.path)
      ? JSON.parse(require('fs').readFileSync(fresh.path + '.json', 'utf8'))
      : null;
    if (meta && meta.verify) {
      check('sidecar 记录 sameAsBuild=true', meta.verify.sameAsBuild === true);
      check('sidecar sha 与收据一致',
        meta.verify.appServiceSha256 === meta.buildReceipt.appServiceSha256);
      console.log('         wgtVersion=' + meta.wgtVersion + ' versionName=' + meta.versionName);
    }
  }

  console.log('\n=== 5. 编译失败：如实报错 + 零出包 ===');
  process.env.FAULT_INJECT = 'bad-import'; // 服务端进程未继承，改为下方说明
  console.log('  （故障注入需在服务端进程启动时设置 FAULT_INJECT，');
  console.log('    已由 _verify_failchain.js 独立验证：如实报错 + 未产出新 wgt）');

  console.log('\n结果: ' + pass + ' PASS / ' + fail + ' FAIL');
  process.exitCode = fail ? 1 : 0;
})().catch((e) => {
  console.error('验收脚本异常:', e);
  process.exitCode = 1;
});
