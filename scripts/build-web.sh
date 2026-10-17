#!/usr/bin/env bash
set -e
export PATH="/home/lrp/.local/node/bin:$PATH"
cd /mnt/c/Users/lrp/DevEcoStudioProjects/MaterialLibraryServer/web
./node_modules/.bin/vite build
