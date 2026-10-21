#!/usr/bin/env node
/**
 * 《MaterialLibrary 终极整改与相似工作台执行计划》v3.0 — Batch G 全链路自动化验收
 *
 * 用法：node scripts/verify-ultimate-plan.js
 * 行为：
 *   - 在系统临时目录创建独立 dataDir / NAS 目录，绝不触碰生产数据；
 *   - 起轻量 in-process HTTP 服务（handleApi + handleEditorApi）；
 *   - 依次执行 TEST-01 ~ TEST-10，全部 PASS 退出码 0，否则 1。
 */
'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');

const ROOT = path.resolve(__dirname, '..');
const DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ml_verify_'));
const NAS_DIR = path.join(DATA_DIR, 'nas_material');
process.env.ML_NAS_DIR = NAS_DIR;
fs.mkdirSync(NAS_DIR, { recursive: true });

// ── 外部依赖打桩（必须在 require 业务模块之前）──────────────────────────────
function stubModule(absPath, exports) {
  require.cache[absPath] = {
    id: absPath,
    filename: absPath,
    loaded: true,
    exports,
    children: [],
    paths: [],
  };
}

// 1) 向量嵌入：避免工作流 index 节点访问外部模型网关
const vectorPath = require.resolve(path.join(ROOT, 'src', 'vector.js'));
stubModule(vectorPath, {
  embedCaption: async () => ({ vec: [0.11, 0.22, 0.33], model: 'stub-embedding', fallback: false }),
  storeVector: () => true,
});

// 2) 精准精修的真实 AI 通道：install / remove 由本地合成桩返回原图
const insertPath = require.resolve(path.join(ROOT, 'src', 'handlers', 'quick-insert.js'));
const removePath = require.resolve(path.join(ROOT, 'src', 'handlers', 'quick-watermark-remove.js'));
let editRunStubBuffer = null;
stubModule(insertPath, {
  handleInsert: async () => Buffer.from(editRunStubBuffer || []),
});
stubModule(removePath, {
  handleWatermarkOrRemove: async () => Buffer.from(editRunStubBuffer || []),
});

const sharp = require('sharp');
const { openDb } = require(path.join(ROOT, 'src', 'db.js'));
const auth = require(path.join(ROOT, 'src', 'auth.js'));
const { handleApi, getAssetDetail, queryAssets } = require(path.join(ROOT, 'src', 'api.js'));
const { handleEditorApi } = require(path.join(ROOT, 'src', 'editor-projects.js'));
const { registerMediaAsset } = require(path.join(ROOT, 'src', 'stream-upload.js'));
const { createDerivative, ensurePreviewJpeg, getDerivatives } = require(path.join(ROOT, 'src', 'derivatives.js'));
const { executeRestageDual, index: executeIndex } = require(path.join(ROOT, 'src', 'nodes', 'index.js'));
const { scanSimilarityWorkbench } = require(path.join(ROOT, 'src', 'similarity-workbench.js'));
const { expandDictMacros } = require(path.join(ROOT, 'src', 'prompt-compiler.js'));
const { hamming } = require(path.join(ROOT, 'src', 'qc.js'));
const { syncEndpointToLegacyTables, initModelRegistryTables } = require(path.join(ROOT, 'src', 'models-contract.js'));

// ── 运行环境 ────────────────────────────────────────────────────────────────
const logger = {
  info() {},
  warn() {},
  error() {},
  log() {},
};
const db = openDb(DATA_DIR);
const config = {
  dataDir: DATA_DIR,
  nasDir: NAS_DIR,
  cliPath: null,
  rootFid: 'test-root',
  systemFid: '',
  litellmBaseUrl: 'http://127.0.0.1:4000',
  litellmApiKey: '',
  litellmModel: 'stub',
  bffPublicBase: '',
};
const services = { db, config, logger, interpreter: null };

const ADMIN_PASS = 'verify-admin-pass';
const VIEWER_PASS = 'verify-viewer-pass';

