/**
 * 室内设计素材库：前后端端到端 (E2E) 契约与集成测试
 * 运行独立 HTTP 服务与所有真实 API 端点，校验鉴权、权限隔离、检索、血缘、适配器与工作流。
 */
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');

const testDir = path.join(os.tmpdir(), 'dsh_e2e_test_' + Date.now());
fs.mkdirSync(testDir, { recursive: true });

process.env.ML_DATA_DIR = testDir;
process.env.ML_PORT = '8799';
process.env.ML_ADMIN_PASS = 'admin_e2e_pass';
process.env.ML_VIEWER_PASS = 'viewer_e2e_pass';

const { openDb } = require('../src/db');
const { handleApi } = require('../src/api');
const { WorkflowInterpreter } = require('../src/interpreter');
const { createDerivative, setMainDerivative } = require('../src/derivatives');

const db = openDb(testDir);
const services = {
  db,
  config: { dataDir: testDir, litellmBaseUrl: 'http://127.0.0.1:4000' },
  logger: { info: () => {}, error: () => {}, warn: () => {} }
};
const interpreter = new WorkflowInterpreter(services);
services.interpreter = interpreter;

// 插入两条测试资产：一条 9:16 主图，一条普通原图
const fid1 = 'asset_living_001';
const fid2 = 'asset_bedroom_002';
const now = Date.now();

db.prepare(`
  INSERT INTO assets (fid, kind, file_name, width, height, orientation, origin_orientation, status, created_at)
  VALUES (?, 'image', 'minimal_living.jpg', 1080, 1920, 'portrait', '9:16', 'ready', ?)
`).run(fid1, now);

db.prepare(`
  INSERT INTO assets (fid, kind, file_name, width, height, orientation, origin_orientation, status, ready_flags, created_at)
  VALUES (?, 'image', 'cozy_bedroom.jpg', 1920, 1080, 'landscape', 'landscape', 'ready_with_flags', '["restage_failed"]', ?)
`).run(fid2, now);

// 插入打标
const tagSpaceLiving = db.prepare("SELECT id FROM tag_dict WHERE dimension='space' AND dir='living_room'").get();
const tagStyleWabi = db.prepare("SELECT id FROM tag_dict WHERE dimension='style_atom' AND dir='wabi_sabi'").get();
if (tagSpaceLiving) {
  db.prepare("INSERT INTO asset_tags (asset_fid, tag_id, role, source, confidence, updated_at) VALUES (?, ?, NULL, 'ai', 0.95, ?)").run(fid1, tagSpaceLiving.id, now);
}
if (tagStyleWabi) {
  db.prepare("INSERT INTO asset_tags (asset_fid, tag_id, role, source, confidence, updated_at) VALUES (?, ?, NULL, 'ai', 0.90, ?)").run(fid1, tagStyleWabi.id, now);
}

// 插入衍生图
const deriv1 = db.prepare(`
  INSERT INTO derivatives (asset_fid, kind, storage_type, storage_ref, file_name, width, height, created_at)
  VALUES (?, 'origin', 'quark', ?, 'minimal_living.jpg', 1080, 1920, ?)
`).run(fid1, fid1, now);
setMainDerivative(db, fid1, deriv1.lastInsertRowid);

// 启动独立 HTTP 服务测试实例
const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://127.0.0.1');
  if (u.pathname.startsWith('/api')) {
    return handleApi(services, req, res, '/api');
  }
  // 静态文件
  let fp = path.join(__dirname, '../web/dist', u.pathname === '/' ? 'index.html' : u.pathname);
  if (!fs.existsSync(fp) || fs.statSync(fp).isDirectory()) fp = path.join(__dirname, '../web/dist/index.html');
  if (fs.existsSync(fp)) {
    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
    return fs.createReadStream(fp).pipe(res);
  }
  res.writeHead(404);
  res.end();
});

