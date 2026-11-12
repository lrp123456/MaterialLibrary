#!/usr/bin/env bash
# ==============================================================================
# MaterialLibraryServer watchdog
#   - 主服务   node server.js              （ML_PORT，默认 30001）
#   - 工作台  web-pro/server.cjs 30002     （WEB_PRO_PORT，默认 30002）
# 运行起来之后若再崩溃，短延迟拉起；10 分钟内运行中崩溃满 8 次则停住。
# 起来之前或起来瞬间（默认 20s 内）以非 0 退出：记下退出码和最后一段报错，
# 停止再拉，直到 start.sh / 控制台手动重试。正常退出（code 0，发布重启）仍会拉起。
# 由 start.sh 调起；stop 时通过 stop 标志优雅退出。
# ==============================================================================

set -u
set +m  # 关闭 job control，避免 wait 时打印 "Killed" 等噪音

export PATH="/home/lrp/.local/node/bin:/home/naite/.local/bin:/usr/local/bin:/usr/bin:/bin:$PATH"

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
if [ -z "${ML_DATA_DIR:-}" ]; then
  if [ -d "/data/lrp" ]; then
    DATA_DIR="/data/lrp/dsh-material-library"
  else
    DATA_DIR="$HOME/.dsh-material-library"
  fi
else
  DATA_DIR="$ML_DATA_DIR"
fi
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
# 预热节奏：新素材入库后 grid/preview 衍生图要现算，吃 CPU 且拖慢 App 首图。
# 预热必须在 WSL 侧跑（真实 dataDir 在 ext4），所以由本 watchdog 调度。
PREWARM_INTERVAL="${ML_PREWARM_INTERVAL:-1800}"
PREWARM_FIRST_DELAY="${ML_PREWARM_FIRST_DELAY:-60}"
PREWARM_LOG="$LOG_DIR/prewarm.log"
PREWARM_PID=""
# 运行中的崩溃计数窗口。次数写在本进程里，禁止再用 $(note_crash)——
# 命令替换是子 shell，计数会被丢掉，日志永远显示「第 1 次」，冷却永远不触发。
CRASH_WINDOW=600
CRASH_LIMIT=8
STARTUP_GRACE="${ML_STARTUP_GRACE:-20}"
FAULT_DIR="$DATA_DIR/faults"

mkdir -p "$DATA_DIR" "$LOG_DIR" "$FAULT_DIR"

# 是否同时守护 web-pro 30002 网关（默认开启；ML_WATCH_WEBPRO=0 可关）
WATCH_WEBPRO=1
[ "${ML_WATCH_WEBPRO:-1}" = "0" ] && WATCH_WEBPRO=0

# 内置独立 clash/mihomo 代理守护（自闭环生命周期，仅监听 127.0.0.1:7890，不影响系统其他网络）
CLASH_DIR="$DATA_DIR/clash"
CLASH_BIN="$CLASH_DIR/mihomo"
[ ! -x "$CLASH_BIN" ] && CLASH_BIN="$CLASH_DIR/clash"
CLASH_CONFIG="$CLASH_DIR/config.yaml"
CLASH_LOG="$DATA_DIR/clash.log"
CLASH_PID_FILE="$DATA_DIR/clash.pid"

WATCH_CLASH=0
if [ -x "$CLASH_BIN" ] && [ -f "$CLASH_CONFIG" ]; then
  WATCH_CLASH=1
  export http_proxy="http://127.0.0.1:7890"
  export https_proxy="http://127.0.0.1:7890"
  export HTTP_PROXY="http://127.0.0.1:7890"
  export HTTPS_PROXY="http://127.0.0.1:7890"
fi

declare -A child_pid=()        # [main|webpro|clash]=pid
declare -A crash_times=()      # 各服务独立的崩溃时间戳（空格分隔，只在本 shell 更新）
declare -A child_started=()    # 拉起时刻，用来区分「没起来」和「跑起来之后崩了」
declare -A child_log_off=()    # 拉起时日志文件的字节长度，崩溃时只读新增的一段
declare -A held=()             # 1 = 启动失败或崩溃过多，不再自动拉起
NOTE_CRASH_COUNT=0

ts() { date '+%Y-%m-%d %H:%M:%S'; }
# 只写 stderr：由 start.sh 的 nohup 重定向进 watchdog.log，避免 tee 双写
wlog() { echo "[$(ts)] [watchdog] $1" >&2; }

service_log() {
  case "$1" in
    main) echo "$LOG_FILE" ;;
    webpro) echo "$WEBPRO_LOG_FILE" ;;
    clash) echo "$CLASH_LOG" ;;
  esac
}

