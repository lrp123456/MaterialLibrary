#!/usr/bin/env bash
# 每 90s 检查 tag 队列，低于阈值则再入队 200，直到 total 标记完成
export PATH=/home/lrp/.local/node/bin:$PATH
cd /mnt/c/Users/lrp/DevEcoStudioProjects/MaterialLibraryServer
TOTAL=${1:-5000}
QUEUED_TOTAL=0
for i in $(seq 1 40); do
  OUT=$(node scripts/queue-retag.js 200 "$TOTAL" 2>&1 | tail -1)
  echo "[retag-loop] $OUT"
  Q=$(echo "$OUT" | sed -n 's/.*"queued":\([0-9]*\).*/\1/p')
  [ -z "$Q" ] && Q=0
  QUEUED_TOTAL=$((QUEUED_TOTAL+Q))
  if [ "$Q" -eq 0 ]; then
    echo "[retag-loop] no more candidates or inflight high — exit"
    break
  fi
  sleep 90
done
echo "[retag-loop] queued_total=$QUEUED_TOTAL"
