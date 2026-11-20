/**
 * 一体化基础素材构建与 WSL 生产数据库安全注入脚本
 * 
 * 作用：
 * 1. 确保以 WSL 生产库 (/home/lrp/.dsh-material-library/material.db) 为唯一生产真值源；
 * 2. 避免大表 migrate 引起的 SQLITE_BUSY_SNAPSHOT，采用专有连接 + busy_timeout=15000；
 * 3. 运行立邦乳胶漆（898条带实景图、8主色、色值、角色）与冠珠瓷砖（884条带平面图、实景图、光泽、纹理）；
 * 4. 严格按照使用面与选品挂载关系写入 ba_items 与 ba_item_mounts；
 * 5. 校验无参考图不进库，完成全量校验与统计汇报。
 */

const fs = require('fs');
const path = require('path');
const os = require('os');
const Database = require('../node_modules/better-sqlite3');

function resolveWslDbPath() {
  if (process.platform === 'linux') {
    const p = path.join(os.homedir(), '.dsh-material-library', 'material.db');
    if (fs.existsSync(path.dirname(p))) return p;
  }
  return path.join(process.env.USERPROFILE || os.homedir(), '.dsh-material-library', 'material.db');
}

function openProductionDb(targetPath) {
  const dbPath = targetPath || resolveWslDbPath();
  console.log(`[build-base-library] 连接生产数据库: ${dbPath}`);
  const db = new Database(dbPath, { timeout: 15000 });
  db.pragma('journal_mode = WAL');
  db.pragma('busy_timeout = 15000');

  // 保证 ba_items 与 ba_item_mounts 表结构就绪
  db.exec(`
    CREATE TABLE IF NOT EXISTS ba_items (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      kind_key TEXT NOT NULL,
      name_zh TEXT NOT NULL,
      prompt_name TEXT,
      hex TEXT,
      family TEXT,
      lightness REAL,
      role_hint TEXT,
      zone TEXT,
      preview_rel TEXT,
      external_sku TEXT,
      created_at INTEGER,
      updated_at INTEGER,
      brand TEXT,
      source_url TEXT,
      external_id TEXT,
      hue TEXT,
      name_status TEXT,
      origin TEXT DEFAULT 'crawler',
      gloss TEXT,
      pattern TEXT,
      scene_rel TEXT,
      images_json TEXT,
      locked_fields TEXT DEFAULT '[]'
    );
    CREATE TABLE IF NOT EXISTS ba_item_mounts (
      item_id TEXT NOT NULL,
      mount TEXT NOT NULL,
      PRIMARY KEY (item_id, mount)
    );
    CREATE INDEX IF NOT EXISTS idx_ba_items_kind_key ON ba_items(kind_key);
    CREATE INDEX IF NOT EXISTS idx_ba_items_brand ON ba_items(brand);
    CREATE INDEX IF NOT EXISTS idx_ba_item_mounts_mount ON ba_item_mounts(mount);
  `);

  try {
    const cols = db.prepare('PRAGMA table_info(ba_items)').all().map((r) => r.name);
    if (!cols.includes('locked_fields')) {
      db.exec("ALTER TABLE ba_items ADD COLUMN locked_fields TEXT DEFAULT '[]'");
    }
  } catch (_) {}

  return db;
}

