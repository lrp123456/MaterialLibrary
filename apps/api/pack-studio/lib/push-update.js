/**
 * push-update.js · WGT/APK 推送（Pack Studio 内置，Node 原生实现）
 *
 * 为什么不再用 scripts/push-update.ps1：
 *   2026-10-03 真实故障。ps1 用 `Get-Content $side -Raw | ConvertFrom-Json`
 *   读 sidecar。sidecar 是无 BOM 的 UTF-8，而 Windows PowerShell 5.1 的
 *   Get-Content 默认按系统 ANSI（简体中文=GBK/CP936）解码：
 *
 *     "修复热更新安装：wgt 持久化+安装前校验"
 *       ↓ GBK 误读
 *     "淇鐑洿鏂板畨瑁咃細wgt 鎸佷箙鍖� 瀹夎鍓嶆牎楠�"
 *                                              ↑ 尾字节被当成双字节的 trail
 *
 *   某个汉字的第 2 字节被 GBK 当成双字节字符的 trail byte 吃掉，
 *   连带吞掉紧随其后的引号 → JSON 字符串提前断裂 →
 *   ConvertFrom-Json 报「传入的对象无效，应为 ":" 或 "}"。(368)」→ exit 1。
 *
 *   后果非常隐蔽：编译成功、出包成功、同源校验通过，只有最后一步推送挂掉，
 *   界面上只看到一行 `[exit 1] 推送`，而服务器上还是旧包。
 *
 * 这里用 Node 原生 http/fs 实现登录 + 上传：
 *   - 全部走 UTF-8，中文 note 不会再被解码坏
 *   - 不依赖 Add-Type / ZipFile（曾被安全策略拦截）
 *   - 失败一律 reject，不吞错
 */
const fs = require('fs');
const path = require('path');
const http = require('http');
const https = require('https');
const zlib = require('zlib');
const { URL } = require('url');

/* ── 极简 zip 读取：只要能列出条目并取出 app-service.js / manifest.json ── */

function readZipEntries(buf) {
  // 从尾部找 EOCD
  let eocd = -1;
  for (let i = buf.length - 22; i >= 0 && i >= buf.length - 22 - 65535; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  }
  if (eocd < 0) throw new Error('不是合法的 zip/wgt：找不到 EOCD');
  const count = buf.readUInt16LE(eocd + 10);
  let off = buf.readUInt32LE(eocd + 16);
  const out = new Map();
  for (let n = 0; n < count; n++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) throw new Error('中央目录损坏（第 ' + n + ' 项）');
    const method = buf.readUInt16LE(off + 10);
    const compSize = buf.readUInt32LE(off + 20);
    const nameLen = buf.readUInt16LE(off + 28);
    const extraLen = buf.readUInt16LE(off + 30);
    const commentLen = buf.readUInt16LE(off + 32);
    const localOff = buf.readUInt32LE(off + 42);
    const name = buf.slice(off + 46, off + 46 + nameLen).toString('utf8');
    out.set(name, { method, compSize, localOff });
    off += 46 + nameLen + extraLen + commentLen;
  }
  out.__buf = buf;
  return out;
}

function readZipFile(entries, name) {
  const e = entries.get(name);
  if (!e) return null;
  const buf = entries.__buf;
  const lo = e.localOff;
  if (buf.readUInt32LE(lo) !== 0x04034b50) throw new Error('本地文件头损坏: ' + name);
  const nameLen = buf.readUInt16LE(lo + 26);
  const extraLen = buf.readUInt16LE(lo + 28);
  const start = lo + 30 + nameLen + extraLen;
  const raw = buf.slice(start, start + e.compSize);
  return e.method === 0 ? raw : zlib.inflateRawSync(raw);
}

/* ── HTTP 小工具 ── */

function request(urlStr, opt) {
  // 显式兜底：漏传 opt 时立刻报清楚，而不是在下面报「undefined.method」
  if (!opt || typeof opt !== 'object') {
    return Promise.reject(new Error('request() 缺少 options 参数: ' + urlStr));
  }
  return new Promise((resolve, reject) => {
    const u = new URL(urlStr);
    const mod = u.protocol === 'https:' ? https : http;
    const req = mod.request(
      urlStr,
      { method: opt.method || 'GET', headers: opt.headers || {}, timeout: opt.timeout || 60000 },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const body = Buffer.concat(chunks);
          let json = null;
          try { json = JSON.parse(body.toString('utf8')); } catch {}
          resolve({ status: res.statusCode, headers: res.headers, body, json });
        });
      }
    );
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(new Error('请求超时 ' + urlStr)); });
    if (opt.body) req.write(opt.body);
    req.end();
  });
}

