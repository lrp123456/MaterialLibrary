/**
 * 对话播放与缓存：芯片不改写正文、视频进行中不重复入队、
 * 已有上游任务号只重新排队、临时文件 3 天清扫、moov 位置。
 */
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { chipSubmitText, paintChipFinalTag } from '../src/prompt-chip-text.mjs';

const require = createRequire(import.meta.url);
const Database = require('better-sqlite3');
const { idempotencyKeyFor, enqueueGenJob, recoverStaleGenJobs } = require('../src/gen-jobs');
const { sweepLocalTemp, MAX_AGE_MS } = require('../src/temp-sweeper');
const { moovIsEarly } = require('../src/umbra');

function ok(name) { console.log('✅ ' + name); }

function openDb() {
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
      progress INTEGER,
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
  `);
  return db;
}

const db = openDb();
const base = {
  userId: 1,
  sessionId: 's1',
  prompt: '关上柜门',
  model: 'wan',
  modality: 'video',
  params: { ratio: '9:16' },
};

assert.strictEqual(chipSubmitText('@图1[tb_image_share_x.png（原图）]'), '@图1');
assert.strictEqual(chipSubmitText('@图1[沙发]'), '@图1[沙发]');
assert.strictEqual(chipSubmitText('@图2 <bbox>1,2,3,4</bbox>'), '@图2 <bbox>1,2,3,4</bbox>');
assert.strictEqual(paintChipFinalTag('@图1[tb_image_share_x.png（原图）]', '@图2'), '@图2');
assert.strictEqual(paintChipFinalTag('@图1[沙发]', '@图2'), '@图2[沙发]');
assert.strictEqual(paintChipFinalTag('@图1[沙发] <bbox>0,0,1,1</bbox>', '@图3'), '@图3[沙发] <bbox>0,0,1,1</bbox>');
ok('芯片不把文件名拼回提示词，选区名和 bbox 保留');

const a = enqueueGenJob(db, { ...base, clientRequestId: 'a' });
const b = enqueueGenJob(db, { ...base, clientRequestId: 'b', prompt: '另一句' });
assert.strictEqual(a.created, true);
assert.strictEqual(b.locked, true);
assert.strictEqual(b.jobId, a.jobId);
assert.strictEqual(db.prepare('SELECT COUNT(*) AS n FROM gen_jobs').get().n, 1);
ok('同一会话已有视频任务时拒绝再入队');

db.prepare("UPDATE gen_jobs SET status='succeeded' WHERE job_id=?").run(a.jobId);
const again = enqueueGenJob(db, { ...base, clientRequestId: 'c' });
assert.strictEqual(again.created, true);
assert.notStrictEqual(again.jobId, a.jobId);
ok('已结束的同键可以重新生成');

const k1 = idempotencyKeyFor({ ...base, modality: 'image', clientRequestId: 'x' });
const k2 = idempotencyKeyFor({ ...base, modality: 'image', clientRequestId: 'y' });
assert.strictEqual(k1, k2);
ok('幂等键不含随机 clientRequestId');

const img1 = enqueueGenJob(db, { ...base, modality: 'image', prompt: '图A', clientRequestId: '1' });
const img2 = enqueueGenJob(db, { ...base, modality: 'image', prompt: '图A', clientRequestId: '2' });
const img3 = enqueueGenJob(db, { ...base, modality: 'image', prompt: '图B', clientRequestId: '3' });
assert.strictEqual(img2.created, false);
assert.strictEqual(img2.jobId, img1.jobId);
assert.strictEqual(img2.locked, undefined);
assert.strictEqual(img3.created, true);
ok('图片同文案进行中并成一条，不同文案仍可入队');

const now = Date.now();
db.prepare(`
  UPDATE gen_jobs
  SET status='running', started_at=?, attempt=1, modality='video', payload_json=?
  WHERE job_id=?
`).run(now - 20 * 60 * 1000, JSON.stringify({ vendorTaskId: 'task_keep', prompt: '关上柜门' }), again.jobId);
const recovered = recoverStaleGenJobs(db, { now, staleMs: 15 * 60 * 1000, maxAttempts: 3 });
const resumed = db.prepare('SELECT status, attempt, payload_json FROM gen_jobs WHERE job_id=?').get(again.jobId);
assert.strictEqual(resumed.status, 'queued');
assert.strictEqual(resumed.attempt, 1);
assert.strictEqual(JSON.parse(resumed.payload_json).vendorTaskId, 'task_keep');
assert.strictEqual(recovered.resumed, 1);
ok('已有上游任务号的视频重启后只重新排队，不增加尝试次数');

assert.strictEqual(MAX_AGE_MS, 3 * 24 * 60 * 60 * 1000);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-temp-'));
const root = path.join(dir, 'cache', 'temp');
fs.mkdirSync(root, { recursive: true });
const oldFile = path.join(root, 'old.mp4');
const oldRefFile = path.join(root, 'old_ref.mp4');
const youngFile = path.join(root, 'young.mp4');
fs.writeFileSync(oldFile, 'old');
fs.writeFileSync(`${oldFile}.poster.jpg`, 'poster');
fs.writeFileSync(oldRefFile, 'old_ref');
fs.writeFileSync(`${oldRefFile}.poster.jpg`, 'poster');
fs.writeFileSync(youngFile, 'young');
const oldTime = new Date(Date.now() - 4 * 24 * 60 * 60 * 1000);
fs.utimesSync(oldFile, oldTime, oldTime);
fs.utimesSync(oldRefFile, oldTime, oldTime);

// 在 chat_messages 中引用 old_ref.mp4
db.prepare(`
  INSERT INTO chat_messages (id, session_id, user_id, role, mode, prompt, params_json, images_json, status, run_id, engine, result_json, created_at, updated_at)
  VALUES ('m_test', 's_test', 1, 'assistant', 'text_to_video', 'test', '{}', '[]', 'done', 'r_test', 'wan', ?, 1, 1)
`).run(JSON.stringify({ videoUrl: '/api/cache/temp/old_ref.mp4' }));

const swept = sweepLocalTemp({ dataDir: dir }, db);
assert.strictEqual(fs.existsSync(oldFile), false);
assert.strictEqual(fs.existsSync(`${oldFile}.poster.jpg`), false);
assert.strictEqual(fs.existsSync(oldRefFile), true);
assert.strictEqual(fs.existsSync(`${oldRefFile}.poster.jpg`), true);
assert.strictEqual(fs.existsSync(youngFile), true);
assert.strictEqual(swept.deleted, 1);
assert.strictEqual(swept.skipped, 1);
ok('超过 3 天且未被引用的临时文件会被清理，被会话引用的文件保留');

const late = path.join(root, 'late.mp4');
const lateBuf = Buffer.alloc(300 * 1024, 0);
lateBuf.write('mdat', 0);
lateBuf.write('moov', 280 * 1024);
fs.writeFileSync(late, lateBuf);
assert.strictEqual(moovIsEarly(late), false);
const early = path.join(root, 'early.mp4');
const earlyBuf = Buffer.alloc(64, 0);
earlyBuf.write('moov', 8);
fs.writeFileSync(early, earlyBuf);
assert.strictEqual(moovIsEarly(early), true);
ok('moov 在文件头才算可以立刻出画面');

db.close();
fs.rmSync(dir, { recursive: true, force: true });
