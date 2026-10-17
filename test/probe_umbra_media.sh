#!/usr/bin/env bash
export PATH="/home/lrp/.local/node/bin:/usr/bin:/bin:$PATH"
echo "=== :3001 paths ==="
for p in /health /api/health /media-catalog /api/media-catalog /media-gen /api/lab/capabilities; do
  code=$(curl -sS -o /tmp/u.txt -w "%{http_code}" --max-time 3 "http://127.0.0.1:3001$p" || echo x)
  echo "3001$p -> $code $(head -c 120 /tmp/u.txt | tr '\n' ' ')"
done
echo "=== ts-api-gateway cmdline ==="
ps -ef | grep ts-api-gateway | grep -v grep | head
tr '\0' '\n' < /proc/3418/environ 2>/dev/null | awk -F= '/PORT|LISTEN|MLS|HOST/{print}' | head
