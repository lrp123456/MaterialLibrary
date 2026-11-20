/**
 * Phase 5 门禁测试 3：流式导出、子进程树强杀与 NAS 冷热归档
 * 验证目标：
 *  1. 验证子进程树强杀 (PGID / taskkill)：父子多级进程在取消时干净退出，无僵尸残留；
 *  2. 验证 Demucs 与 Scene-Split runner 在 apps/worker/runners/ 下对 Redis VRAM 显存锁的争抢与释放；
 *  3. 验证 7 天 LRU 归档策略：将超期资产迁移至 NAS 目录并在 DB 标记 storage_tier='cold'。
 */
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { runProcessAsync, killProcessTree } = require('../../src/lib/async-proc');
const runVocalSeparate = require('../../../worker/runners/vocal-separate');
const runSceneSplit = require('../../../worker/runners/scene-split');
const { executeLruArchive } = require('../../../worker/src/queues/nas-archive');

test('【Gate 3.1】多级子进程树整树强杀与僵尸进程防御', async () => {
  // 启动一个长时间运行的子进程
  const isWin = process.platform === 'win32';
  const bin = isWin ? 'powershell.exe' : 'sh';
  const args = isWin
    ? ['-Command', 'Start-Sleep -Seconds 60']
    : ['-c', 'sleep 60'];

  const child = spawn(bin, args, {
    detached: !isWin,
    windowsHide: true,
    stdio: 'ignore',
  });

  const pid = child.pid;
  assert.ok(pid > 0, '子进程必须成功启动');

  // 等待进程稳定运行
  await new Promise((r) => setTimeout(r, 50));

  // 执行整树强杀
  killProcessTree(child, !isWin);

  // 等待退出
  await new Promise((r) => setTimeout(r, 200));

  let isAlive = false;
  try {
    // 信号 0 探测进程是否存在
    process.kill(pid, 0);
    isAlive = true;
  } catch (e) {
    isAlive = false;
  }

  assert.strictEqual(isAlive, false, `进程 ${pid} 在强杀后必须完全退出，严禁留下僵尸进程`);
});

test('【Gate 3.2】AI Runner (Demucs/Scene-Split) 显存排他锁生命周期管理', async () => {
  // 模拟内存 Redis 锁客户端
  const redisStore = new Map();
  const mockRedis = {
    set: async (key, val, ex, ttl, nx) => {
      if (nx && redisStore.has(key)) return null;
      redisStore.set(key, val);
      return 'OK';
    },
    get: async (key) => redisStore.get(key) || null,
    del: async (key) => redisStore.delete(key),
  };

  const tmpDir = path.join(os.tmpdir(), `mls_test_runner_${Date.now()}`);
  fs.mkdirSync(tmpDir, { recursive: true });
  const fakeAudio = path.join(tmpDir, 'test.wav');
  fs.writeFileSync(fakeAudio, Buffer.alloc(512, 0x11));

  try {
    // 1. 运行人声分离
    const vocalRes = await runVocalSeparate({
      inputPath: fakeAudio,
      workDir: tmpDir,
      outputDir: tmpDir,
      job: { id: 'job_vocal_test_1' },
      redis: mockRedis,
    });

    assert.ok(vocalRes.outputPath, '必须返回产物路径');
    assert.strictEqual(await mockRedis.get('mls:lock:gpu:vram'), null, '运行结束后显存锁必须自动释放');

    // 2. 模拟显存锁已被他人独占时的防并发拒绝
    await mockRedis.set('mls:lock:gpu:vram', 'other_job', 'EX', 300, 'NX');
    let rejected = false;
    try {
      await runSceneSplit({
        inputPath: fakeAudio,
        workDir: tmpDir,
        outputDir: tmpDir,
        job: { id: 'job_scene_test_2' },
        redis: mockRedis,
      });
    } catch (err) {
      rejected = true;
      assert.ok(err.message.includes('GPU 显存繁忙中'), '并发时必须被拒绝并提示显存独占');
    }
    assert.strictEqual(rejected, true, '显存冲突时必须主动阻断');

    // 释放他人锁
    await mockRedis.del('mls:lock:gpu:vram');
  } finally {
    try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch (_) {}
  }
});

