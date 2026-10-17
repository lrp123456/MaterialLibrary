#!/usr/bin/env bash
set -e
DB=/home/lrp/.dsh-material-library/material.db
python3 - <<'PY'
import sqlite3, os, datetime, json
db = '/home/lrp/.dsh-material-library/material.db'
conn = sqlite3.connect(f'file:{db}?mode=ro', uri=True)
conn.row_factory = sqlite3.Row
cur = conn.cursor()

print('=== snapshot_devices ===')
for r in cur.execute('SELECT * FROM snapshot_devices ORDER BY rowid DESC LIMIT 10'):
    print(dict(r))

print('\n=== snapshot_items recent ===')
cols = [c[1] for c in cur.execute('PRAGMA table_info(snapshot_items)')]
print('cols', cols)
try:
    n = cur.execute('SELECT count(*) FROM snapshot_items').fetchone()[0]
    print('count', n)
    for r in cur.execute('SELECT * FROM snapshot_items ORDER BY rowid DESC LIMIT 5'):
        d = dict(r)
        # print compact
        print({k: d.get(k) for k in list(d)[:12]})
except Exception as e:
    print('err', e)

print('\n=== sync_events recent ===')
cols = [c[1] for c in cur.execute('PRAGMA table_info(sync_events)')]
print('cols', cols)
try:
    for r in cur.execute('SELECT * FROM sync_events ORDER BY rowid DESC LIMIT 15'):
        print(dict(r))
except Exception as e:
    print('err', e)

print('\n=== assets created_at histogram (all statuses) ===')
rows = cur.execute('SELECT created_at, status, auth_state, count(*) c FROM assets GROUP BY date(created_at/1000, "unixepoch", "localtime"), status, auth_state ORDER BY 1 DESC LIMIT 40').fetchall()
# better: by day
rows = cur.execute('''
  SELECT date(created_at/1000, "unixepoch", "localtime") AS day,
         status, count(*) c
  FROM assets
  WHERE created_at > 0
  GROUP BY day, status
  ORDER BY day DESC
  LIMIT 60
''').fetchall()
for r in rows:
    print(dict(r))

print('\n=== ready visible by day (AUTH browse) ===')
rows = cur.execute('''
  SELECT date(created_at/1000, "unixepoch", "localtime") AS day, count(*) c
  FROM assets
  WHERE created_at > 0 AND status IN ('ready','ready_with_flags','tagging_done')
  GROUP BY day ORDER BY day DESC
''').fetchall()
for r in rows:
    print(dict(r))

print('\n=== max created_at ===')
r = cur.execute('SELECT max(created_at) mx, count(*) n FROM assets WHERE created_at>0').fetchone()
print(dict(r), datetime.datetime.fromtimestamp(r['mx']/1000) if r['mx'] else None)
conn.close()
PY
