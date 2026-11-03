#!/usr/bin/env node
/**
 * mls-ctl · 素材库三端全局控制脚本（零依赖、跨平台，Windows 上直接跑）
 *
 *   node scripts/mls-ctl.js status [--json]      一屏总览：web 通道 / app 发布 / 正式端 / 周边服务
 *   node scripts/mls-ctl.js start  <target>      target: prod | test | gray
 *   node scripts/mls-ctl.js stop   <target>
 *   node scripts/mls-ctl.js restart <target> [--build]   （test/gray 默认不重新构建）
 *                  [--takeover]                  test/gray 端口互斥时自动停掉对手通道
 *                  [--no-build]                  start test/gray 时跳过构建
 *   node scripts/mls-ctl.js logs <target> [-n 200] [-f]
 *                  target: prod-server | prod-web | prod-watchdog | prod-prewarm
 *                          test-api | test-web | gray-api | gray-web
 *                          pack | editor | asr
 *   node scripts/mls-ctl.js promote test         默认 dry-run，只预演
 *   node scripts/mls-ctl.js promote test --execute [--force]   真合并 + 重建 + 重启 30001&30002
 *
 * 红线：
 *   - prod（30001/30002）只能经 WSL(smu) start.sh 启停，本脚本绝不 spawn Windows node 占这两个端口；
 *   - 每个托管通道独立 ML_DATA_DIR，禁止两个进程共用一个 material.db；
 *   - promote 默认只预演，真合并必须显式 --execute。
 */
const fs = require('fs');
const path = require('path');

const bc = require('./branch-channel');
const probes = require('./mls/lib/probes');
const wsl = require('./mls/lib/wsl');
const channels = require('./mls/lib/channels');
const appRelease = require('./mls/lib/app-release');

const ROOT = bc.ROOT;
const argv = process.argv.slice(2);
const has = (f) => argv.includes(f);
const flagValue = (f, def) => {
  const i = argv.indexOf(f);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('-') ? argv[i + 1] : def;
};
const positional = argv.filter((a) => !a.startsWith('-'));

/* ------------------------------------------------------------------ */
/* 状态聚合（status 与 B2 的 service-hub 共用同一份数据）               */
/* ------------------------------------------------------------------ */

function serializeProbes(map) {
  const out = {};
  for (const [id, r] of map) {
    const item = {
      up: r.up,
      port: r.port,
      statusCode: r.statusCode || 0,
      ms: r.ms,
      error: r.error || (r.parseError ? 'bad-json' : undefined),
    };
    if (r.data) {
      if (id === 'service-hub') {
        item.data = {
          serviceCount: Array.isArray(r.data.services) ? r.data.services.length : 0,
          services: (r.data.services || []).map((s) => ({
            id: s.id,
            up: s.up,
            managed: s.managed,
            port: s.port,
          })),
        };
      } else if (id === 'pack-studio') {
        item.data = {
          running: r.data.running || null,
          hbx: Boolean(r.data.hbx),
          app: r.data.app || null,
        };
      } else {
        item.data = r.data;
      }
    }
    out[id] = item;
  }
  return out;
}

async function gather() {
  const warnings = [];
  const [lanes, probeMap, prod] = await Promise.all([
    bc.collectLanes(),
    probes.probeAll(undefined, 900),
    Promise.resolve(wsl.prodSnapshot()),
  ]);
  const app = appRelease.collectAppRelease();
  const shadow = wsl.windowsShadowPlane();

  // 通道级告警
  for (const r of lanes) {
    if (r.legacy && (r.apiUp || r.webUp)) {
      warnings.push(`遗留 gray 通道正在运行（${r.apiPort}/${r.webPort}），它与 test 互斥，且按计划即将退役`);
    }
    if (r.key !== 'prod' && r.stale) warnings.push(`${r.label}(${r.key}) 前端产物落后于分支，访问到的是旧构建`);
    if (r.hasUncommitted && r.key !== 'prod') {
      warnings.push(`${r.label}(${r.key}) 工作树有 ${r.dirtyCount} 项未提交改动`);
    }
    if (r.apiUp && !r.apiPid && r.key !== 'prod') {
      warnings.push(`${r.apiPort} 在监听但 ${r.key} 通道没有存活 api.pid（被未知进程占用）`);
    }
    if (r.webUp && !r.webPid && r.key !== 'prod') {
      warnings.push(`${r.webPort} 在监听但 ${r.key} 通道没有存活 web.pid（被未知进程占用）`);
    }
  }

  // 正式端：端口在监听而 WSL 无进程记录 = 第三数据平面
  const probeApi = probeMap.get('prod-api');
  const probeWeb = probeMap.get('prod-web');
  if (probeApi && probeApi.up && !prod.pids.server) {
    warnings.push('30001 正在监听但 WSL 无 server.pid：疑似 Windows「伪正式」第三数据平面，请立即核查');
  }
  if (probeWeb && probeWeb.up && !prod.pids.webpro) {
    warnings.push('30002 正在监听但 WSL 无 webpro.pid：Web 网关可能由非 watchdog 进程提供');
  }
  if (prod.reachable && prod.stopFlag) {
    warnings.push('watchdog.stop 停止标记仍存在：watchdog 不会再自动拉起进程（正式 start 会清除）');
  }
  if (shadow.apiPid) {
    warnings.push(`高危：Windows 侧 ${shadow.dir} 存在存活 api.pid=${shadow.apiPid}（第三数据平面残留）`);
  }

  for (const w of app.warnings) warnings.push(`[App] ${w}`);

  return {
    time: Date.now(),
    lanes,
    prod,
    probes: serializeProbes(probeMap),
    app,
    shadow,
    warnings,
  };
}