test('【Gate 3.3】7 天 LRU NAS 冷热分层归档与热点数据保留验证', async () => {
  const tmpRoot = path.join(os.tmpdir(), `mls_nas_test_${Date.now()}`);
  const localDir = path.join(tmpRoot, 'local');
  const nasDir = path.join(tmpRoot, 'nas');
  fs.mkdirSync(localDir, { recursive: true });
  fs.mkdirSync(nasDir, { recursive: true });

  const oldTime = Date.now() - 10 * 86400 * 1000; // 10 天前
  const newTime = Date.now() - 2 * 86400 * 1000; // 2 天前

  // 1. 超期普通资产（应被归档）
  const oldPath = path.join(localDir, 'old_large_file.mp4');
  fs.writeFileSync(oldPath, Buffer.alloc(1024, 0x99));

  // 2. 新资产（不应被归档）
  const newPath = path.join(localDir, 'new_active_file.jpg');
  fs.writeFileSync(newPath, Buffer.alloc(256, 0x55));

  // 3. creation-library/ 保护资产（即使超期也不得归档）
  const tplDir = path.join(localDir, 'creation-library', 'tpl_888');
  fs.mkdirSync(tplDir, { recursive: true });
  const tplPath = path.join(tplDir, 'template_cover.jpg');
  fs.writeFileSync(tplPath, Buffer.alloc(512, 0x77));

  const assetRecords = [
    { fid: 'fid_old_1', file_name: 'old_large_file.mp4', file_path: oldPath, size: 1024, created_at: oldTime, storage_tier: 'hot', nas_path: null },
    { fid: 'fid_new_1', file_name: 'new_active_file.jpg', file_path: newPath, size: 256, created_at: newTime, storage_tier: 'hot', nas_path: null },
    { fid: 'fid_tpl_1', file_name: 'template_cover.jpg', file_path: tplPath, size: 512, created_at: oldTime, storage_tier: 'hot', nas_path: null },
  ];

  // 内存轻量 DB 模拟
  const mockDb = {
    prepare: (sql) => {
      if (sql.includes('SELECT')) {
        return {
          all: (cutoff) => {
            return assetRecords.filter((r) => {
              const norm = r.file_path.replace(/\\/g, '/');
              return r.created_at < cutoff && !norm.includes('creation-library/');
            });
          },
        };
      }
      if (sql.includes('UPDATE')) {
        return {
          run: (targetNasPath, updatedTime, fid) => {
            const item = assetRecords.find((r) => r.fid === fid);
            if (item) {
              item.storage_tier = 'cold';
              item.nas_path = targetNasPath;
            }
          },
        };
      }
      return { all: () => [], run: () => {} };
    },
  };

  // 执行 7 天 LRU 归档
  const archiveResult = await executeLruArchive(mockDb, { nasRoot: nasDir });
  assert.strictEqual(archiveResult.archivedCount, 1, '只有超期普通资产被归档');

  // 验证 DB 标记与物理文件
  const oldRow = assetRecords.find((r) => r.fid === 'fid_old_1');
  assert.strictEqual(oldRow.storage_tier, 'cold');
  assert.ok(oldRow.nas_path && oldRow.nas_path.includes(nasDir));
  assert.ok(fs.existsSync(oldRow.nas_path), 'NAS 目录下必须存在归档文件');

  const newRow = assetRecords.find((r) => r.fid === 'fid_new_1');
  assert.strictEqual(newRow.storage_tier, 'hot');

  const tplRow = assetRecords.find((r) => r.fid === 'fid_tpl_1');
  assert.strictEqual(tplRow.storage_tier, 'hot', 'creation-library 模版必须保留在热盘');

  try { fs.rmSync(tmpRoot, { recursive: true, force: true }); } catch (_) {}
});
