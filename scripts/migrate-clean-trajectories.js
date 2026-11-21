'use strict';
require('./shims/better-sqlite3-win.js');
const Database = require('better-sqlite3');
const { ruleBasedExtract } = require('../src/ai-tagger');

const dbPath = 'C:\\Users\\lrp\\.dsh-material-library-test\\material.db';
const db = new Database(dbPath);

console.log('=== 开始全量重构与清洗测试库视频走向与空间风格 ===');

// 1. 根原图风格归集 (优先提取有明确风格的基图)
const images = db.prepare("SELECT root_origin_hash, style FROM creation_templates WHERE type='image' AND style IS NOT NULL AND style != '' AND style != '未填写'").all();
const rootStyleMap = new Map();
for (const img of images) {
  if (img.root_origin_hash && !rootStyleMap.has(img.root_origin_hash)) {
    rootStyleMap.set(img.root_origin_hash, img.style);
  }
}

// 2. 获取全部未删除的模版
const rows = db.prepare('SELECT id, prompt, type, style, space, trajectory, root_origin_hash FROM creation_templates WHERE deleted_at IS NULL').all();
console.log(`总模版数: ${rows.length}`);

let videoCount = 0;
let updatedCount = 0;
const newTrajStats = {};

const tx = db.transaction(() => {
  const stmt = db.prepare('UPDATE creation_templates SET space=?, style=?, trajectory=?, operation=? WHERE id=?');
  for (const r of rows) {
    const isVid = r.type === 'video' || String(r.prompt || '').includes('视频');
    const ext = ruleBasedExtract(r.prompt, isVid ? 'video' : 'image');
    const inheritedStyle = r.root_origin_hash ? rootStyleMap.get(r.root_origin_hash) : '';

    const newSpace = (ext.space && ext.space !== '未填写') 
      ? ext.space 
      : ((r.space && r.space !== '未填写') ? r.space : ext.space);

    const newStyle = (ext.style && ext.style !== '未填写') 
      ? ext.style 
      : (inheritedStyle || ((r.style && r.style !== '未填写') ? r.style : ext.style));

    const newTraj = isVid ? (ext.trajectory || '全景空间漫游') : '';
    const newOp = ext.operation;

    stmt.run(newSpace, newStyle, newTraj, newOp, r.id);
    updatedCount++;

    if (isVid) {
      videoCount++;
      newTrajStats[newTraj] = (newTrajStats[newTraj] || 0) + 1;
    }
  }
});

tx.immediate();

console.log(`\n清洗完成！共处理 ${updatedCount} 条记录，其中视频记录 ${videoCount} 部。`);
console.log('\n=== 清洗后走向分类排行榜 ===');
const sortedTrajs = Object.entries(newTrajStats).sort((a, b) => b[1] - a[1]);
console.table(sortedTrajs.map(([t, c]) => ({ 走向: t, 数量: c })));

// 验证是否还有任何带有“左侧推门”、“说：”、“图片”等残损碎片的走向
const badCheck = db.prepare(`
  SELECT count(*) as cnt 
  FROM creation_templates 
  WHERE type='video' AND (
    trajectory LIKE '%说：%' 
    OR trajectory LIKE '%（图片%' 
    OR trajectory LIKE '%开灯%' 
    OR trajectory LIKE '%始 → 终%' 
    OR trajectory LIKE '%画面%'
    OR trajectory LIKE '%左侧推门%'
    OR trajectory LIKE '%右侧推门%'
  )
`).get();

console.log(`\n残损或受污染走向剩余条数: ${badCheck.cnt} (必须为 0)`);
if (badCheck.cnt === 0) {
  console.log('✅ 视频走向语义重构 100% 通过验证！');
} else {
  console.error('❌ 仍有受污染走向，需进一步检查！');
}
