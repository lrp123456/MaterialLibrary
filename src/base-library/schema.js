/**
 * 基础属性库与创作库统一 Schema DDL 维护
 * 约束：DDL 只有 ensureBaseLibrarySchema。scripts/migrate.js 与热路径 schemaCheckedOnce 共同调用此函数。
 */

const TOMBSTONE_RETENTION_DAYS = 90;
const TOMBSTONE_RETENTION_MS = TOMBSTONE_RETENTION_DAYS * 24 * 60 * 60 * 1000;
const DRAFT_RETENTION_MS = 24 * 60 * 60 * 1000;

/**
 * 清理超过 90 天的旧墓碑
 */
function cleanupExpiredTombstones(db, now = Date.now()) {
  try {
    const cutoff = now - TOMBSTONE_RETENTION_MS;
    db.prepare('DELETE FROM creation_template_tombstones WHERE deleted_at < ?').run(cutoff);
  } catch (e) {
    // 忽略表尚未创建或并发清理异常
  }
}

/**
 * 清理超过 24 小时的草稿记录及临时文件
 */
function cleanupExpiredDrafts(db, now = Date.now(), fsModule = null, dataDir = null) {
  try {
    const cutoff = now - DRAFT_RETENTION_MS;
    const oldDrafts = db.prepare('SELECT id, temp_rel FROM ba_drafts WHERE created_at < ?').all(cutoff);
    if (oldDrafts && oldDrafts.length > 0) {
      if (fsModule && dataDir) {
        const path = require('path');
        for (const d of oldDrafts) {
          if (d.temp_rel) {
            try {
              const fullPath = path.resolve(dataDir, d.temp_rel);
              if (fsModule.existsSync(fullPath)) fsModule.unlinkSync(fullPath);
            } catch {}
          }
        }
      }
      db.prepare('DELETE FROM ba_drafts WHERE created_at < ?').run(cutoff);
    }
  } catch (e) {}
  if (fsModule && dataDir) {
    try { require('./pretint').cleanupExpiredTintFiles(dataDir, now, fsModule); } catch (e) {}
  }
}

/**
 * 幂等初始化创作库与基础属性库 Schema
 */
