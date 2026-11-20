/**
 * 我的创作库持久化管理 (Studio Presets & Prompt Recipes)
 * 允许桌面端与移动端持久保存与同步复用高品质提示词、参数模板与生成方案。
 */
const crypto = require('crypto');

function ensureStudioPresetsTable(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS studio_presets (
      id TEXT PRIMARY KEY,
      title TEXT NOT NULL,
      prompt TEXT NOT NULL,
      negative_prompt TEXT DEFAULT '',
      aspect_ratio TEXT DEFAULT '16:9',
      category TEXT DEFAULT 'general',
      tags_json TEXT DEFAULT '[]',
      model TEXT DEFAULT '',
      created_at INTEGER,
      updated_at INTEGER
    );
  `);

  const count = db.prepare('SELECT COUNT(*) c FROM studio_presets').get().c;
  if (count === 0) {
    const insert = db.prepare(`
      INSERT INTO studio_presets (id, title, prompt, negative_prompt, aspect_ratio, category, tags_json, model, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const now = Date.now();
    insert.run(
      'preset_1',
      '极简意式现代客厅',
      '高挑空大平层客厅，超大落地窗，自然漫反射光，意式极简皮革大沙发，哑光岩板茶几，微水泥地面，电影质感，大师构图',
      '杂乱, 曝光过度, 变形, 噪点',
      '16:9',
      'interior',
      JSON.stringify(['#自然采光', '#微水泥', '#大理石']),
      'doubao-seed-2-0',
      now,
      now
    );
    insert.run(
      'preset_2',
      '侘寂原木禅意卧室',
      '侘寂风原木卧室，日式低矮原木大床，亚麻床品，柔和侧逆光，微风拂动纱帘，自然绿植投影，安宁宁静氛围，8k超清细节',
      '艳俗色彩, 塑料感, 结构错误',
      '16:9',
      'interior',
      JSON.stringify(['#侘寂风', '#原木质感', '#柔和光影']),
      'doubao-seed-2-0',
      now,
      now
    );
    insert.run(
      'preset_3',
      '4K电影级空间光影',
      '电影画幅构图，戏剧性体积光束，丁达尔效应，高级灰调空间，冷暖环境光平衡，浅景深虚化背景，8K超高清逼真材质',
      '暗淡无光, 模糊, 偏色',
      '21:9',
      'cinema',
      JSON.stringify(['#体积雾', '#冷暖光影', '#8K超精细']),
      'doubao-seed-2-0',
      now,
      now
    );
    insert.run(
      'preset_4',
      '现代极简建筑外观',
      '现代主义清水混凝土独栋别墅，几何悬挑结构，黄昏蓝调时刻，室内温暖灯光透出，镜面水池倒影，大师建筑摄影',
      '简陋, 变形, 灰暗',
      '16:9',
      'architecture',
      JSON.stringify(['#建筑摄影', '#清水混凝土', '#黄昏蓝调']),
      'doubao-seed-2-0',
      now,
      now
    );
  }
}

function listPresets(db, category) {
  ensureStudioPresetsTable(db);
  let rows;
  if (category && category !== 'all') {
    rows = db.prepare('SELECT * FROM studio_presets WHERE category=? ORDER BY updated_at DESC').all(category);
  } else {
    rows = db.prepare('SELECT * FROM studio_presets ORDER BY updated_at DESC').all();
  }
  return rows.map(r => ({
    ...r,
    tags: JSON.parse(r.tags_json || '[]')
  }));
}

function createPreset(db, { title, prompt, negative_prompt = '', aspect_ratio = '16:9', category = 'general', tags = [], model = '' }) {
  ensureStudioPresetsTable(db);
  const id = 'preset_' + crypto.randomBytes(6).toString('hex');
  const now = Date.now();
  db.prepare(`
    INSERT INTO studio_presets (id, title, prompt, negative_prompt, aspect_ratio, category, tags_json, model, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    title || '未命名配方',
    prompt || '',
    negative_prompt,
    aspect_ratio,
    category,
    JSON.stringify(Array.isArray(tags) ? tags : []),
    model,
    now,
    now
  );
  return { id, title, prompt, negative_prompt, aspect_ratio, category, tags, model, created_at: now, updated_at: now };
}

function deletePreset(db, id) {
  ensureStudioPresetsTable(db);
  const r = db.prepare('DELETE FROM studio_presets WHERE id=?').run(id);
  return r.changes > 0;
}

module.exports = {
  ensureStudioPresetsTable,
  listPresets,
  createPreset,
  deletePreset,
};
