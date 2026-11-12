#!/usr/bin/env bash
# ==============================================================================
# 室内设计素材库 (DSH Material Library) - 一键运维管理脚本
# 支持启动、停止、重启、状态检测与实时日志查看
# ==============================================================================

set -e

# 基础路径配置
export PATH="/home/lrp/.local/node/bin:$PATH"
# 代理兜底：Node 全局 fetch 不读 http_proxy，proxy-setup 会消费这些变量做候选探测
if [ -z "${https_proxy:-}" ] && [ -z "${HTTPS_PROXY:-}" ]; then
  export https_proxy="http://127.0.0.1:7890"
  export http_proxy="http://127.0.0.1:7890"
  export HTTPS_PROXY="$https_proxy"
  export HTTP_PROXY="$http_proxy"
fi
export no_proxy="${no_proxy:-localhost,127.0.0.1,::1,newapi.naite.cc,naite.cc,aliyuncs.com,aliyun.com,volces.com,volcengine.com,modelscope.cn,agnes-ai.cn,api.agnes-ai.cn,laozhang.ai}"
export NO_PROXY="${NO_PROXY:-$no_proxy}"
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DATA_DIR="${ML_DATA_DIR:-$HOME/.dsh-material-library}"
PORT="${ML_PORT:-30001}"
PID_FILE="$DATA_DIR/server.pid"
WATCHDOG_PID_FILE="$DATA_DIR/watchdog.pid"
STOP_FLAG="$DATA_DIR/watchdog.stop"
WATCHDOG_SCRIPT="$PROJECT_DIR/scripts/watchdog.sh"
LOG_DIR="$DATA_DIR/logs"
LOG_FILE="$DATA_DIR/server.log"
WATCHDOG_LOG="$DATA_DIR/watchdog.log"

mkdir -p "$DATA_DIR" "$LOG_DIR"

# 颜色高亮
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
CYAN='\033[0;36m'
BOLD='\033[1m'
NC='\033[0m' # No Color

info() { echo -e "${BLUE}[INFO]${NC} $1"; }
success() { echo -e "${GREEN}[OK]${NC} $1"; }
warn() { echo -e "${YELLOW}[WARN]${NC} $1"; }
err() { echo -e "${RED}[ERROR]${NC} $1"; }

# 获取 watchdog PID
get_watchdog_pid() {
  local pid=""
  if [ -f "$WATCHDOG_PID_FILE" ]; then
    local candidate
    candidate=$(cat "$WATCHDOG_PID_FILE" 2>/dev/null || true)
    if [ -n "$candidate" ] && kill -0 "$candidate" 2>/dev/null; then
      pid="$candidate"
    fi
  fi
  echo "$pid"
}

# 获取本机局域网 IP
get_lan_ip() {
  local ip=""
  if command -v hostname >/dev/null 2>&1; then
    ip=$(hostname -I 2>/dev/null | awk '{print $1}')
  fi
  if [ -z "$ip" ] && command -v ip >/dev/null 2>&1; then
    ip=$(ip -4 addr show scope global 2>/dev/null | grep -oP '(?<=inet\s)\d+(\.\d+){3}' | head -n 1)
  fi
  echo "${ip:-127.0.0.1}"
}

# 检查 Node 环境
check_node() {
  if ! command -v node >/dev/null 2>&1; then
    err "未检测到 Node.js，请先安装 Node.js >= 18.0.0"
    exit 1
  fi
  local node_ver
  node_ver=$(node -v | sed 's/v//')
  local major_ver
  major_ver=$(echo "$node_ver" | cut -d. -f1)
  if [ "$major_ver" -lt 18 ]; then
    warn "当前 Node.js 版本为 v$node_ver，建议使用 Node.js >= 18.0.0"
  fi
}

# 检查前端构建静态包
check_frontend() {
  if [ ! -f "$PROJECT_DIR/web/dist/index.html" ]; then
    info "检测到前端静态包尚未构建，正在自动执行首次编译 (npm run build)..."
    if [ -d "$PROJECT_DIR/web" ]; then
      (cd "$PROJECT_DIR/web" && npm run build)
      success "前端静态资源编译完成！"
    else
      err "未找到 web/ 前端源代码目录"
      exit 1
    fi
  fi
}

