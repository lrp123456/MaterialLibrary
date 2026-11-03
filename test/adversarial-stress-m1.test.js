/**
 * Milestone 1 专项对抗性压力测试套件 (Milestone 1 Adversarial Stress Testing Suite)
 * 
 * 专门针对 M1（3D 选品卡片与渲染快照持久化）极端边界进行经验性验证与对抗检验：
 * 1. 快照持久化并发压力测试（多单品并发、同单品多角度高并发竞态、并发读写锁安全）
 * 2. 异常快照 Payload 容错与对抗注入测试（残缺 JSON、非法 Base64、超大/越界负载、未知视角、路径穿越注入）
 * 3. 前端卡片展示多级回退链与防死黑崩溃全场景测试（缺角回退、空快照回退、网络坏图回退、占位卡片兜底）
 * 4. 数据对齐与路由兼容性测试（单复数路由兼容、单张与批量映射兼容、preview_file 自动对齐不变性）
 */

const assert = require('node:assert');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const http = require('node:http');

const testDir = path.join(os.tmpdir(), 'dsh_adversarial_m1_' + Date.now());
fs.mkdirSync(testDir, { recursive: true });
process.env.ML_DATA_DIR = testDir;

const { openDb } = require('../src/db');
const { ensureBaseLibrarySchema } = require('../src/base-library/schema');
const { seedMasterDictionary } = require('../src/base-library/master-dictionary-seed');
const { handleApi } = require('../src/api');

// 记录仓 data/previews 镜像目录的初始文件清单：快照 POST 会向这里镜像落盘，套件结束后只清新增物
const _mirrorPreviewsDir = path.join(__dirname, '..', 'data', 'previews');
const _mirrorInitial = new Set(fs.existsSync(_mirrorPreviewsDir) ? fs.readdirSync(_mirrorPreviewsDir) : []);

const db = openDb(testDir);
ensureBaseLibrarySchema(db);
seedMasterDictionary(db);

// 创建管理员测试 session
db.prepare(`
  INSERT OR REPLACE INTO sessions (token, user_id, role, expires_at)
  VALUES (?, ?, ?, ?)
`).run('test-adv-token', 1, 'admin', Date.now() + 86400000);

const mockServices = { db, config: { dataDir: testDir }, interpreter: null };

let passCount = 0;
let failCount = 0;
const vulnerabilities = [];

function recordResult(category, desc, passed, details = '') {
  if (passed) {
    passCount++;
    console.log(`  [PASS] [${category}] ${desc}`);
  } else {
    failCount++;
    vulnerabilities.push({ category, desc, details });
    console.log(`  [VULNERABILITY] [${category}] ${desc} -> ${details}`);
  }
}

// 辅助函数：调用 API
function invokeApi(method, reqPath, body = null, token = 'test-adv-token') {
  return new Promise((resolve) => {
    const req = new http.IncomingMessage(null);
    req.method = method;
    req.url = reqPath;
    req.headers = {
      authorization: token ? `Bearer ${token}` : '',
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
          resolve({ statusCode: this.statusCode, json: JSON.parse(data), headers: this._headers });
        } catch (_) {
          resolve({ statusCode: this.statusCode, raw: data, headers: this._headers });
        }
      }
    };

    if (body !== null) {
      if (typeof body === 'string') {
        req.push(body);
      } else {
        req.push(JSON.stringify(body));
      }
    }
    req.push(null);

    handleApi(mockServices, req, res).catch(e => {
      resolve({ statusCode: 500, error: e.message });
    });
  });
}

// 模拟前端 Product3DManager.vue 的 getProductThumbnail
function getProductThumbnail(item) {
  if (item && item.snapshots && typeof item.snapshots === 'object') {
    if (item.snapshots.right_45) return item.snapshots.right_45;
    if (item.snapshots.front) return item.snapshots.front;
    if (item.snapshots.front_0) return item.snapshots.front_0;
    const firstVal = Object.values(item.snapshots).find(v => typeof v === 'string' && v.length > 0);
    if (firstVal) return firstVal;
  }
  return (item && item.preview_url) || '';
}

// 1x1 绿色透明测试 PNG Base64
const TINY_PNG_B64 = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';

// 记录创建的测试文件以便清理
const createdFiles = new Set();

