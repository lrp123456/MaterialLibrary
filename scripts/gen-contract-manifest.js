#!/usr/bin/env node
/**
 * 三端对接契约静态扫描器（零依赖，不 require 任何业务模块，避免 better-sqlite3 ABI 问题）
 *
 * 服务端输入：
 *   src/api.js（只扫 viewer 前缀剥离之后的主分发区，1581 行起）
 *   src/base-library/routes.js、src/asr.js、src/portrait-library.js（同表全路径分发）
 *   VIEWER_WHITELIST（src/api.js:1436-1580，事实移动端契约）
 *
 * 客户端输入：
 *   web/src/api.js               旧管理台（request('/x')，运行时拼 /api）
 *   web-pro/src 下全部 js/vue/ts 新工作台（fetch/authFetch('/api/...')，含 /api/viewer 前缀调用）
 *   app-uniapp ViewerApi.js      移动端（request('/x')，运行时拼 /api/viewer；支持字符串拼接）
 *   harmony .../services/Api.ets 鸿蒙（this.request('/api/...')，仅 2 端点）
 *
 * 输出 docs/contract-manifest.json：
 *   counts / routes / whitelist / clients / findings / otherEndpoints
 *
 * finding 类型：
 *   missing-route        客户端调用在服务端找不到任何路由（R4：dup-groups 三调用）
 *   dynamic-capture      纯字面量调用仅被动态/前缀路由接住（R5：/workflows/default 被 /:id 吞）
 *   whitelist-gap        viewer 调用未命中 VIEWER_WHITELIST（R3：local-model 下载）
 *   viewer-admin         白名单放行但处理器要 admin（R6：purge → viewer 403）
 *   duplicate-route      同 method+精确路径注册两次（R10：/app/update/state）
 *   duplicate-whitelist  白名单重复条目（tools/convert-video、extract-frames）
 *   wrong-base-url       鸿蒙默认 8787（R1，应为 30001）
 *   unguarded-json-parse 鸿蒙 JSON.parse 无保护（错误页 HTML 即崩）
 *   dead-alias           客户端导出引用了不存在的符号（R2：aiEditVerify = verifyPasteback）
 *
 * 用法：
 *   node scripts/gen-contract-manifest.js           生成 manifest（基线不过则退出码 1）
 *   node scripts/gen-contract-manifest.js --check   只跑自测并打印，不写文件
 */
const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const escapeRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/* ================================================================== */
/* 服务端路由                                                          */
/* ================================================================== */

const SERVER_FILES = [
  { file: 'src/api.js', afterMarker: "if (pathname === '/viewer' || pathname.startsWith('/viewer/'))" },
  { file: 'src/base-library/routes.js' },
  { file: 'src/asr.js' },
  { file: 'src/portrait-library.js' },
];