function jdump(o) { return JSON.stringify(o, null, 2); }

/* ── 读 sidecar（强制 UTF-8） ── */

function readSidecar(wgtPath) {
  const p = wgtPath + '.json';
  if (!fs.existsSync(p)) return null;
  // 显式 utf8 —— 这正是 ps1 踩坑的地方
  return JSON.parse(fs.readFileSync(p, 'utf8').replace(/^﻿/, ''));
}

/* ── 推送前的本地安全检查（对齐 ps1 里的拦截规则） ── */

function inspectPackage(file) {
  const buf = fs.readFileSync(file);
  const isApk = path.extname(file).toLowerCase() === '.apk';
  if (isApk) return { isApk: true, bytes: buf.length };

  const entries = readZipEntries(buf);
  const svc = readZipFile(entries, 'app-service.js');
  if (!svc) throw new Error('待推送的 WGT 包内缺少 app-service.js，拒绝推送！');
  const text = svc.toString('utf8');
  if (text.includes('versionTabs:versionTabs')) {
    throw new Error("严重拦截：包内检测到致命未定义语法 'versionTabs:versionTabs'，拒绝推送！");
  }
  if (!entries.get('manifest.json')) {
    throw new Error('待推送的 WGT 包内缺少 manifest.json，拒绝推送！');
  }
  let manifest = null;
  try { manifest = JSON.parse(readZipFile(entries, 'manifest.json').toString('utf8')); } catch {}
  return { isApk: false, bytes: buf.length, entryCount: entries.size, appServiceBytes: svc.length, manifest };
}

/* ── 主流程 ── */

/**
 * 推送 wgt/apk 到 MaterialLibraryServer 更新通道。
 * 任何一步失败都 reject（退出码非 0），不吞错、不静默成功。
 *
 * @param {object} opt
 *   file     待推送文件绝对路径（wgt 或 apk）
 *   note     备注（中文安全）
 *   channel  渠道
 *   server   服务器根地址
 *   user/pass 管理员账号
 *   force    是否强制更新
 *   onLog    日志回调
 */
