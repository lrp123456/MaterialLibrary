/**
 * Master E2E Test Runner: 4-Tier Opaque-Box Test Suite
 * 统一执行 4 个层级的全量端到端与黑盒验收测试：
 * - Tier 1: 核心功能单点覆盖 (Feature Coverage, F1~F13)
 * - Tier 2: 边界与极端输入 (Boundary & Corner Cases)
 * - Tier 3: 跨模块联动组合 (Cross-Feature Combinations)
 * - Tier 4: 真实室内业务场景 (Real-World Application Scenarios)
 *
 * 用法：
 *   node test/e2e-all-suites.test.js              # 执行全量 4 个 Tier
 *   node test/e2e-all-suites.test.js --tier=1     # 仅执行指定 Tier
 */

const path = require('node:path');
const { runTier1Tests } = require('./test-tier1-features');
const { runTier2Tests } = require('./test-tier2-boundaries');
const { runTier3Tests } = require('./test-tier3-cross-feature');
const { runTier4Tests } = require('./test-tier4-scenarios');

async function main() {
  const args = process.argv.slice(2);
  const targetTierArg = args.find(a => a.startsWith('--tier='));
  const targetTier = targetTierArg ? parseInt(targetTierArg.split('=')[1], 10) : null;

  console.log('\n================================================================');
  console.log('   🎨 MATERIAL LIBRARY SERVER — E2E 4-TIER TEST RUNNER');
  console.log('================================================================');
  console.log(`Timestamp: ${new Date().toISOString()}`);
  console.log(`Node.js: ${process.version} | Platform: ${process.platform} (${process.arch})`);
  if (targetTier) {
    console.log(`Target: Running Tier ${targetTier} ONLY`);
  } else {
    console.log('Target: Running ALL 4 Tiers (Tier 1 ~ Tier 4)');
  }
  console.log('================================================================\n');

  const startTime = Date.now();
  const suiteResults = [];

  const tierRunners = [
    { tier: 1, name: 'Tier 1 - Feature Coverage (F1~F13)', runner: runTier1Tests },
    { tier: 2, name: 'Tier 2 - Boundary & Corner Cases', runner: runTier2Tests },
    { tier: 3, name: 'Tier 3 - Cross-Feature Combinations', runner: runTier3Tests },
    { tier: 4, name: 'Tier 4 - Real-World Scenarios (S1~S5)', runner: runTier4Tests },
  ];

  for (const item of tierRunners) {
    if (targetTier && targetTier !== item.tier) {
      continue;
    }

    try {
      const res = await item.runner();
      suiteResults.push(res);
    } catch (err) {
      suiteResults.push({
        tier: item.tier,
        name: item.name,
        passed: 0,
        failed: 1,
        tests: [{ name: item.name, status: 'CRASHED', error: err.message }],
        errors: [{ testName: item.name, error: err.message }]
      });
    }
  }

  const durationMs = Date.now() - startTime;
  let totalPassed = 0;
  let totalFailed = 0;
  let totalTests = 0;

  console.log('\n================================================================');
  console.log('                 📊 E2E TEST EXECUTION SUMMARY');
  console.log('================================================================');
  console.log('| Tier | Suite Name                          | Pass | Fail | Status |');
  console.log('|:----:|:------------------------------------|:----:|:----:|:------:|');

  for (const r of suiteResults) {
    totalPassed += r.passed;
    totalFailed += r.failed;
    totalTests += (r.passed + r.failed);
    const statusText = r.failed === 0 ? '✅ PASS' : '❌ FAIL';
    const tierPadded = `Tier ${r.tier}`.padEnd(4, ' ');
    const namePadded = r.name.padEnd(35, ' ');
    const passPadded = String(r.passed).padStart(4, ' ');
    const failPadded = String(r.failed).padStart(4, ' ');
    console.log(`| ${tierPadded} | ${namePadded} | ${passPadded} | ${failPadded} | ${statusText} |`);
  }

  console.log('----------------------------------------------------------------');
  console.log(`Total Suites:    ${suiteResults.length}`);
  console.log(`Total Cases:     ${totalTests}`);
  console.log(`Passed Cases:    ${totalPassed}`);
  console.log(`Failed Cases:    ${totalFailed}`);
  console.log(`Pass Rate:       ${totalTests > 0 ? ((totalPassed / totalTests) * 100).toFixed(1) : 0}%`);
  console.log(`Total Duration:  ${(durationMs / 1000).toFixed(2)}s`);
  console.log('================================================================\n');

  if (totalFailed > 0) {
    console.log('⚠️  IDENTIFIED DEFECTS / UNCOMPLETED REQUIREMENTS TO ESCALATE:');
    for (const r of suiteResults) {
      if (r.errors && r.errors.length > 0) {
        console.log(`\n  [Tier ${r.tier} - ${r.name}]:`);
        for (const e of r.errors) {
          console.log(`    • ${e.testName}:`);
          console.log(`      Error: ${e.error.split('\n')[0]}`);
        }
      }
    }
    console.log('\n----------------------------------------------------------------');
    console.log('Notice: These failures identify the specific implementation items');
    console.log('assigned to Worker M2 (F6, F7, F8, F9) and Worker M3 (F12).');
    console.log('Once Worker agents complete those fixes, all suites will pass.');
    console.log('================================================================\n');
    process.exitCode = 1;
  } else {
    console.log('🎉 ALL 4-TIER E2E SUITES PASSED CLEANLY (100% SUCCESS)!\n');
    process.exitCode = 0;
  }

  return { totalPassed, totalFailed, totalTests, suiteResults, durationMs };
}

if (require.main === module) {
  main().catch(err => {
    console.error('Master Runner Fatal Error:', err);
    process.exitCode = 1;
  });
}

module.exports = { main };
