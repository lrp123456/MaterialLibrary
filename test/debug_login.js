const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { openDb } = require('../src/db');

const dataDir = path.join(os.homedir(), '.dsh-material-library');
const db = openDb(dataDir);
// 账号从环境变量读取：本文件进版本库，不写死真实账号。
const USER = process.env.ML_USER;
if (!USER) {
  console.error('请先设置环境变量 ML_USER（要调试的登录账号）');
  process.exit(1);
}
const u = db.prepare("SELECT * FROM users WHERE username=?").get(USER);
if (!u) {
  console.error('账号不存在:', USER);
  process.exit(1);
}
console.log('user', { id: u.id, salt: u.salt, hash: u.password_hash.slice(0, 20) });
const h = crypto.scryptSync('', u.salt, 64).toString('hex');
console.log('computed', h.slice(0, 20), 'match', h === u.password_hash);
// also try login function
const { login } = require('../src/auth');
console.log('login result', login(db, USER, '') ? 'OK' : 'FAIL');
console.log('login viewer', login(db, 'viewer', '') ? 'OK' : 'FAIL');
db.close();