async function pushUpdate(opt) {
  const onLog = opt.onLog || (() => {});
  // 推送目标只走显式入参或环境变量（pack-studio 启动时加载根 .env），代码里不落任何默认主机。
  let server = String(opt.server || '').trim();
  if (!server) {
    server = String(process.env.PACK_SERVER || process.env.PUBLIC_BASE_URL || '').trim();
  }
  server = server.replace(/\/+$/, '');
  const releaseMode = String(opt.releaseMode || (opt.channel === 'canary' ? 'canary' : 'full')).toLowerCase();
  const channel = String(opt.channel || (releaseMode === 'canary' ? 'canary' : 'internal'));
  const file = opt.file;
  if (!file || !fs.existsSync(file)) throw new Error('待推送文件不存在: ' + file);

  const buf = fs.readFileSync(file);
  const fileName = path.basename(file);
  const isApk = path.extname(file).toLowerCase() === '.apk';

  onLog('[推送] ' + file + '\n');
  onLog('[推送] 大小 ' + buf.length + ' 字节\n');

  // 1) 本地完整性检查
  onLog('[1/4] 本地完整性检查...\n');
  const info = inspectPackage(file);
  if (!isApk) {
    onLog('      条目 ' + info.entryCount + '  app-service.js ' + info.appServiceBytes + ' 字节\n');
    onLog('      manifest ' + jdump(info.manifest && info.manifest.version) + '\n');
  }

  // 2) 版本号：sidecar 优先（打包时已定），否则从文件名/项目状态回退
  onLog('[2/4] 解析版本...\n');
  const side = readSidecar(file);
  let versionName = String((side && side.versionName) || opt.versionName || '');
  let versionCode = Number((side && (side.versionCode || side.buildCode)) || 0);
  let wgtVersion = Number((side && (side.wgtVersion || side.buildCode)) || 0);
  let note = String(opt.note || (side && side.note) || (isApk ? '整包更新' : '热更新'));

  if (!versionName) {
    try {
      const mf = JSON.parse(
        fs.readFileSync(path.join(opt.appRoot || '.', 'src', 'manifest.json'), 'utf8').replace(/^﻿/, '')
      );
      versionName = String(mf.versionName || '');
      if (!versionCode) versionCode = Number(mf.versionCode || 0);
    } catch {}
  }
  if (!versionCode || !wgtVersion) {
    const m = fileName.match(/(\d{3,})/);
    const guess = m ? Number(m[1]) : versionCode;
    if (!versionCode) versionCode = guess;
    if (!wgtVersion) wgtVersion = guess;
  }
  // 硬校验：wgt 的 wgtVersion 必须与包内 manifest.code 完全一致，
  // 否则客户端会拿一个对不上的号去比较，永久判定"已是最新"。
  if (!isApk && info.manifest && info.manifest.version) {
    const inner = String(info.manifest.version.code || '');
    if (inner && String(wgtVersion) !== inner) {
      throw new Error(
        'wgtVersion 与包内 manifest.code 不一致，拒绝推送！\n' +
          '  推送将使用 wgtVersion = ' + wgtVersion + '\n' +
          '  包内 manifest.code = ' + inner + '\n' +
          '  客户端会拿这两个号比较，不一致会导致更新永远不生效。'
      );
    }
  }
  if (!versionCode) throw new Error('无法确定 versionCode，拒绝推送（拒绝猜版本号）');
  if (!isApk && !wgtVersion) throw new Error('无法确定 wgtVersion，拒绝推送');
  onLog('      versionName=' + versionName + ' versionCode=' + versionCode +
        ' wgtVersion=' + (isApk ? '-' : wgtVersion) + '\n');
  onLog('      note=' + note + '\n');

  // 3) 登录
  onLog('[3/4] 登录 ' + server + ' ...\n');
  const targetUser = opt.user || process.env.PACK_USER || 'admin';
  // 口令只来自入参或环境变量，绝不硬编码进仓库。
  let targetPass = String(opt.pass || process.env.PACK_PASS || '').trim();
  const login = await request(server + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json; charset=utf-8' },
    body: Buffer.from(JSON.stringify({ username: targetUser, password: targetPass }), 'utf8'),
  });
  if (login.status !== 200 || !login.json) {
    throw new Error('登录失败 HTTP ' + login.status + ': ' + login.body.toString('utf8').slice(0, 300));
  }
  const token = login.json.data && login.json.data.token;
  if (!token) throw new Error('登录响应里没有 token: ' + jdump(login.json).slice(0, 300));
  onLog('      登录成功\n');

  // 4) 上传（raw body + query，字段全部 URI 编码，中文安全）
  onLog('[4/4] 上传 ' + buf.length + ' 字节...\n');
  const qs = new URLSearchParams();
  qs.set('fileName', fileName);
  qs.set('versionCode', String(versionCode));
  qs.set('versionName', versionName);
  qs.set('note', note);
  qs.set('channel', channel);
  qs.set('type', isApk ? 'apk' : 'wgt');
  if (!isApk) qs.set('wgtVersion', String(wgtVersion));
  if (opt.force) qs.set('force', 'true');
  if (releaseMode) qs.set('releaseMode', releaseMode);
  if (opt.targetDevices) {
    const td = Array.isArray(opt.targetDevices) ? opt.targetDevices.join(',') : String(opt.targetDevices);
    if (td.trim()) qs.set('targetDevices', td.trim());
  }
  // 灰度比例：仅白名单留空时有意义（服务端在白名单模式下忽略该参数）。
  // '' / null / undefined 不传，保持旧版服务端与全量发布的旧行为。
  if (opt.rolloutPct !== '' && opt.rolloutPct != null) {
    const n = Number(opt.rolloutPct);
    if (Number.isFinite(n)) qs.set('rolloutPct', String(Math.max(0, Math.min(100, Math.trunc(n)))));
  }

  const upUrl = server + '/api/app/update/upload?' + qs.toString();

  // 推送前先备份线上指针。只要这一步做过，后面任何失败都能把线上恢复到原样 ——
  // 用户的要求：任何情况下都不能破坏已经上线的系统。
  let snapshot = null;
  try {
    snapshot = await snapshotPointer({ server, token, channel, onLog });
  } catch (e) {
    // 读不到指针 = 无法保证可回滚，宁可不推
    throw new Error(
      '推送中止：无法备份线上指针，因此无法在失败时回滚。\n' +
      '  原因: ' + e.message +
      '\n  这条保护是「不能破坏线上系统」的最后一道闸门，不允许绕过。'
    );
  }

  const up = await request(upUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(buf.length),
      Authorization: 'Bearer ' + token,
    },
    body: buf,
    timeout: 180000,
  }).catch(async (e) => {
    // 网络中断等异常：线上指针还没动（服务端要先收完包才改指针），
    // 但仍尝试回滚以防服务端中途已落库。
    const rb = await rollbackPointer({ server, token, channel, snapshot, onLog });
    throw new Error(
      '上传过程异常终止: ' + e.message +
      '\n  回滚: ' + (rb.ok ? '成功，线上仍为 ' + rb.restored : '失败！' + rb.error)
    );
  });
  if (up.status !== 200 || !up.json || up.json.success !== true) {
    const rb = await rollbackPointer({ server, token, channel, snapshot, onLog });
    throw new Error(
      '上传失败 HTTP ' + up.status + ': ' + up.body.toString('utf8').slice(0, 500) +
      '\n  回滚: ' + (rb.ok ? '成功，线上仍为 ' + rb.restored : '失败！' + rb.error)
    );
  }
  onLog('      ' + jdump(up.json) + '\n');

  // 5) 回读校验：以「管理端完整状态」为准。
  // 关键：灰度白名单模式下，客户端接口 /api/app/update 对「不在白名单的请求」
  // 一律回落稳定版（无 deviceId 的探针必然不命中），拿它回读 canary 会把
  // 一次成功的灰度发布误判为失败，还会触发自动回滚、顺手清空白名单
  // （2026-11-04 2050010 真实事故）。/state 返回完整 channels/grayscale，
  // 是管理端核对指针的唯一可靠真值。
  const state = await readAdminState({ server, token });
  const canaryLike = channel === 'canary' || channel === 'beta' || channel === 'gray';
  const gotEntry = pickStateEntry(state, channel);
  const remoteName = gotEntry ? String(gotEntry.url || '').split('/').pop() : '';

  onLog('\n[回读] 服务端当前指针（管理端状态）:\n');
  onLog('      ' + jdump({
    channel,
    wgtVersion: gotEntry && gotEntry.wgtVersion,
    versionName: gotEntry && gotEntry.versionName,
    fileName: remoteName || '(空)',
    grayscaleActive: !!(state.grayscale && state.grayscale.active),
    targetDevices: (state.grayscale && state.grayscale.targetDevices) || [],
  }) + '\n');

  if (remoteName !== fileName) {
    // 指针没切过去 = 用户还在线上包上，但服务端可能已经写进了坏包文件。
    // 立刻回滚指针，别让「上传成功但指针错乱」这种中间态留在生产上。
    const rb = await rollbackPointer({ server, token, channel, snapshot, onLog });
    throw new Error(
      '上传返回成功，但服务端指针不是本次的新包！\n' +
      '  期望: ' + fileName + '\n' +
      '  实际: ' + (remoteName || '(空)') + '\n' +
      '  已尝试回滚到 ' + (snapshot && !snapshot.empty ? snapshot.fileName : '(撤回灰度)') +
      '：' + (rb.ok ? '成功，线上仍是你原来的包' : '失败！' + rb.error) +
      '\n  这说明服务器没有真正切换版本，已按失败处理。'
    );
  }

  // 白名单完整性：本次带了目标设备，服务端灰度白名单必须原样收下
  const expectTargets = Array.isArray(opt.targetDevices)
    ? opt.targetDevices.map((s) => String(s).trim()).filter(Boolean)
    : [];
  const serverTargets = canaryLike
    ? ((state.grayscale && state.grayscale.targetDevices) || []).map((s) => String(s).trim().toLowerCase())
    : [];
  const missingTargets = expectTargets
    .map((s) => s.trim())
    .filter((t) => !serverTargets.includes(t.toLowerCase()));
  if (canaryLike && expectTargets.length && missingTargets.length) {
    const rb = await rollbackPointer({ server, token, channel, snapshot, onLog });
    throw new Error(
      '灰度白名单未落库完整！缺失设备: ' + missingTargets.join(', ') + '\n' +
      '  已尝试回滚：' + (rb.ok ? '成功' : '失败！' + rb.error)
    );
  }

  // 端到端旁证：用首个白名单设备的身份模拟客户端检查，应拿到本次新包。
  // 仅旁证不阻断（管理端状态才是真值），失败只告警。
  if (canaryLike && expectTargets.length) {
    const probeDev = encodeURIComponent(expectTargets[0]);
    const probe = await request(
      server + '/api/app/update?platform=android&versionCode=0&wgtVersion=0&channel=canary&deviceId=' + probeDev,
      { method: 'GET', headers: {}, timeout: 30000 }
    ).catch(() => null);
    const pd = probe && probe.json && (probe.json.data || probe.json);
    const probeName = pd ? String(pd.url || '').split('/').pop() : '';
    if (probeName !== fileName) {
      onLog('      [告警] 白名单设备端到端探测拿到的不是新包（' + (probeName || '空') +
            '），管理端指针正确；请用真机确认。\n');
    }
  }

  return {
    ok: true,
    fileName,
    bytes: buf.length,
    versionName,
    versionCode,
    wgtVersion: isApk ? null : wgtVersion,
    note,
    channel,
    force: !!opt.force,
    server,
    local: info,
    remote: gotEntry,
    uploaded: up.json.data,
    // 留一份推送前快照，便于事后手动回滚（界面上也有回滚按钮）
    snapshot,
  };
}

