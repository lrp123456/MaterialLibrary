/**
 * 室内设计素材库：核心后端自动化集成测试套件
 * 必须在独立临时目录 (ML_DATA_DIR) 执行，禁止触碰生产数据库。
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');

const testDir = path.join(os.tmpdir(), 'dsh_ml_test_' + Date.now());
fs.mkdirSync(testDir, { recursive: true });
process.env.ML_DATA_DIR = testDir;
process.env.ML_ADMIN_PASS = 'admin_secret_123';
process.env.ML_VIEWER_PASS = 'viewer_secret_456';

console.log('=== 1. 测试数据库初始化与迁移 ===');
const { openDb } = require('../src/db');
const db = openDb(testDir);

assert(db.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE type='table' AND name='assets'").get().c === 1);
assert(db.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE type='table' AND name='derivatives'").get().c === 1);
assert(db.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE type='table' AND name='workflows'").get().c === 1);
assert(db.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE type='table' AND name='gen_adapters'").get().c === 1);
assert(db.prepare("SELECT COUNT(*) c FROM sqlite_master WHERE type='table' AND name='asset_vectors'").get().c === 1);
console.log('✅ 数据库 Schema 完整创建成功');

console.log('=== 2. 测试账号鉴权与权限隔离 ===');
const auth = require('../src/auth');

// 登录测试
const adminLogin = auth.login(db, 'admin', 'admin_secret_123');
assert(adminLogin && adminLogin.user.role === 'admin', 'Admin 登录失败');

const viewerLogin = auth.login(db, 'viewer', 'viewer_secret_456');
assert(viewerLogin && viewerLogin.user.role === 'viewer', 'Viewer 登录失败');

const wrongLogin = auth.login(db, 'admin', 'wrong_password');
assert(wrongLogin === null, '错误密码应登录失败');

// 会话校验
const validSession = auth.verifySession(db, adminLogin.token);
assert(validSession && validSession.username === 'admin', 'Session 验证失败');

// 仅管理员可建用户
const nu = auth.createUser(db, { username: 'designer_1', password: 'password123', role: 'viewer' });
assert(nu.username === 'designer_1', '创建 Viewer 失败');

console.log('✅ 账号鉴权与 Session 验证通过');

console.log('=== 3. 测试衍生图血缘管理 ===');
const { createDerivative, setMainDerivative, getDerivatives } = require('../src/derivatives');

// 构造测试资产
const dummyFid = 'test_asset_001';
db.prepare(`
  INSERT INTO assets (fid, kind, file_name, width, height, origin_orientation, status, created_at)
  VALUES (?, 'image', 'living_room.jpg', 1920, 1080, 'landscape', 'discovered', ?)
`).run(dummyFid, Date.now());

// 模拟原图衍生版
const origDeriv = db.prepare(`
  INSERT INTO derivatives (asset_fid, kind, storage_type, storage_ref, file_name, width, height, created_at)
  VALUES (?, 'origin', 'quark', ?, 'living_room.jpg', 1920, 1080, ?)
`).run(dummyFid, dummyFid, Date.now());
setMainDerivative(db, dummyFid, origDeriv.lastInsertRowid);

// 创建 9:16 重构衍生版
const dummyImgPath = path.join(testDir, 'dummy_9_16.jpg');
fs.writeFileSync(dummyImgPath, Buffer.from([0xff, 0xd8, 0xff, 0xe0])); // dummy jpeg header

const services = { db, config: { dataDir: testDir }, logger: console };
(async () => {
  const restageDeriv = await createDerivative(services, {
    assetFid: dummyFid,
    kind: 'restage_9_16',
    srcPath: dummyImgPath,
    fileName: 'restage_9_16_living_room.jpg',
    width: 1080,
    height: 1920,
    params: { prompt: '9:16 restage', generated: true }
  });

  assert(restageDeriv && restageDeriv.kind === 'restage_9_16');
  setMainDerivative(db, dummyFid, restageDeriv.id);

  const allDerivs = getDerivatives(db, dummyFid);
  assert(allDerivs.length === 2, '应有两个衍生版本');

  const assetRow = db.prepare('SELECT main_derivative_id FROM assets WHERE fid=?').get(dummyFid);
  assert(assetRow.main_derivative_id === restageDeriv.id, '主图应切换为 9:16 重构衍生版');
  console.log('✅ 衍生图血缘创建与主图切换通过');

  console.log('=== 4. 测试 DAG 拓扑排序与环路检测 ===');
  const { topologicalSort, validateWorkflowGraph } = require('../src/interpreter');
  const validGraph = {
    nodes: [
      { id: 'gate', type: 'gate', enabled: true },
      { id: 'tag', type: 'tag', enabled: true },
      { id: 'index', type: 'index', enabled: true }
    ],
    edges: [
      { source: 'gate', target: 'tag' },
      { source: 'tag', target: 'index' }
    ]
  };
  const sorted = topologicalSort(validGraph.nodes, validGraph.edges);
  assert.deepStrictEqual(sorted.map(n => n.id), ['gate', 'tag', 'index'], 'DAG 拓扑顺序应一致');

  const cyclicGraph = {
    nodes: [{ id: 'a', type: 'gate' }, { id: 'b', type: 'tag' }],
    edges: [{ source: 'a', target: 'b' }, { source: 'b', target: 'a' }]
  };
  assert.throws(() => topologicalSort(cyclicGraph.nodes, cyclicGraph.edges), /环路/, '有环图应抛出异常');
  console.log('✅ DAG 拓扑校验通过');

  console.log('=== 5. 测试向量相似度与加权推荐 ===');
  const { cosineSimilarity, storeVector, searchSimilar, generateSemanticVector } = require('../src/vector');
  const v1 = new Float32Array([1, 0, 0]);
  const v2 = new Float32Array([1, 0, 0]);
  const v3 = new Float32Array([0, 1, 0]);
  assert(Math.abs(cosineSimilarity(v1, v2) - 1.0) < 0.001, '相同向量余弦应为 1');
  assert(Math.abs(cosineSimilarity(v1, v3) - 0.0) < 0.001, '正交向量余弦应为 0');

  // 测试存取与推荐
  storeVector(db, dummyFid, new Float32Array([0.5, 0.5, 0.5]), 'test_model');
  const similarItems = searchSimilar(services, dummyFid, { limit: 5 });
  assert(Array.isArray(similarItems), '相似推荐返回数组');
  console.log('✅ 向量与混合相似度算法通过');

  console.log('=== 6. 测试多维检索 API ===');
  const { queryAssets, filterOptions } = require('../src/api');

  // 打标测试资产并设为 ready
  const spaceTag = db.prepare("SELECT id FROM tag_dict WHERE dimension='space' AND dir='living_room'").get();
  if (spaceTag) {
    db.prepare("INSERT INTO asset_tags (asset_fid, tag_id, role, source, confidence, updated_at) VALUES (?, ?, NULL, 'ai', 0.9, ?)")
      .run(dummyFid, spaceTag.id, Date.now());
  }
  db.prepare("UPDATE assets SET status='ready' WHERE fid=?").run(dummyFid);

  const resAll = queryAssets(db, { page: 1, pageSize: 10 });
  assert(resAll.total >= 1, '应能检索到就绪素材');
  assert(resAll.items[0].fid === dummyFid);
  assert(resAll.items[0].mainDerivative.kind === 'restage_9_16', '主图应优先为 9:16');

  const resSpace = queryAssets(db, { space: 'living_room' });
  assert(resSpace.total >= 1, '空间筛选应命中');

  // P3 基础色与色系检索测试
  db.prepare("INSERT OR REPLACE INTO asset_colors (asset_fid, hex, role, name, weight, basic_color) VALUES (?, '#FAFAFA', 'main', '纯白', 0.8, '白')").run(dummyFid);
  db.prepare("UPDATE assets SET dominant_color='白' WHERE fid=?").run(dummyFid);
  const colorTag = db.prepare("SELECT id FROM tag_dict WHERE dimension='color_style' AND dir='mono_minimal'").get();
  if (colorTag) {
    db.prepare("INSERT OR REPLACE INTO asset_tags (asset_fid, tag_id, role, source, confidence, updated_at) VALUES (?, ?, NULL, 'derived', 0.9, ?)")
      .run(dummyFid, colorTag.id, Date.now());
  }
  const resColor = queryAssets(db, { colors: '白' });
  assert(resColor.total >= 1, '基础色筛选应命中');
  const resColorStyle = queryAssets(db, { color_style: 'mono_minimal' });
  assert(resColorStyle.total >= 1, '色系筛选应命中');
  const resColorMiss = queryAssets(db, { colors: '红' });
  assert(resColorMiss.total === 0, '未匹配基础色不应命中');

  const opts = filterOptions(db, true);
  assert(opts.space && opts.style_atom && opts.material_kind && opts.orientation && opts.colors, '筛选应含空间/风格/材质/画幅/主色');
  assert(!opts.palette, '旧 palette 必须下线');
  assert(!opts.color_style, '色系已下线，不再作为筛选维');

  // HMAC 短时签名测试
  const { generateMediaToken, verifyMediaToken } = require('../src/auth');
  const mTok = generateMediaToken(dummyFid, 900);
  assert(verifyMediaToken(dummyFid, mTok), '合法 media_token 必须校验通过');
  assert(!verifyMediaToken(dummyFid + '_fake', mTok), '篡改 fid 的 media_token 必须校验失败');

  console.log('✅ 多维检索与统计字典通过（含 P3 基础色/色系与 HMAC 媒体签名）');

  console.log('=== 7. 测试解释器崩溃恢复 ===');
  const { recoverCrashedRuns } = require('../src/interpreter');
  db.prepare("INSERT INTO runs (id, workflow_id, workflow_version, trigger, status, created_at) VALUES ('crashed_run', 'default', 1, 'test', 'running', ?)").run(Date.now());
  db.prepare("INSERT INTO node_runs (run_id, workflow_version, node_id, node_type, asset_fid, status, created_at, updated_at) VALUES ('crashed_run', 1, 'gate', 'gate', 'test_asset_001', 'running', ?, ?)").run(Date.now(), Date.now());

  recoverCrashedRuns(db, console);
  const recoveredRun = db.prepare("SELECT status FROM runs WHERE id='crashed_run'").get();
  const recoveredNodeRun = db.prepare("SELECT status FROM node_runs WHERE run_id='crashed_run'").get();
  assert(recoveredRun.status === 'queued', 'Run 应重置为 queued');
  assert(recoveredNodeRun.status === 'queued', 'NodeRun 应重置为 queued');
  console.log('✅ 崩溃恢复单条 SQL 自动对账通过');

  console.log('=== 8. 测试多层次查重归组与 AI 重构代表图推选 ===');
  const { reElectGroupRepresentative } = require('../src/cluster');

  const fidClean = 'asset_cluster_clean';
  const fidWatermark = 'asset_cluster_wm';
  const testGroup = 'group_test_kitchen';

  db.prepare(`
    INSERT INTO assets (fid, kind, file_name, width, height, origin_orientation, status, has_watermark, dup_group_id, is_representative, phash, created_at)
    VALUES (?, 'image', 'kitchen_wm.jpg', 1920, 1080, 'landscape', 'ready', 1, ?, 0, '1111222233334444', ?)
  `).run(fidWatermark, testGroup, 1000);

  db.prepare(`
    INSERT INTO assets (fid, kind, file_name, width, height, origin_orientation, status, has_watermark, dup_group_id, is_representative, phash, created_at)
    VALUES (?, 'image', 'kitchen_clean.jpg', 1080, 1920, '9:16', 'ready', 0, ?, 0, '1111222233334445', ?)
  `).run(fidClean, testGroup, 2000);

  // 为 fidClean 添加 restage_9_16 衍生图
  db.prepare(`
    INSERT INTO derivatives (asset_fid, kind, storage_type, storage_ref, width, height, params, created_at)
    VALUES (?, 'restage_9_16', 'local_cache', 'dummy_path.jpg', 1080, 1920, ?, ?)
  `).run(fidClean, JSON.stringify({ generated: true }), Date.now());

  // 重选代表图，fidClean 拥有 restage_9_16 衍生图且无水印，应当被选为代表图
  const rep = reElectGroupRepresentative(db, testGroup);
  assert(rep && rep.fid === fidClean, '拥有 AI 重构衍生图的资产应被优先推选为代表图');

  // 测试画幅动态联动检索：
  const res916 = queryAssets(db, { orientation: '9:16' });
  const hit = res916.items.find(i => i.fid === fidClean);
  assert(hit, '9:16 检索应命中 fidClean');
  assert(hit.mainDerivative.kind === 'restage_9_16', '主图应切换至 9:16 衍生图');

  console.log('✅ 多层次查重归组与代表图动态推选验证通过');

  console.log('=== 9. 画幅真值分桶与本地校准 ===');
  const { classifyOrientation, calibrateGeneratedImage } = require('../src/ratio');
  assert.strictEqual(classifyOrientation(1080, 1920).bucket, '9:16');
  assert.strictEqual(classifyOrientation(1080, 1440).bucket, '3:4');
  assert.strictEqual(classifyOrientation(1080, 1620).bucket, '2:3');
  assert.strictEqual(classifyOrientation(1080, 2340).bucket, 'portrait', '19.5:9 不得标成 9:16');
  assert.strictEqual(classifyOrientation(1920, 1080).bucket, '16:9');
  assert.strictEqual(classifyOrientation(1146, 2048).bucket, '9:16');
  const calSrc = path.join(testDir, 'cal_src.jpg');
  const calDst = path.join(testDir, 'cal_out.jpg');
  const sharp = require('sharp');
  await sharp({ create: { width: 1000, height: 1800, channels: 3, background: '#445566' } }).jpeg().toFile(calSrc);
  const cal = await calibrateGeneratedImage(calSrc, calDst, '9:16', '1080p');
  assert.strictEqual(cal.strategy, 'raw_byte_copy');
  assert.strictEqual(cal.width, 1000);
  assert.strictEqual(cal.height, 1800);
  assert.strictEqual(Buffer.compare(fs.readFileSync(calSrc), fs.readFileSync(calDst)), 0);
  const cal34 = path.join(testDir, 'cal_34.jpg');
  const cal34r = await calibrateGeneratedImage(calSrc, cal34, '3:4', '1080p');
  assert.strictEqual(cal34r.strategy, 'raw_byte_copy', '净画重构出图只复制字节，不垫边、不裁切');
  assert.strictEqual(Buffer.compare(fs.readFileSync(calSrc), fs.readFileSync(cal34)), 0);
  const { restagePromptForRatio, composeRatioCanvas } = require('../src/ratio');
  const composed34 = path.join(testDir, 'composed_34.jpg');
  const comp = await composeRatioCanvas(calSrc, composed34, '3:4', '1080p');
  assert.strictEqual(comp.strategy, 'contain_pad');
  assert.strictEqual(comp.width, 1080);
  assert.strictEqual(comp.height, 1440);
  assert(restagePromptForRatio('3:4').includes('3:4'));
  assert(restagePromptForRatio('3:4').includes('严禁拉伸'));
  console.log('✅ 画幅分桶通过；净画重构只复制字节，扩图垫边函数仍在');

  console.log('=== 10. 查重：mmexport 不同空间不得成组 ===');
  const { findGroupForAsset, isGenericExportPrefix } = require('../src/cluster');
  assert(isGenericExportPrefix('mmexport'));
  assert(isGenericExportPrefix('FB_IMG_'));
  const fidHall = 'mm_hall';
  const fidBed = 'mm_bed';
  db.prepare(`
    INSERT INTO assets (fid, kind, file_name, width, height, origin_orientation, status, phash, created_at)
    VALUES (?, 'image', 'mmexport1700000000001.jpg', 1000, 1500, '2:3', 'ready', '0000000000000000', ?)
  `).run(fidHall, Date.now());
  db.prepare(`
    INSERT INTO assets (fid, kind, file_name, width, height, origin_orientation, status, phash, created_at)
    VALUES (?, 'image', 'mmexport1700000000002.jpg', 1000, 1500, '2:3', 'ready', '0000000000000fff', ?)
  `).run(fidBed, Date.now());
  const spaceEntry = db.prepare("SELECT id FROM tag_dict WHERE dimension='space' AND dir='entryway'").get();
  const spaceBed = db.prepare("SELECT id FROM tag_dict WHERE dimension='space' AND dir='bedroom'").get();
  db.prepare("INSERT INTO asset_tags (asset_fid, tag_id, role, source, confidence, updated_at) VALUES (?, ?, NULL, 'ai', 0.9, ?)")
    .run(fidHall, spaceEntry.id, Date.now());
  db.prepare("INSERT INTO asset_tags (asset_fid, tag_id, role, source, confidence, updated_at) VALUES (?, ?, NULL, 'ai', 0.9, ?)")
    .run(fidBed, spaceBed.id, Date.now());
  const falseGroup = findGroupForAsset(db, db.prepare('SELECT * FROM assets WHERE fid=?').get(fidHall), { phashThreshold: 5 });
  assert(!falseGroup, '门厅与卧室因 mmexport 前缀不得成组');

  const twinA = 'twin_a';
  const twinB = 'twin_b';
  db.prepare(`
    INSERT INTO assets (fid, kind, file_name, width, height, origin_orientation, status, phash, created_at)
    VALUES (?, 'image', 'shot_a.jpg', 1080, 1920, '9:16', 'ready', 'aaaaaaaaaaaaaaaa', ?)
  `).run(twinA, Date.now());
  db.prepare(`
    INSERT INTO assets (fid, kind, file_name, width, height, origin_orientation, status, phash, created_at)
    VALUES (?, 'image', 'shot_b.jpg', 1080, 1920, '9:16', 'ready', 'aaaaaaaaaaaaaaaa', ?)
  `).run(twinB, Date.now());
  const livingId = db.prepare("SELECT id FROM tag_dict WHERE dimension='space' AND dir='living_room'").get();
  db.prepare("INSERT INTO asset_tags (asset_fid, tag_id, role, source, confidence, updated_at) VALUES (?, ?, NULL, 'ai', 0.9, ?)")
    .run(twinA, livingId.id, Date.now());
  db.prepare("INSERT INTO asset_tags (asset_fid, tag_id, role, source, confidence, updated_at) VALUES (?, ?, NULL, 'ai', 0.9, ?)")
    .run(twinB, livingId.id, Date.now());
  const trueGroup = findGroupForAsset(db, db.prepare('SELECT * FROM assets WHERE fid=?').get(twinA), { phashThreshold: 5 });
  assert(trueGroup && trueGroup.groupId, '同空间近重复应成组');
  assert(String(trueGroup.reason).startsWith('phash:'), '近重复应记录 phash 原因');

  const kA = 'kit_a';
  const kB = 'kit_b';
  db.prepare(`
    INSERT INTO assets (fid, kind, file_name, width, height, origin_orientation, status, phash, created_at)
    VALUES (?, 'image', 'mmexport1800000000001.jpg', 1080, 1920, '9:16', 'ready', '1111111111111111', ?)
  `).run(kA, Date.now());
  db.prepare(`
    INSERT INTO assets (fid, kind, file_name, width, height, origin_orientation, status, phash, created_at)
    VALUES (?, 'image', 'mmexport1800000000002.jpg', 1080, 1920, '9:16', 'ready', 'eeeeeeeeeeeeeeee', ?)
  `).run(kB, Date.now());
  const kitchenId = db.prepare("SELECT id FROM tag_dict WHERE dimension='space' AND dir='kitchen'").get();
  db.prepare("INSERT INTO asset_tags (asset_fid, tag_id, role, source, confidence, updated_at) VALUES (?, ?, NULL, 'ai', 0.9, ?)")
    .run(kA, kitchenId.id, Date.now());
  db.prepare("INSERT INTO asset_tags (asset_fid, tag_id, role, source, confidence, updated_at) VALUES (?, ?, NULL, 'ai', 0.9, ?)")
    .run(kB, kitchenId.id, Date.now());
  const sameCaption = '空间:厨房 风格:美式乡村/农舍 文件:mmexport.jpg';
  storeVector(db, kA, generateSemanticVector(sameCaption, 64), 'local_semantic_hash_v1');
  storeVector(db, kB, generateSemanticVector(sameCaption, 64), 'local_semantic_hash_v1');
  const hashGroup = findGroupForAsset(db, db.prepare('SELECT * FROM assets WHERE fid=?').get(kA), { phashThreshold: 5 });
  assert(!hashGroup, '标签文本哈希向量不得把同空间不同照片判成重复');
  console.log('✅ 查重收紧规则通过');

  console.log('=== 11. 指定衍生图预览不得被共享缩略图劫持 ===');
  const { handleApi } = require('../src/api');
  const { Writable } = require('stream');
  const hijackFid = dummyFid;
  const thumbPath = path.join(testDir, 'cache', 'thumbs', `${hijackFid}.jpg`);
  fs.mkdirSync(path.dirname(thumbPath), { recursive: true });
  await sharp({ create: { width: 32, height: 32, channels: 3, background: '#ff0000' } }).jpeg().toFile(thumbPath);
  const restagePath = path.join(testDir, 'cache', 'derivatives', 'blue_restage.jpg');
  fs.mkdirSync(path.dirname(restagePath), { recursive: true });
  await sharp({ create: { width: 64, height: 128, channels: 3, background: '#0000ff' } }).jpeg().toFile(restagePath);
  db.prepare("UPDATE derivatives SET storage_type='local_cache', storage_ref=? WHERE id=?").run(
    path.relative(testDir, restagePath),
    restageDeriv.id
  );

  function invokeGet(urlPath) {
    return new Promise((resolve, reject) => {
      const chunks = [];
      const res = new Writable({
        write(chunk, enc, cb) { chunks.push(Buffer.from(chunk)); cb(); }
      });
      res.statusCode = 200;
      res._headers = {};
      res.setHeader = (k, v) => { res._headers[k] = v; };
      res.writeHead = (code, h) => { res.statusCode = code; Object.assign(res._headers, h || {}); };
      res.on('finish', () => resolve({ status: res.statusCode, headers: res._headers, body: Buffer.concat(chunks) }));
      const req = {
        method: 'GET',
        url: urlPath,
        headers: { authorization: `Bearer ${adminLogin.token}` }
      };
      handleApi(services, req, res, '/api').catch(reject);
    });
  }

  const imgRes = await invokeGet(`/api/assets/${hijackFid}/image?derivative=${restageDeriv.id}&v=d1`);
  assert.strictEqual(imgRes.status, 200, '衍生预览应 200');
  const meta = await sharp(imgRes.body).metadata();
  assert(meta.height > meta.width, '应返回竖图衍生而非方缩略图');
  assert(meta.width !== 32, '不得返回 32px 共享缩略图');
  console.log('✅ 衍生图预览不被 thumb 劫持');

  console.log('=== 12. 直连入库幂等 ===');
  const { ingestBuffer } = require('../src/ingest');
  const upBuf = await sharp({ create: { width: 80, height: 120, channels: 3, background: '#112233' } }).jpeg().toBuffer();
  const ing1 = await ingestBuffer(services, { buffer: upBuf, fileName: 'upload_test.jpg', source: 'upload', clientAssetId: 'cli-1' });
  const ing2 = await ingestBuffer(services, { buffer: upBuf, fileName: 'upload_test.jpg', source: 'upload', clientAssetId: 'cli-1' });
  assert.strictEqual(ing1.fid, ing2.fid);
  assert.strictEqual(ing2.deduped, true);
  const row = db.prepare('SELECT source, sha256 FROM assets WHERE fid=?').get(ing1.fid);
  assert.strictEqual(row.source, 'upload');
  assert(row.sha256);
  console.log('✅ 直连入库与幂等通过');

  console.log('=== 13. 合格 Agnes 衍生与组主图 / 向量诚实 ===');
  const { isQualifiedAgnes, pickBrowseMain, findQualifiedKind } = require('../src/restage');
  const recast34 = { kind: 'restage_3_4', id: 99, params: JSON.stringify({ recast: 'contain_pad_from_origin', generated: false }) };
  const agnes916 = { kind: 'restage_9_16', id: 100, params: { generated: true } };
  const originD = { kind: 'origin', id: 1 };
  assert(!isQualifiedAgnes(recast34), 'recast 3:4 不合格');
  assert(isQualifiedAgnes(agnes916), 'generated 9:16 合格');
  const picked = pickBrowseMain([originD, recast34, agnes916]);
  assert.strictEqual(picked.kind, 'restage_9_16');
  const pickedDefault = pickBrowseMain([originD, recast34]);
  assert.strictEqual(pickedDefault.kind, 'origin', '不合格 3:4 不得当列表封面');
  const { NODE_CATALOG } = require('../src/nodes/catalog');
  const dualSpec = NODE_CATALOG.find(n => n.type === 'restage_dual');
  assert.strictEqual(dualSpec.defaultConfig.skipIfAlreadyExact, false);

  const gRep = 'share_rep';
  const gMem = 'share_mem';
  const gId = 'group_share_main';
  db.prepare(`
    INSERT INTO assets (fid, kind, file_name, width, height, origin_orientation, status, dup_group_id, is_representative, created_at)
    VALUES (?, 'image', 'rep.jpg', 1080, 1920, '9:16', 'ready', ?, 1, ?)
  `).run(gRep, gId, Date.now());
  db.prepare(`
    INSERT INTO assets (fid, kind, file_name, width, height, origin_orientation, status, dup_group_id, is_representative, created_at)
    VALUES (?, 'image', 'mem.jpg', 1080, 1920, '9:16', 'ready', ?, 0, ?)
  `).run(gMem, gId, Date.now());
  db.prepare(`
    INSERT INTO derivatives (asset_fid, kind, storage_type, storage_ref, width, height, params, created_at)
    VALUES (?, 'origin', 'local_cache', 'x.jpg', 1080, 1920, NULL, ?)
  `).run(gMem, Date.now());
  db.prepare(`
    INSERT INTO derivatives (asset_fid, kind, storage_type, storage_ref, width, height, params, created_at)
    VALUES (?, 'origin', 'local_cache', 'y.jpg', 1080, 1920, NULL, ?)
  `).run(gRep, Date.now());
  db.prepare(`
    INSERT INTO derivatives (asset_fid, kind, storage_type, storage_ref, width, height, params, created_at)
    VALUES (?, 'restage_9_16', 'local_cache', 'z.jpg', 1080, 1920, ?, ?)
  `).run(gRep, JSON.stringify({ generated: true }), Date.now());
  const { getAssetDetail } = require('../src/api');
  const memDetail = getAssetDetail(services, gMem);
  const shared = memDetail.derivatives.find(d => d.kind === 'restage_9_16');
  assert(shared && shared.generated, '组员详情应展示代表图的合格 9:16');
  assert(memDetail.restageOwnerFid === gRep);
  assert(memDetail.asset.is_representative === 0);

  storeVector(db, gRep, generateSemanticVector('空间:客厅', 64));
  const stored = db.prepare('SELECT model, dimensions FROM asset_vectors WHERE asset_fid=?').get(gRep);
  assert.ok(stored.model === 'local_semantic_hash_v1' || stored.model === 'local_feature_v2', '默认哈希不得写成 3-small');
  assert.strictEqual(stored.dimensions, 64);
  const { getVectorStatus } = require('../src/vector');
  const vs = getVectorStatus(db, { configuredModel: 'text-embedding-3-small' });
  assert(vs && typeof vs.rows === 'number');
  assert(findQualifiedKind([{ kind: 'restage_3_4', params: { recast: 'contain_pad_from_origin' } }], 'restage_3_4') === null);
  console.log('✅ 合格重构、组主图共享与向量诚实通过');

  console.log('=== 14. 巡检画布执行历史取有效状态而非末条 skipped ===');
  const inspectRunId = 'run_inspect_status';
  db.prepare(`
    INSERT INTO runs (id, workflow_id, workflow_version, trigger, status, asset_count, created_at, updated_at)
    VALUES (?, 'default', 1, 'restage_backfill', 'running', 1, ?, ?)
  `).run(inspectRunId, Date.now(), Date.now());
  db.prepare(`
    INSERT INTO node_runs (run_id, workflow_version, node_id, node_type, asset_fid, status, input_summary, output_summary, created_at, updated_at)
    VALUES (?, 1, 'restage_dual', 'restage_dual', ?, 'done', ?, ?, ?, ?)
  `).run(inspectRunId, gRep, JSON.stringify({ fid: gRep }), JSON.stringify({ ok: true }), Date.now(), Date.now());
  db.prepare(`
    INSERT INTO node_runs (run_id, workflow_version, node_id, node_type, asset_fid, status, created_at, updated_at)
    VALUES (?, 1, 'backup', 'backup', ?, 'skipped', ?, ?)
  `).run(inspectRunId, gRep, Date.now(), Date.now());
  const graphRes = await invokeGet(`/api/runs/${inspectRunId}/graph?fid=${gRep}`);
  assert.strictEqual(graphRes.status, 200, '巡检 graph 应 200');
  const graphBody = JSON.parse(graphRes.body.toString());
  assert.strictEqual(graphBody.data.assets[0].last_status, 'done', 'backup skipped 不得盖掉 restage done');
  assert(graphBody.data.inspect.nodes.some(n => n.node_type === 'restage_dual'));
  console.log('✅ 巡检执行历史状态聚合通过');

  console.log('=== 15. 授权治理：快照只发现新图 / 相册消失不隐藏 / 撤销救回 ===');
  const { applyGovernance, AUTH_VISIBLE_SQL } = require('../src/governance');
  const { ingestSnapshot, getSnapshotKeySet, getSnapshotDevices } = require('../src/snapshot');
  const { toEpochMs } = require('../src/sync');
  const nowMs = Date.now();

  const devId = 'test_device_001';
  const oldMs = nowMs - 30 * 86400000;
  const recentMs = nowMs - 3600000;
  const snap1 = ingestSnapshot(db, {
    device_id: devId, app_version: '1.0.0', window_days: 7,
    photos: [
      { name: 'old_a.jpg', size: 100, modified: oldMs, fingerprint: 'f1' },
      { name: 'recent_b.jpg', size: 200, modified: recentMs, fingerprint: 'f2' }
    ]
  }, nowMs);
  assert(snap1.received === 2 && snap1.live === 2 && snap1.frozen === 0, '首次推送应全部 live');
  const snap2 = ingestSnapshot(db, {
    device_id: devId, app_version: '1.0.0', window_days: 7,
    photos: [{ name: 'recent_c.jpg', size: 300, modified: recentMs }]
  }, nowMs + 1000);
  assert(snap2.live === 1 && snap2.frozen === 2, `相册消失应冻结快照行不删除，实际 live/frozen ${snap2.live}/${snap2.frozen}`);
  assert(snap2.removed === 0 && snap2.frozenMarked === 2, '相册消失不得删除 snapshot_items');
  const snapUnion2 = getSnapshotKeySet(db);
  assert(snapUnion2.has('old_a.jpg|100') && snapUnion2.has('recent_c.jpg|300') && snapUnion2.has('recent_b.jpg|200'),
    '并集应保留已消失条目（frozen）');
  ingestSnapshot(db, { device_id: devId, window_days: 7, photos: [
    { name: 'old_a.jpg', size: 100, modified: oldMs },
    { name: 'recent_c.jpg', size: 300, modified: recentMs }
  ] }, nowMs + 2000);
  const devs = getSnapshotDevices(db, nowMs + 2000);
  assert(devs.length === 1 && devs[0].device_id === devId, '设备清单应含测试设备');
  assert(devs[0].live_count === 2 && devs[0].frozen_count === 1, '命中项复活为 live，未命中保持 frozen');
  ingestSnapshot(db, { device_id: devId, window_days: 0, photos: [] }, nowMs + 3000);
  assert(getSnapshotKeySet(db).size >= 3, '空清单不得清空快照条目');
  assert.throws(() => ingestSnapshot(db, { photos: [] }), /device_id/);
  assert.throws(() => ingestSnapshot(db, { device_id: 'x' }), /photos/);
  const snapWd = ingestSnapshot(db, { device_id: devId, photos: [{ name: 'w.jpg', size: 1, modified: oldMs }] }, nowMs + 4000);
  assert(snapWd.windowDays === 0, 'window_days 缺省应沿用设备历史值');
  assert(toEpochMs(1700000000) === 1700000000000 && toEpochMs(1700000000000) === 1700000000000, '秒/毫秒时间戳归一化');

  const qGov = 'q_gov_001', qLive = 'q_gov_live', qFresh = 'q_gov_fresh', upGov = 'up_gov_001';
  const youngMs = nowMs - 3600 * 1000;
  const insQ = db.prepare(`
    INSERT INTO assets (fid, kind, file_name, size, status, source, created_at, discovered_at)
    VALUES (?, 'image', ?, ?, 'ready', ?, ?, ?)
  `);
  insQ.run(qGov, 'gov_old.jpg', 5000, 'quark', nowMs - 100 * 3600 * 1000, nowMs - 100 * 3600 * 1000);
  insQ.run(qLive, 'in_phone.jpg', 1000, 'quark', nowMs - 100 * 3600 * 1000, nowMs - 100 * 3600 * 1000);
  insQ.run(qFresh, 'fresh_unmanaged.jpg', 3000, 'quark', youngMs, youngMs);
  insQ.run(upGov, 'gov_old.jpg', 5000, 'upload', nowMs - 100 * 3600 * 1000, nowMs - 100 * 3600 * 1000);

  ingestSnapshot(db, {
    device_id: devId, window_days: 7,
    photos: [
      { name: 'in_phone.jpg', size: 1000, modified: oldMs },
      { name: 'gov_old.jpg', size: 5000, modified: oldMs }
    ]
  }, nowMs + 5000);
  applyGovernance(db, nowMs + 5000);
  assert(db.prepare('SELECT auth_state FROM assets WHERE fid=?').get(qGov).auth_state === null, '治理不再把命中快照写成 frozen');
  assert(db.prepare('SELECT auth_state FROM assets WHERE fid=?').get(qLive).auth_state === null, '未管辖资产保持 null');
  assert(db.prepare('SELECT auth_state FROM assets WHERE fid=?').get(upGov).auth_state === null, 'upload 来源不受治理管辖');
  assert(db.prepare('SELECT auth_state FROM assets WHERE fid=?').get(qFresh).auth_state === null, 'unmanaged 保持可见');

  const qHidden = 'q_hidden_revoked';
  insQ.run(qHidden, 'was_revoked.jpg', 8000, 'album', youngMs, youngMs);
  db.prepare("UPDATE assets SET auth_state='revoked' WHERE fid=?").run(qHidden);
  const qFrozenRev = 'q_frozen_rev';
  insQ.run(qFrozenRev, 'was_frozen_revoked.jpg', 8001, 'sync', youngMs, youngMs);
  db.prepare("UPDATE assets SET auth_state='frozen_revoked' WHERE fid=?").run(qFrozenRev);
  const qDeleted = 'q_deleted_keep';
  insQ.run(qDeleted, 'soft_deleted.jpg', 8002, 'album', youngMs, youngMs);
  db.prepare("UPDATE assets SET auth_state='revoked', status='deleted' WHERE fid=?").run(qDeleted);

  ingestSnapshot(db, {
    device_id: devId, window_days: 7,
    photos: [{ name: 'in_phone.jpg', size: 1000, modified: oldMs }]
  }, nowMs + 8000);
  const govRestore = applyGovernance(db, nowMs + 8000);
  assert(govRestore.revoked === 0, '相册消失不得再写 revoked');
  assert(db.prepare('SELECT auth_state FROM assets WHERE fid=?').get(qHidden).auth_state === 'live', 'revoked 应救回 live');
  assert(db.prepare('SELECT auth_state FROM assets WHERE fid=?').get(qFrozenRev).auth_state === 'live', 'frozen_revoked 应救回 live');
  assert(db.prepare('SELECT auth_state FROM assets WHERE fid=?').get(qDeleted).auth_state === 'revoked', '软删不得救回');

  const q = queryAssets(db, { all: 1 });
  const hidden = q.items.filter(i => i.auth_state && !['live', 'frozen'].includes(i.auth_state));
  assert(hidden.length === 0, '列表不得出现 revoked/frozen_revoked');
  assert(q.items.some(i => i.fid === qHidden), '救回的资产应出现在检索');
  const visSql = `SELECT fid FROM assets a WHERE ${AUTH_VISIBLE_SQL} AND fid=?`;
  assert(db.prepare(visSql).get(qHidden), 'AUTH_VISIBLE 应收 live');
  assert(!db.prepare(visSql).get(qDeleted), '软删仍不可见');
  console.log('✅ 授权治理（相册解耦/撤销救回/软删隔离）通过');

  db.close();
  fs.rmSync(testDir, { recursive: true, force: true });
  console.log(`\n🎉 所有核心集成测试全部顺利通过！`);
})();