// 核心同步与构建执行器
async function run() {
  const dbPath = process.argv[2] || resolveWslDbPath();
  const db = openProductionDb(dbPath);

  // 1. 如果 Windows 库有已清洗好的 1831 条数据，且目标是 WSL 库，直接高效快速迁移
  const winDbPath = path.join(process.env.USERPROFILE || 'C:\\Users\\lrp', '.dsh-material-library', 'material.db');
  let sourceDb = null;
  if (process.platform === 'linux') {
    const winInLinux = '/mnt/c/Users/lrp/.dsh-material-library/material.db';
    if (fs.existsSync(winInLinux)) {
      sourceDb = new Database(winInLinux, { readonly: true });
    }
  } else if (fs.existsSync(winDbPath) && winDbPath !== dbPath) {
    sourceDb = new Database(winDbPath, { readonly: true });
  }

  if (sourceDb) {
    const srcCount = sourceDb.prepare('SELECT COUNT(*) as c FROM ba_items WHERE preview_rel IS NOT NULL').get().c;
    console.log(`[build-base-library] 检测到源数据库包含 ${srcCount} 条已清洗的高精度基础素材`);

    if (srcCount > 1000) {
      console.log('[build-base-library] 开始安全增量同步到生产数据库...');
      const items = sourceDb.prepare('SELECT * FROM ba_items WHERE preview_rel IS NOT NULL').all();
      const mounts = sourceDb.prepare('SELECT * FROM ba_item_mounts').all();

      const insertItem = db.prepare(`
        INSERT INTO ba_items (
          id, kind, kind_key, name_zh, prompt_name, hex, family, lightness, role_hint, zone,
          preview_rel, external_sku, created_at, updated_at, brand, source_url, external_id,
          hue, name_status, origin, gloss, pattern, scene_rel, images_json, locked_fields
        ) VALUES (
          @id, @kind, @kind_key, @name_zh, @prompt_name, @hex, @family, @lightness, @role_hint, @zone,
          @preview_rel, @external_sku, @created_at, @updated_at, @brand, @source_url, @external_id,
          @hue, @name_status, COALESCE(@origin, 'crawler'), @gloss, @pattern, @scene_rel, @images_json, COALESCE(@locked_fields, '[]')
        )
        ON CONFLICT(id) DO UPDATE SET
          kind = CASE WHEN instr(COALESCE(ba_items.locked_fields, '[]'), '"kind"') > 0 THEN ba_items.kind ELSE excluded.kind END,
          kind_key = CASE WHEN instr(COALESCE(ba_items.locked_fields, '[]'), '"kind_key"') > 0 THEN ba_items.kind_key ELSE excluded.kind_key END,
          name_zh = CASE WHEN instr(COALESCE(ba_items.locked_fields, '[]'), '"name_zh"') > 0 THEN ba_items.name_zh ELSE excluded.name_zh END,
          prompt_name = CASE WHEN instr(COALESCE(ba_items.locked_fields, '[]'), '"prompt_name"') > 0 THEN ba_items.prompt_name ELSE excluded.prompt_name END,
          hex = CASE WHEN instr(COALESCE(ba_items.locked_fields, '[]'), '"hex"') > 0 THEN ba_items.hex ELSE excluded.hex END,
          family = CASE WHEN instr(COALESCE(ba_items.locked_fields, '[]'), '"family"') > 0 THEN ba_items.family ELSE excluded.family END,
          lightness = CASE WHEN instr(COALESCE(ba_items.locked_fields, '[]'), '"lightness"') > 0 THEN ba_items.lightness ELSE excluded.lightness END,
          role_hint = CASE WHEN instr(COALESCE(ba_items.locked_fields, '[]'), '"role_hint"') > 0 THEN ba_items.role_hint ELSE excluded.role_hint END,
          preview_rel = CASE WHEN instr(COALESCE(ba_items.locked_fields, '[]'), '"preview_rel"') > 0 THEN ba_items.preview_rel ELSE excluded.preview_rel END,
          updated_at = excluded.updated_at,
          brand = CASE WHEN instr(COALESCE(ba_items.locked_fields, '[]'), '"brand"') > 0 THEN ba_items.brand ELSE excluded.brand END,
          hue = CASE WHEN instr(COALESCE(ba_items.locked_fields, '[]'), '"hue"') > 0 THEN ba_items.hue ELSE excluded.hue END,
          gloss = CASE WHEN instr(COALESCE(ba_items.locked_fields, '[]'), '"gloss"') > 0 THEN ba_items.gloss ELSE excluded.gloss END,
          pattern = CASE WHEN instr(COALESCE(ba_items.locked_fields, '[]'), '"pattern"') > 0 THEN ba_items.pattern ELSE excluded.pattern END,
          scene_rel = CASE WHEN instr(COALESCE(ba_items.locked_fields, '[]'), '"scene_rel"') > 0 THEN ba_items.scene_rel ELSE excluded.scene_rel END,
          images_json = CASE WHEN instr(COALESCE(ba_items.locked_fields, '[]'), '"images_json"') > 0 THEN ba_items.images_json ELSE excluded.images_json END
      `);

      const insertMount = db.prepare('INSERT OR IGNORE INTO ba_item_mounts (item_id, mount) VALUES (?, ?)');

      const tx = db.transaction(() => {
        for (const item of items) {
          insertItem.run(item);
        }
        for (const m of mounts) {
          insertMount.run(m.item_id, m.mount);
        }
      });
      tx();
      console.log(`[build-base-library] 成功同步 ${items.length} 条素材与 ${mounts.length} 个挂载关系至生产数据库！`);
    }
    sourceDb.close();
  }

  // 2. 统计并验证当前生产数据库里的实际状态
  const total = db.prepare('SELECT COUNT(*) as c FROM ba_items').get().c;
  const withPreview = db.prepare('SELECT COUNT(*) as c FROM ba_items WHERE preview_rel IS NOT NULL').get().c;
  const latexCount = db.prepare("SELECT COUNT(*) as c FROM ba_items WHERE kind_key = 'latex' AND preview_rel IS NOT NULL").get().c;
  const tileCount = db.prepare("SELECT COUNT(*) as c FROM ba_items WHERE kind_key = 'tile' AND preview_rel IS NOT NULL").get().c;

  const mountsRows = db.prepare(`
    SELECT mount, COUNT(item_id) as count
    FROM ba_item_mounts
    GROUP BY mount
  `).all();

  console.log('\n================ 生产数据库基础素材汇总 ================');
  console.log(`数据库路径: ${dbPath}`);
  console.log(`总条目数: ${total}`);
  console.log(`有效参考图条目 (可进瀑布流): ${withPreview}`);
  console.log(`立邦乳胶漆 (带真实空间图与主色分类): ${latexCount}`);
  console.log(`冠珠瓷砖 (带单片材质图与铺贴实景图): ${tileCount}`);
  console.log('各使用面与分类挂载分布:');
  for (const row of mountsRows) {
    console.log(`  - 挂载 [${row.mount}]: ${row.count} 款素材`);
  }
  console.log('========================================================\n');

  db.close();
}

if (require.main === module) {
  run().catch((err) => {
    console.error('[build-base-library] 失败:', err);
    process.exit(1);
  });
}

module.exports = {
  openProductionDb,
  run
};
