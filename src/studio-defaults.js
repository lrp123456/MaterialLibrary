/**
 * 工作室默认配置权威管理器 (Single Authority for Studio Defaults)
 * 支持在服务端集中配置与动态热修改：默认模型、默认画幅、默认清晰度/尺寸
 */

const DEFAULT_STUDIO_SETTINGS = {
  models: {
    image: 'gemini_3_1_flash_image', // 图片生成默认：gemini-3
    video: 'seedance2_0',            // 视频生成默认：seedance2.0
    chat: 'gemini_4_argon',
    music: 'doubao_bgm_v5'
  },
  // 第三层：按模型维度的个性化默认值（modelId -> { ... }），由工作台按需写入
  perModel: {},
  params: {
    ratio: '9:16',                  // 画幅默认选择：9:16
    image_ratio: '9:16',
    video_ratio: '9:16',
    video_resolution: '720p',        // 清晰度默认选择：720p（视频）
    image_size: '2K',                // 清晰度默认选择：1.5k 或以上（图片默认 2K）
    video_duration: 5
  }
};

const KV_KEY = 'studio_default_settings';

function getStudioDefaultSettings(db) {
  if (!db) return { ...DEFAULT_STUDIO_SETTINGS };
  try {
    const row = db.prepare('SELECT value FROM kv WHERE key=?').get(KV_KEY);
    if (row && row.value) {
      const parsed = JSON.parse(row.value);
      return {
        models: { ...DEFAULT_STUDIO_SETTINGS.models, ...(parsed.models || {}) },
        params: { ...DEFAULT_STUDIO_SETTINGS.params, ...(parsed.params || {}) },
        perModel: { ...DEFAULT_STUDIO_SETTINGS.perModel, ...(parsed.perModel || {}) }
      };
    }
  } catch (e) {
    console.warn('[studio-defaults] 读取默认配置异常:', e.message);
  }
  return { ...DEFAULT_STUDIO_SETTINGS };
}

function updateStudioDefaultSettings(db, newSettings) {
  if (!db) throw new Error('数据库实例未就绪');
  const current = getStudioDefaultSettings(db);
  const updated = {
    models: { ...current.models, ...(newSettings.models || {}) },
    params: { ...current.params, ...(newSettings.params || {}) },
    perModel: { ...(current.perModel || {}), ...(newSettings.perModel || {}) },
    updated_at: Date.now()
  };
  db.prepare(`
    INSERT INTO kv (key, value) VALUES (?, ?)
    ON CONFLICT(key) DO UPDATE SET value=excluded.value
  `).run(KV_KEY, JSON.stringify(updated));

  // 同步更新 model_contracts 表中的参数默认值，确保契约库与默认配置严格统一
  try {
    if (updated.params?.video_resolution) {
      const vRes = updated.params.video_resolution;
      const vModels = db.prepare("SELECT id, params_json FROM model_contracts WHERE id LIKE '%seedance%' OR capability_id='ark_video'").all();
      const updStmt = db.prepare("UPDATE model_contracts SET params_json=?, updated_at=? WHERE id=?");
      for (const m of vModels) {
        if (!m.params_json) continue;
        let pList = [];
        try { pList = JSON.parse(m.params_json); } catch { continue; }
        let changed = false;
        for (const p of pList) {
          if (p && p.key === 'resolution' && Array.isArray(p.options) && p.options.includes(vRes)) {
            if (p.default !== vRes) {
              p.default = vRes;
              changed = true;
            }
          }
        }
        if (changed) updStmt.run(JSON.stringify(pList), Date.now(), m.id);
      }
    }
  } catch (err) {
    console.warn('[studio-defaults] 同步 model_contracts 失败:', err.message);
  }

  return updated;
}

module.exports = {
  DEFAULT_STUDIO_SETTINGS,
  getStudioDefaultSettings,
  updateStudioDefaultSettings
};
