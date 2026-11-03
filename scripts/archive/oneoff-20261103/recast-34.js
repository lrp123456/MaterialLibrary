/**
 * 把已有 restage_3_4 从原图按原比例 contain 重铺，去掉旧 cover/生图压扁。
 * 旧文件保留，只改 storage_ref。
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { openDb } = require('../src/db');
const { composeRatioCanvas } = require('../src/ratio');

const dataDir = process.env.ML_DATA_DIR || path.join(os.homedir(), '.dsh-material-library');

function findOrigin(fid) {
  const dir = path.join(dataDir, 'cache', 'originals');
  for (const ext of ['.jpg', '.jpeg', '.png', '.webp']) {
    const p = path.join(dir, fid + ext);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

async function main() {
  const db = openDb(dataDir);
  const rows = db.prepare(`
    SELECT a.fid, a.origin_orientation, d.id, d.storage_ref, d.params
    FROM derivatives d
    JOIN assets a ON a.fid = d.asset_fid
    WHERE d.kind = 'restage_3_4'
  `).all();
  console.log(`candidates ${rows.length}`);
  let ok = 0;
  let skip = 0;
  const outDir = path.join(dataDir, 'cache', 'derivatives');
  fs.mkdirSync(outDir, { recursive: true });
  for (const r of rows) {
    const src = findOrigin(r.fid);
    if (!src) {
      skip++;
      continue;
    }
    const dest = path.join(outDir, `restage_3_4_recast_${r.fid}_${Date.now()}.jpg`);
    try {
      const cal = await composeRatioCanvas(src, dest, '3:4', '1080p');
      let params = {};
      try { params = JSON.parse(r.params || '{}'); } catch { params = {}; }
      params.strategy = cal.strategy;
      params.recast = 'contain_pad_from_origin';
      params.calibrated = cal.calibrated;
      const rel = path.relative(dataDir, dest);
      db.prepare('UPDATE derivatives SET storage_ref=?, width=?, height=?, params=? WHERE id=?')
        .run(rel, cal.width, cal.height, JSON.stringify(params), r.id);
      ok++;
      console.log(`ok ${r.fid.slice(0, 12)} ${cal.strategy} ${cal.width}x${cal.height}`);
    } catch (e) {
      skip++;
      console.warn(`fail ${r.fid.slice(0, 12)} ${e.message}`);
    }
  }
  console.log(`done ok=${ok} skip=${skip}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
