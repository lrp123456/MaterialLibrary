#!/usr/bin/env bash
export PATH="/home/lrp/.local/node/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
echo "=== docker litellm env key ==="
key=$(docker exec sm-litellm printenv LITELLM_MASTER_KEY 2>/dev/null || true)
echo "key_len=${#key}"
if [ -n "$key" ]; then
  echo "=== litellm /health ==="
  curl -sS -H "Authorization: Bearer $key" -o /tmp/llh2.txt -w "http:%{http_code}\n" --max-time 10 http://127.0.0.1:4000/health || true
  python3 - <<'PY'
import json
try:
  d=json.load(open("/tmp/llh2.txt"))
  print("keys", list(d)[:12] if isinstance(d, dict) else type(d))
  if isinstance(d, dict):
    hc=d.get("healthy_endpoints") or d.get("healthy_count")
    print("healthy", hc if not isinstance(hc, list) else len(hc))
    uh=d.get("unhealthy_endpoints") or d.get("unhealthy_count")
    print("unhealthy", uh if not isinstance(uh, list) else len(uh))
    print(json.dumps({k:d[k] for k in list(d)[:6]}, ensure_ascii=False)[:500])
except Exception as e:
  print("parse", e, open("/tmp/llh2.txt").read()[:300])
PY
  echo "=== litellm /v1/models ==="
  curl -sS -H "Authorization: Bearer $key" --max-time 10 http://127.0.0.1:4000/v1/models | python3 -c "import sys,json
d=json.load(sys.stdin)
ids=sorted(m.get('id') or '' for m in d.get('data',[]))
print('n',len(ids))
print('\n'.join(ids))"
fi
echo "=== umbra gateway listen ==="
# ts-api-gateway pid 3418
tr '\0' '\n' < /proc/3418/environ 2>/dev/null | awk -F= '/PORT|HOST|MLS/{print}' | head
ss -ltnp 2>/dev/null | grep -E '3418|tsx' || true
# common ports
for port in 3000 3001 3002 4001 5000 5173 7000 8080 8088 8787 8788 9001 9100; do
  code=$(curl -sS -o /tmp/up.txt -w "%{http_code}" --max-time 1 "http://127.0.0.1:$port/health" 2>/dev/null || echo x)
  if [ "$code" != "x" ] && [ "$code" != "000" ]; then
    echo "port $port /health -> $code $(head -c 80 /tmp/up.txt | tr '\n' ' ')"
  fi
done