auth.ensureUsersSchema(db);
function setLogin(username, password, role) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = auth.hashPassword(password, salt);
  const existing = db.prepare('SELECT id FROM users WHERE username=?').get(username);
  if (existing) {
    db.prepare('UPDATE users SET password_hash=?, salt=?, role=?, is_locked=0, updated_at=? WHERE id=?')
      .run(hash, salt, role, Date.now(), existing.id);
  } else {
    db.prepare('INSERT INTO users (username, password_hash, salt, role, is_locked, created_at, updated_at) VALUES (?,?,?,?,0,?,?)')
      .run(username, hash, salt, role, Date.now(), Date.now());
  }
}
setLogin('admin', ADMIN_PASS, 'admin');
setLogin('viewer', VIEWER_PASS, 'viewer');

let adminToken = '';
let viewerToken = '';
let server = null;
let baseUrl = '';

// ── 断言与输出 ──────────────────────────────────────────────────────────────
function assert(cond, msg) {
  if (!cond) throw new Error(msg || '断言失败');
}

const results = [];
let currentTestId = '';

function beginTest(id, title) {
  currentTestId = id;
  process.stdout.write(`\n[${id}] ${title}\n`);
}

function pass(detail) {
  results.push({ id: currentTestId, ok: true });
  console.log(`  PASS  ${detail || ''}`);
}

function fail(err) {
  results.push({ id: currentTestId, ok: false, error: err.message });
  console.log(`  FAIL  ${err.message}`);
}

async function runTest(id, title, fn) {
  beginTest(id, title);
  try {
    const detail = await fn();
    pass(detail);
  } catch (e) {
    fail(e);
  }
}

// ── HTTP 工具 ───────────────────────────────────────────────────────────────
function request(method, pathName, { token = '', body = null } = {}) {
  return new Promise((resolve, reject) => {
    const payload = body == null ? null : Buffer.from(JSON.stringify(body));
    const headers = {};
    if (payload) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = payload.length;
    }
    if (token) headers.Authorization = `Bearer ${token}`;
    const req = http.request(
      { host: '127.0.0.1', port: server.address().port, method, path: pathName, headers },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const buf = Buffer.concat(chunks);
          let json = null;
          try { json = JSON.parse(buf.toString('utf8')); } catch (_) {}
          resolve({ status: res.statusCode, headers: res.headers, buffer: buf, json });
        });
      }
    );
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

function startServer() {
  return new Promise((resolve) => {
    server = http.createServer(async (req, res) => {
      const u = new URL(req.url, 'http://127.0.0.1');
      try {
        if (u.pathname === '/editor-api' || u.pathname.startsWith('/editor-api/')) {
          const handled = await handleEditorApi(services, req, res);
          if (handled) return;
        }
        if (u.pathname === '/api' || u.pathname.startsWith('/api/')) {
          return await handleApi(services, req, res, '/api');
        }
        res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end('{"error":"not found"}');
      } catch (e) {
        if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({ error: e.message }));
      }
    });
    server.listen(0, '127.0.0.1', () => {
      baseUrl = `http://127.0.0.1:${server.address().port}`;
      resolve();
    });
  });
}

// ── 素材工具 ────────────────────────────────────────────────────────────────
let colorSeq = 0;

async function makeJpeg(hex = '#336699', size = 320) {
  return sharp({ create: { width: size, height: size, channels: 3, background: hex } })
    .jpeg({ quality: 90 })
    .toBuffer();
}

async function makePatternJpeg(size = 320) {
  colorSeq += 1;
  const svg = `<svg width="${size}" height="${size}" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="hsl(${(colorSeq * 37) % 360},55%,48%)"/>
    <circle cx="${size / 3}" cy="${size / 3}" r="${size / 6}" fill="#ffffff" opacity="0.8"/>
    <rect x="${(colorSeq * 13) % 120}" y="${(colorSeq * 29) % 120}" width="90" height="90" fill="#111111" opacity="0.7"/>
  </svg>`;
  return sharp(Buffer.from(svg)).jpeg({ quality: 90 }).toBuffer();
}

