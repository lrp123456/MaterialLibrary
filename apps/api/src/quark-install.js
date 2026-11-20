/**
 * 夸克 Skill 一键安装：下载 zip → 备份替换 CLI → login --token。
 * 失败回滚；保留 openclaw/claudecode 授权配置目录。
 */
const fs = require('fs');
const path = require('path');
const os = require('os');
const { spawn } = require('child_process');
const { pipeline } = require('stream/promises');
const { Readable } = require('stream');

const CODE_RE = /^CAC-[A-Za-z0-9_-]{8,128}$/;
const SKILL_TARGETS = [
  path.join(os.homedir(), '.agents/skills/quarkclouddrive'),
  path.join(os.homedir(), '.claude/skills/quarkclouddrive'),
];

function log(...a) { console.log('[quark-install]', ...a); }

function runNode(args, { timeoutMs = 120000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn('node', args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        PATH: [path.join(os.homedir(), '.local/node/bin'), process.env.PATH].filter(Boolean).join(':'),
        OPENCLAW_CLI: '1',
        OPENCLAW_SERVICE_MARKER: 'openclaw',
      },
    });
    let out = '', err = '';
    const t = setTimeout(() => { try { child.kill('SIGKILL'); } catch {} }, timeoutMs);
    child.stdout.on('data', d => { out += d; });
    child.stderr.on('data', d => { err += d; });
    child.on('close', (code) => {
      clearTimeout(t);
      const lines = out.split(/\r?\n/).map(s => s.trim()).filter(Boolean)
        .map(l => { try { return JSON.parse(l); } catch { return null; } })
        .filter(Boolean);
      const result = [...lines].reverse().find(l => l.type === 'result') || lines[lines.length - 1] || null;
      resolve({ code, result, stdout: out.slice(-2000), stderr: err.slice(-500) });
    });
    child.on('error', (e) => { clearTimeout(t); resolve({ code: -1, result: null, stderr: String(e.message || e) }); });
  });
}