/* ------------------------------------------------------------------ */
/* 文本渲染                                                            */
/* ------------------------------------------------------------------ */

const CJK = /[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹯＀-｠￠-￦]/g;
const wide = (s) => String(s).replace(CJK, 'xx').length;
const pad = (s, n) => String(s) + ' '.repeat(Math.max(1, n - wide(String(s))));
const ts = (n) => {
  if (!n) return '-';
  return new Date(typeof n === 'string' ? n : n).toLocaleString('zh-CN', { hour12: false });
};
const dot = (up) => (up ? '●' : '○');

function renderStatus(s) {
  const out = [];
  out.push('');
  out.push(`  素材库三端状态  ${ts(s.time)}`);
  out.push('  ' + '='.repeat(96));

  // 1) Web 通道
  out.push('');
  out.push('  [Web 通道]');
  out.push('  ' + pad('通道', 18) + pad('分支', 12) + pad('端口 API/Web', 15) + pad('PID', 14) + pad('产物', 20) + '状态');
  for (const r of s.lanes) {
    const ports = `${dot(r.apiUp)}${r.apiPort} / ${dot(r.webUp)}${r.webPort}`;
    const pids = [r.apiPid, r.webPid].filter(Boolean).join('/') || '-';
    const dist = r.dist
      ? `${ts(r.dist.builtAt).slice(5, 16)} @${r.dist.commit}`
      : r.distExists
        ? '无 build-info'
        : '未构建';
    let state;
    if (!r.worktreeReady && r.key !== 'prod') state = '缺工作树';
    else if (r.stale) state = '产物落后';
    else if (r.apiUp || r.webUp) state = r.legacy ? '运行中(遗留)' : '运行中';
    else state = '未运行';
    out.push('  ' + pad(`${r.label}(${r.key})${r.legacy ? '⚠' : ''}`, 18) + pad(r.branch, 12) + pad(ports, 15) + pad(pids, 14) + pad(dist, 20) + state);
    if (r.hasUncommitted) out.push(`    └ 未提交改动 ${r.dirtyCount} 项`);
  }

  // 2) 正式端（WSL）
  out.push('');
  out.push('  [正式服务端 · WSL/' + s.prod.distro + ']');
  if (!s.prod.reachable) {
    out.push('    WSL 发行版未运行（30001/30002 应全部 DOWN；启动：node scripts/mls-ctl.js start prod）');
  } else {
    const p = s.prod.pids;
    out.push(
      '    ' +
        `watchdog ${p.watchdog || '-'} · server ${p.server || '-'} · webpro ${p.webpro || '-'} · ` +
        `停止标记 ${s.prod.stopFlag ? '存在⚠' : '无'}`
    );
    out.push('    数据平面: ' + s.prod.dataUnc);
  }

  // 3) App 发布
  out.push('');
  out.push('  [App 发布]');
  const a = s.app;
  if (!a.reachable) {
    out.push('    WSL 未运行，读不到正式 manifest（打包工作台状态仍可用）');
  } else {
    if (a.full) {
      out.push(`    全量  ${a.full.versionCode} (${a.full.versionName}, ${a.full.type}) force=${a.full.force} 发布于 ${ts(a.full.publishedAt)}`);
    } else {
      out.push('    全量  无指针');
    }
    if (a.grayscale && a.grayscale.active && a.grayscale.latest) {
      const g = a.grayscale;
      out.push(
        `    灰度  ${g.latest.versionCode} (${g.latest.versionName}) 白名单 ${g.targetDevices.length} 台：${g.targetDevices.join(', ') || '-'}`
      );
    } else {
      out.push('    灰度  未激活');
    }
  }
  if (a.pack && a.pack.version) {
    const v = a.pack.version;
    out.push(`    版本号机 lastIssued=${v.lastIssued} (${v.versionName}, code ${v.versionCode}.${v.machineCode})`);
    if (a.pack.lastAction) {
      out.push(`    最近动作 ${a.pack.lastAction.action} · ${a.pack.lastAction.time || '-'}`);
    }
  }

  // 4) 周边服务
  out.push('');
  out.push('  [周边服务]');
  for (const id of ['service-hub', 'pack-studio', 'clip-editor', 'asr']) {
    const p = s.probes[id];
    if (!p) continue;
    out.push(`    ${dot(p.up)} ${pad(id, 15)} :${p.port}  ${p.up ? 'UP ' + p.ms + 'ms' : 'DOWN'}`);
  }

  // 5) 告警
  if (s.warnings.length) {
    out.push('');
    out.push('  [告警]');
    for (const w of s.warnings) out.push('    ! ' + w);
  }

  out.push('');
  out.push('  入口: 正式 http://127.0.0.1:30002/   测试 http://127.0.0.1:30003/   面板 http://127.0.0.1:3790/');
  out.push('');
  return out.join('\n');
}

