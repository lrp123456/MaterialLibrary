const Database = require('better-sqlite3');
const path = require('path');

const dbs = [
  path.join(__dirname, '..', 'data', 'material_library.db'),
  path.join(__dirname, '..', 'data', 'material.db'),
  path.join(__dirname, '..', 'metadata.db'),
];

for (const dbPath of dbs) {
  const fs = require('fs');
  if (!fs.existsSync(dbPath)) {
    console.log('MISS', dbPath);
    continue;
  }
  console.log('===', dbPath, '===');
  let db;
  try {
    db = new Database(dbPath, { readonly: true });
  } catch (e) {
    console.log('open fail', e.message);
    continue;
  }
  try {
    const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => r.name);
    const interesting = tables.filter((t) => /adapter|provider|llm|update|release|user|session/i.test(t));
    console.log('interesting tables:', interesting.join(', ') || '(none)');
    if (tables.includes('llm_providers')) {
      const rows = db.prepare('SELECT id, api_key, base_url, enabled FROM llm_providers').all();
      for (const r of rows) {
        const k = r.api_key || '';
        console.log(
          'provider',
          r.id,
          'enabled=' + r.enabled,
          'keyLen=' + k.length,
          'prefix=' + (k ? k.slice(0, 10) : ''),
          'base=' + r.base_url
        );
      }
    }
    if (tables.includes('gen_adapters')) {
      const rows = db.prepare('SELECT id, kind, protocol, base_url, enabled, secrets_json, config_json FROM gen_adapters').all();
      for (const r of rows) {
        let sec = {};
        try {
          sec = JSON.parse(r.secrets_json || '{}');
        } catch {}
        const k = sec.apiKey || '';
        console.log('adapter', r.id, r.kind, 'enabled=' + r.enabled, 'keyLen=' + k.length, 'base=' + r.base_url);
        console.log('  cfg', String(r.config_json || '').slice(0, 240));
      }
    }
    if (tables.includes('users')) {
      const users = db.prepare('SELECT id, username, role FROM users LIMIT 10').all();
      console.log('users', users.map((u) => u.username + ':' + u.role).join(', '));
    }
  } catch (e) {
    console.log('err', e.message);
  }
  db.close();
}
