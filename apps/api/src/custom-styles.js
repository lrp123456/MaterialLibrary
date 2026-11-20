/**
 * 自定义风格库（风格迁移）
 *
 * 用户在「风格迁移」里自建的风格：保存风格名称、自由描述，以及经 LLM 解析生成的
 * 「风格锚定描述」。锚定描述会随 /edit/run 的 style_transfer 一起进生图提示词。
 */
const crypto = require('crypto');

function ensureCustomStyleTables(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS custom_styles (
      id          TEXT PRIMARY KEY,
      name        TEXT NOT NULL,
      raw_desc    TEXT,
      ai_prompt   TEXT,
      created_by  TEXT,
      created_at  INTEGER NOT NULL,
      updated_at  INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_custom_styles_updated ON custom_styles(updated_at DESC);
  `);
}

function rowToStyle(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    description: row.raw_desc || '',
    aiPrompt: row.ai_prompt || '',
    createdBy: row.created_by || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function listCustomStyles(db) {
  ensureCustomStyleTables(db);
  return db
    .prepare('SELECT * FROM custom_styles ORDER BY updated_at DESC, created_at DESC')
    .all()
    .map(rowToStyle);
}

function getCustomStyle(db, id) {
  ensureCustomStyleTables(db);
  return rowToStyle(db.prepare('SELECT * FROM custom_styles WHERE id=?').get(String(id)));
}

function createCustomStyle(db, { name, description, aiPrompt, actor } = {}) {
  ensureCustomStyleTables(db);
  const cleanName = String(name || '').trim();
  if (!cleanName) throw new Error('风格名称不能为空');
  const now = Date.now();
  const id = 'cs_' + crypto.randomBytes(8).toString('hex');
  db.prepare(`
    INSERT INTO custom_styles (id, name, raw_desc, ai_prompt, created_by, created_at, updated_at)
    VALUES (?,?,?,?,?,?,?)
  `).run(
    id,
    cleanName,
    String(description || '').trim(),
    String(aiPrompt || '').trim(),
    String(actor || ''),
    now,
    now
  );
  return getCustomStyle(db, id);
}

function updateCustomStyle(db, id, { name, description, aiPrompt } = {}) {
  ensureCustomStyleTables(db);
  const existing = db.prepare('SELECT * FROM custom_styles WHERE id=?').get(String(id));
  if (!existing) throw new Error('自定义风格不存在');
  const cleanName = name != null ? String(name).trim() : existing.name;
  if (!cleanName) throw new Error('风格名称不能为空');
  const now = Date.now();
  db.prepare(`
    UPDATE custom_styles
       SET name=?, raw_desc=?, ai_prompt=?, updated_at=?
     WHERE id=?
  `).run(
    cleanName,
    description != null ? String(description).trim() : existing.raw_desc,
    aiPrompt != null ? String(aiPrompt).trim() : existing.ai_prompt,
    now,
    String(id)
  );
  return getCustomStyle(db, id);
}

function deleteCustomStyle(db, id) {
  ensureCustomStyleTables(db);
  const r = db.prepare('DELETE FROM custom_styles WHERE id=?').run(String(id));
  return r.changes > 0;
}

/** LLM 系统提示词：把用户的自定义风格翻译成生图模型能吃透的锚定描述。 */
const STYLE_ANALYZER_PROMPT = `你是资深室内设计师兼文生图提示词工程师。用户会给出一个自定义室内风格名称和可选自由描述。
请把该风格翻译成一段可直接嵌入图像生成提示词的「风格锚定描述」，让生图模型准确理解材质、色彩与氛围。

必须覆盖以下 6 个维度，写成一段连贯正文，用分号分隔，不要分点编号：
1. 色彩体系：主色、辅色、点缀色，写具体色相与明度；
2. 材质语言：墙面、地面、木饰面、石材、金属、织物各自的典型材质与表面质感；
3. 造型与线条：家具轮廓、空间线条、典型装饰语法（如拱形/直角/曲面/格栅）；
4. 灯光与氛围：色温、光源类型、明暗层次与整体氛围；
5. 软装与陈设：典型家具、灯具、地毯、窗帘、艺术陈设与绿植；
6. 空间气质：一两句概括该风格的精神与居住感受。

硬性要求：
- 只输出 150-300 字的描述正文，不要标题、编号、解释、markdown 或 JSON；
- 全部使用具体、可视觉化的名词和形容词，禁止「高端、大气、奢华、质感、氛围感」等空泛套话；
- 不要写尺寸、分辨率、画幅比例、相机参数或画质参数；
- 不要描述房间结构改动，只描述风格本身；
- 用户自由描述与该风格的常见认知冲突时，以用户描述为准。`;

function buildStyleAnalyzerUserMessage(name, description) {
  return [
    `风格名称：${String(name || '').trim()}`,
    `用户自由描述：${String(description || '').trim() || '（无，请按该风格最典型、最纯正的做法补全）'}`,
  ].join('\n');
}

module.exports = {
  ensureCustomStyleTables,
  listCustomStyles,
  getCustomStyle,
  createCustomStyle,
  updateCustomStyle,
  deleteCustomStyle,
  STYLE_ANALYZER_PROMPT,
  buildStyleAnalyzerUserMessage,
};
