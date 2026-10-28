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
      basecolor_rel TEXT NOT NULL,   -- cache/base-library/materials/{id}/basecolor.jpg
      width INTEGER NOT NULL,
      height INTEGER NOT NULL,
      deleted_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_ba_mat_source
      ON ba_materials(source, source_id) WHERE source_id IS NOT NULL AND deleted_at IS NULL;
    CREATE INDEX IF NOT EXISTS idx_ba_mat_deleted
      ON ba_materials(deleted_at, updated_at DESC);

    -- 色号仓库
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
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE(brand, code)
    );
    CREATE INDEX IF NOT EXISTS idx_ba_paints_pinned_brand
      ON ba_paints(pinned DESC, brand, updated_at DESC);

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
  insFlag.run('base_library_jev', 0, now);
  insFlag.run('base_library_compile', 0, now);
  insFlag.run('creation_tpl_incremental', 1, now);
  insFlag.run('base_library_write', 1, now);

  // 7. 启动清理
  cleanupExpiredTombstones(db, now);
  cleanupExpiredDrafts(db, now);
}

module.exports = {
  ensureBaseLibrarySchema,
  cleanupExpiredTombstones,
  cleanupExpiredDrafts,
  TOMBSTONE_RETENTION_DAYS,
  TOMBSTONE_RETENTION_MS,
  DRAFT_RETENTION_MS
};
