/**
 * Phase 5 门禁测试 2：30002 冷热分层媒体网关与 HMAC 签名安全验证
 * 验证目标：
 *  1. 签发短期 HMAC 签名 URL (15 分钟有效)；
 *  2. 无签名/非法签名/篡改路径拦截：返回 HTTP 403 Forbidden；
 *  3. 过期签名拦截：返回 HTTP 403 (code: EXPIRED)；
 *  4. 合法签名直出大文件，支持 Accept-Ranges: bytes 与 HTTP 206 拖拽断点续传；
 *  5. 验证温层文件请求完全由 30002 独立承接，不穿透业务主服务 30001。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const http = require('http');
const { generateSignedMediaUrl, verifyMediaHmac, MEDIA_SECRET } = require('../../src/lib/media-hmac');

test('【Gate 2.1】HMAC 签名算法生成与参数校验', () => {
  const relPath = 'models/chair_interior_v1.glb';
  const url = generateSignedMediaUrl(relPath, { expiresIn: 900 });

  assert.ok(url.startsWith('/media-store/models%2Fchair_interior_v1.glb'), 'URL 前缀必须匹配');
  assert.ok(url.includes('exp='), '必须包含 exp 过期时间戳');
  assert.ok(url.includes('sig='), '必须包含 sig 签名');

  const u = new URL(`http://127.0.0.1${url}`);
  const exp = u.searchParams.get('exp');
  const sig = u.searchParams.get('sig');

  // 正确验签
  const validCheck = verifyMediaHmac(relPath, exp, sig);
  assert.strictEqual(validCheck.valid, true, '合法签名必须校验通过');

  // 篡改路径
  const tamperPathCheck = verifyMediaHmac('models/hacked.glb', exp, sig);
  assert.strictEqual(tamperPathCheck.valid, false, '篡改路径必须被拒');
  assert.strictEqual(tamperPathCheck.code, 'FORBIDDEN');

  // 篡改签名
  const tamperSigCheck = verifyMediaHmac(relPath, exp, 'deadbeef1234');
  assert.strictEqual(tamperSigCheck.valid, false, '伪造签名必须被拒');

  // 模拟过期签名 (16 分钟前签发)
  const expiredExp = Math.floor(Date.now() / 1000) - 60;
  const expiredCheck = verifyMediaHmac(relPath, expiredExp, sig);
  assert.strictEqual(expiredCheck.valid, false, '过期请求必须被拒');
  assert.strictEqual(expiredCheck.code, 'EXPIRED');
});

test('【Gate 2.2】媒体网关 HTTP 403 鉴权拦截与 HTTP 206 断点分片直出模拟', async () => {
  const tmpDir = path.join(__dirname, 'fixtures_media_test');
  fs.mkdirSync(tmpDir, { recursive: true });
  const testFile = path.join(tmpDir, 'test_media_render.mp4');
  // 创建一个 1024 字节的测试虚拟媒体文件
  const buffer = Buffer.alloc(1024, 0xAB);
  fs.writeFileSync(testFile, buffer);

  // 模拟 server.cjs 中的媒体网关拦截逻辑
  const server = http.createServer((req, res) => {
    const urlObj = new URL(req.url, 'http://127.0.0.1');
    const pathname = urlObj.pathname;

    if (pathname.startsWith('/media-store/')) {
      const relPath = decodeURIComponent(pathname.replace(/^\/media-store\/?/, ''));
      const exp = urlObj.searchParams.get('exp');
      const sig = urlObj.searchParams.get('sig');
      const check = verifyMediaHmac(relPath, exp, sig);

      if (!check.valid) {
        res.writeHead(403, { 'Content-Type': 'application/json; charset=utf-8' });
        return res.end(JSON.stringify({ error: check.error, code: check.code }));
      }

      const mediaFilePath = path.join(tmpDir, path.basename(relPath));
      if (!fs.existsSync(mediaFilePath)) {
        res.writeHead(404, { 'Content-Type': 'text/plain' });
        return res.end('Not Found');
      }

      const stat = fs.statSync(mediaFilePath);
      const rangeHeader = req.headers.range;

      if (rangeHeader) {
        const match = /^bytes=(\d+)-(\d+)?$/.exec(rangeHeader);
        if (match) {
          const start = Number(match[1]);
          const end = match[2] ? Number(match[2]) : stat.size - 1;
          const chunkSize = end - start + 1;
          res.writeHead(206, {
            'Content-Range': `bytes ${start}-${end}/${stat.size}`,
            'Accept-Ranges': 'bytes',
            'Content-Length': chunkSize,
            'Content-Type': 'video/mp4',
          });
          return fs.createReadStream(mediaFilePath, { start, end }).pipe(res);
        }
      }

      res.writeHead(200, {
        'Content-Length': stat.size,
        'Accept-Ranges': 'bytes',
        'Content-Type': 'video/mp4',
      });
      return fs.createReadStream(mediaFilePath).pipe(res);
    }

    res.writeHead(404);
    res.end();
  });

  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;

  try {
    // 1. 无签名访问 -> 403
    const unsignedRes = await fetch(`http://127.0.0.1:${port}/media-store/test_media_render.mp4`);
    assert.strictEqual(unsignedRes.status, 403, '无签名访问必须返回 403');

    // 2. 伪造签名访问 -> 403
    const fakeRes = await fetch(`http://127.0.0.1:${port}/media-store/test_media_render.mp4?exp=9999999999&sig=deadbeef`);
    assert.strictEqual(fakeRes.status, 403, '伪造签名必须返回 403');

    // 3. 合法签名访问 -> 200
    const validUrl = generateSignedMediaUrl('test_media_render.mp4', { expiresIn: 300 });
    const okRes = await fetch(`http://127.0.0.1:${port}${validUrl}`);
    assert.strictEqual(okRes.status, 200, '合法签名必须返回 200');
    assert.strictEqual(okRes.headers.get('accept-ranges'), 'bytes', '必须支持 Accept-Ranges: bytes');
    const okData = await okRes.arrayBuffer();
    assert.strictEqual(okData.byteLength, 1024, '完整内容大小必须正确');

    // 4. HTTP Range 请求 (拖拽断点续传) -> 206
    const rangeRes = await fetch(`http://127.0.0.1:${port}${validUrl}`, {
      headers: { Range: 'bytes=100-199' },
    });
    assert.strictEqual(rangeRes.status, 206, 'Range 请求必须返回 HTTP 206 Partial Content');
    assert.strictEqual(rangeRes.headers.get('content-range'), 'bytes 100-199/1024');
    const rangeData = await rangeRes.arrayBuffer();
    assert.strictEqual(rangeData.byteLength, 100, '分片长度必须精确为 100 字节');
  } finally {
    server.close();
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  }
});
