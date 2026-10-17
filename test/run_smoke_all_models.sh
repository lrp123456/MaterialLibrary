#!/usr/bin/env bash
export PATH="/home/lrp/.local/node/bin:/usr/local/bin:/usr/bin:/bin:$PATH"
cd /mnt/c/Users/lrp/DevEcoStudioProjects/MaterialLibraryServer
LOG="/mnt/c/Users/lrp/DevEcoStudioProjects/MaterialLibraryServer/test/smoke_all_models.log"
PIDFILE="/mnt/c/Users/lrp/DevEcoStudioProjects/MaterialLibraryServer/test/smoke_all_models.pid"
echo "$$" > "$PIDFILE"
echo "SMOKE_START $(date -Is) pid=$$" > "$LOG"
exec /home/lrp/.local/node/bin/node test/smoke_all_models.js >> "$LOG" 2>&1
