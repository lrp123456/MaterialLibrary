/**
 * 基础素材数据重组与清洗脚本
 * 严格按照已锁定的用户规则：
 * 1. 彻底删除：玻璃（glass）、金属（metal）、藤编（rattan）、微水泥（microcement）；
 * 2. 地毯（carpet）移入选品（product），从软装移出；
 * 3. 千年舟木板改挂全屋定制板材（board, mount: millwork），不再作为墙面木饰面；
 * 4. 德利丰已有岩板挂载到瓷砖（石纹），同时挂地面 floor、墙面 wall、全屋定制台面 millwork；
 * 5. 多处挂载同一条记录，不复制。
 */

const path = require('path');
const { openDb } = require('../src/db');

function reorganizeBaseLibrary(db) {
  console.log('[reorganize] 开始执行基础素材分类重排与清洗...');

  db.transaction(() => {
    // 1. 彻底删除类目：玻璃、金属、藤编、微水泥
    const deletedItems = db.prepare(`
      DELETE FROM ba_items
      WHERE kind_key IN ('glass', 'metal', 'rattan', 'microcement')
    `).run();
    console.log(`[reorganize] 已删除废弃类目 (glass, metal, rattan, microcement) 条目数: ${deletedItems.changes}`);

    // 清理残留的孤儿 mounts
    const deletedMounts = db.prepare(`
      DELETE FROM ba_item_mounts
      WHERE item_id NOT IN (SELECT id FROM ba_items)
    `).run();
    console.log(`[reorganize] 已清理孤儿 mounts: ${deletedMounts.changes}`);

    // 2. 地毯进选品
    db.prepare(`
      UPDATE ba_items
      SET kind = 'product', kind_key = 'carpet'
      WHERE kind_key = 'carpet'
    `).run();
    db.prepare(`
      DELETE FROM ba_item_mounts
      WHERE item_id IN (SELECT id FROM ba_items WHERE kind_key = 'carpet')
    `).run();
    const carpetIds = db.prepare("SELECT id FROM ba_items WHERE kind_key = 'carpet'").all();
    const insMount = db.prepare('INSERT OR IGNORE INTO ba_item_mounts (item_id, mount) VALUES (?, ?)');
    for (const row of carpetIds) {
      insMount.run(row.id, 'product');
    }
    console.log(`[reorganize] 已将 ${carpetIds.length} 款地毯移入选品 (product)`);

    // 3. 千年舟板材改挂全屋定制板材 (board, millwork)
    const treezoRows = db.prepare(`
      SELECT id FROM ba_items
      WHERE brand = '千年舟' OR id LIKE 'treezo%' OR source_url LIKE '%treezogroup%'
    `).all();
    if (treezoRows.length > 0) {
      db.prepare(`
        UPDATE ba_items
        SET kind_key = 'board', family = '板材'
        WHERE brand = '千年舟' OR id LIKE 'treezo%' OR source_url LIKE '%treezogroup%'
      `).run();
      for (const row of treezoRows) {
        db.prepare('DELETE FROM ba_item_mounts WHERE item_id = ?').run(row.id);
        insMount.run(row.id, 'millwork');
      }
      console.log(`[reorganize] 已将 ${treezoRows.length} 条千年舟板材改挂到全屋定制 (millwork)`);
    }

    // 4. 德利丰岩板：改挂到瓷砖（石纹），同时挂地面 floor、墙面 wall、全屋定制台面 millwork
    const delfoneRows = db.prepare(`
      SELECT id FROM ba_items
      WHERE brand = '德利丰' OR id LIKE 'delfone%' OR source_url LIKE '%delfone%'
    `).all();
    if (delfoneRows.length > 0) {
      db.prepare(`
        UPDATE ba_items
        SET kind_key = 'tile', pattern = 'stone', family = '石纹'
        WHERE brand = '德利丰' OR id LIKE 'delfone%' OR source_url LIKE '%delfone%'
      `).run();
      for (const row of delfoneRows) {
        insMount.run(row.id, 'floor');
        insMount.run(row.id, 'wall');
        insMount.run(row.id, 'millwork');
      }
      console.log(`[reorganize] 已将 ${delfoneRows.length} 条德利丰岩板挂载到地面/墙面/全屋定制`);
    }

    // 5. 现有的预设木纹和石材等挂载对齐
    db.prepare(`
      UPDATE ba_items SET kind_key = 'wood_flooring' WHERE id = 'wood_oak' OR id = 'wood_walnut';
    `).run();

  })();

  console.log('[reorganize] 基础素材重组清洗完成！');
}

if (require.main === module) {
  const dbPath = path.join(process.env.USERPROFILE || process.env.HOME, '.dsh-material-library');
  const db = openDb(dbPath);
  reorganizeBaseLibrary(db);
}

module.exports = { reorganizeBaseLibrary };
