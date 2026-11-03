#!/usr/bin/env bash
export PATH="/home/lrp/.local/node/bin:$PATH"
cd /mnt/c/Users/lrp/DevEcoStudioProjects/MaterialLibraryServer
node --check src/api.js || exit 1
echo "syntax ok"
# kill old
pkill -f 'watchdog.sh' 2>/dev/null || true
pkill -f 'node server.js' 2>/dev/null || true
sleep 2
setsid nohup bash scripts/watchdog.sh start </dev/null >> /home/lrp/.dsh-material-library/logs/watchdog-start.out 2>&1 &
sleep 6
echo "=== listen ==="
ss -lntp | grep 30001 || echo NO_LISTEN
echo "=== log ==="
tail -10 /home/lrp/.dsh-material-library/server.log
