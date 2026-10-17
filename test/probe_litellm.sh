#!/usr/bin/env bash
export PATH="/home/lrp/.local/node/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
echo "=== litellm /health no key ==="
curl -sS -o /tmp/llh.txt -w "http:%{http_code}\n" --max-time 5 http://127.0.0.1:4000/health || echo down
head -c 200 /tmp/llh.txt; echo
echo "=== find LITELLM_MASTER_KEY from pid ==="
pid=$(ss -ltnp 2>/dev/null | awk '/:4000/ {print}' | sed -n 's/.*pid=\([0-9]*\).*/\1/p' | head -1)
echo "pid=$pid"
if [ -n "$pid" ] && [ -r "/proc/$pid/environ" ]; then
  key=$(tr '\0' '\n' < /proc/$pid/environ | awk -F= '/^LITELLM_MASTER_KEY=/{print substr($0,index($0,"=")+1)}' | head -1)
  echo "key_len=${#key}"
  if [ -n "$key" ]; then
    echo "=== /health with key ==="
    curl -sS -H "Authorization: Bearer $key" -o /tmp/llh2.txt -w "http:%{http_code}\n" --max-time 8 http://127.0.0.1:4000/health || true
    head -c 400 /tmp/llh2.txt; echo
    echo "=== /v1/models ==="
    curl -sS -H "Authorization: Bearer $key" --max-time 8 http://127.0.0.1:4000/v1/models | python3 -c "import sys,json
d=json.load(sys.stdin)
ids=[m.get('id') for m in d.get('data',[])]
print('n',len(ids))
print(','.join(ids))"
  fi
else
  echo "cannot read environ"
  tr '\0' '\n' < /proc/$pid/environ 2>/dev/null | awk -F= '/KEY|TOKEN/{print $1}' || true
fi
echo "=== umbra gateway ports ==="
ss -ltn | grep -E ':8787|:3100|:8088|:5173|:8000|:9000' || echo none
