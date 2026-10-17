#!/usr/bin/env bash
export PATH="/home/lrp/.local/node/bin:$PATH"
cd /mnt/c/Users/lrp/DevEcoStudioProjects/MaterialLibraryServer
setsid nohup bash scripts/watchdog.sh start </dev/null >> /home/lrp/.dsh-material-library/logs/watchdog-start.out 2>&1 &
sleep 5
echo "=== status ==="
ss -lntp | grep 30001 || echo no_listen
ps aux | grep -E 'watchdog|node server' | grep -v grep || echo none
echo "=== log ==="
tail -12 /home/lrp/.dsh-material-library/server.log
echo "=== watchdog start out ==="
tail -8 /home/lrp/.dsh-material-library/logs/watchdog-start.out
