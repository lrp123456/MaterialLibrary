#!/usr/bin/env bash
set -e
python3 - <<'PY'
import sqlite3, datetime
db='/home/lrp/.dsh-material-library/material.db'
conn=sqlite3.connect(f'file:{db}?mode=ro', uri=True)
conn.row_factory=sqlite3.Row
cur=conn.cursor()

print('=== browse-ready vs discovered by day (2026-09) ===')
rows=cur.execute('''
SELECT date(created_at/1000,'unixepoch','localtime') day,
       status, auth_state,
       SUM(CASE WHEN is_representative=1 OR dup_group_id IS NULL THEN 1 ELSE 0 END) rep_or_solo,
       COUNT(*) c
FROM assets
WHERE created_at>0 AND created_at>=1788300000000
GROUP BY day,status,auth_state
ORDER BY day DESC,status
''').fetchall()
for r in rows:
    print(dict(r))

print('\n=== 9-05..9-13 ready_flags / why not ready ===')
rows=cur.execute('''
SELECT date(created_at/1000,'unixepoch','localtime') day, status, ready_flags, count(*) c
FROM assets
WHERE created_at BETWEEN 1788550000000 AND 1789400000000
GROUP BY day,status,ready_flags
ORDER BY day DESC, c DESC
''').fetchall()
for r in rows:
    print(dict(r))

print('\n=== node_runs backlog ===')
for q in [
  "SELECT status, count(*) c FROM node_runs GROUP BY status",
  "SELECT node_type, status, count(*) c FROM node_runs GROUP BY node_type, status ORDER BY c DESC LIMIT 20",
  "SELECT status, count(*) c FROM runs GROUP BY status",
]:
    try:
        print(q)
        for r in cur.execute(q):
            print(' ', dict(r))
    except Exception as e:
        print(' err', e)

print('\n=== ai_tasks recent ===')
try:
    cols=[c[1] for c in cur.execute('PRAGMA table_info(ai_tasks)')]
    print('cols', cols)
    for r in cur.execute('SELECT * FROM ai_tasks ORDER BY created_at DESC LIMIT 10'):
        d=dict(r)
        print({k:d.get(k) for k in ['id','fid','type','status','progress','error','output_fid','title'] if k in d or True})
except Exception as e:
    print('ai_tasks', e)

print('\n=== phone window_days photo modified range in snapshot_items for latest device ===')
dev='682301a36df64ebdy88793874193e652'
rows=cur.execute('''
SELECT date(modified/1000,'unixepoch','localtime') day, state, count(*) c, min(modified) mn, max(modified) mx
FROM snapshot_items WHERE device_id=?
GROUP BY day,state ORDER BY day DESC
''', (dev,)).fetchall()
for r in rows:
    print(dict(r))
conn.close()
PY
