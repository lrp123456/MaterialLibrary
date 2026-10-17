/**
 * _bisect_ifdef.js · 定位 uni:app-inject 报 "Expected a semicolon" 的确切行
 *
 * 方法：把 AppUpdater.js 的条件编译块按不同组合剥离，
 *       每一份都用 node --check 试一遍，找出哪种组合会破。
 * 注意：node --check 和 uni:app-inject 的解析器不同，
 *       所以这里同时输出「剥离后代码」供人工核对。
 */
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const SRC = 'C:\\Users\\lrp\\DevEcoStudioProjects\\AlbumSyncUniAppX\\src\\service\\AppUpdater.js';
const code = fs.readFileSync(SRC, 'utf8');
const tmp = path.join(require('os').tmpdir(), 'bisect_ifdef.js');

function check(label, src) {
  fs.writeFileSync(tmp, src, 'utf8');
  try {
    execFileSync('C:\\Users\\lrp\\.workbuddy\\binaries\\node\\versions\\22.22.2-3\\node.exe',
      ['--check', tmp], { stdio: 'pipe' });
    console.log('  [OK]   ' + label);
    return true;
  } catch (e) {
    const m = (e.stderr || '').toString().split(/\r?\n/).filter((l) => /Error|\^/.test(l));
    console.log('  [FAIL] ' + label + '  ' + (m[0] || '').trim());
    return false;
  }
}

// uni's app-inject 会把 #ifndef APP-PLUS 之外的内容保留，
// 并对保留内容做「去掉注释+压缩」处理。关键风险点：
//   条件编译块里出现 /* */ 块注释跨越了 #endif
console.log('=== A. 条件编译指令清单 ===');
const lines = code.split(/\r?\n/);
lines.forEach((l, i) => {
  if (/^\s*\/\/#(ifdef|ifndef|endif)/.test(l)) {
    console.log('  ' + String(i + 1).padStart(4) + ': ' + l.trim());
  }
});

console.log('\n=== B. 配对检查（#ifdef 与 #endif 必须成对）===');
let depth = 0, bad = false;
lines.forEach((l, i) => {
  const t = l.trim();
  if (/^\/\/#(ifdef|ifndef)/.test(t)) depth++;
  if (/^\/\/#endif/.test(t)) { depth--; if (depth < 0) { console.log('  ✗ 第 ' + (i + 1) + ' 行 #endif 多了'); bad = true; depth = 0; } }
});
if (depth !== 0) { console.log('  ✗ 结束时 depth=' + depth + '（有未闭合的 #ifdef）'); bad = true; }
if (!bad) console.log('  ✓ 全部配对');

console.log('\n=== C. 块注释是否跨越 #endif（uni inject 的经典坑）===');
let inBlock = false, blockStart = 0;
lines.forEach((l, i) => {
  if (!inBlock && /\/\*/.test(l)) { inBlock = true; blockStart = i + 1; }
  if (inBlock && /\*\//.test(l.slice(l.indexOf('*/') + 2))) inBlock = false;
  if (inBlock && /^\s*\/\/#(ifdef|ifndef|endif)/.test(l)) {
    console.log('  ✗ 第 ' + (i + 1) + ' 行的条件编译指令落在 /* */ 块注释里（起始 ' + blockStart + ' 行）');
    bad = true;
  }
});
if (!bad) console.log('  ✓ 条件编译指令都在块注释外');

console.log('\n=== D. 语法检查 ===');
check('原文件', code);
check('去掉所有条件编译指令行', code.replace(/^\s*\/\/#(ifdef|ifndef|endif).*$/gm, ''));
check('只保留 #ifdef APP-PLUS 块内内容',
  code.split(/\r?\n/).filter((l) => !/^\s*\/\/#(ifndef|endif)/.test(l)).join('\n'));

console.log('\n=== E. 逐个函数剥离，定位问题函数 ===');
// 找出所有顶层 function/async function，切出来单独检查
const fnRe = /^(async )?function (\w+)\(/gm;
let m, fns = [];
while ((m = fnRe.exec(code))) fns.push({ name: m[2], start: m.index });
console.log('  共 ' + fns.length + ' 个顶层函数');
// 简单法：把每个函数体删掉，看哪个删掉后能过
for (let i = 0; i < fns.length; i++) {
  const start = fns[i].start;
  const end = i + 1 < fns.length ? fns[i + 1].start : code.length;
  const cut = code.slice(0, start) + '// [removed ' + fns[i].name + ']\n' + code.slice(end);
  const before = code;
  // 只关心：原文件失败 且 删掉这个函数后通过 → 该函数有问题
  if (!check('删除 ' + fns[i].name, cut)) continue;
  console.log('       ^ 删掉它就通过了 ⇒ 问题在 ' + fns[i].name);
}

console.log('\n=== F. 新增函数的实际内容（人工核对）===');
['persistWgt', 'fsencodeFallback', 'copyToTarget', 'describePlusError', 'verifyFileExists'].forEach((n) => {
  const i = fns.findIndex((f) => f.name === n);
  if (i < 0) { console.log('  (无 ' + n + ')'); return; }
  const start = fns[i].start;
  const end = i + 1 < fns.length ? fns[i + 1].start : code.length;
  const body = code.slice(start, end);
  const nIf = (body.match(/#ifdef|#ifndef/g) || []).length;
  const nEnd = (body.match(/#endif/g) || []).length;
  console.log('  ' + n + ': ' + body.split(/\r?\n/).length + ' 行, #ifdef/#ifndef=' + nIf + ' #endif=' + nEnd +
    (nIf === nEnd ? ' ✓配对' : ' ✗不配对'));
});
