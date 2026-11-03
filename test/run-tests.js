#!/usr/bin/env node
/**
 * 显式清单测试运行器（B9）
 *
 * 设计原则：
 *  - 所有进门禁的测试必须登记在下方 MANIFEST，禁止 glob 自动收集（防止探针/临演混入）；
 *  - 每个测试以独立子进程运行：环境变量（ML_DATA_DIR / ML_PORT 等）互不污染；
 *  - 全程离线：只允许 127.0.0.1 临时端口与临时数据目录，不得依赖外网与生产库；
 *  - 聚合退出码：任一失败即非零；默认只打印摘要，失败时转储该用例全部输出。
 *
 * 用法：
 *   node test/run-tests.js                     # 跑全部分类
 *   node test/run-tests.js unit security       # 只跑指定分类
 *   node test/run-tests.js --list              # 列出清单不执行
 *   node test/run-tests.js -v                  # 实时打印每个用例输出
 *   node test/run-tests.js --only=clip         # 只跑文件名包含 clip 的用例
 *
 * 注意（不要接线）：
 *  - test-tier1~4-*.js 是 e2e-all-suites 的子套件，带 require.main 守卫且无 .test.js 后缀；
 *  - suite.js / e2e.js 是早期单体套件，作为整体登记在清单内。
 */
const path = require('path');
const { spawnSync } = require('child_process');

const ROOT = path.join(__dirname, '..');

// 共享 node_modules 的双平台保障（详见 test/lib/native-bindings.js 头注释）：
//  - Windows node24 无 better-sqlite3 11.10 预编译件，自动改道本机 node22（ABI127）；
//  - 门禁期间把 better_sqlite3.node 切到当前平台，退出时无条件还原为 linux（prod 静置件）。
const nativeBindings = require('./lib/native-bindings');
{
  const rerouteExe = nativeBindings.rerouteTarget();
  if (rerouteExe) {
    console.error(`[run-tests] 当前 Node ${process.version}(ABI${process.versions.modules}) 缺原生预编译件，改道 ${rerouteExe}`);
    const r = spawnSync(rerouteExe, [__filename, ...process.argv.slice(2)], { stdio: 'inherit' });
    process.exit(r.status == null ? 1 : r.status);
  }
  nativeBindings.ensureForCurrentProcess();
}

// timeout 单位毫秒；e2e 大类给宽限
const DEFAULT_MS = 180000;
const E2E_MS = 420000;

const MANIFEST = [
  // ---------- unit：纯函数/纯数据契约，不开库不起服务 ----------
  ['unit', 'classify-parse.test.js'],
  ['unit', 'classify-part.test.js'],
  ['unit', 'crop-selection-interior.test.js'],
  ['unit', 'auto-adaptive-dispatch.test.js'],
  ['unit', 'base-library-compile.test.js'],
  ['unit', 'base-attr-selection.test.js'],
  ['unit', 'catalog-distill.test.js'],
  ['unit', 'curated-paints.test.js'],
  ['unit', 'frame-relay.test.js'],
  ['unit', 'gap-closure.test.js'],
  ['unit', 'gate-route.test.js'],
  ['unit', 'guide-sentence.test.js'],
  ['unit', 'outpaint-layout.test.js'],
  ['unit', 'part-policy.test.js'],
  ['unit', 'pretint.test.js'],
  ['unit', 'product-cover.test.js'],
  ['unit', 'qwenimage-local.test.js'],

  // ---------- security：鉴权/凭据隔离/对抗输入 ----------
  ['security', 'auth-audit.test.js'],
  ['security', 'xu40-contract.test.js'],
  ['security', 'stress-m2-corner-cases.test.js'],
  ['security', 'adversarial-stress-m1.test.js'],

  // ---------- integration：临时库 / 127.0.0.1 临时端口 / 子进程桩 ----------
  ['integration', 'ba-created-at.test.js'],
  ['integration', 'ba-schemes.test.js'],
  ['integration', 'ba-video-tags.test.js'],
  ['integration', 'master-dictionary-crud.test.js'],
  ['integration', 'modular-workflow-governance.test.js'],
  ['integration', 'prompt-optimizer-xu41.test.js'],
  ['integration', 'v3-review-fixes.test.js'],
  ['integration', 'four-stage-architecture.test.js'],
  ['integration', 'paint-mirror-upsert.test.js'],
  ['integration', 'cascade-fallback-store.test.js'],
  ['integration', 'base-items-pinned-use.test.js'],
  ['integration', 'paint-alias.test.js'],
  ['integration', 'base-library-flags.test.js'],
  ['integration', 'base-library-list.test.js'],
  ['integration', 'base-library-prefill.test.js'],
  ['integration', 'scheme-apply.test.mjs'],
  ['integration', 'space-filter.test.mjs'],
  ['integration', 'scheme-browse.test.mjs'],
  ['integration', 'ai-tasks.test.js'],
  ['integration', 'lab.test.js'],
  ['integration', 'quick-pipeline.test.js'],
  ['integration', 'portrait-music.test.js'],
  ['integration', 'admin-model.test.js'],
  ['integration', 'creation-templates-since.test.js'],
  ['integration', 'gen-video-payload-offline.test.js'],
  ['integration', 'clip-api.test.js'],
  ['integration', 'mlsclip.test.js'],
  ['integration', 'app-update-canary.test.js'],
  ['integration', 'suite.js'],

  // ---------- e2e：起真实 HTTP 服务的端到端链路 ----------
  ['e2e', 'e2e.js', E2E_MS],
  ['e2e', 'e2e-all-suites.test.js', E2E_MS],
  ['e2e', 'v4-e2e-verification.test.js', E2E_MS],
].map(([cat, file, ms]) => ({ cat, file, ms: ms || DEFAULT_MS }));

