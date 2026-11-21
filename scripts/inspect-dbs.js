const path = require('path');
const fs = require('fs');
const Database = require(path.resolve(__dirname, 'shims', 'better-sqlite3-win.js') ? 'better-sqlite3' : 'better-sqlite3');

const winTestDbPath = 'C:\\Users\\lrp\\.dsh-material-library-test\\material.db';
const wslProdDbPath = '\\\\wsl.localhost\\smu\\home\\lrp\\.dsh-material-library\\material.db';
const wslProdCreationDir = '\\\\wsl.localhost\\smu\\home\\lrp\\.dsh-material-library\\creation-library';
const winTestCreationDir = 'C:\\Users\\lrp\\.dsh-material-library-test\\creation-library';

console.log('--- WSL Prod Access Check ---');
console.log('wslProdDbPath exists:', fs.existsSync(wslProdDbPath));
console.log('wslProdCreationDir exists:', fs.existsSync(wslProdCreationDir));
if (fs.existsSync(wslProdCreationDir)) {
  const dirs = fs.readdirSync(wslProdCreationDir);
  console.log(`wslProdCreationDir count: ${dirs.length}`);
}

console.log('--- Windows Test Access Check ---');
console.log('winTestDbPath exists:', fs.existsSync(winTestDbPath));
console.log('winTestCreationDir exists:', fs.existsSync(winTestCreationDir));

if (fs.existsSync(winTestDbPath)) {
  const db = new Database(winTestDbPath, { readonly: true });
  const hasTpl = db.prepare("SELECT count(*) as c FROM sqlite_master WHERE type='table' AND name='creation_templates'").get().c;
  console.log('winTest has creation_templates table:', hasTpl > 0);
  if (hasTpl) {
    const total = db.prepare("SELECT count(*) as c FROM creation_templates").get().c;
    const inCreation = db.prepare("SELECT count(*) as c FROM creation_templates WHERE in_creation_lib = 1").get().c;
    console.log(`winTest creation_templates total: ${total}, in_creation_lib: ${inCreation}`);
    const cols = db.prepare("PRAGMA table_info(creation_templates)").all().map(c => c.name);
    console.log('winTest creation_templates cols:', cols);
  }
}

if (fs.existsSync(wslProdDbPath)) {
  const pDb = new Database(wslProdDbPath, { readonly: true });
  const pTotal = pDb.prepare("SELECT count(*) as c FROM creation_templates").get().c;
  console.log(`wslProd creation_templates total: ${pTotal}`);
}