server.listen(8799, async () => {
  console.log('E2E HTTP Server listening on port 8799');
  try {
    const BASE = 'http://127.0.0.1:8799';

    // 1. 测试静态首页访问
    const indexRes = await fetch(`${BASE}/`);
    assert(indexRes.ok, '首页应返回 200 OK');
    const indexHtml = await indexRes.text();
    assert(indexHtml.includes('id="app"'), '首页应包含 Vue app 挂载点');
    console.log('✅ 1. 前端静态 HTML 托管测试通过');

    // 2. 测试未登录访问受保护接口
    const unauthRes = await fetch(`${BASE}/api/assets`);
    assert(unauthRes.status === 401, '未登录访问 assets 应返回 401');
    console.log('✅ 2. 未登录拦截测试通过');

    // 3. 测试 Admin 登录
    const adminLoginRes = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin_e2e_pass' })
    });
    assert(adminLoginRes.ok, 'Admin 登录应成功');
    const adminData = await adminLoginRes.json();
    const adminToken = adminData.data.token;
    assert(adminData.data.user.role === 'admin', 'Admin 角色应为 admin');
    console.log('✅ 3. 管理员登录与 Session 颁发通过');

    // 4. 测试 Viewer 登录
    const viewerLoginRes = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'viewer', password: 'viewer_e2e_pass' })
    });
    assert(viewerLoginRes.ok, 'Viewer 登录应成功');
    const viewerData = await viewerLoginRes.json();
    const viewerToken = viewerData.data.token;
    assert(viewerData.data.user.role === 'viewer', 'Viewer 角色应为 viewer');
    console.log('✅ 4. 检索员登录通过');

    // 5. 测试 Viewer 访问管理读接口全部被拒 (403，泄漏修复回归)
    const leakTargets = [
      '/api/workflows/default',
      '/api/workflows/catalog',
      '/api/runs',
      '/api/runs/run_fake',
      '/api/runs/run_fake/graph',
      '/api/runs/run_fake/assets/asset_x',
      '/api/exceptions',
      '/api/adapters',
      '/api/providers',
      '/api/models',
      '/api/snapshot-status'
    ];
    for (const p of leakTargets) {
      const r = await fetch(`${BASE}${p}`, { headers: { Authorization: `Bearer ${viewerToken}` } });
      assert(r.status === 403, `Viewer 读 ${p} 应被拒绝 (403)，实际 ${r.status}`);
    }

    const viewerSaveWfRes = await fetch(`${BASE}/api/workflows`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${viewerToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ graph: {} })
    });
    assert(viewerSaveWfRes.status === 403, 'Viewer 保存工作流应被拒绝 (403)');
    console.log('✅ 5. 严格角色权限隔离通过（管理读全部 403）');

    // 6. 测试多维检索接口 (含 9:16、ready_with_flags、空间筛选)
    const listRes = await fetch(`${BASE}/api/assets`, {
      headers: { Authorization: `Bearer ${viewerToken}` }
    });
    assert(listRes.ok, '检索应返回 200');
    const listData = (await listRes.json()).data;
    assert(listData.total === 2, '检索应包含 ready 与 ready_with_flags 共 2 条记录');
    assert(listData.items.some(i => i.fid === fid1), '应包含 fid1');
    assert(listData.items.some(i => i.fid === fid2 && i.status === 'ready_with_flags'), '应包含带异常标记的 fid2');
    console.log('✅ 6. 多维检索包含 ready_with_flags 校验通过');

    // 7. 测试空间筛选
    const spaceRes = await fetch(`${BASE}/api/assets?space=living_room`, {
      headers: { Authorization: `Bearer ${viewerToken}` }
    });
    const spaceData = (await spaceRes.json()).data;
    assert(spaceData.total === 1 && spaceData.items[0].fid === fid1, '空间筛选应精准过滤');
    console.log('✅ 7. 单维度筛选精准过滤通过');

    // 8. 测试画幅筛选 (orientation)
    const oriRes = await fetch(`${BASE}/api/assets?orientation=9:16`, {
      headers: { Authorization: `Bearer ${viewerToken}` }
    });
    const oriData = (await oriRes.json()).data;
    assert(oriData.total === 1 && oriData.items[0].fid === fid1, '9:16 画幅筛选应命中');
    console.log('✅ 8. 9:16 原图分桶画幅筛选通过');

    // 9. 测试资产详情与血缘版本
    const detailRes = await fetch(`${BASE}/api/assets/${fid1}`, {
      headers: { Authorization: `Bearer ${viewerToken}` }
    });
    assert(detailRes.ok, '资产详情应返回 200');
    const detailData = (await detailRes.json()).data;
    assert(detailData.asset.fid === fid1, '详情 fid 应匹配');
    assert(detailData.derivatives.length >= 1, '应挂载血缘衍生版本');
    console.log('✅ 9. 素材详情与血缘挂载通过');

    // 10. 测试统计接口
    const statsRes = await fetch(`${BASE}/api/stats`, {
      headers: { Authorization: `Bearer ${viewerToken}` }
    });
    const statsData = (await statsRes.json()).data;
    assert(statsData.total === 2, '统计总数应为 2');
    assert(statsData.ready === 1, 'ready 数应为 1');
    assert(statsData.readyWithFlags === 1, 'ready_with_flags 数应为 1');
    console.log('✅ 10. 实时统计数据准确');

    // 11. 测试管理员保存工作流为新版本
    const wfRes = await fetch(`${BASE}/api/workflows/default`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const wfData = (await wfRes.json()).data;
    const oldVer = wfData.version;

    const saveRes = await fetch(`${BASE}/api/workflows`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ graph: wfData.graph })
    });
    assert(saveRes.ok, '保存工作流应成功');
    const saveResult = (await saveRes.json()).data;
    assert(saveResult.version === oldVer + 1, '保存后版本号应自动递增');
    console.log(`✅ 11. 工作流版本自动升级通过 (v${oldVer} -> v${saveResult.version})`);

    // 12. 测试异常治理接口 (exceptions)
    const exRes = await fetch(`${BASE}/api/exceptions`, {
      headers: { Authorization: `Bearer ${adminToken}` }
    });
    const exData = (await exRes.json()).data;
    assert(exData.some(e => e.fid === fid2), '异常清单应包含 ready_with_flags 的资产');
    console.log('✅ 12. 异常治理列表聚合通过');

    // 13. 测试退出登录
    const logoutRes = await fetch(`${BASE}/api/auth/logout`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${viewerToken}` }
    });
    assert(logoutRes.ok, 'Logout 应返回 200');
    console.log('✅ 13. 退出登录会话销毁通过');

    const sharp = require('sharp');
    const restageFile = path.join(testDir, 'e2e_restage.jpg');
    const thumbFile = path.join(testDir, 'cache', 'thumbs', `${fid1}.jpg`);
    fs.mkdirSync(path.dirname(thumbFile), { recursive: true });
    await sharp({ create: { width: 32, height: 32, channels: 3, background: '#ff0000' } }).jpeg().toFile(thumbFile);
    await sharp({ create: { width: 108, height: 192, channels: 3, background: '#0000ff' } }).jpeg().toFile(restageFile);
    const restageRow = await createDerivative(services, {
      assetFid: fid1,
      kind: 'restage_9_16',
      srcPath: restageFile,
      fileName: 'e2e_restage.jpg',
      width: 108,
      height: 192,
      params: { generated: true, ratio: '9:16' }
    });

    const relogin = await fetch(`${BASE}/api/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'admin', password: 'admin_e2e_pass' })
    });
    const adminToken2 = (await relogin.json()).data.token;

    const derivImg = await fetch(`${BASE}/api/assets/${fid1}/image?derivative=${restageRow.id}&v=d1`, {
      headers: { Authorization: `Bearer ${adminToken2}` }
    });
    assert(derivImg.ok, '指定衍生图应能预览');
    assert(!(derivImg.headers.get('content-type') || '').includes('json'), '预览不得返回 JSON');
    const derivBuf = Buffer.from(await derivImg.arrayBuffer());
    const derivMeta = await sharp(derivBuf).metadata();
    assert(derivMeta.height > derivMeta.width, '9:16 衍生预览应是竖图');

    const upBuf = await sharp({ create: { width: 60, height: 80, channels: 3, background: '#334455' } }).jpeg().toBuffer();
    const ingestRes = await fetch(`${BASE}/api/assets/ingest`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken2}`,
        'Content-Type': 'image/jpeg',
        'X-Filename': 'harmony_shot.jpg',
        'X-Source': 'harmony',
        'X-Client-Asset-Id': 'harmony-uri-1'
      },
      body: upBuf
    });
    assert(ingestRes.ok, '直连入库应成功');
    const ingestData = (await ingestRes.json()).data;
    assert(ingestData.fid, '入库应返回 fid');
    const ingest2 = await fetch(`${BASE}/api/assets/ingest`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${adminToken2}`,
        'Content-Type': 'image/jpeg',
        'X-Filename': 'harmony_shot.jpg',
        'X-Source': 'harmony',
        'X-Client-Asset-Id': 'harmony-uri-1'
      },
      body: upBuf
    });
    const ingest2Data = (await ingest2.json()).data;
    assert.strictEqual(ingest2Data.deduped, true, '相同 client_asset_id 应幂等');
    console.log('✅ 14. 衍生预览不被缩略图劫持 + 直连入库幂等通过');

    const wfCheck = await fetch(`${BASE}/api/workflows/default`, {
      headers: { Authorization: `Bearer ${adminToken2}` }
    });
    const wfGraph = (await wfCheck.json()).data.graph;
    const types = (wfGraph.nodes || []).map(n => n.type);
    assert(types.includes('cluster') && types.includes('qc') && types.includes('materialize'), '默认工作流应含细粒度节点');
    console.log('✅ 15. 细粒度默认工作流种子通过');

    // 16. 视角端白名单面 /api/viewer/*：9 端点全部 200（viewer 与 admin 均可用）
    const viewerLogin2Res = await fetch(`${BASE}/api/viewer/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'viewer', password: 'viewer_e2e_pass' })
    });
    assert(viewerLogin2Res.ok, '视角端登录应成功');
    const viewerToken2 = (await viewerLogin2Res.json()).data.token;

    const meRes = await fetch(`${BASE}/api/viewer/auth/me`, { headers: { Authorization: `Bearer ${viewerToken2}` } });
    assert(meRes.ok && (await meRes.json()).data.role === 'viewer', '视角端 auth/me 应返回 viewer 角色');

    const vAssets = await fetch(`${BASE}/api/viewer/assets`, { headers: { Authorization: `Bearer ${viewerToken2}` } });
    assert(vAssets.ok, '视角端 assets 应 200');
    assert((await vAssets.json()).data.total === 2, '视角端检索应看到 2 条');

    const vDetail = await fetch(`${BASE}/api/viewer/assets/${fid1}`, { headers: { Authorization: `Bearer ${viewerToken2}` } });
    assert(vDetail.ok && (await vDetail.json()).data.asset.fid === fid1, '视角端详情应 200');

    const vSimilar = await fetch(`${BASE}/api/viewer/assets/${fid1}/similar`, { headers: { Authorization: `Bearer ${viewerToken2}` } });
    assert(vSimilar.ok, '视角端相似推荐应 200');

    const vImage = await fetch(`${BASE}/api/viewer/assets/${fid1}/image`, { headers: { Authorization: `Bearer ${viewerToken2}` } });
    assert(vImage.ok && (vImage.headers.get('content-type') || '').startsWith('image/'), '视角端图片流应 200 且非 JSON');

    const vDict = await fetch(`${BASE}/api/viewer/dict`, { headers: { Authorization: `Bearer ${viewerToken2}` } });
    assert(vDict.ok, '视角端字典应 200');

    const vStats = await fetch(`${BASE}/api/viewer/stats`, { headers: { Authorization: `Bearer ${viewerToken2}` } });
    const vStatsData = (await vStats.json()).data;
    assert(vStats.ok && typeof vStatsData.authStateCounts === 'object', '视角端统计应 200 且含 authStateCounts');

    const vVectors = await fetch(`${BASE}/api/viewer/vectors/status`, { headers: { Authorization: `Bearer ${viewerToken2}` } });
    assert(vVectors.ok, '视角端向量状态应 200');

    const adminOnViewer = await fetch(`${BASE}/api/viewer/assets`, { headers: { Authorization: `Bearer ${adminToken2}` } });
    assert(adminOnViewer.ok, 'admin 也应能用视角端面');
    console.log('✅ 16. /api/viewer/* 白名单 10 端点全部可用通过');

    // 17. 视角端白名单负向：管理操作 404；匿名 401；/cache/temp 收紧
    const viewerDeny = [
      ['POST', '/api/viewer/scan'],
      ['GET', '/api/viewer/users'],
      ['GET', '/api/viewer/settings/snapshots'],
      ['GET', '/api/viewer/snapshot-status'],
      ['GET', '/api/viewer/auth/quark-status'],
      ['GET', '/api/viewer/workflows/default']
    ];
    for (const [m, p] of viewerDeny) {
      const r = await fetch(`${BASE}${p}`, { method: m, headers: { Authorization: `Bearer ${viewerToken2}` } });
      assert(r.status === 404, `视角端 ${m} ${p} 应 404，实际 ${r.status}`);
    }

    const anonViewer = await fetch(`${BASE}/api/viewer/assets`);
    assert(anonViewer.status === 401, '匿名访问视角端应 401');

    const anonTemp = await fetch(`${BASE}/api/cache/temp/nonexist.jpg`);
    assert(anonTemp.status === 401, '匿名访问 /cache/temp 应 401（已收紧）');

    const authedTemp = await fetch(`${BASE}/api/cache/temp/nonexist.jpg`, { headers: { Authorization: `Bearer ${viewerToken2}` } });
    assert(authedTemp.status === 404, '已登录访问不存在的临时文件应 404 而非 401');
    console.log('✅ 17. 视角端越权 404 / 匿名 401 / cache-temp 收紧通过');

    // 18. 相册快照直收（viewer 可推快照；window_days 冻结语义；admin 看设备状态）
    const snapPush = await fetch(`${BASE}/api/viewer/snapshot`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${viewerToken2}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        device_id: 'e2e_phone_001', app_version: '1.0.0', window_days: 7, total_count: 2,
        photos: [
          { name: 'e2e_old.jpg', size: 111, modified: Date.now() - 30 * 86400000 },
          { name: 'e2e_recent.jpg', size: 222, modified: Date.now() - 3600000 }
        ]
      })
    });
    const snapData = (await snapPush.json()).data;
    assert(snapPush.ok && snapData.received === 2 && snapData.live === 2, '视角端推快照应 200 且全部 live');

    // 第二轮推送（admin 通道等价）：相册解耦语义——相册中照片消失一律冻结保留（frozen），永不因相册删除而删条目
    const snapPush2 = await fetch(`${BASE}/api/snapshot`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${adminToken2}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_id: 'e2e_phone_001', window_days: 7, photos: [] })
    });
    const snapData2 = (await snapPush2.json()).data;
    assert(snapPush2.ok && snapData2.frozen === 2 && snapData2.removed === 0,
      `相册解耦下相册清空应全部冻结不删除，实际 frozen/removed: ${snapData2.frozen}/${snapData2.removed}`);

    const badSnap = await fetch(`${BASE}/api/viewer/snapshot`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${viewerToken2}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ photos: [] })
    });
    assert(badSnap.status === 400, '缺 device_id 应 400');

    const anonSnap = await fetch(`${BASE}/api/viewer/snapshot`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ device_id: 'x', photos: [] })
    });
    assert(anonSnap.status === 401, '匿名推快照应 401');

    const statusRes = await fetch(`${BASE}/api/snapshot-status`, { headers: { Authorization: `Bearer ${adminToken2}` } });
    const statusData = (await statusRes.json()).data;
    assert(statusRes.ok && statusData.ok === true, '内置快照状态应 ok:true');
    assert(statusData.devices.length === 1 && statusData.devices[0].device_id === 'e2e_phone_001', '设备清单应含测试设备');
    assert(statusData.devices[0].frozen_count === 2, 'frozen 计数应为 2');
    assert(typeof statusData.authStateCounts === 'object', '应含 authStateCounts');
    console.log('✅ 18. 快照直收 live/frozen 冻结语义 + 设备状态通过');

    console.log(`\n🏆 全部前后端真实 HTTP E2E 集成测试无缝通过！`);
  } catch (err) {
    console.error('❌ E2E 测试异常:', err);
    process.exit(1);
  } finally {
    server.close();
    db.close();
    fs.rmSync(testDir, { recursive: true, force: true });
    process.exit(0);
  }
});