async function runAdversarialSuite() {
  console.log('================================================================');
  console.log('🧪 MILESTONE 1 EMPIRICAL ADVERSARIAL STRESS TEST SUITE');
  console.log('================================================================\n');

  // ======================================================================
  // 1. 并发持久化压力测试 (Concurrency & Race Condition Stress)
  // ======================================================================
  console.log('--- 1. 快照持久化并发压力测试 ---');

  // 1.1 多预设单品并发上传
  const CONCURRENT_ITEMS = 8;
  const initPromises = [];
  for (let i = 0; i < CONCURRENT_ITEMS; i++) {
    const id = `stress_preset_${i}`;
    initPromises.push(invokeApi('PUT', `/api/products/presets/${id}`, {
      name: `并发测试单品_${i}`,
      category: 'furniture',
      facing: 45
    }));
  }
  const initResults = await Promise.all(initPromises);
  const allInitOk = initResults.every(r => r.statusCode === 200 && r.json?.success);
  recordResult('Concurrency', '8 个不同单品并发初始化 PUT', allInitOk);

  // 并发上传快照到各自单品
  const snapPromises = [];
  for (let i = 0; i < CONCURRENT_ITEMS; i++) {
    const id = `stress_preset_${i}`;
    snapPromises.push(invokeApi('POST', `/api/products/presets/${id}/snapshots`, {
      snapshots: {
        right_45: TINY_PNG_B64,
        front: TINY_PNG_B64
      }
    }));
  }
  const snapResults = await Promise.all(snapPromises);
  const allSnapOk = snapResults.every(r => r.statusCode === 200 && r.json?.success);
  recordResult('Concurrency', '8 个不同单品并发上传快照', allSnapOk);

  // 验证每个单品数据完整无相互干扰
  let crossContamination = false;
  for (let i = 0; i < CONCURRENT_ITEMS; i++) {
    const id = `stress_preset_${i}`;
    const row = db.prepare('SELECT * FROM product_presets WHERE id=?').get(id);
    const snapMap = JSON.parse(row?.snapshots_json || '{}');
    if (!snapMap.right_45 || !snapMap.front || !snapMap.right_45.includes(id)) {
      crossContamination = true;
    }
  }
  recordResult('Concurrency', '多单品并发数据隔离与自洽性 (无交叉污染)', !crossContamination);

  // 1.2 同一单品的高并发多视角竞态更新 (Race Condition on Single Preset)
  const RACE_ID = 'race_condition_preset';
  await invokeApi('PUT', `/api/products/presets/${RACE_ID}`, {
    name: '竞态多角度测试沙发',
    category: 'furniture'
  });

  const angles = [
    'front_0', 'right_45', 'right_90', 'back_180', 'left_45',
    'top_down', 'detail_arm', 'detail_cushion', 'iso_view', 'side_view'
  ];

  const racePromises = angles.map(angleKey => {
    return invokeApi('POST', `/api/products/presets/${RACE_ID}/snapshots`, {
      snapshots: {
        [angleKey]: TINY_PNG_B64
      }
    });
  });

  const raceResults = await Promise.all(racePromises);
  const allRaceStatusOk = raceResults.every(r => r.statusCode === 200 && r.json?.success);
  recordResult('Concurrency', '同一单品 10 个视角并发独立更新 HTTP 200', allRaceStatusOk);

  // 检验最终 SQLite DB 中的 snapshots_json 是否合并了所有视角
  const raceRow = db.prepare('SELECT * FROM product_presets WHERE id=?').get(RACE_ID);
  const finalRaceMap = JSON.parse(raceRow?.snapshots_json || '{}');
  const missingAngles = angles.filter(a => !finalRaceMap[a]);

  // 注意：在单进程无分布式锁的并发环境下，检查视角合并情况
  recordResult(
    'Concurrency',
    `同一单品并发更新视角完整性 (存留: ${Object.keys(finalRaceMap).length}/${angles.length})`,
    missingAngles.length === 0,
    missingAngles.length > 0 ? `丢失视角: ${missingAngles.join(', ')}` : ''
  );

  // 1.3 并发读写互斥安全 (Concurrent Read during Write)
  const mixedOps = [];
  for (let i = 0; i < 15; i++) {
    if (i % 2 === 0) {
      mixedOps.push(invokeApi('GET', '/api/products/presets'));
    } else {
      mixedOps.push(invokeApi('POST', `/api/products/presets/${RACE_ID}/snapshots`, {
        angle: 'front_0',
        snapshot_b64: TINY_PNG_B64
      }));
    }
  }
  const mixedResults = await Promise.all(mixedOps);
  const mixedAllSuccess = mixedResults.every(r => r.statusCode === 200 && (r.json?.success || Array.isArray(r.json?.data)));
  recordResult('Concurrency', '并发读写混合压力测试 (零 SQLite lock 崩溃)', mixedAllSuccess);


  // ======================================================================
  // 2. 异常快照 Payload 容错与对抗注入测试 (Corrupt Payload & Security Injection)
  // ======================================================================
  console.log('\n--- 2. 异常快照 Payload 容错与对抗注入测试 ---');

  // 2.1 针对不存在单品的快照提交
  const nonExistRes = await invokeApi('POST', '/api/products/presets/non_existent_preset_999/snapshots', {
    snapshots: { right_45: TINY_PNG_B64 }
  });
  recordResult('Robustness', '针对不存在的单品 ID 提交快照返回 404', nonExistRes.statusCode === 404);

  // 2.2 残缺畸变 JSON 请求体
  const brokenJsonRes = await invokeApi('POST', `/api/products/presets/${RACE_ID}/snapshots`, '{"snapshots": { broken_json_payload');
  recordResult('Robustness', '残缺畸变 JSON 体不崩溃服务 (优雅容错)', brokenJsonRes.statusCode === 200 || brokenJsonRes.statusCode === 400);

  // 2.3 空对象与异常类型字段 (null, array, number, boolean)
  const nullSnapRes = await invokeApi('POST', `/api/products/presets/${RACE_ID}/snapshots`, { snapshots: null });
  recordResult('Robustness', 'snapshots 为 null 请求体容错', nullSnapRes.statusCode === 200 && nullSnapRes.json?.success);

  const arrSnapRes = await invokeApi('POST', `/api/products/presets/${RACE_ID}/snapshots`, { snapshots: [TINY_PNG_B64] });
  recordResult('Robustness', 'snapshots 为 Array 请求体容错', arrSnapRes.statusCode === 200 && arrSnapRes.json?.success);

  const primitiveSnapRes = await invokeApi('POST', `/api/products/presets/${RACE_ID}/snapshots`, { snapshots: 123456 });
  recordResult('Robustness', 'snapshots 为数值/非对象请求体容错', primitiveSnapRes.statusCode === 200 && primitiveSnapRes.json?.success);

  // 2.4 非法 / 损坏 Base64
  const corruptB64Res = await invokeApi('POST', `/api/products/presets/${RACE_ID}/snapshots`, {
    snapshots: {
      corrupt_view: 'NOT_VALID_BASE64_$%^&*!@#?~'
    }
  });
  recordResult('Robustness', '损坏非法 Base64 编码数据写入不崩溃', corruptB64Res.statusCode === 200 && corruptB64Res.json?.success);

  // 2.5 未知视角、特殊字符与 Unicode 视角键
  const unicodeAngleKey = '🛋️黄金视角_角度45';
  const unicodeSnapRes = await invokeApi('POST', `/api/products/presets/${RACE_ID}/snapshots`, {
    snapshots: {
      [unicodeAngleKey]: TINY_PNG_B64
    }
  });
  const unicodeCheck = db.prepare('SELECT snapshots_json FROM product_presets WHERE id=?').get(RACE_ID);
  const unicodeMap = JSON.parse(unicodeCheck?.snapshots_json || '{}');
  recordResult('Robustness', 'Emoji 与中文特殊字符视角键入库与反序列化', unicodeMap[unicodeAngleKey] !== undefined);

  // 2.6 安全对抗：视角键路径穿越注入测试 (Path Traversal via Angle Key in snapshots update)
  const traversalTarget = '/../../escaped_injection_test';
  const traversalRes = await invokeApi('POST', `/api/products/presets/${RACE_ID}/snapshots`, {
    snapshots: {
      [traversalTarget]: TINY_PNG_B64
    }
  });

  // 检验文件是否被非法写入至 previews 目录之外
  const previewsDir = path.join(testDir, 'previews');
  const escapedFile = path.join(testDir, 'escaped_injection_test.png');
  const didEscape = fs.existsSync(escapedFile);
  if (didEscape) {
    try { fs.unlinkSync(escapedFile); } catch (_) {}
  }
  recordResult(
    'Security',
    '视角键路径穿越防御 (POST /presets/:id/snapshots 严禁向 previews 目录外写入文件)',
    !didEscape,
    didEscape ? 'CRITICAL: 发现路径穿越漏洞！传入带有 /../ 的 angleKey 可越界写入父级目录' : ''
  );

  // 2.7 安全对抗：模型上传接口视角键路径穿越注入 (POST /products/upload)
  const uploadTraversalRes = await invokeApi('POST', '/api/products/upload', {
    name: '注入测试模型',
    model_b64: Buffer.from('mock_glb_content').toString('base64'),
    snapshots: {
      '/../../escaped_upload_injection': TINY_PNG_B64
    }
  });
  const escapedUploadFile = path.join(testDir, 'escaped_upload_injection.png');
  const didUploadEscape = fs.existsSync(escapedUploadFile);
  if (didUploadEscape) {
    try { fs.unlinkSync(escapedUploadFile); } catch (_) {}
  }
  recordResult(
    'Security',
    '视角键路径穿越防御 (POST /products/upload 严禁向 previews 目录外写入文件)',
    !didUploadEscape,
    didUploadEscape ? 'CRITICAL: 发现模型上传路径穿越漏洞！upload 接口同样未过滤 angleKey' : ''
  );

  // 2.8 超大负载测试 (33MB 超过 32MB parseBody 阈值)
  // 生成 33MB 假数据
  const largeBuf = Buffer.alloc(33 * 1024 * 1024, 'a').toString();
  const largeRes = await invokeApi('POST', `/api/products/presets/${RACE_ID}/snapshots`, JSON.stringify({
    snapshots: {
      huge_view: largeBuf
    }
  }));
  recordResult('Robustness', '超大 Payload (33MB > 32MB 限额) 优雅拦截无崩溃', largeRes.statusCode === 200 || largeRes.statusCode === 413);



  // ======================================================================
  // 3. 前端卡片展示多级回退链与防死黑崩溃全场景测试 (Frontend Fallback Chain)
  // ======================================================================
  console.log('\n--- 3. 前端卡片展示多级回退链与防死黑崩溃测试 ---');

  // 3.1 黄金视角优先级验证: right_45 > front > front_0 > 任意视角 > preview_url
  const itemFull = {
    id: 'sofa_full',
    preview_url: '/previews/sofa_full.png',
    snapshots: {
      right_45: '/previews/snap_right_45.png',
      front: '/previews/snap_front.png',
      front_0: '/previews/snap_front_0.png',
      back_180: '/previews/snap_back.png'
    }
  };
  recordResult('FallbackChain', '优先命中 right_45 黄金视角', getProductThumbnail(itemFull) === '/previews/snap_right_45.png');

  // 缺少 right_45 回退至 front
  const itemNo45 = {
    id: 'sofa_no_45',
    preview_url: '/previews/sofa_no_45.png',
    snapshots: {
      front: '/previews/snap_front.png',
      front_0: '/previews/snap_front_0.png'
    }
  };
  recordResult('FallbackChain', '缺少 right_45 时平滑回退至 front', getProductThumbnail(itemNo45) === '/previews/snap_front.png');

  // 缺少 right_45 与 front 回退至 front_0
  const itemNoFront = {
    id: 'sofa_no_front',
    preview_url: '/previews/sofa_no_front.png',
    snapshots: {
      front_0: '/previews/snap_front_0.png',
      back_180: '/previews/snap_back.png'
    }
  };
  recordResult('FallbackChain', '缺少 right_45/front 时回退至 front_0', getProductThumbnail(itemNoFront) === '/previews/snap_front_0.png');

  // 缺少标准前向视角，命中任意自定义视角
  const itemCustom = {
    id: 'sofa_custom',
    preview_url: '/previews/sofa_custom.png',
    snapshots: {
      top_down: '/previews/snap_top_down.png'
    }
  };
  recordResult('FallbackChain', '缺少全部标准视角时回退至首个有效视角', getProductThumbnail(itemCustom) === '/previews/snap_top_down.png');

  // snapshots 为空对象，回退至 preview_url
  const itemEmptySnap = {
    id: 'sofa_empty_snap',
    preview_url: '/previews/sofa_default.png',
    snapshots: {}
  };
  recordResult('FallbackChain', 'snapshots 为空对象时平滑回退至 preview_url', getProductThumbnail(itemEmptySnap) === '/previews/sofa_default.png');

  // 3.2 极端脏数据与边界回退
  const itemNullSnap = { id: 'sofa_null_snap', preview_url: '/previews/sofa_default.png', snapshots: null };
  recordResult('FallbackChain', 'snapshots 为 null 时平滑回退至 preview_url', getProductThumbnail(itemNullSnap) === '/previews/sofa_default.png');

  const itemUndefSnap = { id: 'sofa_undef_snap', preview_url: '/previews/sofa_default.png' };
  recordResult('FallbackChain', 'snapshots 未定义时平滑回退至 preview_url', getProductThumbnail(itemUndefSnap) === '/previews/sofa_default.png');

  const itemCorruptSnap = { id: 'sofa_corrupt', preview_url: '/previews/sofa_default.png', snapshots: 'invalid_string' };
  recordResult('FallbackChain', 'snapshots 为非法字符串时平滑回退至 preview_url', getProductThumbnail(itemCorruptSnap) === '/previews/sofa_default.png');

  const itemEmptyValues = { id: 'sofa_empty_vals', preview_url: '/previews/sofa_default.png', snapshots: { right_45: '', front: '' } };
  recordResult('FallbackChain', '视角均为空字符串时平滑回退至 preview_url', getProductThumbnail(itemEmptyValues) === '/previews/sofa_default.png');

  const itemTotalEmpty = { id: 'sofa_total_empty' };
  recordResult('FallbackChain', '完全缺少快照与 preview_url 时安全返回空串（无 JS 崩溃异常）', getProductThumbnail(itemTotalEmpty) === '');

  // 3.3 前端卡片渲染逻辑状态机模拟（杜绝纯黑背景死黑与无图崩溃）
  function simulateCardRenderState(item, isImgLoaded = false, isImgError = false) {
    const thumb = getProductThumbnail(item);
    // Product3DManager.vue Line 72: v-if="!imageErrorMap[item.id] && getProductThumbnail(item)"
    const shouldRenderImg = !isImgError && Boolean(thumb);
    const shouldRenderPlaceholder = !shouldRenderImg;
    return {
      rendersImg: shouldRenderImg,
      imgSrc: shouldRenderImg ? thumb : null,
      rendersPlaceholder: shouldRenderPlaceholder
    };
  }

  // 场景 A: 正常渲染图加载中与加载完成
  const stateA = simulateCardRenderState(itemFull, true, false);
  recordResult('CardRendering', '正常快照渲染出真实图片', stateA.rendersImg && stateA.imgSrc === '/previews/snap_right_45.png');

  // 场景 B: 图片加载错误（404 或网络阻断）
  const stateB = simulateCardRenderState(itemFull, false, true);
  recordResult('CardRendering', '图片加载出错时立即展示 3D 展台质感占位卡片 (绝无纯黑背景)', stateB.rendersPlaceholder && !stateB.rendersImg);

  // 场景 C: 单品无快照且无预览图
  const stateC = simulateCardRenderState(itemTotalEmpty, false, false);
  recordResult('CardRendering', '完全无快照无缩略图时直接展示待烘焙占位卡片', stateC.rendersPlaceholder && !stateC.rendersImg);


  // ======================================================================
  // 4. 数据对齐与路由兼容性测试 (Data Alignment & Route Compatibility)
  // ======================================================================
  console.log('\n--- 4. 数据对齐与路由兼容性测试 ---');

  // 4.1 单复数路由兼容性 (POST /snapshots 与 POST /snapshot)
  const ROUTE_TEST_ID = 'route_compat_preset';
  await invokeApi('PUT', `/api/products/presets/${ROUTE_TEST_ID}`, { name: '路由兼容单品' });

  const postPluralRes = await invokeApi('POST', `/api/products/presets/${ROUTE_TEST_ID}/snapshots`, {
    snapshots: { right_45: TINY_PNG_B64 }
  });
  recordResult('RouteCompatibility', '复数路由 POST /presets/:id/snapshots 正常响应', postPluralRes.statusCode === 200 && postPluralRes.json?.success);

  const postSingularRes = await invokeApi('POST', `/api/products/presets/${ROUTE_TEST_ID}/snapshot`, {
    snapshot_b64: TINY_PNG_B64,
    angle: 'front_0'
  });
  recordResult('RouteCompatibility', '单数路由 POST /presets/:id/snapshot 兼容响应', postSingularRes.statusCode === 200 && postSingularRes.json?.success);

  // 4.2 preview_file 与快照双向对齐不变性
  const compatRow = db.prepare('SELECT preview_file, snapshots_json FROM product_presets WHERE id=?').get(ROUTE_TEST_ID);
  const compatMap = JSON.parse(compatRow?.snapshots_json || '{}');
  recordResult('DataAlignment', '快照入库自动同步更新 preview_file', compatRow?.preview_file?.includes(ROUTE_TEST_ID) && Boolean(compatMap.right_45));

  // 4.3 GET /products/presets 列表接口输出格式规范
  const listRes = await invokeApi('GET', '/api/products/presets');
  const sofaItem = listRes.json?.data?.find(p => p.id === 'sofa_electric_single');
  recordResult('DataAlignment', '内置真品 sofa_electric_single 包含完整多视角快照字典', 
    sofaItem &&
    sofaItem.snapshots &&
    Boolean(sofaItem.snapshots.right_45) &&
    Boolean(sofaItem.snapshots.front)
  );

  // 4.4 检查实际预设素材文件尺寸与存在性
  const sofaSinglePath = path.join(__dirname, '../data/previews/sofa_single.png');
  let sofaSizeOk = false;
  if (fs.existsSync(sofaSinglePath)) {
    const stat = fs.statSync(sofaSinglePath);
    sofaSizeOk = stat.size > 50000; // > 50KB 高清大图
  }
  recordResult('AssetIntegrity', `sofa_single.png 真实高分辨率 3D 渲染图 (尺寸 > 50KB, 实际: ${(fs.statSync(sofaSinglePath).size / 1024).toFixed(1)} KB)`, sofaSizeOk);

  // ======================================================================
  // 总结与输出
  // ======================================================================
  console.log('\n================================================================');
  console.log(`📊 测试结果总计: ${passCount} 通过, ${failCount} 风险/漏洞`);
  console.log('================================================================');

  if (vulnerabilities.length > 0) {
    console.log('\n⚠️ 发现的问题或潜在攻击面 (Vulnerabilities / Attack Surface):');
    vulnerabilities.forEach((v, idx) => {
      console.log(`  ${idx + 1}. [${v.category}] ${v.desc}: ${v.details}`);
    });
  }

  // 清理临时测试单品
  try {
    for (let i = 0; i < CONCURRENT_ITEMS; i++) {
      await invokeApi('DELETE', `/api/products/presets/stress_preset_${i}`);
    }
    await invokeApi('DELETE', `/api/products/presets/${RACE_ID}`);
    await invokeApi('DELETE', `/api/products/presets/${ROUTE_TEST_ID}`);
  } catch (_) {}

  // 返回测试结果对象
  return {
    passCount,
    failCount,
    vulnerabilities
  };
}

function cleanupArtifacts() {
  // 清除本套件镜像进仓 data/previews 的全部新增文件（含中文/emoji/消毒后注入键）
  try {
    for (const f of fs.readdirSync(_mirrorPreviewsDir)) {
      if (!_mirrorInitial.has(f)) fs.rmSync(path.join(_mirrorPreviewsDir, f), { force: true });
    }
  } catch {}
  // Windows 下 better-sqlite3 句柄不关闭会导致目录 rm 失败
  try { db.close(); } catch {}
  try { fs.rmSync(testDir, { recursive: true, force: true }); } catch {}
}

if (require.main === module) {
  runAdversarialSuite().then(res => {
    cleanupArtifacts();
    if (res.failCount > 0) {
      console.log(`\n❌ 对抗测试检测到 ${res.failCount} 项脆弱性/问题！`);
      process.exit(1);
    } else {
      console.log('\n🎉 对抗测试全部通过！系统表现出极佳的鲁棒性。');
      process.exit(0);
    }
  }).catch(err => {
    cleanupArtifacts();
    console.error('测试套件异常崩溃:', err);
    process.exit(1);
  });
}

module.exports = { runAdversarialSuite };
