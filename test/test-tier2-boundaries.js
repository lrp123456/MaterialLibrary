/**
 * Tier 2: 边界与极端输入测试套件 (Boundary & Corner Cases Suite)
 * 验证系统在各种极端几何、边界极值、超规尺寸及异常入参下的鲁棒性：
 * 1. 全图全幅选区 [0, 0, 1000, 1000] 与 norm: {x:0, y:0, w:1, h:1}
 * 2. 零宽零高 / 极微选区 (单点选取 w=0, h=0 或 w=0.00001)
 * 3. 图像四角四边极限贴边选区 (x=0, y=0, x+w=1.0, y+h=1.0)
 * 4. 越界与负数坐标自适应安全截断 (x < 0, y < 0, x+w > 1.0)
 * 5. 极端长宽比 (超扁平 ar > 5.6 与 超狭长 ar < 0.18) 像素延展与安全限制
 * 6. 缺失/空值/畸形入参 (selection=null, VLM 损坏 JSON, API 空体等) 优雅降级
 */

const assert = require('node:assert');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const http = require('node:http');
const sharp = require('sharp');

// 把服务端数据目录（快照/缓存落盘）重定向到独立临时目录，杜绝污染生产 ~/.dsh-material-library
const _testDataDir = path.join(os.tmpdir(), 'dsh_tier2_mldata_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6));
process.env.ML_DATA_DIR = _testDataDir;
fs.mkdirSync(_testDataDir, { recursive: true });

const { openDb } = require('../src/db');
const { ensureBaseLibrarySchema } = require('../src/base-library/schema');
const { seedMasterDictionary } = require('../src/base-library/master-dictionary-seed');
const { classifyRegionPart } = require('../src/base-library/classify-part');
const { cropSelectionInterior, normalizeQuadOrRect } = require('../src/handlers/image-ops');
const { compileBaseAttributes } = require('../src/base-library/compile');
const { handleApi } = require('../src/api');

// 全局外网熔断：损坏 VLM 用例会降级到默认开启的 JEV 回退，必须拦在本机
globalThis.fetch = async () => {
  throw new Error('unexpected real network fetch in tier2 unit test');
};

function createTestContext() {
  const testDir = path.join(os.tmpdir(), 'dsh_tier2_test_' + Date.now() + '_' + Math.random().toString(36).slice(2, 6));
  fs.mkdirSync(testDir, { recursive: true });
  const db = openDb(testDir);
  ensureBaseLibrarySchema(db);
  seedMasterDictionary(db);

  db.prepare(`
    INSERT OR REPLACE INTO sessions (token, user_id, role, expires_at)
    VALUES (?, ?, ?, ?)
  `).run('test-tier2-token', 1, 'admin', Date.now() + 86400000);

  const mockServices = { db, config: {}, interpreter: null };

  function invokeApi(method, reqPath, body = null, userToken = 'test-tier2-token') {
    return new Promise((resolve) => {
      const req = new http.IncomingMessage(null);
      req.method = method;
      req.url = reqPath;
      req.headers = {
        authorization: `Bearer ${userToken}`,
        'content-type': 'application/json'
      };

      const res = {
        _headers: {},
        statusCode: 200,
        setHeader(k, v) { this._headers[k] = v; },
        getHeader(k) { return this._headers[k]; },
        writeHead(code, headers = {}) {
          this.statusCode = code;
          Object.assign(this._headers, headers);
        },
        end(data) {
          try {
            resolve({ statusCode: this.statusCode, json: JSON.parse(data) });
          } catch (_) {
            resolve({ statusCode: this.statusCode, raw: data });
          }
        }
      };

      if (body) {
        req.push(JSON.stringify(body));
      }
      req.push(null);

      handleApi(mockServices, req, res).catch(e => {
        resolve({ statusCode: 500, error: e.message });
      });
    });
  }

  return { testDir, db, invokeApi };
}

async function runTier2Tests() {
  const results = {
    tier: 2,
    name: 'Tier 2 - Boundary & Corner Cases',
    passed: 0,
    failed: 0,
    tests: [],
    errors: []
  };

  function recordPass(testName) {
    results.passed++;
    results.tests.push({ name: testName, status: 'PASSED' });
    console.log(`  ✅ [PASS] ${testName}`);
  }

  function recordFail(testName, err) {
    results.failed++;
    const errMsg = err?.message || String(err);
    results.tests.push({ name: testName, status: 'FAILED', error: errMsg });
    results.errors.push({ testName, error: errMsg });
    console.error(`  ❌ [FAIL] ${testName}: ${errMsg}`);
  }

  const { testDir, db, invokeApi } = createTestContext();

  console.log('\n======================================================');
  console.log('🚀 Running Tier 2: Boundary & Corner Cases Suites');
  console.log('======================================================\n');

  const testImg1000 = await sharp({
    create: { width: 1000, height: 1000, channels: 3, background: { r: 100, g: 120, b: 140 } }
  }).jpeg().toBuffer();

  // --- 1. 全图全幅选区测试 ---
  try {
    const fullSel = { norm: { x: 0, y: 0, w: 1, h: 1 } };
    const croppedFull = await cropSelectionInterior(testImg1000, fullSel);
    assert.ok(Buffer.isBuffer(croppedFull));
    const metaFull = await sharp(croppedFull).metadata();
    assert.strictEqual(metaFull.format, 'jpeg');
    assert.ok(metaFull.width >= 280 && metaFull.width <= 1568);
    assert.ok(metaFull.height >= 280 && metaFull.height <= 1568);

    // 0..1000 全图归一化
    const quadFull = normalizeQuadOrRect({ bbox: [0, 0, 1000, 1000], unit: 'fraction' }, 1000, 1000);
    assert.strictEqual(quadFull[0].x, 0);
    assert.strictEqual(quadFull[0].y, 0);
    recordPass('B1: 全图全幅选区 [0,0,1000,1000] 与 norm 边界');
  } catch (err) {
    recordFail('B1: 全图全幅选区 [0,0,1000,1000] 与 norm 边界', err);
  }

  // --- 2. 零宽零高与微米级单点选区 ---
  try {
    // 零宽高或极微选区不应导致除以零或崩溃，必须安全垫底至最小像素
    const zeroSel = { norm: { x: 0.5, y: 0.5, w: 0, h: 0 } };
    const cropZero = await cropSelectionInterior(testImg1000, zeroSel);
    assert.ok(Buffer.isBuffer(cropZero));
    const metaZero = await sharp(cropZero).metadata();
    assert.ok(metaZero.width >= 280, '最小边长必须自动缩放/延展至 280');
    assert.ok(metaZero.height >= 280, '最小边长必须自动缩放/延展至 280');

    const microSel = { norm: { x: 0.3, y: 0.3, w: 0.00005, h: 0.00005 } };
    const cropMicro = await cropSelectionInterior(testImg1000, microSel);
    const metaMicro = await sharp(cropMicro).metadata();
    assert.ok(metaMicro.width >= 280);
    assert.ok(metaMicro.height >= 280);
    recordPass('B2: 零宽零高与微米级单点选区自适应安全保底');
  } catch (err) {
    recordFail('B2: 零宽零高与微米级单点选区自适应安全保底', err);
  }

  // --- 3. 图像四角四边极限贴边选区 ---
  try {
    // 左上极限贴边
    const topLeftSel = { norm: { x: 0, y: 0, w: 0.1, h: 0.1 } };
    const cropTL = await cropSelectionInterior(testImg1000, topLeftSel);
    assert.ok(Buffer.isBuffer(cropTL));

    // 右下极限贴边 (x+w=1.0, y+h=1.0)
    const bottomRightSel = { norm: { x: 0.9, y: 0.9, w: 0.1, h: 0.1 } };
    const cropBR = await cropSelectionInterior(testImg1000, bottomRightSel);
    assert.ok(Buffer.isBuffer(cropBR));

    // 细边贴合
    const edgeSel = { norm: { x: 0, y: 0.4, w: 0.01, h: 0.2 } };
    const cropEdge = await cropSelectionInterior(testImg1000, edgeSel);
    assert.ok(Buffer.isBuffer(cropEdge));
    recordPass('B3: 图像四角与四边极限贴边选区安全裁切');
  } catch (err) {
    recordFail('B3: 图像四角与四边极限贴边选区安全裁切', err);
  }

  // --- 4. 越界与负数坐标自适应安全截断 ---
  try {
    // 负数起始坐标
    const negSel = { norm: { x: -0.2, y: -0.15, w: 0.5, h: 0.5 } };
    const cropNeg = await cropSelectionInterior(testImg1000, negSel);
    assert.ok(Buffer.isBuffer(cropNeg), '负数坐标选区应安全截断至 0 像素');

    // 溢出右侧与底部边界 (x+w = 1.3 > 1.0, y+h = 1.4 > 1.0)
    const overSel = { norm: { x: 0.8, y: 0.7, w: 0.5, h: 0.7 } };
    const cropOver = await cropSelectionInterior(testImg1000, overSel);
    assert.ok(Buffer.isBuffer(cropOver), '超范围选区应自动被限制在图像物理像素内');
    recordPass('B4: 负数与越界坐标自适应安全截断');
  } catch (err) {
    recordFail('B4: 负数与越界坐标自适应安全截断', err);
  }

  // --- 5. 极端长宽比 (超扁平 ar > 5.6 与 超狭长 ar < 0.18) ---
  try {
    const wideImg = await sharp({
      create: { width: 3000, height: 100, channels: 3, background: { r: 80, g: 100, b: 120 } }
    }).jpeg().toBuffer();

    // 极扁选区 (3000 x 50, ar = 60 > 5.6)
    const flatSel = { norm: { x: 0, y: 0.2, w: 1.0, h: 0.5 } };
    const cropFlat = await cropSelectionInterior(wideImg, flatSel);
    const metaFlat = await sharp(cropFlat).metadata();
    assert.strictEqual(metaFlat.width, 1568, '长边超出限制必须严格缩至 1568');
    assert.strictEqual(metaFlat.height, 280, '短边不足必须通过边缘像素延展补足到 280');
    assert.ok(metaFlat.width * metaFlat.height <= 2458624, '总像素不得超过上限');

    const tallImg = await sharp({
      create: { width: 100, height: 3000, channels: 3, background: { r: 80, g: 100, b: 120 } }
    }).jpeg().toBuffer();

    // 极狭长选区 (50 x 3000, ar = 0.0167 < 0.18)
    const tallSel = { norm: { x: 0.2, y: 0, w: 0.5, h: 1.0 } };
    const cropTall = await cropSelectionInterior(tallImg, tallSel);
    const metaTall = await sharp(cropTall).metadata();
    assert.strictEqual(metaTall.height, 1568, '长边超出限制必须严格缩至 1568');
    assert.strictEqual(metaTall.width, 280, '短边不足必须通过边缘像素延展补足到 280');
    recordPass('B5: 极端长宽比 (ar > 5.6 与 ar < 0.18) 像素缩放与边缘延展安全限制');
  } catch (err) {
    recordFail('B5: 极端长宽比 (ar > 5.6 与 ar < 0.18) 像素缩放与边缘延展安全限制', err);
  }

  // --- 6. 缺失/空值/畸形入参优雅降级 ---
  try {
    // 1) 选区对象为空时默认使用整图
    const cropNullSel = await cropSelectionInterior(testImg1000, null);
    assert.ok(Buffer.isBuffer(cropNullSel));

    // 2) 图像 Buffer 为空或异常时不抛未捕获异常
    const emptyClassify = await classifyRegionPart(db, Buffer.alloc(0), {
      selection: { norm: { x: 0.1, y: 0.1, w: 0.2, h: 0.2 } }
    });
    assert.ok(emptyClassify, '空图像 Buffer 分类调用应安全返回兜底结果');
    assert.ok(emptyClassify.part !== undefined);

    // 3) VLM 接口返回严重损坏或空文本
    const brokenVlm = async () => '{"part": "wall", broken_json...';
    const brokenRes = await classifyRegionPart(db, testImg1000, { chatVision: brokenVlm });
    assert.ok(brokenRes, 'VLM 返回损坏 JSON 时应安全捕获并降级');

    // 4) 提示词编译器传入空 regions
    const emptyCompile = compileBaseAttributes(db, { regions: [] });
    assert.ok(typeof emptyCompile.prompt === 'string', '空 regions 应安全返回提示词模板');
    assert.strictEqual(emptyCompile.clauses.length, 0);

    // 5) API 鉴权拦截与非法路由保护
    const unauthRes = await invokeApi('GET', '/api/products/presets', null, 'invalid_token');
    assert.strictEqual(unauthRes.statusCode, 401, '无效 Token 必须被 401 拦截');

    const badPutRes = await invokeApi('PUT', '/api/products/presets/test_chair_bad', null);
    // 空 body PUT 必须被妥善处理，绝不能造成未处理异常挂起
    assert.ok([200, 400].includes(badPutRes.statusCode));
    recordPass('B6: 缺失/空值/损坏 JSON/非法鉴权全方位优雅降级');
  } catch (err) {
    recordFail('B6: 缺失/空值/损坏 JSON/非法鉴权全方位优雅降级', err);
  }

  console.log(`\nTier 2 Finished: ${results.passed} Passed, ${results.failed} Failed\n`);

  try { db.close(); } catch {}
  try { fs.rmSync(testDir, { recursive: true, force: true }); } catch {}
  try { fs.rmSync(_testDataDir, { recursive: true, force: true }); } catch {}

  return results;
}

if (require.main === module) {
  runTier2Tests().then(res => {
    if (res.failed > 0) {
      console.error(`\n❌ Tier 2 测试存在 ${res.failed} 项失败！`);
      process.exitCode = 1;
    } else {
      console.log('\n🎉 Tier 2 所有边界与极端测试用例全部通过！');
      process.exitCode = 0;
    }
  }).catch(e => {
    console.error('Tier 2 异常崩溃:', e);
    process.exitCode = 1;
  });
}

module.exports = { runTier2Tests };
