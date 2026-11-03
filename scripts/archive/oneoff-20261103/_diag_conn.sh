#!/usr/bin/env bash
set -u
BASE=http://127.0.0.1:30001
echo '=== burst health 20x ==='
for i in $(seq 1 20); do
  curl -sS -o /dev/null -w '%{http_code}:%{time_total} ' --max-time 3 "$BASE/api/health" || echo -n 'TIMEOUT '
done
echo
echo '=== login ==='
LOGIN=$(curl -sS --max-time 8 -X POST -H 'Content-Type: application/json' \
  --data-binary "{\"username\":\"${ML_USER:?set ML_USER}\",\"password\":\"${ML_PASS:?set ML_PASS}\"}" \
  "$BASE/api/viewer/auth/login")
TOKEN=$(printf '%s' "$LOGIN" | python3 -c 'import sys,json,re; t=sys.stdin.read();
try:
 d=json.loads(t); print((d.get("data") or {}).get("token") or d.get("token") or "")
except Exception:
 m=re.search(r"\"token\"\s*:\s*\"([^\"]+)\"", t); print(m.group(1) if m else "")')
echo "token_len=${#TOKEN}"
echo "login_body_head=$(printf '%s' "$LOGIN" | head -c 180)"
echo '=== app-path timings ==='
for path in \
  "/api/viewer/assets?limit=20" \
  "/api/viewer/categories" \
  "/api/viewer/assets?limit=50" \
  "/api/health"
do
  curl -sS -o /dev/null -w "path=$path code:%{http_code} ttfb:%{time_starttransfer} total:%{time_total}\n" \
    --max-time 20 -H "Authorization: Bearer $TOKEN" "$BASE$path"
done
echo '=== queue backlog ==='
python3 - <<'PY'
import sqlite3
p='/home/lrp/.dsh-material-library/material.db'
c=sqlite3.connect(p)
qs=[
  "select status, count(*) from node_runs group by status",
  "select node_type, status, count(*) from node_runs where status in ('queued','running','failed') group by 1,2 order by 3 desc limit 15",
  "select count(*) as total from node_runs",
]
for q in qs:
  print('Q:', q)
  try:
    for r in c.execute(q):
      print(' ', r)
  except Exception as e:
    print(' err', e)
PY
echo '=== sockets ==='
ss -ant | grep 30001 | head -20
echo '=== recent log tail (non-vector) ==='
grep -vE 'vector|embeddings HTTP|使用 local_feature' /home/lrp/.dsh-material-library/server.log | tail -n 25
