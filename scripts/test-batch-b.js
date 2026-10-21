const { openDb } = require('../src/db');
const { findFingerprintHit } = require('../src/fingerprint');
const { executeRestageDual } = require('../src/nodes/index');

async function run() {
  const db = openDb('./data');

  // 1. 验证 findFingerprintHit exactOnly
  // 插入一张假资产，带 phash: '1111222233334444'
  const fidA = 'ML_TEST_BURST_A_' + Date.now();
  const fidB = 'ML_TEST_BURST_B_' + Date.now();
  const phashA = '1111222233334444';
  const phashB = '1111222233334445'; // 汉明距离 1 (最后一位 4 vs 5, 0100 vs 0101 => 1 bit)

  db.prepare(`
    INSERT INTO assets (fid, kind, category, file_name, phash, sha256, status, auth_state, created_at, discovered_at, updated_at)
    VALUES (?, 'image', 'interior', 'burst_a.jpg', ?, ?, 'ready', 'live', ?, ?, ?)
  `).run(fidA, phashA, 'sha_burst_a_' + Date.now(), Date.now(), Date.now(), Date.now());

  // 测试入库指纹拦截：exactOnly 应放行距离 1 的 phashB
  const hit = findFingerprintHit(db, { phash: phashB, sha256: 'sha_burst_b_' + Date.now() }, { exactOnly: true });
  if (hit && hit.hit) {
    console.error('FAIL: findFingerprintHit with exactOnly should not hit distance 1, got:', hit);
    process.exit(1);
  }

  // 2. 验证 executeRestageDual 暂缓生图
  const assetB = {
    fid: fidB,
    kind: 'image',
    category: 'interior',
    phash: phashB,
    created_at: Date.now() + 1000
  };

  const services = { db, logger: console };
  const res = await executeRestageDual(services, {}, assetB, {});

  if (!res || !res.flags || !res.flags.includes('deferred_restage_similar')) {
    console.error('FAIL: executeRestageDual should return deferred_restage_similar flag, got:', res);
    process.exit(1);
  }

  // 清理测试数据
  db.prepare('DELETE FROM assets WHERE fid IN (?, ?)').run(fidA, fidB);

  console.log('PASS: Batch B verified! Burst similarity allowed at ingest & deferred in restage_dual');
  process.exit(0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
