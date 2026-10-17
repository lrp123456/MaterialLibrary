/**
 * 把 cache/originals 里已有的原图迁到 NAS material（分片目录），原文件保留作备份。
 * 用法: node scripts/migrate-to-nas.js [limit]
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { openDb } = require('../src/db');
const { nasOriginalPath, nasMaterialDir, findNasOriginal } = require('../src/nasstore');

const dataDir = process.env.ML_DATA_DIR || path.join(os.homedir(), '.dsh-material-library');
const limit = Number(process.argv[2] || 500);
const db = openDb(dataDir);
const config = { dataDir, nasDir: process.env.ML_NAS_DIR || '/mnt/synology/material' };
const srcDir = path.join(dataDir, 'cache', 'originals');
if (!fs.existsSync(srcDir)) {
  console.log('no cache/originals');
  process.exit(0);
}
const files = fs.readdirSync(srcDir).filter(f => /\.(jpe?g|png|webp|heic)$/i.test(f));
console.log('cache files', files.length, 'nas', nasMaterialDir(config));
let copied = 0, skipped = 0, failed = 0;
for (const f of files) {
  if (copied >= limit) break;
  // fid is filename without ext for canonical, or prefix before _
  const base = path.basename(f, path.extname(f));
  const fid = base.includes('_') && !base.startsWith('~') ? base.split('_')[0] : base;
  if (findNasOriginal(config, fid)) { skipped++; continue; }
  const dest = nasOriginalPath(config, fid || base, f);
  try {
    fs.copyFileSync(path.join(srcDir, f), dest);
    copied++;
    if (copied % 50 === 0) console.log('copied', copied, '→', dest);
  } catch (e) {
    failed++;
    if (failed < 5) console.warn('fail', f, e.message);
  }
}
console.log(JSON.stringify({ copied, skipped, failed, nas: nasMaterialDir(config) }));
db.close();
