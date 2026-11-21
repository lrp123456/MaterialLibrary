const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');
const { execSync } = require('child_process');

console.log('=== 1. Git Revisions Check ===');
try {
  const masterLog = execSync('git log -n 3 --oneline master --', { encoding: 'utf8' }).trim();
  const testLog = execSync('git log -n 3 --oneline test --', { encoding: 'utf8' }).trim();
  console.log('master top:\n', masterLog);
  console.log('test top:\n', testLog);
  const diffMasterTest = execSync('git rev-list --left-right --count master...test', { encoding: 'utf8' }).trim();
  console.log('commits master...test (left=master only, right=test only):', diffMasterTest);
} catch (e) {
  console.error('Git error:', e.message);
}

console.log('\n=== 2. Databases & Files Check ===');
const prodDir = '/home/lrp/.dsh-material-library';
const testDir = '/home/lrp/.dsh-material-library-test';
console.log('prodDir exists:', fs.existsSync(prodDir));
console.log('testDir exists:', fs.existsSync(testDir));

if (fs.existsSync(prodDir + '/material.db')) {
  const prodDb = new Database(prodDir + '/material.db', { readonly: true });
  const tplCount = prodDb.prepare('SELECT count(*) as c FROM creation_templates').get().c;
  const tplInCreation = prodDb.prepare('SELECT count(*) as c FROM creation_templates WHERE in_creation_lib = 1').get().c;
  console.log(`Prod: creation_templates=${tplCount}, in_creation_lib=${tplInCreation}`);
  
  const tables = prodDb.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%creation%'").all();
  console.log('Prod creation tables:', tables.map(t => t.name));

  const prodCreationLibFiles = fs.existsSync(prodDir + '/creation-library') ? fs.readdirSync(prodDir + '/creation-library').length : 0;
  console.log(`Prod creation-library subdirs: ${prodCreationLibFiles}`);
}

if (fs.existsSync(testDir)) {
  const testFiles = fs.readdirSync(testDir);
  console.log('TestDir contents:', testFiles);
  if (fs.existsSync(testDir + '/material.db')) {
    const testDb = new Database(testDir + '/material.db', { readonly: true });
    const hasTpl = testDb.prepare("SELECT count(*) as c FROM sqlite_master WHERE type='table' AND name='creation_templates'").get().c;
    if (hasTpl) {
      const tplCount = testDb.prepare('SELECT count(*) as c FROM creation_templates').get().c;
      console.log(`Test: creation_templates=${tplCount}`);
    } else {
      console.log('Test: no creation_templates table');
    }
  }
} else {
  console.log('TestDir does not exist yet!');
}
