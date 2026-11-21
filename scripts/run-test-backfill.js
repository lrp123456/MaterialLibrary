const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
require('./shims/better-sqlite3-win.js');
const Database = require('better-sqlite3');

const TEST_DB_PATH = 'C:\\Users\\lrp\\.dsh-material-library-test\\material.db';
const TEST_MEDIA_DIR = 'C:\\Users\\lrp\\.dsh-material-library-test\\creation-library';

console.log(`Connecting to Test DB: ${TEST_DB_PATH}`);
const db = new Database(TEST_DB_PATH);

// 1. 确保表结构与索引
const cols = db.prepare('PRAGMA table_info(creation_templates)').all().map(c => c.name);
const addCol = (col, def) => {
  if (!cols.includes(col)) {
    console.log(`Adding column ${col} to creation_templates...`);
    try { db.exec(`ALTER TABLE creation_templates ADD COLUMN ${col} ${def};`); } catch (e) {
      console.warn(`Warn adding col ${col}: ${e.message}`);
    }
  }
};

addCol('root_origin_hash', 'TEXT');
addCol('parent_step_id', 'TEXT');
addCol('prompt_hash', 'TEXT');
addCol('operation', 'TEXT');
addCol('in_creation_lib', 'INTEGER DEFAULT 1');
addCol('in_material_lib', 'INTEGER DEFAULT 0');
addCol('is_cover', 'INTEGER DEFAULT 0');
addCol('video_mode', "TEXT DEFAULT ''");
addCol('source_step_ids', "TEXT DEFAULT '[]'");

try { db.exec('CREATE INDEX IF NOT EXISTS idx_creation_tpl_root ON creation_templates(root_origin_hash);'); } catch (e) {}
try { db.exec('CREATE INDEX IF NOT EXISTS idx_creation_tpl_prompt_hash ON creation_templates(prompt_hash);'); } catch (e) {}
try { db.exec('CREATE INDEX IF NOT EXISTS idx_creation_tpl_group ON creation_templates(root_origin_hash, style, space);'); } catch (e) {}
try { db.exec('CREATE INDEX IF NOT EXISTS idx_creation_tpl_updated_at ON creation_templates(updated_at DESC, id DESC);'); } catch (e) {}

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

console.log('Schema verification complete.');

// 2. 空间与风格词表规范
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

// 3. 执行回填
const rows = db.prepare('SELECT * FROM creation_templates ORDER BY created_at ASC').all();
console.log(`Starting backfill on ${rows.length} rows in Test DB...`);

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

const groupCovers = new Map();
const tx = db.transaction(() => {
  for (const r of rows) {
    const pHash = promptHash(r.prompt);

    let sp = normalizeSpace(r.space);
    if (!sp) {
      sp = matchTextForSpace(`${r.title || ''} ${r.prompt || ''}`);
    }

    let st = normalizeStyle(r.style);
    if (!st) {
      st = matchTextForStyle(`${r.title || ''} ${r.prompt || ''}`);
    }

    const op = inferOperation(r);

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

    const inCreation = r.in_creation_lib !== null && r.in_creation_lib !== undefined ? Number(r.in_creation_lib) : 1;
    const inMaterial = Number(r.in_material_lib || 0);

    let videoMode = r.video_mode || '';
    let sourceStepIds = r.source_step_ids || '[]';
    if (!videoMode && op === '生视频') {
      const isTrans = /转场|两端|端点/.test(`${r.title || ''} ${r.prompt || ''}`);
      videoMode = isTrans ? 'transition' : 'tour';
    }

    const groupKey = `${rootHash}_${st}_${sp}`;
    groupCovers.set(groupKey, r.id);

    updateStmt.run(
      rootHash,
      pHash,
      sp,
      st,
      op,
      inCreation,
      inMaterial,
      0, // 先置 0，后面按最新组置封面
      videoMode,
      sourceStepIds,
      r.id
    );
  }

  // 为每个 group 最新的那条置 is_cover = 1
  const setCoverStmt = db.prepare('UPDATE creation_templates SET is_cover = 1 WHERE id = ?');
  for (const latestId of groupCovers.values()) {
    setCoverStmt.run(latestId);
  }
});

tx();
console.log(`Backfill successfully completed on ${rows.length} rows!`);
db.close();
