/**
 * 幂等写入精细风格与风格方案：
 *   node scripts/seed-style-schemes.js --dry-run
 *   node scripts/seed-style-schemes.js
 *   node scripts/seed-style-schemes.js --style italian_minimal
 */
const path = require('path');
const { openDb } = require('../src/db');
const { seedStyleSchemes } = require('../src/base-library/style-schemes.seed');

const dataDir = process.env.ML_DATA_DIR || path.join(process.env.HOME || process.env.USERPROFILE, '.dsh-material-library');
const db = openDb(dataDir);
const args = process.argv.slice(2);
const dryRun = args.includes('--dry-run');
const styleArg = (() => {
  const i = args.indexOf('--style');
  return i >= 0 ? args[i + 1] : '';
})();

const result = seedStyleSchemes(db, { dryRun, style: styleArg });
console.log(JSON.stringify(result, null, 2));
if (dryRun) console.log('dry-run：未写入数据库。');
