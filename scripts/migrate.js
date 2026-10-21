/**
 * 数据库平滑迁移脚本 (SQLite WAL 模式)
 * 具备物理冷备份、幂等列补齐、表重建/升级、存量视频冻结与默认工作流种子功能。
 */
const path = require('path');
const fs = require('fs');
const os = require('os');
const Database = require('better-sqlite3');
const { VALUES, DIMENSIONS, DOMINANT_COLORS } = require('../src/tags-seed');
const { initDefaultUsers } = require('../src/auth');
const { buildDefaultWorkflowGraph, shouldUpgradeDefaultGraph, mergePreservedConfig } = require('../src/nodes/catalog');
const { classifyOrientation } = require('../src/ratio');

function backupDb(dataDir) {
  const dbPath = path.join(dataDir, 'material.db');
  if (!fs.existsSync(dbPath)) return null;

  const ts = Date.now();
  const backupDir = path.join(dataDir, 'backups', String(ts));
  fs.mkdirSync(backupDir, { recursive: true });

  ['material.db', 'material.db-wal', 'material.db-shm'].forEach(f => {
    const src = path.join(dataDir, f);
    if (fs.existsSync(src)) {
      fs.copyFileSync(src, path.join(backupDir, f));
    }
  });
  console.log(`[migrate] 已完成数据库冷备份: ${backupDir}`);
  return backupDir;
}

const DEFAULT_WORKFLOW_GRAPH = buildDefaultWorkflowGraph();

const BUILTIN_ADAPTERS = [
  {
    id: 'openai_images',
    label: 'OpenAI 图像生成 (DALL-E)',
    kind: 'image',
    builtin: 1,
    protocol: 'http_json',
    base_url: 'https://api.openai.com',
    config_json: JSON.stringify({
      path: '/v1/images/generations',
      method: 'POST',
      defaultModel: 'dall-e-3',
      bodyTemplate: {
        prompt: '{{prompt}}',
        model: '{{model}}',
        size: '1024x1792',
        quality: 'standard',
        n: 1
      },
      resultUrlPath: 'data.0.url',
      timeoutMs: 180000
    })
  },
  {
    id: 'litellm_images',
    label: 'LiteLLM 本地生图代理 (已休眠)',
    kind: 'image',
    builtin: 1,
    enabled: 0,
    protocol: 'http_json',
    base_url: 'http://127.0.0.1:4000',
    config_json: JSON.stringify({
      path: '/v1/images/generations',
      method: 'POST',
      defaultModel: 'dall-e-3',
      bodyTemplate: {
        prompt: '{{prompt}}',
        model: '{{model}}',
        size: '1024x1792',
        n: 1
      },
      resultUrlPath: 'data.0.url',
      timeoutMs: 180000
    })
  },
  {
    id: 'ark_seedream',
    label: '火山方舟 Seedream 5.0',
    kind: 'image',
    builtin: 1,
    protocol: 'http_json',
    base_url: 'https://ark.cn-beijing.volces.com/api/v3',
    config_json: JSON.stringify({
      path: '/images/generations',
      method: 'POST',
      // 仅作最后兜底：正常由 governance / 调用方显式传 model。
      // ⚠ 必须写带日期的完整 model code——裸名 'doubao-seedream-5-0-pro' 在 ARK 返回 404 InvalidEndpointOrModel。
      defaultModel: 'doubao-seedream-5-0-flash-260915',
      bodyTemplate: {
        prompt: '{{prompt}}',
        model: '{{model}}',
        image: '{{image_data_url}}',
        size: '{{size}}',
        response_format: 'url'
      },
      resultUrlPath: 'data.0.url',
      timeoutMs: 300000
    })
  },
  {
    id: 'agnes_image',
    label: 'Agnes Image 2.5 Flash',
    kind: 'image',
    builtin: 1,
    protocol: 'http_json',
    base_url: 'https://api.agnes-ai.cn/v1',
    config_json: JSON.stringify({
      path: '/v1/images/generations',
      method: 'POST',
      defaultModel: 'agnes-image-2.5-flash',
      bodyTemplate: {
        prompt: '{{prompt}}',
        model: '{{model}}',
        size: '{{size}}',
        ratio: '{{ratio}}',
        extra_body: {
          response_format: 'url'
        }
      },
      resultUrlPath: 'data.0.url',
      timeoutMs: 180000
    })
  },
  {
    id: 'modelscope_image',
    label: '魔搭 ModelScope 异步图生图 (开源主力)',
    kind: 'image',
    builtin: 1,
    protocol: 'async_http_job',
    base_url: 'https://api-inference.modelscope.cn',
    config_json: JSON.stringify({
      submitPath: '/v1/images/generations',
      submitHeaders: { 'X-ModelScope-Async-Mode': 'true' },
      submitBodyTemplate: { prompt: '{{prompt}}', model: '{{model}}', image: '{{image_data_url}}' },
      taskIdPath: 'task_id',
      pollPathTemplate: '/v1/tasks/{{taskId}}',
      statusPath: 'task_status',
      successValues: ['SUCCEEDED', 'SUCCESS'],
      failValues: ['FAILED'],
      resultUrlPath: 'output_images.0',
      pollIntervalMs: 3000,
      timeoutMs: 300000
    })
  },
  {
    id: 'ark_seedance',
    label: '火山方舟 Seedance 2.5',
    kind: 'video',
    builtin: 1,
    protocol: 'async_http_job',
    base_url: 'https://ark.cn-beijing.volces.com/api/v3',
    config_json: JSON.stringify({
      submitPath: '/contents/generations/tasks',
      submitBodyTemplate: {
        model: '{{model}}',
        content: [
          { type: 'text', text: '{{prompt}}' },
          { type: 'image_url', image_url: { url: '{{image_data_url}}' } }
        ]
      },
      taskIdPath: 'id',
      pollPathTemplate: '/contents/generations/tasks/{{taskId}}',
      statusPath: 'status',
      successValues: ['succeeded'],
      failValues: ['failed'],
      resultUrlPath: 'content.video_url',
      pollIntervalMs: 5000,
      timeoutMs: 720000
    })
  },
  {
    id: 'agnes_video',
    label: 'Agnes Video 2.5 Flash',
    kind: 'video',
    builtin: 1,
    protocol: 'async_http_job',
    base_url: 'https://api.agnes-ai.cn',
    config_json: JSON.stringify({
      submitPath: '/v1/videos',
      submitBodyTemplate: {
        model: 'agnes-video-2.5-flash',
        prompt: '{{prompt}}',
        seconds: '{{duration}}',
        mode: 'reference',
        size: '720P',
        aspect_ratio: '{{ratio}}',
        images: ['{{image_data_url}}']
      },
      taskIdPath: 'video_id',
      pollPathTemplate: '/agnesapi?video_id={{taskId}}&model_name={{model}}',
      statusPath: 'status',
      successValues: ['completed', 'succeeded'],
      failValues: ['failed'],
      resultUrlPath: 'metadata.url',
      pollIntervalMs: 3000,
      timeoutMs: 720000
    })
  },
  {
    id: 'modelscope_video',
    label: '魔搭 ModelScope 视频生成',
    kind: 'video',
    builtin: 1,
    protocol: 'async_http_job',
    base_url: 'https://api-inference.modelscope.cn',
    config_json: JSON.stringify({
      submitPath: '/v1/video/generations',
      submitBodyTemplate: { prompt: '{{prompt}}', image: '{{image_data_url}}' },
      taskIdPath: 'task_id',
      pollPathTemplate: '/v1/tasks/{{taskId}}',
      statusPath: 'task_status',
      successValues: ['SUCCEEDED'],
      failValues: ['FAILED'],
      resultUrlPath: 'output_video',
      pollIntervalMs: 5000,
      timeoutMs: 720000
    })
  },
  {
    id: 'gemini_image',
    label: 'Google Nano Banana 生图',
    kind: 'image',
    builtin: 1,
    enabled: 0,
    protocol: 'gemini_interactions',
    base_url: 'https://generativelanguage.googleapis.com',
    config_json: JSON.stringify({
      path: '/v1beta/interactions',
      defaultModel: 'gemini-3.1-flash-image',
      timeoutMs: 180000,
      pollIntervalMs: 3000,
      responseType: 'image'
    })
  },
  {
    id: 'gemini_video',
    label: 'Google Gemini Omni 视频',
    kind: 'video',
    builtin: 1,
    enabled: 0,
    protocol: 'gemini_interactions',
    base_url: 'https://generativelanguage.googleapis.com',
    config_json: JSON.stringify({
      path: '/v1beta/interactions',
      defaultModel: 'gemini-omni-1.1-flash',
      timeoutMs: 480000,
      pollIntervalMs: 4000,
      responseType: 'video'
    })
  },
  {
    id: 'gemini_veo',
    label: 'Google Veo 3.1 视频',
    kind: 'video',
    builtin: 1,
    enabled: 0,
    protocol: 'gemini_veo',
    base_url: 'https://generativelanguage.googleapis.com',
    config_json: JSON.stringify({
      defaultModel: 'veo-3.1-generate-preview',
      timeoutMs: 480000,
      pollIntervalMs: 5000
    })
  },
  {
    id: 'gemini_lyria',
    label: 'Google Lyria 音乐',
    kind: 'music',
    builtin: 1,
    enabled: 0,
    protocol: 'gemini_lyria',
    base_url: 'https://generativelanguage.googleapis.com',
    config_json: JSON.stringify({
      path: '/v1beta/interactions',
      defaultModel: 'lyria-3.5',
      timeoutMs: 240000,
      pollIntervalMs: 4000,
      responseType: 'audio'
    })
  },
  {
    id: 'openai_videos',
    label: 'OpenAI 兼容视频网关',
    kind: 'video',
    builtin: 1,
    protocol: 'async_http_job',
    base_url: 'http://127.0.0.1:4000',
    config_json: JSON.stringify({
      submitPath: '/v1/videos',
      submitBodyTemplate: { prompt: '{{prompt}}', image: '{{image_data_url}}' },
      taskIdPath: 'id',
      pollPathTemplate: '/v1/videos/{{taskId}}',
      statusPath: 'status',
      successValues: ['succeeded'],
      failValues: ['failed'],
      resultUrlPath: 'video_url',
      pollIntervalMs: 5000,
      timeoutMs: 720000
    })
  },
  {
    id: 'unified_gateway',
    label: '统一处理网关（扩图/画幅/去水印/超分/视频）',
    kind: 'image',
    builtin: 1,
    enabled: 1,
    protocol: 'unified_gateway',
    base_url: 'http://127.0.0.1:8798',
    config_json: JSON.stringify({
      submitPath: '/',
      pollPath: '/',
      taskIdPath: 'request_id',
      statusPath: 'status',
      resultUrlPath: 'result.url',
      pollIntervalMs: 2000,
      timeoutMs: 300000
    })
  }
];

