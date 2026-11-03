#!/usr/bin/env bash
set -e
printf '%s' "{\"username\":\"${ML_USER:?set ML_USER}\",\"password\":\"${ML_PASS:?set ML_PASS}\"}" > /tmp/lg.json
TOKEN=$(curl -sS -m 10 --noproxy '*' -X POST http://127.0.0.1:30001/api/viewer/auth/login \
  -H 'Content-Type: application/json' --data-binary @/tmp/lg.json \
  | python3 -c 'import sys,json; print(json.load(sys.stdin)["data"]["token"])')
echo "TOKEN_OK ${#TOKEN}"
export TOKEN

python3 - <<'PY'
import os, json, urllib.request, datetime, collections, ssl
token = os.environ['TOKEN']
base = 'http://127.0.0.1:30001'

def get(path):
    req = urllib.request.Request(base + path, headers={'Authorization': 'Bearer ' + token})
    with urllib.request.urlopen(req, timeout=30) as r:
        return json.loads(r.read().decode())

# date histogram over multiple pages
hist = collections.Counter()
status_hist = collections.Counter()
total = None
page = 1
got = 0
while True:
    d = get(f'/api/viewer/assets?page={page}&pageSize=200&sort=latest')
    data = d.get('data') or d
    items = data.get('items') or []
    if total is None:
        total = data.get('total')
        print('total', total)
    if not items:
        break
    for r in items:
        ts = r.get('createdAt') or r.get('created_at') or 0
        if not ts:
            hist['NO_TS'] += 1
        else:
            if ts > 1e12:
                ts = ts / 1000
            day = datetime.datetime.fromtimestamp(ts).strftime('%Y-%m-%d')
            hist[day] += 1
        st = r.get('status') or r.get('ready_flags') or '?'
        status_hist[str(st)] += 1
    got += len(items)
    page += 1
    if page > 30 or got >= (total or 0):
        break

print('got', got)
print('--- by day ---')
for day in sorted(hist):
    print(day, hist[day])
print('--- status ---')
print(dict(status_hist))

# sample one item keys
d = get('/api/viewer/assets?page=1&pageSize=1&sort=latest')
data = d.get('data') or d
items = data.get('items') or []
if items:
    r = items[0]
    print('sample_keys', sorted(r.keys()))
    print('sample', {k: r.get(k) for k in ['fid','file_name','createdAt','created_at','status','width','height','media_type']})
PY

echo '=== sync/snapshot related recent ==='
python3 - <<'PY'
import os, json, urllib.request
token = os.environ['TOKEN']
req = urllib.request.Request('http://127.0.0.1:30001/api/viewer/stats', headers={'Authorization':'Bearer '+token})
try:
    with urllib.request.urlopen(req, timeout=15) as r:
        print(r.read().decode()[:2000])
except Exception as e:
    print('stats err', e)
PY

# local WSL last sync files
echo '=== last sync from db ==='
python3 - <<'PY'
import sqlite3, os, datetime, time
db = os.path.expanduser('~/.dsh-material-library/material.db')
conn = sqlite3.connect(f'file:{db}?mode=ro', uri=True)
cur = conn.cursor()
# list tables briefly
tables = [r[0] for r in cur.execute("SELECT name FROM sqlite_master WHERE type='table'")]
print('tables sample', [t for t in tables if any(x in t.lower() for x in ['device','snap','sync','media','user','asset'])][:40])
for t in ['devices','snapshots','device_snapshots','sync_log','media_files']:
    if t in tables:
        cols = [c[1] for c in cur.execute(f'PRAGMA table_info({t})')]
        print(t, 'cols', cols[:20])
        try:
            n = cur.execute(f'SELECT count(*) FROM {t}').fetchone()[0]
            print(t, 'count', n)
        except Exception as e:
            print(t, e)
conn.close()
PY
