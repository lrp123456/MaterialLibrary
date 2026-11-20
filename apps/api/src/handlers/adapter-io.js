/**
 * 快捷操作共用：挑图像/视频适配器，并读取 executeAdapter 落盘结果。
 * executeAdapter 的 files[0] 是 { localPath }，不是路径字符串。
 */
const fs = require('fs');

function findImageAdapter(db, preferredModel) {
  if (!db || typeof db.prepare !== 'function') return null;
  const want = String(preferredModel || '').toLowerCase();
  try {
    if (want) {
      if (want.includes('agnes')) {
        const agnes = db.prepare(`SELECT * FROM gen_adapters WHERE enabled=1 AND (id='agnes_image' OR id LIKE '%agnes_image%') LIMIT 1`).get();
        if (agnes) return agnes;
      } else if (want.includes('seedream') || want.includes('doubao') || want.includes('ark')) {
        const ark = db.prepare(`SELECT * FROM gen_adapters WHERE enabled=1 AND (id='ark_seedream' OR id LIKE '%seedream%') LIMIT 1`).get();
        if (ark) return ark;
      }
    }
    return db.prepare(`
      SELECT * FROM gen_adapters
      WHERE enabled=1
        AND id NOT LIKE '%litellm%'
        AND id NOT LIKE '%video%'
        AND id NOT LIKE '%seedance%'
        AND (
          id IN ('ark_seedream', 'agnes_image')
          OR id LIKE '%seedream%'
          OR id LIKE '%agnes_image%'
        )
      ORDER BY CASE id
        WHEN 'ark_seedream' THEN 0
        WHEN 'agnes_image' THEN 1
        ELSE 2
      END, id ASC
      LIMIT 1
    `).get() || null;
  } catch {
    return null;
  }
}

function findSeedanceAdapter(db) {
  if (!db || typeof db.prepare !== 'function') return null;
  try {
    return db.prepare(`
      SELECT * FROM gen_adapters
      WHERE enabled=1
        AND id NOT LIKE '%litellm%'
        AND (id = 'ark_seedance' OR id LIKE '%seedance%')
      ORDER BY CASE id WHEN 'ark_seedance' THEN 0 ELSE 1 END, id ASC
      LIMIT 1
    `).get() || null;
  } catch {
    return null;
  }
}

function adapterOutputPath(result) {
  if (result && result.ok === false) {
    throw new Error(result.error || '适配器执行失败');
  }
  const file = result && result.files && result.files[0];
  const p = typeof file === 'string' ? file : (file && (file.localPath || file.path));
  if (p && fs.existsSync(p)) return p;
  return null;
}

function readAdapterOutput(result) {
  const p = adapterOutputPath(result);
  if (!p) return null;
  return fs.readFileSync(p);
}

module.exports = {
  findImageAdapter,
  findSeedanceAdapter,
  adapterOutputPath,
  readAdapterOutput,
};
