#!/usr/bin/env bash
export PATH="/home/lrp/.local/node/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
echo "=== processes ==="
ps -ef | grep -E 'litellm|ts-api-gateway|uvicorn|node.*30001|proxy' | grep -v grep | head -40
echo "=== :8000 what ==="
# try common health endpoints
for p in /health /docs /openapi.json /api/health; do
  code=$(curl -sS -o /tmp/p8000.txt -w "%{http_code}" --max-time 3 "http://127.0.0.1:8000$p" || echo err)
  echo "8000$p -> $code $(head -c 80 /tmp/p8000.txt | tr '\n' ' ')"
done
echo "=== litellm pids via ps ==="
pgrep -af litellm || true
pgrep -af "port 4000" || true
# docker?
docker ps --format '{{.Names}} {{.Ports}}' 2>/dev/null | head || true
