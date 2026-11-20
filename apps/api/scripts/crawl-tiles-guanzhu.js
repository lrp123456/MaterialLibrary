/**
 * 冠珠瓷砖拉取与归一化入库脚本
 * 接口：https://www.cg1993.com/Ajax/AjaxData.aspx
 * 提取：平面材质图 ImageUrl、实物搭配图 ProductScene、光泽 textureName、规格 sizeName、名称 Title
 */

const path = require('path');
const { openDb } = require('../src/db');

function determinePattern(title) {
  const t = String(title || '');
  if (/木/i.test(t)) return 'wood'; // 木纹
  if (/花|拼花|艺术/i.test(t)) return 'floral'; // 拼花
  if (/纯色|素色|微水泥|水磨/i.test(t)) return 'solid'; // 纯色
  return 'stone'; // 默认主流石纹/岩板
}

function determineGloss(textureName, title) {
  const s = `${textureName || ''} ${title || ''}`;
  if (/亮光|超亮|高亮|全抛釉|抛光/i.test(s)) return 'glossy';
  if (/柔光|缎光|肤感|微光|丝光/i.test(s)) return 'soft';
  if (/哑光|亚光|质感|模具/i.test(s)) return 'matte';
  return 'soft'; // 默认柔光
}

const GLOSS_LABELS = {
  glossy: '亮光',
  soft: '柔光',
  matte: '哑光'
};

const PATTERN_LABELS = {
  wood: '木纹',
  stone: '石纹',
  floral: '拼花',
  solid: '纯色'
};

async function crawlGuanzhu(db, { maxPages = 20, pageSize = 50 } = {}) {
  console.log('[craw-guanzhu] 开始拉取冠珠瓷砖...');
  let totalFetched = 0;
  let totalInserted = 0;
  let totalUpdated = 0;
  const now = Date.now();

  const upsertItem = db.prepare(`
    INSERT INTO ba_items (
      id, kind, kind_key, name_zh, prompt_name, hex, family, lightness, role_hint, zone,
      preview_rel, external_sku, created_at, updated_at, brand, source_url, external_id, hue, name_status, origin,
      gloss, pattern, scene_rel, images_json
    ) VALUES (
      @id, @kind, @kind_key, @name_zh, @prompt_name, @hex, @family, @lightness, @role_hint, @zone,
      @preview_rel, @external_sku, @now, @now, @brand, @source_url, @external_id, @hue, @name_status, @origin,
      @gloss, @pattern, @scene_rel, @images_json
    )
    ON CONFLICT(id) DO UPDATE SET
      name_zh = excluded.name_zh,
      prompt_name = excluded.prompt_name,
      preview_rel = excluded.preview_rel,
      updated_at = excluded.updated_at,
      brand = excluded.brand,
      gloss = excluded.gloss,
      pattern = excluded.pattern,
      scene_rel = excluded.scene_rel,
      images_json = excluded.images_json
  `);

  const insMount = db.prepare('INSERT OR IGNORE INTO ba_item_mounts (item_id, mount) VALUES (?, ?)');

  for (let page = 1; page <= maxPages; page++) {
    const form = new URLSearchParams();
    form.append('action', 'GetProductList');
    form.append('pageIndex', String(page));
    form.append('pageSize', String(pageSize));
    form.append('columnId', '2');
    form.append('lcid', '4');

    const res = await fetch('https://www.cg1993.com/Ajax/AjaxData.aspx', {
      method: 'POST',
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64)',
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        'X-Requested-With': 'XMLHttpRequest'
      },
      body: form.toString()
    });

    if (!res.ok) {
      console.warn(`[crawl-guanzhu] Page ${page} failed with status: ${res.status}`);
      break;
    }

    const raw = await res.text();
    let data;
    try {
      const json = JSON.parse(raw);
      data = JSON.parse(json.data);
    } catch (e) {
      console.warn(`[crawl-guanzhu] Page ${page} parse error: ${e.message}`);
      break;
    }

    const rows = data.rows || [];
    if (rows.length === 0) {
      console.log(`[crawl-guanzhu] Page ${page} has no more products, finished.`);
      break;
    }

    const tx = db.transaction(() => {
      for (const row of rows) {
        const pid = row.Whir_U_Content_PID;
        const title = (row.Title || '').trim();
        const imgUrl = (row.ImageUrl || '').trim();
        const sceneUrl = (row.ProductScene || '').trim();
        const texture = (row.textureName || '').trim();

        // 没有参考图的条目不入库
        if (!imgUrl && !sceneUrl) continue;

        const gloss = determineGloss(texture, title);
        const pattern = determinePattern(title);
        const glossZh = GLOSS_LABELS[gloss] || '柔光';
        const patternZh = PATTERN_LABELS[pattern] || '石纹';
        const promptName = `冠珠${title}（${glossZh} ${patternZh}）`;
        const id = `guanzhu_${pid}`;
        const previewRel = imgUrl || sceneUrl;
        const images = [];
        if (imgUrl) images.push(imgUrl);
        if (sceneUrl && sceneUrl !== imgUrl) images.push(sceneUrl);

        upsertItem.run({
          id,
          kind: 'texture',
          kind_key: 'tile',
          name_zh: title,
          prompt_name: promptName,
          hex: null,
          family: patternZh,
          lightness: null,
          role_hint: null,
          zone: 'any',
          preview_rel: previewRel,
          external_sku: row.sizeName || null,
          now,
          brand: '冠珠',
          source_url: `https://www.cg1993.com/ProductCenter/detail.aspx?id=${pid}`,
          external_id: `guanzhu:${pid}`,
          hue: null,
          name_status: 'verified',
          origin: 'brand',
          gloss,
          pattern,
          scene_rel: sceneUrl || null,
          images_json: JSON.stringify(images)
        });

        // 挂载到地面
        insMount.run(id, 'floor');
        // 大板、岩板、或带墙面搭配图的亦可上墙
        if (/岩板|大板|墙/i.test(title) || /墙/i.test(sceneUrl)) {
          insMount.run(id, 'wall');
        }
        totalInserted++;
      }
    });
    tx();

    totalFetched += rows.length;
    console.log(`[crawl-guanzhu] Page ${page}: fetched ${rows.length} rows (total fetched: ${totalFetched}/${data.total})`);
    if (totalFetched >= data.total) break;
  }

  console.log(`[crawl-guanzhu] 冠珠瓷砖拉取完成！共抓取处理 ${totalInserted} 条。`);
  return { totalFetched, totalInserted };
}

if (require.main === module) {
  const dbPath = path.join(process.env.USERPROFILE || process.env.HOME, '.dsh-material-library');
  const db = openDb(dbPath);
  crawlGuanzhu(db).catch(console.error);
}

module.exports = { crawlGuanzhu };
