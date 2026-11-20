/**
 * v4 全链路端到端回归与功能验证测试
 * 覆盖：
 * 1. 全量字典接口返回 8 部位、12 品类，全部 12 品类色卡就绪 (每品类 >= 3)
 * 2. 空间选区识别 (沙发几何选区) 返回 part = upholstery, recommended_category_id = mat_cat_leather, default_swatch 非空
 * 3. 8 大空间部位切换，每个部位品类数 >= 1，且每个品类关联色卡数 >= 3
 * 4. 前端离线美学色彩命名算法验证 (彻底杜绝「自定义色 (#...)」)
 * 5. 3D 选品库 API 端点验证 (GET /presets, PUT /presets/:id, POST /presets/:id/snapshots, DELETE /presets/:id)
 * 6. 色卡增删与基础素材库 (ba_items / ba_item_mounts) 双向实时同步与级联删除
 */

const assert = require('node:assert');
const path = require('node:path');
const os = require('node:os');
const fs = require('node:fs');
const http = require('node:http');

const testDir = path.join(os.tmpdir(), 'dsh_v4_e2e_test_' + Date.now());
fs.mkdirSync(testDir, { recursive: true });
// 服务端快照/缓存落盘统一进本套件临时目录，杜绝污染生产 ~/.dsh-material-library
process.env.ML_DATA_DIR = testDir;

const { openDb } = require('../src/db');
const { ensureBaseLibrarySchema } = require('../src/base-library/schema');
const { seedMasterDictionary } = require('../src/base-library/master-dictionary-seed');
const { getDictionary, getRecommendedSwatchesForRegion, createSwatch, deleteSwatch } = require('../src/base-library/dictionary-routes');
const { classifyRegionPart } = require('../src/base-library/classify-part');
const { listItems } = require('../src/base-library/items');
const { generateLocalAestheticName, FALLBACK_PARTS, FALLBACK_CATEGORIES, FALLBACK_SWATCHES } = require('../web-pro/src/utils/master-dictionary-fallback');

// 全局外网熔断：任何分支误走 JEV/VLM 真外呼立即失败（本套件全部为本地几何/字典断言）
globalThis.fetch = async () => {
  throw new Error('unexpected real network fetch in v4-e2e verification test');
};

const db = openDb(testDir);
ensureBaseLibrarySchema(db);
seedMasterDictionary(db);

