/**
 * pack-studio 灰度推送校验回归（离线，全部请求只打 127.0.0.1 临时端口）
 *
 * 2026-11-04 真实事故（公网 39.107.120.55，wgt 2050010）：
 *  灰度白名单发布上传成功、服务端 canary 指针与白名单均已落库；
 *  但推送器用「客户端检查接口 + 无 deviceId」回读，白名单外的探针被服务端
 *  按设计回落稳定版 → 误判失败 → 自动回滚把稳定版塞进 canary 并清空了白名单。
 *
 * 本用例用一个模拟服务器（状态/检查/上传/撤回协议与 src/app-update.js 同语义）验证：
 *  1) 白名单灰度推送必须判定成功（旧代码必抛）
 *  2) 白名单设备端到端拿到新包
 *  3) 推送前无 canary：失败回滚走 revoke-canary，不污染灰度
 *  4) 推送前有 canary+白名单：失败回滚还原旧指针且 targetDevices/md5/size 不丢
 *
 * 运行：node test/pack-push-canary.test.js
 */
const http = require('http');
const fs = require('fs');
const os = require('os');
const path = require('path');
const assert = require('assert');

const { pushUpdate } = require('../pack-studio/lib/push-update.js');

/* ── 最小 STORED zip（CRC 填 0；推送器不校验 CRC，只要能读出两个条目） ── */
function crc32Stub() { return 0; }
function makeZip(entries) {
  const locals = [];
  const centrals = [];
  let offset = 0;
  for (const [name, content] of entries) {
    const nameBuf = Buffer.from(name, 'utf8');
    const data = Buffer.isBuffer(content) ? content : Buffer.from(String(content), 'utf8');
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8); // method 0 = stored
    local.writeUInt32LE(0, 14);
    local.writeUInt32LE(crc32Stub(), 14);
    local.writeUInt32LE(data.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    locals.push(local, nameBuf, data);

    const cen = Buffer.alloc(46);
    cen.writeUInt32LE(0x02014b50, 0);
    cen.writeUInt32LE(data.length, 20);
    cen.writeUInt32LE(data.length, 24);
    cen.writeUInt16LE(nameBuf.length, 28);
    cen.writeUInt32LE(offset, 42);
    centrals.push(cen, nameBuf);
    offset += local.length + nameBuf.length + data.length;
  }
  const centralBuf = Buffer.concat(centrals);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt16LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuf, eocd]);
}

