/**
 * 帧中继 (frame-relay) 回归测试：
 * - data: URL → 落盘 + 签发公网 media_token URL
 * - /api/viewer/frames/:file 凭 media_token 免登读回
 * - http(s) 原样透传
 * - 未配置公网基址时给出 code=public_base_missing 的可操作错误
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');

const relay = require('../src/frame-relay');
const auth = require('../src/auth');

async function main() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-frame-relay-'));
  const services = {
    config: { dataDir, port: 30001, bffPublicBase: '' },
    db: { prepare: () => ({ get: () => undefined }) },
  };

  // 1. http(s) 透传
  const passthrough = await relay.materializeFrameUrl(services, '  https://cdn.example.com/a.jpg ');
  assert.strictEqual(passthrough, 'https://cdn.example.com/a.jpg', '公网 http(s) URL 必须原样透传');

  // 2. 未配置公网基址：data URL 必须失败且带 code
  const onePixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC';
  await assert.rejects(
    () => relay.materializeFrameUrl(services, onePixel, { label: '首帧' }),
    (e) => e.code === 'public_base_missing',
    '未配置 BFF_PUBLIC_BASE 时必须抛 public_base_missing'
  );

  // 3. 配置公网基址后：落盘 + token + 免登读回
  process.env.BFF_PUBLIC_BASE = 'https://gen.example.com';
  const publicUrl = await relay.materializeFrameUrl(services, onePixel, { label: '首帧' });
  const u = new URL(publicUrl);
  assert.strictEqual(u.origin, 'https://gen.example.com');
  const segs = u.pathname.split('/');
  // /api/viewer/frames/<token>/<file>
  assert.strictEqual(segs[3], 'frames');
  assert.match(segs[5], /^[a-f0-9]{32,64}\.png$/);
  const file = segs[5];
  const token = decodeURIComponent(segs[4] || u.searchParams.get('media_token') || '');
  const frameId = file.replace(/\.png$/, '');
  assert.ok(token, '公网 URL 必须带 media_token（路径末段或 query）');
  assert.ok(auth.verifyMediaToken(`frame:${frameId}`, token, dataDir), 'media_token 必须可通过 frame:<id> 校验');

  // serveFrame：伪造 res 收集响应
  function fakeRes() {
    return {
      statusCode: 0, headers: {}, chunks: [], ended: false,
      writeHead(code, headers) { this.statusCode = code; Object.assign(this.headers, headers || {}); },
      setHeader() {},
      end(chunk) { if (chunk) this.chunks.push(Buffer.from(chunk)); this.ended = true; },
    };
  }
  const okRes = fakeRes();
  relay.serveFrame(services, { method: 'GET' }, okRes, file, token);
  assert.strictEqual(okRes.statusCode, 200);
  assert.strictEqual(okRes.headers['Content-Type'], 'image/png');
  assert.ok(okRes.chunks[0].length > 0);

  // 4. 坏 token / 坏文件名必须拒绝
  const badRes = fakeRes();
  relay.serveFrame(services, { method: 'GET' }, badRes, file, token + 'x');
  assert.strictEqual(badRes.statusCode, 403);
  const traversal = fakeRes();
  relay.serveFrame(services, { method: 'GET' }, traversal, '../../etc/passwd', token);
  assert.strictEqual(traversal.statusCode, 404);

  // 5. 指定 derivative= 时只读那一版，旁边的原图缓存不能顶上
  const verDir = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-frame-ver-'));
  const originFile = path.join(verDir, 'origin.jpg');
  const nineFile = path.join(verDir, 'nine.jpg');
  const threeFile = path.join(verDir, 'three.jpg');
  fs.writeFileSync(originFile, Buffer.from('ORIGIN'));
  fs.writeFileSync(nineFile, Buffer.from('NINE16'));
  fs.writeFileSync(threeFile, Buffer.from('THREE4'));
  fs.mkdirSync(path.join(verDir, 'cache', 'originals'), { recursive: true });
  fs.writeFileSync(path.join(verDir, 'cache', 'originals', 'fidA.jpg'), Buffer.from('CACHED-ORIGIN'));
  const rows = {
    30139: { id: 30139, asset_fid: 'fidA', kind: 'restage_9_16', storage_ref: nineFile },
    30140: { id: 30140, asset_fid: 'fidA', kind: 'restage_3_4', storage_ref: threeFile },
    origin: { id: 1, asset_fid: 'fidA', kind: 'origin', storage_ref: originFile },
  };
  const verServices = {
    config: { dataDir: verDir, port: 30001 },
    db: {
      prepare(sql) {
        return {
          get(a, b) {
            if (String(sql).includes('WHERE id=?')) return rows[String(a)] && String(rows[String(a)].asset_fid) === String(b) ? rows[String(a)] : undefined;
            if (String(sql).includes("kind='origin'")) return rows.origin;
            return undefined;
          },
        };
      },
    },
  };
  const nine = relay.readLocalRef(verServices, '/api/viewer/assets/fidA/image?derivative=30139&token=stale');
  assert.strictEqual(nine.buf.toString(), 'NINE16', '9:16 必须读衍生文件，不能读原图缓存');
  const three = relay.readLocalRef(verServices, '/api/viewer/assets/fidA/image?derivative=30140');
  assert.strictEqual(three.buf.toString(), 'THREE4', '3:4 必须读自己的衍生文件');
  const raw = relay.readLocalRef(verServices, '/api/viewer/assets/fidA/image?raw=1&token=stale');
  assert.strictEqual(raw.buf.toString(), 'ORIGIN', 'raw=1 读原图行，不读 9:16');
  const missing = relay.readLocalRef(verServices, '/api/viewer/assets/fidA/image?derivative=999');
  assert.strictEqual(missing, null, '指定了不存在的衍生时不能用原图缓存顶上');
  const legacy = relay.readLocalRef(verServices, '/api/viewer/assets/fidA/image?token=stale');
  assert.strictEqual(legacy.refused, true, '没写版本的图片地址必须拒绝，不能读原图缓存');
  assert.ok(!legacy.buf, '拒绝时不能附带另一张图的字节');

  const nasServices = {
    config: { dataDir: verDir, port: 30001 },
    db: {
      prepare(sql) {
        return {
          get() {
            if (String(sql).includes("kind='origin'")) {
              return { id: 9, asset_fid: 'fidNas', kind: 'origin', storage_type: 'nas', storage_ref: '2026/10/missing-on-data-dir.jpg' };
            }
            return undefined;
          },
        };
      },
    },
  };
  const nasOrigin = relay.readLocalRef(nasServices, '/api/viewer/assets/fidNas/image?raw=1&token=stale');
  assert.strictEqual(nasOrigin, null, 'raw=1 但原图在 NAS、本机 dataDir 没有时不能当成没写版本');

  fs.rmSync(dataDir, { recursive: true, force: true });
  fs.rmSync(verDir, { recursive: true, force: true });
  delete process.env.BFF_PUBLIC_BASE;
  console.log('✔ frame-relay 验收通过');
}

main().catch((e) => { console.error(e); process.exit(1); });