async function runTests() {
  console.log('=== 1. 验证全量主字典 API 数据完整性 ===');
  const dict = getDictionary(db);
  assert.strictEqual(dict.parts.length, 8, '必须包含全部 8 大室内装修部位');
  assert.strictEqual(dict.all_categories.length, 12, '必须包含全部 12 大室内基材品类');

  for (const cat of dict.all_categories) {
    const swatches = dict.swatches[cat.id] || [];
    assert.ok(swatches.length >= 3, `基材品类【${cat.name_zh}】(${cat.id}) 色卡数量 (${swatches.length}) 应 >= 3`);
  }
  console.log(`✅ 全量主字典验证通过 (8 部位, 12 品类, 全部品类色卡均 >= 3, 总色卡数: ${Object.values(dict.swatches).flat().length})`);

  console.log('=== 2. 验证沙发选区智能识别与基材联动 ===');
  delete process.env.TYPESAFE_API_KEY;
  delete process.env.JEV_API_KEY;

  const resSofa = await classifyRegionPart(db, null, {
    selection: { norm: { x: 0.2, y: 0.55, w: 0.4, h: 0.3 } }
  });
  assert.strictEqual(resSofa.part, 'upholstery', '沙发选区应识别为 upholstery');
  assert.strictEqual(resSofa.recommended_category_id, 'mat_cat_leather', '沙发应首选推荐 mat_cat_leather 真皮品类');
  assert.ok(resSofa.confidence >= 0.8, '置信度应 >= 0.8');
  assert.ok(resSofa.default_swatch, 'default_swatch 必须存在');
  assert.strictEqual(resSofa.default_swatch.category_id, 'mat_cat_leather');
  assert.strictEqual(resSofa.default_swatch.name_zh, '意式马鞍棕');
  console.log('✅ 沙发选区智能识别通过 (part: upholstery, category: mat_cat_leather, 首推: 意式马鞍棕)');

  console.log('=== 3. 验证 8 大部位切换逻辑与品类约束 ===');
  for (const p of dict.parts) {
    const partDict = getDictionary(db, { part: p.id });
    assert.ok(partDict.categories.length >= 1, `部位【${p.name_zh}】可用品类数必须 >= 1`);
    for (const c of partDict.categories) {
      assert.ok(c.allowed_parts.includes(p.id), `品类【${c.name_zh}】必须被允许在部位【${p.id}】使用`);
    }
  }
  console.log('✅ 8 大部位品类约束验证通过 (严格符合室内工程设计约束)');

  console.log('=== 4. 验证调色盘美学色彩命名算法 (消灭「自定义色」) ===');
  const leatherSwatches = dict.swatches['mat_cat_leather'] || [];
  // 1) 意式马鞍棕精准命中
  const name1 = generateLocalAestheticName('#8B4A2B', 'mat_cat_leather', leatherSwatches);
  assert.strictEqual(name1, '意式马鞍棕');

  // 2) 任意深色深炭 HEX
  const name2 = generateLocalAestheticName('#373538', 'mat_cat_leather', leatherSwatches);
  assert.ok(!name2.includes('自定义色'), '绝不可包含自定义色字样');
  assert.ok(!name2.includes('#'), '绝不可返回裸 HEX');
  assert.ok(name2.includes('真皮') || name2.includes('炭') || name2.includes('黑') || name2.includes('深'), `美学命名应符合皮革质感: ${name2}`);

  // 3) 奶油暖白色相
  const name3 = generateLocalAestheticName('#FAF6F0', 'mat_cat_latex', dict.swatches['mat_cat_latex']);
  assert.ok(!name3.includes('自定义色'));
  assert.ok(!name3.includes('#'));
  console.log(`✅ 美学命名算法验证通过 (#8B4A2B -> ${name1}, #373538 -> ${name2}, #FAF6F0 -> ${name3})`);

  console.log('=== 5. 验证 3D 单品家具库 API 路由处理 ===');
  // 模拟 HTTP 服务调用验证 src/api.js 路由
  const { handleApi } = require('../src/api');
  const mockServices = { db, config: {}, interpreter: null };

  function invokeApi(method, path, body = null, userToken = 'test-token') {
    return new Promise((resolve) => {
      // 插入管理员 session
      db.prepare(`
        INSERT OR REPLACE INTO sessions (token, user_id, role, expires_at)
        VALUES (?, ?, ?, ?)
      `).run('test-token', 1, 'admin', Date.now() + 86400000);

      const req = new http.IncomingMessage(null);
      req.method = method;
      req.url = path;
      req.headers = {
        authorization: 'Bearer test-token',
        'content-type': 'application/json'
      };

      const res = {
        _headers: {},
        statusCode: 200,
        setHeader(k, v) { this._headers[k] = v; },
        getHeader(k) { return this._headers[k]; },
        writeHead(code, headers = {}) {
          this.statusCode = code;
          Object.assign(this._headers, headers);
        },
        end(data) {
          try {
            resolve({ statusCode: this.statusCode, json: JSON.parse(data) });
          } catch (_) {
            resolve({ statusCode: this.statusCode, raw: data });
          }
        }
      };

      if (body) {
        req.push(JSON.stringify(body));
      }
      req.push(null);

      handleApi(mockServices, req, res).catch(e => {
        resolve({ statusCode: 500, error: e.message });
      });
    });
  }

  // A. PUT /api/products/presets/test_chair
  const putRes = await invokeApi('PUT', '/api/products/presets/test_chair', {
    name: '北欧设计师扶手椅',
    category: 'furniture',
    facing: 90,
    tags: ['单人椅', '实木', '北欧']
  });
  assert.strictEqual(putRes.statusCode, 200);
  assert.strictEqual(putRes.json.success, true);
  assert.strictEqual(putRes.json.data.name, '北欧设计师扶手椅');

  // B. POST /api/products/presets/test_chair/snapshots
  const snapRes = await invokeApi('POST', '/api/products/presets/test_chair/snapshots', {
    snapshots: {
      front_0: 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=='
    }
  });
  assert.strictEqual(snapRes.statusCode, 200);
  assert.strictEqual(snapRes.json.success, true);

  // C. DELETE /api/products/presets/test_chair
  const delRes = await invokeApi('DELETE', '/api/products/presets/test_chair');
  assert.strictEqual(delRes.statusCode, 200);
  assert.strictEqual(delRes.json.success, true);
  assert.strictEqual(delRes.json.deleted, 'test_chair');

  // D. 验证预设已被彻底删除
  const checkPreset = db.prepare('SELECT * FROM product_presets WHERE id = ?').get('test_chair');
  assert.strictEqual(checkPreset, undefined);
  console.log('✅ 3D 单品家具 PUT/POST snapshots/DELETE 路由验证通过');

  console.log('=== 6. 验证色卡与基础素材库 (ba_items / ba_item_mounts) 双向同步与级联删除 ===');
  // 创建新色卡
  const newSwatch = createSwatch(db, {
    category_id: 'mat_cat_wood_floor',
    item_type: 'solid_color',
    name_zh: '普罗旺斯烟熏橡木',
    brand: '卢森地板',
    code: 'KRONO-D401',
    hex: '#8C6747',
    color_family: 'beige_brown',
    style_tags: ['法式复古', '奶油风'],
    pinned: 1,
    sort_order: 99
  });
  assert.ok(newSwatch.id);

  // 立即从 ba_items 查询该色卡对应条目
  const itemRow = db.prepare('SELECT * FROM ba_items WHERE id = ?').get(newSwatch.id);
  assert.ok(itemRow, 'ba_items 必须自动同步生成对应条目');
  assert.strictEqual(itemRow.name_zh, '普罗旺斯烟熏橡木');
  assert.strictEqual(itemRow.kind_key, 'wood_flooring');

  // 验证 ba_item_mounts 挂载
  const mounts = db.prepare('SELECT mount FROM ba_item_mounts WHERE item_id = ?').all(newSwatch.id).map(r => r.mount);
  assert.ok(mounts.includes('floor'), '木地板色卡必须自动挂载至 floor 部位');

  // 删除该色卡
  deleteSwatch(db, newSwatch.id);
  const swatchAfter = db.prepare('SELECT * FROM ba_material_swatches WHERE id = ?').get(newSwatch.id);
  assert.strictEqual(swatchAfter, undefined, '色卡应从 ba_material_swatches 删除');
  const itemAfter = db.prepare('SELECT * FROM ba_items WHERE id = ?').get(newSwatch.id);
  assert.strictEqual(itemAfter, undefined, 'ba_items 条目应被级联删除');
  const mountsAfter = db.prepare('SELECT * FROM ba_item_mounts WHERE item_id = ?').all(newSwatch.id);
  assert.strictEqual(mountsAfter.length, 0, 'ba_item_mounts 挂载记录应被级联清空');
  console.log('✅ 色卡与基础素材库双向同步与级联删除验证通过');

  console.log('\n========================================');
  console.log('🎉🎉🎉 v4 全链路端到端功能验证 100% 成功！');
  console.log('========================================\n');
}

function cleanupArtifacts() {
  // POST snapshots 还会镜像一份到仓 data/previews
  try {
    fs.rmSync(path.join(__dirname, '..', 'data', 'previews', 'test_chair_front_0.png'), { force: true });
  } catch {}
  // Windows 下 better-sqlite3 句柄不关闭会导致目录 rm 失败
  try { db.close(); } catch {}
  try { fs.rmSync(testDir, { recursive: true, force: true }); } catch {}
}

if (require.main === module) {
  runTests().then(cleanupArtifacts).catch(err => {
    cleanupArtifacts();
    console.error('❌ 测试执行失败:', err);
    process.exit(1);
  });
}

module.exports = { runTests, cleanupArtifacts };
