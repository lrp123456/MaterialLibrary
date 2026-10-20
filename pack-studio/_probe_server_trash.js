/**
 * _probe_server_trash.js · 直接打生产服务器的回收站接口
 * 目的：拿到服务端真实行为（而不是 App 截图），确认 SQL 报错来源
 */
const http = require('http');
const PUBLIC_HOST = process.env.PUBLIC_HOST;
if (!PUBLIC_HOST) { console.error('请设置环境变量 PUBLIC_HOST'); process.exit(1); }
const BASE = { host: PUBLIC_HOST, port: Number(process.env.PUBLIC_PORT || 30001) };

function call(path, method, headers, body) {
  return new Promise((resolve) => {
    const q = http.request({ ...BASE, path, method: method || 'GET', headers: headers || {}, timeout: 20000 }, (s) => {
      let b = '';
      s.on('data', (d) => b += d);
      s.on('end', () => resolve({ s: s.statusCode, b }));
    });
    q.on('error', (e) => resolve({ s: 0, b: 'ERR ' + e.message }));
    q.on('timeout', () => { q.destroy(); resolve({ s: 0, b: 'TIMEOUT' }); });
    if (body) q.write(body);
    q.end();
  });
}

(async () => {
  const lb = JSON.stringify({ username: 'admin', password: process.env.PACK_PASS || '' });
  const l = await call('/api/auth/login', 'POST',
    { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(lb) }, lb);
  let tok = '';
  try { tok = (JSON.parse(l.b).data || {}).token || ''; } catch (e) {}
  console.log('登录: HTTP ' + l.s + (tok ? '  token OK' : '  ' + l.b.slice(0, 150)));
  if (!tok) return;
  const H = { Authorization: 'Bearer ' + tok };

  console.log('\n── 回收站列表 ──');
  for (const p of [
    '/api/assets/trash?page=1&pageSize=5',
    '/api/assets/trash?page=1&pageSize=5&source=user_delete',
  ]) {
    const r = await call(p, 'GET', H);
    console.log('GET ' + p);
    console.log('   HTTP ' + r.s + '  ' + r.b.slice(0, 500));
  }

  console.log('\n── 素材列表（对照，应正常）──');
  const a = await call('/api/viewer/assets?page=1&pageSize=3', 'GET', H);
  console.log('GET /api/viewer/assets → HTTP ' + a.s + '  ' + a.b.slice(0, 200));

  console.log('\n── 服务存活复查 ──');
  const h = await call('/api/app/update?platform=android&versionCode=200&wgtVersion=2020000&channel=internal', 'GET', {});
  console.log('HTTP ' + h.s + '  ' + h.b.slice(0, 160));
})();
