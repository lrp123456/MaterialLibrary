/**
 * 底图价签与场景绑定管理模块 (ba_image_bindings)
 */

const IMAGE_KEY_REGEX = /^(fid|img):[A-Za-z0-9._-]{4,80}$/;

function isValidImageKey(key) {
  return typeof key === 'string' && IMAGE_KEY_REGEX.test(key);
}

function getImageBindings(db, imageKey) {
  if (!isValidImageKey(imageKey)) {
    throw new Error('invalid_image_key');
  }
  const row = db.prepare('SELECT * FROM ba_image_bindings WHERE image_key = ?').get(imageKey);
  if (!row) return null;
  let regions = [];
  try {
    regions = JSON.parse(row.regions_json || '[]');
  } catch {}
  return {
    image_key: row.image_key,
    regions,
    light_mode: row.light_mode,
    kelvin: row.kelvin,
    updated_at: row.updated_at
  };
}

function putImageBindings(db, imageKey, { regions = [], light_mode = null, kelvin = null } = {}) {
  if (!isValidImageKey(imageKey)) {
    throw new Error('invalid_image_key');
  }
  const now = Date.now();
  const regionsJson = JSON.stringify(regions || []);
  const stmt = db.prepare(`
    INSERT INTO ba_image_bindings (image_key, regions_json, light_mode, kelvin, updated_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(image_key) DO UPDATE SET
      regions_json = excluded.regions_json,
      light_mode = excluded.light_mode,
      kelvin = excluded.kelvin,
      updated_at = excluded.updated_at
  `);
  stmt.run(imageKey, regionsJson, light_mode || null, typeof kelvin === 'number' ? kelvin : null, now);
  return {
    image_key: imageKey,
    regions: regions || [],
    light_mode: light_mode || null,
    kelvin: typeof kelvin === 'number' ? kelvin : null,
    updated_at: now
  };
}

module.exports = {
  isValidImageKey,
  getImageBindings,
  putImageBindings
};
