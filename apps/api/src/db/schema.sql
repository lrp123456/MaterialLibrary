-- Material Library PostgreSQL Complete Schema (Phase 2)
-- Matches all tables from SQLite with pgvector support

CREATE EXTENSION IF NOT EXISTS vector;

-- 1. 用户与认证
CREATE TABLE IF NOT EXISTS users (
    id SERIAL PRIMARY KEY,
    username VARCHAR(100) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    role VARCHAR(50) NOT NULL DEFAULT 'viewer',
    is_locked SMALLINT NOT NULL DEFAULT 0,
    created_at BIGINT,
    updated_at BIGINT
);

CREATE TABLE IF NOT EXISTS sessions (
    token VARCHAR(255) PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role VARCHAR(50) NOT NULL,
    expires_at BIGINT
);

-- 2. 核心资产表
CREATE TABLE IF NOT EXISTS assets (
    fid VARCHAR(128) PRIMARY KEY,
    name TEXT NOT NULL,
    orig_path TEXT,
    size BIGINT,
    md5 VARCHAR(64),
    phash VARCHAR(64),
    width INTEGER,
    height INTEGER,
    duration REAL,
    mime_type VARCHAR(128),
    file_type VARCHAR(32),
    status VARCHAR(32) NOT NULL DEFAULT 'discovered',
    auth_state VARCHAR(32) NOT NULL DEFAULT 'approved',
    quality_score REAL,
    watermark_detected SMALLINT DEFAULT 0,
    created_at BIGINT,
    updated_at BIGINT,
    deleted_at BIGINT,
    export_tag TEXT,
    preview_sha256 VARCHAR(64),
    preview_md5 VARCHAR(64),
    thumb_sha256 VARCHAR(64),
    thumb_md5 VARCHAR(64),
    sharpness REAL,
    favorited_at BIGINT,
    visibility VARCHAR(32) NOT NULL DEFAULT 'visible',
    pipeline_status VARCHAR(32) NOT NULL DEFAULT 'done',
    source_type VARCHAR(64) DEFAULT 'web_upload',
    source_note TEXT
);

