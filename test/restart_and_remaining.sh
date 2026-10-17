#!/usr/bin/env bash
set -euo pipefail
export PATH="/home/lrp/.local/node/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
cd /mnt/c/Users/lrp/DevEcoStudioProjects/MaterialLibraryServer
echo "=== adapters before restart ==="
node test/dump_adapters.js || true
echo "=== restart MLS ==="
bash start.sh restart
echo "=== wait ready ==="
for i in 1 2 3 4 5 6 7 8 9 10 11 12; do
  code=$(curl -sS -o /dev/null -w "%{http_code}" --max-time 3 http://127.0.0.1:30001/api/auth/me || echo 000)
  echo "try $i me=$code"
  if [ "$code" = "200" ]; then break; fi
  sleep 2
done
echo "=== remaining smoke ==="
LOG="/mnt/c/Users/lrp/DevEcoStudioProjects/MaterialLibraryServer/test/smoke_remaining.log"
PIDFILE="/mnt/c/Users/lrp/DevEcoStudioProjects/MaterialLibraryServer/test/smoke_remaining.pid"
echo "$$" > "$PIDFILE"
echo "REMAINING_START $(date -Is) pid=$$" > "$LOG"
exec node test/smoke_remaining.js >> "$LOG" 2>&1
