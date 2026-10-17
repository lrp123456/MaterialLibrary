/**
 * _verify_remote_wgt.js · 拉取服务器上真实在推的 wgt，验证它含不含新代码
 * 这一步回答：「服务端推给用户的那个包，到底是不是新 UI？」
 */
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const zlib = require('zlib');

const BASE = 'http://39.107.120.55:30001';
const MARKERS = [
  'home_library_tab',
  'trash-src-bar',
  'disposeSource',
  'back-to-top',
  'takeRemovals',
];

function get(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: 30000 }, (r) => {
      if (r.statusCode >= 300 && r.statusCode < 400 && r.headers.location) {
        return resolve(get(new URL(r.headers.location, url).toString()));
      }
      const chunks = [];
      r.on('data', (d) => chunks.push(d));
      r.on('end', () =>
        resolve({ status: r.statusCode, body: Buffer.concat(chunks), headers: r.headers })
      );
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('TIMEOUT')); });
  });
}

// ---- 极简 zip 读取 ----
function readCentralDirectory(buf) {
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i > buf.length - 66000; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('EOCD not found');
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const out = new Map();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) break;
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const cmtLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const name = buf.slice(off + 46, off + 46 + nameLen).toString('utf8');
    out.set(name, { method, compSize, localOff });
    off += 46 + nameLen + extraLen + cmtLen;
  }
  return out;
}
function readEntry(buf, entry) {
  const lo = entry.localOff;
  if (buf.readUInt32LE(lo) !== 0x04034b50) throw new Error('bad local header');
  const nameLen = buf.readUInt16LE(lo + 26);
  const extraLen = buf.readUInt16LE(lo + 28);
  const start = lo + 30 + nameLen + extraLen;
  const raw = buf.slice(start, start + entry.compSize);
  return entry.method === 0 ? raw : zlib.inflateRawSync(raw);
}

function req2(url, method, headers, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(url);
    const r = http.request({
      hostname: u.hostname, port: u.port, path: u.pathname + u.search,
      method: method || 'GET', headers: headers || {}, timeout: 60000,
    }, (res) => {
      const chunks = [];
      res.on('data', (d) => chunks.push(d));
      res.on('end', () => resolve({ status: res.statusCode, body: Buffer.concat(chunks), headers: res.headers }));
    });
    r.on('error', reject);
    r.on('timeout', () => { r.destroy(); reject(new Error('TIMEOUT')); });
    if (body) r.write(body);
    r.end();
  });
}

