#!/usr/bin/env bash
# Run MaterialLibraryServer from Windows project path (via /mnt/c)
export PATH="/home/lrp/.local/node/bin:$PATH"
export ML_PORT=30001
export NO_PROXY=127.0.0.1,localhost,::1
export ML_DATA_DIR="${ML_DATA_DIR:-/home/lrp/.dsh-material-library}"
export ML_NAS_DIR="${ML_NAS_DIR:-/mnt/synology/material}"
export NO_PROXY=127.0.0.1,localhost,::1,192.168.1.34
export http_proxy="${http_proxy:-http://127.0.0.1:7890}"
export https_proxy="${https_proxy:-http://127.0.0.1:7890}"
cd /mnt/c/Users/lrp/DevEcoStudioProjects/MaterialLibraryServer || exit 1
mkdir -p "$ML_DATA_DIR/logs"
exec /home/lrp/.local/node/bin/node server.js
