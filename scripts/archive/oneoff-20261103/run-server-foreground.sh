#!/usr/bin/env bash
export PATH="/home/lrp/.local/node/bin:$PATH"
cd /mnt/c/Users/lrp/DevEcoStudioProjects/MaterialLibraryServer
echo "=== leftover ==="
ps aux | grep -E 'watchdog|node server' | grep -v grep || echo none
echo "=== run server 3s ==="
timeout 8 node server.js 2>&1 | tail -40
echo "=== exit ==="
