/**
 * 批次 A + B 回归。断言行为，不搜索源码字面量。
 */
const assert = require('assert');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const zlib = require('zlib');

if (typeof global.uni === 'undefined') {
  global.uni = {
    getStorageSync: () => null,
    setStorageSync: () => {},
    removeStorageSync: () => {},
  };
}

const { lanDispatcher, isLanHost } = require('../src/gen/lan-fetch');
const { sendJson, pipeFileStream } = require('../src/api.js');
const { isAndroidTiramisu } = require('../app-uniapp/src/service/android-permission.js');
const { albumCursorAction } = require('../app-uniapp/src/service/album-cursor.js');
const { buildSelectionPayload } = require('../app-uniapp/src/common/selection-payload.js');
const httpTimeouts = require('../src/http-timeouts');

function testLanFetchSingleton() {
  assert.strictEqual(isLanHost('http://127.0.0.1:8080/v1'), true);
  assert.strictEqual(isLanHost('http://192.168.1.100:8000/'), true);
  assert.strictEqual(isLanHost('https://api.openai.com/v1'), false);
  const d1 = lanDispatcher('http://127.0.0.1:8080/v1');
  const d2 = lanDispatcher('http://localhost:3000/v1');
  assert.ok(d1);
  assert.strictEqual(d1, d2);
  assert.strictEqual(lanDispatcher('https://api.openai.com/v1'), undefined);
}

function testViewerCacheListKeyPageSize() {
  const mod = require('../app-uniapp/src/service/ViewerCache.js');
  const viewerCache = mod.viewerCache || mod.default || mod;
  const keyPage12 = viewerCache.makeListKey({ page: 1, pageSize: 12 });
  const keyPage30 = viewerCache.makeListKey({ page: 1, pageSize: 30 });
  assert.notStrictEqual(keyPage12, keyPage30);
  assert.ok(keyPage12.includes(':ps=12:'));
  assert.ok(keyPage30.includes(':ps=30:'));
}

function testAndroidPermission() {
  assert.strictEqual(isAndroidTiramisu('14', 0), true);
  assert.strictEqual(isAndroidTiramisu('12', 0), false);
  assert.strictEqual(isAndroidTiramisu('10', 33), true);
  assert.strictEqual(isAndroidTiramisu('14', 32), true);
  assert.strictEqual(isAndroidTiramisu('12', 32), false);
  assert.strictEqual(isAndroidTiramisu('not-a-version', 0), false);
}

function testAlbumCursor() {
  const cutoff = 1_000_000;
  assert.strictEqual(albumCursorAction(cutoff + 10, cutoff), 'keep');
  assert.strictEqual(albumCursorAction(cutoff - 1, cutoff), 'break');
  assert.strictEqual(albumCursorAction(0, cutoff), 'keep');
  assert.strictEqual(albumCursorAction(NaN, cutoff), 'keep');
}

function testSelectionPayload() {
  const payload = buildSelectionPayload({
    currentMode: 'box',
    box: { x1: 0.1, y1: 0.2, x2: 0.5, y2: 0.6 },
    quad: null,
    polygon: null,
    naturalW: 1000,
    naturalH: 500,
  });
  assert.strictEqual(payload.mode, 'rect');
  assert.strictEqual(payload.hasSelection, true);
  assert.strictEqual(payload.pixelRect.x, 100);
  assert.strictEqual(payload.pixelRect.y, 100);
  assert.strictEqual(payload.pixelRect.w, 400);
  assert.strictEqual(payload.pixelRect.h, 200);
  assert.strictEqual(payload.pixelRect.x1, 100);
  assert.strictEqual(payload.pixelRect.y1, 100);
  assert.strictEqual(payload.pixelRect.x2, 500);
  assert.strictEqual(payload.pixelRect.y2, 300);
}

function testHttpTimeouts() {
  assert.ok(httpTimeouts.headersTimeout > httpTimeouts.keepAliveTimeout);
  assert.ok(httpTimeouts.requestTimeout >= 300000);
  const serverSrc = fs.readFileSync(require.resolve('../server.js'), 'utf8');
  assert.ok(serverSrc.includes('httpTimeouts.headersTimeout'));
  assert.ok(serverSrc.includes('httpTimeouts.requestTimeout'));
  assert.ok(serverSrc.includes('httpTimeouts.keepAliveTimeout'));
}

function listen(server) {
  return new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
}

async function testSendJsonAsyncGzip() {
  const server = http.createServer((req, res) => {
    res.req = req;
    const largeObj = { ok: true, list: Array.from({ length: 150 }, (_, i) => ({ id: i, name: `item_${i}` })) };
    sendJson(res, 200, req.url === '/test-large' ? largeObj : { ok: true });
  });
  await listen(server);
  const port = server.address().port;
  try {
    const buf = await new Promise((resolve, reject) => {
      const req = http.request({
        host: '127.0.0.1',
        port,
        path: '/test-large',
        headers: { 'Accept-Encoding': 'gzip' },
      }, (res) => {
        assert.strictEqual(res.statusCode, 200);
        assert.strictEqual(res.headers['content-encoding'], 'gzip');
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      });
      req.on('error', reject);
      req.end();
    });
    const parsed = JSON.parse(zlib.gunzipSync(buf).toString('utf8'));
    assert.strictEqual(parsed.ok, true);
    assert.strictEqual(parsed.list.length, 150);
  } finally {
    server.close();
  }
}

async function testPipeFileStream() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'mls-pipe-'));
  const file = path.join(dir, 'grid.bin');
  const payload = Buffer.alloc(256 * 1024, 9);
  fs.writeFileSync(file, payload);
  const crashes = [];
  const onCrash = (err) => crashes.push(err);
  process.on('uncaughtException', onCrash);

  const server = http.createServer((req, res) => {
    if (req.url === '/missing') {
      pipeFileStream(req, res, path.join(dir, 'nope.bin'), 'application/octet-stream');
      return;
    }
    pipeFileStream(req, res, file, 'application/octet-stream');
  });
  await listen(server);
  const port = server.address().port;

  try {
    const got = await new Promise((resolve, reject) => {
      http.get({ host: '127.0.0.1', port, path: '/file' }, (res) => {
        assert.strictEqual(res.statusCode, 200);
        assert.strictEqual(Number(res.headers['content-length']), payload.length);
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => resolve(Buffer.concat(chunks)));
      }).on('error', reject);
    });
    assert.ok(got.equals(payload));

    const missingStatus = await new Promise((resolve, reject) => {
      http.get({ host: '127.0.0.1', port, path: '/missing' }, (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode));
      }).on('error', reject);
    });
    assert.strictEqual(missingStatus, 404);

    await new Promise((resolve, reject) => {
      const req = http.get({ host: '127.0.0.1', port, path: '/file' }, (res) => {
        res.once('data', () => {
          req.destroy();
          setTimeout(resolve, 50);
        });
        res.on('error', () => {});
      });
      req.on('error', () => resolve());
      req.on('close', () => {});
      setTimeout(() => reject(new Error('abort timed out')), 2000);
    });
    assert.deepStrictEqual(crashes, []);
  } finally {
    process.removeListener('uncaughtException', onCrash);
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

async function runAll() {
  testLanFetchSingleton();
  testViewerCacheListKeyPageSize();
  testAndroidPermission();
  testAlbumCursor();
  testSelectionPayload();
  testHttpTimeouts();
  await testSendJsonAsyncGzip();
  await testPipeFileStream();
  console.log('[batch-ab-regression] 行为断言通过');
}

if (require.main === module) {
  runAll().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

module.exports = { runAll };
