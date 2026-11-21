const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const PROD_UNC = '\\\\wsl.localhost\\smu\\home\\lrp\\.dsh-material-library';
const TEST_DIR = 'C:\\Users\\lrp\\.dsh-material-library-test';

console.log('=== Step 1: Sync material.db ===');
const prodDb = path.join(PROD_UNC, 'material.db');
const testDb = path.join(TEST_DIR, 'material.db');

if (!fs.existsSync(prodDb)) {
  console.error(`Prod DB not found at ${prodDb}`);
  process.exit(1);
}

for (const suffix of ['', '-wal', '-shm']) {
  const src = prodDb + suffix;
  const dst = testDb + suffix;
  if (fs.existsSync(src)) {
    console.log(`Copying ${suffix || 'material.db'} (${(fs.statSync(src).size / 1048576).toFixed(2)} MB)...`);
    fs.copyFileSync(src, dst);
  } else if (fs.existsSync(dst)) {
    try { fs.unlinkSync(dst); } catch (_) {}
  }
}
console.log('Database snapshot synced successfully.');

console.log('\n=== Step 2: Sync creation-library media directory ===');
const prodCreation = path.join(PROD_UNC, 'creation-library');
const testCreation = path.join(TEST_DIR, 'creation-library');

if (!fs.existsSync(prodCreation)) {
  console.error(`Prod creation directory not found at ${prodCreation}`);
} else {
  if (!fs.existsSync(testCreation)) {
    fs.mkdirSync(testCreation, { recursive: true });
  }
  console.log(`Syncing media files from ${prodCreation} to ${testCreation} via robocopy...`);
  const t0 = Date.now();
  try {
    // robocopy returns exit codes 0-7 for success, 8+ for failure
    execSync(`robocopy "${prodCreation}" "${testCreation}" /E /MT:16 /NFL /NDL /NJH /NJS /nc /ns /np`, { stdio: 'ignore' });
  } catch (e) {
    if (e.status > 7) {
      console.error('Robocopy encountered errors:', e.message);
    }
  }
  const duration = ((Date.now() - t0) / 1000).toFixed(1);
  const testSubdirs = fs.readdirSync(testCreation).length;
  console.log(`Creation library media synced in ${duration}s. Test subdirectories count: ${testSubdirs}`);
}

console.log('\n=== Step 3: Verify and Apply Migration & Backfill on Test DB ===');
// Use better-sqlite3 with the win shim
require('./shims/better-sqlite3-win.js');
const Database = require('better-sqlite3');
const db = new Database(testDb);

// Ensure columns exist
function ensureColumn(tableName, colDef) {
  const colName = colDef.split(/\s+/)[0];
  const cols = db.prepare(`PRAGMA table_info(${tableName})`).all().map(c => c.name);
  if (!cols.includes(colName)) {
    console.log(`Adding column ${colName} to ${tableName}...`);
    db.prepare(`ALTER TABLE ${tableName} ADD COLUMN ${colDef}`).run();
  }
}

ensureColumn('creation_templates', 'root_origin_hash TEXT');
ensureColumn('creation_templates', 'parent_step_id TEXT');
ensureColumn('creation_templates', 'prompt_hash TEXT');
ensureColumn('creation_templates', 'operation TEXT');
ensureColumn('creation_templates', 'in_creation_lib INTEGER DEFAULT 1');
ensureColumn('creation_templates', 'in_material_lib INTEGER DEFAULT 0');
ensureColumn('creation_templates', 'is_cover INTEGER DEFAULT 0');
ensureColumn('creation_templates', 'video_mode TEXT');
ensureColumn('creation_templates', 'source_step_ids TEXT');

// Ensure image_readings table
db.prepare(`
  CREATE TABLE IF NOT EXISTS image_readings (
    sha256 TEXT PRIMARY KEY,
    space TEXT,
    style TEXT,
    summary TEXT,
    reading_json TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )
`).run();

