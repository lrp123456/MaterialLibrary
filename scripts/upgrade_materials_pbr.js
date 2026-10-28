/**
 * 材质库物理材质升级脚本
 * 将 8 款核心预置材质从单色占位图升级为 ambientCG / Poly Haven 官方 3D 材质球 (Shader Ball)
 * 与 1K 真实的 PBR 漫反射纹理贴图 (Color Texture Map)。
 */

const fs = require('fs');
const path = require('path');
const https = require('https');
const os = require('os');
const Database = require('better-sqlite3');
const { extractFileFromZip } = require('../src/base-library/sources/ambientcg');

const UPGRADE_MATERIALS = [
  {
    id: 'mat_white_oak',
    name_cn: '天然白橡木木地板',
    source: 'ambientcg',
    source_id: 'WoodFloor041',
    license_note: 'ambientCG, CC0',
    sphere_url: 'https://acg-media.struffelproductions.com/file/ambientCG-Web/media/thumbnail/512-JPG-FFFFFF/WoodFloor041.jpg',
    color_zip_url: 'https://ambientcg.com/get?file=WoodFloor041_1K-JPG.zip',
    color_filename_ending: '_Color.jpg',
    ext: '.jpg'
  },
  {
    id: 'mat_black_walnut',
    name_cn: '北美黑胡桃护墙板',
    source: 'ambientcg',
    source_id: 'Wood049',
    license_note: 'ambientCG, CC0',
    sphere_url: 'https://acg-media.struffelproductions.com/file/ambientCG-Web/media/thumbnail/512-JPG-FFFFFF/Wood049.jpg',
    color_zip_url: 'https://ambientcg.com/get?file=Wood049_1K-JPG.zip',
    color_filename_ending: '_Color.jpg',
    ext: '.jpg'
  },
  {
    id: 'mat_roman_travertine',
    name_cn: '罗马洞石天然石材',
    source: 'ambientcg',
    source_id: 'Travertine001',
    license_note: 'ambientCG, CC0',
    sphere_url: 'https://acg-media.struffelproductions.com/file/ambientCG-Web/media/thumbnail/512-JPG-FFFFFF/Travertine001.jpg',
    color_zip_url: 'https://ambientcg.com/get?file=Travertine001_1K-JPG.zip',
    color_filename_ending: '_Color.jpg',
    ext: '.jpg'
  },
  {
    id: 'mat_calacatta_marble',
    name_cn: '鱼肚白大理石大板',
    source: 'polyhaven',
    source_id: 'marble_01',
    license_note: 'Poly Haven, CC0',
    sphere_url: 'https://cdn.polyhaven.com/asset_img/primary/marble_01.png?width=512',
    direct_texture_url: 'https://dl.polyhaven.org/file/ph-assets/Textures/jpg/1k/marble_01/marble_01_diff_1k.jpg',
    ext: '.png'
  },
  {
    id: 'mat_micro_cement',
    name_cn: '浅灰一体微水泥 (艺术漆壳)',
    source: 'ambientcg',
    source_id: 'Concrete034',
    license_note: 'ambientCG, CC0',
    is_shell: 1,
    sphere_url: 'https://acg-media.struffelproductions.com/file/ambientCG-Web/media/thumbnail/512-JPG-FFFFFF/Concrete034.jpg',
    color_zip_url: 'https://ambientcg.com/get?file=Concrete034_1K-JPG.zip',
    color_filename_ending: '_Color.jpg',
    ext: '.jpg'
  },
  {
    id: 'mat_linen_fabric',
    name_cn: '素色高支棉麻布艺',
    source: 'ambientcg',
    source_id: 'Fabric045',
    license_note: 'ambientCG, CC0',
    sphere_url: 'https://acg-media.struffelproductions.com/file/ambientCG-Web/media/thumbnail/512-JPG-FFFFFF/Fabric045.jpg',
    color_zip_url: 'https://ambientcg.com/get?file=Fabric045_1K-JPG.zip',
    color_filename_ending: '_Color.jpg',
    ext: '.jpg'
  },
  {
    id: 'mat_terrazzo_gray',
    name_cn: '精细无缝水磨石地砖',
    source: 'ambientcg',
    source_id: 'Terrazzo012',
    license_note: 'ambientCG, CC0',
    sphere_url: 'https://acg-media.struffelproductions.com/file/ambientCG-Web/media/thumbnail/512-JPG-FFFFFF/Terrazzo012.jpg',
    color_zip_url: 'https://ambientcg.com/get?file=Terrazzo012_1K-JPG.zip',
    color_filename_ending: '_Color.jpg',
    ext: '.jpg'
  },
  {
    id: 'mat_gypsum_cornice',
    name_cn: '精工哑光石膏天花板',
    source: 'ambientcg',
    source_id: 'Plaster001',
    license_note: 'ambientCG, CC0',
    sphere_url: 'https://acg-media.struffelproductions.com/file/ambientCG-Web/media/thumbnail/512-JPG-FFFFFF/Plaster001.jpg',
    color_zip_url: 'https://ambientcg.com/get?file=Plaster001_1K-JPG.zip',
    color_filename_ending: '_Color.jpg',
    ext: '.jpg'
  }
];