/**
 * 读取管理端完整状态（含 channels/grayscale/canary）。需要登录会话。
 * 客户端检查接口在灰度白名单模式下会对未命中设备回落稳定版，
 * 不能用来快照/回读灰度指针——那是 2026-11-04 误判事故的根源。
 */
async function readAdminState({ server, token }) {
  const r = await request(server + '/api/app/update/state', {
    method: 'GET',
    headers: { Authorization: 'Bearer ' + token },
    timeout: 30000,
  });
  if (r.status !== 200 || !r.json || r.json.success !== true) {
    throw new Error(
      '读取管理端状态 /api/app/update/state 失败 HTTP ' + r.status +
      '（旧版服务器？灰度推送需要该接口做真值核对）'
    );
  }
  return r.json.data || {};
}

/** 从管理端状态里取指定渠道当前指向的条目 */
function pickStateEntry(state, channel) {
  const canaryLike = channel === 'canary' || channel === 'beta' || channel === 'gray';
  if (canaryLike) {
    return (state.channels && state.channels.canary && state.channels.canary.latest)
      || (state.grayscale && state.grayscale.latest)
      || state.canary
      || null;
  }
  if (channel && state.channels && state.channels[channel] && state.channels[channel].latest) {
    return state.channels[channel].latest;
  }
  return state.latest || null;
}

