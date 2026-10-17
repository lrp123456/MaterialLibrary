/**
 * 实机验证：跑一次完整隔离编译（不压缩、不推送）
 */
const path = require('path');
const fs = require('fs');
const { freshBuild } = require('./lib/fresh-build');

const APP = 'C:\\Users\\lrp\\DevEcoStudioProjects\\AlbumSyncUniAppX';

function srcFingerprint() {
  const crypto = require('crypto');
  const root = path.join(APP, 'src');
  const h = crypto.createHash('sha256');
  let n = 0;
  (function walk(d) {
    for (const name of fs.readdirSync(d).sort()) {
      const p = path.join(d, name);
      const st = fs.statSync(p);
      if (st.isDirectory()) walk(p);
      else {
        h.update(path.relative(root, p));
        h.update(fs.readFileSync(p));
        n++;
      }
    }
  })(root);
  return { files: n, sha: h.digest('hex').slice(0, 24) };
}

const before = srcFingerprint();
console.log('[before] src =', JSON.stringify(before));

freshBuild(APP, (l) => process.stdout.write(l))
  .then((r) => {
    const after = srcFingerprint();
    console.log('\n[after ] src =', JSON.stringify(after));
    console.log('[SAFE  ] 源码只读 =', before.sha === after.sha && before.files === after.files ? 'PASS' : 'FAIL');
    console.log('[receipt]', JSON.stringify(r, null, 2));
  })
  .catch((e) => {
    const after = srcFingerprint();
    console.log('\n[after ] src =', JSON.stringify(after));
    console.log('[SAFE  ] 源码只读 =', before.sha === after.sha ? 'PASS' : 'FAIL');
    console.log('[GATE  ] 如实报错 =', e.message);
    console.log('[ERRS  ]', JSON.stringify(e.buildErrors || [], null, 2));
    process.exitCode = 1;
  });
