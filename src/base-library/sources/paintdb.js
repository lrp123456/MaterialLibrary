/**
 * PaintDB 官方公开 API 镜像适配器
 * 官方响应结构：
 * {
 *   data: [
 *     {
 *       code: "NN0001-4",
 *       name: "Barley White",
 *       hex: "#F5F2EB",
 *       family: "White",
 *       undertone: "Warm",
 *       lrv: 85,
 *       interior: true,
 *       brand: { slug: "nippon-paint" },
 *       url: "https://paintdb.com/colors/..."
 *     }
 *   ],
 *   links: { next: "https://paintdb.com/api/v1/colors?page=2" },
 *   meta: { total: 2720 }
 * }
 */

const { normalizeHex, ensurePaintSwatchFile } = require('../swatch');

function normalizePaintId(brand, code) {
  const safeBrand = String(brand).toLowerCase().replace(/[^a-z0-9_-]/g, '_');
  const safeCode = String(code).replace(/[^A-Za-z0-9._-]/g, '_');
  return `paint_${safeBrand}_${safeCode}`;
}

function deriveChineseName(undertone, family) {
  const toneMap = {
    warm: '暖调',
    cool: '冷调',
    neutral: '中性',
    muted: '柔灰',
    bright: '明艳'
  };
  const famMap = {
    white: '白',
    beige: '米',
    gray: '灰',
    grey: '灰',
    blue: '蓝',
    green: '绿',
    yellow: '黄',
    red: '红',
    pink: '粉',
    brown: '棕',
    black: '黑',
    orange: '橙',
    purple: '紫'
  };

  const t = (undertone || '').toLowerCase().trim();
  const f = (family || '').toLowerCase().trim();

  const toneZh = toneMap[t] || '';
  const famZh = famMap[f] || (family || '色');

  if (toneZh && famZh) return `${toneZh}${famZh}色`;
  if (famZh) return `${famZh}色`;
  return '色卡';
}

/**
 * 将 PaintDB 单页数据入库（幂等 upsert）
 * 规则：
 * 1. 原始 code 唯一
 * 2. INSERT 阶段置顶前 36 条（pinned = 1）；已有记录在重跑时不覆盖 alias_zh, pinned, shell_material_id
 */
async function upsertPaintDbPage(db, dataDir, brand, pageData = [], { autoGenerateSwatches = false } = {}) {
  const now = Date.now();
  const countBefore = db.prepare('SELECT COUNT(*) as c FROM ba_paints WHERE brand=?').get(brand)?.c || 0;

  const ins = db.prepare(`
    INSERT INTO ba_paints (
      id, brand, code, name_en, name_zh, alias_zh, alt_code, hex, family, lrv, interior, pinned, shell_material_id, swatch_rel, source_url, curated, created_at, updated_at
    ) VALUES (
      ?, ?, ?, ?, ?, NULL, NULL, ?, ?, ?, ?, 0, NULL, NULL, ?, 0, ?, ?
    )
    ON CONFLICT(brand, code) DO UPDATE SET
      name_en=excluded.name_en,
      name_zh=COALESCE(ba_paints.name_zh, excluded.name_zh),
      hex=excluded.hex,
      family=excluded.family,
      lrv=excluded.lrv,
      interior=excluded.interior,
      source_url=excluded.source_url,
      updated_at=excluded.updated_at
  `);

  let written = 0;
  for (let i = 0; i < pageData.length; i++) {
    const item = pageData[i];
    if (!item || !item.code) continue;

    const paintId = normalizePaintId(brand, item.code);
    const hex = normalizeHex(item.hex || '#CCCCCC');
    const nameEn = (item.name || item.code).trim();
    const nameZh = deriveChineseName(item.undertone, item.family);
    const lrv = typeof item.lrv === 'number' ? item.lrv : null;
    const interior = item.interior !== false ? 1 : 0;
    const sourceUrl = item.url || `https://paintdb.com/colors/${brand}/${encodeURIComponent(item.code)}`;

    ins.run(
      paintId,
      brand,
      item.code,
      nameEn,
      nameZh,
      hex,
      item.family || null,
      lrv,
      interior,
      sourceUrl,
      now,
      now
    );

    written++;
  }

  return written;
}

/**
 * 回收僵死超过 2 分钟的 running 镜像任务
 */
function cleanupDeadMirrorRuns(db, now = Date.now()) {
  const timeoutMs = 2 * 60 * 1000;
  const cutoff = now - timeoutMs;
  db.prepare(`
    UPDATE ba_mirror_runs 
    SET state='error', error='mirror_timeout', updated_at=?
    WHERE state='running' AND updated_at < ?
  `).run(now, cutoff);
}

module.exports = {
  normalizePaintId,
  deriveChineseName,
  upsertPaintDbPage,
  cleanupDeadMirrorRuns
};
