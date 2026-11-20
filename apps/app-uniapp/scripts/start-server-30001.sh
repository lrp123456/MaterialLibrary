#!/usr/bin/env bash
set -e
NODE=/home/lrp/.local/node/bin/node
DIR=/home/lrp/my_folder/smu/dsh_plugins/material_library
LOG=/home/lrp/.dsh-material-library/logs/server-30001.log
PIDFILE=/home/lrp/.dsh-material-library/server.pid
mkdir -p /home/lrp/.dsh-material-library/logs

# stop previous instance ONLY (never pkill all node server.js)
if [ -f "$PIDFILE" ]; then
  OLD=$(cat "$PIDFILE" 2>/dev/null || true)
  if [ -n "$OLD" ] && kill -0 "$OLD" 2>/dev/null; then
    kill "$OLD" 2>/dev/null || true
    sleep 1
    kill -9 "$OLD" 2>/dev/null || true
  fi
fi

cd "$DIR"
export ML_PORT=30001
export NO_PROXY=127.0.0.1,localhost,::1
export PATH="/home/lrp/.local/node/bin:$PATH"
"$NODE" server.js >> "$LOG" 2>&1 &
echo $! > "$PIDFILE"
echo "started pid=$(cat "$PIDFILE")"
sleep 4
echo "==== listen ===="
ss -lntp | grep 30001 || echo "NOT LISTENING"
echo "==== health ===="
curl -sS -m 5 http://127.0.0.1:30001/api/health || true
echo
echo "==== root ===="
curl -sS -m 5 -o /dev/null -w "HTTP %{http_code}\n" http://127.0.0.1:30001/ || true
echo "==== log ===="
tail -25 "$LOG"
