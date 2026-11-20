/**
 * 基础属性编译器与底图价签单元测试 (base-library-compile)
 */

const assert = require('assert');
const Database = require('better-sqlite3');
const { ensureBaseLibrarySchema } = require('../src/base-library/schema');
const { compileBaseAttributes } = require('../src/base-library/compile');
const { getImageBindings, putImageBindings, isValidImageKey } = require('../src/base-library/bindings');
const { setFlag } = require('../src/base-library/list');

async function runTests() {
  const db = new Database(':memory:');
  ensureBaseLibrarySchema(db);

  // 默认启用 base_library 和 base_library_paints
  setFlag(db, 'base_library', 1);
  setFlag(db, 'base_library_paints', 1);

  console.log('=== 1. 测试色号编译 (本地色块 Swatch) ===');
  db.prepare(`
    INSERT INTO ba_paints (id, brand, code, name_en, name_zh, hex, family, lrv, interior, created_at, updated_at)
    VALUES ('paint_nippon_warm_beige', 'nippon-paint', 'NP N 2034P', 'Abacadabra', '暖调米色', '#CDC8C1', 'beige', 58, 1, 1000, 1000)
  `).run();

  const resPaint = compileBaseAttributes(db, {
    regions: [{
      region_id: 'reg_wall_1',
      surface: 'wall',
      subclass: 'wall_paint',
      warehouse: 'paint',
      asset_id: 'paint_nippon_warm_beige',
      finish: 'matte',
      roughness: 70
    }],
    light_mode: 'keep'
  });

  assert.strictEqual(resPaint.success, true);
  assert.strictEqual(resPaint.clauses.length, 1);
  assert.strictEqual(resPaint.clauses[0].reference, null);
  assert.ok(resPaint.prompt.includes('不要添加色块'));
  assert.ok(!/swatch\.png/.test(resPaint.prompt));
  assert.ok(resPaint.prompt.includes('暖调米色'));
  assert.ok(resPaint.prompt.includes('立邦'));
  assert.ok(resPaint.prompt.includes('NP N 2034P'));
  assert.ok(resPaint.prompt.includes('表面呈哑光'));
  assert.ok(resPaint.prompt.includes('呈现凹凸明显的粗粝立体颗粒与微孔纹理'));
  assert.strictEqual(resPaint.light_clause, '保持原图的主光方向和阴影形状。');
  console.log('✅ 色号与粗糙度编译校验通过');

  console.log('=== 2. 测试艺术漆底色壳联动 (Shell Material) ===');
  db.prepare(`
    INSERT INTO ba_materials (id, name_cn, source, is_shell, basecolor_rel, width, height, created_at, updated_at)
    VALUES ('mat_micro_cement', '微水泥壳', 'manual', 1, 'cache/base-library/materials/mat_micro_cement/basecolor.jpg', 1024, 1024, 1000, 1000)
  `).run();
  db.prepare(`
    UPDATE ba_paints SET shell_material_id = 'mat_micro_cement' WHERE id = 'paint_nippon_warm_beige'
  `).run();

  const resShell = compileBaseAttributes(db, {
    regions: [{
      region_id: 'reg_wall_shell',
      surface: 'wall',
      subclass: 'wall_paint',
      warehouse: 'paint',
      asset_id: 'paint_nippon_warm_beige',
      use_shell: true,
      finish: 'satin',
      roughness: 15
    }]
  });

  assert.strictEqual(resShell.clauses[0].reference, null);
  assert.ok(!resShell.prompt.includes('basecolor.jpg'));
  assert.ok((resShell.warnings || []).some((item) => item.includes('shell_ignored')));
  assert.ok(resShell.prompt.includes('微距触感极平滑丝光细腻'));
  console.log('✅ 底色壳联动引用与细腻粗糙度校验通过');

  console.log('=== 3. 测试材质编译 (1K 底色) ===');
  db.prepare(`
    INSERT INTO ba_materials (id, name_cn, source, is_shell, basecolor_rel, width, height, created_at, updated_at)
    VALUES ('mat_oak_floor', '白橡木地板', 'ambientcg', 0, 'cache/base-library/materials/mat_oak_floor/basecolor.jpg', 1024, 1024, 1000, 1000)
  `).run();

  const resMat = compileBaseAttributes(db, {
    regions: [{
      region_id: 'reg_floor_1',
      surface: 'floor',
      subclass: 'floor_wood',
      warehouse: 'material',
      asset_id: 'mat_oak_floor',
      finish: 'satin',
      roughness: 50
    }]
  });

  assert.strictEqual(resMat.clauses[0].reference.kind, 'basecolor');
  assert.ok(resMat.prompt.includes('白橡木地板'));
  assert.ok(resMat.prompt.includes('微带自然细腻的原生肌理'));
  console.log('✅ 材质 1K 底色编译校验通过');

  console.log('=== 4. 测试柜体跟随门板与模型/灯具固定句 ===');
  const resMillwork = compileBaseAttributes(db, {
    regions: [
      {
        region_id: 'reg_door',
        surface: 'millwork',
        subclass: 'millwork_door',
        warehouse: 'material',
        asset_id: 'mat_oak_floor'
      },
      {
        region_id: 'reg_carcass',
        surface: 'millwork',
        subclass: 'millwork_carcass',
        warehouse: 'material',
        asset_id: null
      },
      {
        region_id: 'reg_light',
        surface: 'lighting',
        subclass: 'lighting',
        warehouse: 'light'
      }
    ]
  });

  assert.strictEqual(resMillwork.clauses[1].reference, null);
  assert.ok(resMillwork.clauses[1].text.includes('柜体结构与门板使用同一材质'));
  assert.strictEqual(resMillwork.clauses[2].reference, null);
  assert.ok(resMillwork.clauses[2].text.includes('这一版不替换这里的灯具'));
  console.log('✅ 柜体跟随与模型/灯具无参考图规则校验通过');

  console.log('=== 5. 测试全局光向与色温 ===');
  const resLight = compileBaseAttributes(db, {
    regions: [],
    light_mode: 'upper_left',
    kelvin: 3000
  });
  assert.ok(resLight.light_clause.includes('左上'));
  assert.ok(resLight.light_clause.includes('3000K'));
  console.log('✅ 光向与色温生成正常');

  console.log('=== 6. 测试参考图上限截断 (maxRefs) ===');
  const resTrunc = compileBaseAttributes(db, {
    regions: [
      { region_id: 'r1', warehouse: 'material', asset_id: 'mat_oak_floor' },
      { region_id: 'r2', warehouse: 'material', asset_id: 'mat_oak_floor' },
      { region_id: 'r3', warehouse: 'material', asset_id: 'mat_oak_floor' }
    ],
    maxRefs: 2
  });
  assert.strictEqual(resTrunc.references.length, 2, '参考图张数必须截断为 2');
  assert.strictEqual(resTrunc.ref_dropped.length, 1, '必须记录 1 条被丢弃的参考图选区');
  assert.strictEqual(resTrunc.ref_dropped[0], 'r3');
  assert.strictEqual(resTrunc.clauses[2].reference, null, '超额选区参考图置空');
  assert.ok(resTrunc.clauses[2].text.length > 0, '超额选区文本依然完整保留');
  console.log('✅ 参考图上限截断与 ref_dropped 校验通过');

  console.log('=== 7. 测试 Flag 关闭时色块优雅降级 ===');
  setFlag(db, 'base_library_paints', 0);
  const resFlagOff = compileBaseAttributes(db, {
    regions: [{ region_id: 'r_off', warehouse: 'paint', asset_id: 'paint_nippon_warm_beige' }]
  });
  assert.strictEqual(resFlagOff.clauses[0].reference, null, '标志关闭时不发出参考图');
  assert.ok(resFlagOff.prompt.includes('暖调米色'), '文本提示词依然保留');
  console.log('✅ 色号标志关闭平稳降级通过');

  console.log('=== 9. 测试参考图编号跳过轨道 A ===');
  const resTags = compileBaseAttributes(db, {
    regions: [
      { region_id: 'floor', warehouse: 'material', asset_id: 'mat_oak_floor', bbox: { x1: 0, y1: 700, x2: 999, y2: 999 } },
      { region_id: 'wall', warehouse: 'paint', asset_id: 'paint_nippon_warm_beige', bbox: { x1: 0, y1: 0, x2: 400, y2: 400 } },
      { region_id: 'stone', warehouse: 'material', asset_id: 'mat_oak_floor', bbox: { x1: 400, y1: 0, x2: 900, y2: 500 } }
    ],
    firstRefIndex: 3,
    maxRefs: 4
  });
  assert.strictEqual(resTags.references.length, 2);
  assert.strictEqual(resTags.references[0].refImageTag, '图3');
  assert.strictEqual(resTags.references[1].refImageTag, '图4');
  assert.ok(resTags.clauses[0].text.includes('图3'));
  assert.ok(!resTags.clauses[1].text.includes('图3'));
  assert.ok(resTags.clauses[1].reference === null);
  assert.ok(resTags.clauses[2].text.includes('图4'));
  assert.ok(!resTags.prompt.includes('对齐图2'));
  console.log('✅ 参考图编号按实际出图递增');

  console.log('=== 8. 测试价签持久化 (ba_image_bindings) ===');
  assert.strictEqual(isValidImageKey('fid:asset_12345'), true);
  assert.strictEqual(isValidImageKey('img:abcdef0123456789'), true);
  assert.strictEqual(isValidImageKey('invalid:key!'), false);

  const testKey = 'fid:asset_scene_001';
  putImageBindings(db, testKey, {
    regions: [{ region_id: 'reg_1', surface: 'floor' }],
    light_mode: 'left',
    kelvin: 4000
  });

  const saved = getImageBindings(db, testKey);
  assert.strictEqual(saved.image_key, testKey);
  assert.strictEqual(saved.regions.length, 1);
  assert.strictEqual(saved.light_mode, 'left');
  assert.strictEqual(saved.kelvin, 4000);
  console.log('✅ 价签存储与读取校验通过');

  console.log('=== 10. 测试部位白名单强拦截（沙发拒绝乳胶漆） ===');
  const resUphReject = compileBaseAttributes(db, {
    regions: [
      {
        region_id: 'sofa_reg',
        part: 'upholstery',
        warehouse: 'paint',
        asset_id: 'paint_nippon_warm_beige'
      }
    ]
  });
  assert.strictEqual(resUphReject.clauses[0].reference, null);
  assert.ok(resUphReject.clauses[0].text.includes('保持原样'));
  assert.ok(resUphReject.warnings.some(w => w.includes('part_asset_rejected')));
  console.log('✅ 沙发部位拒绝乳胶漆强门禁校验通过');

  console.log('\n🎉 base-library-compile 全部测试通过！');
}

runTests().catch((err) => {
  console.error('测试失败:', err);
  process.exit(1);
});