const CATS = ['unit', 'security', 'integration', 'e2e'];
const CAT_LABEL = { unit: '单元', security: '安全', integration: '集成', e2e: '端到端' };

function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--list')) {
    for (const c of CATS) {
      const items = MANIFEST.filter((m) => m.cat === c);
      console.log(`\n[${c}] ${items.length} 项`);
      for (const m of items) console.log(`  ${m.file}`);
    }
    return 0;
  }
  const verbose = argv.includes('-v') || argv.includes('--verbose');
  const only = (argv.find((a) => a.startsWith('--only=')) || '').slice(7);
  const wantCats = argv.filter((a) => CATS.includes(a));
  const selected = MANIFEST.filter((m) => {
    if (wantCats.length && !wantCats.includes(m.cat)) return false;
    if (only && !m.file.includes(only)) return false;
    return true;
  });
  if (!selected.length) {
    console.error('没有匹配的测试用例。');
    return 2;
  }

  console.log(`测试清单：${selected.length} 项（${wantCats.length ? wantCats.join('+') : '全部分类'}）\n`);
  const results = [];
  const startedAt = Date.now();
  let lastCat = '';
  for (const m of selected) {
    if (m.cat !== lastCat) {
      console.log(`\n===== ${CAT_LABEL[m.cat]}（${m.cat}）=====`);
      lastCat = m.cat;
    }
    const file = path.join(ROOT, 'test', m.file);
    const t0 = Date.now();
    const r = spawnSync(process.execPath, [file], {
      cwd: ROOT,
      env: process.env,
      encoding: 'utf8',
      timeout: m.ms,
      maxBuffer: 32 * 1024 * 1024,
    });
    const dur = ((Date.now() - t0) / 1000).toFixed(1);
    const output = `${r.stdout || ''}${r.stderr || ''}`;
    let ok = r.status === 0;
    let reason = '';
    if (r.error && r.error.code === 'ETIMEDOUT') { ok = false; reason = `超时 ${m.ms}ms`; }
    else if (r.error) { ok = false; reason = r.error.message; }
    else if (r.status !== 0) reason = `exit ${r.status}`;
    results.push({ ...m, ok, dur, reason, output });
    if (ok) {
      console.log(`  ✓ ${m.file.padEnd(42)} ${dur}s`);
      if (verbose) process.stdout.write(output.replace(/^/gm, '    '));
    } else {
      console.log(`  ✗ ${m.file.padEnd(42)} ${dur}s  ${reason}`);
      // 失败时转储输出（-v 已实时打印则不重复）
      if (!verbose) process.stdout.write(output.replace(/^/gm, '      ') + '\n');
    }
  }

  const total = results.length;
  const failed = results.filter((r) => !r.ok);
  const passed = total - failed.length;
  const wall = ((Date.now() - startedAt) / 1000).toFixed(1);
  console.log('\n========================================');
  console.log(`合计 ${total} 项：${passed} 通过，${failed.length} 失败，用时 ${wall}s`);
  for (const c of CATS) {
    const items = results.filter((r) => r.cat === c);
    if (!items.length) continue;
    const bad = items.filter((r) => !r.ok).length;
    console.log(`  ${CAT_LABEL[c].padEnd(4)} ${items.length - bad}/${items.length}`);
  }
  if (failed.length) {
    console.log('\n失败用例：');
    for (const f of failed) console.log(`  - ${f.file}（${f.reason}）`);
    return 1;
  }
  console.log('🎉 全部通过');
  return 0;
}

process.exit(main());
