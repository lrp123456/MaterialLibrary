const path = require('path');
const os = require('os');

const username = process.env.ML_USER || '';
const password = process.env.ML_PASS || '';
if (!username || !password) {
  console.error('需要环境变量 ML_USER 和 ML_PASS。脚本不再内置口令，也不会把口令写成空。');
  process.exit(1);
}

const { openDb } = require('../src/db');
const { changePassword } = require('../src/auth');

const dataDir = path.join(os.homedir(), '.dsh-material-library');
const db = openDb(dataDir);
try {
  const user = db.prepare('SELECT id FROM users WHERE username = ?').get(username);
  if (!user) {
    console.error('找不到该用户');
    process.exit(1);
  }
  changePassword(db, user.id, password);
  console.log('已重置该用户口令。口令不打印，也不写入仓库。');
} finally {
  db.close();
}