function fetchBuffer(url, timeoutMs = 25000, redirectCount = 0) {
  return new Promise((resolve, reject) => {
    if (redirectCount > 5) return reject(new Error('Too many redirects: ' + url));
    const req = https.get(url, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)' } }, res => {
      if (res.statusCode >= 300 && res.statusCode < 400 && res.headers.location) {
        let nextUrl = res.headers.location;
        if (!nextUrl.startsWith('http')) {
          const u = new URL(url);
          nextUrl = `${u.protocol}//${u.host}${nextUrl}`;
        }
        return resolve(fetchBuffer(nextUrl, timeoutMs, redirectCount + 1));
      }
      if (res.statusCode !== 200) {
        return reject(new Error(`HTTP ${res.statusCode} from ${url}`));
      }
      const chunks = [];
      res.on('data', c => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      reject(new Error(`Timeout fetching ${url}`));
    });
  });
}

async function upgradeMaterials(dataDir) {
  console.log(`[upgrade] 正在升级材质库 PBR 资产，数据目录: ${dataDir}`);
  const dbPath = path.join(dataDir, 'material.db');
  if (!fs.existsSync(dbPath)) {
    console.error(`[upgrade] 数据库不存在: ${dbPath}`);
    return;
  }

  const db = new Database(dbPath);

  // 1. 确保列 preview_rel 存在
  try {
    const cols = db.pragma('table_info(ba_materials)').map(c => c.name);
    if (!cols.includes('preview_rel')) {
      db.prepare('ALTER TABLE ba_materials ADD COLUMN preview_rel TEXT').run();
      console.log('[upgrade] 已补齐 ba_materials.preview_rel 字段');
    }
  } catch (e) {
    console.warn('[upgrade] 表结构检查警告:', e.message);
  }

  const updStmt = db.prepare(`
    UPDATE ba_materials 
    SET preview_rel = ?,
        basecolor_rel = ?,
        source = ?,
        source_id = ?,
        license_note = ?,
        updated_at = ?
    WHERE id = ?
  `);

  const now = Date.now();

  for (const m of UPGRADE_MATERIALS) {
    const matDir = path.join(dataDir, 'cache', 'base-library', 'materials', m.id);
    fs.mkdirSync(matDir, { recursive: true });

    const sphereFileName = `sphere${m.ext}`;
    const sphereRel = `cache/base-library/materials/${m.id}/${sphereFileName}`;
    const sphereFullPath = path.join(dataDir, sphereRel);

    const basecolorRel = `cache/base-library/materials/${m.id}/basecolor.jpg`;
    const basecolorFullPath = path.join(dataDir, basecolorRel);

    console.log(`\n[upgrade] 处理: ${m.name_cn} (${m.id})`);

    // 1. 下载 3D 材质球
    try {
      console.log(`  -> 正在获取 3D 材质球: ${m.sphere_url}`);
      const sphereBuf = await fetchBuffer(m.sphere_url);
      fs.writeFileSync(sphereFullPath, sphereBuf);
      console.log(`  ✓ 3D 材质球已保存 (${(sphereBuf.length / 1024).toFixed(1)} KB)`);
    } catch (e) {
      console.warn(`  ⚠ 下载材质球失败: ${e.message}`);
    }

    // 2. 获取真实漫反射 1K 纹理
    try {
      if (m.direct_texture_url) {
        console.log(`  -> 正在获取 1K 漫反射大图: ${m.direct_texture_url}`);
        const texBuf = await fetchBuffer(m.direct_texture_url);
        fs.writeFileSync(basecolorFullPath, texBuf);
        console.log(`  ✓ 1K 漫反射大图已更新 (${(texBuf.length / 1024).toFixed(1)} KB)`);
      } else if (m.color_zip_url) {
        console.log(`  -> 正在下载 1K 贴图包: ${m.color_zip_url}`);
        const zipBuf = await fetchBuffer(m.color_zip_url, 35000);
        const colorBuf = extractFileFromZip(zipBuf, m.color_filename_ending);
        if (colorBuf && colorBuf.length > 0) {
          fs.writeFileSync(basecolorFullPath, colorBuf);
          console.log(`  ✓ 已解压并更新 1K 真实纹理大图 (${(colorBuf.length / 1024).toFixed(1)} KB)`);
        } else {
          console.warn(`  ⚠ ZIP 中未找到 ${m.color_filename_ending}`);
        }
      }
    } catch (e) {
      console.warn(`  ⚠ 获取 1K 贴图失败: ${e.message}，保持当前图`);
    }

    // 3. 更新数据库
    const hasSphere = fs.existsSync(sphereFullPath);
    updStmt.run(
      hasSphere ? sphereRel : null,
      basecolorRel,
      m.source,
      m.source_id,
      m.license_note,
      now,
      m.id
    );
    console.log(`  ✓ 数据库记录已更新 (preview_rel: ${hasSphere ? sphereRel : 'NULL'})`);
  }

  db.close();
  console.log('\n[upgrade] 材质库 PBR 升级完成！');
}

if (require.main === module) {
  const targetDir = process.argv[2] || process.env.ML_DATA_DIR || path.join(os.homedir(), '.dsh-material-library');
  upgradeMaterials(targetDir).catch(err => {
    console.error('[upgrade] 失败:', err);
    process.exit(1);
  });
}

module.exports = { upgradeMaterials, UPGRADE_MATERIALS };
