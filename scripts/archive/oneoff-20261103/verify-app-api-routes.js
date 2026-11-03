/**
 * App → 服务端路由对齐校验
 *
 * 为什么需要：App 的 ViewerApi 里存在指向「服务端根本没有的路由」的调用
 * （/gen/options、/gen/tasks 在服务端只有 /gen/images|videos|audio|chat）。
 * 这类调用不会让编译失败，只会在用户点下去的那一刻 404，属于最贵的死代码。
 *
 * 用法：node scripts/verify-app-api-routes.js
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const APP_FILES = [
  'app-uniapp/src/service/ViewerApi.js',
  'app-uniapp/src/service/WebDownload.js',
  'app-uniapp/src/service/AppUpdater.js',
  'app-uniapp/src/common/assetMap.js',
];
const SERVER_FILES = ['src/api.js', 'server.js'];

const failures = [];
const notes = [];
function ok(cond, msg) { if (!cond) failures.push(msg); else console.log(`[PASS] ${msg}`); }
function info(msg) { notes.push(msg); }

/** App 侧：抽出所有请求路径字面量 */
function appPaths() {
  const set = new Set();
  for (const rel of APP_FILES) {
    const p = path.join(ROOT, rel);
    if (!fs.existsSync(p)) { info(`App 文件缺失，跳过：${rel}`); continue; }
    const txt = fs.readFileSync(p, 'utf8');
    // request('/x') / request(`/x/${...}`) / server + '/api/x'
    for (const m of txt.matchAll(/request\(\s*['"`]([^'"`]+)/g)) set.add(m[1]);
    for (const m of txt.matchAll(/['"`](\/api\/[A-Za-z0-9/_-]+)/g)) set.add(m[1]);
  }
  return [...set];
}

/** 归一化：把 ${...} 占位（含 encodeURIComponent 拼接）折成 :seg，再补一段子路径 */
function normalize(appPath) {
  const noTpl = appPath
    .replace(/\$\{[^}]*\}/g, ':seg')
    .replace(/\/\s*\+\s*encodeURIComponent\([^)]*\)/g, '/:seg')
    .replace(/\s*\+\s*encodeURIComponent\([^)]*\)/g, '')
    .replace(/\?.*$/, '');
  const out = [];
  out.push(noTpl.replace(/\/$/, ''));          // /assets/:seg
  out.push(noTpl.replace(/:seg/g, 'x').replace(/\/$/, '')); // /assets/x（喂给正则路由）
  return out;
}

/** 从 `pathname.match(/re/)` 里把正则源码原样摘出来（处理 \/ 转义） */
function takeRegexLiteral(src, from) {
  let i = src.indexOf('/', from);
  if (i < 0) return null;
  i++;
  let out = '';
  while (i < src.length) {
    const c = src[i];
    if (c === '\\') { out += c + (src[i + 1] || ''); i += 2; continue; }
    if (c === '[') {
      const close = src.indexOf(']', i);
      if (close < 0) return null;
      out += src.slice(i, close + 1); i = close + 1; continue;
    }
    if (c === '/') return { source: out, flags: src.slice(i + 1).match(/^[a-z]*/)[0] };
    out += c; i++;
  }
  return null;
}

/** 服务端侧：抽出路由字面量 + 正则路由 */
function serverRoutes() {
  const exact = new Set();
  const prefixes = new Set();
  const regexes = [];
  for (const rel of SERVER_FILES) {
    const p = path.join(ROOT, rel);
    if (!fs.existsSync(p)) continue;
    const txt = fs.readFileSync(p, 'utf8');
    for (const m of txt.matchAll(/pathname\s*===\s*['"`](\/[^'"`]+)['"`]/g)) exact.add(m[1]);
    for (const m of txt.matchAll(/pathname\.startsWith\(\s*['"`](\/[^'"`]+)['"`]/g)) prefixes.add(m[1]);
    // 逐处 pathname.match(...) / re.test(pathname) 摘正则
    for (const m of txt.matchAll(/pathname\.match\(/g)) {
      const lit = takeRegexLiteral(txt, m.index + m[0].length);
      if (!lit) continue;
      try { regexes.push(new RegExp(lit.source, lit.flags)); } catch (_) { /* 无法还原就跳过 */ }
    }
  }
  return { exact, prefixes, regexes };
}

/** 服务端 viewer 路由挂在 /api/viewer 下，handler 内 pathname 已去前缀 */
function stripBase(p) {
  return p.startsWith('/api/') ? p.replace(/^\/api\/(viewer|admin)\//, '/').replace(/^\/api\//, '/') : p;
}

function matches(appPath, routes) {
  const target = stripBase(appPath);
  const probes = normalize(target);
  for (const probe of probes) {
    if (routes.exact.has(probe)) return true;
    for (const pre of routes.prefixes) if (probe.startsWith(pre)) return true;
    for (const re of routes.regexes) if (re.test(probe)) return true;
  }
  return false;
}

function main() {
  console.log('=== App → 服务端路由对齐 ===\n');
  const routes = serverRoutes();
  console.log(`服务端路由：字面 ${routes.exact.size}、前缀 ${routes.prefixes.size}、正则 ${routes.regexes.length}`);
  ok(routes.exact.size + routes.regexes.length > 50, `服务端路由表解析出 ${routes.exact.size + routes.regexes.length} 条（解析本身可用）`);

  const paths = appPaths();
  const unmatched = paths.filter((p) => !matches(p, routes));
  ok(unmatched.length === 0, `${paths.length} 个 App 请求路径全部命中服务端路由（未命中 ${unmatched.length}）`);
  for (const u of unmatched) failures.push(`  ↳ 未命中：${u}`);

  console.log('');
  for (const n of notes) console.log(`[INFO] ${n}`);
  if (failures.length) {
    console.log('\n✗ ' + failures.length + ' 项未通过');
    for (const f of failures) console.log(`[FAIL] ${f}`);
    process.exit(1);
  }
  console.log('\n✓ 全部通过');
}

main();