CREATE INDEX IF NOT EXISTS idx_assets_visibility_browse ON assets(visibility, auth_state, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_assets_browse ON assets(status, auth_state, created_at DESC, fid DESC);
CREATE INDEX IF NOT EXISTS idx_assets_md5 ON assets(md5);
CREATE INDEX IF NOT EXISTS idx_assets_phash ON assets(phash);
CREATE INDEX IF NOT EXISTS idx_assets_preview_sha ON assets(preview_sha256);
CREATE INDEX IF NOT EXISTS idx_assets_thumb_sha ON assets(thumb_sha256);

-- 3. 衍生图表
CREATE TABLE IF NOT EXISTS derivatives (
    id SERIAL PRIMARY KEY,
    asset_fid VARCHAR(128) NOT NULL REFERENCES assets(fid) ON DELETE CASCADE,
    kind VARCHAR(32) NOT NULL,
    path TEXT NOT NULL,
    width INTEGER,
    height INTEGER,
    sha256 VARCHAR(64),
    md5 VARCHAR(64),
    phash VARCHAR(64),
    file_size BIGINT,
    created_at BIGINT,
    UNIQUE(asset_fid, kind)
);

CREATE INDEX IF NOT EXISTS idx_derivatives_fid_kind ON derivatives(asset_fid, kind);
CREATE INDEX IF NOT EXISTS idx_derivatives_sha256 ON derivatives(sha256);
CREATE INDEX IF NOT EXISTS idx_derivatives_md5 ON derivatives(md5);

-- 4. 标签与标签字典
CREATE TABLE IF NOT EXISTS tag_dict (
    id SERIAL PRIMARY KEY,
    dimension VARCHAR(64) NOT NULL,
    dir VARCHAR(128) NOT NULL,
    label VARCHAR(128) NOT NULL,
    parent_id INTEGER,
    aliases TEXT,
    criteria TEXT,
    deprecated SMALLINT NOT NULL DEFAULT 0,
    is_fallback SMALLINT NOT NULL DEFAULT 0,
    updated_at BIGINT,
    UNIQUE(dimension, dir)
);

CREATE TABLE IF NOT EXISTS asset_tags (
    asset_fid VARCHAR(128) NOT NULL REFERENCES assets(fid) ON DELETE CASCADE,
    tag_id INTEGER NOT NULL,
    role VARCHAR(32),
    source VARCHAR(32) NOT NULL DEFAULT 'ai',
    confidence REAL,
    updated_at BIGINT,
    PRIMARY KEY (asset_fid, tag_id, role)
);

CREATE INDEX IF NOT EXISTS idx_at_tag ON asset_tags(tag_id);
CREATE INDEX IF NOT EXISTS idx_at_asset ON asset_tags(asset_fid);

CREATE TABLE IF NOT EXISTS asset_tag_history (
    id SERIAL PRIMARY KEY,
    asset_fid VARCHAR(128) NOT NULL,
    action VARCHAR(32) NOT NULL,
    tags_json TEXT,
    created_at BIGINT
);

CREATE TABLE IF NOT EXISTS tag_dict_audit (
    id SERIAL PRIMARY KEY,
    action VARCHAR(32) NOT NULL,
    target_id INTEGER,
    diff_json TEXT,
    created_at BIGINT
);

-- 5. 色彩分析
CREATE TABLE IF NOT EXISTS asset_colors (
    asset_fid VARCHAR(128) NOT NULL REFERENCES assets(fid) ON DELETE CASCADE,
    hex VARCHAR(16) NOT NULL,
    role VARCHAR(32) NOT NULL,
    weight REAL,
    name VARCHAR(64),
    basic_color VARCHAR(32),
    PRIMARY KEY (asset_fid, role)
);
CREATE INDEX IF NOT EXISTS idx_ac_basic ON asset_colors(basic_color);

-- 6. 向量检索表 (预留 vector(1024) 与 HNSW 索引)
CREATE TABLE IF NOT EXISTS asset_vectors (
    asset_fid VARCHAR(128) PRIMARY KEY REFERENCES assets(fid) ON DELETE CASCADE,
    model_version VARCHAR(64) NOT NULL,
    dim INTEGER NOT NULL DEFAULT 1024,
    vec_json TEXT,
    embedding vector(1024),
    updated_at BIGINT
);

CREATE INDEX IF NOT EXISTS idx_asset_vectors_hnsw ON asset_vectors USING hnsw (embedding vector_cosine_ops);

-- 7. 查重组
CREATE TABLE IF NOT EXISTS dup_groups (
    id VARCHAR(128) PRIMARY KEY,
    representative_fid VARCHAR(128) NOT NULL,
    member_count INTEGER DEFAULT 1,
    match_reason TEXT,
    updated_at BIGINT
);

-- 8. 创作工作台：Chat 会话与消息流
CREATE TABLE IF NOT EXISTS chat_sessions (
    id VARCHAR(128) PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    title TEXT,
    created_at BIGINT,
    updated_at BIGINT
);
CREATE INDEX IF NOT EXISTS idx_chat_sessions_user ON chat_sessions(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS chat_messages (
    id VARCHAR(128) PRIMARY KEY,
    session_id VARCHAR(128) NOT NULL REFERENCES chat_sessions(id) ON DELETE CASCADE,
    user_id INTEGER,
    role VARCHAR(32) NOT NULL DEFAULT 'user',
    mode VARCHAR(64) NOT NULL DEFAULT 'text_to_image',
    prompt TEXT,
    params_json TEXT,
    images_json TEXT,
    status VARCHAR(32) NOT NULL DEFAULT 'done',
    run_id VARCHAR(128),
    engine VARCHAR(64),
    result_json TEXT,
    created_at BIGINT,
    updated_at BIGINT
);
CREATE INDEX IF NOT EXISTS idx_chat_msg_session ON chat_messages(session_id, created_at ASC);

-- 9. 生图/生视频异步任务
CREATE TABLE IF NOT EXISTS gen_jobs (
    id VARCHAR(128) PRIMARY KEY,
    user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
    session_id VARCHAR(128),
    action VARCHAR(64) NOT NULL,
    prompt TEXT,
    model VARCHAR(128),
    params_json TEXT,
    status VARCHAR(32) NOT NULL DEFAULT 'queued',
    progress REAL DEFAULT 0,
    error TEXT,
    result_json TEXT,
    output_fid VARCHAR(128),
    created_at BIGINT,
    started_at BIGINT,
    finished_at BIGINT,
    updated_at BIGINT
);
CREATE INDEX IF NOT EXISTS idx_gen_jobs_user ON gen_jobs(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_gen_jobs_status ON gen_jobs(status);

CREATE TABLE IF NOT EXISTS gen_job_bindings (
    job_id VARCHAR(128) NOT NULL,
    target_type VARCHAR(64) NOT NULL,
    target_id VARCHAR(128) NOT NULL,
    created_at BIGINT,
    PRIMARY KEY(job_id, target_type, target_id)
);

-- 10. AI 创作库 (配方、模板与版块)
CREATE TABLE IF NOT EXISTS creation_sections (
    id VARCHAR(128) PRIMARY KEY,
    name VARCHAR(128) NOT NULL,
    sort_order INTEGER DEFAULT 0,
    created_at BIGINT,
    updated_at BIGINT
);

CREATE TABLE IF NOT EXISTS creation_templates (
    id VARCHAR(128) PRIMARY KEY,
    user_id INTEGER DEFAULT 1,
    title TEXT NOT NULL,
    prompt TEXT NOT NULL,
    aspect_ratio VARCHAR(32) DEFAULT '16:9',
    origin_images TEXT DEFAULT '[]',
    result_images TEXT DEFAULT '[]',
    params_json TEXT DEFAULT '{}',
    tags TEXT DEFAULT '[]',
    section_id VARCHAR(128),
    created_at BIGINT,
    updated_at BIGINT
);
CREATE INDEX IF NOT EXISTS idx_creation_tpl_user ON creation_templates(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS creation_template_tombstones (
    template_id VARCHAR(128) PRIMARY KEY,
    deleted_at BIGINT NOT NULL
);

-- 11. Base Library (BA 空间、方案、单品与材质)
CREATE TABLE IF NOT EXISTS ba_spaces (
    id VARCHAR(128) PRIMARY KEY,
    name VARCHAR(128) NOT NULL,
    sort_order INTEGER DEFAULT 0,
    created_at BIGINT
);

CREATE TABLE IF NOT EXISTS ba_space_rules (
    id SERIAL PRIMARY KEY,
    space_key VARCHAR(128) NOT NULL,
    rule_type VARCHAR(64) NOT NULL,
    rule_value TEXT NOT NULL,
    created_at BIGINT
);

CREATE TABLE IF NOT EXISTS ba_styles (
    id VARCHAR(128) PRIMARY KEY,
    name VARCHAR(128) NOT NULL,
    description TEXT,
    created_at BIGINT
);

CREATE TABLE IF NOT EXISTS ba_items (
    id VARCHAR(128) PRIMARY KEY,
    name VARCHAR(128) NOT NULL,
    category VARCHAR(64) NOT NULL,
    cover_fid VARCHAR(128),
    prompt_name VARCHAR(128),
    is_pinned SMALLINT DEFAULT 0,
    attributes_json TEXT DEFAULT '{}',
    origin VARCHAR(32) NOT NULL DEFAULT 'crawler',
    locked_fields TEXT DEFAULT '[]',
    created_at BIGINT,
    updated_at BIGINT
);

CREATE TABLE IF NOT EXISTS ba_item_mounts (
    id SERIAL PRIMARY KEY,
    item_id VARCHAR(128) NOT NULL,
    mount_type VARCHAR(64) NOT NULL,
    mount_target VARCHAR(128) NOT NULL,
    created_at BIGINT
);

CREATE TABLE IF NOT EXISTS ba_schemes (
    id VARCHAR(128) PRIMARY KEY,
    name VARCHAR(128) NOT NULL,
    style_id VARCHAR(128),
    space_key VARCHAR(128),
    description TEXT,
    cover_fid VARCHAR(128),
    slots_json TEXT DEFAULT '[]',
    created_at BIGINT,
    updated_at BIGINT
);

CREATE TABLE IF NOT EXISTS ba_scheme_slots (
    id SERIAL PRIMARY KEY,
    scheme_id VARCHAR(128) NOT NULL,
    slot_key VARCHAR(128) NOT NULL,
    item_id VARCHAR(128),
    required SMALLINT DEFAULT 0,
    created_at BIGINT
);

CREATE TABLE IF NOT EXISTS ba_paints (
    id VARCHAR(128) PRIMARY KEY,
    brand VARCHAR(64),
    code VARCHAR(64),
    name VARCHAR(128),
    hex VARCHAR(16),
    created_at BIGINT
);

CREATE TABLE IF NOT EXISTS ba_parts (
    id VARCHAR(128) PRIMARY KEY,
    name VARCHAR(128) NOT NULL,
    category VARCHAR(64),
    created_at BIGINT
);

CREATE TABLE IF NOT EXISTS ba_models (
    id VARCHAR(128) PRIMARY KEY,
    name VARCHAR(128) NOT NULL,
    file_path TEXT,
    created_at BIGINT
);

CREATE TABLE IF NOT EXISTS ba_materials (
    id VARCHAR(128) PRIMARY KEY,
    name VARCHAR(128) NOT NULL,
    category VARCHAR(64),
    created_at BIGINT
);

CREATE TABLE IF NOT EXISTS ba_material_categories (
    id VARCHAR(128) PRIMARY KEY,
    name VARCHAR(128) NOT NULL,
    sort_order INTEGER DEFAULT 0
);

CREATE TABLE IF NOT EXISTS ba_material_swatches (
    id VARCHAR(128) PRIMARY KEY,
    material_id VARCHAR(128),
    color_hex VARCHAR(16),
    texture_fid VARCHAR(128)
);

CREATE TABLE IF NOT EXISTS ba_light_presets (
    id VARCHAR(128) PRIMARY KEY,
    name VARCHAR(128) NOT NULL,
    params_json TEXT
);

CREATE TABLE IF NOT EXISTS ba_preset_slots (
    id VARCHAR(128) PRIMARY KEY,
    preset_id VARCHAR(128),
    slot_json TEXT
);

CREATE TABLE IF NOT EXISTS ba_operation_guides (
    id VARCHAR(128) PRIMARY KEY,
    title TEXT,
    content TEXT
);

CREATE TABLE IF NOT EXISTS ba_image_bindings (
    id SERIAL PRIMARY KEY,
    fid VARCHAR(128) NOT NULL,
    scheme_id VARCHAR(128),
    item_id VARCHAR(128)
);

CREATE TABLE IF NOT EXISTS ba_flags (
    key VARCHAR(128) PRIMARY KEY,
    value TEXT
);

CREATE TABLE IF NOT EXISTS ba_drafts (
    id VARCHAR(128) PRIMARY KEY,
    content_json TEXT,
    updated_at BIGINT
);

CREATE TABLE IF NOT EXISTS ba_mirror_runs (
    id VARCHAR(128) PRIMARY KEY,
    status VARCHAR(32),
    created_at BIGINT
);

CREATE TABLE IF NOT EXISTS ba_asset_tags (
    asset_fid VARCHAR(128) NOT NULL,
    tag_name VARCHAR(128) NOT NULL,
    PRIMARY KEY (asset_fid, tag_name)
);

-- 12. 剪辑项目、快照与包 (Clip)
CREATE TABLE IF NOT EXISTS editor_projects (
    id VARCHAR(128) PRIMARY KEY,
    title TEXT NOT NULL,
    tracks_json TEXT NOT NULL DEFAULT '[]',
    duration REAL DEFAULT 0,
    fps INTEGER DEFAULT 30,
    width INTEGER DEFAULT 1920,
    height INTEGER DEFAULT 1080,
    preview_fid VARCHAR(128),
    created_at BIGINT,
    updated_at BIGINT
);

CREATE TABLE IF NOT EXISTS clip_snapshots (
    id VARCHAR(128) PRIMARY KEY,
    project_id VARCHAR(128) NOT NULL,
    title TEXT,
    created_at BIGINT
);

CREATE TABLE IF NOT EXISTS clip_snapshot_assets (
    id SERIAL PRIMARY KEY,
    snapshot_id VARCHAR(128) NOT NULL,
    asset_fid VARCHAR(128) NOT NULL
);

CREATE TABLE IF NOT EXISTS clip_packs (
    id VARCHAR(128) PRIMARY KEY,
    name VARCHAR(128) NOT NULL,
    version VARCHAR(32) NOT NULL,
    file_path TEXT,
    size BIGINT,
    checksum VARCHAR(64),
    created_at BIGINT
);

CREATE TABLE IF NOT EXISTS clip_ai_jobs (
    id VARCHAR(128) PRIMARY KEY,
    action VARCHAR(64) NOT NULL,
    params_json TEXT,
    status VARCHAR(32) NOT NULL DEFAULT 'queued',
    result_json TEXT,
    created_at BIGINT,
    finished_at BIGINT
);

-- 13. 工作流执行引擎
CREATE TABLE IF NOT EXISTS workflows (
    id VARCHAR(128) PRIMARY KEY,
    name VARCHAR(128) NOT NULL,
    version INTEGER NOT NULL DEFAULT 1,
    is_default SMALLINT NOT NULL DEFAULT 1,
    graph_json TEXT NOT NULL,
    created_at BIGINT,
    updated_at BIGINT
);

CREATE TABLE IF NOT EXISTS node_templates (
    id VARCHAR(128) PRIMARY KEY,
    label VARCHAR(128) NOT NULL,
    category VARCHAR(64),
    form_schema_json TEXT,
    default_config_json TEXT
);

CREATE TABLE IF NOT EXISTS workflow_modules (
    id VARCHAR(128) PRIMARY KEY,
    name VARCHAR(128) NOT NULL,
    code TEXT
);

CREATE TABLE IF NOT EXISTS workflow_mount_points (
    id VARCHAR(128) PRIMARY KEY,
    module_id VARCHAR(128),
    point VARCHAR(64)
);

CREATE TABLE IF NOT EXISTS runs (
    id VARCHAR(128) PRIMARY KEY,
    workflow_id VARCHAR(128) NOT NULL,
    workflow_version INTEGER NOT NULL,
    trigger VARCHAR(64),
    status VARCHAR(32) NOT NULL DEFAULT 'queued',
    asset_count INTEGER DEFAULT 0,
    success_count INTEGER DEFAULT 0,
    failed_count INTEGER DEFAULT 0,
    error TEXT,
    created_at BIGINT,
    started_at BIGINT,
    finished_at BIGINT,
    updated_at BIGINT
);

CREATE TABLE IF NOT EXISTS node_runs (
    id SERIAL PRIMARY KEY,
    run_id VARCHAR(128) NOT NULL,
    workflow_version INTEGER NOT NULL,
    node_id VARCHAR(128) NOT NULL,
    node_type VARCHAR(64) NOT NULL,
    asset_fid VARCHAR(128) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'queued',
    error TEXT,
    input_summary TEXT,
    output_summary TEXT,
    derivative_id INTEGER,
    duration_ms INTEGER,
    progress REAL,
    not_before BIGINT,
    created_at BIGINT,
    updated_at BIGINT,
    UNIQUE(workflow_version, node_id, asset_fid)
);
CREATE INDEX IF NOT EXISTS idx_node_runs_fid_node_id ON node_runs(asset_fid, node_id, id DESC);
CREATE INDEX IF NOT EXISTS idx_node_runs_run_id ON node_runs(run_id);

-- 14. 适配器与模型治理
CREATE TABLE IF NOT EXISTS gen_adapters (
    id VARCHAR(128) PRIMARY KEY,
    label VARCHAR(128) NOT NULL,
    kind VARCHAR(64) NOT NULL,
    builtin SMALLINT NOT NULL DEFAULT 0,
    protocol VARCHAR(64) NOT NULL,
    base_url TEXT,
    secrets_json TEXT,
    config_json TEXT NOT NULL,
    enabled SMALLINT NOT NULL DEFAULT 1,
    created_at BIGINT,
    updated_at BIGINT
);

CREATE TABLE IF NOT EXISTS llm_providers (
    id VARCHAR(128) PRIMARY KEY,
    name VARCHAR(128) NOT NULL,
    api_key TEXT,
    base_url TEXT,
    is_active SMALLINT DEFAULT 1
);

CREATE TABLE IF NOT EXISTS llm_models (
    id VARCHAR(128) PRIMARY KEY,
    provider_id VARCHAR(128),
    name VARCHAR(128) NOT NULL,
    type VARCHAR(32) NOT NULL
);

CREATE TABLE IF NOT EXISTS llm_endpoints (
    id VARCHAR(128) PRIMARY KEY,
    model_id VARCHAR(128),
    url TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS llm_capabilities (
    id VARCHAR(128) PRIMARY KEY,
    model_id VARCHAR(128),
    feature VARCHAR(64) NOT NULL
);

CREATE TABLE IF NOT EXISTS model_contracts (
    id VARCHAR(128) PRIMARY KEY,
    model_name VARCHAR(128) NOT NULL,
    schema_json TEXT
);

CREATE TABLE IF NOT EXISTS gen_model_custom_schemas (
    model_id VARCHAR(128) PRIMARY KEY,
    schema_json TEXT
);

CREATE TABLE IF NOT EXISTS gen_polish_prompts (
    id VARCHAR(128) PRIMARY KEY,
    title VARCHAR(128) NOT NULL,
    prompt TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS gen_skill_drafts (
    id VARCHAR(128) PRIMARY KEY,
    title VARCHAR(128) NOT NULL,
    content TEXT
);

-- 15. 辅助与治理表
CREATE TABLE IF NOT EXISTS kv (
    key VARCHAR(255) PRIMARY KEY,
    value TEXT
);

CREATE TABLE IF NOT EXISTS presets (
    id VARCHAR(128) PRIMARY KEY,
    label VARCHAR(128) NOT NULL,
    action VARCHAR(64) NOT NULL,
    params_json TEXT NOT NULL DEFAULT '{}',
    builtin SMALLINT NOT NULL DEFAULT 1,
    enabled SMALLINT NOT NULL DEFAULT 1,
    sort INTEGER NOT NULL DEFAULT 0,
    created_at BIGINT
);

CREATE TABLE IF NOT EXISTS export_registry (
    id SERIAL PRIMARY KEY,
    sha256 VARCHAR(64) NOT NULL,
    md5 VARCHAR(64),
    phash VARCHAR(64),
    source_fid VARCHAR(128) NOT NULL,
    variant VARCHAR(64) DEFAULT 'origin',
    file_size BIGINT,
    exported_by VARCHAR(128),
    exported_at BIGINT NOT NULL,
    UNIQUE(sha256)
);
CREATE INDEX IF NOT EXISTS idx_export_reg_md5 ON export_registry(md5);
CREATE INDEX IF NOT EXISTS idx_export_reg_fid ON export_registry(source_fid);

CREATE TABLE IF NOT EXISTS asset_aliases (
    id SERIAL PRIMARY KEY,
    fid VARCHAR(128) NOT NULL,
    item_key VARCHAR(128) NOT NULL,
    client_asset_id VARCHAR(128),
    file_name TEXT,
    size BIGINT,
    created_at BIGINT,
    UNIQUE(fid, item_key)
);
CREATE INDEX IF NOT EXISTS idx_asset_aliases_key ON asset_aliases(item_key);
CREATE INDEX IF NOT EXISTS idx_asset_aliases_cid ON asset_aliases(client_asset_id);
CREATE INDEX IF NOT EXISTS idx_asset_aliases_fid ON asset_aliases(fid);

CREATE TABLE IF NOT EXISTS system_error_events (
    id SERIAL PRIMARY KEY,
    fingerprint VARCHAR(64) UNIQUE NOT NULL,
    module VARCHAR(64) NOT NULL,
    error_code VARCHAR(64),
    severity VARCHAR(32) NOT NULL DEFAULT 'error',
    count INTEGER NOT NULL DEFAULT 1,
    first_seen_at BIGINT NOT NULL,
    last_seen_at BIGINT NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'open',
    sample_message TEXT,
    sample_stack TEXT,
    entity_type VARCHAR(64),
    entity_id VARCHAR(128),
    git_commit VARCHAR(64)
);
CREATE INDEX IF NOT EXISTS idx_see_status ON system_error_events(status);
CREATE INDEX IF NOT EXISTS idx_see_last_seen ON system_error_events(last_seen_at DESC);

CREATE TABLE IF NOT EXISTS ai_tasks (
    id VARCHAR(128) PRIMARY KEY,
    task_type VARCHAR(64) NOT NULL,
    status VARCHAR(32) NOT NULL DEFAULT 'pending',
    result_json TEXT,
    created_at BIGINT
);

CREATE TABLE IF NOT EXISTS asset_blacklist (
    id SERIAL PRIMARY KEY,
    fid VARCHAR(128),
    reason TEXT,
    created_at BIGINT
);

CREATE TABLE IF NOT EXISTS asset_trash (
    fid VARCHAR(128) PRIMARY KEY,
    deleted_at BIGINT NOT NULL,
    meta_json TEXT
);

CREATE TABLE IF NOT EXISTS phash_blacklist (
    phash VARCHAR(64) PRIMARY KEY,
    reason TEXT,
    created_at BIGINT
);

CREATE TABLE IF NOT EXISTS product_presets (
    id VARCHAR(128) PRIMARY KEY,
    name VARCHAR(128) NOT NULL,
    data_json TEXT
);

CREATE TABLE IF NOT EXISTS color_schemes (
    id VARCHAR(128) PRIMARY KEY,
    name VARCHAR(128) NOT NULL,
    colors_json TEXT
);

CREATE TABLE IF NOT EXISTS prompt_snippets (
    id VARCHAR(128) PRIMARY KEY,
    title VARCHAR(128),
    snippet TEXT
);

CREATE TABLE IF NOT EXISTS prompt_templates (
    id VARCHAR(128) PRIMARY KEY,
    title VARCHAR(128),
    template TEXT
);

CREATE TABLE IF NOT EXISTS retag_jobs (
    id VARCHAR(128) PRIMARY KEY,
    status VARCHAR(32),
    created_at BIGINT
);

CREATE TABLE IF NOT EXISTS similarity_ignored_pairs (
    id SERIAL PRIMARY KEY,
    fid_a VARCHAR(128) NOT NULL,
    fid_b VARCHAR(128) NOT NULL,
    created_at BIGINT
);

CREATE TABLE IF NOT EXISTS snapshot_devices (
    id VARCHAR(128) PRIMARY KEY,
    name VARCHAR(128),
    meta_json TEXT
);

CREATE TABLE IF NOT EXISTS snapshot_items (
    id VARCHAR(128) PRIMARY KEY,
    snapshot_id VARCHAR(128),
    data_json TEXT
);

CREATE TABLE IF NOT EXISTS studio_presets (
    id VARCHAR(128) PRIMARY KEY,
    name VARCHAR(128),
    data_json TEXT
);

CREATE TABLE IF NOT EXISTS sync_events (
    id SERIAL PRIMARY KEY,
    event_type VARCHAR(64),
    payload_json TEXT,
    created_at BIGINT
);
