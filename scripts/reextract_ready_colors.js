const fs = require('fs');
const path = require('path');
const os = require('os');
const Database = require('better-sqlite3');
const { extractColorRoles } = require('../src/colors');

async function reextractReadyColors(db, dataDir) {
  const assets = db.prepare(`
    SELECT fid, file_name FROM assets WHERE status = 'ready'
  `).all();
  console.log(`[reextract] 准备为 ${assets.length} 个就绪资产重新精准提取主色与色卡...`);

  const thumbsDir = path.join(dataDir, 'cache', 'thumbs');
  const delColorsStmt = db.prepare("DELETE FROM asset_colors WHERE asset_fid = ?");
  const insColorStmt = db.prepare("INSERT OR REPLACE INTO asset_colors (asset_fid, hex, role, weight, name, basic_color) VALUES (?, ?, ?, ?, ?, ?)");
  const updAssetStmt = db.prepare("UPDATE assets SET dominant_color = ? WHERE fid = ?");

  let updatedCount = 0;
  const BATCH_SIZE = 16;
  const t0 = Date.now();

  for (let i = 0; i < assets.length; i += BATCH_SIZE) {
    const chunk = assets.slice(i, i + BATCH_SIZE);
    await Promise.all(chunk.map(async (a) => {
      const thumbPath = path.join(thumbsDir, `${a.fid}.jpg`);
      if (!fs.existsSync(thumbPath)) return;
      try {
        const cr = await extractColorRoles(thumbPath);
        if (cr && cr.colors && cr.colors.length) {
          delColorsStmt.run(a.fid);
          for (const c of cr.colors) {
            insColorStmt.run(a.fid, c.hex, c.role, c.weight, c.name || '', c.basic || '');
          }
          updAssetStmt.run(cr.dominantColor || '灰', a.fid);
          updatedCount++;
        }
      } catch (err) {
        // ignore single failure
      }
    }));
    if ((i + BATCH_SIZE) % 200 < BATCH_SIZE || i + BATCH_SIZE >= assets.length) {
      const pct = Math.min(100, Math.round(((i + BATCH_SIZE) / assets.length) * 100));
      console.log(`[reextract] 进度: ${pct}% (${Math.min(i + BATCH_SIZE, assets.length)}/${assets.length})`);
    }
  }

  const elapsed = ((Date.now() - t0) / 1000).toFixed(1);
  console.log(`[reextract] 完成！共精准重算 ${updatedCount} 个就绪资产，耗时 ${elapsed}s`);
}

if (require.main === module) {
  const targetDir = process.argv[2] || process.env.ML_DATA_DIR || path.join(os.homedir(), '.dsh-material-library');
  console.log('[reextract] 数据目录:', targetDir);
  const db = new Database(path.join(targetDir, 'material.db'));
  reextractReadyColors(db, targetDir).then(() => {
    db.close();
    console.log('[reextract] 退出');
  });
}

module.exports = { reextractReadyColors };