function ensureBaseLibrarySchema(db) {
  // 1. creation_templates 列扩展与索引
  try { db.exec('ALTER TABLE creation_templates ADD COLUMN poster_w INTEGER;'); } catch (e) {}
  try { db.exec('ALTER TABLE creation_templates ADD COLUMN poster_h INTEGER;'); } catch (e) {}
  try {
    db.exec('CREATE INDEX IF NOT EXISTS idx_creation_tpl_updated_id ON creation_templates(updated_at, id);');
  } catch (e) {}

  // 2. 创作库删除墓碑表及索引
  db.exec(`
    CREATE TABLE IF NOT EXISTS creation_template_tombstones (
      id TEXT PRIMARY KEY,
      user_id INTEGER,
      deleted_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ct_tomb_deleted
      ON creation_template_tombstones(deleted_at, id);
  `);

  // 3. 基础属性库表结构
  db.exec(`
    -- 材质仓库
    CREATE TABLE IF NOT EXISTS ba_materials (
      id TEXT PRIMARY KEY,
      name_cn TEXT NOT NULL,
      source TEXT NOT NULL,          -- polyhaven | ambientcg | manual
      source_id TEXT,                -- 手动上传为空
      license_note TEXT,
      is_shell INTEGER NOT NULL DEFAULT 0,
      preview_rel TEXT,              -- cache/base-library/materials/{id}/sphere.jpg (3D材质球)
      basecolor_rel TEXT NOT NULL,   -- cache/base-library/materials/{id}/basecolor.jpg
      width INTEGER NOT NULL,
      height INTEGER NOT NULL,
      track TEXT NOT NULL DEFAULT 'B', -- 'A' | 'B'
      tone TEXT,                     -- light | medium | dark
      layout TEXT,                   -- plain | chevron | herringbone | tiles | grid
      is_pinned INTEGER NOT NULL DEFAULT 0,
      use_count INTEGER NOT NULL DEFAULT 0,
      deleted_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_ba_mat_source
      ON ba_materials(source, source_id) WHERE source_id IS NOT NULL AND deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_ba_mat_deleted
      ON ba_materials(deleted_at, updated_at DESC);

    -- 色号仓库 (先建表再做 ALTER 兼容补齐)
    CREATE TABLE IF NOT EXISTS ba_paints (
      id TEXT PRIMARY KEY,
      brand TEXT NOT NULL,           -- nippon-paint | dulux
      code TEXT NOT NULL,
      name_en TEXT NOT NULL,
      name_zh TEXT,
      alias_zh TEXT,
      alt_code TEXT,
      hex TEXT NOT NULL,
      family TEXT,
      lrv REAL,
      interior INTEGER NOT NULL DEFAULT 0,
      pinned INTEGER NOT NULL DEFAULT 0,
      shell_material_id TEXT,
      swatch_rel TEXT,
      source_url TEXT,
      curated INTEGER NOT NULL DEFAULT 0,
      family_key TEXT,
      display_name TEXT,
      role_hint TEXT,
      use_count INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(brand, code)
    );
    CREATE INDEX IF NOT EXISTS idx_ba_paints_pinned_brand
      ON ba_paints(pinned DESC, brand, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_ba_paints_curated
      ON ba_paints(curated DESC, family_key, lrv DESC);

    -- 空间装修面 / 部位字典表 (支持全量 CRUD)
    CREATE TABLE IF NOT EXISTS ba_parts (
      id TEXT PRIMARY KEY,
      name_zh TEXT NOT NULL,
      name_en TEXT NOT NULL DEFAULT '',
      jev_aliases TEXT NOT NULL DEFAULT '[]',
      preserve_clause_zh TEXT NOT NULL DEFAULT '',
      preserve_clause_en TEXT NOT NULL DEFAULT '',
      default_category_id TEXT NOT NULL DEFAULT '',
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_system INTEGER NOT NULL DEFAULT 1,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- 基材品类与生图路由表 (支持全量 CRUD)
    CREATE TABLE IF NOT EXISTS ba_material_categories (
      id TEXT PRIMARY KEY,
      name_zh TEXT NOT NULL,
      name_en TEXT NOT NULL DEFAULT '',
      track_mode TEXT NOT NULL DEFAULT 'track_a', -- 'track_a' | 'track_b' | 'hybrid'
      allowed_parts TEXT NOT NULL DEFAULT '[]',   -- JSON array of ba_parts.id
      default_finish_id TEXT NOT NULL DEFAULT '',
      finishes_json TEXT NOT NULL DEFAULT '[]',   -- JSON array of { id, name_zh, prompt_zh, prompt_en }
      sort_order INTEGER NOT NULL DEFAULT 0,
      is_system INTEGER NOT NULL DEFAULT 1,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );

    -- 各基材专属色卡与花色资产统一核心表 (支持全量 CRUD)
    CREATE TABLE IF NOT EXISTS ba_material_swatches (
      id TEXT PRIMARY KEY,
      category_id TEXT NOT NULL,                  -- 关联 ba_material_categories.id
      item_type TEXT NOT NULL DEFAULT 'solid_color', -- 'solid_color' (Track A) | 'texture_map' (Track B)
      name_zh TEXT NOT NULL,                      -- 美学色名/花色名，如「可可蛋奶」「意式马鞍棕」「北美黑胡桃」
      brand TEXT NOT NULL DEFAULT '',             -- 品牌/色卡体系，如「立邦」「Poltrona Frau 参考」「灵感取色」
      code TEXT NOT NULL DEFAULT '',              -- 标准色号或近似色号，如「NN0107-4」「SC-142」
      hex TEXT NOT NULL DEFAULT '#CCCCCC',        -- 标准 HEX
      lrv REAL NOT NULL DEFAULT 50.0,             -- 0~100 光反射值，自动由 HEX 计算
      color_family TEXT NOT NULL DEFAULT 'off_white', -- 'off_white'|'beige_brown'|'warm_gray'|'cool_gray'|'green_blue'|'terracotta_red'|'yellow_gold'
      style_tags TEXT NOT NULL DEFAULT '[]',      -- JSON array
      finish_override TEXT NOT NULL DEFAULT '',   -- 可选覆盖默认工艺 ID
      prompt_hint_zh TEXT NOT NULL DEFAULT '',    -- 针对特殊奢石/花砖的附加视觉描述
      prompt_hint_en TEXT NOT NULL DEFAULT '',
      texture_1k_path TEXT NOT NULL DEFAULT '',   -- 仅 texture_map 使用，指向 1024x1024 纹理图
      preview_path TEXT NOT NULL DEFAULT '',
      tintable INTEGER NOT NULL DEFAULT 0,        -- 1=支持 ?hex= Lab 预染色，0=保持原图色彩
      source_type TEXT NOT NULL DEFAULT 'curated',-- 'curated' | 'vlm_eyedropper' | 'user_manual'
      pinned INTEGER NOT NULL DEFAULT 1,
      sort_order INTEGER NOT NULL DEFAULT 0,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE INDEX IF NOT EXISTS idx_ba_swatches_cat_fam ON ba_material_swatches(category_id, color_family, lrv DESC);
  `);

  // 补齐列 preview_rel, is_pinned, use_count, track, tone, layout (幂等升级)
  try {
    const matCols = db.pragma('table_info(ba_materials)').map(c => c.name);
    if (!matCols.includes('preview_rel')) {
      db.prepare('ALTER TABLE ba_materials ADD COLUMN preview_rel TEXT').run();
    }
    if (!matCols.includes('is_pinned')) {
      db.prepare('ALTER TABLE ba_materials ADD COLUMN is_pinned INTEGER NOT NULL DEFAULT 0').run();
    }
    if (!matCols.includes('use_count')) {
      db.prepare('ALTER TABLE ba_materials ADD COLUMN use_count INTEGER NOT NULL DEFAULT 0').run();
    }
    if (!matCols.includes('track')) {
      db.prepare("ALTER TABLE ba_materials ADD COLUMN track TEXT NOT NULL DEFAULT 'B'").run();
    }
    if (!matCols.includes('tone')) {
      db.prepare('ALTER TABLE ba_materials ADD COLUMN tone TEXT').run();
    }
    if (!matCols.includes('layout')) {
      db.prepare('ALTER TABLE ba_materials ADD COLUMN layout TEXT').run();
    }
  } catch (e) {}

  try {
    const paintCols = db.pragma('table_info(ba_paints)').map(c => c.name);
    if (!paintCols.includes('use_count')) {
      db.prepare('ALTER TABLE ba_paints ADD COLUMN use_count INTEGER NOT NULL DEFAULT 0').run();
    }
    if (!paintCols.includes('curated')) {
      db.prepare('ALTER TABLE ba_paints ADD COLUMN curated INTEGER NOT NULL DEFAULT 0').run();
    }
    if (!paintCols.includes('family_key')) {
      db.prepare('ALTER TABLE ba_paints ADD COLUMN family_key TEXT').run();
    }
    if (!paintCols.includes('display_name')) {
      db.prepare('ALTER TABLE ba_paints ADD COLUMN display_name TEXT').run();
    }
    if (!paintCols.includes('role_hint')) {
      db.prepare('ALTER TABLE ba_paints ADD COLUMN role_hint TEXT').run();
    }
  } catch (e) {}

  db.exec(`
    -- 货架标签 (一个资产可挂多个装修面/子类)
    CREATE TABLE IF NOT EXISTS ba_asset_tags (
      asset_kind TEXT NOT NULL,      -- material | paint
      asset_id TEXT NOT NULL,
      surface TEXT NOT NULL,
      subclass TEXT NOT NULL,
      PRIMARY KEY (asset_kind, asset_id, surface, subclass)
    );
    CREATE INDEX IF NOT EXISTS idx_ba_tags_surface
      ON ba_asset_tags(surface, subclass, asset_kind, asset_id);

    -- 灯具预设 (五档光向 + 五档色温锚点，无文件)
    CREATE TABLE IF NOT EXISTS ba_light_presets (
      id TEXT PRIMARY KEY,           -- dir_left … / cct_2700 …
      kind TEXT NOT NULL,            -- direction | cct
      label_zh TEXT NOT NULL,
      direction_key TEXT,
      kelvin INTEGER,
      sort INTEGER NOT NULL
    );

    -- 模型仓库 (本版占位，内容为空，POST 直接 409)
    CREATE TABLE IF NOT EXISTS ba_models (
      id TEXT PRIMARY KEY,
      note TEXT
    );

    -- 芯片预设插槽 (对齐现有文字芯片)
    CREATE TABLE IF NOT EXISTS ba_preset_slots (
      id TEXT PRIMARY KEY,           -- 与 material-presets.js 的芯片 id 对齐
      name_cn TEXT NOT NULL,
      subclass TEXT,                 -- 编辑器筛选，不是来源 category
      material_id TEXT,              -- 空表示还没有老实的贴图
      updated_at INTEGER NOT NULL
    );

    -- 底图价签绑定 (场景绑定是底图上的价签，不是第五个仓库)
    CREATE TABLE IF NOT EXISTS ba_image_bindings (
      image_key TEXT PRIMARY KEY,
      regions_json TEXT NOT NULL,
      light_mode TEXT,
      kelvin INTEGER,
      updated_at INTEGER NOT NULL
    );

    -- 色号镜像运行状态
    CREATE TABLE IF NOT EXISTS ba_mirror_runs (
      brand TEXT PRIMARY KEY,
      offset INTEGER NOT NULL,
      written INTEGER NOT NULL,
      state TEXT NOT NULL,
      error TEXT,
      updated_at INTEGER NOT NULL
    );

    -- 草稿表 (24 小时未确认自动清理)
    CREATE TABLE IF NOT EXISTS ba_drafts (
      id TEXT PRIMARY KEY,
      temp_rel TEXT NOT NULL,
      source TEXT NOT NULL,
      source_id TEXT,
      license_note TEXT,
      prefill_json TEXT,
      is_flat_swatch INTEGER,
      created_at INTEGER NOT NULL
    );

    -- 账号下的操作指南。内置的删和留白不写入这张表。
    CREATE TABLE IF NOT EXISTS ba_operation_guides (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      name TEXT NOT NULL,
      type TEXT NOT NULL,
      slots_json TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_ba_guides_user
      ON ba_operation_guides(user_id, updated_at);

    -- 基础属性库控制标志开关
    CREATE TABLE IF NOT EXISTS ba_flags (
      key TEXT PRIMARY KEY,
      value INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  // 4. 灯具种子化 (五档方向 + 五档色温)
  const insLight = db.prepare(`
    INSERT OR IGNORE INTO ba_light_presets (id, kind, label_zh, direction_key, kelvin, sort)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  insLight.run('dir_left', 'direction', '画面左侧', 'left', null, 10);
  insLight.run('dir_upper_left', 'direction', '左上方', 'upper_left', null, 20);
  insLight.run('dir_top', 'direction', '正上方', 'top', null, 30);
  insLight.run('dir_upper_right', 'direction', '右上方', 'upper_right', null, 40);
  insLight.run('dir_right', 'direction', '画面右侧', 'right', null, 50);

  insLight.run('cct_2700', 'cct', '2700K 暖黄', null, 2700, 10);
  insLight.run('cct_3000', 'cct', '3000K 暖白', null, 3000, 20);
  insLight.run('cct_4000', 'cct', '4000K 自然白', null, 4000, 30);
  insLight.run('cct_5000', 'cct', '5000K 正白', null, 5000, 40);
  insLight.run('cct_6500', 'cct', '6500K 冷白', null, 6500, 50);

  // 5. 预设槽种子化 (芯片插槽，material_id 初始为 NULL)
  const now = Date.now();
  const insSlot = db.prepare(`
    INSERT OR IGNORE INTO ba_preset_slots (id, name_cn, subclass, material_id, updated_at)
    VALUES (?, ?, ?, ?, ?)
  `);
  insSlot.run('micro_cement', '微水泥', null, null, now);
  insSlot.run('travertine_stone', '洞石', 'floor_stone', null, now);
  insSlot.run('walnut_wood', '胡桃木', 'floor_wood', null, now);
  insSlot.run('linen_fabric', '棉麻布艺', 'soft_fabric', null, now);
  insSlot.run('brushed_brass', '拉丝黄铜', null, null, now);
  insSlot.run('tinted_glass', '灰玻', null, null, now);

  // 6. 控制标志种子化
  const insFlag = db.prepare(`
    INSERT OR IGNORE INTO ba_flags (key, value, updated_at)
    VALUES (?, ?, ?)
  `);
  insFlag.run('base_library_paints', 1, now);
  insFlag.run('base_library_jev', 1, now);
  const jevMigrated = db.prepare(`SELECT value FROM ba_flags WHERE key = 'base_library_jev_migrated'`).get();
  if (!jevMigrated) {
    db.prepare(`UPDATE ba_flags SET value = 1, updated_at = ? WHERE key = 'base_library_jev'`).run(now);
    insFlag.run('base_library_jev_migrated', 1, now);
  }
  insFlag.run('base_library_compile', 0, now);
  insFlag.run('creation_tpl_incremental', 1, now);
  insFlag.run('base_library_write', 1, now);

  // 7. 启动清理
  cleanupExpiredTombstones(db, now);
  cleanupExpiredDrafts(db, now);
  try { require('./items').ensureItems(db); } catch (e) { console.warn('[base-library] ensureItems error:', e.message); }

  // 8. 策展色卡幂等同步（只写数据库行，确保任何环境启动即可读到 62 款策展色卡）
  try {
    const { CURATED_PAINTS } = require('./curated-paints');
    const upsertCurated = db.prepare(`
      INSERT INTO ba_paints (
        id, brand, code, name_en, name_zh, alias_zh, hex, family, lrv,
        interior, pinned, shell_material_id, swatch_rel, source_url,
        curated, family_key, display_name, role_hint, use_count, created_at, updated_at
      ) VALUES (
        @id, @brand, @code, @name_en, @display_name, @display_name, @hex, @family_key, @lrv,
        @interior, 0, NULL, @swatch_rel, @source_url,
        1, @family_key, @display_name, @role_hint, 0, @created_at, @updated_at
      )
      ON CONFLICT(brand, code) DO UPDATE SET
        curated = 1,
        family_key = excluded.family_key,
        display_name = excluded.display_name,
        role_hint = excluded.role_hint,
        hex = excluded.hex,
        lrv = excluded.lrv,
        interior = excluded.interior,
        updated_at = excluded.updated_at
    `);
    const syncCuratedTx = db.transaction(() => {
      for (const cp of CURATED_PAINTS) {
        upsertCurated.run({
          ...cp,
          swatch_rel: `cache/base-library/paints/${cp.id}/swatch.png`,
          created_at: now,
          updated_at: now
        });
      }
    });
    syncCuratedTx();
  } catch (e) {
    console.warn('[base-library] syncCuratedPaints error:', e.message);
  }

  // 9. Master 统一字典种子化 (8大部位、12大基材品类、专属色卡与花色资产)
  try {
    const { seedMasterDictionary } = require('./master-dictionary-seed');
    seedMasterDictionary(db);
  } catch (e) {
    console.warn('[base-library] seedMasterDictionary error:', e.message);
  }
}

module.exports = {
  ensureBaseLibrarySchema,
  cleanupExpiredTombstones,
  cleanupExpiredDrafts,
  TOMBSTONE_RETENTION_DAYS,
  TOMBSTONE_RETENTION_MS,
  DRAFT_RETENTION_MS
};
