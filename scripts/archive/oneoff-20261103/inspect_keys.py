import sqlite3, os, json

dbs = [
 r'C:\Users\lrp\DevEcoStudioProjects\MaterialLibraryServer\data\material_library.db',
 r'C:\Users\lrp\DevEcoStudioProjects\MaterialLibraryServer\data\material.db',
 r'C:\Users\lrp\DevEcoStudioProjects\MaterialLibraryServer\metadata.db',
]

for db in dbs:
  if not os.path.exists(db):
    print('MISS', db)
    continue
  print('===', db, '===')
  con = sqlite3.connect(db)
  con.row_factory = sqlite3.Row
  cur = con.cursor()
  tables = [r[0] for r in cur.execute("SELECT name FROM sqlite_master WHERE type='table'")]
  interesting = [t for t in tables if any(x in t.lower() for x in ['adapter','provider','llm','user','session','update'])]
  print('tables:', interesting)
  if 'llm_providers' in tables:
    for r in cur.execute('SELECT id, api_key, base_url, enabled FROM llm_providers'):
      k = r['api_key'] or ''
      print('provider', r['id'], 'enabled='+str(r['enabled']), 'keyLen='+str(len(k)), 'prefix='+(k[:12] if k else ''), 'base='+str(r['base_url']))
  if 'gen_adapters' in tables:
    for r in cur.execute('SELECT id, kind, protocol, base_url, enabled, secrets_json, config_json FROM gen_adapters'):
      sec = {}
      try:
        sec = json.loads(r['secrets_json'] or '{}')
      except Exception:
        pass
      k = sec.get('apiKey') or ''
      print('adapter', r['id'], r['kind'], 'enabled='+str(r['enabled']), 'keyLen='+str(len(k)), 'base='+str(r['base_url']))
      print('  cfg', (r['config_json'] or '')[:300])
  if 'users' in tables:
    for r in cur.execute('SELECT username, role FROM users LIMIT 10'):
      print('user', r['username'], r['role'])
  con.close()