function migrate(dataDir, { doBackup = true } = {}) {
  fs.mkdirSync(dataDir, { recursive: true });
  fs.mkdirSync(path.join(dataDir, 'cache', 'thumbs'), { recursive: true });
  fs.mkdirSync(path.join(dataDir, 'cache', 'derivatives'), { recursive: true });
  fs.mkdirSync(path.join(dataDir, 'cache', 'originals'), { recursive: true });
  fs.mkdirSync(path.join(dataDir, 'cache', 'preview'), { recursive: true });

  if (doBackup) backupDb(dataDir);

  const dbPath = path.join(dataDir, 'material.db');
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  const tx = db.transaction(() => {
    // 1. 检查并创建基本表结构
    db.exec(`
      CREATE TABLE IF NOT EXISTS assets (
        fid TEXT PRIMARY KEY,
        kind TEXT NOT NULL DEFAULT 'image',
        parent_fid TEXT,
        file_name TEXT,
        size INTEGER,
        width INTEGER,
        height INTEGER,
        orientation TEXT,
        duration_s REAL,
        status TEXT NOT NULL DEFAULT 'discovered',
        phash TEXT,
        dup_group_id TEXT,
        is_representative INTEGER NOT NULL DEFAULT 0,
        has_watermark INTEGER NOT NULL DEFAULT 0,
        watermark_note TEXT,
        quality TEXT,
        thumb_url TEXT,
        thumb_fetched_at INTEGER,
        in_managed_zone INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER,
        discovered_at INTEGER,
        updated_at INTEGER
      );
    `);

    // 2. assets 动态补列
    const assetCols = db.prepare("PRAGMA table_info(assets)").all().map(c => c.name);
    if (!assetCols.includes('main_derivative_id')) {
      db.exec("ALTER TABLE assets ADD COLUMN main_derivative_id INTEGER;");
    }
    if (!assetCols.includes('ready_flags')) {
      db.exec("ALTER TABLE assets ADD COLUMN ready_flags TEXT;");
    }
    if (!assetCols.includes('error_note')) {
      db.exec("ALTER TABLE assets ADD COLUMN error_note TEXT;");
    }
    if (!assetCols.includes('origin_orientation')) {
      db.exec("ALTER TABLE assets ADD COLUMN origin_orientation TEXT;");
    }
    if (!assetCols.includes('source')) {
      db.exec("ALTER TABLE assets ADD COLUMN source TEXT DEFAULT 'quark';");
    }
    if (!assetCols.includes('sha256')) {
      db.exec("ALTER TABLE assets ADD COLUMN sha256 TEXT;");
    }
    if (!assetCols.includes('md5')) {
      db.exec("ALTER TABLE assets ADD COLUMN md5 TEXT;");
    }
    if (!assetCols.includes('client_asset_id')) {
      db.exec("ALTER TABLE assets ADD COLUMN client_asset_id TEXT;");
    }
    if (!assetCols.includes('rep_source')) {
      db.exec("ALTER TABLE assets ADD COLUMN rep_source TEXT DEFAULT 'auto';");
    }
    if (!assetCols.includes('prev_status')) {
      db.exec("ALTER TABLE assets ADD COLUMN prev_status TEXT;");
    }
    if (!assetCols.includes('auth_state')) {
      db.exec("ALTER TABLE assets ADD COLUMN auth_state TEXT;");
    }
    if (!assetCols.includes('auth_matched_at')) {
      db.exec("ALTER TABLE assets ADD COLUMN auth_matched_at INTEGER;");
    }
    if (!assetCols.includes('auth_frozen_at')) {
      db.exec("ALTER TABLE assets ADD COLUMN auth_frozen_at INTEGER;");
    }
    if (!assetCols.includes('auth_revoked_at')) {
      db.exec("ALTER TABLE assets ADD COLUMN auth_revoked_at INTEGER;");
    }
    if (!assetCols.includes('category')) {
      db.exec("ALTER TABLE assets ADD COLUMN category TEXT DEFAULT 'interior';");
    }
    db.exec("CREATE INDEX IF NOT EXISTS idx_assets_category ON assets(category);");
    if (!assetCols.includes('dominant_color')) {
      db.exec("ALTER TABLE assets ADD COLUMN dominant_color TEXT;");
    }
    db.exec("CREATE INDEX IF NOT EXISTS idx_assets_dominant_color ON assets(dominant_color);");

    // 3. derivatives 表：检查行数；0 行则重建，>0 行则升级
    const derivTableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='derivatives'").get();
    if (derivTableExists) {
      const derivCount = db.prepare("SELECT COUNT(*) c FROM derivatives").get().c;
      if (derivCount === 0) {
        db.exec("DROP TABLE derivatives;");
        createDerivativesTable(db);
      } else {
        upgradeDerivativesTable(db);
      }
    } else {
      createDerivativesTable(db);
    }

    // 4. 创建其余核心表
    db.exec(`
      CREATE TABLE IF NOT EXISTS dup_groups (
        id TEXT PRIMARY KEY,
        representative_fid TEXT NOT NULL,
        member_count INTEGER DEFAULT 1,
        match_reason TEXT,
        updated_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS tag_dict (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        dimension TEXT NOT NULL,
        dir TEXT NOT NULL,
        label TEXT NOT NULL,
        parent_id INTEGER,
        aliases TEXT,
        criteria TEXT,
        deprecated INTEGER NOT NULL DEFAULT 0,
        is_fallback INTEGER NOT NULL DEFAULT 0,
        updated_at INTEGER,
        UNIQUE(dimension, dir)
      );

      CREATE TABLE IF NOT EXISTS asset_tags (
        asset_fid TEXT NOT NULL,
        tag_id INTEGER NOT NULL,
        role TEXT,
        source TEXT NOT NULL DEFAULT 'ai',
        confidence REAL,
        updated_at INTEGER,
        PRIMARY KEY (asset_fid, tag_id, role)
      );
      CREATE INDEX IF NOT EXISTS idx_at_tag ON asset_tags(tag_id);
      CREATE INDEX IF NOT EXISTS idx_at_asset ON asset_tags(asset_fid);

      CREATE TABLE IF NOT EXISTS asset_colors (
        asset_fid TEXT NOT NULL,
        hex TEXT NOT NULL,
        role TEXT NOT NULL,
        weight REAL,
        name TEXT,
        basic_color TEXT,
        PRIMARY KEY (asset_fid, role)
      );

      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        username TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        salt TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'viewer',
        is_locked INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER,
        updated_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS sessions (
        token TEXT PRIMARY KEY,
        user_id INTEGER NOT NULL,
        role TEXT NOT NULL,
        expires_at INTEGER
      );

      -- 企业级 AI 创作会话与消息流持久化
      CREATE TABLE IF NOT EXISTS chat_sessions (
        id TEXT PRIMARY KEY,
        user_id INTEGER,
        title TEXT,
        created_at INTEGER,
        updated_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_chat_sessions_user ON chat_sessions(user_id, updated_at DESC);

      CREATE TABLE IF NOT EXISTS chat_messages (
        id TEXT PRIMARY KEY,
        session_id TEXT NOT NULL,
        user_id INTEGER,
        role TEXT NOT NULL DEFAULT 'user',
        mode TEXT NOT NULL DEFAULT 'text_to_image',
        prompt TEXT,
        params_json TEXT,
        images_json TEXT,
        status TEXT NOT NULL DEFAULT 'done',
        run_id TEXT,
        engine TEXT,
        result_json TEXT,
        created_at INTEGER,
        updated_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_chat_msg_session ON chat_messages(session_id, created_at ASC);

      CREATE TABLE IF NOT EXISTS asset_vectors (
        asset_fid TEXT PRIMARY KEY,
        embedding BLOB NOT NULL,
        dimensions INTEGER NOT NULL,
        model TEXT,
        created_at INTEGER
      );

      -- 相册快照直收（取代外部 AlbumSync 接收器）：设备清单 + live/frozen 两态
      CREATE TABLE IF NOT EXISTS snapshot_devices (
        device_id TEXT PRIMARY KEY,
        label TEXT,
        app_version TEXT,
        window_days INTEGER NOT NULL DEFAULT 3,
        total_count INTEGER DEFAULT 0,
        first_seen_at INTEGER,
        last_push_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS snapshot_items (
        device_id TEXT NOT NULL,
        item_key TEXT NOT NULL,
        name TEXT NOT NULL,
        size INTEGER,
        modified INTEGER,
        fingerprint TEXT,
        state TEXT NOT NULL DEFAULT 'live',
        first_seen_at INTEGER,
        last_seen_at INTEGER,
        frozen_at INTEGER,
        PRIMARY KEY (device_id, item_key)
      );

      CREATE TABLE IF NOT EXISTS sync_events (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        device_id TEXT,
        event_type TEXT NOT NULL,
        media_kind TEXT NOT NULL DEFAULT 'image',
        name TEXT,
        size INTEGER,
        item_key TEXT,
        at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_sync_events_at ON sync_events(at DESC);
      CREATE INDEX IF NOT EXISTS idx_sync_events_type ON sync_events(event_type, at DESC);
      CREATE INDEX IF NOT EXISTS idx_snap_items_state ON snapshot_items(state);

      -- 同哈希多副本别名映射表（终结去重后快照对账循环上传）
      CREATE TABLE IF NOT EXISTS asset_aliases (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        fid TEXT NOT NULL,
        item_key TEXT NOT NULL,
        client_asset_id TEXT,
        file_name TEXT,
        size INTEGER,
        created_at INTEGER,
        UNIQUE(fid, item_key)
      );
      CREATE INDEX IF NOT EXISTS idx_asset_aliases_key ON asset_aliases(item_key);
      CREATE INDEX IF NOT EXISTS idx_asset_aliases_cid ON asset_aliases(client_asset_id);
      CREATE INDEX IF NOT EXISTS idx_asset_aliases_fid ON asset_aliases(fid);

      CREATE TABLE IF NOT EXISTS workflows (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        version INTEGER NOT NULL DEFAULT 1,
        is_default INTEGER NOT NULL DEFAULT 1,
        graph_json TEXT NOT NULL,
        created_at INTEGER,
        updated_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS node_templates (
        id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        category TEXT,
        form_schema_json TEXT,
        default_config_json TEXT
      );

      CREATE TABLE IF NOT EXISTS runs (
        id TEXT PRIMARY KEY,
        workflow_id TEXT NOT NULL,
        workflow_version INTEGER NOT NULL,
        trigger TEXT,
        status TEXT NOT NULL DEFAULT 'queued',
        asset_count INTEGER DEFAULT 0,
        success_count INTEGER DEFAULT 0,
        failed_count INTEGER DEFAULT 0,
        error TEXT,
        created_at INTEGER,
        started_at INTEGER,
        finished_at INTEGER,
        updated_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS node_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        run_id TEXT NOT NULL,
        workflow_version INTEGER NOT NULL,
        node_id TEXT NOT NULL,
        node_type TEXT NOT NULL,
        asset_fid TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'queued',
        error TEXT,
        input_summary TEXT,
        output_summary TEXT,
        derivative_id INTEGER,
        duration_ms INTEGER,
        created_at INTEGER,
        updated_at INTEGER,
        UNIQUE(workflow_version, node_id, asset_fid)
      );

      CREATE TABLE IF NOT EXISTS gen_adapters (
        id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        kind TEXT NOT NULL,
        builtin INTEGER NOT NULL DEFAULT 0,
        protocol TEXT NOT NULL,
        base_url TEXT,
        secrets_json TEXT,
        config_json TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at INTEGER,
        updated_at INTEGER
      );

      CREATE TABLE IF NOT EXISTS kv (
        key TEXT PRIMARY KEY,
        value TEXT
      );

      CREATE TABLE IF NOT EXISTS presets (
        id TEXT PRIMARY KEY,
        label TEXT NOT NULL,
        action TEXT NOT NULL,
        params_json TEXT NOT NULL DEFAULT '{}',
        builtin INTEGER NOT NULL DEFAULT 1,
        enabled INTEGER NOT NULL DEFAULT 1,
        sort INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER,
        updated_at INTEGER
      );

      -- 企业级 AI 创作库 (收藏提示词、原图、目标图、复用配方)
      CREATE TABLE IF NOT EXISTS creation_templates (
        id TEXT PRIMARY KEY,
        user_id INTEGER DEFAULT 1,
        title TEXT NOT NULL,
        prompt TEXT NOT NULL,
        aspect_ratio TEXT DEFAULT '16:9',
        origin_images TEXT DEFAULT '[]',
        result_images TEXT DEFAULT '[]',
        params_json TEXT DEFAULT '{}',
        tags TEXT DEFAULT '[]',
        created_at INTEGER,
        updated_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS idx_creation_tpl_user ON creation_templates(user_id, updated_at DESC);
    `);

    // 5. 存量视频冻结（P2 已移除：视频改为分批解冻进管线）
    const jobsTableExists = db.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='jobs'").get();
    if (jobsTableExists) {
      db.exec(`
        UPDATE jobs SET status='cancelled', error='v1 不处理网盘视频'
        WHERE type IN ('gate_video','clean_video') AND status IN ('queued','running');
      `);
    }

    try { db.exec('ALTER TABLE asset_colors ADD COLUMN basic_color TEXT;'); } catch (e) {}
    try { db.exec("CREATE INDEX IF NOT EXISTS idx_ac_basic ON asset_colors(basic_color);"); } catch (e) {}
    try { db.exec('ALTER TABLE runs ADD COLUMN updated_at INTEGER;'); } catch (e) {}
    try { db.exec('ALTER TABLE node_runs ADD COLUMN not_before INTEGER;'); } catch (e) {}
    try { db.exec('ALTER TABLE node_runs ADD COLUMN progress REAL;'); } catch (e) {}
    // 6. 治理列/表 + 标签字典种子
    try {
      const tagGov = require('../src/tag-governance');
      tagGov.ensureGovernanceSchema(db);
    } catch (e) {
      console.warn('[migrate] tag-governance schema skip:', e.message);
    }
    try {
      const genGov = require('../src/gen-governance');
      genGov.ensureGenGovernanceSchema(db);
    } catch (e) {
      console.warn('[migrate] gen-governance schema skip:', e.message);
    }
    try {
      const { ensureTables } = require('../src/assets-delete');
      ensureTables(db);
    } catch (e) {
      console.warn('[migrate] assets-delete ensureTables skip:', e.message);
    }
    seedTags(db);

    try { db.exec('ALTER TABLE dup_groups ADD COLUMN match_reason TEXT;'); } catch (e) {}
    try { db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_assets_sha256 ON assets(sha256) WHERE sha256 IS NOT NULL;'); } catch (e) {}
    try { db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_assets_client_id ON assets(client_asset_id) WHERE client_asset_id IS NOT NULL;'); } catch (e) {}
    try { db.exec('CREATE INDEX IF NOT EXISTS idx_assets_auth ON assets(auth_state)'); } catch (e) {}

    // 9. AI 任务表 + assets AI 产物列（BFF 对接 KX2BFK）
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS ai_tasks (
          task_id TEXT PRIMARY KEY,
          fid TEXT NOT NULL,
          type TEXT NOT NULL,
          title TEXT,
          status TEXT NOT NULL DEFAULT 'pending',
          progress INTEGER NOT NULL DEFAULT 0,
          source_asset_id TEXT,
          source_fids_json TEXT,
          payload_json TEXT,
          engine_run_id TEXT,
          template_id TEXT,
          output_fid TEXT,
          output_kind TEXT,
          error TEXT,
          created_by TEXT,
          created_at INTEGER,
          updated_at INTEGER,
          completed_at INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_ai_tasks_fid ON ai_tasks(fid);
        CREATE INDEX IF NOT EXISTS idx_ai_tasks_status ON ai_tasks(status);
        CREATE INDEX IF NOT EXISTS idx_ai_tasks_created ON ai_tasks(created_at);
      `);
    } catch (e) {}
    try { db.exec('ALTER TABLE assets ADD COLUMN is_ai INTEGER NOT NULL DEFAULT 0;'); } catch (e) {}
    try { db.exec('ALTER TABLE assets ADD COLUMN source_asset_id TEXT;'); } catch (e) {}
    try { db.exec('ALTER TABLE assets ADD COLUMN poster_path TEXT;'); } catch (e) {}
    try { db.exec('CREATE INDEX IF NOT EXISTS idx_assets_is_ai ON assets(is_ai);'); } catch (e) {}
    try { db.exec('CREATE INDEX IF NOT EXISTS idx_assets_source_asset ON assets(source_asset_id);'); } catch (e) {}
    try { db.exec("CREATE INDEX IF NOT EXISTS idx_assets_kind_is_ai ON assets(kind, is_ai);"); } catch (e) {}

    // 10. 3D 软装模型预置表 (product_presets)
    try {
      db.exec(`
        CREATE TABLE IF NOT EXISTS product_presets (
          id TEXT PRIMARY KEY,
          name TEXT NOT NULL,
          category TEXT NOT NULL,
          facing REAL NOT NULL DEFAULT 180,
          preview_file TEXT,
          model_file TEXT,
          tags_json TEXT,
          dimensions_json TEXT,
          sort INTEGER DEFAULT 0,
          enabled INTEGER DEFAULT 1,
          created_at INTEGER,
          updated_at INTEGER
        );
        CREATE INDEX IF NOT EXISTS idx_product_presets_cat ON product_presets(category);
        CREATE INDEX IF NOT EXISTS idx_product_presets_sort ON product_presets(sort);
      `);

      const count = db.prepare('SELECT COUNT(*) as c FROM product_presets').get().c;
      if (count === 0) {
        const insPreset = db.prepare(`
          INSERT INTO product_presets (id, name, category, facing, preview_file, model_file, tags_json, dimensions_json, sort, enabled, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);
        const now = Date.now();
        insPreset.run(
          'sofa_electric_single',
          '极简单人电动真皮沙发',
          'furniture',
          180,
          'sofa_single.png',
          'sofa_default.glb',
          JSON.stringify(['单人位', '电动展开', '意大利头层牛皮', '极简奶油风']),
          JSON.stringify({ width: 950, depth: 1050, height: 920 }),
          10,
          1,
          now,
          now
        );
        insPreset.run(
          'chair_nordic_lounge',
          '意式轻奢休闲单椅',
          'chair',
          0,
          'chair_01.png',
          'sofa_default.glb',
          JSON.stringify(['单椅', '千鸟格', '黑胡桃木', '实木框架']),
          JSON.stringify({ width: 780, depth: 820, height: 760 }),
          20,
          1,
          now,
          now
        );
        insPreset.run(
          'table_stone_coffee',
          '极简悬浮岩板茶几',
          'table',
          90,
          'table_01.png',
          'sofa_default.glb',
          JSON.stringify(['茶几', '劳伦黑金岩板', '悬浮设计']),
          JSON.stringify({ width: 1200, depth: 600, height: 420 }),
          30,
          1,
          now,
          now
        );
        console.log('[migrate] product_presets 软装模型预设已种子化 (3款模型)');
      }
    } catch (e) {
      console.warn('[migrate] product_presets 表迁移警告:', e.message);
    }

    // 7. 按真值分桶重算 origin_orientation（纠正手机 19.5:9 被标成 9:16）
    const orientRows = db.prepare('SELECT fid, width, height FROM assets WHERE width > 0 AND height > 0').all();
    const updOrient = db.prepare('UPDATE assets SET origin_orientation = ? WHERE fid = ?');
    for (const r of orientRows) {
      updOrient.run(classifyOrientation(r.width, r.height).bucket, r.fid);
    }

    // 7.1 回填校准资产唯一视觉主颜色
    backfillDominantColors(db, dataDir);

    // 8. 为所有现有资产建立 origin derivative，并设置 main_derivative_id
    const assetsWithoutOrigin = db.prepare(`
      SELECT a.fid, a.file_name, a.width, a.height, a.discovered_at, a.created_at, a.main_derivative_id
      FROM assets a
      LEFT JOIN derivatives d ON d.asset_fid = a.fid AND d.kind = 'origin'
      WHERE d.id IS NULL
    `).all();

    const insDeriv = db.prepare(`
      INSERT INTO derivatives (asset_fid, kind, storage_type, storage_ref, file_name, width, height, created_at)
      VALUES (?, 'origin', 'quark', ?, ?, ?, ?, ?)
    `);
    const updateMain = db.prepare(`
      UPDATE assets SET main_derivative_id = ? WHERE fid = ? AND main_derivative_id IS NULL
    `);

    for (const a of assetsWithoutOrigin) {
      const now = a.discovered_at || a.created_at || Date.now();
      const r = insDeriv.run(a.fid, a.fid, a.file_name, a.width || null, a.height || null, now);
      updateMain.run(r.lastInsertRowid, a.fid);
    }

    // 9. 种子默认工作流 v1
    // 9. 种子与平滑升级默认工作流
    const defWorkflow = db.prepare("SELECT id, version, graph_json FROM workflows WHERE id='default'").get();
    const now = Date.now();
    if (!defWorkflow) {
      db.prepare(`
        INSERT INTO workflows (id, name, version, is_default, graph_json, created_at, updated_at)
        VALUES ('default', '默认室内设计素材产线', 1, 1, ?, ?, ?)
      `).run(JSON.stringify(DEFAULT_WORKFLOW_GRAPH), now, now);
      console.log('[migrate] 默认工作流 v1 已种子化');
    } else {
      try {
        const curGraph = JSON.parse(defWorkflow.graph_json);
        if (shouldUpgradeDefaultGraph(curGraph)) {
          const nextVer = (defWorkflow.version || 1) + 1;
          const merged = mergePreservedConfig(curGraph, JSON.parse(JSON.stringify(DEFAULT_WORKFLOW_GRAPH)));
          db.prepare(`
            UPDATE workflows
            SET version = ?, graph_json = ?, updated_at = ?
            WHERE id = 'default'
          `).run(nextVer, JSON.stringify(merged), now);
          console.log(`[migrate] 默认工作流已平滑升级为细粒度可观测流水线 (v${nextVer})`);
        }
      } catch (err) {
        console.warn('[migrate] 工作流检查跳过:', err.message);
      }
    }

    const videoWorkflow = db.prepare("SELECT id FROM workflows WHERE id='video'").get();
    if (!videoWorkflow) {
      db.prepare(`
        INSERT INTO workflows (id, name, version, is_default, graph_json, created_at, updated_at)
        VALUES ('video', '视频工作流', 1, 0, '{"nodes":[],"edges":[]}', ?, ?)
      `).run(now, now);
      console.log('[migrate] 视频空工作流 v1 已种子化');
    }

    // 10. 种子内置生成适配器。钥匙只在 .env，适配器表里不放钥匙。
    const insAdapter = db.prepare(`
      INSERT INTO gen_adapters (id, label, kind, builtin, protocol, base_url, secrets_json, config_json, enabled, created_at, updated_at)
      VALUES (@id, @label, @kind, @builtin, @protocol, @base_url, @secrets_json, @config_json, COALESCE(@enabled, 1), @now, @now)
      ON CONFLICT(id) DO UPDATE SET
        label=excluded.label, kind=excluded.kind, builtin=excluded.builtin,
        protocol=excluded.protocol, base_url=excluded.base_url,
        secrets_json='{}',
        config_json=excluded.config_json,
        enabled=COALESCE(excluded.enabled, gen_adapters.enabled),
        updated_at=excluded.updated_at
    `);
    for (const adp of BUILTIN_ADAPTERS) {
      insAdapter.run({ enabled: 1, ...adp, secrets_json: '{}', now });
    }
    // 强制关闭已停用的 Gemini 适配器（幂等安全）
    db.prepare("UPDATE gen_adapters SET enabled=0 WHERE id IN ('gemini_image', 'gemini_video', 'gemini_veo', 'gemini_lyria') AND enabled != 0").run();


    // 11. 初始化大模型与供应商解耦表
    const { initProvidersTables } = require('../src/providers');
    initProvidersTables(db);

    // 12. 确保 users 表结构并初始化默认与锁定账号
    try {
      const userCols = db.pragma('table_info(users)').map(c => c.name);
      if (!userCols.includes('is_locked')) {
        db.prepare('ALTER TABLE users ADD COLUMN is_locked INTEGER NOT NULL DEFAULT 0').run();
      }
    } catch (e) {
      // ignore
    }
    initDefaultUsers(db, dataDir);

    // 12b. 种子内置快捷处理预设
    const builtinPresets = [
      { id: 'outpaint_square', label: '智能扩图 1:1', action: 'outpaint', params: { ratio: '1:1', extend_side: 'all' }, sort: 10 },
      { id: 'outpaint_16_9', label: '扩图 16:9', action: 'outpaint', params: { ratio: '16:9', extend_side: 'all' }, sort: 20 },
      { id: 'ratio_9_16', label: '画幅转 9:16', action: 'ratio_convert', params: { target: '9:16' }, sort: 30 },
      { id: 'ratio_3_4', label: '画幅转 3:4', action: 'ratio_convert', params: { target: '3:4' }, sort: 40 },
      { id: 'watermark_remove', label: '去水印', action: 'watermark_remove', params: {}, sort: 50 },
      { id: 'upscale_2x', label: '高清放大 2x', action: 'upscale', params: { scale: 2 }, sort: 60 },
      { id: 'upscale_4x', label: '高清放大 4x', action: 'upscale', params: { scale: 4 }, sort: 70 },
      { id: 'video_transcode_h265', label: '视频转码 H.265', action: 'video_transcode', params: { codec: 'h265', crf: 28 }, sort: 80 },
      { id: 'video_poster', label: '视频抽帧封面', action: 'video_frames', params: { count: 3, positions: [25, 50, 75] }, sort: 90 },
      { id: 'ai_video_generate', label: 'AI 图生视频', action: 'video_generate', params: { duration: 5, aspect: '16:9' }, sort: 100 }
    ];
    const insPreset = db.prepare(`
      INSERT INTO presets (id, label, action, params_json, builtin, enabled, sort, created_at, updated_at)
      VALUES (?, ?, ?, ?, 1, 1, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        label=excluded.label, action=excluded.action,
        params_json=excluded.params_json, sort=excluded.sort, updated_at=excluded.updated_at
    `);
    const nowPresets = Date.now();
    for (const p of builtinPresets) {
      insPreset.run(p.id, p.label, p.action, JSON.stringify(p.params), p.sort, nowPresets, nowPresets);
    }
    console.log('[migrate] 内置快捷处理预设已种子化');

    // 12b. 视频抽帧拆组：轻量一次性，不依赖全量查重对齐。
    try {
      ungroupVideoExtractsIfNeeded(db);
    } catch (e) {
      console.warn('[migrate] 视频抽帧拆组跳过:', e.message);
    }

    // 12c. 相册撤销救回：revoked / frozen_revoked 且未软删 → live
    try {
      restoreRevokedAssetsIfNeeded(db);
    } catch (e) {
      console.warn('[migrate] 撤销救回跳过:', e.message);
    }

    // 12d. 室内打标重建：清空室内图旧标签（保留色板与画幅质检）
    try {
      wipeIndoorTagsIfNeeded(db);
    } catch (e) {
      console.warn('[migrate] 室内清标跳过:', e.message);
    }

    // 13. 查重组对齐：默认跳过全量重算（大库会阻塞启动数分钟）。
    // 需要强制对齐时设环境变量 ML_FORCE_ALIGN=1。
    try {
      if (process.env.ML_FORCE_ALIGN === '1') {
        alignDupGroupsAndVectors(db);
        db.prepare("INSERT OR REPLACE INTO kv(key,value) VALUES('last_align_groups',?)")
          .run(JSON.stringify({ at: Date.now() }));
        console.log('[migrate] 已强制全量对齐查重组');
      } else {
        console.log('[migrate] 跳过全量查重组对齐（可用 ML_FORCE_ALIGN=1 强制）');
      }
    } catch (e) {
      console.warn('[migrate] 对齐跳过:', e.message);
    }

    try {
      const { resetUnqualifiedMains, patchSkipIfAlreadyExact } = require('../src/restage');
      patchSkipIfAlreadyExact(db);
      const n = resetUnqualifiedMains(db);
      if (n) console.log(`[migrate] 已把 ${n} 条 3:4/不合格 restage 主图改回 origin 或合格 9:16`);
    } catch (e) {
      console.warn('[migrate] 主图纠正跳过:', e.message);
    }
  });

  tx();
  backfillAssetAliasesAndCleanup(db, dataDir);
  console.log('[migrate] 数据库迁移升级完成');
  return db;
}

function backfillAssetAliasesAndCleanup(db, dataDir) {
  // 1. 安全清理 temp_upload 中超过 30 分钟的孤立临时上传文件
  try {
    const tempDir = path.join(dataDir, 'cache', 'temp_upload');
    if (fs.existsSync(tempDir)) {
      const files = fs.readdirSync(tempDir);
      const now = Date.now();
      let cleaned = 0;
      for (const f of files) {
        if (!f.startsWith('tmp_')) continue;
        const fp = path.join(tempDir, f);
        try {
          const stat = fs.statSync(fp);
          if (now - stat.mtimeMs > 30 * 60 * 1000) {
            fs.unlinkSync(fp);
            cleaned++;
          }
        } catch (_) {}
      }
      if (cleaned > 0) {
        console.log(`[migrate] 已清理 cache/temp_upload 孤立临时文件 ${cleaned} 个`);
      }
    }
  } catch (e) {
    console.warn('[migrate] 清理临时文件跳过:', e.message);
  }

  // 2. 将 assets 表中的主记录确保写入 asset_aliases
  try {
    const insAlias = db.prepare(`
      INSERT OR IGNORE INTO asset_aliases (fid, item_key, client_asset_id, file_name, size, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    const allAssets = db.prepare("SELECT fid, file_name, size, client_asset_id, created_at FROM assets").all();
    const now = Date.now();
    for (const a of allAssets) {
      if (a.file_name) {
        const key = `${a.file_name}|${Number(a.size) || 0}`;
        insAlias.run(a.fid, key, a.client_asset_id || null, a.file_name, Number(a.size) || 0, a.created_at || now);
      }
    }

    // 3. 针对 snapshot_items 中存在但在 assets 中未命中的副本条目，进行基于尺寸与同源特征的存量回填
    const knownKeys = new Set(
      db.prepare("SELECT item_key FROM asset_aliases").all().map(r => r.item_key)
    );
    const knownCids = new Set(
      db.prepare("SELECT client_asset_id FROM asset_aliases WHERE client_asset_id IS NOT NULL AND client_asset_id != ''").all().map(r => r.client_asset_id)
    );

    const unmappedItems = db.prepare(`
      SELECT DISTINCT name, size, fingerprint
      FROM snapshot_items
    `).all().filter(it => {
      const k = `${it.name}|${Number(it.size) || 0}`;
      const cid = it.fingerprint ? it.fingerprint.split('_')[0] : '';
      return !knownKeys.has(k) && (!cid || !knownCids.has(cid));
    });

    if (unmappedItems.length > 0) {
      let backfilled = 0;
      for (const item of unmappedItems) {
        const itemSize = Number(item.size) || 0;
        if (!itemSize) continue;
        const cid = item.fingerprint ? item.fingerprint.split('_')[0] : '';
        const ext = path.extname(item.name || '').toLowerCase();
        
        // 查找相同尺寸且扩展名一致的资产
        const candidates = db.prepare(`
          SELECT fid, file_name, size, client_asset_id
          FROM assets
          WHERE size = ?
        `).all(itemSize).filter(c => path.extname(c.file_name || '').toLowerCase() === ext);

        if (candidates.length === 1) {
          const matched = candidates[0];
          const k = `${item.name}|${itemSize}`;
          insAlias.run(matched.fid, k, cid || null, item.name, itemSize, now);
          knownKeys.add(k);
          if (cid) knownCids.add(cid);
          backfilled++;
        }
      }
      if (backfilled > 0) {
        console.log(`[migrate] 已自动回填存量快照副本别名 ${backfilled} 条`);
      }
    }
  } catch (e) {
    console.warn('[migrate] 存量别名回填跳过:', e.message);
  }
}

function createDerivativesTable(db) {
  db.exec(`
    CREATE TABLE derivatives (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      asset_fid TEXT NOT NULL,
      kind TEXT NOT NULL,
      storage_type TEXT NOT NULL DEFAULT 'local_cache',
      storage_ref TEXT NOT NULL,
      file_name TEXT,
      width INTEGER,
      height INTEGER,
      mime TEXT,
      duration_s REAL,
      params TEXT,
      md5 TEXT,
      sha256 TEXT,
      phash TEXT,
      created_at INTEGER
    );
    CREATE INDEX IF NOT EXISTS idx_deriv_asset ON derivatives(asset_fid);
  `);
}

function upgradeDerivativesTable(db) {
  const cols = db.prepare("PRAGMA table_info(derivatives)").all().map(c => c.name);
  if (!cols.includes('storage_type')) db.exec("ALTER TABLE derivatives ADD COLUMN storage_type TEXT NOT NULL DEFAULT 'local_cache';");
  if (!cols.includes('storage_ref')) {
    db.exec("ALTER TABLE derivatives ADD COLUMN storage_ref TEXT;");
    if (cols.includes('fid')) db.exec("UPDATE derivatives SET storage_ref = fid, storage_type = 'quark' WHERE fid IS NOT NULL;");
  }
  if (!cols.includes('mime')) db.exec("ALTER TABLE derivatives ADD COLUMN mime TEXT;");
  if (!cols.includes('duration_s')) db.exec("ALTER TABLE derivatives ADD COLUMN duration_s REAL;");
  if (!cols.includes('width')) db.exec("ALTER TABLE derivatives ADD COLUMN width INTEGER;");
  if (!cols.includes('height')) db.exec("ALTER TABLE derivatives ADD COLUMN height INTEGER;");
  if (!cols.includes('md5')) db.exec("ALTER TABLE derivatives ADD COLUMN md5 TEXT;");
  if (!cols.includes('sha256')) db.exec("ALTER TABLE derivatives ADD COLUMN sha256 TEXT;");
  if (!cols.includes('phash')) db.exec("ALTER TABLE derivatives ADD COLUMN phash TEXT;");
}

function seedTags(db) {
  const cols = db.prepare('PRAGMA table_info(tag_dict)').all().map(c => c.name);
  if (!cols.includes('parent_dir')) {
    db.exec("ALTER TABLE tag_dict ADD COLUMN parent_dir TEXT;");
  }
  const insTag = db.prepare(`
    INSERT INTO tag_dict(dimension, dir, label, aliases, is_fallback, deprecated, parent_dir)
    VALUES(@dimension, @dir, @label, @aliases, @is_fallback, @deprecated, @parent_dir)
    ON CONFLICT(dimension, dir) DO UPDATE SET
      label=excluded.label, aliases=excluded.aliases, deprecated=excluded.deprecated,
      parent_dir=COALESCE(excluded.parent_dir, tag_dict.parent_dir)
  `);

  const deprecatedDims = new Set(DIMENSIONS.filter(d => d.deprecated).map(d => d.dimKey));

  for (const v of VALUES) {
    insTag.run({
      dimension: v.dim,
      dir: v.dir,
      label: v.label,
      aliases: v.aliases ? JSON.stringify(v.aliases) : null,
      is_fallback: v.dir === 'mixed_other' ? 1 : 0,
      deprecated: deprecatedDims.has(v.dim) ? 1 : 0,
      parent_dir: v.parent || null
    });
  }

  db.exec("UPDATE tag_dict SET deprecated=1 WHERE dimension IN ('palette','luxury','era','temperature','functional','quality','color_style','flags','region','tone','view_composition','view_angle','lighting','material_family')");
  db.exec("UPDATE tag_dict SET deprecated=1 WHERE dimension='style_atom' AND dir LIKE '%_new'");
  db.exec("UPDATE tag_dict SET deprecated=1 WHERE dimension='space' AND dir='entryway'");
  // 终审废弃：欧式轻奢/原木日式/日式/北欧/英式/旧扩展/混搭
  db.exec("UPDATE tag_dict SET deprecated=1 WHERE dimension='style_atom' AND dir IN ('european_light_luxury','log_wood','japanese','nordic','british','japandi','french_light_luxury','italian_modern','american','american_farmhouse','mid_century_global','tuscan_country','eclectic_other')");
  // 生效风格：文化流派 + 四种木色 + 其他风格(other)
  db.exec("UPDATE tag_dict SET deprecated=0 WHERE dimension='style_atom' AND dir IN ('wabi_sabi','song_aesthetic','neo_chinese','classical_chinese','french','italian','tuscan','mediterranean','modern_minimal','cream_style','industrial','mid_century','american_modern','american_country','nanyang_resort','natural_wood','dark_wood','natural_vintage_wood','dark_vintage_wood','other')");
  // wood_style 独立维度退役合并入 style_atom
  db.exec("UPDATE tag_dict SET deprecated=1 WHERE dimension='wood_style'");
  db.exec("UPDATE tag_dict SET deprecated=0 WHERE dimension='gender' AND dir IN ('female','male')");
  db.exec("UPDATE tag_dict SET deprecated=1 WHERE dimension='gender' AND dir IN ('child','neutral')");
  db.exec("UPDATE tag_dict SET deprecated=0 WHERE dimension='person_style' AND dir IN ('gentle','dignified','capable','intellectual','sweet','guofeng','cool')");
  db.exec("UPDATE tag_dict SET deprecated=1 WHERE dimension='person_style' AND dir IN ('workplace','casual','casual_home')");
  db.exec("UPDATE tag_dict SET deprecated=0 WHERE dimension='shot_type' AND dir IN ('close_up','half_body','full_body')");
  db.exec("UPDATE tag_dict SET deprecated=0 WHERE dimension='clothing_category' AND dir IN ('top','pants','skirt','coat','suit','shoes_bags')");
  db.exec("UPDATE tag_dict SET deprecated=1 WHERE dimension='clothing_category' AND dir NOT IN ('top','pants','skirt','coat','suit','shoes_bags')");
  db.exec("UPDATE tag_dict SET deprecated=0 WHERE dimension='clothing_style' AND dir IN ('commute','casual','sport','formal','guochao','french','minimal','sweet_cool')");
  db.exec("UPDATE tag_dict SET deprecated=1 WHERE dimension='clothing_style' AND dir NOT IN ('commute','casual','sport','formal','guochao','french','minimal','sweet_cool')");
  db.exec("UPDATE tag_dict SET deprecated=0 WHERE dimension='season' AND dir IN ('spring_summer','autumn_winter','all_season')");
  db.exec("UPDATE tag_dict SET deprecated=1 WHERE dimension='season' AND dir NOT IN ('spring_summer','autumn_winter','all_season')");
  db.exec("UPDATE tag_dict SET deprecated=1 WHERE dimension='shot_type' AND dir NOT IN ('close_up','half_body','full_body')");
  db.exec("UPDATE tag_dict SET deprecated=1 WHERE dimension='gender' AND dir NOT IN ('female','male')");
  db.exec("UPDATE tag_dict SET deprecated=1 WHERE dimension='person_style' AND dir NOT IN ('gentle','dignified','capable','intellectual','sweet','guofeng','cool')");
  db.exec("UPDATE tag_dict SET deprecated=1 WHERE dimension='wood_style' AND dir NOT IN ('natural_wood','dark_wood','natural_vintage_wood','dark_vintage_wood')");
  db.exec("UPDATE tag_dict SET deprecated=0 WHERE dimension='mood' AND dir IN ('easy','lyrical','cheerful','quiet','epic','tense','warm','retro')");
  db.exec("UPDATE tag_dict SET deprecated=1 WHERE dimension='mood' AND dir NOT IN ('easy','lyrical','cheerful','quiet','epic','tense','warm','retro')");

  // 主色入字典（原 prompt 写死 12 色）
  if (Array.isArray(DOMINANT_COLORS)) {
    for (const c of DOMINANT_COLORS) {
      const dir = `dom_${String(c.name).replace(/[\/\s]+/g, '_')}`;
      const criteria = `人眼第一视角最具视觉统治力的颜色为「${c.name}」（${c.desc || ''}）；点缀色不要覆盖主色判断。`;
      insTag.run({
        dimension: 'dominant_color',
        dir,
        label: c.name,
        aliases: c.desc ? JSON.stringify([c.desc]) : null,
        is_fallback: 0,
        deprecated: 0,
        parent_dir: null
      });
      try {
        db.prepare('UPDATE tag_dict SET criteria=? WHERE dimension=? AND dir=?')
          .run(criteria, 'dominant_color', dir);
      } catch { /* criteria column may not exist yet on first pass */ }
    }
  }

  remapStyleTags(db);
  remapSpaceTags(db);
  remapMaterialRoles(db);
}

function remapSpaceTags(db) {
  const SPACE_REMAP = { entryway: 'foyer' };
  const getCanonical = db.prepare("SELECT id FROM tag_dict WHERE dimension='space' AND dir=?");
  const insOrIgnore = db.prepare(`
    INSERT OR IGNORE INTO asset_tags(asset_fid, tag_id, role, confidence, source)
    VALUES(?, ?, ?, ?, ?)
  `);
  const delOld = db.prepare('DELETE FROM asset_tags WHERE tag_id=?');
  const deprecate = db.prepare('UPDATE tag_dict SET deprecated=1 WHERE id=?');
  for (const [from, to] of Object.entries(SPACE_REMAP)) {
    const oldTag = db.prepare("SELECT id FROM tag_dict WHERE dimension='space' AND dir=?").get(from);
    const canonical = getCanonical.get(to);
    if (!oldTag || !canonical || oldTag.id === canonical.id) continue;
    const linked = db.prepare('SELECT asset_fid, role, confidence, source FROM asset_tags WHERE tag_id=?').all(oldTag.id);
    for (const row of linked) {
      insOrIgnore.run(row.asset_fid, canonical.id, row.role, row.confidence, row.source);
    }
    delOld.run(oldTag.id);
    deprecate.run(oldTag.id);
  }
}

function remapMaterialRoles(db) {
  const { HARD_MATERIALS } = require('../src/tags-seed');
  const nullRows = db.prepare(`
    SELECT at.asset_fid, at.tag_id, at.confidence, at.source, t.dir
    FROM asset_tags at
    JOIN tag_dict t ON t.id = at.tag_id
    WHERE t.dimension = 'material_kind' AND (at.role IS NULL OR at.role = '')
  `).all();

  const delStmt = db.prepare("DELETE FROM asset_tags WHERE asset_fid=? AND tag_id=? AND (role IS NULL OR role = '')");
  const insStmt = db.prepare(`
    INSERT OR REPLACE INTO asset_tags(asset_fid, tag_id, role, source, confidence, updated_at)
    VALUES(?, ?, ?, ?, ?, ?)
  `);

  for (const r of nullRows) {
    const role = HARD_MATERIALS.has(r.dir) ? 'main' : 'accent';
    delStmt.run(r.asset_fid, r.tag_id);
    insStmt.run(r.asset_fid, r.tag_id, role, r.source || 'ai', r.confidence || 0.85, Date.now());
  }
}

function remapStyleTags(db) {
  // 终审映射：旧值 → 新文化叶子；wood 另有 remapWoodStyleTags
  // 丢弃（只删标不猜）：european_light_luxury / 欧式轻奢 / nordic / british
  const STYLE_REMAP = {
    modern_minimal: 'modern_minimal',
    pure_minimal: 'modern_minimal',
    extreme_minimal: 'modern_minimal',
    cream_style: 'cream_style',
    cream_new: 'cream_style',
    wabi_sabi: 'wabi_sabi',
    wabi_sabi_new: 'wabi_sabi',
    // 原木日式 → 文化侧不再保留日式；木系由 remapWoodStyleTags 补自然原木
    log_wood: 'eclectic_other',
    japanese_minimal: 'eclectic_other',
    japanese: 'eclectic_other',
    japandi: 'eclectic_other',
    japandi_new: 'eclectic_other',
    // 北欧/英式取消 → 不强猜，并入混搭兜底
    nordic: 'eclectic_other',
    nordic_modern: 'eclectic_other',
    classic_nordic: 'eclectic_other',
    british: 'eclectic_other',
    // 美式拆分：旧统一美式 → 现代美式（更常见）；乡村别名 → 美式乡村
    american: 'american_modern',
    american_new: 'american_modern',
    american_modern: 'american_modern',
    american_farmhouse: 'american_country',
    american_country: 'american_country',
    // 中式
    neo_chinese: 'neo_chinese',
    neo_chinese_new: 'neo_chinese',
    traditional_chinese: 'classical_chinese',
    classical_chinese: 'classical_chinese',
    song_aesthetic: 'song_aesthetic',
    // 欧洲
    french: 'french',
    french_new: 'french',
    italian: 'italian',
    italian_new: 'italian',
    tuscan: 'tuscan',
    tuscan_country: 'tuscan',
    mediterranean: 'mediterranean',
    coastal: 'mediterranean',
    // 欧式轻奢废除 → 不自动猜法式/意式，并入混搭待复核
    european_light_luxury: 'eclectic_other',
    french_light_luxury: 'eclectic_other',
    french_classical: 'french',
    italian_modern: 'eclectic_other',
    italian_minimal: 'eclectic_other',
    italian_light_luxury: 'eclectic_other',
    modern_light_lux: 'modern_minimal',
    light_luxury: 'eclectic_other',
    // 现代流派
    mid_century: 'mid_century',
    mid_century_global: 'mid_century',
    industrial: 'industrial',
    industrial_new: 'industrial',
    nanyang_resort: 'nanyang_resort',
    sea_resort: 'nanyang_resort',
    tropical_modern: 'nanyang_resort',
    nanyang_retro: 'nanyang_resort',
    eclectic_other: 'eclectic_other',
    bohemian: 'eclectic_other',
    retro: 'eclectic_other',
    eclectic_unknown: 'eclectic_other'
  };

  const getCanonicalStmt = db.prepare("SELECT id FROM tag_dict WHERE dimension='style_atom' AND dir=?");
  const allStyleTags = db.prepare("SELECT id, dir, label FROM tag_dict WHERE dimension='style_atom'").all();

  const insOrIgnoreStmt = db.prepare(`
    INSERT OR IGNORE INTO asset_tags(asset_fid, tag_id, role, confidence, source)
    VALUES(?, ?, ?, ?, ?)
  `);
  const delOldAssetTagStmt = db.prepare("DELETE FROM asset_tags WHERE tag_id=?");
  const deprecateTagStmt = db.prepare("UPDATE tag_dict SET deprecated=1 WHERE id=?");

  for (const oldTag of allStyleTags) {
    const targetDir = STYLE_REMAP[oldTag.dir];
    if (!targetDir) continue;
    const canonical = getCanonicalStmt.get(targetDir);
    if (!canonical) continue;

    if (canonical.id !== oldTag.id) {
      const linked = db.prepare("SELECT asset_fid, role, confidence, source FROM asset_tags WHERE tag_id=?").all(oldTag.id);
      for (const row of linked) {
        insOrIgnoreStmt.run(row.asset_fid, canonical.id, row.role, row.confidence, row.source);
      }
      delOldAssetTagStmt.run(oldTag.id);
      deprecateTagStmt.run(oldTag.id);
    }
  }

  // 显式废弃旧值（含不进 REMMAP 的）
  const FORCE_DROP = new Set([
    'european_light_luxury', 'log_wood', 'japanese', 'nordic', 'british',
    'japandi', 'french_light_luxury', 'italian_modern',
    'american_farmhouse', 'american', 'mid_century_global', 'tuscan_country'
  ]);
  for (const tag of allStyleTags) {
    if (FORCE_DROP.has(tag.dir)) {
      deprecateTagStmt.run(tag.id);
    }
  }

  migrateWoodStyleAndEclecticToStyleAtom(db);
}

/**
 * 核心迁移：彻底下线「混搭」，四种木色正式并入 style_atom，兜底统一落入「其他风格」，确保风格永不为空
 */
function migrateWoodStyleAndEclecticToStyleAtom(db) {
  // 1. 确保 style_atom 下拥有 other 以及 4 种木色，且均为非废弃状态
  const ensureTag = db.prepare(`
    INSERT INTO tag_dict(dimension, dir, label, aliases, is_fallback, deprecated, parent_dir)
    VALUES(?, ?, ?, ?, 0, 0, ?)
    ON CONFLICT(dimension, dir) DO UPDATE SET
      label=excluded.label,
      deprecated=0,
      parent_dir=excluded.parent_dir
  `);

  ensureTag.run('style_atom', 'other', '其他风格', JSON.stringify(['其他', '未分类风格', '混搭']), 'other_region');
  ensureTag.run('style_atom', 'natural_wood', '自然原木风', JSON.stringify(['原木风', '浅色原木', '日式']), 'wood_system');
  ensureTag.run('style_atom', 'dark_wood', '深色原木风', JSON.stringify(['深色原木', '深木']), 'wood_system');
  ensureTag.run('style_atom', 'natural_vintage_wood', '自然复古原木风', JSON.stringify(['浅色做旧原木']), 'wood_system');
  ensureTag.run('style_atom', 'dark_vintage_wood', '深色复古原木风', JSON.stringify(['深色做旧原木', '深色石头复古']), 'wood_system');

  const getStyleTag = db.prepare("SELECT id FROM tag_dict WHERE dimension='style_atom' AND dir=?");
  const insOrIgnore = db.prepare(`
    INSERT OR IGNORE INTO asset_tags(asset_fid, tag_id, role, confidence, source)
    VALUES(?, ?, ?, ?, ?)
  `);
  const delAssetTag = db.prepare("DELETE FROM asset_tags WHERE tag_id=?");

  // 2. 将旧的 eclectic_other（混搭）平滑迁移至 other（其他风格）
  const eclecticTag = db.prepare("SELECT id FROM tag_dict WHERE dimension='style_atom' AND dir='eclectic_other'").get();
  const otherTag = getStyleTag.get('other');
  if (eclecticTag && otherTag && eclecticTag.id !== otherTag.id) {
    const eclecticRows = db.prepare("SELECT asset_fid, role, confidence, source FROM asset_tags WHERE tag_id=?").all(eclecticTag.id);
    for (const r of eclecticRows) {
      insOrIgnore.run(r.asset_fid, otherTag.id, r.role || 'main', r.confidence || 0.8, r.source || 'migrate');
    }
    delAssetTag.run(eclecticTag.id);
    db.prepare("UPDATE tag_dict SET deprecated=1 WHERE id=?").run(eclecticTag.id);
    console.log(`[migrate] 已将 ${eclecticRows.length} 条历史「混搭」标签迁移为「其他风格」`);
  }

  // 3. 将旧的 wood_style（4 种木色）平滑迁移至 style_atom
  const woodDirs = ['natural_wood', 'dark_wood', 'natural_vintage_wood', 'dark_vintage_wood'];
  let woodMigratedCount = 0;
  for (const dir of woodDirs) {
    const oldWoodTag = db.prepare("SELECT id FROM tag_dict WHERE dimension='wood_style' AND dir=?").get(dir);
    const newStyleTag = getStyleTag.get(dir);
    if (oldWoodTag && newStyleTag) {
      const rows = db.prepare("SELECT asset_fid, role, confidence, source FROM asset_tags WHERE tag_id=?").all(oldWoodTag.id);
      for (const r of rows) {
        insOrIgnore.run(r.asset_fid, newStyleTag.id, r.role || 'main', r.confidence || 0.85, r.source || 'migrate');
        woodMigratedCount++;
      }
      delAssetTag.run(oldWoodTag.id);
      db.prepare("UPDATE tag_dict SET deprecated=1 WHERE id=?").run(oldWoodTag.id);
    }
  }
  if (woodMigratedCount > 0) {
    console.log(`[migrate] 已将 ${woodMigratedCount} 条历史「wood_style」木系标签平滑迁移入「style_atom」风格`);
  }

  // 4. 将旧日式/原木日式等残留标签也平滑并入 natural_wood
  const naturalWoodTag = getStyleTag.get('natural_wood');
  if (naturalWoodTag) {
    const legacyDirs = ['log_wood', 'japanese', 'japanese_minimal'];
    for (const ld of legacyDirs) {
      const lt = db.prepare("SELECT id FROM tag_dict WHERE dimension='style_atom' AND dir=?").get(ld);
      if (lt) {
        const rows = db.prepare("SELECT asset_fid, role, confidence, source FROM asset_tags WHERE tag_id=?").all(lt.id);
        for (const r of rows) {
          insOrIgnore.run(r.asset_fid, naturalWoodTag.id, r.role || 'main', r.confidence || 0.8, r.source || 'migrate');
        }
        delAssetTag.run(lt.id);
        db.prepare("UPDATE tag_dict SET deprecated=1 WHERE id=?").run(lt.id);
      }
    }
  }

  // 5. 风格字段严禁为空：对无任何 style_atom 的空间素材补充 other 兜底
  if (otherTag) {
    const emptyStyleAssets = db.prepare(`
      SELECT a.fid FROM assets a
      WHERE COALESCE(a.category, 'interior') IN ('interior', 'exterior')
        AND a.fid NOT IN (
          SELECT at.asset_fid FROM asset_tags at
          JOIN tag_dict td ON td.id = at.tag_id
          WHERE td.dimension = 'style_atom'
        )
    `).all();
    for (const a of emptyStyleAssets) {
      insOrIgnore.run(a.fid, otherTag.id, 'main', 0.75, 'fallback');
    }
    if (emptyStyleAssets.length > 0) {
      console.log(`[migrate] 已为 ${emptyStyleAssets.length} 个无风格标签的空间素材补充「其他风格」兜底`);
    }
  }
}

function backfillDominantColors(db, dataDir) {
  const { basicColorOfHex } = require('../src/colors');

  // 1. 依据 12 室内主色规则刷新存量 asset_colors 的 basic_color
  const allColors = db.prepare("SELECT asset_fid, hex, role, weight, name FROM asset_colors").all();
  const updColorStmt = db.prepare("UPDATE asset_colors SET basic_color=? WHERE asset_fid=? AND role=?");
  for (const c of allColors) {
    const freshBasic = basicColorOfHex(c.hex);
    updColorStmt.run(freshBasic, c.asset_fid, c.role);
  }

  // 2. 为所有资产校准并写入唯一 dominant_color
  const assets = db.prepare("SELECT fid FROM assets").all();
  if (!assets.length) return;

  const getAssetColorsStmt = db.prepare("SELECT hex, role, weight, name, basic_color FROM asset_colors WHERE asset_fid=?");
  const updAssetDominantStmt = db.prepare("UPDATE assets SET dominant_color=? WHERE fid=?");

  let count = 0;
  for (const a of assets) {
    const acList = getAssetColorsStmt.all(a.fid);
    if (!acList.length) {
      updAssetDominantStmt.run('灰', a.fid);
      count++;
      continue;
    }

    for (const item of acList) {
      const basic = item.basic_color || basicColorOfHex(item.hex);
      let boost = 1.0;
      if (['白', '灰', '黑', '米/奶油'].includes(basic)) {
        boost = 1.0;
      } else if (basic === '原木/木色') {
        boost = 1.2;
      } else {
        boost = item.role === 'main' ? 3.5 : 2.8;
      }
      item.salience = (item.weight || 0.1) * boost;
      item.basic = basic;
    }
    acList.sort((x, y) => y.salience - x.salience);

    const chosen = acList[0];
    const dom = chosen.basic || '灰';
    updAssetDominantStmt.run(dom, a.fid);
    count++;
  }
}

function indoorAssetSql() {
  return `
    kind='image'
    AND COALESCE(category, 'interior') NOT IN ('furniture', 'portrait', 'music')
    AND (status IS NULL OR status NOT IN ('deleted', 'excluded'))
  `;
}

function wipeIndoorTagsIfNeeded(db) {
  const ver = db.prepare("SELECT value FROM kv WHERE key='indoor_tags_rebuild_v1'").get()?.value;
  if (ver === 'wiped' || ver === 'queued' || ver === 'done') return;
  const indoor = indoorAssetSql();
  const countRow = db.prepare(`SELECT COUNT(*) AS c FROM assets WHERE ${indoor}`).get();
  const del = db.prepare(`
    DELETE FROM asset_tags
    WHERE asset_fid IN (SELECT fid FROM assets WHERE ${indoor})
  `).run();
  db.prepare(`
    INSERT INTO kv (key, value) VALUES ('indoor_tags_rebuild_v1', 'wiped')
    ON CONFLICT(key) DO UPDATE SET value='wiped'
  `).run();
  console.log(`[migrate] 室内清标: 删除 ${del.changes || 0} 条标签, 涉及约 ${countRow?.c || 0} 张室内图（色板/画幅未动）`);
}

function restoreRevokedAssetsIfNeeded(db) {
  const ver = db.prepare("SELECT value FROM kv WHERE key='restore_revoked_v1'").get()?.value;
  if (ver === '1') return;
  const now = Date.now();
  const r = db.prepare(`
    UPDATE assets
    SET auth_state='live', auth_revoked_at=NULL, updated_at=?
    WHERE auth_state IN ('revoked','frozen_revoked')
      AND (status IS NULL OR status != 'deleted')
  `).run(now);
  db.prepare(`
    INSERT INTO kv (key, value) VALUES ('restore_revoked_v1', '1')
    ON CONFLICT(key) DO UPDATE SET value='1'
  `).run();
  console.log(`[migrate] 相册撤销救回: ${r.changes || 0} 张重新可见`);
}

function ungroupVideoExtractsIfNeeded(db) {
  // CONFLICT-002：重复组概念已退役，视频抽帧拆组逻辑已无对象可操作。
  // 保留 kv 标记防止旧日志语义混乱；存量分组数据由 migrate-audit-20261020.js 统一清空。
  db.prepare(`
    INSERT INTO kv (key, value) VALUES ('video_extract_ungroup_v1', '1')
    ON CONFLICT(key) DO UPDATE SET value='1'
  `).run();
}

function alignDupGroupsAndVectors(db) {
  // CONFLICT-002：重复组聚类已随概念退役整体移除。
  // 本函数只保留原有的「向量补齐」职责。
  const missingVecAssets = db.prepare(`
    SELECT a.fid, a.file_name FROM assets a
    LEFT JOIN asset_vectors av ON av.asset_fid = a.fid
    WHERE a.status IN ('ready', 'ready_with_flags', 'tagging_done') AND av.asset_fid IS NULL
  `).all();

  if (missingVecAssets.length > 0) {
    const { generateSemanticVector, storeVector } = require('../src/vector');
    for (const a of missingVecAssets) {
      const tags = db.prepare(`
        SELECT t.dimension, t.dir, t.label FROM asset_tags at
        JOIN tag_dict t ON t.id = at.tag_id
        WHERE at.asset_fid = ?
      `).all(a.fid);
      const parts = [];
      const grouped = {};
      tags.forEach(t => {
        if (!grouped[t.dimension]) grouped[t.dimension] = [];
        grouped[t.dimension].push(t.label || t.dir);
      });
      ['space', 'style_atom', 'material_kind', 'palette', 'luxury', 'era'].forEach(k => {
        if (grouped[k]) parts.push(`${k}:${grouped[k].join(',')}`);
      });
      if (a.file_name) parts.push(`文件:${a.file_name}`);
      const caption = parts.join(' ') || '室内设计现代空间素材';
      const vec = generateSemanticVector(caption, 64);
      storeVector(db, a.fid, vec, 'local_semantic_hash_v1');
    }
  }
}

if (require.main === module) {
  const targetDir = process.argv[2] || process.env.ML_DATA_DIR || path.join(os.homedir(), '.dsh-material-library');
  console.log('[migrate] 目标数据目录:', targetDir);
  const db = migrate(targetDir, { doBackup: true });
  const { reextractReadyColors } = require('./reextract_ready_colors');
  reextractReadyColors(db, targetDir).then(() => {
    db.close();
    console.log('[migrate] 执行完毕');
  });
}

module.exports = { migrate, seedTags, DEFAULT_WORKFLOW_GRAPH, BUILTIN_ADAPTERS };