/**
 * 读取服务端当前渠道指针并落盘，作为回滚基线。
 *
 * 为什么必须有（用户明确要求：任何情况下都不能破坏已上线的系统）：
 *   服务端 publishUpdate 是「写新文件 + 改 latest 指针」。文件会留在磁盘上，
 *   所以推送失败时只要把指针改回去，线上用户就继续用旧包，完全不受影响。
 *   没有快照就无法回滚 —— 只能靠人肉去服务器改 manifest.json。
 *
 * 真值来源是管理端 /api/app/update/state：它给出 channels.canary 与 grayscale
 * （白名单/百分比），客户端检查接口在白名单模式下永远不给未命中设备看灰度包。
 */
async function snapshotPointer({ server, token, channel, onLog }) {
  const canaryLike = channel === 'canary' || channel === 'beta' || channel === 'gray';
  const state = await readAdminState({ server, token });
  const d = pickStateEntry(state, channel);
  const snap = {
    at: new Date().toISOString(),
    server,
    channel,
    fileName: d ? String(d.url || '').split('/').pop() || '' : '',
    url: d ? String(d.url || '') : '',
    versionName: String((d && d.versionName) || ''),
    versionCode: Number((d && d.versionCode) || 0),
    wgtVersion: String(d && d.wgtVersion != null ? d.wgtVersion : ''),
    type: String((d && d.type) || 'wgt'),
    force: Boolean(d && d.force),
    note: String((d && d.note) || ''),
    md5: String((d && d.md5) || ''),
    size: Number((d && d.size) || 0),
  };
  if (canaryLike) {
    // 连同灰度配置一起快照，回滚才能还原白名单，而不是把它清空
    const g = state.grayscale || {};
    snap.gray = {
      active: !!g.active,
      targetDevices: Array.isArray(g.targetDevices) ? g.targetDevices.slice() : [],
      rolloutPct: g.rolloutPct,
    };
  }
  if (!snap.url) {
    snap.empty = true;
    if (onLog) {
      onLog('[推送前快照] 该渠道线上当前无指针（若推送中断将走撤回而非回滚）\n');
    }
    return snap;
  }
  // 落盘，服务端重启/换机器也能找回
  try {
    const dir = path.join(__dirname, '..', 'state', 'push-snapshots');
    fs.mkdirSync(dir, { recursive: true });
    const f = path.join(dir, 'latest-' + channel + '.json');
    fs.writeFileSync(f, JSON.stringify(snap, null, 2), 'utf8');
    snap.file = f;
  } catch (e) {
    snap.file = '(落盘失败: ' + e.message + ')';
  }
  if (onLog) {
    onLog('[推送前快照] ' + jdump({
      fileName: snap.fileName, versionName: snap.versionName,
      wgtVersion: snap.wgtVersion, type: snap.type,
      ...(canaryLike ? { grayscaleActive: snap.gray.active, targetDevices: snap.gray.targetDevices } : {}),
    }) + '\n');
    onLog('             已备份到 ' + snap.file + '\n');
  }
  return snap;
}

