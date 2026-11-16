#!/usr/bin/env bash
# 59 本机透明转发守护脚本
# 维护 59 -> 107 的端口代理（30001、30002）

PID_FILE="$HOME/.dsh-material-library/forwarder.pid"
LOG_FILE="$HOME/.dsh-material-library/forwarder.log"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
FORWARD_JS="$SCRIPT_DIR/proxy_59_to_107.js"

mkdir -p "$HOME/.dsh-material-library"

# 查找 node
NODE_BIN=""
if command -v node >/dev/null 2>&1; then
    NODE_BIN="$(command -v node)"
elif [ -x "$HOME/.local/node/bin/node" ]; then
    NODE_BIN="$HOME/.local/node/bin/node"
elif [ -x "$HOME/.local/bin/node" ]; then
    NODE_BIN="$HOME/.local/bin/node"
else
    echo "未找到 node 可执行文件"
    exit 1
fi

case "$1" in
    start)
        if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
            echo "[OK] 转发服务已在运行 (PID: $(cat "$PID_FILE"))"
            exit 0
        fi
        echo "正在启动 59 -> 107 端口转发守护..."
        nohup setsid "$NODE_BIN" "$FORWARD_JS" >> "$LOG_FILE" 2>&1 &
        local_pid=$!
        sleep 0.5
        # 找到实际运行的 node PID
        actual_pid=$(pgrep -f "proxy_59_to_107.js" | head -n 1)
        if [ -n "$actual_pid" ]; then
            echo "$actual_pid" > "$PID_FILE"
            echo "[OK] 转发服务启动成功 (PID: $actual_pid)"
            echo "  • API: http://192.168.1.59:30001 -> 192.168.1.107:30001"
            echo "  • Web: http://192.168.1.59:30002 -> 192.168.1.107:30002"
        else
            echo "[ERR] 转发服务启动失败，查看日志: $LOG_FILE"
            exit 1
        fi
        ;;
    stop)
        if [ -f "$PID_FILE" ]; then
            PID=$(cat "$PID_FILE")
            if kill -0 "$PID" 2>/dev/null; then
                kill "$PID"
                echo "[OK] 转发服务已停止 (PID: $PID)"
            fi
            rm -f "$PID_FILE"
        else
            pkill -f "proxy_59_to_107.js" 2>/dev/null || true
            echo "[OK] 转发服务已停止"
        fi
        ;;
    status)
        if [ -f "$PID_FILE" ] && kill -0 "$(cat "$PID_FILE")" 2>/dev/null; then
            echo "[OK] 转发服务正在运行 (PID: $(cat "$PID_FILE"))"
            echo "  • 目标: 192.168.1.107 (30001, 30002)"
        else
            echo "[STOPPED] 转发服务未运行"
        fi
        ;;
    restart)
        "$0" stop
        sleep 1
        "$0" start
        ;;
    *)
        echo "用法: $0 {start|stop|restart|status}"
        exit 1
        ;;
esac
