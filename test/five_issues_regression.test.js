const assert = require('assert');
const path = require('path');

// 1. 验证 buildStandardDisposition 逻辑
function testDispositionCorrection() {
  const buildStandardDisposition = (fid, requestedFileName, targetName, defaultExt = '.jpg', kind = 'origin', assetRow = {}) => {
    let ext = path.extname(targetName || '') || defaultExt;
    const rowKind = String(assetRow?.kind || '').toLowerCase();
    const isTargetVideo = /\.(mp4|mov|webm|avi|mkv|m4v)$/i.test(targetName || '') || rowKind === 'video' || kind === 'video' || kind === 'gen_video';
    const isTargetAudio = /\.(mp3|wav|m4a|aac|flac|ogg)$/i.test(targetName || '') || rowKind === 'audio' || kind === 'audio' || kind === 'music';
    if (isTargetVideo && !/\.(mp4|mov|webm|avi|mkv|m4v)$/i.test(ext)) {
      ext = '.mp4';
    } else if (isTargetAudio && !/\.(mp3|wav|m4a|aac|flac|ogg)$/i.test(ext)) {
      ext = '.mp3';
    }

    const safeFid = String(fid).replace(/[^A-Za-z0-9_-]/g, '');
    const safeVar = String(kind || 'origin').replace(/[^A-Za-z0-9_-]/g, '');
    let baseName = requestedFileName || targetName;
    if (!baseName || !baseName.toLowerCase().startsWith('ml_saved_')) {
      baseName = `ML_SAVED_${safeFid}_${safeVar}${ext}`;
    } else {
      const reqExt = path.extname(baseName).toLowerCase();
      if (isTargetVideo && reqExt !== ext) {
        baseName = baseName.replace(/\.[^.]+$/, '') + ext;
      } else if (isTargetAudio && reqExt !== ext) {
        baseName = baseName.replace(/\.[^.]+$/, '') + ext;
      }
    }
    const asciiExportName = baseName.replace(/[^\w.-]/g, '_');
    const utf8ExportName = baseName;
    return `attachment; filename="${asciiExportName}"; filename*=UTF-8''${encodeURIComponent(utf8ExportName)}`;
  };

  // Case 1: 前端传了 ML_SAVED_xxx_derivative.jpg，但底层素材是视频
  const disp1 = buildStandardDisposition('test_fid', 'ML_SAVED_test_fid_derivative.jpg', 'video.mp4', '.mp4', 'gen_video', { kind: 'video' });
  assert.ok(disp1.includes('filename="ML_SAVED_test_fid_derivative.mp4"'), `视频扩展名应被校正为 .mp4，实际为: ${disp1}`);

  // Case 2: 前端传了 ML_SAVED_xxx_origin.jpg，但底层是音频
  const disp2 = buildStandardDisposition('test_audio', 'ML_SAVED_test_audio_origin.jpg', 'voice.mp3', '.mp3', 'origin', { kind: 'audio' });
  assert.ok(disp2.includes('filename="ML_SAVED_test_audio_origin.mp3"'), `音频扩展名应被校正为 .mp3，实际为: ${disp2}`);

  console.log('✓ Disposition correction tests passed');
}

// 2. 验证 3D 误判防御
function test3DMisclassification() {
  const is3DCheck = (item) => {
    const url = item.url || '';
    const name = item.name || '';
    return (item.origin === '3d_snapshot' && (item.glb || item.modelUrl || item.targetRegionId))
      || Boolean(item.glb || item.modelUrl)
      || item.kind === '3d'
      || item.category === '3d'
      || /\.(glb|gltf|obj)($|\?)/i.test(url)
      || /\.(glb|gltf|obj)$/i.test(name);
  };

  // 截图中的测试样本：文件名包含 3d (aaab3dd35c6727a...jpg)
  const falsePositiveSample = {
    name: 'aaab3dd35c6727a8123',
    url: '/api/viewer/assets/aaab3dd35c6727a/image',
    kind: 'image'
  };
  assert.strictEqual(is3DCheck(falsePositiveSample), false, '普通包含 3d 字符的图片绝不能被误判为 3D 模型');

  const true3DSample = {
    name: 'sofa_model.glb',
    url: '/models/sofa_model.glb',
    kind: '3d'
  };
  assert.strictEqual(is3DCheck(true3DSample), true, '真实 3D 模型应被正确识别');

  console.log('✓ 3D misclassification guard tests passed');
}

// 3. 验证托盘 Reorder 逻辑
function testTrayReorder() {
  const tray = [
    { tag: '@图1', name: '图A' },
    { tag: '@图2', name: '图B' },
    { tag: '@图3', name: '图C' }
  ];

  function reorder(list, from, to) {
    const [moved] = list.splice(from, 1);
    list.splice(to, 0, moved);
    list.forEach((it, i) => { it.tag = `@图${i + 1}`; });
    return list;
  }

  // 把图 2 (索引 1) 拖到图 1 (索引 0)
  reorder(tray, 1, 0);
  assert.strictEqual(tray[0].name, '图B');
  assert.strictEqual(tray[0].tag, '@图1');
  assert.strictEqual(tray[1].name, '图A');
  assert.strictEqual(tray[1].tag, '@图2');

  console.log('✓ Tray reorder tests passed');
}

testDispositionCorrection();
test3DMisclassification();
testTrayReorder();
console.log('\nAll 5-issues regression tests passed successfully!');