function isApkName(n) {
  return /\.apk$/i.test(String(n || ''));
}

/**
 * 把指针改回快照。
 *  - canary 且推送前无指针：调 revoke-canary 撤回（而不是把稳定版塞进 canary，
 *    那会清空白名单、污染灰度配置）；
 *  - canary 有旧指针：连 md5/size/白名单/百分比一起还原；
 *  - 其它渠道：POST /api/app/update 普通发布。
 * 失败不抛 —— 由调用方决定怎么报告，绝不让回滚异常掩盖原始错误。
 */
async function rollbackPointer({ server, token, channel, snapshot, onLog }) {
  const canaryLike = channel === 'canary' || channel === 'beta' || channel === 'gray';
  if (!snapshot || snapshot.empty || !snapshot.url) {
    if (canaryLike) {
      try {
        const r = await request(server + '/api/app/update/revoke-canary', {
          method: 'POST',
          headers: { Authorization: 'Bearer ' + token },
          timeout: 30000,
        });
        if (r.status !== 200) return { ok: false, error: 'revoke-canary HTTP ' + r.status };
        if (onLog) onLog('[回滚] 推送前灰度不存在，已撤回本次灰度\n');
        return { ok: true, restored: '(灰度已撤回)' };
      } catch (e) {
        return { ok: false, error: 'revoke-canary: ' + e.message };
      }
    }
    if (onLog) onLog('[回滚] 线上原本为空，无需回滚历史包\n');
    return { ok: true, restored: '(线上原本为空)' };
  }
  try {
    // 服务端路由是 POST /app/update，参数走 **body**（api.js parseBody），
    // 不是 query —— 之前误写成 /app/update/publish?xxx 会被 404。
    const body = {
      channel,
      type: snapshot.type || 'wgt',
      versionCode: snapshot.versionCode || 0,
      versionName: snapshot.versionName || '',
      wgtVersion: snapshot.wgtVersion || '',
      url: snapshot.url,
      md5: snapshot.md5 || '',
      size: snapshot.size || 0,
      note: '[回滚] ' + (snapshot.note || ''),
      force: !!snapshot.force,
    };
    // 还原灰度白名单/百分比：旧回滚漏发 targetDevices，服务端按「无白名单灰度」
    // 落盘，白名单被清空（2026-11-04 事故）。
    if (canaryLike && snapshot.gray) {
      const targets = Array.isArray(snapshot.gray.targetDevices) ? snapshot.gray.targetDevices : [];
      body.targetDevices = targets;
      if (targets.length === 0 && snapshot.gray.rolloutPct != null) {
        body.rolloutPct = snapshot.gray.rolloutPct;
      }
    }
    const r = await request(server + '/api/app/update', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json; charset=utf-8',
        Authorization: 'Bearer ' + token,
      },
      body: Buffer.from(JSON.stringify(body), 'utf8'),
      timeout: 30000,
    });
    if (r.status !== 200) {
      return { ok: false, error: 'HTTP ' + r.status + ': ' + r.body.toString('utf8').slice(0, 200) };
    }
    if (onLog) onLog('[回滚] 已把指针恢复到 ' + snapshot.fileName + '\n');
    return { ok: true, restored: snapshot.fileName };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}

module.exports = {
  pushUpdate,
  inspectPackage,
  readZipEntries,
  readZipFile,
  request,
  readAdminState,
  pickStateEntry,
  // 导出给界面做「手动回滚」按钮：读最近一次推送前快照并还原线上指针
  snapshotPointer,
  rollbackPointer,
};
