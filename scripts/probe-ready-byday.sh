#!/usr/bin/env bash
python3 - <<'PY'
import sqlite3, datetime
from collections import Counter
db='/home/lrp/.dsh-material-library/material.db'
conn=sqlite3.connect(f'file:{db}?mode=ro', uri=True)
conn.row_factory=sqlite3.Row
cur=conn.cursor()

def day(ts):
    return datetime.datetime.fromtimestamp(ts/1000).strftime('%Y-%m-%d') if ts else None

ready_any=Counter(); ready_vis=Counter(); disc=Counter(); allst=Counter()
for r in cur.execute('SELECT created_at,discovered_at,status,auth_state,is_representative,dup_group_id FROM assets'):
    ts = r['created_at'] or r['discovered_at'] or 0
    d = day(ts) or 'NO_TS'
    allst[r['status']] += 1
    if r['status'] in ('ready','ready_with_flags','tagging_done') and ts:
        ready_any[d]+=1
        if (r['is_representative']==1 or r['dup_group_id'] is None) and (r['auth_state'] in (None,'live','frozen')):
            ready_vis[d]+=1
    if r['status']=='discovered' and ts:
        disc[d]+=1

print('ALL STATUS', dict(allst))
print('\nREADY by day (any auth)')
for d in sorted(ready_any):
    print(d, ready_any[d])
print('\nREADY browse-visible by day')
for d in sorted(ready_vis):
    print(d, ready_vis[d])
print('\nDISCOVERED by day (tail)')
for d in sorted(disc)[-20:]:
    print(d, disc[d])
print('\nai_tasks count', cur.execute('SELECT count(*) FROM ai_tasks').fetchone()[0])
print('derivatives kinds sample')
for r in cur.execute('SELECT kind, count(*) c FROM derivatives GROUP BY kind ORDER BY c DESC LIMIT 15'):
    print(dict(r))
conn.close()
PY
