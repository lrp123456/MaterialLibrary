/**
 * 全库图片去重 CLI
 * 用法:
 *   node scripts/dedupe-library.js                 # dry-run 报告
 *   node scripts/dedupe-library.js --out report.csv
 *   node scripts/dedupe-library.js --apply         # 确认后真正删除并拉黑
 *   node scripts/dedupe-library.js --json report.json
 */
const path = require('path');
const fs = require('fs');
const { openDb } = require('../src/db');
const { scanLibraryDuplicates, applyDedupePairs, formatReportCsv } = require('../src/dedupe-library');

function arg(name, def = null) {
  const i = process.argv.indexOf(name);
  if (i >= 0 && process.argv[i + 1] && !process.argv[i + 1].startsWith('--')) return process.argv[i + 1];
  return def;
}

function has(name) {
  return process.argv.includes(name);
}

async function main() {
  const dataDir = arg('--data', path.join(__dirname, '..', 'data'));
  const apply = has('--apply');
  const outCsv = arg('--out', '');
  const outJson = arg('--json', '');

  const db = openDb(dataDir);
  const services = {
    db,
    config: { dataDir },
    logger: console,
  };

  console.log(`[dedupe-library] dataDir=${dataDir} mode=${apply ? 'APPLY' : 'DRY-RUN'}`);
  const report = scanLibraryDuplicates(services, {
    dryRun: !apply,
    readExportTags: !has('--no-tags'),
    phashStrict: Number(arg('--phash-strict', '')) || undefined,
    phashNear: Number(arg('--phash-near', '')) || undefined,
  });

  console.log(`scanned=${report.scanned} matched=${report.matched}`);
  for (const p of (report.pairs || []).slice(0, 50)) {
    console.log(
      `  KEEP ${p.keepFid} (${p.keepName})  DROP ${p.dropFid} (${p.dropName})  ${p.reason}  ${p.note || ''}`
    );
  }
  if ((report.pairs || []).length > 50) console.log(`  ... and ${report.pairs.length - 50} more`);

  const csv = formatReportCsv(report);
  const csvPath = outCsv || path.join(dataDir, `dedupe-report-${Date.now()}.csv`);
  fs.writeFileSync(csvPath, csv, 'utf8');
  console.log(`report csv: ${csvPath}`);
  if (outJson) {
    fs.writeFileSync(outJson, JSON.stringify(report, null, 2), 'utf8');
    console.log(`report json: ${outJson}`);
  }

  if (apply) {
    const r = applyDedupePairs(services, report.pairs || []);
    console.log(`applied deleted=${r.deleted} failed=${r.failed}`);
  } else {
    console.log('未删除。确认无误后加 --apply 执行删除并拉黑。');
  }

  try { db.close(); } catch (_) {}
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
