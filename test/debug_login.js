const path = require('path');
const os = require('os');
const crypto = require('crypto');
const { openDb } = require('../src/db');

const dataDir = path.join(os.homedir(), '.dsh-material-library');
const db = openDb(dataDir);
const u = db.prepare("SELECT * FROM users WHERE username='504391119'").get();
console.log('user', { id: u.id, salt: u.salt, hash: u.password_hash.slice(0, 20) });
const h = crypto.scryptSync('', u.salt, 64).toString('hex');
console.log('computed', h.slice(0, 20), 'match', h === u.password_hash);
// also try login function
const { login } = require('../src/auth');
console.log('login result', login(db, '504391119', '') ? 'OK' : 'FAIL');
console.log('login viewer', login(db, 'viewer', '') ? 'OK' : 'FAIL');
db.close();
