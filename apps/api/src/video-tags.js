/**
 * 视频成片的两层标记。
 * 画面层沿用空间和风格；成片层只有一个用途。运镜不进词表。
 */
const fs = require('fs');
const path = require('path');

const PURPOSE_DIRS = ['walkthrough', 'product', 'detail', 'ad', 'portrait', 'other'];

function purposeFromText(text) {
  const s = String(text || '');
  if (!s.trim()) return '';
  if (/人像|肖像|人物动态/.test(s)) return 'portrait';
  if (/广告|宣传片|商业短片|品牌片/.test(s)) return 'ad';
  if (/特写|微距|细节/.test(s)) return 'detail';
  if (/环绕|单品|产品展示|家具展示/.test(s)) return 'product';
  if (/漫游|穿行|走入|walkthrough/i.test(s)) return 'walkthrough';
  return '';
}

function sceneDimsForCategory(category) {
  const cat = String(category || '');
  if (cat === 'furniture') return ['space', 'style_atom', 'material_kind'];
  if (cat === 'portrait' || cat === 'clothing' || cat === 'music') return [];
  return ['space', 'style_atom'];
}

function voteSceneTags(frames) {
  const list = Array.isArray(frames) ? frames : [];
  const spaces = [];
  for (const frame of list) {
    const space = String(frame?.space || '').trim();
    if (space) spaces.push(space);
  }
  let space = 'other';
  if (spaces.length === 1) {
    space = spaces[0];
  } else if (spaces.length > 1) {
    const counts = new Map();
    for (const item of spaces) counts.set(item, (counts.get(item) || 0) + 1);
    let best = 0;
    let winners = [];
    for (const [dir, count] of counts) {
      if (count > best) {
        best = count;
        winners = [dir];
      } else if (count === best) {
        winners.push(dir);
      }
    }
    space = winners.length === 1 ? winners[0] : 'other';
  }
  const styles = [];
  for (const frame of list) {
    const raw = Array.isArray(frame?.style_main)
      ? frame.style_main
      : (frame?.style_main ? [frame.style_main] : []);
    for (const item of raw) {
      const dir = String(item || '').trim();
      if (!dir || dir === 'other' || styles.includes(dir)) continue;
      styles.push(dir);
    }
  }
  return { space, style_main: styles.slice(0, 3) };
}

function purposePrompt() {
  return `你在给一段视频选一个用途。只看画面，只输出 JSON，不要解释。
用途只能是这些 dir：walkthrough(空间漫游)、product(单品展示)、detail(细节特写)、ad(商业短片)、portrait(人像动态)、other(其他)。
镜头在房间里移动是 walkthrough。主体是一件家具或单品是 product。画面几乎全是局部材质或构件是 detail。有字幕、口号、品牌或明显广告节奏是 ad。主体是人脸或人物动态是 portrait。拿不准给 other。
{"video_purpose":"walkthrough"}`;
}

function parentHasSceneTags(db, parentFid) {
  if (!parentFid) return false;
  const row = db.prepare(`
    SELECT 1 AS ok FROM asset_tags at
    JOIN tag_dict t ON t.id = at.tag_id
    WHERE at.asset_fid=? AND t.dimension IN ('space', 'style_atom')
    LIMIT 1
  `).get(parentFid);
  return !!row;
}

function sourceNoteLine(db, fid) {
  try {
    const cols = db.prepare('PRAGMA table_info(assets)').all().map((col) => col.name);
    if (!cols.includes('source_note')) return '';
    const row = db.prepare('SELECT source_note FROM assets WHERE fid=?').get(fid);
    const text = String(row?.source_note || '').replace(/\s+/g, ' ').trim().slice(0, 180);
    if (!text) return '';
    return `\n远端说明仅供参考，标签仍只能从枚举中选：${text}`;
  } catch {
    return '';
  }
}

function purposeLocked(db, fid) {
  const row = db.prepare(`
    SELECT 1 AS ok FROM asset_tags at
    JOIN tag_dict t ON t.id = at.tag_id
    WHERE at.asset_fid=? AND t.dimension='video_purpose'
      AND at.source IN ('human', 'manual', 'job')
    LIMIT 1
  `).get(fid);
  return !!row;
}

function applyVideoPurpose(db, fid, dir, source) {
  const key = String(dir || '').trim();
  if (!fid || !key) return null;
  if (!PURPOSE_DIRS.includes(key) && source !== 'human' && source !== 'manual') {
    const known = db.prepare(`
      SELECT dir FROM tag_dict
      WHERE dimension='video_purpose' AND deprecated=0 AND (dir=? OR label=?)
    `).get(key, key);
    if (!known) return null;
  }
  const tag = db.prepare(`
    SELECT id, dir FROM tag_dict
    WHERE dimension='video_purpose' AND deprecated=0 AND (dir=? OR label=?)
  `).get(key, key);
  if (!tag) return null;
  if (source === 'ai' && purposeLocked(db, fid)) return null;
  const old = db.prepare(`
    SELECT at.tag_id, at.source FROM asset_tags at
    JOIN tag_dict t ON t.id = at.tag_id
    WHERE at.asset_fid=? AND t.dimension='video_purpose'
  `).all(fid);
  if (old.some((row) => row.source === 'human' || row.source === 'manual')) return null;
  const del = db.prepare('DELETE FROM asset_tags WHERE asset_fid=? AND tag_id=?');
  for (const row of old) del.run(fid, row.tag_id);
  db.prepare(`
    INSERT INTO asset_tags (asset_fid, tag_id, role, source, confidence, updated_at)
    VALUES (?, ?, '', ?, ?, ?)
  `).run(fid, tag.id, source || 'ai', source === 'job' ? 1 : 0.7, Date.now());
  return tag.dir;
}

async function ensureVideoPoster(config, fid, src) {
  const thumb = path.join(config.dataDir, 'cache', 'thumbs', `${fid}.jpg`);
  if (fs.existsSync(thumb)) return thumb;
  const { extractVideoFrames } = require('./video-frames');
  const frames = await extractVideoFrames(src, path.join(config.dataDir, 'cache', 'temp'), {
    prefix: `poster_${fid}`,
    percents: [0],
  });
  if (!frames[0]?.path) return '';
  fs.mkdirSync(path.dirname(thumb), { recursive: true });
  fs.copyFileSync(frames[0].path, thumb);
  return thumb;
}

module.exports = {
  PURPOSE_DIRS,
  purposeFromText,
  sceneDimsForCategory,
  voteSceneTags,
  purposePrompt,
  parentHasSceneTags,
  sourceNoteLine,
  purposeLocked,
  applyVideoPurpose,
  ensureVideoPoster,
};
