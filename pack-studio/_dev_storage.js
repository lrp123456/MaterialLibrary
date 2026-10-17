/**
 * 读写设备端 uni-app 的 storage（DCStorage sqlite）。
 *
 * 为什么需要它：uni 的 uni.setStorageSync 写进的是
 *   /data/user/0/<pkg>/databases/DCStorage（sqlite，WAL 模式）
 * 而不是 shared_prefs。只看 shared_prefs 会得出「key 不存在」的错误结论
 * （设备实证：app_update_last_check 只在 DCStorage 里）。
 *
 * 流程：root → force-stop → 拉 {db,-wal,-shm} → 本地改 → 推回 → 改回属主。
 * 必须先 force-stop，否则 App 进程持有的 WAL 会覆盖我们的修改。
 *
 * 用法：
 *   node _dev_storage.js list
 *   node _dev_storage.js del app_update_last_check app_update_skipped_wgt
 *   node _dev_storage.js set app_update_last_check 0
 */
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ADB = 'C:/Program Files/Microvirt/MEmu/adb.exe';
const S = '127.0.0.1:21503';
const PKG = 'lrp.aibum';
const REMOTE = '/data/user/0/' + PKG + '/databases/DCStorage';
const WORK = path.join(__dirname, 'dcstorage');
const PY = 'C:/Users/lrp/.workbuddy/binaries/python/envs/default/Scripts/python.exe';

function adb(args, opts = {}) {
  return execFileSync(ADB, ['-s', S, ...args], {
    encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, ...opts,
  });
}
function sh(cmd) {
  try { return adb(['shell', 'sh', '-c', cmd]).trim(); }
  catch (e) { return 'ERR ' + ((e.stderr || e.message) + '').trim(); }
}
function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

function py(script) {
  const f = path.join(WORK, '_run.py');
  fs.writeFileSync(f, script, 'utf8');
  return execFileSync(PY, [f], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
}

function ensureRoot() {
  const who = sh('id -u');
  if (who.trim() === '0') return;
  adb(['root'], { stdio: 'pipe' });
  sleep(4000); // adb root 会重启 adbd，期间 /data 短暂不可访问
}

function tableNames(local) {
  return py(`
import sqlite3, json
c = sqlite3.connect(r'${local}')
print(json.dumps([r[0] for r in c.execute("select name from sqlite_master where type='table'")], ensure_ascii=False))
`).trim().split('\n').pop();
}

function listAll() {
  ensureRoot();
  sh('am force-stop ' + PKG);
  sleep(1200);
  fs.mkdirSync(WORK, { recursive: true });
  for (const f of fs.readdirSync(WORK)) {
    if (/^DCStorage/.test(f)) fs.rmSync(path.join(WORK, f), { force: true });
  }
  for (const suffix of ['', '-wal', '-shm']) {
    try { adb(['pull', REMOTE + suffix, path.join(WORK, 'DCStorage' + suffix)], { stdio: 'pipe' }); }
    catch (e) { /* WAL/SHM 不存在是正常的 */ }
  }
  const local = path.join(WORK, 'DCStorage');
  if (!fs.existsSync(local)) throw new Error('拉取 DCStorage 失败');
  const tables = JSON.parse(tableNames(local));
  return py(`
import sqlite3, json
c = sqlite3.connect(r'${local}')
out = []
for t in ${JSON.stringify(tables)}:
    if not t.endswith('_storage'): continue
    for k, v, ts in c.execute('select key, value, timestamp from "' + t + '"'):
        out.append({'table': t, 'key': k, 'value': (str(v)[:200] if v is not None else None), 'ts': ts})
print(json.dumps(out, ensure_ascii=False, indent=1))
`);
}

/** 本地改完再推回。App 必须处于 force-stop 状态，否则它的 WAL 会覆盖修改。 */
function pushBack(local) {
  ensureRoot();
  sh('am force-stop ' + PKG);
  sleep(1200);
  sh('chmod 777 ' + path.dirname(REMOTE));
  sh('cp ' + local + ' ' + REMOTE);
  // WAL 模式下如果只替换主库、不动 -wal，sqlite 会拿旧 WAL 覆盖回去，必须清掉
  sh('rm -f ' + REMOTE + '-wal ' + REMOTE + '-shm');
  // 属主必须回到 App 的 uid，否则 App 起来后会因权限失败而崩
  const uid = sh("stat -c '%u' /data/user/0/" + PKG).trim();
  if (uid && uid !== '0') {
    sh('chown -R ' + uid + ':' + uid + ' ' + path.dirname(REMOTE));
  }
  return '已推回，App uid=' + uid;
}

function localPath() {
  ensureRoot();
  sh('am force-stop ' + PKG);
  sleep(1200);
  fs.mkdirSync(WORK, { recursive: true });
  for (const f of fs.readdirSync(WORK)) {
    if (/^DCStorage/.test(f)) fs.rmSync(path.join(WORK, f), { force: true });
  }
  for (const suffix of ['', '-wal', '-shm']) {
    try { adb(['pull', REMOTE + suffix, path.join(WORK, 'DCStorage' + suffix)], { stdio: 'pipe' }); }
    catch (e) {}
  }
  return path.join(WORK, 'DCStorage');
}

const cmd = process.argv[2] || 'list';
if (cmd === 'list') {
  console.log(listAll());
} else if (cmd === 'del' || cmd === 'set') {
  const local = localPath();
  const tables = JSON.parse(tableNames(local));
  if (cmd === 'del') {
    const keys = process.argv.slice(3);
    if (!keys.length) { console.error('用法: node _dev_storage.js del <key...>'); process.exit(1); }
    console.log(py(`
import sqlite3
c = sqlite3.connect(r'${local}')
n = 0
for t in ${JSON.stringify(tables)}:
    if not t.endswith('_storage'): continue
    for k in ${JSON.stringify(keys)}:
        cur = c.execute('delete from "' + t + '" where key = ?', (k,))
        n += cur.rowcount
c.commit()
print('已删除 %d 行' % n)
`));
  } else {
    const k = process.argv[3];
    const v = process.argv[4];
    console.log(py(`
import sqlite3
c = sqlite3.connect(r'${local}')
n = 0
for t in ${JSON.stringify(tables)}:
    if not t.endswith('_storage'): continue
    c.execute('delete from "' + t + '" where key = ?', (${JSON.stringify(k)},))
    c.execute('insert into "' + t + '"(key,value,timestamp) values(?,?,datetime("now"))', (${JSON.stringify(k)}, ${JSON.stringify(v)}))
    n += 1
c.commit()
print('已在 %d 张表写入' % n)
`));
  }
  console.log(pushBack(local));
} else {
  console.error('用法: node _dev_storage.js list|del|set');
  process.exit(1);
}
