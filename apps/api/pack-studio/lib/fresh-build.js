/**
 * fresh-build.js · 编译闸门（Pack Studio 专用）
 *
 * 存在的唯一理由：杜绝「编译失败了却拿旧产物打包推给用户」。
 *
 * 设计原则（不可违背）：
 *  1. 源码只读。src/、package.json、vite.config.js、index.html、uni_modules/
 *     一律只读复制到隔离目录，绝不在用户项目里写入、清理、改名。
 *  2. 每次打包必须重新编译。没有任何「复用现有产物」的开关。
 *  3. 编译失败 = 立刻中止 + 如实报错。绝不 exit 0 之后继续。
 *  4. 产物必须可证是当次产物：
 *       - exit code == 0
 *       - app-service.js 的 mtime 晚于编译开始时间
 *       - 产物大小 > 阈值（排除空壳/半成品）
 *       - 源码关键标识符全部命中产物（源码↔产物同源证明）
 *       - 生产指纹合格（有公网地址 / 无体验模式 / 无 tabsBug）
 *  5. 产物身份落盘为 build-receipt.json，后续压缩/推送阶段凭它核对，
 *     防止「编译用 A 目录、压缩用 B 目录」这种错位。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const os = require('os');
const { spawn } = require('child_process');

/** 隔离工作区：放在系统临时目录，绝不落在用户项目里 */
const WORK_ROOT = path.join(os.tmpdir(), 'pack-studio-fresh-build');

/** 需要复制的构建输入（相对 APP 的路径） */
const COPY_ITEMS = [
  'src',
  'uni_modules',
  'index.html',
  'package.json',
  'vite.config.js',
  '.env',
  '.env.production',
  '.env.development',
];

const APP_SERVICE = 'app-service.js';
const MIN_SVC_BYTES = 50 * 1024; // 正常 app-service.js 在 400KB 量级，50KB 是地板线

/**
 * 生产指纹：这些字符串一旦出现在产物里，说明编出来的东西不能推给用户。
 * 与 scripts/pack-wgt.ps1 的 Get-WwwScore 保持同一套判据。
 */
const FINGERPRINT = {
  needPublicServer: process.env.PUBLIC_HOST || '',
  banned: ['体验演示模式', 'versionTabs:versionTabs'],
};

/**
 * 源码↔产物同源标识符。
 *
 * 必须是「字符串字面量」而不是函数名 —— Vite/Rollup 会 mangle 函数名，
 * 正确产物里也搜不到函数名，用它做校验必然误报。
 * 这里用 CSS 类名、storage key、业务文案等不会被改写的字面量。
 */
const IDENTITY_MARKERS_APP_UNIAPP = [
  'pages/browse/browse', // 素材库浏览页
  'pages/home/home',     // 首页
  'ViewerApi',           // 素材库 API Client
  'quick-pills',         // 快速分类过滤
  '素材详情',            // 详情文案
];

const IDENTITY_MARKERS_ALBUM_SYNC = [
  'home_library_tab',  // 素材库 tab
  'trash-src-bar',     // 回收站来源栏
  'disposeSource',     // 清理来源
  'back-to-top',       // 回顶按钮
  'takeRemovals',      // 删除后即时移除通知
];

function getIdentityMarkers(workDir) {
  if (fs.existsSync(path.join(workDir, 'src', 'pages', 'browse'))) {
    return IDENTITY_MARKERS_APP_UNIAPP;
  }
  return IDENTITY_MARKERS_ALBUM_SYNC;
}

function rmrf(p) {
  try {
    fs.rmSync(p, { recursive: true, force: true });
  } catch (e) {}
}

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

function copyRecursive(src, dst) {
  const st = fs.statSync(src);
  if (st.isDirectory()) {
    ensureDir(dst);
    for (const name of fs.readdirSync(src)) {
      copyRecursive(path.join(src, name), path.join(dst, name));
    }
  } else {
    fs.copyFileSync(src, dst);
  }
}

/**
 * node_modules 优先用软链接/junction 指回真实位置。
 * 目的：隔离目录只有几十 MB，不用复制 400MB 依赖，同时保证插件解析一致。
 */