async function downloadZip(url, dest) {
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) throw new Error(`下载失败 HTTP ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (!buf.length) throw new Error('下载内容为空');
  if (buf.length > 80 * 1024 * 1024) throw new Error('zip 过大（>80MB）');
  fs.writeFileSync(dest, buf);
  return dest;
}

async function extractZip(zipPath, destDir) {
  fs.rmSync(destDir, { recursive: true, force: true });
  fs.mkdirSync(destDir, { recursive: true });
  await new Promise((resolve, reject) => {
    const child = spawn('unzip', ['-qo', zipPath, '-d', destDir], { stdio: ['ignore', 'pipe', 'pipe'] });
    let err = '';
    child.stderr.on('data', d => { err += d; });
    child.on('close', c => (c === 0 ? resolve() : reject(new Error('解压失败: ' + err.slice(0, 300)))));
    child.on('error', reject);
  });
  // zip 根可能是 package/ 或直接内容
  let root = destDir;
  const nested = path.join(destDir, 'package');
  if (fs.existsSync(path.join(nested, 'scripts/quark-drive.cjs'))) root = nested;
  else if (!fs.existsSync(path.join(destDir, 'scripts/quark-drive.cjs'))) {
    const kids = fs.readdirSync(destDir, { withFileTypes: true }).filter(d => d.isDirectory());
    for (const k of kids) {
      const p = path.join(destDir, k.name);
      if (fs.existsSync(path.join(p, 'scripts/quark-drive.cjs'))) { root = p; break; }
    }
  }
  if (!fs.existsSync(path.join(root, 'scripts/quark-drive.cjs'))) {
    throw new Error('zip 内未找到 scripts/quark-drive.cjs');
  }
  return root;
}

function readVersion(skillRoot) {
  try {
    const sk = fs.readFileSync(path.join(skillRoot, 'SKILL.md'), 'utf8');
    const m = sk.match(/^version:\s*(\S+)/m);
    return m ? m[1] : '';
  } catch { return ''; }
}

function backupSkill(dest) {
  const bak = dest + '.bak-' + Date.now();
  if (fs.existsSync(dest)) {
    fs.cpSync(dest, bak, { recursive: true });
  }
  return bak;
}

function restoreSkill(dest, bak) {
  try {
    if (bak && fs.existsSync(bak)) {
      fs.rmSync(dest, { recursive: true, force: true });
      fs.cpSync(bak, dest, { recursive: true });
    }
  } catch (e) { log('restore failed', e.message); }
}

function installIntoSkill(dest, extractedRoot) {
  fs.mkdirSync(dest, { recursive: true });
  for (const rel of ['scripts', 'references']) {
    const src = path.join(extractedRoot, rel);
    const dst = path.join(dest, rel);
    if (!fs.existsSync(src)) continue;
    fs.rmSync(dst, { recursive: true, force: true });
    fs.cpSync(src, dst, { recursive: true });
  }
  const sk = path.join(extractedRoot, 'SKILL.md');
  if (fs.existsSync(sk)) fs.copyFileSync(sk, path.join(dest, 'SKILL.md'));
  // chmod +x scripts
  try {
    const scripts = path.join(dest, 'scripts');
    for (const f of fs.readdirSync(scripts)) {
      const p = path.join(scripts, f);
      try { fs.chmodSync(p, 0o755); } catch {}
    }
  } catch {}
}

/**
 * @param {{url:string, code:string, cliPath?:string}} input
 */
async function installQuarkSkill({ url, code, cliPath }) {
  if (!url || !/^https?:\/\//i.test(url)) {
    return { success: false, error: 'url 必须是 http(s) 地址' };
  }
  if (!code || !CODE_RE.test(String(code).trim())) {
    return { success: false, error: 'code 必须是 CAC- 开头的授权码' };
  }
  const token = String(code).trim();
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'qk-inst-'));
  const zipPath = path.join(tmp, 'skill.zip');
  const extractDir = path.join(tmp, 'extracted');
  const backups = [];
  try {
    log('download', url);
    await downloadZip(url, zipPath);
    const root = await extractZip(zipPath, extractDir);
    const version = readVersion(root);
    log('extracted version', version);

    const targets = fs.existsSync(cliPath)
      ? [path.dirname(path.dirname(cliPath))]
      : SKILL_TARGETS;

    for (const dest of targets) {
      backups.push({ dest, bak: backupSkill(dest) });
      installIntoSkill(dest, root);
      log('installed', dest);
    }

    const primaryCli = path.join(targets[0], 'scripts/quark-drive.cjs');
    const login = await runNode([primaryCli, 'login', '--token', token], { timeoutMs: 90000 });
    log('login', login.code, login.result && login.result.code, login.result && login.result.msg);
    const ok = login.result && login.result.code === 0;
    if (!ok) {
      for (const b of backups) restoreSkill(b.dest, b.bak);
      const msg = (login.result && login.result.msg) || login.stderr || 'login 失败';
      return { success: false, error: '授权失败已回滚: ' + msg };
    }

    const info = await runNode([primaryCli, 'get-user-info'], { timeoutMs: 60000 });
    const data = info.result && info.result.data || {};
    // cleanup backups
    for (const b of backups) {
      try { fs.rmSync(b.bak, { recursive: true, force: true }); } catch {}
    }
    return {
      success: true,
      version,
      cliPath: primaryCli,
      authorized: !!(info.result && info.result.code === 0),
      nickname: data.userInfo && data.userInfo.nickname || '',
      vipType: data.vipInfo && data.vipInfo.vipType || '',
      loginMsg: login.result && login.result.msg || '',
    };
  } catch (e) {
    for (const b of backups) restoreSkill(b.dest, b.bak);
    return { success: false, error: e.message || String(e) };
  } finally {
    try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
  }
}

module.exports = { installQuarkSkill };