# 检查当前运行 PID
get_running_pid() {
  local pid=""
  if [ -f "$PID_FILE" ]; then
    local candidate
    candidate=$(cat "$PID_FILE" 2>/dev/null || true)
    if [ -n "$candidate" ] && kill -0 "$candidate" 2>/dev/null; then
      pid="$candidate"
    fi
  fi

  if [ -z "$pid" ] && command -v lsof >/dev/null 2>&1; then
    pid=$(lsof -ti :"$PORT" 2>/dev/null | head -n 1 || true)
  elif [ -z "$pid" ] && command -v fuser >/dev/null 2>&1; then
    pid=$(fuser "$PORT"/tcp 2>/dev/null | awk '{print $1}' || true)
  fi

  echo "$pid"
}

# 启动服务（后台 + watchdog 自动重启）
# 剪辑资源包 / AI runner 是代码，随仓库维护；后端从数据目录读。
# 启动前自动同步，保证"改了代码 → 重启后端"即生效，不用手工拷贝。
sync_clip_runtime() {
  local data_dir="${ML_DATA_DIR:-$HOME/.dsh-material-library}"
  mkdir -p "$data_dir/clip-packs" "$data_dir/clip-ai-runners"
  if [ -d "$PROJECT_DIR/data/clip-packs" ]; then
    cp -r "$PROJECT_DIR/data/clip-packs/." "$data_dir/clip-packs/" 2>/dev/null || true
  fi
  if [ -d "$PROJECT_DIR/data/clip-ai-runners" ]; then
    cp -r "$PROJECT_DIR/data/clip-ai-runners/." "$data_dir/clip-ai-runners/" 2>/dev/null || true
  fi
  info "已同步剪辑资源包与 AI runner 到 $data_dir"
}

start_server() {
  check_node
  check_frontend
  sync_clip_runtime

  local running_pid wd_pid
  running_pid=$(get_running_pid)
  wd_pid=$(get_watchdog_pid)
  if [ -n "$running_pid" ]; then
    warn "素材库服务已在运行中 (PID: $running_pid，端口: $PORT)"
    echo -e "访问地址: ${CYAN}http://127.0.0.1:$PORT${NC}"
    echo -e "如需重启，请运行: ${BOLD}$0 restart${NC}"
    exit 0
  fi
  if [ -n "$wd_pid" ]; then
    local asked=0
    if [ -f "$DATA_DIR/faults/main.hold" ]; then
      mkdir -p "$DATA_DIR/faults"
      touch "$DATA_DIR/faults/main.retry"
      info "已请求重试服务端（上次启动失败，自动重启已停）"
      asked=1
    fi
    if [ -f "$DATA_DIR/faults/webpro.hold" ]; then
      mkdir -p "$DATA_DIR/faults"
      touch "$DATA_DIR/faults/webpro.retry"
      info "已请求重试 Web（上次启动失败，自动重启已停）"
      asked=1
    fi
    if [ "$asked" -eq 1 ]; then
      exit 0
    fi
    warn "watchdog 已在运行 (PID: $wd_pid)，但服务未就绪，查看日志: $WATCHDOG_LOG"
    exit 1
  fi

  if [ ! -f "$WATCHDOG_SCRIPT" ]; then
    err "未找到 watchdog 脚本: $WATCHDOG_SCRIPT"
    exit 1
  fi

  info "正在启动室内设计素材库服务 (端口: $PORT，崩溃自动重启)..."
  cd "$PROJECT_DIR"
  rm -f "$STOP_FLAG" "$WATCHDOG_PID_FILE"
  mkdir -p "$DATA_DIR/faults"
  rm -f "$DATA_DIR/faults/main.hold" "$DATA_DIR/faults/webpro.hold" \
        "$DATA_DIR/faults/main.retry" "$DATA_DIR/faults/webpro.retry"

  # 后台启动 watchdog（内含 node server.js）；PID 由脚本自写，不信任 setsid 的 $!
  nohup setsid bash "$WATCHDOG_SCRIPT" >> "$WATCHDOG_LOG" 2>&1 &

  # 等待 watchdog 写入 PID
  local wd_wait=0
  local new_pid=""
  while [ $wd_wait -lt 30 ]; do
    new_pid=$(get_watchdog_pid)
    [ -n "$new_pid" ] && break
    sleep 0.2
    wd_wait=$((wd_wait + 1))
  done

  if [ -z "$new_pid" ]; then
    err "watchdog 未能写入 PID，启动失败。日志："
    tail -n 20 "$WATCHDOG_LOG" 2>/dev/null || true
    exit 1
  fi

  # 等待健康检查（优先看 HTTP，其次看 server.pid）
  local attempts=0
  local max_attempts=15
  local started=0
  while [ $attempts -lt $max_attempts ]; do
    sleep 1
    local server_pid
    server_pid=$(get_running_pid)
    if [ -n "$server_pid" ] || kill -0 "$new_pid" 2>/dev/null; then
      if command -v curl >/dev/null 2>&1; then
        if curl -s -m 2 "http://127.0.0.1:$PORT/" >/dev/null 2>&1; then
          started=1
          break
        fi
      elif [ -n "$server_pid" ]; then
        started=1
        break
      fi
    else
      break
    fi
    attempts=$((attempts + 1))
  done

  if [ $started -eq 1 ]; then
    local lan_ip server_pid
    lan_ip=$(get_lan_ip)
    server_pid=$(get_running_pid)
    echo ""
    echo -e "${GREEN}${BOLD}======================================================${NC}"
    echo -e "${GREEN}${BOLD}     室内设计素材库服务已成功启动！${NC}"
    echo -e "${GREEN}${BOLD}======================================================${NC}"
    echo -e "  • 服务 PID    : ${BOLD}${server_pid:-N/A}${NC}"
    echo -e "  • Watchdog PID: ${BOLD}${new_pid}${NC} (崩溃自动重启)"
    echo -e "  • 本机访问    : ${CYAN}${BOLD}http://127.0.0.1:$PORT${NC}"
    echo -e "  • 局域网访问  : ${CYAN}${BOLD}http://$lan_ip:$PORT${NC} (电脑/手机同局域网均可直达)"
    echo -e "  • 数据目录    : $DATA_DIR"
    echo -e "  • 运行日志    : $LOG_FILE"
    echo -e "  • 守护日志    : $WATCHDOG_LOG"
    echo -e "------------------------------------------------------"
    echo -e "  • 登录账号在数据目录的凭据文件里，启动日志不再打印口令"
    echo -e "------------------------------------------------------"
    echo -e "  • 查看实时日志: ${YELLOW}$0 logs${NC}"
    echo -e "  • 查看运行状态: ${YELLOW}$0 status${NC}"
    echo -e "  • 停止后台服务: ${YELLOW}$0 stop${NC}"
    echo -e "${GREEN}======================================================${NC}"
    echo ""
  else
    err "服务启动可能异常，请检查日志:"
    tail -n 20 "$LOG_FILE" 2>/dev/null || true
    tail -n 20 "$WATCHDOG_LOG" 2>/dev/null || true
    exit 1
  fi
}

