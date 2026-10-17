#!/usr/bin/env bash
cd "$(dirname "$0")"
export PATH="/home/lrp/.local/node/bin:$PATH"

# 杀死旧 30002 进程
OLD_PID=$(lsof -ti :30002 2>/dev/null || true)
if [ -n "$OLD_PID" ]; then
  kill -9 $OLD_PID 2>/dev/null || true
fi

# 启动 30002 服务（preview 生产预览模式，带 /api 反向代理至 30001）
nohup npx vite preview --port 30002 --host 0.0.0.0 > ./server-30002.log 2>&1 &
echo "[OK] Material Studio Pro (30002) 已启动，PID: $!"