async function uploadImage(fileName, buffer, { category = 'interior', source = 'manual' } = {}) {
  const incoming = path.join(DATA_DIR, 'incoming', `${Date.now()}_${Math.random().toString(16).slice(2)}`);
  fs.mkdirSync(incoming, { recursive: true });
  const filePath = path.join(incoming, fileName);
  fs.writeFileSync(filePath, buffer);
  const sha256 = crypto.createHash('sha256').update(buffer).digest('hex');
  const out = await registerMediaAsset(services, {
    filePath,
    fileName,
    sha256,
    size: buffer.length,
    source,
    category,
  });
  return out;
}

function insertAsset({
  fid,
  kind = 'image',
  category = 'interior',
  status = 'ready',
  fileName = null,
  phash = null,
  width = null,
  height = null,
  durationS = null,
  parentFid = null,
  source = 'manual',
  createdAt = Date.now(),
  dominantColor = null,
}) {
  db.prepare(`
    INSERT INTO assets (
      fid, kind, category, file_name, size, width, height, status, source, sha256,
      auth_state, created_at, updated_at, phash, parent_fid, dominant_color, duration_s
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'live', ?, ?, ?, ?, ?, ?)
  `).run(
    fid,
    kind,
    category,
    fileName || `${fid}.jpg`,
    1024,
    width,
    height,
    status,
    source,
    `sha_${fid}`,
    createdAt,
    createdAt,
    phash,
    parentFid,
    dominantColor,
    durationS
  );
}

function assetFiles(fid) {
  const out = [];
  for (const d of getDerivatives(db, fid)) {
    if (!d.storage_ref) continue;
    let abs = null;
    if (d.storage_type === 'nas') abs = path.join(NAS_DIR, d.storage_ref);
    else if (d.storage_type === 'local_cache') abs = path.isAbsolute(d.storage_ref) ? d.storage_ref : path.join(DATA_DIR, d.storage_ref);
    if (abs) out.push(abs);
  }
  return out.filter((p) => fs.existsSync(p));
}

function median(nums) {
  const sorted = [...nums].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
}

async function timed(fn, rounds = 5) {
  const samples = [];
  for (let i = 0; i < rounds; i++) {
    const t0 = process.hrtime.bigint();
    await fn();
    samples.push(Number(process.hrtime.bigint() - t0) / 1e6);
  }
  return median(samples);
}

