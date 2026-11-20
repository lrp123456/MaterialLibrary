/**
 * 导入 CC0 公共材质贴图（ambientCG），只保存 diffuse/color map。
 * 先补齐意式极简样板用到的 5 个公共材质，再导入 6 张墙纸。
 *   node scripts/import-public-materials.js --dry-run
 *   node scripts/import-public-materials.js
 */
const fs = require('fs');
const path = require('path');
const { openDb } = require('../src/db');
const { extractFileFromZip } = require('../src/base-library/sources/ambientcg');
const { ensureItems, upsertCatalogItem, setItemMount } = require('../src/base-library/items');

const dataDir = process.env.ML_DATA_DIR || path.join(process.env.HOME || process.env.USERPROFILE, '.dsh-material-library');
const db = openDb(dataDir);
ensureItems(db);
const dryRun = process.argv.includes('--dry-run');

const MAPPING = [
  { item_id: 'generic_wood_smoked_oak', asset: 'Wood066', kind_key: 'wood', name: '烟熏直纹橡木', mount: 'millwork', hex: '#5A4632', gloss: 'matte', pattern: 'wood' },
  { item_id: 'generic_metal_gunmetal', asset: 'Metal034', kind_key: 'metal_finish', name: '哑光枪灰', mount: 'metal', hex: '#565B60', gloss: 'matte', pattern: 'solid' },
  { item_id: 'generic_fabric_boucle_gray', asset: 'Fabric036', kind_key: 'fabric', name: '米灰 bouclé', mount: 'soft', hex: '#C9C0B2', gloss: 'matte', pattern: 'fabric' },
  { item_id: 'generic_fabric_linen_oat', asset: 'Fabric030', kind_key: 'fabric', name: '燕麦亚麻', mount: 'soft', hex: '#D8C7A8', gloss: 'matte', pattern: 'fabric' },
  { item_id: 'generic_wool_rug_lightgray', asset: 'Fabric045', kind_key: 'fabric', name: '浅灰羊毛地毯', mount: 'soft', hex: '#B9B7B0', gloss: 'matte', pattern: 'fabric' },
  { item_id: 'generic_wallpaper_001a', asset: 'Wallpaper001A', kind_key: 'wallpaper', name: '公共墙纸 001A', mount: 'wall', hex: '#D8D2C6', gloss: 'matte', pattern: 'wallpaper' },
  { item_id: 'generic_wallpaper_001b', asset: 'Wallpaper001B', kind_key: 'wallpaper', name: '公共墙纸 001B', mount: 'wall', hex: '#D8D2C6', gloss: 'matte', pattern: 'wallpaper' },
  { item_id: 'generic_wallpaper_001c', asset: 'Wallpaper001C', kind_key: 'wallpaper', name: '公共墙纸 001C', mount: 'wall', hex: '#D8D2C6', gloss: 'matte', pattern: 'wallpaper' },
  { item_id: 'generic_wallpaper_002a', asset: 'Wallpaper002A', kind_key: 'wallpaper', name: '公共墙纸 002A', mount: 'wall', hex: '#D8D2C6', gloss: 'matte', pattern: 'wallpaper' },
  { item_id: 'generic_wallpaper_002b', asset: 'Wallpaper002B', kind_key: 'wallpaper', name: '公共墙纸 002B', mount: 'wall', hex: '#D8D2C6', gloss: 'matte', pattern: 'wallpaper' },
  { item_id: 'generic_wallpaper_002c', asset: 'Wallpaper002C', kind_key: 'wallpaper', name: '公共墙纸 002C', mount: 'wall', hex: '#D8D2C6', gloss: 'matte', pattern: 'wallpaper' }
];

async function downloadColorJpg(assetId) {
  const url = `https://ambientcg.com/get?file=${assetId}_1K-JPG.zip`;
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`${assetId} HTTP ${res.status}`);
  const zip = Buffer.from(await res.arrayBuffer());
  const jpg = extractFileFromZip(zip, '_Color.jpg');
  if (!jpg) throw new Error(`${assetId} zip 中没有 _Color.jpg`);
  return jpg;
}

(async () => {
  const outDir = path.join(dataDir, 'cache', 'base-library', 'catalog');
  if (!dryRun) fs.mkdirSync(outDir, { recursive: true });
  const result = { dry_run: dryRun, imported: [], failed: [] };
  for (const row of MAPPING) {
    const file = `${row.item_id}.jpg`;
    const rel = `cache/base-library/catalog/${file}`;
    const abs = path.join(outDir, file);
    try {
      const buf = await downloadColorJpg(row.asset);
      if (!dryRun) fs.writeFileSync(abs, buf);
      if (!dryRun) {
        upsertCatalogItem(db, {
          id: row.item_id,
          kind: 'texture',
          kind_key: row.kind_key,
          name_zh: row.name,
          prompt_name: row.name,
          hex: row.hex,
          brand: '公共材质',
          external_id: row.item_id,
          source_url: `https://ambientcg.com/view?id=${row.asset}`,
          preview_rel: rel,
          gloss: row.gloss,
          pattern: row.pattern,
          origin: 'generic',
          zone: 'shared',
          name_status: 'manual'
        });
        db.prepare('UPDATE ba_items SET gloss = ?, pattern = ?, source_url = ? WHERE id = ?')
          .run(row.gloss, row.pattern, `https://ambientcg.com/view?id=${row.asset}`, row.item_id);
        setItemMount(db, row.item_id, row.mount);
      }
      result.imported.push({ id: row.item_id, asset: row.asset, bytes: buf.length });
      console.log(`✅ ${row.asset} -> ${file} (${buf.length} bytes)`);
    } catch (err) {
      result.failed.push({ id: row.item_id, asset: row.asset, error: err.message });
      console.error(`❌ ${row.asset}: ${err.message}`);
    }
  }
  console.log(JSON.stringify(result, null, 2));
  if (dryRun) console.log('dry-run：未写入文件/数据库。');
  process.exit(result.failed.length ? 1 : 0);
})();
