/**
 * 回归：覆盖原图后必须失效该素材「所有」渲染档缓存。
 *
 * 背景：素材库「图片操作 / 替换原图」裁剪后，磁盘上的原图已是裁剪后的图，
 * 但 cache/grid/*.webp 等渲染档没被清理，浏览器 Accept 带 image/webp 时
 * 列表/详情继续显示旧原图 —— 用户看到「裁剪后仍是原图」。
 */
const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { clearAssetRenditionCaches } = require('../src/asset-replace');

function main() {
  const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mls-replace-cache-'));
  const fid = 'gen_crop_abc123';
  const other = 'gen_other_def456';
  const touch = (rel) => {
    const p = path.join(dataDir, rel);
    fs.mkdirSync(path.dirname(p), { recursive: true });
    fs.writeFileSync(p, rel);
    return p;
  };

  const targets = [
    `cache/thumbs/${fid}.jpg`,
    `cache/grid/${fid}.jpg`,
    `cache/grid/${fid}.webp`,
    `cache/grid/${fid}_origin.webp`,
    `cache/preview/${fid}.jpg`,
    `cache/preview/${fid}.webp`,
    `cache/preview/${fid}_29101.jpg`,
    `cache/preview/${fid}_29101.webp`,
  ];
  for (const rel of targets) touch(rel);

  const keepers = [
    `cache/thumbs/${other}.jpg`,
    `cache/grid/${other}.webp`,
    `cache/preview/${other}_origin.jpg`,
    `cache/thumbs/${fid}2.jpg`, // 前缀相似但不是同一 fid
  ];
  for (const rel of keepers) touch(rel);

  clearAssetRenditionCaches({ dataDir }, fid);

  for (const rel of targets) {
    assert.ok(!fs.existsSync(path.join(dataDir, rel)), `应删除旧渲染档：${rel}`);
  }
  for (const rel of keepers) {
    assert.ok(fs.existsSync(path.join(dataDir, rel)), `不应误删其它素材：${rel}`);
  }

  fs.rmSync(dataDir, { recursive: true, force: true });
  console.log('✔ 覆盖原图后 thumbs/grid/preview 的 jpg+webp 全部失效，其它素材不受影响');
}

try {
  main();
} catch (err) {
  console.error(err);
  process.exit(1);
}