cleanup() {
  wlog "收到退出信号，正在停止子进程..."
  rm -f "$STOP_FLAG"
  if [ -n "$PREWARM_PID" ] && kill -0 "$PREWARM_PID" 2>/dev/null; then
    kill "$PREWARM_PID" 2>/dev/null || true
  fi
  for name in main webpro clash; do
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
  rm -f "$SERVER_PID_FILE" "$WEBPRO_PID_FILE" "$WATCHDOG_PID_FILE" "$CLASH_PID_FILE"
  wlog "已退出"
  exit 0
}

trap cleanup TERM INT

should_stop() { [ -f "$STOP_FLAG" ]; }

# 记一次运行中崩溃。结果放在 NOTE_CRASH_COUNT，调用方直接读，不要包进 $()。
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
  NOTE_CRASH_COUNT=$(echo $kept | wc -w | tr -d ' ')
}

service_log() {
  if [ "$1" = "main" ]; then
    printf '%s' "$LOG_FILE"
  else
    printf '%s' "$WEBPRO_LOG_FILE"
  fi
}

service_label() {
  if [ "$1" = "main" ]; then printf '%s' '服务端'; else printf '%s' 'Web'; fi
}

service_port() {
  if [ "$1" = "main" ]; then printf '%s' "$PORT"; else printf '%s' "$WEB_PRO_PORT"; fi
}

