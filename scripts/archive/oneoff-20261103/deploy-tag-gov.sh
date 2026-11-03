#!/usr/bin/env bash
export PATH="/home/lrp/.local/node/bin:$PATH"
cd /mnt/c/Users/lrp/DevEcoStudioProjects/MaterialLibraryServer
export ML_DATA_DIR=/home/lrp/.dsh-material-library
echo "=== migrate ==="
node -e "
const { migrate } = require('./scripts/migrate.js');
const r = migrate('/home/lrp/.dsh-material-library', { doBackup: true });
console.log('migrate done');
" 2>&1 | tail -40
echo "=== restart ==="
pkill -f 'watchdog.sh' 2>/dev/null || true
pkill -f 'node server.js' 2>/dev/null || true
sleep 2
setsid nohup bash scripts/watchdog.sh start </dev/null >> /home/lrp/.dsh-material-library/logs/watchdog-start.out 2>&1 &
sleep 7
echo "=== listen ==="
ss -lntp | grep 30001 || echo NO_LISTEN
tail -15 /home/lrp/.dsh-material-library/server.log
