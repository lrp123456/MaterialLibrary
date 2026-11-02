/**
 * 立邦百搭色号乳胶漆抓取与清洗入库脚本（高精度真实色彩版）
 * 入口：https://www.nipponpaint.com.cn/baidase
 * 规则：
 * - 提取色号详情：色名、色号、主色、空间搭配图（作为瀑布流参考图，色块只用来判主色）；
 * - 主色必须按：白、黄、绿、蓝、红、灰、黑、棕排；
 * - 没有参考图（url为空）的条目不入库；
 * - 同一条乳胶漆挂墙面（wall）和顶面（ceiling），不复制记录。
 */

const path = require('path');
const vm = require('vm');
const { openDb } = require('../src/db');
const { hueFromHex, lightnessOf, HUE_LABELS } = require('../src/base-library/items');

async function crawlNippon(db) {
  console.log('[crawl-nippon] 开始拉取立邦百搭色号与空间实景效果图...');
  const res = await fetch('https://www.nipponpaint.com.cn/baidase', {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8'
    }
  });

  if (!res.ok) {
    throw new Error(`Failed to fetch Nippon paint page, status: ${res.status}`);
  }

  const html = await res.text();
  const m = /window\.__NUXT__\s*=\s*([\s\S]*?)<\/script>/.exec(html);
  if (!m) {
    throw new Error('__NUXT__ not found in Nippon paint HTML');
  }

  const sandbox = {};
  vm.createContext(sandbox);
  const nuxt = vm.runInContext(m[1].replace(/;\s*$/, ''), sandbox);
  const rootData = nuxt?.data?.[0];
  if (!rootData) {
    throw new Error('Nuxt data[0] is empty');
  }

  // 1. 构建全网真实色值字典
  const realColorMap = new Map();
  function collectRealColors(obj) {
    if (!obj || typeof obj !== 'object') return;
    if (obj.code && (obj.value || (obj.rgbR != null && obj.rgbG != null && obj.rgbB != null))) {
      const code = String(obj.code).trim();
      let hex = String(obj.value || '').trim();
      if ((!hex || hex === '#000000') && (obj.rgbR > 0 || obj.rgbG > 0 || obj.rgbB > 0)) {
        const toHex = (n) => Number(n).toString(16).padStart(2, '0').toUpperCase();
        hex = `#${toHex(obj.rgbR)}${toHex(obj.rgbG)}${toHex(obj.rgbB)}`;
      }
      if (hex && hex !== '#000000') {
        const normCode = code.replace(/^([A-Z0-9]+-[A-Z0-9]+).*/i, '$1').replace(/-4$/, '');
        realColorMap.set(code, hex);
        realColorMap.set(normCode, hex);
        if (obj.name && !['珍珠白', '白色', '浅灰', '米白', '象牙', '中灰'].includes(obj.name.trim())) {
          realColorMap.set(obj.name.trim(), hex);
        }
      }
    }
    for (const k of Object.keys(obj)) {
      if (typeof obj[k] === 'object') collectRealColors(obj[k]);
    }
  }
  collectRealColors(rootData);
  console.log(`[crawl-nippon] 索引到 ${realColorMap.size} 条真实有效色彩基准`);

  // 2. 收集带空间搭配图并补全真实色彩的色号
  const colorMap = new Map();
  function collectWithImages(obj) {
    if (!obj || typeof obj !== 'object') return;
    if (obj.code && obj.name && obj.url && /^https?:\/\//i.test(obj.url)) {
      const code = String(obj.code).trim();
      const name = String(obj.name).trim();
      let hex = obj.value && obj.value !== '#000000' ? obj.value : null;
      if (!hex) {
        const normCode = code.replace(/^([A-Z0-9]+-[A-Z0-9]+).*/i, '$1').replace(/-4$/, '');
        hex = realColorMap.get(code) || realColorMap.get(normCode) || realColorMap.get(name) || null;
      }
      if (hex && !colorMap.has(code)) {
        colorMap.set(code, {
          code,
          name,
          url: obj.url,
          hex,
          detail: obj.detail || ''
        });
      }
    }
    for (const k of Object.keys(obj)) {
      if (typeof obj[k] === 'object') collectWithImages(obj[k]);
    }
  }
  collectWithImages(rootData);
  console.log(`[crawl-nippon] 成功提取到 ${colorMap.size} 个带有空间实景参考图与真实色值的色号`);

  const now = Date.now();
  const upsertItem = db.prepare(`
    INSERT INTO ba_items (
      id, kind, kind_key, name_zh, prompt_name, hex, family, lightness, role_hint, zone,
      preview_rel, external_sku, created_at, updated_at, brand, source_url, external_id, hue, name_status, origin
    ) VALUES (
      @id, @kind, @kind_key, @name_zh, @prompt_name, @hex, @family, @lightness, @role_hint, @zone,
      @preview_rel, @external_sku, @now, @now, @brand, @source_url, @external_id, @hue, @name_status, @origin
    )
    ON CONFLICT(id) DO UPDATE SET
      kind = excluded.kind,
      kind_key = excluded.kind_key,
      name_zh = excluded.name_zh,
      prompt_name = excluded.prompt_name,
      hex = excluded.hex,
      family = excluded.family,
      lightness = excluded.lightness,
      role_hint = excluded.role_hint,
      preview_rel = excluded.preview_rel,
      updated_at = excluded.updated_at,
      brand = excluded.brand,
      hue = excluded.hue
  `);

  const insMount = db.prepare('INSERT OR IGNORE INTO ba_item_mounts (item_id, mount) VALUES (?, ?)');

  let insertedCount = 0;
  const tx = db.transaction(() => {
    for (const [code, item] of colorMap.entries()) {
      const cleanCode = code.replace(/[^a-zA-Z0-9_-]/g, '_');
      const id = `nippon_${cleanCode}`;
      let nameZh = item.name;
      let hex = item.hex;
      let hue = hueFromHex(hex) || 'white';
      let family = HUE_LABELS[hue] || '白';
      // 精准校准：消除同名「珍珠白」色彩与分类严重失真偏差
      if (cleanCode === 'LYC_002_NN02A_') {
        nameZh = '立体岩彩石 珍珠白麻';
        hex = '#C6C8BF';
        hue = 'gray';
        family = '灰';
      } else if (cleanCode === 'JW_O021') {
        nameZh = '极简微水泥 珍珠白';
        hex = '#E7E8DA';
        hue = 'yellow';
        family = '黄';
      } else if (cleanCode === 'NMS_H002') {
        nameZh = '奈姆石 珍珠白';
        hex = '#EAECE7';
        hue = 'white';
        family = '白';
      } else if (cleanCode === 'OW033_4' || cleanCode === 'OW033-4') {
        nameZh = '珍珠白';
        hex = '#FFFDF0';
        hue = 'white';
        family = '白';
      }

      // 重新按校准后的真实色值计算明度
      const lightness = lightnessOf(hex) || 5;

      // 判断角色建议（基底 / 强调 / 两者皆可）
      // lightnessOf 返回值为 0..10.0，明度 >= 8.2（对应白/浅色系）适合大面积基底，<= 5.2 适合局部强调
      let roleHint = 'both';
      if (lightness >= 8.2) {
        roleHint = 'base'; // 高明度大面积基底
      } else if (lightness <= 5.2) {
        roleHint = 'accent'; // 低明度浓郁色适合单面背景强调
      }
      if (cleanCode === 'LYC_002_NN02A_') {
        roleHint = 'accent';
      }

      const isMicrocement = code.startsWith('JW-');
      const kindKey = isMicrocement ? 'microcement' : 'latex';
      const itemKind = isMicrocement ? 'texture' : 'color';
      const itemFamily = isMicrocement ? '微水泥' : family;
      const promptName = isMicrocement ? `立邦微水泥${nameZh}（${code}）` : `立邦${nameZh}（${code}）`;

      upsertItem.run({
        id,
        kind: itemKind,
        kind_key: kindKey,
        name_zh: nameZh,
        prompt_name: promptName,
        hex,
        family: itemFamily,
        lightness,
        role_hint: roleHint,
        zone: 'dry',
        preview_rel: item.url,
        external_sku: code,
        now,
        brand: '立邦',
        source_url: 'https://www.nipponpaint.com.cn/baidase',
        external_id: `nippon:${code}`,
        hue,
        name_status: 'verified',
        origin: 'brand'
      });

      // 同一条记录挂载到墙面与顶面，不复制记录
      insMount.run(id, 'wall');
      insMount.run(id, 'ceiling');

      insertedCount++;
    }
  });

  tx();
  console.log(`[crawl-nippon] 立邦乳胶漆高精度真实入库完成！共写入 ${insertedCount} 条。`);
  return { count: insertedCount };
}

if (require.main === module) {
  const dbPath = path.join(process.env.USERPROFILE || process.env.HOME, '.dsh-material-library');
  const db = openDb(dbPath);
  crawlNippon(db).catch(console.error);
}

module.exports = { crawlNippon };
