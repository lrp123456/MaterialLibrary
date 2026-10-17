#!/usr/bin/env bash
# 色彩批处理：循环直到处理完或达到 max
export PATH=/home/lrp/.local/node/bin:$PATH
cd /mnt/c/Users/lrp/DevEcoStudioProjects/MaterialLibraryServer
MAX=${1:-2000}
DONE=0
while [ "$DONE" -lt "$MAX" ]; do
  OUT=$(node scripts/run-colors.js 100 2>&1)
  echo "$OUT" | tail -3
  N=$(echo "$OUT" | sed -n 's/.*done \([0-9]*\) assets.*/\1/p')
  [ -z "$N" ] && N=0
  DONE=$((DONE+N))
  echo "[colors-loop] total_done=$DONE / $MAX"
  if [ "$N" -eq 0 ]; then
    echo "[colors-loop] no more local files"
    break
  fi
done
echo "[colors-loop] finished $DONE"
