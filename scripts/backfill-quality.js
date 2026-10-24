/**
 * 9 维质量分回填（存量素材）
 *
 * 背景：assets.sharpness 这一列自建表起就没被生产链路写过，
 * 导致老的「锐度」维度恒为 0 分。本脚本用真实像素分析把存量素材补齐：
 *   - assets.sharpness  ← 拉普拉斯方差归一值（0~10 量纲，与老评分函数一致）
 *   - asset_quality_score ← 9 维得分落表
 *
 * 必须在 WSL 侧跑（node_modules 是 /mnt/c 共享目录，里面是 Linux-ELF 的
 * better-sqlite3 / sharp；在 Windows 侧跑会加载失败或写坏共享模块）。
 *
 * 用法：
 *   node scripts/backfill-quality.js              # 全量
 *   node scripts/backfill-quality.js --limit=200  # 只跑前 200 张
 *   node scripts/backfill-quality.js --concurrency=4
 */
const path = require('path');
const os = require('os');

const dataDir = process.env.ML_DATA_DIR || path.join(os.homedir(), '.dsh-material-library');
const { openDb } = require('../src/db');
const { ensureQualityTable, analyzeImage, scoreAsset, resolveAssetImagePath } = require('../src/quality-score');

function parseArgs() {
  const out = { limit: 0, concurrency: 4 };
  for (const arg of process.argv.slice(2)) {
    const m = /^--([a-zA-Z]+)=(.+)$/.exec(arg);
    if (!m) continue;
    const k = m[1].toLowerCase();
    const v = Number(m[2]);
    if (k === 'limit') out.limit = v || 0;
    else if (k === 'concurrency') out.concurrency = Math.max(1, v || 1);
  }
  return out;
}

async function main() {
  const args = parseArgs();
  const db = openDb(dataDir);
  const config = { dataDir, nasDir: process.env.ML_NAS_DIR || '/mnt/synology/material' };
  const services = { db, config, logger: console };

  ensureQualityTable(db);

  // 只处理图片素材；视频/音频不做像素分析
  let sql = `
    SELECT a.fid, a.width, a.height, a.origin_orientation, a.orientation,
           a.has_watermark, a.favorited_at, a.created_at, a.status
    FROM assets a
    WHERE a.kind = 'image'
      AND (a.status IS NULL OR a.status NOT IN ('deleted','excluded'))
  `;
  const params = [];
  if (args.limit > 0) {
    sql += ' ORDER BY a.created_at DESC LIMIT ?';
    params.push(args.limit);
  }
  const rows = db.prepare(sql).all(...params);
  console.log(`[backfill-quality] 待处理 ${rows.length} 张，并发 ${args.concurrency}`);

  let done = 0;
  let failed = 0;
  const derivCountCache = new Map();
  const derivCountOf = (fid) => {
    if (!derivCountCache.has(fid)) {
      const r = db.prepare('SELECT COUNT(*) AS c FROM derivatives WHERE asset_fid=?').get(fid);
      derivCountCache.set(fid, r ? r.c : 0);
    }
    return derivCountCache.get(fid);
  };

  const queue = rows.slice();
  const worker = async () => {
    while (queue.length) {
      const asset = queue.shift();
      try {
        const filePath = await resolveAssetImagePath(services, asset);
        const media = await analyzeImage(filePath);
        db.prepare('UPDATE assets SET sharpness=? WHERE fid=?').run(media.sharpness * 10, asset.fid);
        const result = scoreAsset(asset, derivCountOf(asset.fid), media);
        db.prepare(`
          INSERT INTO asset_quality_score (fid, total, max_score, dims_json, media_json, analyzed_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?)
          ON CONFLICT(fid) DO UPDATE SET
            total=excluded.total, max_score=excluded.max_score,
            dims_json=excluded.dims_json, media_json=excluded.media_json,
            analyzed_at=excluded.analyzed_at, updated_at=excluded.updated_at
        `).run(
          asset.fid, result.total, result.max, JSON.stringify(result.dims),
          JSON.stringify(media), Date.now(), Date.now(),
        );
        done++;
        if (done % 100 === 0) console.log(`[backfill-quality] 已处理 ${done}/${rows.length}`);
      } catch (e) {
        failed++;
        if (failed <= 5) console.warn(`[backfill-quality] ${asset.fid} 失败: ${e.message}`);
      }
    }
  };

  await Promise.all(Array.from({ length: args.concurrency }, () => worker()));

  const stat = db.prepare('SELECT COUNT(*) AS c, AVG(total) AS avg FROM asset_quality_score').get();
  console.log(`[backfill-quality] 完成：成功 ${done}，失败 ${failed}，表内 ${stat.c} 条，平均分 ${(stat.avg || 0).toFixed(1)}`);
  db.close();
}

main().catch((e) => {
  console.error('[backfill-quality] 失败:', e);
  process.exit(1);
});