# 把这次退出的原因写成 faults/<name>.hold。控制台读这个文件，不再从 20MB 日志里翻。
write_fault() {
  local name="$1" code="$2" uptime="$3" kind="$4"
  local log off slice reason label port out
  log=$(service_log "$name")
  off="${child_log_off[$name]:-0}"
  label=$(service_label "$name")
  port=$(service_port "$name")
  mkdir -p "$FAULT_DIR"
  slice="$FAULT_DIR/.$name.slice"
  : > "$slice"
  if [ -f "$log" ]; then
    local sz
    sz=$(stat -c %s "$log" 2>/dev/null || echo 0)
    if [ "$off" -lt "$sz" ]; then
      tail -c +$((off + 1)) "$log" | tail -n 80 > "$slice" || true
    fi
  fi
  reason=$(grep -E 'EADDRINUSE|Cannot find module|MODULE_NOT_FOUND|Unhandled|未捕获|FATAL|JavaScript heap|SQLITE_|better_sqlite3|SyntaxError|ReferenceError|TypeError:|listen E|启动失败|ENOSPC|EACCES|Error:' "$slice" | tail -n 1 || true)
  reason=${reason//$'\r'/}
  if [ -z "$reason" ]; then
    reason=$(grep -v '^[[:space:]]*$' "$slice" | tail -n 1 || true)
    reason=${reason//$'\r'/}
  fi
  if [ -z "$reason" ]; then
    reason="进程退出（exit ${code}），这段日志没有新的报错行"
  fi
  reason=${reason:0:400}
  if [ "$kind" = "loop" ]; then
    reason="运行中 ${CRASH_WINDOW}s 内崩溃 ${NOTE_CRASH_COUNT} 次，已停止自动拉起。最后一条：${reason}"
  fi
  out="$FAULT_DIR/.$name.hold.new"
  {
    echo "service=${name}"
    echo "label=${label}"
    echo "port=${port}"
    echo "exit_code=${code}"
    echo "uptime_sec=${uptime}"
    echo "at=$(ts)"
    echo "kind=${kind}"
    echo "reason=${reason}"
    echo "---"
    cat "$slice"
  } > "$out"
  mv -f "$out" "$FAULT_DIR/$name.hold"
  wlog "$name 已停止自动拉起。exit=${code} uptime=${uptime}s kind=${kind} 原因: ${reason}"
}

start_service() {
  local name="$1"
  local log off
  log=$(service_log "$name")
  off=0
  if [ -f "$log" ]; then
    off=$(stat -c %s "$log" 2>/dev/null || echo 0)
  fi
  rm -f "$FAULT_DIR/$name.hold"
  if [ "$name" = "clash" ]; then
    (cd "$CLASH_DIR" && exec "$CLASH_BIN" -d "$CLASH_DIR" -f "$CLASH_CONFIG") >> "$CLASH_LOG" 2>&1 &
  elif [ "$name" = "main" ]; then
    if [ "${ML_WATCHDOG_SELFTEST:-}" = "1" ] && [ -n "${ML_WATCH_MAIN_CMD:-}" ]; then
      bash -c "$ML_WATCH_MAIN_CMD" >> "$log" 2>&1 &
    else
      (cd "$PROJECT_DIR" && exec node server.js) >> "$log" 2>&1 &
    fi
  else
    (cd "$PROJECT_DIR/web-pro" && exec node server.cjs "$WEB_PRO_PORT") >> "$WEBPRO_LOG_FILE" 2>&1 &
  fi
  local pid=$!
  child_pid[$name]="$pid"
  child_started[$name]=$(date +%s)
  child_log_off[$name]="$off"
  held[$name]=0
  if [ "$name" = "main" ]; then
    echo "$pid" > "$SERVER_PID_FILE"
  elif [ "$name" = "webpro" ]; then
    echo "$pid" > "$WEBPRO_PID_FILE"
  elif [ "$name" = "clash" ]; then
    echo "$pid" > "$CLASH_PID_FILE"
  fi
  wlog "$name 已拉起 (PID $pid)"
}

consume_retry() {
  local name="$1"
  local flag="$FAULT_DIR/$name.retry"
  if [ -f "$flag" ]; then
    rm -f "$flag" "$FAULT_DIR/$name.hold"
    held[$name]=0
    crash_times[$name]=""
    wlog "$name 收到手动重试，清除启动挂起"
  fi
}

# 子进程已经不在了。code 0 视为发布/主动退出，继续拉起。
# 非 0 且活不过 STARTUP_GRACE：启动失败，写 hold，不再拉。
handle_exit() {
  local name="$1" code="$2"
  local now started uptime
  now=$(date +%s)
  started="${child_started[$name]:-$now}"
  uptime=$((now - started))
  if [ "$uptime" -lt 0 ]; then uptime=0; fi
  child_pid[$name]=""
  if [ "$code" -eq 0 ]; then
    wlog "$name 正常退出 (uptime ${uptime}s)，${RESTART_DELAY}s 后拉起"
    sleep "$RESTART_DELAY"
    return
  fi
  if [ "$uptime" -lt "$STARTUP_GRACE" ]; then
    write_fault "$name" "$code" "$uptime" "startup"
    held[$name]=1
    return
  fi
  note_crash "$name"
  wlog "$name 运行中异常退出 code=${code}，近 ${CRASH_WINDOW}s 内第 ${NOTE_CRASH_COUNT} 次"
  if [ "$NOTE_CRASH_COUNT" -ge "$CRASH_LIMIT" ]; then
    write_fault "$name" "$code" "$uptime" "loop"
    held[$name]=1
    return
  fi
  sleep "$RESTART_DELAY"
}

# kill -0 对僵尸进程仍返回成功，不能拿它判断「还活着」。
proc_gone() {
  local pid="$1"
  if ! kill -0 "$pid" 2>/dev/null; then
    return 0
  fi
  local stat rest state
  stat=$(cat "/proc/$pid/stat" 2>/dev/null || true)
  rest="${stat##*) }"
  state="${rest%% *}"
  [ "$state" = "Z" ]
}

reap() {
  local name pid code
  for name in main webpro; do
    [ "$name" = "webpro" ] && [ "$WATCH_WEBPRO" = "0" ] && continue
    pid="${child_pid[$name]:-}"
    [ -n "$pid" ] || continue
    if ! proc_gone "$pid"; then
      continue
    fi
    if should_stop; then
      child_pid[$name]=""
      wait "$pid" 2>/dev/null || true
      continue
    fi
    set +e
    wait "$pid"
    code=$?
    set +e
    handle_exit "$name" "$code"
  done
}

ensure_started() {
  local name="$1"
  local pid
  consume_retry "$name"
  if [ -f "$FAULT_DIR/$name.hold" ]; then
    held[$name]=1
  fi
  if [ "${held[$name]:-0}" = "1" ]; then
    return 0
  fi
  pid="${child_pid[$name]:-}"
  if [ -n "$pid" ] && ! proc_gone "$pid"; then
    return 0
  fi
  start_service "$name"
}

# 预热循环：独立后台子进程，watchdog 退出时一起收掉
start_prewarm_loop() {
  [ "${ML_PREWARM_ENABLED:-1}" = "0" ] && return 0
  (
    sleep "$PREWARM_FIRST_DELAY"
    while [ ! -f "$STOP_FLAG" ]; do
      bash "$PROJECT_DIR/scripts/prewarm.sh" --limit=200 --concurrency=6 >> "$PREWARM_LOG" 2>&1 || true
      sleep "$PREWARM_INTERVAL"
    done
  ) &
  PREWARM_PID=$!
  wlog "预热循环已启动 (PID $PREWARM_PID，间隔 ${PREWARM_INTERVAL}s，日志 $PREWARM_LOG)"
}

run_self_test() {
  local fail=0 child="" n="" i=""
  crash_times=()
  note_crash main
  [ "$NOTE_CRASH_COUNT" = "1" ] || { echo "FAIL count1=$NOTE_CRASH_COUNT"; fail=1; }
  note_crash main
  [ "$NOTE_CRASH_COUNT" = "2" ] || { echo "FAIL count2=$NOTE_CRASH_COUNT"; fail=1; }
  ( note_crash main )
  note_crash main
  [ "$NOTE_CRASH_COUNT" = "3" ] || { echo "FAIL count3=$NOTE_CRASH_COUNT"; fail=1; }

  local tmp
  tmp=$(mktemp -d)
  ML_DATA_DIR="$tmp" ML_WATCHDOG_SELFTEST=1 ML_PREWARM_ENABLED=0 ML_WATCH_WEBPRO=0 \
    ML_STARTUP_GRACE=20 ML_RESTART_DELAY=1 \
    ML_WATCH_MAIN_CMD='echo "Error: Cannot find module test-mod" >&2; exit 7' \
    bash "$0" >"$tmp/wd.out" 2>&1 &
  child=$!
  for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
    [ -f "$tmp/faults/main.hold" ] && break
    sleep 0.4
  done
  if [ ! -f "$tmp/faults/main.hold" ]; then
    echo "FAIL no hold file"
    fail=1
    cat "$tmp/wd.out" || true
  else
    grep -q 'exit_code=7' "$tmp/faults/main.hold" || { echo "FAIL exit code"; fail=1; }
    grep -q 'Cannot find module test-mod' "$tmp/faults/main.hold" || { echo "FAIL reason"; fail=1; }
  fi
  n=$(grep -c "main 已拉起" "$tmp/wd.out" || true)
  n=${n:-0}
  [ "$n" = "1" ] || { echo "FAIL starts=$n want 1"; fail=1; cat "$tmp/wd.out" || true; }

  touch "$tmp/faults/main.retry"
  for i in 1 2 3 4 5 6 7 8 9 10 11 12 13 14 15; do
    n=$(grep -c "main 已拉起" "$tmp/wd.out" || true)
    n=${n:-0}
    [ "$n" -ge 2 ] && break
    sleep 0.4
  done
  n=$(grep -c "main 已拉起" "$tmp/wd.out" || true)
  n=${n:-0}
  [ "$n" = "2" ] || { echo "FAIL after retry starts=$n want 2"; fail=1; cat "$tmp/wd.out" || true; }
  sleep 2
  n=$(grep -c "main 已拉起" "$tmp/wd.out" || true)
  n=${n:-0}
  [ "$n" = "2" ] || { echo "FAIL kept restarting starts=$n"; fail=1; cat "$tmp/wd.out" || true; }

  if [ -n "$child" ]; then
    kill "$child" 2>/dev/null || true
    wait "$child" 2>/dev/null || true
  fi
  if [ "$fail" -eq 0 ]; then
    echo "PASS watchdog self-test"
    rm -rf "$tmp"
    exit 0
  fi
  echo "FAIL watchdog self-test tmp=$tmp"
  exit 1
}

if [ "${1:-}" = "--self-test" ]; then
  run_self_test
fi

echo $$ > "$WATCHDOG_PID_FILE"
wlog "watchdog 已启动 (PID $$，主服务端口 $PORT，web-pro 端口 $WEB_PRO_PORT，守护webpro=$WATCH_WEBPRO，数据目录 $DATA_DIR，启动失败宽限 ${STARTUP_GRACE}s)"
start_prewarm_loop

# 先收尸再决定要不要拉。启动失败写 faults/*.hold 后停住；手动重试靠 *.retry。
while true; do
  if should_stop; then
    wlog "检测到停止标志，退出循环"
    break
  fi
  if [ -n "$PREWARM_PID" ] && ! kill -0 "$PREWARM_PID" 2>/dev/null; then
    wait "$PREWARM_PID" 2>/dev/null || true
    PREWARM_PID=""
    if ! should_stop; then
      start_prewarm_loop
    fi
  fi
  reap
  if should_stop; then
    break
  fi
  if [ "$WATCH_CLASH" = "1" ]; then
    ensure_started clash
  fi
  ensure_started main
  if [ "$WATCH_WEBPRO" = "1" ]; then
    ensure_started webpro
  fi
  sleep 0.5
done

rm -f "$STOP_FLAG" "$WATCHDOG_PID_FILE" "$SERVER_PID_FILE" "$WEBPRO_PID_FILE" "$CLASH_PID_FILE"
wlog "watchdog 正常结束"
exit 0
