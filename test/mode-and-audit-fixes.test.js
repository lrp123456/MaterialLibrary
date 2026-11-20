'use strict';

const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

const { cancelGenJob, enqueueGenJob, getGenJob } = require('../src/gen-jobs');
const { sweepLocalTemp } = require('../src/temp-sweeper');
const modelProtocol = require('../web-pro/src/utils/model-protocol');
const { resolveDefaultMode, resolveVideoGenMode } = modelProtocol;

function createTestDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE gen_jobs (
      job_id TEXT PRIMARY KEY,
      user_id INTEGER,
      session_id TEXT,
      modality TEXT,
      model TEXT,
      payload_json TEXT,
      status TEXT,
      progress REAL DEFAULT 0,
      stage TEXT,
      result_json TEXT,
      error_json TEXT,
      attempt INTEGER DEFAULT 0,
      idempotency_key TEXT UNIQUE,
      created_at INTEGER,
      updated_at INTEGER,
      started_at INTEGER,
      completed_at INTEGER
    );
    CREATE TABLE chat_messages (
      id TEXT PRIMARY KEY,
      session_id TEXT,
      user_id INTEGER,
      role TEXT,
      mode TEXT,
      prompt TEXT,
      params_json TEXT,
      images_json TEXT,
      status TEXT,
      run_id TEXT,
      engine TEXT,
      result_json TEXT,
      created_at INTEGER,
      updated_at INTEGER
    );
    CREATE TABLE assets (
      fid TEXT PRIMARY KEY,
      kind TEXT,
      category TEXT,
      file_name TEXT,
      size INTEGER,
      width INTEGER,
      height INTEGER,
      orientation TEXT,
      origin_orientation TEXT,
      duration_s REAL,
      status TEXT,
      source TEXT,
      sha256 TEXT,
      client_asset_id TEXT,
      thumb_url TEXT,
      auth_state TEXT,
      auth_matched_at INTEGER,
      created_at INTEGER,
      discovered_at INTEGER,
      updated_at INTEGER,
      library_shelf TEXT,
      is_ai INTEGER,
      source_asset_id TEXT,
      parent_fid TEXT,
      lineage_json TEXT,
      preview_sha256 TEXT,
      preview_md5 TEXT,
      thumb_sha256 TEXT,
      thumb_md5 TEXT
    );
    CREATE TABLE derivatives (
      id TEXT PRIMARY KEY,
      asset_fid TEXT,
      kind TEXT,
      sha256 TEXT,
      md5 TEXT,
      width INTEGER,
      height INTEGER,
      size INTEGER,
      path TEXT,
      created_at INTEGER
    );
    CREATE TABLE blacklist (
      id TEXT PRIMARY KEY,
      kind TEXT,
      value TEXT,
      reason TEXT,
      created_at INTEGER
    );
  `);
  return db;
}

test('1. cancelGenJob 并发防护：已完成/已失败/已取消任务不可被改写', () => {
  const db = createTestDb();
  const now = Date.now();
  db.prepare(`
    INSERT INTO gen_jobs (job_id, user_id, session_id, modality, model, status, created_at, updated_at)
    VALUES ('job_succeeded', 1, 's1', 'video', 'wan3.0-video', 'succeeded', ?, ?)
  `).run(now, now);

  const res = cancelGenJob(db, 'job_succeeded', 1);
  assert.strictEqual(res.success, false);
  assert.strictEqual(res.status, 'succeeded');
  assert.strictEqual(getGenJob(db, 'job_succeeded').status, 'succeeded');
});

test('2. 占位消息入队 ON CONFLICT 不得将已取消或已完成的消息改回 generating', () => {
  const db = createTestDb();
  const now = Date.now();
  db.prepare(`
    INSERT INTO chat_messages (id, session_id, user_id, role, mode, prompt, status, created_at, updated_at)
    VALUES ('genmsg_job_1', 's1', 1, 'assistant', 'text_to_video', '已取消', 'cancelled', ?, ?)
  `).run(now, now);

  db.prepare(`
    INSERT INTO chat_messages (
      id, session_id, user_id, role, mode, prompt, params_json, images_json,
      status, run_id, engine, result_json, created_at, updated_at
    ) VALUES ('genmsg_job_1', 's1', 1, 'assistant', 'text_to_video', '正在渲染...', '{}', '[]', 'generating', 'job_1', 'wan3.0-video', '{}', ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      status='generating',
      result_json=excluded.result_json,
      updated_at=excluded.updated_at
    WHERE chat_messages.status NOT IN ('cancelled', 'succeeded', 'failed')
  `).run(now, now);

  const row = db.prepare('SELECT status, prompt FROM chat_messages WHERE id=?').get('genmsg_job_1');
  assert.strictEqual(row.status, 'cancelled', '已取消的消息不得被重新写回 generating');
});

test('3. temp-sweeper: 引用查询抛错时跳过文件而不删除', () => {
  const tempDir = path.join(__dirname, 'temp_sweep_test_' + Date.now());
  const cacheTemp = path.join(tempDir, 'cache', 'temp');
  fs.mkdirSync(cacheTemp, { recursive: true });

  const staleFile = path.join(cacheTemp, 'output_stale.mp4');
  fs.writeFileSync(staleFile, 'test');
  const past = (Date.now() - 4 * 24 * 60 * 60 * 1000) / 1000;
  fs.utimesSync(staleFile, past, past);

  // 构造一个查询抛错的 stmt
  const brokenDb = {
    prepare: () => ({
      get: () => {
        throw new Error('Disk I/O error or SQLite busy');
      }
    })
  };

  const res = sweepLocalTemp({ dataDir: tempDir }, brokenDb);
  assert.strictEqual(res.deleted, 0);
  assert.strictEqual(res.skipped, 1);
  assert.strictEqual(fs.existsSync(staleFile), true, '抛错时必须保护文件，禁止删除');

  try { fs.rmSync(tempDir, { recursive: true, force: true }); } catch (_) {}
});

test('4. resolveDefaultMode 与 resolveVideoGenMode 模式规范测试', () => {
  const wanSchema = {
    id: 'wan3_0_video',
    modality: 'video',
    modes: [
      { id: 'text_to_video', label: '文生视频' },
      { id: 'omni_reference', label: '全能参考' },
      { id: 'image_to_video', label: '图生视频' },
      { id: 'first_last_frame', label: '首尾帧' }
    ]
  };

  // 0 图 0 视频 -> 文生视频
  const defWan0 = resolveDefaultMode({ schema: wanSchema, modality: 'video', refCounts: { images: 0, videos: 0 } });
  assert.strictEqual(defWan0.id, 'text_to_video');
  assert.strictEqual(defWan0.label, '文生视频');

  // 1 图 -> 全能参考 (不管是几张图统一全能参考)
  const defWan1 = resolveDefaultMode({ schema: wanSchema, modality: 'video', refCounts: { images: 1, videos: 0 } });
  assert.strictEqual(defWan1.id, 'omni_reference');
  assert.strictEqual(defWan1.label, '全能参考');

  // 2 图 -> 全能参考
  const defWan2 = resolveDefaultMode({ schema: wanSchema, modality: 'video', refCounts: { images: 2, videos: 0 } });
  assert.strictEqual(defWan2.id, 'omni_reference');

  // 0 图 1 参考视频 -> 全能参考
  const defWanVid = resolveDefaultMode({ schema: wanSchema, modality: 'video', refCounts: { images: 0, videos: 1 } });
  assert.strictEqual(defWanVid.id, 'omni_reference');

  // 模型没有全能参考时（如 Agnes Video）
  const agnesSchema = {
    id: 'agnes_video',
    modality: 'video',
    modes: [
      { id: 'text_to_video', label: '文生视频' },
      { id: 'image_to_video', label: '参考' },
      { id: 'first_last_frame', label: '首尾帧' }
    ]
  };
  const defAgnes = resolveDefaultMode({ schema: agnesSchema, modality: 'video', refCounts: { images: 1, videos: 0 } });
  assert.strictEqual(defAgnes.id, 'image_to_video');
  assert.strictEqual(defAgnes.label, '参考');

  // 生图模型：有图统一图生图，无图文生图
  const imageSchema = {
    id: 'agnes_image',
    modality: 'image',
    modes: [
      { id: 'text_to_image', label: '文生图' },
      { id: 'image_to_image', label: '图生图' },
      { id: 'image_edit', label: '交互编辑' }
    ]
  };
  const defImg0 = resolveDefaultMode({ schema: imageSchema, modality: 'image', refCounts: { images: 0 } });
  assert.strictEqual(defImg0.id, 'text_to_image');
  const defImg1 = resolveDefaultMode({ schema: imageSchema, modality: 'image', refCounts: { images: 1 } });
  assert.strictEqual(defImg1.id, 'image_to_image');
  const defImg3 = resolveDefaultMode({ schema: imageSchema, modality: 'image', refCounts: { images: 3 } });
  assert.strictEqual(defImg3.id, 'image_to_image');
});
