#!/usr/bin/env bash
set -euo pipefail
export PATH="/home/lrp/.local/node/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
cd /mnt/c/Users/lrp/DevEcoStudioProjects/MaterialLibraryServer
echo "=== health ==="
curl -sS -o /dev/null -w "mls:%{http_code}\n" --max-time 5 http://127.0.0.1:30001/api/auth/me || echo "mls:down"
curl -sS -o /dev/null -w "litellm:%{http_code}\n" --max-time 5 http://127.0.0.1:4000/health || echo "litellm:down"
echo "=== listeners ==="
ss -ltn 2>/dev/null | grep -E '30001|4000|8787' || true
echo "=== jobs ==="
node test/dump_jobs.js
echo "=== studio ==="
node test/dump_studio.js
