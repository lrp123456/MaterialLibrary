#!/usr/bin/env bash
export PATH="/home/lrp/.local/node/bin:$PATH"
export ML_NAS_DIR=/mnt/synology/material
cd /mnt/c/Users/lrp/DevEcoStudioProjects/MaterialLibraryServer
node scripts/migrate-to-nas.js 5000