(async () => {
  console.log('① 问服务器要更新');
  const upd = await get(
    `${BASE}/api/app/update?platform=android&versionCode=200&wgtVersion=2020000&channel=internal`
  );
  const j = JSON.parse(upd.body.toString('utf8'));
  const d = j.data;
  console.log('   hasUpdate=' + d.hasUpdate + ' type=' + d.type + ' force=' + d.force);
  console.log('   wgtVersion=' + d.wgtVersion + ' versionName=' + d.versionName);
  console.log('   url=' + d.url + '  size=' + d.size + '  md5=' + d.md5);
  if (!d.url) { console.log('无更新可测'); return; }

  console.log('\n①b 登录拿 token（下载更新包需要会话）');
  const loginBody = JSON.stringify({ username: 'admin', password: process.env.PACK_PASS || '' });
  const lr = await req2(`${BASE}/api/auth/login`, 'POST',
    { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(loginBody) }, loginBody);
  let token = '';
  try {
    const lj = JSON.parse(lr.body.toString('utf8'));
    token = (lj.data && (lj.data.token || lj.data.sessionToken)) || (lj.token || '') || '';
    console.log('   登录 HTTP ' + lr.status + (token ? '  token 已获取' : '  未拿到 token: ' + lr.body.toString('utf8').slice(0, 200)));
  } catch (e) {
    console.log('   登录响应无法解析: ' + lr.body.toString('utf8').slice(0, 200));
  }
  if (!token) {
    console.log('   ✗ 无法登录，后续下载验证跳过');
    return;
  }

  console.log('\n② 下载 wgt');
  const abs = d.url.startsWith('http') ? d.url : BASE + d.url;
  const r = await req2(abs, 'GET', { Authorization: 'Bearer ' + token });
  console.log('   HTTP ' + r.status + '  字节=' + r.body.length + '  content-type=' + r.headers['content-type']);
  const md5 = crypto.createHash('md5').update(r.body).digest('hex');
  console.log('   md5=' + md5 + (md5 === d.md5 ? '  ✓ 与服务器声明一致' : '  ✗ 不一致！声明=' + d.md5));

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'rwgt-'));
  const f = path.join(tmp, 'remote.wgt');
  fs.writeFileSync(f, r.body);
  console.log('   落地: ' + f);

  console.log('\n③ 解包看内容');
  let entries;
  try {
    entries = readCentralDirectory(r.body);
  } catch (e) {
    console.log('   ✗ 不是合法 zip: ' + e.message);
    return;
  }
  console.log('   条目数=' + entries.size);
  const names = [...entries.keys()];
  const hasSvc = names.includes('app-service.js');
  console.log('   含 app-service.js: ' + (hasSvc ? 'YES' : 'NO'));
  console.log('   含 manifest.json: ' + (names.includes('manifest.json') ? 'YES' : 'NO'));
  const pages = names.filter((n) => n.startsWith('pages/') && n.endsWith('.js')).map((n) => n.split('/')[1]);
  const uniqPages = [...new Set(pages)].sort();
  console.log('   pages: ' + uniqPages.join(' '));
  console.log('   有 trash 页面: ' + (uniqPages.includes('trash') ? 'YES' : 'NO'));

  if (hasSvc) {
    const svc = readEntry(r.body, entries.get('app-service.js'));
    const text = svc.toString('utf8');
    const sha = crypto.createHash('sha256').update(svc).digest('hex');
    const hits = MARKERS.filter((m) => text.includes(m));
    console.log('\n④ 关键：包内 app-service.js 里有几个新功能标识符');
    console.log('   字节=' + svc.length);
    console.log('   sha256=' + sha);
    console.log('   命中 ' + hits.length + '/' + MARKERS.length);
    MARKERS.forEach((m) => console.log('     ' + (text.includes(m) ? 'HIT ' : 'MISS') + '  ' + m));

    console.log('\n⑤ 与本机 10-03 新编译产物对比');
    const fresh = 'C:\\Users\\lrp\\DevEcoStudioProjects\\AlbumSyncUniAppX\\dist\\build\\app\\app-service.js';
    if (fs.existsSync(fresh)) {
      const fb = fs.readFileSync(fresh);
      const fsha = crypto.createHash('sha256').update(fb).digest('hex');
      const fHits = MARKERS.filter((m) => fb.toString('utf8').includes(m));
      console.log('   本机: 字节=' + fb.length + ' sha256=' + fsha);
      console.log('         命中 ' + fHits.length + '/' + MARKERS.length);
      console.log('   相同? ' + (sha === fsha ? 'YES' : 'NO —— 远端包不是本机这次编译的产物'));
    } else {
      console.log('   (本机产物不存在)');
    }
  }

  if (entries.has('manifest.json')) {
    const mf = JSON.parse(readEntry(r.body, entries.get('manifest.json')).toString('utf8').replace(/^﻿/, ''));
    console.log('\n⑥ 包内 manifest.json（决定 plus.runtime.wgtVersion）');
    console.log('   name=' + mf.name + '  version=' + JSON.stringify(mf.version || {}));
    console.log('   → 运行时 wgtVersion 会是 ' + ((mf.version || {}).code));
    console.log('   → 服务端声明 wgtVersion=' + d.wgtVersion +
      (((mf.version || {}).code === d.wgtVersion) ? '  ✓ 一致' : '  ✗ 不一致（客户端会一直认为有更新/或装完仍显示旧版本）'));
  }
})().catch((e) => console.log('FATAL', e.message));
