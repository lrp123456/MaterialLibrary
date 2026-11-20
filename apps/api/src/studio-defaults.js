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
    video_resolution: '720px2（超分）', // 清晰度默认选择：720p + 超分（官方六档里的权威默认）
    image_size: '2K',                // 清晰度默认选择：1.5k 或以上（图片默认 2K）
    video_duration: 5
  }
};

const KV_KEY = 'studio_default_settings';

// 默认配置版本：2 = 视频清晰度启用官方六档（含 720px2（超分））。
// 老库里存的是旧代码截断后的值（720p / 720p_sr2x），只在 v2 之前做一次性迁移；
// 用户之后在设置页重新选 720p 会随 defaults_version=2 一起存下，不会再被改回去。
const DEFAULTS_VERSION = 2;
const LEGACY_RESOLUTION_MAP = {
  '480p_sr2x': '480px2（超分）',
  '720p_sr2x': '720px2（超分）',
  '1080p_sr2x': '1080px2（超分）',
};

function migrateLegacyParams(parsed) {
  const params = { ...DEFAULT_STUDIO_SETTINGS.params, ...(parsed.params || {}) };
  const raw = String(params.video_resolution || '').trim();
  // *_sr2x 是旧代码内部用的档位名，新契约里只有 720px2（超分）这类标签，任何版本都该纠正
  if (LEGACY_RESOLUTION_MAP[raw]) {
    params.video_resolution = LEGACY_RESOLUTION_MAP[raw];
  } else if (Number(parsed.defaults_version || 0) < DEFAULTS_VERSION && (!raw || raw === '720p')) {
    // 旧默认值就是被截断的 720p，等价于「新默认但丢了超分」，一次性纠正；
    // defaults_version=2 之后用户主动选 720p 会原样保留
    params.video_resolution = DEFAULT_STUDIO_SETTINGS.params.video_resolution;
  }
  return params;
}

function getStudioDefaultSettings(db) {
  if (!db) return { ...DEFAULT_STUDIO_SETTINGS, params: { ...DEFAULT_STUDIO_SETTINGS.params } };
  try {
    const row = db.prepare('SELECT value FROM kv WHERE key=?').get(KV_KEY);
    if (row && row.value) {
      const parsed = JSON.parse(row.value);
      const params = migrateLegacyParams(parsed);
      return {
        models: { ...DEFAULT_STUDIO_SETTINGS.models, ...(parsed.models || {}) },
        params,
        perModel: { ...DEFAULT_STUDIO_SETTINGS.perModel, ...(parsed.perModel || {}) }
      };
    }
  } catch (e) {
    console.warn('[studio-defaults] 读取默认配置异常:', e.message);
  }
  return { ...DEFAULT_STUDIO_SETTINGS, params: { ...DEFAULT_STUDIO_SETTINGS.params } };
}

function updateStudioDefaultSettings(db, newSettings) {
  if (!db) throw new Error('数据库实例未就绪');
  const current = getStudioDefaultSettings(db);
  const updated = {
    models: { ...current.models, ...(newSettings.models || {}) },
    params: { ...current.params, ...(newSettings.params || {}) },
    perModel: { ...(current.perModel || {}), ...(newSettings.perModel || {}) },
    defaults_version: DEFAULTS_VERSION,
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