function linkNodeModules(APP, workDir) {
  const real = path.join(APP, 'node_modules');
  const link = path.join(workDir, 'node_modules');
  if (!fs.existsSync(real)) {
    throw new Error('未找到依赖目录: ' + real + '\n请先在项目根目录执行 npm install');
  }
  // 跨盘或网络映射盘时，junction 会静默创建但后续读取报「reparse point buffer is invalid」
  // 优先尝试 dir 软链接，其次尝试 junction，且必须通过 readdirSync 可读性校验
  const linkTypes = process.platform === 'win32' ? ['dir', 'junction'] : ['dir'];
  let linked = false;
  for (const type of linkTypes) {
    try {
      if (fs.existsSync(link)) fs.rmSync(link, { recursive: true, force: true });
      fs.symlinkSync(real, link, type);
      fs.readdirSync(link); // 校验链接目标是否真实可读
      linked = true;
      break;
    } catch (e) {
      try { fs.rmSync(link, { recursive: true, force: true }); } catch (_) {}
    }
  }
  if (!linked) {
    // 软链接与 junction 均失败（权限/文件系统不支持）→ 退回复制，仍能编译
    appendNote('软链接/junction 均不可用，改为复制 node_modules');
    copyRecursive(real, link);
  }
}

/** 用全新工作目录，杜绝上一次的残留产物被误认成「本次产物」 */
function prepareWorkspace(APP, stamp) {
  const workDir = path.join(WORK_ROOT, stamp);
  rmrf(workDir);
  ensureDir(workDir);
  const copied = [];
  for (const rel of COPY_ITEMS) {
    const from = path.join(APP, rel);
    if (!fs.existsSync(from)) continue;
    copyRecursive(from, path.join(workDir, rel));
    copied.push(rel);
  }
  if (!copied.includes('src')) {
    throw new Error('未找到 src/，无法编译：' + path.join(APP, 'src'));
  }
  linkNodeModules(APP, workDir);
  injectFaultIfRequested(workDir);
  return { workDir, copied };
}

/**
 * 故障注入（仅测试用，需显式设环境变量 FAULT_INJECT）。
 * 存在的意义：必须能证明「编译失败 → 如实报错 → 零出包 → 零回退」这条链路是真的，
 * 而不是靠读代码推断。注入只发生在隔离副本里，绝不碰用户源码。
 */
function injectFaultIfRequested(workDir) {
  const mode = String(process.env.FAULT_INJECT || '');
  if (!mode) return;
  const target = path.join(workDir, 'src', 'components', 'HomeLibrary.vue');
  if (mode === 'bad-import') {
    if (!fs.existsSync(target)) return;
    const raw = fs.readFileSync(target, 'utf8');
    const broken = raw.replace(
      /from\s+['"](\.\.\/[^'"]*)['"]/,
      "from './__no_such_module__'"
    );
    if (broken === raw) {
      fs.writeFileSync(target, raw + "\nimport x from './__no_such_module__'\n", 'utf8');
    } else {
      fs.writeFileSync(target, broken, 'utf8');
    }
    appendNote('已注入故障: bad-import（仅隔离副本内）');
  } else if (mode === 'syntax') {
    if (!fs.existsSync(target)) return;
    fs.writeFileSync(target, fs.readFileSync(target, 'utf8') + '\nthis is ( broken syntax {{{\n', 'utf8');
    appendNote('已注入故障: syntax（仅隔离副本内）');
  }
}