/* ------------------------------------------------------------------ */
/* start / stop / restart                                             */
/* ------------------------------------------------------------------ */

async function waitProdPorts(action) {
  if (action === 'stop') return;
  console.log('[mls] 等待 30001/30002 就绪…');
  const api = await bc.waitPort(bc.LANES.prod.apiPort, 90000);
  const web = await bc.waitPort(bc.LANES.prod.webPort, 90000);
  console.log(`[mls] 30001 ${api ? 'UP' : 'TIMEOUT'} · 30002 ${web ? 'UP' : 'TIMEOUT'}`);
}

async function cmdLifecycle(action, target) {
  if (!target) throw new Error('缺少目标，例如：node scripts/mls-ctl.js restart prod');

  if (target === 'prod') {
    console.log(`[mls] ${action} 正式端 → 委托 WSL/${wsl.DISTRO} start.sh（绝不走 Windows node）`);
    wsl.prodControl(action, { winProject: ROOT });
    await waitProdPorts(action);
    return;
  }

  if (target === 'test' || target === 'gray') {
    const opts = {
      skipBuild: action === 'start' ? has('--no-build') : !has('--build'),
      takeover: has('--takeover'),
    };
    if (action === 'start') return await channels.startManaged(target, opts);
    if (action === 'stop') return channels.stopManaged(target);
    if (action === 'restart') return await channels.restartManaged(target, opts);
  }

  throw new Error(
    `不支持的启停目标：${target}（本机可管：prod / test / gray；` +
      `pack/editor/asr 请用 service-hub 面板 http://127.0.0.1:3790/）`
  );
}

/* ------------------------------------------------------------------ */
/* logs                                                               */
/* ------------------------------------------------------------------ */

function laneLogFile(spec) {
  // spec: test-api / test-web / gray-api / gray-web
  const m = /^(test|gray)-(api|web)$/.exec(spec);
  if (!m) return null;
  return path.join(bc.LANES[m[1]].dataDir, 'logs', `${m[2]}.log`);
}

function localLogFile(spec) {
  if (spec === 'pack') return path.join(ROOT, 'service-hub', 'logs', 'pack-studio.log');
  if (spec === 'editor') {
    const hubLog = path.join(ROOT, 'service-hub', 'logs', 'clip-editor.log');
    if (fs.existsSync(hubLog)) return hubLog;
    return path.join(ROOT, 'editor', 'editor-watchdog.log');
  }
  if (spec === 'asr') return path.join(ROOT, 'service-hub', 'logs', 'asr-server.log');
  return null;
}

function tailLocal(file, n) {
  const text = fs.readFileSync(file, 'utf8');
  return text.split(/\r?\n/).slice(-(n + 1));
}

