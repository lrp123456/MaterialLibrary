/**
 * 验证直传 NAS、年月归档、差量对账与软删除治理的核心功能
 */
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const { openDb } = require('../src/db');
const { nasDateOriginalPath, nasMaterialDir } = require('../src/nasstore');
const { ingestSnapshot } = require('../src/snapshot');
const { applyGovernance } = require('../src/governance');
const { handleDirectUpload } = require('../src/stream-upload');

async function runTests() {
  console.log('=== [TEST] 开始验证 NAS 直传与差量对账核心流程 ===\n');

  const testDir = path.join(__dirname, 'temp_test_env');
  if (fs.existsSync(testDir)) {
    try { fs.rmSync(testDir, { recursive: true, force: true }); } catch {}
  }
  const testNasDir = path.join(testDir, 'nas');
  fs.mkdirSync(testNasDir, { recursive: true });


  const testConfig = {
    dataDir: testDir,
    nasDir: testNasDir
  };

  const db = openDb(testDir);
  const services = { db, config: testConfig, logger: console };

  // 测试 1: 年月归档路径测试
  console.log('Test 1: 年月路径计算与重名防覆盖...');
  const date202609 = new Date('2026-09-11T12:00:00Z').getTime();
  const pathInfo1 = nasDateOriginalPath(testConfig, {
    fileName: 'vacation.jpg',
    date: date202609,
    hash: 'abcdef123456'
  });
  console.log('  生成的 NAS 相对路径:', pathInfo1.relPath);
  if (!pathInfo1.relPath.includes('2026/09') && !pathInfo1.relPath.includes('2026\\09')) {
    throw new Error('年月路径不符合预期: ' + pathInfo1.relPath);
  }
  // 创建模拟已有文件以测试防重名
  fs.writeFileSync(pathInfo1.fullPath, 'dummy');
  const pathInfo2 = nasDateOriginalPath(testConfig, {
    fileName: 'vacation.jpg',
    date: date202609,
    hash: '998877665544'
  });
  console.log('  重名防冲突相对路径:', pathInfo2.relPath);
  if (!pathInfo2.fileName.includes('99887766')) {
    throw new Error('重名防冲突哈希追加失败: ' + pathInfo2.fileName);
  }
  console.log('  ✓ Test 1 通过!\n');

  // 测试 2: 快照摄入与差量对账
  console.log('Test 2: 快照对账与差量计算...');
  const snapPayload = {
    device_id: 'test_dev_001',
    app_version: '1.0.0',
    window_days: 3,
    photos: [
      { id: '1001', name: 'photo1.jpg', size: 1024, modified: date202609 },
      { id: '1002', name: 'photo2.jpg', size: 2048, modified: date202609 },
      { id: '1003', name: 'video1.mp4', size: 8192, modified: date202609 }
    ]
  };
  const snapRes1 = ingestSnapshot(db, snapPayload);
  console.log('  快照对账返回 needed_count:', snapRes1.needed_count);
  if (snapRes1.needed_count !== 3) {
    throw new Error(`预期需要上传 3 项，实际返回: ${snapRes1.needed_count}`);
  }
  console.log('  ✓ Test 2 通过!\n');

  // 测试 3: 模拟流式上传入库
  console.log('Test 3: 模拟流式文件直传落盘 NAS...');
  const fakeImageContent = Buffer.from('fake-jpeg-binary-stream-for-testing-123456');
  const fakeStream = Readable.from(fakeImageContent);

  const uploadRes = await handleDirectUpload(services, fakeStream, {
    fileName: 'photo1.jpg',
    dateModified: date202609,
    clientAssetId: '1001',
    source: 'sync'
  });
  console.log('  上传入库成功 fid:', uploadRes.fid);
  console.log('  落盘 NAS 实际文件路径:', uploadRes.nasPath);
  if (!fs.existsSync(uploadRes.nasPath)) {
    throw new Error('NAS 文件未落地: ' + uploadRes.nasPath);
  }

  // 再次推快照，验证 photo1.jpg 已经不需要再传
  const snapRes2 = ingestSnapshot(db, snapPayload);
  console.log('  第二次快照对账 needed_count:', snapRes2.needed_count);
  if (snapRes2.needed_count !== 2) {
    throw new Error(`已入库 1 张后，预期剩余 2 项待传，实际返回: ${snapRes2.needed_count}`);
  }
  console.log('  ✓ Test 3 通过!\n');

  // 测试 4: 相册删除不得隐藏已入库资产，且不删 NAS 物理文件
  console.log('Test 4: 相册消失后库内资产仍可见、NAS 文件保留...');
  const snapPayloadAfterDelete = {
    device_id: 'test_dev_001',
    app_version: '1.0.0',
    window_days: 3,
    photos: [
      { id: '1002', name: 'photo2.jpg', size: 2048, modified: date202609 }
    ]
  };
  ingestSnapshot(db, snapPayloadAfterDelete);
  const gov = applyGovernance(db, date202609 + 3600000);
  console.log('  治理对账结果:', JSON.stringify(gov));
  const assetRow = db.prepare('SELECT fid, auth_state, status FROM assets WHERE fid=?').get(uploadRes.fid);
  console.log('  资产当前授权状态:', assetRow.auth_state);
  if (assetRow.auth_state === 'revoked' || assetRow.auth_state === 'frozen_revoked') {
    throw new Error(`相册消失不应撤销资产，实际 auth_state=${assetRow.auth_state}`);
  }
  if (assetRow.status === 'deleted') {
    throw new Error('相册消失不应软删资产');
  }
  if (!fs.existsSync(uploadRes.nasPath)) {
    throw new Error('严重错误：相册对账导致 NAS 物理文件被删除了！');
  }
  console.log('  ✓ 库内资产仍可见，NAS 物理文件完好保留');
  console.log('  ✓ Test 4 通过!\n');

  console.log('Test 5: 实拍视频入库后直接 ready，且不触发打标...');
  const triggered = [];
  const videoServices = {
    db,
    config: testConfig,
    logger: console,
    interpreter: {
      triggerRun: async (opts) => {
        triggered.push(opts);
        return { runId: 'should-not-queue' };
      }
    }
  };
  const fakeVideo = Buffer.from('fake-mp4-binary-stream-for-testing-654321');
  const videoUpload = await handleDirectUpload(videoServices, Readable.from(fakeVideo), {
    fileName: 'lv_0_20260920000000.mp4',
    dateModified: date202609,
    clientAssetId: 'v-1003',
    source: 'sync'
  });
  const videoRow = db.prepare('SELECT kind, status, is_representative, auth_state FROM assets WHERE fid=?').get(videoUpload.fid);
  if (!videoRow || videoRow.kind !== 'video') {
    throw new Error('视频未按 kind=video 入库: ' + JSON.stringify(videoRow));
  }
  if (videoRow.status !== 'ready') {
    throw new Error('视频入库后应为 ready，实际: ' + videoRow.status);
  }
  if (Number(videoRow.is_representative) !== 1) {
    throw new Error('视频应设为代表图，实际 is_representative=' + videoRow.is_representative);
  }
  if (triggered.length !== 0) {
    throw new Error('视频不应触发默认打标工作流: ' + JSON.stringify(triggered));
  }
  console.log('  ✓ Test 5 通过! fid=', videoUpload.fid, 'status=', videoRow.status, '\n');

  // 清理临时测试环境
  try {
    fs.rmSync(testDir, { recursive: true, force: true });
  } catch {}

  console.log('🎉 所有自动化验证全部通过！');
}

runTests().catch(e => {
  console.error('❌ 测试失败:', e);
  process.exit(1);
});