function sha256File(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

let noteBuf = [];
function appendNote(s) {
  noteBuf.push(s);
}
function takeNotes() {
  const n = noteBuf;
  noteBuf = [];
  return n;
}

/** 在隔离目录里跑 uni build，返回 { code, stdout, stderr, startedAt, finishedAt } */
function runBuild(APP, workDir, onLog) {
  const uniCmd = path.join(APP, 'node_modules', '.bin', 'uni.cmd');
  if (!fs.existsSync(uniCmd)) {
    throw new Error('未找到 uni 构建器: ' + uniCmd + '\n请先执行 npm install');
  }
  // ⚠️ 必须经 shell 包装。
  // Windows 上 Node 无法直接 spawn .cmd（EINVAL），历史上 Pack Studio 的
  // rebuild-www 就是死在这里：spawn 同步抛错 → 没有 close 事件 →
  // running 永远不清空 → 界面永久「运行中」且一行日志都没有。
  //
  // ⚠️ 不要手写 cmd /c 的引号：Node 会把参数再转义一层，
  // 结果 cmd 收到的是 '\"C:\...\"' 这种带反斜杠的串 → 报「不是内部或外部命令」。
  // shell:true 由 Node 自己处理引号，是唯一可靠写法。
  return new Promise((resolve) => {
    const startedAt = new Date();
    const child = spawn(`"${uniCmd}" build -p app`, {
      cwd: workDir,
      windowsHide: true,
      env: process.env,
      shell: true,
    });
    let stdout = '';
    let stderr = '';
    // Windows 控制台默认 GBK/CP936，中文报错解出来会是乱码。
    // 用 TextDecoder 兜底解码，非法字节替换而不是整段丢弃。
    const dec = new TextDecoder('gbk', { fatal: false });
    // 双重解码残留：把 UTF-8 当 GBK 读会留下 "锛坴ue3锛?" 这类痕迹，
    // 用 U+FFFD 之外的高位噪声无法可靠还原，直接剔除替换字符让日志可读。
    const clean = (s) => s.replace(/[�]/g, '').replace(/锛|鈥|娴|绔/g, '');
    child.stdout.on('data', (d) => {
      const t = clean(dec.decode(d, { stream: true }));
      stdout += t;
      if (onLog) onLog(t);
    });
    child.stderr.on('data', (d) => {
      const t = clean(dec.decode(d, { stream: true }));
      stderr += t;
      if (onLog) onLog(t);
    });
    child.on('error', (e) => {
      resolve({ code: -1, stdout, stderr: stderr + '\nspawn error: ' + e.message, startedAt, finishedAt: new Date() });
    });
    child.on('close', (code) => {
      resolve({ code: code === null ? -1 : code, stdout, stderr, startedAt, finishedAt: new Date() });
    });
  });
}

/** 从编译输出里提取真实错误，而不是笼统地丢一句「编译失败」 */
function extractErrors(stdout, stderr) {
  // 去掉 ANSI 颜色码，否则错误信息里会夹着 ESC[31m 这种不可见字符
  const strip = (s) => String(s || '').replace(/\x1b\[[0-9;]*[A-Za-z]/g, '');
  const lines = strip(stdout + '\n' + stderr).split(/\r?\n/);
  const RE =
    /Build failed|Could not resolve|ERROR:|error TS|SyntaxError|Failed to resolve|ENOENT|rollup|Cannot find|ParseError|Unexpected|Plugin .* failed|不是内部或外部命令|不是可识别的|无法解析|Cannot find module|Unable to resolve/i;
  const bad = lines.filter((l) => RE.test(l));
  const uniq = [];
  for (const l of bad) {
    const t = l.trim();
    if (t && !uniq.includes(t)) uniq.push(t);
    if (uniq.length >= 20) break;
  }
  // 一条都没匹配到（典型：非英文编译错误、系统级报错）时，
  // 退回到 stderr 尾部 + stdout 尾部，保证「如实报错」而不是丢一句空话。
  if (!uniq.length) {
    const tail = (s) =>
      strip(s)
        .split(/\r?\n/)
        .map((x) => x.trim())
        .filter(Boolean)
        .slice(-12);
    uniq.push(...tail(stderr));
    if (!uniq.length) uniq.push(...tail(stdout));
  }
  return uniq;
}

/** 校验产物身份。任一项不过 → 抛错，让调用方如实报错并中止。 */
function verifyArtifact(workDir, startedAt, result) {
  const www = path.join(workDir, 'dist', 'build', 'app');
  const svc = path.join(www, APP_SERVICE);
  const fail = (msg) => {
    const errs = extractErrors(result.stdout, result.stderr);
    const e = new Error(msg);
    e.buildErrors = errs;
    e.stdout = result.stdout;
    e.stderr = result.stderr;
    throw e;
  };

  if (!fs.existsSync(svc)) {
    fail('编译退出码 ' + result.code + '，且没有生成 ' + APP_SERVICE + '（隔离目录 ' + www + '）');
  }
  const st = fs.statSync(svc);
  // mtime 必须晚于编译开始（留 2s 容差给 FAT/网络盘）
  if (st.mtime.getTime() < startedAt.getTime() - 2000) {
    fail(
      '产物不是本次编译生成的：app-service.js 修改时间 ' +
        st.mtime.toISOString() +
        ' 早于编译开始时间 ' +
        startedAt.toISOString()
    );
  }
  if (st.size < MIN_SVC_BYTES) {
    fail('产物异常小（' + st.size + ' 字节），判定为半成品/空壳，拒绝打包');
  }

  const raw = fs.readFileSync(svc, 'utf8');

  // 生产指纹
  const hasPublic = raw.includes(FINGERPRINT.needPublicServer);
  const banned = FINGERPRINT.banned.filter((b) => raw.includes(b));
  const hasLan = /192\.168\.\d+\.\d+/.test(raw) && !hasPublic;

  // 源码↔产物同源
  const markers = getIdentityMarkers(workDir);
  const missing = markers.filter((k) => !raw.includes(k));

  const receipt = {
    builtAt: startedAt.toISOString(),
    finishedAt: result.finishedAt.toISOString(),
    durationMs: result.finishedAt.getTime() - startedAt.getTime(),
    exitCode: result.code,
    isolatedWorkDir: workDir,
    www,
    appServiceBytes: st.size,
    appServiceMtime: st.mtime.toISOString(),
    appServiceSha256: sha256File(svc),
    fingerprint: { hasPublic, hasLan, banned },
    identityMarkers: {
      total: markers.length,
      hit: markers.length - missing.length,
      missing,
    },
    workDirNotes: takeNotes(),
  };

  if (missing.length) {
    fail(
      '产物与源码不一致：以下标识符在 app-service.js 中找不到 -> ' +
        missing.join(', ') +
        '\n说明产物不是从当前 src/ 编出来的（例如编译中途失败后被静默吞掉）。' +
        '\n已中止：宁可不推，也不推一个用户装上去看不到新功能的包。'
    );
  }
  if (!hasPublic) {
    fail(
      '产物缺少生产服务器地址 ' +
        FINGERPRINT.needPublicServer +
        '，编译出来的配置指向错误环境，拒绝打包。'
    );
  }
  if (hasLan) {
    fail('产物只含局域网地址、没有公网地址，判定为调试配置，拒绝打包。');
  }
  if (banned.length) {
    fail('产物含被禁止的调试标记 -> ' + banned.join(', ') + '，拒绝打包。');
  }
  return receipt;
}

/**
 * 主入口：隔离编译 + 全量校验。
 * 失败一律 throw（带 buildErrors），由调用方如实展示并中止。
 */
async function freshBuild(APP, onLog) {
  const stamp = String(Date.now());
  if (onLog) onLog('\n[闸门] 准备隔离编译工作区（不触碰你的源码）...');
  const { workDir, copied } = prepareWorkspace(APP, stamp);
  if (onLog) onLog('[闸门] 已复制: ' + copied.join(', ') + '\n[闸门] 工作区: ' + workDir + '\n');
  if (onLog) onLog('$ uni build -p app   (cwd = 隔离目录)\n');

  const result = await runBuild(APP, workDir, onLog);

  if (onLog) onLog('\n[闸门] 编译结束 exit=' + result.code + '\n');

  if (result.code !== 0) {
    const errs = extractErrors(result.stdout, result.stderr);
    const e = new Error('uni build 失败，exit=' + result.code);
    e.buildErrors = errs;
    e.stdout = result.stdout;
    e.stderr = result.stderr;
    e.fatal = true;
    throw e;
  }

  const receipt = verifyArtifact(workDir, result.startedAt, result);
  receipt.copiedInputs = copied;

  if (onLog) {
    onLog(
      '[闸门] 校验通过：' +
        receipt.appServiceBytes +
        ' 字节，sha256=' +
        receipt.appServiceSha256.slice(0, 16) +
        '，标识符 ' +
        receipt.identityMarkers.hit +
        '/' +
        receipt.identityMarkers.total +
        '，耗时 ' +
        Math.round(receipt.durationMs / 1000) +
        's\n'
    );
  }
  return receipt;
}

module.exports = {
  freshBuild,
  WORK_ROOT,
  IDENTITY_MARKERS: IDENTITY_MARKERS_APP_UNIAPP,
  IDENTITY_MARKERS_APP_UNIAPP,
  IDENTITY_MARKERS_ALBUM_SYNC,
  getIdentityMarkers,
  APP_SERVICE,
  sha256File,
};