// ── 主流程 ──────────────────────────────────────────────────────────────────
async function main() {
  await startServer();

  const adminLogin = auth.login(db, 'admin', ADMIN_PASS, '127.0.0.1');
  const viewerLogin = auth.login(db, 'viewer', VIEWER_PASS, '127.0.0.1');
  assert(adminLogin && adminLogin.token, 'admin 登录失败');
  assert(viewerLogin && viewerLogin.token, 'viewer 登录失败');
  adminToken = adminLogin.token;
  viewerToken = viewerLogin.token;

  console.log('临时数据目录:', DATA_DIR);

  // 共享夹具
  const imgA = await makePatternJpeg();
  const imgB = await makeJpeg('#2E8B57');
  const upA = await uploadImage('burst_a.jpg', imgA, { category: 'interior' });
  const upB = await uploadImage('burst_b.jpg', imgB, { category: 'interior' });
  const fidA = upA.fid;
  const fidB = upB.fid;

  // 让两张同品类图的 pHash 距离固定为 3（真实上传已各自落盘，只调整指纹用于相似判定）
  const phashA = '0000000000000000';
  const phashB = '0000000000000007';
  assert(hamming(phashA, phashB) === 3, '夹具 phash 距离应为 3');
  db.prepare('UPDATE assets SET phash=? WHERE fid=?').run(phashA, fidA);
  db.prepare('UPDATE assets SET phash=? WHERE fid=?').run(phashB, fidB);

  // ── TEST-01 导出重命名四层校验 ────────────────────────────────────────────
  await runTest('TEST-01', '导出重命名四层校验', async () => {
    insertAsset({ fid: 'verify_export_01', fileName: 'export_src.jpg' });
    const buf = await makeJpeg('#8899AA');
    const derived = await createDerivative(services, {
      assetFid: 'verify_export_01',
      kind: 'origin',
      srcPath: (() => {
        const p = path.join(DATA_DIR, 'tmp_export_src.jpg');
        fs.writeFileSync(p, buf);
        return p;
      })(),
      fileName: 'export_src.jpg',
      width: 320,
      height: 320,
      mime: 'image/jpeg',
    });
    assert(derived && derived.id, '衍生图创建失败');

    const res = await request('GET', '/api/viewer/assets/verify_export_01/image/ML_SAVED_test.jpg?download=1', {
      token: viewerToken,
    });
    assert(res.status === 200, `期望 200，实际 ${res.status} ${res.buffer.toString('utf8').slice(0, 160)}`);
    const disp = String(res.headers['content-disposition'] || '');
    assert(/filename="ML_SAVED_/.test(disp), `Content-Disposition 未包含 ML_SAVED_ 文件名: ${disp}`);
    assert(res.buffer.includes(Buffer.from('MLX1|')), '响应 JPEG 未包含 MLX1| 暗标');
    const rawSha = crypto.createHash('sha256').update(buf).digest('hex');
    const taggedSha = crypto.createHash('sha256').update(res.buffer).digest('hex');
    const rawHit = db.prepare('SELECT id FROM export_registry WHERE sha256=?').get(rawSha);
    const tagHit = db.prepare('SELECT id FROM export_registry WHERE sha256=?').get(taggedSha);
    assert(rawHit, '原始哈希未写入 export_registry');
    assert(tagHit, '打标后哈希未写入 export_registry');
    assert(rawSha !== taggedSha, '打标前后哈希应不同');
    return `200 + MLX1 + 双哈希（raw=${rawSha.slice(0, 8)} tag=${taggedSha.slice(0, 8)}）`;
  });

  // ── TEST-02 全量可见图绝对查重拦截 ─────────────────────────────────────────
  await runTest('TEST-02', '可见衍生图/预览图改名重传 100% 拦截', async () => {
    const cleanBuf = await makeJpeg('#C2185B');
    const tmpSrc = path.join(DATA_DIR, 'tmp_clean_916.jpg');
    fs.writeFileSync(tmpSrc, cleanBuf);
    const cleanDeriv = await createDerivative(services, {
      assetFid: fidA,
      kind: 'clean_9_16',
      srcPath: tmpSrc,
      fileName: 'clean_9_16.jpg',
      width: 320,
      height: 320,
      mime: 'image/jpeg',
    });
    assert(cleanDeriv && cleanDeriv.id, 'clean_9_16 衍生图创建失败');

    const before = db.prepare('SELECT COUNT(*) c FROM assets').get().c;
    const dupPath = path.join(DATA_DIR, 'incoming_dup', 'image(1).jpg');
    fs.mkdirSync(path.dirname(dupPath), { recursive: true });
    fs.writeFileSync(dupPath, cleanBuf);
    const sha = crypto.createHash('sha256').update(cleanBuf).digest('hex');
    const dup = await registerMediaAsset(services, {
      filePath: dupPath,
      fileName: 'image(1).jpg',
      sha256: sha,
      size: cleanBuf.length,
      source: 'manual',
      category: 'interior',
    });
    assert(dup && (dup.deduped || dup.duplicate || dup.skippedExport), `9:16 衍生图未被拦截: ${JSON.stringify(dup)}`);
    assert(!fs.existsSync(dupPath), '被拦截的临时文件应被清理');

    // 1280p 预览图
    const preview = await ensurePreviewJpeg(services, fidA, cleanDeriv, cleanDeriv.localPath);
    assert(preview && fs.existsSync(preview), '预览图生成失败');
    const previewBuf = fs.readFileSync(preview);
    const prevPath = path.join(DATA_DIR, 'incoming_dup', 'image(1).jpg');
    fs.writeFileSync(prevPath, previewBuf);
    const prevSha = crypto.createHash('sha256').update(previewBuf).digest('hex');
    const dup2 = await registerMediaAsset(services, {
      filePath: prevPath,
      fileName: 'image(1).jpg',
      sha256: prevSha,
      size: previewBuf.length,
      source: 'manual',
      category: 'interior',
    });
    assert(dup2 && (dup2.deduped || dup2.duplicate || dup2.skippedExport), `预览图未被拦截: ${JSON.stringify(dup2)}`);

    const after = db.prepare('SELECT COUNT(*) c FROM assets').get().c;
    assert(after === before, `查重拦截后仍新增了资产: before=${before} after=${after}`);
    return '衍生图 + 预览图均拦截，资产数 0 增长';
  });

  // ── TEST-03 连拍相似图不误删 + 暂缓 restage_dual ──────────────────────────
  await runTest('TEST-03', 'pHash 距离 3 的连拍图保留 + restage_dual 暂缓', async () => {
    const filesA = assetFiles(fidA);
    const filesB = assetFiles(fidB);
    assert(filesA.length > 0 && filesB.length > 0, '两张连拍图的物理文件应存在');

    const assetB = db.prepare('SELECT * FROM assets WHERE fid=?').get(fidB);
    const out = await executeRestageDual(services, {}, assetB, {});
    assert(out && out.skipped === true, `期望 skipped，实际 ${JSON.stringify(out)}`);
    assert(out.output && out.output.reason === 'deferred_restage_similar', '未标记 deferred_restage_similar');
    assert(Array.isArray(out.flags) && out.flags.includes('deferred_restage_similar'), 'flags 未包含 deferred_restage_similar');
    for (const f of [...filesA, ...filesB]) assert(fs.existsSync(f), `物理文件被误删: ${f}`);
    return `deferred_restage_similar → ${out.output.similarToFid} (dist=${out.output.phashDistance})，文件全部保留`;
  });

  // ── TEST-04 相似工作台成簇 / 豁免 / keep_all ──────────────────────────────
  await runTest('TEST-04', '相似工作台成簇、豁免与 keep_all 白名单', async () => {
    // 视频抽帧保护对
    const v1 = await uploadImage('frame_001.jpg', await makePatternJpeg());
    const v2 = await uploadImage('frame_002.jpg', await makePatternJpeg());
    db.prepare("UPDATE assets SET source='video_frame', phash=? WHERE fid=?").run('1111111111111111', v1.fid);
    db.prepare("UPDATE assets SET source='video_frame', phash=? WHERE fid=?").run('1111111111111117', v2.fid);

    // 母子血缘保护对
    const parent = await uploadImage('parent.jpg', await makePatternJpeg());
    const child = await uploadImage('child.jpg', await makePatternJpeg());
    db.prepare('UPDATE assets SET parent_fid=?, phash=? WHERE fid=?').run(parent.fid, '2222222222222222', child.fid);
    db.prepare('UPDATE assets SET phash=? WHERE fid=?').run('2222222222222227', parent.fid);

    const scan1 = await request('GET', '/api/viewer/assets/similarity-workbench?mode=visual&maxDist=8', { token: viewerToken });
    assert(scan1.status === 200 && scan1.json?.success, `工作台扫描失败: ${scan1.status}`);
    const clusters = scan1.json.data.similarClusters || [];
    const clusterOf = (a, b) => clusters.find((c) => c.members.some((m) => m.fid === a) && c.members.some((m) => m.fid === b));
    assert(clusterOf(fidA, fidB), '相似连拍对未成簇');
    assert(!clusterOf(v1.fid, v2.fid), '视频抽帧对未被豁免');
    assert(!clusterOf(parent.fid, child.fid), '母子血缘对未被豁免');

    const resolveRes = await request('POST', '/api/viewer/assets/similarity-workbench/resolve', {
      token: adminToken,
      body: { action: 'keep_all', clusters: [{ allFids: [fidA, fidB], keepFids: [fidA, fidB], dropFids: [] }] },
    });
    assert(resolveRes.status === 200 && resolveRes.json?.success, `keep_all 失败: ${resolveRes.status}`);
    assert(resolveRes.json.data.stats.whitelistedPairs >= 1, '未写入 similarity_ignored_pairs');

    const scan2 = await request('GET', '/api/viewer/assets/similarity-workbench?mode=visual&maxDist=8', { token: viewerToken });
    const clusters2 = scan2.json?.data?.similarClusters || [];
    const again = clusters2.find((c) => c.members.some((m) => m.fid === fidA) && c.members.some((m) => m.fid === fidB));
    assert(!again, 'keep_all 后再次扫描仍出现该簇');
    return `成簇 ${clusters.length} 组，豁免 2 对，白名单 ${resolveRes.json.data.stats.whitelistedPairs} 对`;
  });

  // ── TEST-05 Admin 访问 /api/viewer/* 写接口 ───────────────────────────────
  await runTest('TEST-05', 'admin 可通过 /api/viewer/* 写接口，viewer 被拒绝', async () => {
    const sacrificial = await uploadImage('sacrificial.jpg', await makePatternJpeg());
    const adminDel = await request('DELETE', `/api/viewer/assets/${encodeURIComponent(sacrificial.fid)}`, { token: adminToken });
    assert(adminDel.status === 200, `admin DELETE 期望 200，实际 ${adminDel.status}`);

    const adminDedupe = await request('POST', '/api/viewer/assets/dedupe-library', { token: adminToken, body: { apply: false } });
    assert(adminDedupe.status === 200, `admin dedupe-library 期望 200，实际 ${adminDedupe.status}`);

    const viewerDedupe = await request('POST', '/api/viewer/assets/dedupe-library', { token: viewerToken, body: { apply: false } });
    assert([403, 404].includes(viewerDedupe.status), `viewer 写接口应被拒绝，实际 ${viewerDedupe.status}`);
    return `admin 200 / viewer ${viewerDedupe.status}（非白名单写接口按 SEC-007 拒绝）`;
  });

  // ── TEST-06 四套模型表同步桥接器 ─────────────────────────────────────────
  await runTest('TEST-06', 'llm_endpoints 修改后同步到 llm_providers 且重启不回退', async () => {
    const custom = `https://verify-${Date.now()}.volces.com/api/v3`;
    db.prepare("UPDATE llm_endpoints SET base_url=? WHERE id='volc_ark'").run(custom);
    syncEndpointToLegacyTables(db);

    const prov = db.prepare("SELECT base_url FROM llm_providers WHERE id IN ('volcengine','volc_ark')").all();
    assert(prov.length > 0, 'llm_providers 缺少 volcengine');
    for (const p of prov) assert(p.base_url === custom, `llm_providers.base_url 未同步: ${p.base_url}`);

    // 模拟重启初始化：不得被刷回默认值
    initModelRegistryTables(db);
    syncEndpointToLegacyTables(db);
    const ep = db.prepare("SELECT base_url FROM llm_endpoints WHERE id='volc_ark'").get();
    const prov2 = db.prepare("SELECT base_url FROM llm_providers WHERE id='volcengine'").get();
    assert(ep.base_url === custom && prov2.base_url === custom, '重启初始化后配置被刷回默认值');

    // resolveDirectVlmConfig 读取同一份 base_url（密钥中心只认 .env / process.env）
    process.env.ARK_API_KEY = 'verify-key';
    const { resolveDirectVlmConfig } = require(path.join(ROOT, 'src', 'providers.js'));
    const resolved = resolveDirectVlmConfig(db, 'volcengine', 'doubao-seed-2-1-lite-260915');
    assert(resolved.baseUrl === custom, `resolveDirectVlmConfig 未读取同步后的 base_url: ${resolved.baseUrl}`);
    return `同步 ${prov.length} 条 + 重启幂等 + resolver 一致`;
  });

  // ── TEST-07 _flags 持久化 + 词典宏展开 ───────────────────────────────────
  await runTest('TEST-07', '工作流 _flags 持久化与 {{@dict.xxx}} 动态展开', async () => {
    insertAsset({ fid: 'verify_flags_07', category: 'interior', status: 'processing' });
    const asset = db.prepare('SELECT * FROM assets WHERE fid=?').get('verify_flags_07');
    const out = await executeIndex(services, { embeddingModel: 'stub' }, asset, { accumulatedFlags: ['test_flag'] });
    assert(out && !out.error, `index 节点执行失败: ${JSON.stringify(out)}`);
    const flags = JSON.parse(db.prepare('SELECT ready_flags FROM assets WHERE fid=?').get('verify_flags_07').ready_flags || '[]');
    assert(flags.includes('test_flag'), `ready_flags 未包含 test_flag: ${JSON.stringify(flags)}`);

    db.prepare(`
      INSERT INTO tag_dict (dimension, dir, label, deprecated) VALUES ('space', 'verify_new_space', '验收新空间', 0)
    `).run();
    const expanded = expandDictMacros(db, '空间枚举: {{@dict.space}}');
    assert(expanded.includes('验收新空间'), `词典宏未展开新标签: ${expanded.slice(0, 120)}`);
    return 'flags 落库 + 新空间标签即时生效';
  });

  // ── TEST-08 edit-run 全操作写衍生表 + 全局去水印免选区 ───────────────────
  await runTest('TEST-08', 'edit-run install/remove 均写 derivatives 与 export_registry', async () => {
    const up = await uploadImage('edit_src.jpg', await makePatternJpeg());
    editRunStubBuffer = await makeJpeg('#3949AB');

    const derivBefore = db.prepare('SELECT COUNT(*) c FROM derivatives WHERE asset_fid=?').get(up.fid).c;
    const regBefore = db.prepare('SELECT COUNT(*) c FROM export_registry WHERE source_fid=?').get(up.fid).c;

    const productB64 = (await makeJpeg('#FFB300', 128)).toString('base64');
    const install = await request('POST', '/api/edit/run', {
      token: viewerToken,
      body: {
        assetFid: up.fid,
        op: 'install',
        region: { x1: 20, y1: 20, x2: 140, y2: 140 },
        productImage: `data:image/jpeg;base64,${productB64}`,
        productName: '验收单品',
        vlmInfo: { name: '柜体', position: '画面中央' },
        describeRegion: false,
      },
    });
    assert(install.status === 200 && install.json?.success, `install 失败: ${install.status} ${install.json?.error || ''}`);

    const remove = await request('POST', '/api/edit/run', {
      token: viewerToken,
      body: {
        assetFid: up.fid,
        op: 'remove',
        removeWatermark: true,
        vlmInfo: { name: '水印', position: '画面右下' },
        describeRegion: false,
      },
    });
    assert(remove.status === 200 && remove.json?.success, `remove 失败: ${remove.status} ${remove.json?.error || ''}`);

    const kinds = getDerivatives(db, up.fid).map((d) => d.kind);
    assert(kinds.includes('ai_insert'), `derivatives 缺少 ai_insert: ${kinds.join(',')}`);
    assert(kinds.includes('ai_remove'), `derivatives 缺少 ai_remove: ${kinds.join(',')}`);

    const derivAfter = db.prepare('SELECT COUNT(*) c FROM derivatives WHERE asset_fid=?').get(up.fid).c;
    const regAfter = db.prepare('SELECT COUNT(*) c FROM export_registry WHERE source_fid=?').get(up.fid).c;
    assert(derivAfter >= derivBefore + 2, `derivatives 未新增: ${derivBefore} → ${derivAfter}`);
    assert(regAfter > regBefore, `export_registry 未新增: ${regBefore} → ${regAfter}`);
    return `install + remove 各写 1 条衍生（kind 已校验），registry ${regBefore} → ${regAfter}`;
  });

  // ── TEST-09 菜单树颜色词表与主色检索 ─────────────────────────────────────
  await runTest('TEST-09', '菜单树中文颜色/建筑分类 + 服装人像主色检索', async () => {
    const menuRes = await request('GET', '/api/viewer/dict/menu-tree', { token: viewerToken });
    assert(menuRes.status === 200 && menuRes.json?.success, `menu-tree 失败: ${menuRes.status}`);
    const tree = menuRes.json.data;
    const allNode = tree.find((n) => n.key === 'all');
    const colorFacet = allNode?.facets?.find((f) => f.key === 'dominant_color');
    assert(colorFacet, '菜单树缺少 dominant_color 面');
    const colorValues = colorFacet.options.map((o) => o.value);
    assert(colorValues.includes('白'), `颜色 value 非中文: ${colorValues.slice(0, 8).join(',')}`);
    const exterior = tree.find((n) => n.key === 'exterior');
    assert(exterior, '菜单树缺少建筑分类 exterior');

    insertAsset({ fid: 'verify_clothing_09', category: 'clothing', dominantColor: '白' });
    insertAsset({ fid: 'verify_portrait_09', category: 'portrait', dominantColor: '白' });
    const clothingRow = db.prepare('SELECT dominant_color FROM assets WHERE fid=?').get('verify_clothing_09');
    assert(clothingRow.dominant_color === '白', '服装主色未落库');

    const clothingList = queryAssets(db, { category: 'clothing', colors: ['白'], page: 1, pageSize: 50 });
    const fids = (clothingList.items || []).map((i) => i.fid);
    assert(fids.includes('verify_clothing_09'), `服装未按颜色筛出: ${fids.join(',')}`);
    const portraitList = queryAssets(db, { category: 'portrait', colors: ['白'], page: 1, pageSize: 50 });
    assert((portraitList.items || []).some((i) => i.fid === 'verify_portrait_09'), '人像未按颜色筛出');
    return `颜色 ${colorValues.length} 项（含"白"），exterior 存在，服装/人像可检索`;
  });

  // ── TEST-10 性能基准门禁 ────────────────────────────────────────────────
  await runTest('TEST-10', 'getAssetDetail / editor-api/media / 1000 张 MIH 扫描', async () => {
    // 1) getAssetDetail 默认响应（不含 similar）
    getAssetDetail(services, fidA); // warm
    const detailMs = await timed(() => getAssetDetail(services, fidA), 9);
    assert(detailMs < 15, `getAssetDetail 中位耗时 ${detailMs.toFixed(2)}ms ≥ 15ms`);

    // 2) /editor-api/media 零 ffprobe 派生
    insertAsset({
      fid: 'verify_video_10',
      kind: 'video',
      category: 'video',
      fileName: 'verify_video.mp4',
      width: 1920,
      height: 1080,
      durationS: 12.5,
      createdAt: Date.now(),
    });
    await request('GET', '/editor-api/media', { token: viewerToken }); // warm
    const mediaMs = await timed(() => request('GET', '/editor-api/media', { token: viewerToken }), 5);
    assert(mediaMs < 20, `/editor-api/media 中位耗时 ${mediaMs.toFixed(2)}ms ≥ 20ms`);

    // 3) 1000 张素材 MIH 相似扫描
    const stmt = db.prepare(`
      INSERT INTO assets (fid, kind, category, file_name, size, width, height, status, source, sha256, auth_state, created_at, updated_at, phash)
      VALUES (?, 'image', 'interior', ?, 1024, 320, 320, 'ready', 'manual', ?, 'live', ?, ?, ?)
    `);
    const baseTs = Date.now() - 10 * 86400000;
    const insertMany = db.transaction(() => {
      for (let i = 0; i < 1000; i++) {
        const phash = crypto.randomBytes(8).toString('hex');
        stmt.run(`verify_mih_${i}`, `mih_${i}.jpg`, `sha_mih_${i}`, baseTs + i, baseTs + i, phash);
      }
    });
    insertMany();

    await scanSimilarityWorkbench(services, { mode: 'visual', maxDist: 8 }); // warm
    const scanMs = await timed(() => scanSimilarityWorkbench(services, { mode: 'visual', maxDist: 8 }), 3);
    assert(scanMs < 50, `1000 张 MIH 扫描中位耗时 ${scanMs.toFixed(2)}ms ≥ 50ms`);
    return `detail ${detailMs.toFixed(2)}ms / media ${mediaMs.toFixed(2)}ms / MIH ${scanMs.toFixed(2)}ms`;
  });
}

// ── 收尾 ────────────────────────────────────────────────────────────────────
main()
  .catch((e) => {
    console.error('\n[verify] 初始化失败:', e);
    results.push({ id: 'BOOT', ok: false, error: e.message });
  })
  .finally(async () => {
    const failures = results.filter((r) => !r.ok);
    console.log('\n================ 验收汇总 ================');
    for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.id}${r.ok ? '' : '  ' + r.error}`);
    console.log(`合计 ${results.length} 项，PASS ${results.length - failures.length}，FAIL ${failures.length}`);

    try { await new Promise((resolve) => (server ? server.close(resolve) : resolve())); } catch (_) {}
    try { db.close(); } catch (_) {}
    try {
      fs.rmSync(DATA_DIR, { recursive: true, force: true, maxRetries: 5, retryDelay: 200 });
    } catch (_) {}
    process.exit(failures.length === 0 ? 0 : 1);
  });
