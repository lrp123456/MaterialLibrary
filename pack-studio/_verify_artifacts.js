/**
 * 实机验证 3：出包同源闸门
 * 证明：把别的目录冒充成「本次编译产物」时，压缩阶段会被字节级校验拦下。
 */
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { zipDir } = require('./lib/wgt-pipeline');
const { verifyWgt } = require('./lib/wgt-verify');

const APP = 'C:\\Users\\lrp\\DevEcoStudioProjects\\AlbumSyncUniAppX';
const TMP = require('os').tmpdir();

// 拿一个「历史产物」目录当冒充者
const STALE = path.join(APP, 'unpackage', 'resources', '__UNI__F183218', 'www');
const FRESH_DIR = (() => {
  const root = path.join(TMP, 'pack-studio-fresh-build');
  if (!fs.existsSync(root)) return null;
  const dirs = fs
    .readdirSync(root)
    .map((d) => path.join(root, d, 'dist', 'build', 'app'))
    .filter((p) => fs.existsSync(path.join(p, 'app-service.js')))
    .sort((a, b) => fs.statSync(b).mtimeMs - fs.statSync(a).mtimeMs);
  return dirs[0] || null;
})();

function sha(p) {
  return crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
}

let pass = 0;
let fail = 0;
function check(name, cond) {
  console.log((cond ? '  [PASS] ' : '  [FAIL] ') + name);
  cond ? pass++ : fail++;
}

console.log('=== A. 正常情形：收据与压缩源一致 ===');
if (!FRESH_DIR) {
  console.log('  缺少可用的隔离编译产物，先跑 _verify_freshbuild.js');
  process.exit(1);
}
const svc = path.join(FRESH_DIR, 'app-service.js');
const receipt = {
  www: FRESH_DIR,
  appServiceSha256: sha(svc),
  appServiceBytes: fs.statSync(svc).size,
};
const outA = path.join(TMP, 'verify-ok.wgt');
zipDir(FRESH_DIR, outA);
try {
  const v = verifyWgt(outA, receipt);
  check('同源 wgt 校验通过', v.sameAsBuild === true);
  check('sha256 一致', v.appServiceSha256 === receipt.appServiceSha256);
} catch (e) {
  check('同源 wgt 校验通过（不应抛错）: ' + e.message, false);
}

console.log('\n=== B. 冒充情形：压缩了历史目录，收据却是新产物 ===');
if (fs.existsSync(path.join(STALE, 'app-service.js'))) {
  const outB = path.join(TMP, 'verify-stale.wgt');
  zipDir(STALE, outB);
  try {
    verifyWgt(outB, receipt);
    check('历史产物应被拒绝', false);
  } catch (e) {
    check('历史产物被拒绝', true);
    console.log('         错误信息: ' + e.message.split('\n')[0]);
  }
} else {
  // 没有历史目录就伪造：把收据的 sha 改掉，等价于「包内容不是这次编出来的」
  const outB = path.join(TMP, 'verify-mismatch.wgt');
  zipDir(FRESH_DIR, outB);
  try {
    verifyWgt(outB, { ...receipt, appServiceSha256: 'deadbeef'.repeat(8) });
    check('sha 不一致应被拒绝', false);
  } catch (e) {
    check('sha 不一致被拒绝', true);
    console.log('         错误信息: ' + e.message.split('\n')[0]);
  }
}

console.log('\n=== C. 残包：缺少 app-service.js ===');
const outC = path.join(TMP, 'verify-broken.wgt');
fs.writeFileSync(outC, Buffer.from('PK' + '\0'.repeat(18), 'binary'));
try {
  verifyWgt(outC, receipt);
  check('损坏包应被拒绝', false);
} catch (e) {
  check('损坏包被拒绝', true);
  console.log('         错误信息: ' + e.message.split('\n')[0]);
}

console.log('\n结果: ' + pass + ' PASS / ' + fail + ' FAIL');
process.exitCode = fail ? 1 : 0;