function followLocal(file) {
  let pos = fs.statSync(file).size;
  const tick = () => {
    let stat;
    try {
      stat = fs.statSync(file);
    } catch (_) {
      return;
    }
    if (stat.size < pos) pos = 0; // 日志被截断/轮转
    if (stat.size > pos) {
      const fd = fs.openSync(file, 'r');
      try {
        const len = stat.size - pos;
        const buf = Buffer.alloc(len);
        fs.readSync(fd, buf, 0, len, pos);
        process.stdout.write(buf);
      } finally {
        fs.closeSync(fd);
      }
      pos = stat.size;
    }
  };
  setInterval(tick, 800).unref();
}

function followProd(name) {
  let pos = wsl.prodLogSize(name);
  if (pos < 0) throw new Error(`WSL 日志 ${name} 不可读（发行版未运行？）`);
  const tick = () => {
    const r = wsl.readProdLogBytes(name, pos);
    if (!r) return;
    if (r.size < pos) pos = 0;
    if (r.chunk.length) {
      process.stdout.write(r.chunk);
      pos += r.chunk.length;
    }
    if (r.size < pos) pos = r.size;
  };
  setInterval(tick, 800).unref();
}

function cmdLogs(target, n, follow) {
  if (!target) throw new Error('缺少日志目标，例如：node scripts/mls-ctl.js logs prod-server -f');

  if (wsl.PROD_LOGS[target]) {
    const r = wsl.tailProdLog(target, n);
    if (!r.ok) throw new Error(r.error);
    console.log(`# ${r.path}`);
    process.stdout.write(r.lines.join('\n') + '\n');
    if (follow) followProd(target);
    return;
  }

  const file = laneLogFile(target) || localLogFile(target);
  if (!file) {
    throw new Error(
      `未知日志目标：${target}（可选：${Object.keys(wsl.PROD_LOGS).join(' / ')} / test-api / test-web / gray-api / gray-web / pack / editor / asr）`
    );
  }
  if (!fs.existsSync(file)) throw new Error(`日志文件不存在：${file}`);
  console.log(`# ${file}`);
  process.stdout.write(tailLocal(file, n).join('\n') + '\n');
  if (follow) followLocal(file);
}

/* ------------------------------------------------------------------ */
/* promote                                                            */
/* ------------------------------------------------------------------ */

async function cmdPromote(lane) {
  if (!lane) throw new Error('用法：node scripts/mls-ctl.js promote test [--execute]');
  const execute = has('--execute') || has('--yes');
  if (!execute) {
    console.log('[mls] promote 预演（dry-run，不动代码）。真合并请加 --execute');
  } else {
    console.log('[mls] --execute：将合并 → 重建正式产物 → 经 start.sh 同时重启 30001 与 30002');
  }
  await channels.promote(lane, { execute, force: has('--force') });
}

/* ------------------------------------------------------------------ */
/* main                                                               */
/* ------------------------------------------------------------------ */

function printHelp() {
  console.log(fs.readFileSync(__filename, 'utf8').split('*/')[0].replace(/^#![^\n]*\n/, ''));
}

/** 库导出：service-hub「通道与发布」标签页直接消费 gather() 的同一份数据 */
module.exports = { gather, renderStatus };

if (require.main !== module) return;

(async () => {
  try {
    const cmd = positional[0];
    if (!cmd || cmd === 'help' || has('--help') || has('-h')) return printHelp();

    if (cmd === 'status') {
      const s = await gather();
      if (has('--json')) {
        process.stdout.write(JSON.stringify(s, null, 2) + '\n');
      } else {
        process.stdout.write(renderStatus(s) + '\n');
      }
      return;
    }

    if (cmd === 'start' || cmd === 'stop' || cmd === 'restart') {
      return await cmdLifecycle(cmd, positional[1]);
    }

    if (cmd === 'logs') {
      const target = positional[1];
      const n = Number(flagValue('-n', '200')) || 200;
      const follow = has('-f') || has('--follow');
      cmdLogs(target, n, follow);
      if (follow) setInterval(() => {}, 1 << 30); // 保持进程，timer 仅为保活
      return;
    }

    if (cmd === 'promote') return await cmdPromote(positional[1]);

    throw new Error(`未知命令：${cmd}（status / start / stop / restart / logs / promote）`);
  } catch (e) {
    console.error(`[mls] 失败：${e.message}`);
    process.exitCode = 1;
  }
})();