/** 路由分支谓词行（用于 admin 守卫窗口截断） */
const PREDICATE_LINE = /pathname\s*(?:===|==|\.startsWith\(|\.match\(|\.includes\()|\.test\(\s*pathname/;

function scanServerRoutes({ file, afterMarker }) {
  const text = read(file);
  const allLines = text.split(/\r?\n/);
  let startIdx = 0;
  if (afterMarker) {
    const i = allLines.findIndex((l) => l.includes(afterMarker));
    if (i < 0) throw new Error(`${file}: 找不到分发起点标记`);
    startIdx = i;
  }

  const routes = [];
  // 字面量正则：源码片段 = 转义符 / 字符类（内部允许裸 / 与 \] 等）/ 普通字符，且必须含 \/
  const testRe = /\/((?:\\.|\[(?:\\.|[^\]\\\n])*\]|[^/\\\n])*\\\/(?:\\.|\[(?:\\.|[^\]\\\n])*\]|[^/\\\n])+)\/[a-z]*\.test\(\s*pathname/g;
  const matchRe = /pathname\.match\(\s*\/((?:\\.|\[(?:\\.|[^\]\\\n])*\]|[^/\\\n])*\\\/(?:\\.|\[(?:\\.|[^\]\\\n])*\]|[^/\\\n])+)\/\s*\)/g;
  const methodReGlobal = /req\.method\s*===?\s*['"]([A-Z]+)['"]|['"]([A-Z]+)['"]\s*===?\s*req\.method/g;

  // 谓词行 -> 该路由支持的方法分支（按行缓存）
  const methodCache = new Map();
  const methodsOn = (ln) => {
    const out = [];
    methodReGlobal.lastIndex = 0;
    let hm;
    while ((hm = methodReGlobal.exec(ln))) out.push(hm[1] || hm[2]);
    return out;
  };
  /**
   * 展开谓词行支持的全部 HTTP 方法分支：
   *  - 谓词行自带 req.method（pathname 判定与方法同门）；
   *  - const mX = pathname.match(…) 形态：收集块内所有引用 mX 的方法守门行
   *    （PUT||DELETE 同门 + 60 行后独立的 if (mX && DELETE) 兄弟分支）；
   *  - 无变量内联谓词（if (pathname===…) {）：收集直接子块（predIndent+2）的
   *    req.method 子分支（base-library/routes.js paints/mirror 的 GET/POST）。
   */
  function expandMethods(predIdx) {
    if (methodCache.has(predIdx)) return methodCache.get(predIdx);
    const predLine = allLines[predIdx];
    const predIndent = (predLine.match(/^ */) || [''])[0].length;
    const found = new Map();
    const take = (m, guard) => { if (!found.has(m)) found.set(m, guard); };
    for (const mt of methodsOn(predLine)) take(mt, predIdx);

    const varMm = predLine.match(/const\s+(\w+)\s*=\s*pathname\.(?:match|test)/);
    const varName = varMm ? varMm[1] : null;
    const bodyIndent = predIndent + 2;
    for (let j = predIdx + 1; j < Math.min(allLines.length, predIdx + 200); j++) {
      const ln = allLines[j];
      if (!ln.trim()) continue;
      const ind = (ln.match(/^ */) || [''])[0].length;
      if (ind < predIndent) break;                                          // 块已结束
      if (ind <= predIndent && /^\s*(?:if|const)\b/.test(ln) && PREDICATE_LINE.test(ln)) break;
      const mts = methodsOn(ln);
      if (!mts.length) continue;
      if (varName) {
        if (ln.includes(varName)) for (const mt of mts) take(mt, j);
      } else if (ind === bodyIndent && !PREDICATE_LINE.test(ln)) {
        for (const mt of mts) take(mt, j);
      }
    }
    const out = found.size
      ? [...found].map(([method, guardLine]) => ({ method, guardLine }))
      : [{ method: '*', guardLine: predIdx }];
    methodCache.set(predIdx, out);
    return out;
  }

  for (let i = startIdx; i < allLines.length; i++) {
    const line = allLines[i];

    let mm;
    const exactRe = /pathname\s*===?\s*['"]([^'"]+)['"]/g;
    while ((mm = exactRe.exec(line))) {
      for (const b of expandMethods(i)) routes.push(mk(file, i + 1, b.method, 'exact', mm[1], allLines, b.guardLine));
    }
    const preRe = /pathname\.startsWith\(\s*['"]([^'"]+)['"]/g;
    while ((mm = preRe.exec(line))) {
      const p = mm[1];
      if (p === '/api' || p === '/viewer' || p === '/frames') continue; // 入口分流
      if (/return\s+false/.test(line)) continue;                          // 模块门卫
      for (const b of expandMethods(i)) routes.push(mk(file, i + 1, b.method, 'prefix', p, allLines, b.guardLine));
    }
    testRe.lastIndex = 0;
    while ((mm = testRe.exec(line))) {
      for (const b of expandMethods(i)) routes.push(mk(file, i + 1, b.method, 'regex', mm[1], allLines, b.guardLine));
    }
    matchRe.lastIndex = 0;
    while ((mm = matchRe.exec(line))) {
      for (const b of expandMethods(i)) routes.push(mk(file, i + 1, b.method, 'regex', mm[1], allLines, b.guardLine));
    }
  }

  const seen = new Set();
  return routes.filter((r) => {
    const k = r.file + r.line + r.method + r.kind + r.pattern;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** 截取守门行开启的分支块（按花括号配平），无块则取本行 */
function branchBlock(allLines, start) {
  const out = [];
  let depth = 0;
  let opened = false;
  for (let i = start; i < Math.min(allLines.length, start + 60); i++) {
    const ln = allLines[i];
    out.push(ln);
    for (const ch of ln.replace(/'[^']*'|"[^"]*"/g, "''")) {
      if (ch === '{') { depth++; opened = true; }
      else if (ch === '}') { depth--; if (opened && depth === 0) return out.join('\n'); }
    }
    if (!opened && i >= start) return out.join('\n');
  }
  return out.join('\n');
}

function mk(file, lineNo, method, kind, pattern, allLines, guardIdx) {
  // 路由级 admin 守卫：方法分支块开头 400 字符内出现 if (!isAdmin) … 403。
  // 锚到各自方法分支（routes.js mirror 的 GET 公开 / POST 管理，互不污染）；
  // 深层子操作的 admin 判定（如 GET /assets 内部 q.all && !isAdmin）不算路由级。
  const start = guardIdx == null ? lineNo - 1 : guardIdx;
  const block = branchBlock(allLines, start).slice(0, 400);
  // 只认路由级守卫 if (!isAdmin) …403；参数级（如 q.all && !isAdmin）不算
  const admin = /if\s*\(\s*!isAdmin\s*\)[\s\S]{0,160}?403/.test(block);
  return { file, line: lineNo, method, kind, pattern, admin };
}

/* ================================================================== */
/* VIEWER_WHITELIST                                                    */
/* ================================================================== */

function scanWhitelist() {
  const text = read('src/api.js');
  const start = text.indexOf('const VIEWER_WHITELIST');
  if (start < 0) throw new Error('找不到 VIEWER_WHITELIST');
  const end = text.indexOf('];', start);
  const block = text.slice(start, end);
  const out = [];
  const re = /\[\s*['"]([A-Z]+)['"]\s*,\s*\/((?:\\.|\[(?:\\.|[^\]\\])*\]|[^/\\])+)\/\s*[a-z]*\]/g;
  let mm;
  while ((mm = re.exec(block))) {
    out.push({ method: mm[1], source: mm[2] });
  }
  const seen = new Set();
  for (const w of out) {
    const key = w.method + ' ' + w.source;
    w.duplicated = seen.has(key);
    seen.add(key);
  }
  return out;
}

/** 白名单正则源码 → 具体示例路径（本仓白名单语法：字面量 + [^/]+ + \d 类） */
function sampleFromRegex(src) {
  return src
    .replace(/\\\//g, '/')
    .replace(/\[\^\/\][+*]/g, 'example')
    .replace(/\\[dwb][+*]/g, 'example')
    .replace(/[\^$]/g, '');
}

/* ================================================================== */
/* 客户端调用                                                          */
/* ================================================================== */

const CALL_RE = /(?<![\w$])(?:authFetch|fetch|request)\s*\(\s*(`(?:[^`\\]|\\.)*`|'(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")/g;

function walkSrc(dir, exts, out) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    let st;
    try { st = fs.statSync(full); } catch { continue; }
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === 'dist') continue;
      walkSrc(full, exts, out);
    } else if (exts.some((e) => name.endsWith(e))) {
      out.push(full);
    }
  }
  return out;
}

const CLIENT_SURFACES = [
  {
    id: 'web',
    label: '旧管理台',
    files: () => [path.join(ROOT, 'web/src/api.js')],
    unprefixedIsApi: true,
    forceViewer: false,
  },
  {
    id: 'web-pro',
    label: '新工作台',
    files: () => walkSrc(path.join(ROOT, 'web-pro/src'), ['.js', '.vue', '.ts'], []),
    unprefixedIsApi: false,
    forceViewer: false,
  },
  {
    id: 'app-uniapp',
    label: '移动端 uni-app',
    files: () => [path.join(ROOT, 'app-uniapp/src/service/ViewerApi.js')],
    unprefixedIsApi: true,
    forceViewer: true,
  },
  {
    id: 'harmony',
    label: '鸿蒙',
    files: () => [path.join(ROOT, 'harmony/material_sync/entry/src/main/ets/services/Api.ets')],
    unprefixedIsApi: false,
    forceViewer: false,
  },
];

/** 模板字面量内容 → lit/dyn 片段 */
function templatePieces(inner) {
  const pieces = [];
  let buf = '';
  for (let i = 0; i < inner.length; i++) {
    if (inner[i] === '$' && inner[i + 1] === '{') {
      if (buf) { pieces.push({ lit: buf }); buf = ''; }
      const e = inner.indexOf('}', i + 2);
      pieces.push({ dyn: inner.slice(i + 2, e < 0 ? inner.length : e) });
      if (e < 0) { i = inner.length; break; }
      i = e;
    } else {
      buf += inner[i];
    }
  }
  if (buf) pieces.push({ lit: buf });
  return pieces;
}

/** '/a/' + expr + '/b' 拼接形态 → lit/dyn 片段 */
function concatPieces(firstArg) {
  const pieces = [];
  const re = /('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")|([^'"]+)/g;
  let mm;
  while ((mm = re.exec(firstArg))) {
    if (mm[1] !== undefined) {
      pieces.push({ lit: mm[1].slice(1, -1) });
    } else {
      for (const part of mm[2].split('+')) {
        const t = part.trim();
        if (t) pieces.push({ dyn: t });
      }
    }
  }
  return pieces;
}

/**
 * 括号配对，取整个调用实参列表内部文本，并切出第一个实参。
 * 绝不越过本调用右括号 —— method 探测因此不会 bleed 到下一个调用。
 */
function readCallArgs(text, openParenIdx) {
  let depth = 0;
  let inStr = null;
  const end = Math.min(text.length, openParenIdx + 600);
  let firstComma = -1;
  let close = -1;
  for (let i = openParenIdx; i < end; i++) {
    const ch = text[i];
    if (inStr) {
      if (ch === '\\') i++;
      else if (ch === inStr) inStr = null;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === '`') { inStr = ch; continue; }
    if (ch === '(' || ch === '[' || ch === '{') depth++;
    else if (ch === ')' || ch === ']' || ch === '}') {
      depth--;
      if (depth === 0) { close = i; break; }
    } else if (ch === ',' && depth === 1 && firstComma < 0) {
      firstComma = i;
    }
  }
  const stop = close < 0 ? end : close;
  const inside = text.slice(openParenIdx + 1, stop);
  const firstArg = (firstComma < 0 ? inside : inside.slice(0, firstComma - openParenIdx - 1)).trim();
  const options = firstComma < 0 ? '' : text.slice(firstComma + 1, stop);
  return { firstArg, options };
}

/** 前导 ${API_BASE}/${BASE_URL} 等 origin 变量当丢弃处理 */
const ORIGIN_DYN = /^(?:[\w$]+\.)*[\w$]*(?:BASE|BASE_URL|API_BASE|ORIGIN|origin|server|host)[\w$]*$/;

function shapeFromPieces(pieces) {
  while (pieces.length && pieces[0].dyn && ORIGIN_DYN.test(pieces[0].dyn.trim())) {
    pieces.shift();
  }
  let p = '';
  let regexSrc = '';
  pieces.forEach((piece, idx) => {
    if (piece.lit !== undefined) {
      p += piece.lit;
      regexSrc += escapeRe(piece.lit);
    } else {
      const dyn = piece.dyn.trim();
      const prevLitEndsSlash = piece === pieces[0] ? false : (() => {
        for (let k = idx - 1; k >= 0; k--) {
          if (pieces[k].lit !== undefined) return pieces[k].lit.endsWith('/');
        }
        return false;
      })();
      // 末位 query 尾巴：前一字面量不以 / 收尾，且动态段含 ?/= 或就是 q/params 类短变量
      const isQueryTail = idx === pieces.length - 1 &&
        !prevLitEndsSlash &&
        (!/\//.test(dyn) && (/\?|=|searchParams/i.test(dyn) || /^(?:q|qs|query\w*|params|search\w*)$/.test(dyn)));
      if (isQueryTail) return;
      p += 'example';
      regexSrc += '[^/]+';
    }
  });
  const qi = p.indexOf('?');
  if (qi >= 0) p = p.slice(0, qi);
  const qr = regexSrc.indexOf('?');
  if (qr >= 0) regexSrc = regexSrc.slice(0, qr);
  return { regexSource: '^' + regexSrc + '$', example: p, concrete: !pieces.some((x) => x.dyn) };
}

/**
 * method 探测：
 *  1) 实参列表里的字面量 method: 'POST'（含对象展开）；
 *  2) 第二实参是变量（options/opts/extra）→ 在调用上方有限回溯最近的 method 赋值；
 *  3) 鸿蒙 RequestMethod.XXX（extra 常量写在调用前）。
 */
function detectMethod(surface, optionsText, lines, lineIdx) {
  let m = optionsText.match(/method\s*:\s*['"]([A-Z]+)['"]/);
  if (m) return m[1];
  const back = lines.slice(Math.max(0, lineIdx - 16), lineIdx).join('\n');
  if (surface.id === 'harmony') {
    const all = back.match(/RequestMethod\.([A-Z]+)/g);
    if (all) return all[all.length - 1].split('.')[1];
  }
  if (/^\s*(?:options|opts|opt|config|extra)\s*[,)]/m.test(optionsText) ||
      /^\s*(?:options|opts|opt|config|extra)\s*$/.test(optionsText.trim())) {
    const all = [...back.matchAll(/method\s*:\s*['"]([A-Z]+)['"]/g)];
    if (all.length) return all[all.length - 1][1];
  }
  return 'GET';
}

function scanSurface(surface) {
  const calls = [];
  for (const full of surface.files()) {
    const rel = path.relative(ROOT, full).split(path.sep).join('/');
    let text;
    try { text = fs.readFileSync(full, 'utf8'); } catch { continue; }
    const lines = text.split(/\r?\n/);
    CALL_RE.lastIndex = 0;
    let mm;
    while ((mm = CALL_RE.exec(text))) {
      const lineIdx = text.slice(0, mm.index).split(/\r?\n/).length - 1;
      const openIdx = mm.index + mm[0].indexOf('(');
      const { firstArg, options: optionsText } = readCallArgs(text, openIdx);
      let pieces;
      if (firstArg[0] === '`') {
        const close = firstArg.indexOf('`', 1);
        pieces = templatePieces(firstArg.slice(1, close < 0 ? firstArg.length : close));
      } else if (/^['"]/.test(firstArg) && firstArg.includes('+')) {
        pieces = concatPieces(firstArg);
      } else if (/^['"]/.test(firstArg)) {
        pieces = [{ lit: firstArg.slice(1, -1) }];
      } else {
        continue; // 动态变量入参 request(urlVar)，静态不可见
      }
      const shape = shapeFromPieces(pieces);
      let p = shape.example;
      if (!p.startsWith('/')) continue;
      const hadApi = /^\/api(?=\/|$)/.test(p);
      p = p.replace(/^\/api(?=\/|$)/, '');
      const viewer = surface.forceViewer || p === '/viewer' || p.startsWith('/viewer/');
      if (p === '/viewer') p = '/';
      else if (p.startsWith('/viewer/')) p = p.slice('/viewer'.length);
      if (!p.startsWith('/')) continue;
      if (!hadApi && !surface.unprefixedIsApi && !viewer) continue; // web-pro 非 API 字面量

      const method = detectMethod(surface, optionsText, lines, lineIdx);
      calls.push({
        file: rel,
        line: lineIdx + 1,
        method,
        pattern: shape.regexSource,
        example: p,
        concrete: shape.concrete,
        viewer,
        via: surface.id,
      });
    }
  }
  const seen = new Set();
  return calls.filter((c) => {
    const k = c.method + ' ' + c.pattern + ' viewer=' + c.viewer;
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/* ================================================================== */
/* 匹配                                                                */
/* ================================================================== */

function buildMatchers(routes) {
  return routes.map((r) => {
    let test;
    if (r.kind === 'exact') {
      test = (p) => p === r.pattern;
    } else if (r.kind === 'prefix') {
      const pre = r.pattern.endsWith('/') ? r.pattern : r.pattern + '/';
      test = (p) => p === r.pattern || p.startsWith(pre);
    } else {
      const re = (() => { try { return new RegExp('^(?:' + r.pattern + ')$'); } catch { return null; } })();
      test = re ? (p) => re.test(p) : () => false;
    }
    return { r, test };
  });
}

const methodOk = (rm, cm) => rm === '*' || rm === cm;
// 客户端动态段统一渲染成占位词 example，但服务端不少参数路由约束 \d+（/users/(\d+)、
// /exceptions/(\d+)/retry）。首轮失败后把占位词换成数字再试一次。
const pathTest = (m, p) => m.test(p) || p.includes('example') && m.test(p.replace(/example/g, '123'));
const callLineOf = (clients, surface, method, example) => {
  const c = (clients[surface] || []).find((x) => x.method === method && x.example === example);
  return c ? `${c.file}:${c.line}` : null;
};

/* ================================================================== */
/* 主流程                                                              */
/* ================================================================== */

function generate() {
  const findings = [];
  const add = (f) => findings.push({ severity: 'low', ...f });

  // ── 服务端路由 ──
  let routes = [];
  for (const spec of SERVER_FILES) routes = routes.concat(scanServerRoutes(spec));

  // R10：重复精确注册
  const exactSeen = new Map();
  for (const r of routes.filter((x) => x.kind === 'exact')) {
    const key = r.method + ' ' + r.pattern;
    const prev = exactSeen.get(key);
    if (prev) {
      add({
        severity: 'low',
        kind: 'duplicate-route',
        method: r.method,
        path: r.pattern,
        detail: `在 ${prev.file}:${prev.line} 与 ${r.file}:${r.line} 重复注册，后者永远不可达`,
        ref: 'R10',
      });
    } else {
      exactSeen.set(key, r);
    }
  }

  // ── 白名单 ──
  const whitelist = scanWhitelist();
  for (const w of whitelist.filter((x) => x.duplicated)) {
    add({
      severity: 'low',
      kind: 'duplicate-whitelist',
      method: w.method,
      path: sampleFromRegex(w.source),
      detail: `VIEWER_WHITELIST 重复条目 ${w.method} ${w.source}`,
    });
  }
  const whitelistHit = (method, p) =>
    whitelist.some((w) => {
      if (w.method !== method) return false;
      try {
        const re = new RegExp('^(?:' + w.source + ')$');
        return re.test(p) || (p.includes('example') && re.test(p.replace(/example/g, '123')));
      } catch { return false; }
    });

  const matchers = buildMatchers(routes);

  // ── 客户端 ──
  const clients = {};
  for (const surface of CLIENT_SURFACES) {
    const calls = scanSurface(surface);
    clients[surface.id] = calls;

    for (const c of calls) {
      const hits = matchers.filter((m) => methodOk(m.r.method, c.method) && pathTest(m, c.example));
      c.matched = hits.length > 0;
      const best = hits.find((h) => h.r.kind === 'exact') || hits[0];
      c.route = hits.length ? `${best.r.kind}:${best.r.pattern}@${best.r.file}:${best.r.line}` : null;

      if (!hits.length) {
        add({
          severity: 'medium',
          kind: 'missing-route',
          client: surface.id,
          method: c.method,
          path: c.example,
          detail: `${surface.label}调用在服务端无对应路由（${c.file}:${c.line}），运行时 404`,
        });
      } else if (c.concrete && !hits.some((h) => h.r.kind === 'exact')) {
        // 纯字面量路径被动态/前缀分支吞掉才报；:id 式调用被正则接住是正常 REST。
        add({
          severity: 'low',
          kind: 'dynamic-capture',
          client: surface.id,
          method: c.method,
          path: c.example,
          detail: `${surface.label}字面量调用仅被动态/前缀路由接住（${best.r.file}:${best.r.line} ${best.r.pattern}），可能静默返空`,
        });
      }

      if (c.viewer && !whitelistHit(c.method, c.example)) {
        add({
          severity: 'high',
          kind: 'whitelist-gap',
          client: surface.id,
          method: c.method,
          path: c.example,
          detail: `/api/viewer 调用未命中白名单，线上必然 404（${c.file}:${c.line}）`,
        });
      }
    }
  }

  // ── 白名单 × 路由交叉审计（即使当前没有客户端在调） ──
  const vaSeen = new Set();
  for (const w of whitelist) {
    const sample = sampleFromRegex(w.source);
    if (!sample.startsWith('/') || sample.includes('\\')) continue;
    const hit = matchers.find((m) => methodOk(m.r.method, w.method) && m.r.admin && m.test(sample));
    if (hit && !vaSeen.has(w.method + ' ' + sample)) {
      vaSeen.add(w.method + ' ' + sample);
      const via = callLineOf(clients, 'web-pro', w.method, sample) ||
        callLineOf(clients, 'web', w.method, sample);
      add({
        severity: 'medium',
        kind: 'viewer-admin',
        client: '(白名单审计)',
        method: w.method,
        path: sample,
        detail: `白名单条目放行，但 ${hit.r.file}:${hit.r.line} 处理器要求 admin，viewer 账号 403` +
          (via ? `；web/web-pro 亦在 ${via} 直接调用` : ''),
      });
    }
  }

  // R3：路由存在但白名单缺失
  const dlSample = '/lab/local-models/example/download';
  const dlRoute = matchers.find((m) => m.r.kind === 'regex' && m.test(dlSample));
  if (dlRoute && !whitelistHit('GET', dlSample)) {
    add({
      severity: 'medium',
      kind: 'whitelist-gap',
      client: '(潜在)app-uniapp',
      method: 'GET',
      path: dlSample,
      detail: `路由存在（${dlRoute.r.file}:${dlRoute.r.line}）但不在 viewer 白名单；移动端将来直连必 404（当前走原生桥）`,
      ref: 'R3',
    });
  }

  // ── 编号挂载与定级修正 ──
  for (const f of findings) {
    if (f.kind === 'missing-route' && f.path.startsWith('/dup-groups/')) {
      f.ref = 'R4';
      f.detail = '重复组概念已退役（src/api.js:7158 注释），旧管理台仍在调用：' + f.detail;
    }
    if (f.kind === 'dynamic-capture' && f.path === '/workflows/default') {
      f.ref = 'R5';
      f.severity = 'medium';
      f.detail = 'GET /workflows/default 无精确分支，被 /^\\/workflows\\/([^/]+)$/ 捕获（src/api.js:5952），default 行缺失时静默兜底返空';
    }
    if (f.kind === 'viewer-admin' && f.path === '/assets/trash/purge') f.ref = 'R6';
    if (f.kind === 'duplicate-route' && f.path === '/app/update/state') f.ref = 'R10';
  }

  // ── 鸿蒙专项（R1 + JSON.parse） ──
  const harmonyRel = 'harmony/material_sync/entry/src/main/ets/services/Api.ets';
  const harmonyText = read(harmonyRel);
  const baseMm = harmonyText.match(/BASE_URL[^=]*=\s*['"]([^'"]+)['"]/);
  if (baseMm && !/:30001\/?$/.test(baseMm[1])) {
    add({
      severity: 'high',
      kind: 'wrong-base-url',
      client: 'harmony',
      path: baseMm[1],
      detail: `默认 BASE_URL=${baseMm[1]} 端口错误，素材库正式端口为 30001；出厂配置不可用`,
      ref: 'R1',
    });
  }
  const parseCount = (harmonyText.match(/JSON\.parse\(/g) || []).length;
  add({
    severity: 'low',
    kind: 'unguarded-json-parse',
    client: 'harmony',
    path: 'Api.ets login()/ingestFile()',
    detail: `${parseCount} 处 JSON.parse 无 try/catch，错误页 HTML / 代理 502 会直接抛异常（B8 修）`,
  });

  // R2：死别名（导出指向未定义符号）
  const viewerApi = read('app-uniapp/src/service/ViewerApi.js');
  const aliasRe = /export\s+const\s+(\w+)\s*=\s*(\w+)\s*;?/g;
  let am;
  while ((am = aliasRe.exec(viewerApi))) {
    const lineNo = viewerApi.slice(0, am.index).split(/\r?\n/).length;
    const target = am[2];
    const defined = new RegExp(`(?:function|const|let|var)\\s+${target}\\b`).test(viewerApi) ||
      new RegExp(`import[\\s\\S]{0,300}?\\b${target}\\b`).test(viewerApi);
    if (!defined) {
      add({
        severity: 'medium',
        kind: 'dead-alias',
        client: 'app-uniapp',
        path: `ViewerApi.js:${lineNo}`,
        detail: `export const ${am[1]} = ${target}，但 ${target} 全文件未定义也未导入；模块加载即 ReferenceError（白屏风险），且全仓无人使用`,
        ref: 'R2',
      });
    }
  }

  // ── 汇总 ──
  const counts = {
    routes: routes.length,
    routesExact: routes.filter((r) => r.kind === 'exact').length,
    routesPrefix: routes.filter((r) => r.kind === 'prefix').length,
    routesRegex: routes.filter((r) => r.kind === 'regex').length,
    adminGuarded: routes.filter((r) => r.admin).length,
    whitelist: whitelist.length,
    whitelistDuplicated: whitelist.filter((w) => w.duplicated).length,
    clients: Object.fromEntries(Object.entries(clients).map(([k, v]) => [k, v.length])),
    findings: findings.length,
    bySeverity: {
      high: findings.filter((f) => f.severity === 'high').length,
      medium: findings.filter((f) => f.severity === 'medium').length,
      low: findings.filter((f) => f.severity === 'low').length,
    },
  };

  const rank = { high: 0, medium: 1, low: 2 };
  findings.sort((a, b) =>
    rank[a.severity] - rank[b.severity] ||
    a.kind.localeCompare(b.kind) ||
    (a.path || '').localeCompare(b.path || ''));

  return {
    generatedAt: new Date().toISOString(),
    generator: 'scripts/gen-contract-manifest.js',
    counts,
    routes,
    whitelist,
    clients,
    otherEndpoints: [
      { kind: 'ws', method: 'WS', path: '/api/push', source: 'src/ws-server.js', note: 'WebSocket 推送，query token 鉴权' },
      { kind: 'proxy', method: '*', path: '/editor-api/* 与 /editor/*', source: 'web-pro/server.cjs', note: '剪辑器反代与静态托管，非 src/api.js 路由' },
      { kind: 'plugin', method: '*', path: '/plugins/material/api/*', source: 'index.js', note: 'DSH 插件形态挂载，同一张路由表（旧管理台双前缀）' },
    ],
    findings,
  };
}

/* ================================================================== */
/* 基线自测：扫描器悄悄失效时必须报错                                    */
/* ================================================================== */

function selfCheck(m) {
  const errs = [];
  const c = m.counts;
  // 计数下限：2026-11-03 实测 374/242/126 路由、138 白名单、268 客户端调用。
  if (c.routes < 360) errs.push(`路由总数 ${c.routes} < 360`);
  if (c.routesExact < 230) errs.push(`精确路由 ${c.routesExact} < 230`);
  if (c.routesRegex < 110) errs.push(`正则路由 ${c.routesRegex} < 110`);
  if (c.whitelist < 130) errs.push(`白名单条目 ${c.whitelist} < 130（区块 1437-1579）`);
  if (c.clients.web < 120) errs.push(`web 调用 ${c.clients.web} < 120`);
  if (c.clients['web-pro'] < 95) errs.push(`web-pro 调用 ${c.clients['web-pro']} < 95`);
  if (c.clients['app-uniapp'] < 35) errs.push(`app 调用 ${c.clients['app-uniapp']} < 35`);
  if (c.clients.harmony !== 2) errs.push(`harmony 应恰好 2 个端点，实得 ${c.clients.harmony}`);
  if (c.bySeverity.high !== 1) errs.push(`高危 finding 应恰好 1（R1），实得 ${c.bySeverity.high}`);

  // 精度锚点：以下事实均在 2026-11-03 逐条人工核实。
  // B6/B8 修契约时必须同步更新这里——锚点漂移即说明扫描器或契约发生了变化。
  const byKind = {};
  for (const f of m.findings) byKind[f.kind] = (byKind[f.kind] || 0) + 1;
  if (byKind['viewer-admin'] !== 16) errs.push(`viewer-admin 漂移：期望 16（16 个白名单放行/admin 处理器），实得 ${byKind['viewer-admin'] || 0}`);
  if (byKind['missing-route'] !== 3) errs.push(`missing-route 漂移：期望仅 3 个 R4 dup-groups，实得 ${byKind['missing-route'] || 0}`);
  const mr = m.findings.filter((f) => f.kind === 'missing-route');
  if (mr.some((f) => !f.path.startsWith('/dup-groups/'))) errs.push('missing-route 出现非 R4 路径：' + mr.map((f) => f.path).join(','));
  if (byKind['duplicate-route'] !== 1) errs.push(`duplicate-route 期望 1（R10），实得 ${byKind['duplicate-route'] || 0}`);
  if (c.whitelistDuplicated !== 2) errs.push(`白名单重复条目期望 2，实得 ${c.whitelistDuplicated}`);
  const regressions = m.findings.filter((f) =>
    /paints\/mirror|custom-styles|users\/|exceptions\/|presets\/|dict\/audit/.test(f.path || ''));
  if (regressions.length) errs.push('已核实存在的路由被误报：' + regressions.map((f) => `${f.kind} ${f.path}`).join('; '));
  const must = [
    (f) => f.ref === 'R10' && f.path === '/app/update/state',
    (f) => f.kind === 'duplicate-whitelist' && c.whitelistDuplicated === 2,
    (f) => f.ref === 'R3',
    (f) => f.ref === 'R4' && f.path.includes('/dup-groups/recluster'),
    (f) => f.ref === 'R5' && f.path === '/workflows/default',
    (f) => f.ref === 'R6' && f.path === '/assets/trash/purge',
    (f) => f.ref === 'R1',
    (f) => f.ref === 'R2',
  ];
  must.forEach((pred, i) => {
    if (!m.findings.some(pred)) errs.push(`基线 finding #${i + 1} 缺失`);
  });
  return errs;
}

function main() {
  const m = generate();
  const errs = selfCheck(m);
  const printFindings = () => {
    for (const f of m.findings) {
      console.log(`  [${f.severity}] ${f.kind} ${f.client || ''} ${f.method || ''} ${f.path || ''} — ${f.detail.slice(0, 140)}`);
    }
  };
  if (process.argv.includes('--check')) {
    console.log('[contract] counts:', JSON.stringify(m.counts));
    printFindings();
    if (errs.length) {
      console.error('[contract] 基线自测失败：');
      for (const e of errs) console.error('  - ' + e);
      process.exit(1);
    }
    console.log('[contract] 基线自测通过');
    return;
  }
  const out = path.join(ROOT, 'docs', 'contract-manifest.json');
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, JSON.stringify(m, null, 2) + '\n');
  console.log(`[contract] 已写入 ${path.relative(ROOT, out)}`);
  console.log('[contract] counts:', JSON.stringify(m.counts));
  if (errs.length) {
    console.error('[contract] 基线自测失败：');
    for (const e of errs) console.error('  - ' + e);
    process.exit(1);
  }
}

if (require.main === module) main();
module.exports = { generate, selfCheck };
