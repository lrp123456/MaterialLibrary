#!/usr/bin/env bash
# ==============================================================================
# MaterialLibraryServer watchdog：崩溃后自动重启
#   - 主服务   node server.js              （ML_PORT，默认 30001）
#   - 工作台  web-pro/server.cjs 30002     （WEB_PRO_PORT，默认 30002）
# 30002 网关之前由自启脚本 nohup 一次性拉起，WSL 实例回收/进程崩溃后无人重启，
# 局域网设备就会“页面打得开、接口全失败/空白”。这里与主服务一起常驻守护。
# 由 start-watchdog-clean.sh / start.sh 调起；stop 时通过 stop 标志优雅退出。
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
WEB_PRO_PORT="${WEB_PRO_PORT:-30002}"
LOG_DIR="$DATA_DIR/logs"
LOG_FILE="$DATA_DIR/server.log"
WEBPRO_LOG_FILE="$DATA_DIR/webpro.log"
WATCHDOG_LOG="$DATA_DIR/watchdog.log"
WATCHDOG_PID_FILE="$DATA_DIR/watchdog.pid"
SERVER_PID_FILE="$DATA_DIR/server.pid"
WEBPRO_PID_FILE="$DATA_DIR/webpro.pid"
STOP_FLAG="$DATA_DIR/watchdog.stop"
RESTART_DELAY="${ML_RESTART_DELAY:-3}"
# 连续快速崩溃保护：10 分钟内超过 8 次则冷却 60s
CRASH_WINDOW=600
CRASH_LIMIT=8

mkdir -p "$DATA_DIR" "$LOG_DIR"

# 是否同时守护 web-pro 30002 网关（默认开启；ML_WATCH_WEBPRO=0 可关）
WATCH_WEBPRO=1
[ "${ML_WATCH_WEBPRO:-1}" = "0" ] && WATCH_WEBPRO=0

declare -A child_pid=()        # [main|webpro]=pid
declare -A crash_times=()      # 各服务独立的崩溃时间戳数组（空格分隔字符串）

ts() { date '+%Y-%m-%d %H:%M:%S'; }
# 只写 stderr：由 start.sh 的 nohup 重定向进 watchdog.log，避免 tee 双写
wlog() { echo "[$(ts)] [watchdog] $1" >&2; }

cleanup() {
  wlog "收到退出信号，正在停止子进程..."
  rm -f "$STOP_FLAG"
  for name in main webpro; do
    local pid="${child_pid[$name]:-}"
    if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
      kill "$pid" 2>/dev/null || true
      local waited=0
      while kill -0 "$pid" 2>/dev/null && [ $waited -lt 20 ]; do
        sleep 0.25
        waited=$((waited + 1))
      done
      if kill -0 "$pid" 2>/dev/null; then
        kill -9 "$pid" 2>/dev/null || true
      fi
    fi
  done
  rm -f "$SERVER_PID_FILE" "$WEBPRO_PID_FILE" "$WATCHDOG_PID_FILE"
  wlog "已退出"
  exit 0
}

trap cleanup TERM INT

should_stop() { [ -f "$STOP_FLAG" ]; }

# 记录某服务崩溃时间，返回窗口内崩溃次数（用空格分隔字符串模拟数组，兼容旧 bash）
note_crash() {
  local name="$1"
  local now
  now=$(date +%s)
  local prev="${crash_times[$name]:-}"
  local kept=""
  local t
  for t in $prev; do
    if [ $((now - t)) -le "$CRASH_WINDOW" ]; then
      kept="$kept $t"
    fi
  done
  kept="$kept $now"
  crash_times[$name]="$kept"
  # 统计非空 token 数
  echo $kept | wc -w | tr -d ' '
}

start_service() {
  local name="$1"
  if [ "$name" = "main" ]; then
    (cd "$PROJECT_DIR" && exec node server.js) >> "$LOG_FILE" 2>&1 &
  else
    (cd "$PROJECT_DIR/web-pro" && exec node server.cjs "$WEB_PRO_PORT") >> "$WEBPRO_LOG_FILE" 2>&1 &
  fi
  local pid=$!
  child_pid[$name]="$pid"
  if [ "$name" = "main" ]; then
    echo "$pid" > "$SERVER_PID_FILE"
  else
    echo "$pid" > "$WEBPRO_PID_FILE"
  fi
  wlog "$name 已拉起 (PID $pid)"
}

echo $$ > "$WATCHDOG_PID_FILE"
wlog "watchdog 已启动 (PID $$，主服务端口 $PORT，web-pro 端口 $WEB_PRO_PORT，守护webpro=$WATCH_WEBPRO，数据目录 $DATA_DIR)"

# 主服务与 web-pro 网关各自独立崩溃计数、独立重启，互不影响。
while true; do
  if should_stop; then
    wlog "检测到停止标志，退出循环"
    break
  fi

  # 拉起尚未运行的被监管进程
  if [ -z "${child_pid[main]:-}" ] || ! kill -0 "${child_pid[main]}" 2>/dev/null; then
    start_service main
  fi
  if [ "$WATCH_WEBPRO" = "1" ] && { [ -z "${child_pid[webpro]:-}" ] || ! kill -0 "${child_pid[webpro]}" 2>/dev/null; }; then
    start_service webpro
  fi

  # 等待任一子进程退出（set +e 避免 wait 被信号/子退出打断时脚本终止）
  set +e
  wait -n 2>/dev/null
  set -e
  sleep 0.2

  if should_stop; then
    wlog "子进程因停止标志退出"
    break
  fi

  # 检查谁退出了并安排重启
  for name in main webpro; do
    [ "$name" = "webpro" ] && [ "$WATCH_WEBPRO" = "0" ] && continue
    local_pid="${child_pid[$name]:-}"
    if [ -n "$local_pid" ] && ! kill -0 "$local_pid" 2>/dev/null; then
      count=$(note_crash "$name")
      child_pid[$name]=""
      wlog "$name 异常退出，近 ${CRASH_WINDOW}s 内第 ${count} 次崩溃"
      if [ "$count" -ge "$CRASH_LIMIT" ]; then
        wlog "$name 崩溃过于频繁，冷却 ${CRASH_WINDOW}s 后再拉起"
        sleep "$CRASH_WINDOW"
        crash_times[$name]=""
      else
        sleep "$RESTART_DELAY"
      fi
    fi
  done
done

rm -f "$STOP_FLAG" "$WATCHDOG_PID_FILE" "$SERVER_PID_FILE" "$WEBPRO_PID_FILE"
wlog "watchdog 正常结束"
exit 0
