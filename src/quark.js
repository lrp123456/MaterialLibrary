/**
 * 夸克网盘官方 Skill CLI 封装。
 * CLI 为无状态命令行（NDJSON stdout），授权按系统用户机器级共享（refreshToken 自动续期）。
 * 错误码：-102/-103/-1408 未授权/过期；-603 目录不存在等。
 */
const { spawn } = require('child_process');
const fs = require('fs');
const path = require('path');
const os = require('os');

const SESSION_ID = `dsh-ml-${process.pid}`;

function resolveQuarkCli(configured) {
  if (configured && fs.existsSync(configured)) return configured;
  const candidates = [
    path.join(os.homedir(), '.agents/skills/quarkclouddrive/scripts/quark-drive.cjs'),
    path.join(os.homedir(), '.claude/skills/quarkclouddrive/scripts/quark-drive.cjs')
  ];
  return candidates.find(p => fs.existsSync(p)) || '';
}

function runCli(cliPath, args, { timeoutMs = 120000 } = {}) {
  return new Promise((resolve, reject) => {
    if (!cliPath) return reject(new Error('quarkCliPath 未配置且未探测到 CLI'));
    const nodeExe = process.execPath || 'node';
    const child = spawn(nodeExe, [cliPath, ...args], {
      stdio: ['ignore', 'pipe', 'pipe'],
      // 夸克 CLI 在无 Agent 环境时会报 -104「无法识别当前 Agent 环境，禁止继续使用」。
      // 机器上已用 OpenClaw 完成网盘授权（~/.agents/skills/quarkclouddrive/openclaw/config.json），
      // 这里固定注入 OpenClaw 环境标记，使服务端进程与授权配置对齐。
      env: {
        ...process.env,
        OPENCLAW_CLI: '1',
        OPENCLAW_SERVICE_MARKER: 'openclaw',
        ...(process.env.https_proxy ? {} : { https_proxy: 'http://127.0.0.1:7890' }),
        ...(process.env.http_proxy ? {} : { http_proxy: 'http://127.0.0.1:7890' }),
      }
    });
    let out = '', err = '';
    const timer = setTimeout(() => { child.kill('SIGKILL'); reject(new Error('CLI 超时')); }, timeoutMs);
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { err += d; });
    child.on('close', code => {
      clearTimeout(timer);
      const lines = out.split(/\r?\n/).map(l => l.trim()).filter(Boolean)
        .map(l => { try { return JSON.parse(l); } catch { return null; } })
        .filter(Boolean);
      const result = [...lines].reverse().find(l => l.type === 'result') || lines[lines.length - 1];
      resolve({ code, lines, result, stderr: err.slice(-500) });
    });
    child.on('error', reject);
  });
}

function ok(result) {
  return result && result.code === 0;
}

// 全局 SingleFlight 与限流队列，防止并发拉取击穿网盘和子进程风暴
const inFlightDownloads = new Map();
const downloadQueue = [];
let activeDownloads = 0;
const MAX_CONCURRENT_DOWNLOADS = Number(process.env.QUARK_MAX_CONCURRENT_DOWNLOADS) || 1;
let downloadCooldownUntil = 0;

function scheduleNextDownload() {
  if (activeDownloads >= MAX_CONCURRENT_DOWNLOADS || downloadQueue.length === 0) return;
  const now = Date.now();
  if (now < downloadCooldownUntil) {
    setTimeout(scheduleNextDownload, downloadCooldownUntil - now + 50);
    return;
  }
  const task = downloadQueue.shift();
  if (!task) return;
  activeDownloads++;
  task.run()
    .finally(() => {
      activeDownloads--;
      scheduleNextDownload();
    });
}

function queueDownload(fn) {
  return new Promise((resolve, reject) => {
    downloadQueue.push({
      run: async () => {
        try {
          const res = await fn();
          resolve(res);
        } catch (err) {
          // 若触发超时或速率限制，设置 5 秒冷静期
          if (err.message && (err.message.includes('timeout') || err.message.includes('429') || err.message.includes('频次限制'))) {
            downloadCooldownUntil = Date.now() + 5000;
          }
          reject(err);
        }
      }
    });
    scheduleNextDownload();
  });
}

class Quark {
  constructor(cliPath) {
    this.cliPath = cliPath || resolveQuarkCli();
  }

