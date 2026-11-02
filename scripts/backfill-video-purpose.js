/**
 * 给没有 video_purpose 标签的视频补用途。
 * 默认只做关键词推断，不调用 VLM/不抽帧：
 *   node scripts/backfill-video-purpose.js --dry-run
 *   node scripts/backfill-video-purpose.js
 * 后续如需给同步视频做画面识别，再扩展 --vision（抽首帧 + purposePrompt）。
 */
const path = require('path');
const { openDb } = require('../src/db');
const videoTags = require('../src/video-tags');

const dataDir = process.env.ML_DATA_DIR || path.join(process.env.HOME || process.env.USERPROFILE, '.dsh-material-library');
const db = openDb(dataDir);
const dryRun = process.argv.includes('--dry-run');

const rows = db.prepare(`
  SELECT a.fid, a.file_name, a.source_note, a.is_ai, a.category
  FROM assets a
  WHERE a.kind = 'video' AND a.status = 'ready'
    AND NOT EXISTS (
      SELECT 1 FROM asset_tags at
      JOIN tag_dict t ON t.id = at.tag_id
      WHERE at.asset_fid = a.fid AND t.dimension = 'video_purpose'
    )
  ORDER BY a.created_at DESC
`).all();

const result = { scanned: rows.length, would_tag: 0, tagged: 0, unresolved: 0, by_purpose: {} };
for (const row of rows) {
  const text = [row.file_name, row.source_note].filter(Boolean).join(' ');
  const dir = videoTags.purposeFromText(text);
  if (!dir) {
    result.unresolved += 1;
    continue;
  }
  result.would_tag += 1;
  result.by_purpose[dir] = (result.by_purpose[dir] || 0) + 1;
  if (!dryRun) {
    const applied = videoTags.applyVideoPurpose(db, row.fid, dir, 'job');
    if (applied) result.tagged += 1;
  }
}
console.log(JSON.stringify({ ...result, dry_run: dryRun }, null, 2));
if (dryRun) console.log('dry-run：未写入标签。无明确关键词的同步视频仍需画面识别或手动打标。');