# 前台启动 (调试用)
start_foreground() {
  check_node
  check_frontend

  local running_pid
  running_pid=$(get_running_pid)
  if [ -n "$running_pid" ]; then
    warn "端口 $PORT 已被占用 (PID: $running_pid)，请先停止现有服务: $0 stop"
    exit 1
  fi

  info "正在前台运行素材库服务 (Ctrl+C 停止)..."
  cd "$PROJECT_DIR"
  exec node server.js
}

# 停止服务（先停 watchdog，再兜底杀 server）
stop_server() {
  local wd_pid pid
  wd_pid=$(get_watchdog_pid)
  pid=$(get_running_pid)

  if [ -z "$wd_pid" ] && [ -z "$pid" ]; then
    warn "素材库服务当前未运行"
    rm -f "$PID_FILE" "$WATCHDOG_PID_FILE" "$STOP_FLAG"
    return 0
  fi

  # 写停止标志，避免 watchdog 在 server 退出后再次拉起
  touch "$STOP_FLAG"

  if [ -n "$wd_pid" ]; then
    info "正在停止 watchdog (PID: $wd_pid)..."
    kill "$wd_pid" 2>/dev/null || true
  fi

  if [ -n "$pid" ]; then
    info "正在停止素材库服务 (PID: $pid)..."
    # watchdog 的 trap 会杀子进程；这里再兜底一次
    kill "$pid" 2>/dev/null || true
  fi

  local clash_pid
  if [ -f "$DATA_DIR/clash.pid" ]; then
    clash_pid=$(cat "$DATA_DIR/clash.pid" 2>/dev/null || true)
    if [ -n "$clash_pid" ] && kill -0 "$clash_pid" 2>/dev/null; then
      info "正在停止内置 clash (PID: $clash_pid)..."
      kill "$clash_pid" 2>/dev/null || true
    fi
  fi

  # 等待平稳退出
  local waited=0
  while [ $waited -lt 12 ]; do
    local wd_alive=0 srv_alive=0
    [ -n "$wd_pid" ] && kill -0 "$wd_pid" 2>/dev/null && wd_alive=1
    [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null && srv_alive=1
    [ $wd_alive -eq 0 ] && [ $srv_alive -eq 0 ] && break
    sleep 0.5
    waited=$((waited + 1))
  done

  if [ -n "$wd_pid" ] && kill -0 "$wd_pid" 2>/dev/null; then
    warn "watchdog 未在 6 秒内退出，强制终结 (SIGKILL)..."
    kill -9 "$wd_pid" 2>/dev/null || true
  fi
  if [ -n "$pid" ] && kill -0 "$pid" 2>/dev/null; then
    warn "服务未在 6 秒内退出，强制终结 (SIGKILL)..."
    kill -9 "$pid" 2>/dev/null || true
  fi

  rm -f "$PID_FILE" "$WATCHDOG_PID_FILE" "$STOP_FLAG"
  success "服务已成功停止"
}

# 重启服务
restart_server() {
  info "正在重启素材库服务..."
  stop_server
  sleep 1
  start_server
}

# 状态查询
status_server() {
  local pid wd_pid
  pid=$(get_running_pid)
  wd_pid=$(get_watchdog_pid)
  if [ -n "$pid" ]; then
    local lan_ip
    lan_ip=$(get_lan_ip)
    success "素材库服务正在运行"
    echo -e "  • 服务 PID    : ${BOLD}$pid${NC}"
    echo -e "  • Watchdog PID: ${BOLD}${wd_pid:-未运行}${NC}"
    echo -e "  • 监听端口    : ${BOLD}$PORT${NC}"
    echo -e "  • 本机地址    : ${CYAN}http://127.0.0.1:$PORT${NC}"
    echo -e "  • 局域网地址  : ${CYAN}http://$lan_ip:$PORT${NC}"
    echo -e "  • 日志文件    : $LOG_FILE"
    echo -e "  • 守护日志    : $WATCHDOG_LOG"

    # 打印系统资源占用
    if command -v ps >/dev/null 2>&1; then
      echo -e "  • 资源占用    : $(ps -p "$pid" -o %cpu,%mem,etime --no-headers | awk '{print "CPU: "$1"%, 内存: "$2"%, 运行时间: "$3}')"
    fi

    # 尝试读取数据库统计
    if command -v node >/dev/null 2>&1 && [ -f "$PROJECT_DIR/src/db.js" ]; then
      node -e "
        try {
          const { openDb } = require('$PROJECT_DIR/src/db');
          const db = openDb('$DATA_DIR');
          const total = db.prepare('SELECT count(*) c FROM assets').get().c;
          const passed = db.prepare(\"SELECT count(*) c FROM assets WHERE ready_flags=31\").get().c;
          console.log('  • 资产总数    : ' + total + ' 张 (打标就绪: ' + passed + ' 张)');
        } catch(e) {}
      " 2>/dev/null || true
    fi
  elif [ -n "$wd_pid" ]; then
    warn "watchdog 在运行 (PID: $wd_pid)，但服务未就绪，查看: $WATCHDOG_LOG"
  else
    warn "素材库服务未运行"
  fi
  local holdf reason
  for holdf in "$DATA_DIR/faults/main.hold" "$DATA_DIR/faults/webpro.hold"; do
    if [ -f "$holdf" ]; then
      echo -e "  • 启动挂起    : ${BOLD}$(basename "$holdf")${NC}"
      reason=$(grep '^reason=' "$holdf" | head -n 1 || true)
      [ -n "$reason" ] && echo "    ${reason#reason=}"
    fi
  done
}

# 实时查看日志
tail_logs() {
  if [ ! -f "$LOG_FILE" ] && [ ! -f "$WATCHDOG_LOG" ]; then
    warn "日志文件 $LOG_FILE 尚未创建"
    exit 0
  fi
  info "正在实时监听服务/守护日志 (Ctrl+C 退出)..."
  tail -n 50 -f "$LOG_FILE" "$WATCHDOG_LOG" 2>/dev/null
}

# 入口分发
case "${1:-start}" in
  start)
    start_server
    ;;
  fg|foreground)
    start_foreground
    ;;
  stop)
    stop_server
    ;;
  restart)
    restart_server
    ;;
  status)
    status_server
    ;;
  logs|log)
    tail_logs
    ;;
  *)
    echo "用法: $0 {start|stop|restart|status|logs|fg}"
    echo ""
    echo "命令列表:"
    echo "  start     : 后台启动服务（默认，带 watchdog 崩溃自动重启）"
    echo "  stop      : 优雅停止服务与 watchdog"
    echo "  restart   : 重启后台服务"
    echo "  status    : 查看当前运行状态与资源占用"
    echo "  logs      : 实时查看运行日志"
    echo "  fg        : 前台运行模式（适合实时排错，无自动重启）"
    exit 1
    ;;
esac
