#!/usr/bin/env bash
# ==============================================================================
# MaterialLibraryServer watchdog：崩溃后自动重启 node server.js
# 由 start.sh start 调起；stop 时通过 stop 标志优雅退出。
# ==============================================================================

set -u
set +m  # 关闭 job control，避免 wait 时打印 "Killed" 等噪音

export PATH="/home/lrp/.local/node/bin:$PATH"

# 代理环境：Node fetch 不读 http_proxy，但 proxy-setup 会用它作为候选并 setGlobalDispatcher。
# watchdog 拉起的进程往往没有交互 shell 的代理变量，这里兜底注入。
if [ -z "${https_proxy:-}" ] && [ -z "${HTTPS_PROXY:-}" ]; then
  export https_proxy="http://127.0.0.1:7890"
  export http_proxy="http://127.0.0.1:7890"
  export HTTPS_PROXY="$https_proxy"
  export HTTP_PROXY="$http_proxy"
fi
export no_proxy="${no_proxy:-localhost,127.0.0.1,::1}"
export NO_PROXY="${NO_PROXY:-$no_proxy}"

PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DATA_DIR="${ML_DATA_DIR:-$HOME/.dsh-material-library}"
PORT="${ML_PORT:-30001}"
LOG_DIR="$DATA_DIR/logs"
LOG_FILE="$DATA_DIR/server.log"
WATCHDOG_LOG="$DATA_DIR/watchdog.log"
WATCHDOG_PID_FILE="$DATA_DIR/watchdog.pid"
SERVER_PID_FILE="$DATA_DIR/server.pid"
STOP_FLAG="$DATA_DIR/watchdog.stop"
RESTART_DELAY="${ML_RESTART_DELAY:-3}"
# 连续快速崩溃保护：10 分钟内超过 8 次则冷却 60s
CRASH_WINDOW=600
CRASH_LIMIT=8

mkdir -p "$DATA_DIR" "$LOG_DIR"

child_pid=""
crash_times=()

ts() { date '+%Y-%m-%d %H:%M:%S'; }
# 只写 stderr：由 start.sh 的 nohup 重定向进 watchdog.log，避免 tee 双写
wlog() { echo "[$(ts)] [watchdog] $1" >&2; }

cleanup() {
  wlog "收到退出信号，正在停止子进程..."
  rm -f "$STOP_FLAG"
  if [ -n "${child_pid}" ] && kill -0 "$child_pid" 2>/dev/null; then
    kill "$child_pid" 2>/dev/null || true
    local waited=0
    while kill -0 "$child_pid" 2>/dev/null && [ $waited -lt 20 ]; do
      sleep 0.25
      waited=$((waited + 1))
    done
    if kill -0 "$child_pid" 2>/dev/null; then
      kill -9 "$child_pid" 2>/dev/null || true
    fi
  fi
  rm -f "$SERVER_PID_FILE" "$WATCHDOG_PID_FILE"
  wlog "已退出"
  exit 0
}

trap cleanup TERM INT

should_stop() { [ -f "$STOP_FLAG" ]; }

note_crash() {
  local now
  now=$(date +%s)
  crash_times+=("$now")
  local kept=()
  local t
  for t in ${crash_times[@]+"${crash_times[@]}"}; do
    if [ $((now - t)) -le $CRASH_WINDOW ]; then
      kept+=("$t")
    fi
  done
  if [ ${#kept[@]} -gt 0 ]; then
    crash_times=("${kept[@]}")
  else
    crash_times=()
  fi
  echo ${#crash_times[@]}
}

echo $$ > "$WATCHDOG_PID_FILE"
wlog "watchdog 已启动 (PID $$，端口 $PORT，数据目录 $DATA_DIR)"

while true; do
  if should_stop; then
    wlog "检测到停止标志，退出循环"
    break
  fi

  wlog "启动 node server.js"
  (cd "$PROJECT_DIR" && exec node server.js) >> "$LOG_FILE" 2>&1 &
  child_pid=$!
  echo "$child_pid" > "$SERVER_PID_FILE"
  wlog "server.js 已拉起 (PID $child_pid)"

  set +e
  wait "$child_pid"
  code=$?
  set -e
  child_pid=""

  if should_stop; then
    wlog "server 已按停止标志退出 (code=$code)"
    break
  fi

  count=$(note_crash)
  wlog "server 异常退出 code=$code，近 ${CRASH_WINDOW}s 内第 ${count} 次崩溃"

  if [ "$count" -ge "$CRASH_LIMIT" ]; then
    wlog "崩溃过于频繁，冷却 ${CRASH_WINDOW}s 后再拉起"
    sleep "$CRASH_WINDOW"
    crash_times=()
  else
    sleep "$RESTART_DELAY"
  fi
done

rm -f "$STOP_FLAG" "$WATCHDOG_PID_FILE" "$SERVER_PID_FILE"
wlog "watchdog 正常结束"
exit 0
