const { openDb } = require('../src/db');
const {
  computeQualityScore,
  scanSimilarityWorkbench,
  resolveSimilarityCluster,
  cleanExactDuplicates,
  listIgnoredPairs
} = require('../src/similarity-workbench');

async function run() {
  const db = openDb('./data');
  const now = Date.now();

  console.log('--- Testing Batch C: Similarity Workbench ---');

  // 清理前置测试残留
  db.prepare("DELETE FROM assets WHERE fid LIKE 'ML_BENCH_%'").run();
  db.prepare("DELETE FROM asset_trash WHERE fid LIKE 'ML_BENCH_%'").run();
  db.prepare("DELETE FROM similarity_ignored_pairs WHERE fid_a LIKE 'ML_BENCH_%' OR fid_b LIKE 'ML_BENCH_%'").run();

  // 1. 验证质量打分
  const highQualityAsset = {
    width: 3840,
    height: 2160,
    sharpness: 9.5,
    has_watermark: 0,
    orientation: '16:9',
    favorite: 1,
    created_at: now - 30 * 86400 * 1000
  };
  const lowQualityAsset = {
    width: 720,
    height: 480,
    sharpness: 2.0,
    has_watermark: 1,
    orientation: 'other',
    favorite: 0,
    created_at: now
  };
  const scoreHigh = computeQualityScore(highQualityAsset, 3);
  const scoreLow = computeQualityScore(lowQualityAsset, 0);
  console.log(`Quality scores: High=${scoreHigh}, Low=${scoreLow}`);
  if (scoreHigh <= scoreLow || scoreHigh < 80) {
    console.error('FAIL: High quality asset score should be significantly higher');
    process.exit(1);
  }

  // 2. 构造测试相似图（pHash 汉明距离为 2 的两张图）
  const fid1 = 'ML_BENCH_TEST_1_' + now;
  const fid2 = 'ML_BENCH_TEST_2_' + now;
  const phash1 = 'aaaa111122223333';
  const phash2 = 'aaaa111122223330'; // 3(0011) vs 0(0000) => 2 bits

  db.prepare(`
    INSERT INTO assets (fid, kind, category, file_name, width, height, sharpness, has_watermark, phash, sha256, status, auth_state, created_at, discovered_at, updated_at)
    VALUES (?, 'image', 'interior', 'bench_1.jpg', 3840, 2160, 9.0, 0, ?, ?, 'ready', 'live', ?, ?, ?)
  `).run(fid1, phash1, 'sha_bench_1_' + now, now, now, now);

  db.prepare(`
    INSERT INTO assets (fid, kind, category, file_name, width, height, sharpness, has_watermark, phash, sha256, status, auth_state, created_at, discovered_at, updated_at)
    VALUES (?, 'image', 'interior', 'bench_2.jpg', 1920, 1080, 5.0, 1, ?, ?, 'ready', 'live', ?, ?, ?)
  `).run(fid2, phash2, 'sha_bench_2_' + now, now + 10, now + 10, now + 10);

  // 构造模拟视频抽帧图（具有相同 pHash 但应被自动豁免保护）
  const fidStill = 'ML_BENCH_STILL_' + now;
  db.prepare(`
    INSERT INTO assets (fid, kind, category, file_name, source, source_type, width, height, sharpness, phash, sha256, status, auth_state, created_at, discovered_at, updated_at)
    VALUES (?, 'image', 'interior', 'frame_extract_001.jpg', 'video_extract', 'video_frame', 1920, 1080, 8.0, ?, ?, 'ready', 'live', ?, ?, ?)
  `).run(fidStill, phash1, 'sha_still_' + now, now + 20, now + 20, now + 20);

  // 3. 扫描工作台
  const services = {
    db,
    logger: console,
    interpreter: {
      triggerSingleNode: async (fid, node, opts) => {
        console.log(`[MockInterpreter] triggerSingleNode called for fid=${fid}, node=${node}, opts=`, opts);
        return { success: true };
      }
    }
  };

  const scanResult = await scanSimilarityWorkbench(services, { maxDist: 8 });
  const foundCluster = scanResult.similarClusters.find(c => c.members.some(m => m.fid === fid1));

  if (!foundCluster) {
    console.error('FAIL: Should find cluster containing fid1');
    process.exit(1);
  }

  // 验证视频抽帧被豁免
  const containsStill = foundCluster.members.some(m => m.fid === fidStill);
  if (containsStill) {
    console.error('FAIL: Video extract still should be exempted from similarity clusters');
    process.exit(1);
  }

  // 验证推荐保留最高分项为 fid1
  if (foundCluster.recommendedFid !== fid1) {
    console.error('FAIL: recommendedFid should be fid1, got:', foundCluster.recommendedFid);
    process.exit(1);
  }

  // 4. 执行决策：keep_selected (保留 fid1，移入回收站 fid2)
  const resolveRes = await resolveSimilarityCluster(services, {
    action: 'keep_selected',
    clusters: [{
      keepFids: [fid1],
      dropFids: [fid2],
      allFids: [fid1, fid2]
    }]
  });

  if (!resolveRes.success || resolveRes.stats.droppedCount !== 1) {
    console.error('FAIL: resolveSimilarityCluster should soft delete 1 asset');
    process.exit(1);
  }

  // 验证 fid2 状态已进回收站 (status === 'deleted')
  const asset2Row = db.prepare('SELECT status FROM assets WHERE fid = ?').get(fid2);
  if (!asset2Row || asset2Row.status !== 'deleted') {
    console.error('FAIL: fid2 should be marked as deleted, got:', asset2Row);
    process.exit(1);
  }

  // 清理测试数据
  db.prepare('DELETE FROM assets WHERE fid IN (?, ?, ?)').run(fid1, fid2, fidStill);
  db.prepare('DELETE FROM asset_trash WHERE fid IN (?, ?, ?)').run(fid1, fid2, fidStill);

  console.log('PASS: Batch C verified! Similarity workbench scanning, quality scoring, exemptions, and resolution works perfectly!');
  process.exit(0);
}

run().catch(e => {
  console.error(e);
  process.exit(1);
});
