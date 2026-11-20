/**
 * 导入方案槽位通用材质（ambientCG CC0）
 *
 *   node scripts/import-generic-materials.js --dry-run
 *   node scripts/import-generic-materials.js --apply
 *   node scripts/import-generic-materials.js --apply --force
 *
 * 只保存 1K Color map，并自动计算平均色作为展示色。
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const sharp = require('sharp');
const { openDb } = require('../src/db');
const { extractFileFromZip } = require('../src/base-library/sources/ambientcg');
const { ensureItems, upsertCatalogItem, setItemMount } = require('../src/base-library/items');
const { GENERIC_MATERIALS } = require('../src/base-library/generic-catalog');
const { rgbToHex } = require('../src/base-library/wood-taxonomy');

const dataDir = process.env.ML_DATA_DIR || path.join(os.homedir(), '.dsh-material-library');
const args = process.argv.slice(2);
const apply = args.includes('--apply');
const force = args.includes('--force');
const dryRun = !apply || args.includes('--dry-run');
const catalogDir = path.join(dataDir, 'cache', 'base-library', 'catalog');

async function downloadColorJpg(assetId) {
  const url = `https://ambientcg.com/get?file=${assetId}_1K-JPG.zip`;
  const res = await fetch(url, {
    headers: { 'User-Agent': 'DSH-MaterialLibrary/1.0 (+generic-catalog)' },
    redirect: 'follow'
  });
  if (!res.ok) throw new Error(`${assetId} HTTP ${res.status}`);
  const zip = Buffer.from(await res.arrayBuffer());
  const jpg = extractFileFromZip(zip, '_Color.jpg');
  if (!jpg) throw new Error(`${assetId} ZIP 中没有 _Color.jpg`);
  return jpg;
}

async function averageColor(buf) {
  const { data, info } = await sharp(buf)
    .resize(1, 1, { fit: 'fill' })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const channels = info.channels || 3;
  return rgbToHex(data[0], data[channels > 1 ? 1 : 0], data[channels > 2 ? 2 : 0]);
}

(async () => {
  if (!dryRun) fs.mkdirSync(catalogDir, { recursive: true });
  const db = dryRun ? null : openDb(dataDir);
  if (db) ensureItems(db);

  const result = { mode: dryRun ? 'dry-run' : 'apply', imported: [], failed: [] };
  for (let i = 0; i < GENERIC_MATERIALS.length; i += 1) {
    const row = GENERIC_MATERIALS[i];
    const file = `${row.id}.jpg`;
    const rel = `cache/base-library/catalog/${file}`;
    const abs = path.join(catalogDir, file);
    try {
      let buf;
      if (!force && fs.existsSync(abs)) {
        buf = fs.readFileSync(abs);
      } else {
        const raw = await downloadColorJpg(row.asset);
        buf = await sharp(raw)
          .rotate()
          .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
          .jpeg({ quality: 90 })
          .toBuffer();
        if (!dryRun) fs.writeFileSync(abs, buf);
      }
      const hex = await averageColor(buf);
      if (db) {
        const written = upsertCatalogItem(db, {
          id: row.id,
          kind: 'texture',
          kind_key: row.kind_key,
          name_zh: row.name_zh,
          prompt_name: row.prompt_name || row.name_zh,
          hex,
          brand: '公共材质',
          external_id: row.id,
          source_url: `https://ambientcg.com/view?id=${row.asset}`,
          preview_rel: rel,
          gloss: row.gloss,
          pattern: row.pattern,
          origin: 'generic',
          zone: 'shared',
          name_status: 'manual'
        });
        for (const mount of row.mounts || []) setItemMount(db, written.id, mount);
      }
      result.imported.push({
        id: row.id,
        asset: row.asset,
        kind_key: row.kind_key,
        hex,
        bytes: buf.length,
        preview_rel: rel,
        mounts: row.mounts
      });
      console.log(`[${i + 1}/${GENERIC_MATERIALS.length}] ✅ ${row.asset} -> ${row.id} ${hex} (${buf.length} bytes)`);
    } catch (err) {
      result.failed.push({ id: row.id, asset: row.asset, error: err.message });
      console.error(`[${i + 1}/${GENERIC_MATERIALS.length}] ❌ ${row.asset}: ${err.message}`);
    }
  }
  console.log(JSON.stringify(result, null, 2));
  if (dryRun) console.log('dry-run：未写入文件/数据库。');
  process.exit(result.failed.length ? 1 : 0);
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
