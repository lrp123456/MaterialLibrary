#!/usr/bin/env bash
set -e
python3 - <<'PY'
import sqlite3, datetime, json
db='/home/lrp/.dsh-material-library/material.db'
conn=sqlite3.connect(f'file:{db}?mode=ro', uri=True)
conn.row_factory=sqlite3.Row
cur=conn.cursor()

def fmt(ts):
    if not ts: return None
    return datetime.datetime.fromtimestamp(ts/1000).strftime('%Y-%m-%d %H:%M:%S')

print('=== timezone check sample ===')
for r in cur.execute('SELECT fid,file_name,created_at,discovered_at,status,auth_state FROM assets ORDER BY created_at DESC LIMIT 5'):
    print(r['file_name'], 'created', fmt(r['created_at']), 'disc', fmt(r['discovered_at']), r['status'], r['auth_state'])

print('\n=== ready by created_at day (python local) ===')
rows=cur.execute("SELECT created_at,status,auth_state,is_representative,dup_group_id FROM assets WHERE status IN ('ready','ready_with_flags','tagging_done')").fetchall()
from collections import Counter
c=Counter(); c2=Counter()
for r in rows:
    day=datetime.datetime.fromtimestamp(r['created_at']/1000).strftime('%Y-%m-%d')
    c[day]+=1
    if (r['is_representative']==1 or r['dup_group_id'] is None) and r['auth_state'] in (None,'live'):
        c2[day]+=1
print('ready any', dict(sorted(c.items())))
print('ready visible-ish', dict(sorted(c2.items())))

print('\n=== discovered on 9-06..9-13 ===')
for r in cur.execute('''
SELECT date(created_at/1000,'unixepoch','localtime') day, status, auth_state, count(*) c
FROM assets
WHERE created_at >= 1788700000000
GROUP BY day,status,auth_state ORDER BY day
'''):
    print(dict(r))

print('\n=== failed tag samples ===')
for r in cur.execute("SELECT asset_fid, node_id, status, substr(input_summary,1,80) s, updated_at FROM node_runs WHERE status='failed' ORDER BY updated_at DESC LIMIT 8"):
    print(dict(r))

print('\n=== queued gates ===')
for r in cur.execute("SELECT asset_fid, node_id, status, not_before, created_at FROM node_runs WHERE status IN ('queued','running') ORDER BY created_at DESC LIMIT 15"):
    print(dict(r))

print('\n=== assets table total by status ===')
for r in cur.execute('SELECT status, count(*) c FROM assets GROUP BY status'):
    print(dict(r))
conn.close()
PY
