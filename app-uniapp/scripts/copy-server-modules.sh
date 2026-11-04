#!/usr/bin/env bash
set -e
SRC=/home/lrp/my_folder/smu/dsh_plugins/material_library
DST=/mnt/c/Users/lrp/DevEcoStudioProjects/MaterialLibraryServer
# remove empty/broken link
rm -rf "$DST/node_modules"
echo "copying node_modules (this may take a minute)..."
cp -a "$SRC/node_modules" "$DST/node_modules"
echo "server node_modules: $(ls "$DST/node_modules" | wc -l) entries"
# web node_modules not required if dist is present
if [ ! -f "$DST/web/dist/index.html" ]; then
  echo "web/dist missing, copy web/node_modules too"
  cp -a "$SRC/web/node_modules" "$DST/web/node_modules" 2>/dev/null || true
fi
echo DONE