// Ensure indices
db.prepare('CREATE INDEX IF NOT EXISTS idx_creation_templates_root_hash ON creation_templates(root_origin_hash)').run();
db.prepare('CREATE INDEX IF NOT EXISTS idx_creation_templates_prompt_hash ON creation_templates(prompt_hash)').run();
db.prepare('CREATE INDEX IF NOT EXISTS idx_creation_templates_updated_at ON creation_templates(updated_at DESC, id DESC)').run();
db.prepare('CREATE INDEX IF NOT EXISTS idx_image_readings_updated_at ON image_readings(updated_at DESC)').run();

console.log('Schema migration completed.');

// Run backfill on test DB
const crypto = require('crypto');
function normalizePrompt(prompt) {
  return String(prompt || '').trim().replace(/\s+/g, ' ');
}
function sha256Hex(bufOrStr) {
  return crypto.createHash('sha256').update(bufOrStr).digest('hex');
}

const SPACE_VOCAB = [
  '玄关', '门厅', '客厅', '餐厅', '客餐厅', '厨房', '主卧', '次卧', '卧室',
  '书房', '儿童房', '长辈房', '卫生间', '主卫', '次卫', '卫浴', '阳台',
  '衣帽间', '茶室', '走廊', '过道', '影音室', '健身房', '地下室', '庭院', '露台', '阁楼'
];

const STYLE_VOCAB = [
  '中古风', '法式轻奢', '法式复古', '现代极简', '侘寂风', '奶油风', '原木风',
  '新中式', '意式极简', '美式复古', '美式田园', '北欧风', '工业风', '轻奢风',
  '复古南洋', '包豪斯', '日式极简', '南洋复古', '极简主义', '古典欧式', '现代轻奢'
];

function extractFromVocab(text, vocab) {
  if (!text) return null;
  for (const term of vocab) {
    if (text.includes(term)) return term;
  }
  return null;
}

const rows = db.prepare('SELECT id, prompt, space, style, operation, input_image, root_origin_hash, prompt_hash, in_creation_lib, in_material_lib, is_cover, asset_id FROM creation_templates').all();
console.log(`Processing backfill for ${rows.length} rows...`);

const updateStmt = db.prepare(`
  UPDATE creation_templates
  SET prompt_hash = @prompt_hash,
      root_origin_hash = @root_origin_hash,
      space = @space,
      style = @style,
      operation = @operation,
      in_creation_lib = @in_creation_lib,
      in_material_lib = @in_material_lib,
      is_cover = @is_cover
  WHERE id = @id
`);

let updated = 0;
const tx = db.transaction(() => {
  for (const row of rows) {
    const norm = normalizePrompt(row.prompt);
    const pHash = norm ? sha256Hex(norm) : null;
    
    // Resolve space & style without guessing
    let space = row.space || extractFromVocab(row.prompt, SPACE_VOCAB) || null;
    let style = row.style || extractFromVocab(row.prompt, STYLE_VOCAB) || null;
    
    // Resolve root_origin_hash
    let rootHash = row.root_origin_hash;
    if (!rootHash) {
      if (row.input_image) {
        rootHash = sha256Hex(row.input_image);
      } else {
        rootHash = sha256Hex(`orphan-${row.id}`);
      }
    }
    
    // Resolve operation
    let op = row.operation;
    if (!op) {
      if (row.prompt && /换空间|全屋|重构/.test(row.prompt)) op = '换空间';
      else if (row.prompt && /表面|材质|换砖|换木/.test(row.prompt)) op = '换表面';
      else if (row.prompt && /超分|高清/.test(row.prompt)) op = '超分';
      else if (row.prompt && /去水印|清除/.test(row.prompt)) op = '去水印';
      else op = '生成';
    }

    const inCreation = row.in_creation_lib != null ? row.in_creation_lib : 1;
    const inMaterial = row.in_material_lib != null ? row.in_material_lib : (row.asset_id ? 1 : 0);
    const isCover = row.is_cover != null ? row.is_cover : 0;

    updateStmt.run({
      id: row.id,
      prompt_hash: pHash,
      root_origin_hash: rootHash,
      space,
      style,
      operation: op,
      in_creation_lib: inCreation,
      in_material_lib: inMaterial,
      is_cover: isCover
    });
    updated++;
  }
});

tx();
console.log(`Backfill successfully updated ${updated} rows in Test DB.`);
db.close();
console.log('Sync and migration finished cleanly.');
