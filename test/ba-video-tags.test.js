/**
 * Ba 拉取与视频成片标签。不连真接口，不打 VLM。
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const assert = require('assert');

const testDir = path.join(os.tmpdir(), 'dsh_ba_video_' + Date.now());
fs.mkdirSync(testDir, { recursive: true });
process.env.ML_DATA_DIR = testDir;

const { openDb } = require('../src/db');
const db = openDb(testDir);
const services = {
  db,
  config: { dataDir: testDir },
  logger: { info() {}, warn() {}, error() {} },
};

const videoTags = require('../src/video-tags');
const ba = require('../src/ba-resource');
const { registerGenerated } = require('../src/shelf-lineage');

function ok(name) { console.log('✅ ' + name); }

(async () => {
  const voted = videoTags.voteSceneTags([
    { space: 'living_room', style_main: ['modern_minimal', 'other'] },
    { space: 'living_room', style_main: ['natural_wood'] },
    { space: 'bedroom', style_main: ['modern_minimal'] },
    { space: 'living_room', style_main: [] },
  ]);
  assert.strictEqual(voted.space, 'living_room');
  assert.deepStrictEqual(voted.style_main, ['modern_minimal', 'natural_wood']);
  const tie = videoTags.voteSceneTags([
    { space: 'living_room', style_main: ['french'] },
    { space: 'bedroom', style_main: ['french'] },
  ]);
  assert.strictEqual(tie.space, 'other');
  assert.strictEqual(videoTags.purposeFromText('一段客厅空间漫游'), 'walkthrough');
  assert.strictEqual(videoTags.purposeFromText('品牌片字幕'), 'ad');
  assert.strictEqual(videoTags.purposeFromText(''), '');
  assert.deepStrictEqual(videoTags.sceneDimsForCategory('furniture'), ['space', 'style_atom', 'material_kind']);
  assert.deepStrictEqual(videoTags.sceneDimsForCategory('interior'), ['space', 'style_atom']);
  assert.deepStrictEqual(videoTags.sceneDimsForCategory('portrait'), []);
  ok('画面投票与用途词');

  const purposeDir = videoTags.applyVideoPurpose(db, 'asset_v', 'walkthrough', 'job');
  assert.strictEqual(purposeDir, 'walkthrough');
  assert.strictEqual(videoTags.applyVideoPurpose(db, 'asset_v', 'ad', 'ai'), null);
  const kept = db.prepare(`
    SELECT t.dir, at.source FROM asset_tags at
    JOIN tag_dict t ON t.id = at.tag_id
    WHERE at.asset_fid='asset_v' AND t.dimension='video_purpose'
  `).get();
  assert.strictEqual(kept.dir, 'walkthrough');
  assert.strictEqual(kept.source, 'job');
  ok('任务写上的用途不被模型覆盖');

  const now = Date.now();
  db.prepare(`INSERT INTO assets (fid, kind, category, file_name, status, created_at, updated_at) VALUES ('parent_img', 'image', 'interior', 'room.jpg', 'ready', ?, ?)`).run(now, now);
  const space = db.prepare(`SELECT id FROM tag_dict WHERE dimension='space' AND dir='living_room'`).get();
  db.prepare(`INSERT INTO asset_tags (asset_fid, tag_id, role, source, confidence, updated_at) VALUES ('parent_img', ?, '', 'ai', 0.9, ?)`).run(space.id, now);
  const tempDir = path.join(testDir, 'cache', 'temp');
  fs.mkdirSync(tempDir, { recursive: true });
  fs.writeFileSync(path.join(tempDir, 'clip.mp4'), Buffer.from('not-a-real-mp4'));
  const filed = await registerGenerated(services, {
    previewUrl: '/api/cache/temp/clip.mp4',
    parentFid: 'parent_img',
    prompt: '客厅空间漫游',
    mode: 'video',
  });
  assert.ok(filed.fid);
  const inherited = db.prepare(`
    SELECT at.source FROM asset_tags at
    JOIN tag_dict t ON t.id = at.tag_id
    WHERE at.asset_fid=? AND t.dimension='space' AND t.dir='living_room'
  `).get(filed.fid);
  assert.strictEqual(inherited.source, 'inherited');
  const purpose = db.prepare(`
    SELECT t.dir, at.source FROM asset_tags at
    JOIN tag_dict t ON t.id = at.tag_id
    WHERE at.asset_fid=? AND t.dimension='video_purpose'
  `).get(filed.fid);
  assert.strictEqual(purpose.dir, 'walkthrough');
  assert.strictEqual(purpose.source, 'job');
  ok('有父图的成片继承画面并记下用途');

  assert.throws(() => ba.assertHttpUrl('file:///tmp/a.jpg'), /http/);
  ba.resetTokenCache();
  process.env.BA_RESOURCE_BASE = 'http://ba.test';
  process.env.BA_RESOURCE_USER = 'u';
  process.env.BA_RESOURCE_PASSWORD = 'p';
  await assert.rejects(
    () => ba.pullBaResources(services, {
      keyword: '椅子',
      type: 'all',
      fetchImpl: async () => ({ ok: true, json: async () => ({ code: 500, msg: '验证码错误' }) }),
    }),
    (err) => err.code === 'captcha'
  );
  ok('验证码时停止');

  ba.resetTokenCache();
  const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
  let downloads = 0;
  const fetchImpl = async (url, opts = {}) => {
    const target = String(url);
    if (target.endsWith('/login')) {
      return { ok: true, status: 200, json: async () => ({ code: 200, token: 'tok' }) };
    }
    if (target.includes('/resource/v1/search')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          code: 200,
          data: {
            records: [
              { id: 7, context: '一把椅子', type: 'image', url: 'http://ba.test/a.jpg', info: '{}', createTime: '2026-10-23 12:00:00' },
              { id: 8, context: '坏链', type: 'image', url: 'http://ba.test/missing.jpg', info: '', createTime: '' },
            ],
            total: 2,
            pages: 1,
            current: 1,
            size: 20,
          },
        }),
      };
    }
    downloads += 1;
    if (target.endsWith('/missing.jpg')) {
      return { ok: false, status: 404, headers: { get: () => '0' }, json: async () => ({}) };
    }
    return {
      ok: true,
      status: 200,
      headers: { get: () => String(jpeg.length) },
      arrayBuffer: async () => jpeg.buffer.slice(jpeg.byteOffset, jpeg.byteOffset + jpeg.byteLength),
    };
  };
  const seen = [];
  const first = await ba.pullBaResources(services, {
    keyword: '椅子',
    type: 'image',
    fetchImpl,
    ingestFile: async (_services, item) => {
      seen.push(item.remoteId);
      db.prepare(`INSERT INTO assets (fid, kind, status, source, source_note, created_at, updated_at) VALUES (?, 'image', 'ready', 'ba', ?, ?, ?)`).run('ba_file', item.context, Date.now(), Date.now());
      return { fid: 'ba_file', deduped: false };
    },
  });
  assert.strictEqual(first.filed, 1);
  assert.strictEqual(first.failed, 1);
  assert.deepStrictEqual(seen, ['7']);
  assert.strictEqual(downloads, 2);
  const again = await ba.pullBaResources(services, {
    keyword: '椅子',
    type: 'image',
    fetchImpl,
    ingestFile: async () => { throw new Error('不应再次下载已入库的记录'); },
  });
  assert.strictEqual(again.skipped, 1);
  assert.strictEqual(again.failed, 1);
  const note = db.prepare(`SELECT source_note FROM assets WHERE fid='ba_file'`).get();
  assert.strictEqual(note.source_note, '一把椅子');
  ok('按关键词拉取，失败不挡住下一条，同一远端 id 不重复入库');

  const videoFiled = await ba.fileIntoLibrary(services, {
    buffer: Buffer.from('not-a-real-mp4-ba'),
    fileName: 'room.mp4',
    remoteId: 'vid-1',
    context: '客厅漫游参考',
    kind: 'video',
  });
  const videoRow = db.prepare(`
    SELECT kind, category, is_ai, source, source_note, status, library_shelf
    FROM assets WHERE fid=?
  `).get(videoFiled.fid);
  assert.strictEqual(videoRow.kind, 'video');
  assert.strictEqual(videoRow.category, 'video');
  assert.strictEqual(videoRow.is_ai, 0);
  assert.strictEqual(videoRow.source, 'ba');
  assert.strictEqual(videoRow.source_note, '客厅漫游参考');
  assert.strictEqual(videoRow.status, 'discovered');
  assert.strictEqual(videoRow.library_shelf, 'original');
  ok('Ba 视频进素材库，记为实拍来源');

  console.log('ba-video-tags 通过');
})().catch((err) => {
  console.error(err);
  process.exit(1);
});
