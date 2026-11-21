/**
 * 创作库存量数据安全回填脚本（Dry-Run 与正式回填）
 * 严格规则：
 * 1. 确定性词表与别名精确匹配；明确命中才补写，未命中或有歧义保持空值（归入「未填写」），严禁调用 AI 猜测。
 * 2. 空间主词规范化（统一用「门厅」吸收「门内门厅 / 玄关」）。
 * 3. 21个精细风格权威词表精确匹配。
 * 4. 计算 prompt_hash = sha256(prompt.trim().replace(/\s+/g, ' '))。
 * 5. 补全 root_origin_hash。
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');
const sqlite = require('better-sqlite3');

let dataDir = process.env.ML_DATA_DIR;
if (!dataDir) {
  if (fs.existsSync('/data/lrp')) {
    dataDir = '/data/lrp/dsh-material-library';
  } else {
    dataDir = path.join(os.homedir(), '.dsh-material-library');
  }
}

const dbPath = path.join(dataDir, 'material.db');
const db = sqlite(dbPath);

// 空间规范化映射与词表
const SPACE_CANONICAL = {
  '门厅': ['门厅', '门内门厅', '玄关', '玄关门厅', 'entryway', 'foyer', '入户玄关', '入户'],
  '门外门廊': ['门外门廊', '门外', '门廊', 'porch'],
  '客厅': ['客厅', '起居室', 'living_room', '大厅', '客餐厅'],
  '餐厅': ['餐厅', '饭厅', 'dining_room'],
  '厨房': ['厨房', 'kitchen'],
  '卧室': ['卧室', '主卧', '次卧', '客卧', '睡房', 'bedroom'],
  '衣帽间': ['衣帽间', '步入式衣帽间', 'walk_in_closet', '衣帽柜'],
  '卫浴': ['卫浴', '卫生间', '浴室', '洗手间', 'bathroom'],
  '书房': ['书房', 'study'],
  '阳台露台': ['阳台露台', '阳台', '露台', 'balcony'],
  '茶空间': ['茶空间', '茶室', 'tea_space'],
  '飘窗': ['飘窗', 'bay_window'],
  '庭院': ['庭院', '院子', 'courtyard'],
  '泳池': ['泳池', '游泳池', 'pool'],
  '池塘': ['池塘', 'pond'],
  '细节特写': ['细节特写', '特写', 'detail_closeup'],
  '其他': ['其他', '其他空间']
};

// 21 个精细风格规范化映射
const STYLE_CANONICAL = {
  '侘寂': ['侘寂', '侘寂风', 'wabi_sabi'],
  '宋式美学': ['宋式美学', '宋式', '宋代美学', 'song_aesthetic'],
  '新中式': ['新中式', 'neo_chinese'],
  '古典中式': ['古典中式', '中式古典', '明清中式', 'classical_chinese'],
  '法式': ['法式', '法式风', 'french'],
  '意式': ['意式', '意式风', '意式极简', '意式轻奢', 'italian'],
  '托斯卡纳': ['托斯卡纳', '托斯卡纳风', 'tuscan'],
  '地中海': ['地中海', '地中海风', 'mediterranean'],
  '现代极简': ['现代极简', '现代简约', '极简主义', '极简', 'modern_minimal'],
  '奶油风': ['奶油风', '奶油系', 'cream_style'],
  '工业风': ['工业风', '工业', 'industrial'],
  '中古风': ['中古风', '中古MCM', 'MCM', '中古现代', '中古', 'mid_century'],
  '现代美式': ['现代美式', '美式现代', 'american_modern'],
  '美式乡村': ['美式乡村', '美式复古', '美式农舍', '农舍', 'american_country'],
  '南洋度假': ['南洋度假', '南洋', '度假风', 'nanyang_resort'],
  '其他风格': ['其他风格', '未分类风格', '混搭', 'other'],
  '自然原木风': ['自然原木风', '原木风', '浅色原木', '日式', 'natural_wood'],
  '深色原木风': ['深色原木风', '深色原木', '深木', '深木风', 'dark_wood'],
  '自然复古原木风': ['自然复古原木风', '浅色做旧原木', '做旧原木', 'natural_vintage_wood'],
  '深色复古原木风': ['深色复古原木风', '深色做旧原木', '深色石头复古', 'dark_vintage_wood'],
  '法式轻奢': ['法式轻奢', '欧式轻奢', 'french_light_luxury']
};

function normalizeSpace(raw) {
  if (!raw) return '';
  const s = String(raw).trim();
  for (const [canonical, aliases] of Object.entries(SPACE_CANONICAL)) {
    if (s === canonical) return canonical;
    if (aliases.includes(s)) return canonical;
  }
  return '';
}

function normalizeStyle(raw) {
  if (!raw) return '';
  const s = String(raw).trim();
  for (const [canonical, aliases] of Object.entries(STYLE_CANONICAL)) {
    if (s === canonical) return canonical;
    if (aliases.includes(s)) return canonical;
  }
  return '';
}

function matchTextForSpace(text) {
  if (!text) return '';
  const hits = [];
  for (const [canonical, aliases] of Object.entries(SPACE_CANONICAL)) {
    for (const alias of aliases) {
      if (text.includes(alias)) {
        if (!hits.includes(canonical)) hits.push(canonical);
        break;
      }
    }
  }
  // 必须明确命中且无歧义才采纳
  return hits.length === 1 ? hits[0] : '';
}

function matchTextForStyle(text) {
  if (!text) return '';
  const hits = [];
  for (const [canonical, aliases] of Object.entries(STYLE_CANONICAL)) {
    for (const alias of aliases) {
      if (text.includes(alias)) {
        if (!hits.includes(canonical)) hits.push(canonical);
        break;
      }
    }
  }
  return hits.length === 1 ? hits[0] : '';
}

function inferOperation(row) {
  if (row.operation) return row.operation;
  if (row.type === 'video') return '生视频';
  const text = (row.title || '') + ' ' + (row.prompt || '');
  if (text.includes('换表面') || text.includes('精准换表面')) return '换表面';
  if (text.includes('换整件') || text.includes('换家具')) return '换整件';
  if (text.includes('换空间')) return '换空间';
  if (text.includes('超分') || text.includes('高清') || text.includes('放大')) return '超分';
  if (text.includes('去水印')) return '去水印';
  if (text.includes('视频') || text.includes('运镜') || text.includes('导览')) return '生视频';
  return '换空间';
}

function sha256(buf) {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function promptHash(prompt) {
  const norm = String(prompt || '').trim().replace(/\s+/g, ' ');
  return sha256(norm);
}

// 确保表结构扩展
function ensureColumns() {
  const cols = db.prepare('PRAGMA table_info(creation_templates)').all().map(c => c.name);
  const add = (col, def) => {
    if (!cols.includes(col)) {
      try { db.exec(`ALTER TABLE creation_templates ADD COLUMN ${col} ${def};`); } catch (e) {}
    }
  };
  add('root_origin_hash', 'TEXT');
  add('parent_step_id', 'TEXT');
  add('prompt_hash', 'TEXT');
  add('operation', 'TEXT');
  add('in_creation_lib', 'INTEGER DEFAULT 1');
  add('in_material_lib', 'INTEGER DEFAULT 0');
  add('is_cover', 'INTEGER DEFAULT 0');
  add('video_mode', "TEXT DEFAULT ''");
  add('source_step_ids', "TEXT DEFAULT '[]'");

  try { db.exec('CREATE INDEX IF NOT EXISTS idx_creation_tpl_root ON creation_templates(root_origin_hash);'); } catch (e) {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_creation_tpl_prompt_hash ON creation_templates(prompt_hash);'); } catch (e) {}
  try { db.exec('CREATE INDEX IF NOT EXISTS idx_creation_tpl_group ON creation_templates(root_origin_hash, style, space);'); } catch (e) {}

  db.exec(`
    CREATE TABLE IF NOT EXISTS image_readings (
      sha256 TEXT PRIMARY KEY,
      space TEXT DEFAULT '',
      style TEXT DEFAULT '',
      reading_summary TEXT DEFAULT '',
      surfaces_json TEXT DEFAULT '{}',
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_image_readings_sha ON image_readings(sha256);
  `);
}

function runBackfill(isDryRun = true) {
  ensureColumns();
  const rows = db.prepare('SELECT * FROM creation_templates ORDER BY created_at ASC').all();
  console.log(`[Backfill] Total rows: ${rows.length}, Mode: ${isDryRun ? 'DRY-RUN' : 'LIVE'}`);

  let stats = {
    total: rows.length,
    spaceFilled: 0,
    spaceEmpty: 0,
    styleFilled: 0,
    styleEmpty: 0,
    rootHashFilled: 0,
    promptHashFilled: 0,
    operationFilled: 0
  };

  const updateStmt = db.prepare(`
    UPDATE creation_templates SET
      root_origin_hash = ?,
      prompt_hash = ?,
      space = ?,
      style = ?,
      operation = ?,
      in_creation_lib = ?,
      in_material_lib = ?,
      is_cover = ?,
      video_mode = ?,
      source_step_ids = ?
    WHERE id = ?
  `);

  // 按 root_origin_hash + style + space 追踪每组最新的记录，用于设为 cover
  const groupCovers = new Map();

  const updates = [];

  for (const r of rows) {
    // 1. prompt_hash
    const pHash = promptHash(r.prompt);
    stats.promptHashFilled++;

    // 2. space: 优先规范化已有值；若无，从 title+prompt 精确无歧义匹配
    let sp = normalizeSpace(r.space);
    if (!sp) {
      sp = matchTextForSpace(`${r.title || ''} ${r.prompt || ''}`);
    }
    if (sp) stats.spaceFilled++;
    else stats.spaceEmpty++;

    // 3. style: 优先规范化已有值；若无，从 title+prompt 精确无歧义匹配
    let st = normalizeStyle(r.style);
    if (!st) {
      st = matchTextForStyle(`${r.title || ''} ${r.prompt || ''}`);
    }
    if (st) stats.styleFilled++;
    else stats.styleEmpty++;

    // 4. operation
    const op = inferOperation(r);
    stats.operationFilled++;

    // 5. root_origin_hash
    let rootHash = r.root_origin_hash || '';
    if (!rootHash) {
      let oi = [];
      try { oi = JSON.parse(r.origin_images || '[]'); } catch {}
      const firstOrigin = oi[0];
      const url = typeof firstOrigin === 'string' ? firstOrigin : (firstOrigin && firstOrigin.url);
      if (url) {
        rootHash = sha256(url);
      } else {
        rootHash = sha256(r.id);
      }
    }
    stats.rootHashFilled++;

    // 6. in_creation_lib / in_material_lib
    const inCreation = r.in_creation_lib !== null && r.in_creation_lib !== undefined ? Number(r.in_creation_lib) : 1;
    const inMaterial = Number(r.in_material_lib || 0);

    // 7. video_mode & source_step_ids
    let videoMode = r.video_mode || '';
    if (r.type === 'video' && !videoMode) {
      videoMode = (r.prompt || '').includes('转场') ? 'room_transition' : 'single_tour';
    }
    const sourceStepIds = r.source_step_ids || '[]';

    const groupKey = `${rootHash}_${st}_${sp}`;
    groupCovers.set(groupKey, r.id); // 遍历顺序是 created_at ASC，最后一个自然是最新记录

    updates.push({
      id: r.id,
      rootHash,
      pHash,
      sp,
      st,
      op,
      inCreation,
      inMaterial,
      videoMode,
      sourceStepIds,
      groupKey
    });
  }

  console.log('[Backfill Stats]:', stats);

  if (!isDryRun) {
    const tx = db.transaction(() => {
      for (const u of updates) {
        const isCover = groupCovers.get(u.groupKey) === u.id ? 1 : 0;
        updateStmt.run(
          u.rootHash,
          u.pHash,
          u.sp,
          u.st,
          u.op,
          u.inCreation,
          u.inMaterial,
          isCover,
          u.videoMode,
          u.sourceStepIds,
          u.id
        );
      }
    });
    tx();
    console.log('[Backfill] Database update complete.');
  }
}

const isLive = process.argv.includes('--live');
runBackfill(!isLive);
