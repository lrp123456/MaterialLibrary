const Database = require('better-sqlite3');
const db = new Database('/home/lrp/.dsh-material-library/material.db', { readonly: true });

// 1. 同名色号分析
const duplicates = db.prepare(`
  SELECT name_zh, COUNT(*) as c, GROUP_CONCAT(external_sku, ' | ') as skus, GROUP_CONCAT(hex, ' | ') as hexes
  FROM ba_items
  WHERE kind_key = 'latex'
  GROUP BY name_zh
  HAVING c > 1
  ORDER BY c DESC
  LIMIT 25
`).all();

console.log('=== 同名色号 TOP 25 ===');
for (const d of duplicates) {
  console.log(`【${d.name_zh}】出现 ${d.c} 次`);
  console.log(`  色号: ${d.skus}`);
  console.log(`  色值: ${d.hexes}`);
}

// 2. 统计立邦 898 款中，共有多少个不重复的 name_zh
const totalLatex = db.prepare("SELECT COUNT(*) as c FROM ba_items WHERE kind_key = 'latex'").get().c;
const uniqueNames = db.prepare("SELECT COUNT(DISTINCT name_zh) as c FROM ba_items WHERE kind_key = 'latex'").get().c;
console.log(`\n立邦乳胶漆总记录数: ${totalLatex}，独立中文色名数: ${uniqueNames} (重名条目占比: ${totalLatex - uniqueNames} 条)`);

// 3. 分析色号编码与色相家族 (比如 OW033-1 ~ OW033-4，或 NNxxxx 色号家族)
const prefixAnalysis = db.prepare(`
  SELECT 
    substr(external_sku, 1, instr(external_sku, '-') - 1) as prefix,
    COUNT(*) as count
  FROM ba_items
  WHERE kind_key = 'latex' AND external_sku LIKE '%-%'
  GROUP BY prefix
  ORDER BY count DESC
  LIMIT 15
`).all();
console.log('\n=== 色号前缀/产品线分布 ===');
for (const p of prefixAnalysis) {
  console.log(`  前缀 [${p.prefix}]: ${p.count} 款`);
}
