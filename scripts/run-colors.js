/**
 * P3 色彩批处理：对未填 basic_color 的图片资产跑 extractColorRoles，写 asset_colors + basic_color + color_style。
 * 用法: node scripts/run-colors.js [limit]
 * 断点：已 basic_color 非空的行跳过（按 asset 去重）。
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const { openDb } = require('../src/db');
const { extractColorRoles, basicColorOfHex } = require('../src/colors');

const dataDir = process.env.ML_DATA_DIR || path.join(os.homedir(), '.dsh-material-library');
const limit = Number(process.argv[2] || 50);
const db = openDb(dataDir);

function findLocalFile(fid, fileName) {
  const raw = String(fid);
  const key = raw.replace(/[^A-Za-z0-9]/g, '_').slice(0, 40);
  const roots = [
    path.join(dataDir, 'cache', 'originals'),
    path.join(dataDir, 'originals'),
    path.join(dataDir, 'cache'),
    path.join(dataDir, 'cache', 'thumbs'),
  ];
  for (const r of roots) {
    if (!fs.existsSync(r)) continue;
    try {
      const hit = fs.readdirSync(r).find(f =>
        f.includes(raw.slice(0, 24)) || f.includes(key) ||
        (fileName && fileName.length > 8 && f.includes(fileName.slice(0, 16)))
      );
      if (hit) return path.join(r, hit);
    } catch {}
  }
  return null;
}

async function main() {
  const rows = db.prepare(`
    SELECT a.fid, a.file_name, a.width, a.height, a.thumb_url
    FROM assets a
    WHERE a.file_name LIKE '%.jpg' OR a.file_name LIKE '%.jpeg' OR a.file_name LIKE '%.png' OR a.file_name LIKE '%.webp'
    ORDER BY a.discovered_at DESC
    LIMIT ?
  `).all(limit * 3);

  const seen = new Set();
  const ins = db.prepare(`
    INSERT INTO asset_colors (asset_fid, hex, role, weight, name, basic_color)
    VALUES (?, ?, ?, ?, ?, ?)
    ON CONFLICT(asset_fid, role) DO UPDATE SET
      hex=excluded.hex, weight=excluded.weight, name=excluded.name, basic_color=excluded.basic_color
  `);
  const delOld = db.prepare(`DELETE FROM asset_colors WHERE asset_fid=?`);
  const tagIns = db.prepare(`
    INSERT OR IGNORE INTO asset_tags (asset_fid, tag_id, role, source, confidence, updated_at)
    SELECT ?, id, 'style', 'derived', 0.9, ? FROM tag_dict WHERE dimension='color_style' AND dir=?
  `);

  let done = 0;
  for (const a of rows) {
    if (done >= limit) break;
    if (seen.has(a.fid)) continue;
    const has = db.prepare(`SELECT 1 FROM asset_colors WHERE asset_fid=? AND basic_color IS NOT NULL AND basic_color!='' LIMIT 1`).get(a.fid);
    if (has) { seen.add(a.fid); continue; }
    const file = findLocalFile(a.fid, a.file_name);
    if (!file) continue;
    try {
      const r = await extractColorRoles(file);
      if (!r.colors.length) continue;
      delOld.run(a.fid);
      for (const c of r.colors) {
        ins.run(a.fid, c.hex, c.role, c.weight, '', c.basic || basicColorOfHex(c.hex));
      }
      for (const st of r.colorStyles) {
        // map display name to dir
        const map = {
          '黑白灰极简': 'mono_minimal', '原木日系': 'wood_japandi', '大地侘寂': 'earth_wabi',
          '莫兰迪低饱和': 'morandi', '奶油马卡龙': 'cream_macaron', '暖色调': 'warm_tone',
          '冷色调': 'cool_tone', '高饱和撞色': 'high_sat_clash',
        };
        const dir = map[st];
        if (dir) tagIns.run(a.fid, Date.now(), dir);
      }
      seen.add(a.fid);
      done++;
      if (done % 5 === 0) console.log(`[colors] ${done}/${limit} last=${a.file_name}`);
    } catch (e) {
      console.warn('[colors] fail', a.fid, e.message);
    }
  }
  console.log(`[colors] done ${done} assets`);
  db.close();
}

main().catch(e => { console.error(e); process.exit(1); });
