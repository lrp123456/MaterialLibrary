/**
 * video-analysis.test.js
 * 空间创作 · 视频逆向分析 (rea-video) 契约与运镜合成门禁测试
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { openDb } = require('../src/db');
const {
  VideoAnalysisService,
  synthesizeCameraMovement,
  getReaDir
} = require('../src/services/video-analysis');

function testSynthesizeCameraMovement() {
  // 1. 推镜头 + 稳定器 + 中景
  const shot1 = {
    features: { zoom_per_s: 0.015, pan_px_per_s: 1.0 },
    aspects: {
      camera: { result: { support_zh: '移动机位（稳定器/手持平移）', move: '推' } },
      framing: { result: { shot_size: '中景', camera_angle: '平视角' } }
    }
  };
  const syn1 = synthesizeCameraMovement(shot1);
  assert.ok(syn1.cameraSentence.includes('镜头平稳向前推进'), '推镜头动作识别');
  assert.ok(syn1.cameraSentence.includes('景别为中景'), '景别在中景');
  assert.ok(syn1.cameraSentence.includes('稳定器滑轨平滑运镜'), '稳定器运镜');
  assert.ok(syn1.promptI2V.includes('保持所挂图片里的空间和主体，只改镜头运动。'), '图生视频必须包含保持主体口诀');
  assert.ok(syn1.promptTailFrame.includes('同一空间与主体在运镜结束时的画面'), '先生尾帧提示词前缀');
  assert.ok(syn1.promptFirstLastVideo.includes('从首帧平滑运动过渡至尾帧'), '首尾帧视频提示词');

  // 2. 横移摇镜 + 手持
  const shot2 = {
    features: { zoom_per_s: 0.0001, pan_px_per_s: 14.0, pan_dir_deg: 5.0 },
    aspects: {
      camera: { result: { support_zh: '手持自拍', move: '摇/移' } },
      framing: { result: { shot_size: '特写', camera_angle: '略俯拍' } }
    }
  };
  const syn2 = synthesizeCameraMovement(shot2);
  assert.ok(syn2.cameraSentence.includes('镜头向右平稳横移') || syn2.cameraSentence.includes('摇/移'), '向右平移');
  assert.ok(syn2.cameraSentence.includes('手持微晃真实感'), '手持识别');
  assert.ok(syn2.cameraSentence.includes('景别为特写'), '特写识别');

  // 3. 固定机位
  const shot3 = {
    features: { zoom_per_s: 0.0, pan_px_per_s: 0.0 },
    aspects: {
      camera: { result: { support_zh: '三脚架固定', move: null } },
      framing: { result: { shot_size: '全景', camera_angle: '平视角' } }
    }
  };
  const syn3 = synthesizeCameraMovement(shot3);
  assert.ok(syn3.cameraSentence.includes('固定机位稳定拍摄'), '固定机位');
  assert.ok(syn3.cameraSentence.includes('三脚架固定机位'), '三脚架');
}

async function testVideoAnalysisService() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mls-test-rea-'));
  const db = openDb(tempDir);
  const config = { dataDir: tempDir };
  const services = { db, config };

  const service = new VideoAnalysisService(services);

  // 1. 空查询
  const nullResult = await service.getAnalysis('non-existent-fid');
  assert.strictEqual(nullResult, null, '未分析的视频应返回 null');

  // 2. 模拟写入分析产物
  const testFid = 'video_test_fid_001';
  const reaDir = getReaDir(config, testFid);
  fs.mkdirSync(reaDir, { recursive: true });

  const fakeBreakdown = {
    schema: 'rea_video.breakdown.v1',
    summary: { verdict: 'AI 生成视频 100%', duration: 10.0, shots: 1 },
    shots: [
      {
        id: 'shot_001',
        index: 1,
        start: 0,
        end: 10,
        duration: 10,
        aspects: {
          camera: { result: { support_zh: '稳定器', move: '推' } },
          framing: { result: { shot_size: '中景', camera_angle: '平视角' } }
        },
        assets: { first_frame: 'shots/shot_001_first.jpg', last_frame: 'shots/shot_001_last.jpg' }
      }
    ]
  };
  fs.writeFileSync(path.join(reaDir, 'breakdown.json'), JSON.stringify(fakeBreakdown));
  fs.writeFileSync(path.join(reaDir, 'report.html'), '<html><body>Report</body></html>');

  db.prepare(`
    INSERT INTO video_analyses (fid, status, error, progress, summary_json, created_at, updated_at)
    VALUES (?, 'success', '', '拆解完成', ?, ?, ?)
  `).run(testFid, JSON.stringify(fakeBreakdown.summary), Date.now(), Date.now());

  // 3. 读取分析报告
  const res = await service.getAnalysis(testFid);
  assert.ok(res, '应成功读取分析记录');
  assert.strictEqual(res.status, 'success');
  assert.strictEqual(res.hasReport, true);
  assert.ok(res.breakdown, '应装载 breakdown 数据');
  assert.strictEqual(res.breakdown.shots.length, 1);
  assert.ok(res.breakdown.shots[0].synthesized, '应附加合成运镜提示词');
  assert.ok(res.breakdown.shots[0].synthesized.promptI2V.includes('保持所挂图片里的空间和主体'));

  // 4. 重复 queueAnalysis 如果不带 reanalyze 应直接返回已有记录
  const cached = await service.queueAnalysis(testFid, { reanalyze: false });
  assert.strictEqual(cached.status, 'success', '已有成功报告时不重跑');

  // 5. 拆解历史列表查询测试
  const hist = await service.listHistory({ limit: 10 });
  assert.ok(hist && Array.isArray(hist.items), '历史列表应返回 items 数组');
  assert.strictEqual(hist.total, 1, '历史总数应为 1');
  assert.strictEqual(hist.items[0].fid, testFid, '历史第一项 fid 正确');
  assert.strictEqual(hist.items[0].status, 'success', '历史第一项状态正确');

  // 6. 路径解析测试 (_resolveVideoFile)
  // 创建一个模拟衍生文件
  const mockVideoFile = path.join(tempDir, 'mock_video.mp4');
  fs.writeFileSync(mockVideoFile, 'fake mp4 content');
  db.prepare(`
    INSERT INTO derivatives (asset_fid, kind, storage_type, storage_ref, file_name, created_at)
    VALUES (?, 'origin', 'local_cache', 'mock_video.mp4', 'mock_video.mp4', ?)
  `).run('mock_deriv_fid', Date.now());
  const resolved = await service._resolveVideoFile('mock_deriv_fid');
  assert.ok(resolved && fs.existsSync(resolved), '_resolveVideoFile 应成功定位 local_cache 文件');

  // 7. 删除拆解记录测试
  const delRes = await service.deleteRecord(testFid);
  assert.strictEqual(delRes.success, true, '应成功删除拆解记录');
  const afterDelHist = await service.listHistory();
  assert.strictEqual(afterDelHist.total, 0, '删除后历史记录应归零');
  assert.strictEqual(fs.existsSync(reaDir), false, '产物目录应被清理');

  // 8. 路径穿越安全防护测试
  let forbiddenCalled = false;
  const mockResForbidden = {
    writeHead(code) {
      if (code === 403) forbiddenCalled = true;
    },
    end() {}
  };
  service.serveAsset(testFid, '../../etc/passwd', mockResForbidden);
  assert.strictEqual(forbiddenCalled, true, '路径穿越应拦截并返回 403');

  // 清理
  try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_) {}
}

async function main() {
  testSynthesizeCameraMovement();
  await testVideoAnalysisService();
  console.log('✓ video-analysis.test.js 全部断言通过');
}

main().catch((err) => {
  console.error('✗ 测试失败:', err);
  process.exit(1);
});
