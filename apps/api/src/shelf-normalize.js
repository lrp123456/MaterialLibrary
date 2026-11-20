/**
 * 把成片阶段收成 library_shelf 单值，并补上音频角色标签。
 * 回填只跑一次。之后列表只按这一列过滤。
 */

const normalized = new WeakSet();

const DERIV_KINDS = [
  'style_transferred', 'quick_replace', 'quick_remove', 'quick_insert',
  'clarity_enhanced', 'expand', 'retouched', 'manual_edit'
];

function ensureAudioRoleTags(db) {
  const rows = [
    ['bgm', '氛围背景乐'],
    ['sfx', '环境音效']
  ];
  const upsert = db.prepare(`
    INSERT INTO tag_dict(dimension, dir, label, aliases, is_fallback, deprecated, parent_dir)
    VALUES('audio_role', ?, ?, NULL, 0, 0, NULL)
    ON CONFLICT(dimension, dir) DO UPDATE SET
      label=excluded.label,
      deprecated=0
  `);
  for (const [dir, label] of rows) upsert.run(dir, label);
  const bgm = db.prepare("SELECT id FROM tag_dict WHERE dimension='audio_role' AND dir='bgm'").get();
  if (!bgm) return;
  const now = Date.now();
  db.prepare(`
    INSERT OR IGNORE INTO asset_tags(asset_fid, tag_id, role, source, confidence, updated_at)
    SELECT a.fid, ?, '', 'backfill', 1, ?
    FROM assets a
    WHERE (a.kind = 'audio' OR a.category = 'music')
      AND NOT EXISTS (
        SELECT 1 FROM asset_tags at
        JOIN tag_dict t ON t.id = at.tag_id
        WHERE at.asset_fid = a.fid AND t.dimension = 'audio_role'
      )
  `).run(bgm.id, now);
}

function normalizeLibraryShelves(db) {
  if (normalized.has(db)) return;
  const names = new Set(db.prepare('PRAGMA table_info(assets)').all().map((c) => c.name));
  if (!names.has('library_shelf')) {
    db.exec("ALTER TABLE assets ADD COLUMN library_shelf TEXT DEFAULT 'original'");
  }
  const placeholders = DERIV_KINDS.map(() => '?').join(',');
  const tx = db.transaction(() => {
    db.prepare(`
      UPDATE assets SET library_shelf = 'finished'
      WHERE library_shelf = 'finished' OR category = 'finished'
    `).run();
    db.prepare(`
      UPDATE assets SET library_shelf = 'retouched'
      WHERE COALESCE(library_shelf, '') != 'finished'
        AND (
          is_ai = 1
          OR (source_asset_id IS NOT NULL AND source_asset_id != '')
          OR fid IN (SELECT asset_fid FROM derivatives WHERE kind IN (${placeholders}))
        )
    `).run(...DERIV_KINDS);
    db.prepare(`
      UPDATE assets SET library_shelf = 'original'
      WHERE library_shelf IS NULL OR library_shelf = ''
    `).run();
    ensureAudioRoleTags(db);
  });
  tx();
  normalized.add(db);
}

module.exports = { normalizeLibraryShelves, ensureAudioRoleTags };