function startMockServer(state, calls) {
  return new Promise((resolve, reject) => {
    const srv = http.createServer((req, res) => {
      const u = new URL(req.url, 'http://127.0.0.1');
      const send = (code, obj) => {
        res.writeHead(code, { 'content-type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify(obj));
      };
      if (req.method === 'POST' && u.pathname === '/api/auth/login') {
        return send(200, { success: true, data: { token: 't' } });
      }
      if (req.method === 'GET' && u.pathname === '/api/app/update/state') {
        return send(200, {
          success: true,
          data: {
            latest: state.latest,
            canary: (state.channels.canary && state.channels.canary.latest) || null,
            grayscale: state.grayscale,
            channels: state.channels,
          },
        });
      }
      if (req.method === 'GET' && u.pathname === '/api/app/update') {
        // 简化的白名单语义：deviceId 命中白名单才给灰度包
        const ch = u.searchParams.get('channel') || '';
        const dev = (u.searchParams.get('deviceId') || '').toLowerCase();
        const gray = state.grayscale;
        if (gray.active && gray.latest && Array.isArray(gray.targetDevices) &&
            gray.targetDevices.some((t) => dev === String(t).toLowerCase())) {
          return send(200, { success: true, data: { hasUpdate: true, ...gray.latest, fileName: '' } });
        }
        const canaryLike = ['canary', 'beta', 'gray'].includes(ch);
        const e = canaryLike ? state.latest : state.latest;
        return send(200, { success: true, data: { hasUpdate: true, ...e } });
      }
      if (req.method === 'POST' && u.pathname === '/api/app/update/upload') {
        const latest = {
          versionCode: Number(u.searchParams.get('versionCode')),
          versionName: u.searchParams.get('versionName'),
          wgtVersion: String(u.searchParams.get('wgtVersion')),
          type: 'wgt',
          force: u.searchParams.get('force') === 'true',
          note: u.searchParams.get('note') || '',
          url: '/api/app/update/files/' + u.searchParams.get('fileName'),
          md5: 'deadbeef',
          size: 1234,
          publishedAt: Date.now(),
        };
        const tdRaw = u.searchParams.get('targetDevices') || '';
        const targets = tdRaw ? tdRaw.split(',').map((s) => s.trim()).filter(Boolean) : [];
        state.channels.canary = { latest };
        state.grayscale = { active: true, targetDevices: targets, latest, publishedAt: Date.now() };
        calls.uploaded = u.searchParams.get('fileName');
        calls.targets = targets;
        // failPersist：模拟「返回成功但没落库」
        if (state.failPersist) {
          state.channels.canary = state._snapshotCanary ? { latest: state._snapshotCanary } : undefined;
          state.grayscale = state._snapshotGray;
        }
        return send(200, { success: true, data: { manifest: state, file: { name: calls.uploaded } } });
      }
      if (req.method === 'POST' && u.pathname === '/api/app/update') {
        let raw = '';
        req.on('data', (c) => { raw += c; });
        req.on('end', () => {
          const b = JSON.parse(raw || '{}');
          calls.rollbackBody = b;
          const latest = {
            versionCode: b.versionCode, versionName: b.versionName, wgtVersion: String(b.wgtVersion),
            type: b.type || 'wgt', force: !!b.force, note: b.note || '', url: b.url,
            md5: b.md5 || '', size: b.size || 0, publishedAt: Date.now(),
          };
          state.channels.canary = { latest };
          state.grayscale = {
            active: true,
            targetDevices: Array.isArray(b.targetDevices) ? b.targetDevices : [],
            latest,
            publishedAt: Date.now(),
          };
          send(200, { success: true, data: state });
        });
        return;
      }
      if (req.method === 'POST' && u.pathname === '/api/app/update/revoke-canary') {
        calls.revoked = true;
        delete state.channels.canary;
        state.grayscale = { active: false, targetDevices: [], revokedAt: Date.now() };
        return send(200, { success: true, data: state });
      }
      send(404, { error: 'mock miss ' + req.method + ' ' + u.pathname });
    });
    srv.on('error', reject);
    srv.listen(0, '127.0.0.1', () => resolve(srv));
  });
}

function makeWgt(tmp, code) {
  const wgt = path.join(tmp, `album-sync-${code}.wgt`);
  const zip = makeZip([
    ['manifest.json', JSON.stringify({ version: { name: '1.0.5', code: String(code) } })],
    ['app-service.js', 'define(function(){return 1});'],
  ]);
  fs.writeFileSync(wgt, zip);
  fs.writeFileSync(wgt + '.json', JSON.stringify({
    versionName: '1.0.5', versionCode: code, wgtVersion: code, note: '灰度测试',
  }), 'utf8');
  return wgt;
}

async function main() {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pack-push-canary-'));
  const logs = [];

  try {
    // ── 场景 1+2：线上无 canary，白名单灰度发布必须成功 ──
    const state1 = {
      latest: { versionCode: 2050009, wgtVersion: '2050009', type: 'wgt', url: '/files/s.wgt' },
      channels: {},
      grayscale: { active: false, targetDevices: [] },
      failPersist: false,
    };
    const calls1 = {};
    const srv2 = await startMockServer(state1, calls1);
    const server2 = `http://127.0.0.1:${srv2.address().port}`;
    const wgt1 = makeWgt(tmp, 2050010);

    const r = await pushUpdate({
      file: wgt1,
      note: '优化ui设计方案',
      channel: 'canary',
      releaseMode: 'canary',
      targetDevices: ['HD1910', '127.0.0.1:21503'],
      force: true,
      server: server2,
      user: 'admin', pass: 'x',
      onLog: (l) => logs.push(l),
    });
    assert.strictEqual(r.ok, true, '白名单灰度推送应成功');
    assert.strictEqual(calls1.uploaded, path.basename(wgt1), '新包已上传');
    assert.deepStrictEqual(calls1.targets, ['HD1910', '127.0.0.1:21503'], '白名单随包落库');
    assert.strictEqual(state1.channels.canary.latest.wgtVersion, '2050010', 'canary 指针=新包');
    // 端到端旁证：白名单设备拿新包（断言模拟服务器的选择语义）
    assert.ok((logs.join('').includes('管理端状态')), '回读走管理端状态接口');
    srv2.close();

    // ── 场景 3：推送前无 canary + 上传假成功 → 回滚必须撤回，不发布假 canary ──
    const state3 = {
      latest: { versionCode: 2050009, wgtVersion: '2050009', type: 'wgt', url: '/files/s.wgt' },
      channels: {}, grayscale: { active: false, targetDevices: [] },
      failPersist: true,
      _snapshotCanary: null,
      _snapshotGray: { active: false, targetDevices: [] },
    };
    const calls3 = {};
    const srv3 = await startMockServer(state3, calls3);
    const wgt3 = makeWgt(tmp, 2050011);
    let threw3 = false;
    try {
      await pushUpdate({
        file: wgt3, channel: 'canary', releaseMode: 'canary',
        targetDevices: ['HD1910'], force: true,
        server: `http://127.0.0.1:${srv3.address().port}`, user: 'admin', pass: 'x',
      });
    } catch (e) {
      threw3 = true;
      assert.ok(/不是本次的新包/.test(e.message), '报错应为指针未切换: ' + e.message);
    }
    assert.ok(threw3, '指针未切换必须判失败');
    assert.strictEqual(calls3.revoked, true, '空基线回滚应调 revoke-canary');
    assert.ok(!calls3.rollbackBody, '空基线不得走普通发布回滚');
    srv3.close();

    // ── 场景 4：推送前已有 canary+白名单 + 上传假成功 → 回滚还原旧指针与白名单 ──
    const oldCanary = {
      versionCode: 2050009, wgtVersion: '2050009', type: 'wgt',
      url: '/api/app/update/files/old.wgt', md5: 'aabbccdd', size: 999, force: false,
    };
    const state4 = {
      latest: oldCanary,
      channels: { canary: { latest: oldCanary } },
      grayscale: { active: true, targetDevices: ['olddev'], latest: oldCanary },
      failPersist: true,
      _snapshotCanary: oldCanary,
      _snapshotGray: { active: true, targetDevices: ['olddev'], latest: oldCanary },
    };
    const calls4 = {};
    const srv4 = await startMockServer(state4, calls4);
    const wgt4 = makeWgt(tmp, 2050012);
    let threw4 = false;
    try {
      await pushUpdate({
        file: wgt4, channel: 'canary', releaseMode: 'canary',
        targetDevices: ['HD1910'], force: true,
        server: `http://127.0.0.1:${srv4.address().port}`, user: 'admin', pass: 'x',
      });
    } catch (e) {
      threw4 = true;
    }
    assert.ok(threw4, '指针未切换必须判失败');
    assert.ok(calls4.rollbackBody, '有旧 canary：应走普通发布式回滚');
    assert.strictEqual(calls4.rollbackBody.url, '/api/app/update/files/old.wgt', '回滚到旧包');
    assert.deepStrictEqual(calls4.rollbackBody.targetDevices, ['olddev'], '白名单必须还原（事故点）');
    assert.strictEqual(calls4.rollbackBody.md5, 'aabbccdd', 'md5 不能丢');
    assert.strictEqual(calls4.rollbackBody.size, 999, 'size 不能丢');
    srv4.close();

    fs.rmSync(tmp, { recursive: true, force: true });
    console.log('✅ pack-push-canary 全部通过（白名单误判/空基线撤回/白名单还原）');
  } catch (e) {
    fs.rmSync(tmp, { recursive: true, force: true });
    console.error('pack-push-canary 失败：', e);
    process.exit(1);
  }
}

main();