  async search({ searchType = 'mix', size = 100, keyword = '', parentFid, filterCategory, stdoutOnly = true } = {}) {
    // CLI 1.0.19：--category 已废弃，改用 --search-type；--size 为单页大小(1-100)，内部自动分页。
    const pageSize = Math.min(Math.max(1, Number(size) || 100), 100);
    const args = ['search', '--search-type', String(searchType), '--size', String(pageSize)];
    if (keyword) args.push('--keyword', keyword);
    if (parentFid) args.push('--parent-fid', parentFid);
    if (stdoutOnly) args.push('--stdout-only');
    const r = await runCli(this.cliPath, args, { timeoutMs: 180000 });
    if (!ok(r.result)) throw new Error(`search 失败: ${r.result?.msg || r.stderr}`);
    const data = r.result.data || {};
    const artifact = r.lines.find(l => l.type === 'artifact');
    let fileList = data.file_list || [];
    let artifactPath = artifact?.data?.file_path || data.file_path || null;
    let artifactCount = artifact?.data?.count || 0;

    // 新 CLI 无图片/视频专用 search-type，需在结果侧按 category 过滤。
    // sync 等调用方优先读 artifact 全量文件，因此过滤后要落盘一份。
    if (filterCategory != null) {
      const want = String(filterCategory);
      const match = f => String(f.category) === want;
      fileList = fileList.filter(match);
      if (artifactPath && fs.existsSync(artifactPath)) {
        try {
          const rows = fs.readFileSync(artifactPath, 'utf8').split(/\r?\n/)
            .map(l => l.trim()).filter(Boolean)
            .map(l => { try { return JSON.parse(l); } catch { return null; } })
            .filter(Boolean)
            .filter(match);
          const filteredPath = artifactPath.replace(/(\.jsonl)?$/, '.filtered.jsonl');
          fs.writeFileSync(filteredPath, rows.map(x => JSON.stringify(x)).join('\n') + (rows.length ? '\n' : ''), 'utf8');
          artifactPath = filteredPath;
          artifactCount = rows.length;
          fileList = rows.slice(0, 5);
        } catch { /* artifact 不可读时保留原路径，由调用方决定 */ }
      }
    }

    return {
      total: data.total || 0,
      fileList,
      artifactPath,
      artifactCount,
      filterCategory: filterCategory ?? null
    };
  }

  // 旧 CLI category=3 图片 / 1 视频；新 CLI 无对应 search-type，用 mix 全量后按返回 category 字段过滤。
  searchImages(opts) { return this.search({ ...opts, searchType: opts?.searchType || 'mix', filterCategory: 3 }); }
  searchVideos(opts) { return this.search({ ...opts, searchType: opts?.searchType || 'video', filterCategory: 1 }); }

  async download(fid, outputDir) {
    const flightKey = `${fid}:${path.resolve(outputDir)}`;
    if (inFlightDownloads.has(flightKey)) {
      return inFlightDownloads.get(flightKey);
    }

    const downloadPromise = queueDownload(async () => {
      const r = await runCli(this.cliPath,
        ['download', '--fid', fid, '--output-dir', outputDir, '--overwrite'], { timeoutMs: 300000 });
      if (!ok(r.result)) throw new Error(`download 失败: ${r.result?.msg || r.stderr}`);
      return r.result.data;
    }).finally(() => {
      inFlightDownloads.delete(flightKey);
    });

    inFlightDownloads.set(flightKey, downloadPromise);
    return downloadPromise;
  }

  async upload(filePath, parentFid) {
    const args = ['upload', filePath];
    if (parentFid) args.push('--parent-fid', parentFid);
    const r = await runCli(this.cliPath, args, { timeoutMs: 600000 });
    if (!ok(r.result)) throw new Error(`upload 失败: ${r.result?.msg || r.stderr}`);
    return r.result.data;
  }

  async createFolder(dirPath, parentFid) {
    const args = ['create-folder', '--dir-path', dirPath];
    if (parentFid) args.push('--parent-fid', parentFid);
    const r = await runCli(this.cliPath, args);
    if (!ok(r.result)) throw new Error(`create-folder 失败: ${r.result?.msg || r.stderr}`);
    return r.result.data;
  }

  async getUserInfo() {
    const r = await runCli(this.cliPath, ['get-user-info']);
    if (!ok(r.result)) return { authorized: false, msg: r.result?.msg || '未授权' };
    const d = r.result.data || {};
    return {
      authorized: true,
      nickname: d.userInfo?.nickname,
      vipType: d.vipInfo?.vipType,
      used: d.vipInfo?.used,
      capacity: d.vipInfo?.capacity,
      expiresIn: d.vipInfo?.expiresIn
    };
  }

  async loginToken(code) {
    const r = await runCli(this.cliPath, ['login', '--token', code]);
    return { success: ok(r.result), msg: r.result?.msg, data: r.result?.data };
  }
}

module.exports = { Quark, runCli, resolveQuarkCli };
